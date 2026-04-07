from __future__ import annotations

import tempfile
import zlib
from pathlib import Path

import cv2
import numpy as np

from app.core.config import Settings
from app.schemas.responses import (
    PrecheckCheckResult,
    PrecheckPageResult,
    PrecheckResponse,
    PrecheckStatus,
)
from app.services.pdf_service import PDFService


class PrecheckService:
    def __init__(self, settings: Settings, pdf_service: PDFService) -> None:
        self.settings = settings
        self.pdf_service = pdf_service

    def inspect_upload(self, filename: str, payload: bytes) -> PrecheckResponse:
        suffix = Path(filename or "upload.bin").suffix or ".bin"
        temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
        try:
            temp_path = Path(temp_file.name)
            temp_file.write(payload)
            temp_file.close()
            rendered_pages = self.pdf_service.render_document(temp_path)
        finally:
            temp_file.close()
            try:
                Path(temp_file.name).unlink(missing_ok=True)
            except OSError:
                pass

        checks = [
            PrecheckCheckResult(
                key="file_integrity",
                label="File Integrity",
                status=PrecheckStatus.PASS,
                message=(
                    "The upload parsed successfully and a CRC32 fingerprint was captured "
                    "for traceability."
                ),
                value=f"CRC32 {self._crc32_hex(payload)}",
            )
        ]
        pages = [self._inspect_page(page.page_index, page.width, page.height, page.image) for page in rendered_pages]
        all_checks = checks + [check for page in pages for check in page.checks]
        blocking_check_count = sum(
            1 for check in all_checks if check.status == PrecheckStatus.BLOCK
        )
        warning_check_count = sum(
            1 for check in all_checks if check.status == PrecheckStatus.WARN
        )
        overall_status = self._combine_status([check.status for check in all_checks])

        return PrecheckResponse(
            filename=filename,
            page_count=len(rendered_pages),
            overall_status=overall_status,
            can_proceed=overall_status != PrecheckStatus.BLOCK,
            blocking_check_count=blocking_check_count,
            warning_check_count=warning_check_count,
            crc32_hash=self._crc32_hex(payload),
            summary=self._build_summary(overall_status, blocking_check_count, warning_check_count),
            checks=checks,
            pages=pages,
        )

    def _inspect_page(self, page_index: int, width: int, height: int, image) -> PrecheckPageResult:
        rgb = np.array(image.convert("RGB"))
        gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
        denoised = cv2.GaussianBlur(gray, (5, 5), 0)
        equalized = cv2.equalizeHist(denoised)
        otsu_threshold, _ = cv2.threshold(
            equalized,
            0,
            255,
            cv2.THRESH_BINARY + cv2.THRESH_OTSU,
        )
        edges = cv2.Canny(equalized, 50, 150)
        skew_degrees = self._estimate_skew_degrees(edges)
        blur_variance = float(cv2.Laplacian(gray, cv2.CV_64F).var())
        contrast_std = float(gray.std())
        edge_density = float(np.count_nonzero(edges) / edges.size)
        checks = [
            self._resolution_check(page_index, width, height),
            self._deskew_check(page_index, skew_degrees),
            self._contrast_check(page_index, contrast_std, otsu_threshold),
            self._edge_density_check(page_index, edge_density),
            self._blur_check(page_index, blur_variance),
        ]
        page_status = self._combine_status([check.status for check in checks])
        return PrecheckPageResult(
            page_index=page_index,
            width=width,
            height=height,
            status=page_status,
            checks=checks,
        )

    def _resolution_check(
        self,
        page_index: int,
        width: int,
        height: int,
    ) -> PrecheckCheckResult:
        min_side = min(width, height)
        pixel_count = width * height
        if min_side < 900 or pixel_count < 900_000:
            status = PrecheckStatus.BLOCK
            message = "The page is too small for reliable OCR and visual review."
        elif min_side < 1200 or pixel_count < 1_500_000:
            status = PrecheckStatus.WARN
            message = "The page is usable, but higher resolution would improve review quality."
        else:
            status = PrecheckStatus.PASS
            message = "The page resolution is suitable for OCR and visual inspection."
        return PrecheckCheckResult(
            key="resolution",
            label="Resolution",
            status=status,
            message=message,
            value=f"{width} x {height}",
            page_index=page_index,
        )

    def _deskew_check(
        self,
        page_index: int,
        skew_degrees: float | None,
    ) -> PrecheckCheckResult:
        if skew_degrees is None:
            return PrecheckCheckResult(
                key="deskew",
                label="Deskew",
                status=PrecheckStatus.WARN,
                message="The page did not expose enough dominant lines for a confident skew estimate.",
                value="Estimate unavailable",
                page_index=page_index,
            )

        absolute_skew = abs(skew_degrees)
        if absolute_skew > 8.0:
            status = PrecheckStatus.BLOCK
            message = "The page is heavily skewed and should be straightened before full review."
        elif absolute_skew > 5.0:
            status = PrecheckStatus.WARN
            message = "The page is slightly skewed. OCR and region localization may degrade."
        else:
            status = PrecheckStatus.PASS
            message = "The page alignment is within the accepted deskew range."
        return PrecheckCheckResult(
            key="deskew",
            label="Deskew",
            status=status,
            message=message,
            value=f"{skew_degrees:.2f} deg",
            page_index=page_index,
        )

    def _contrast_check(
        self,
        page_index: int,
        contrast_std: float,
        otsu_threshold: float,
    ) -> PrecheckCheckResult:
        if contrast_std < 18.0:
            status = PrecheckStatus.BLOCK
            message = "The page contrast is too low for dependable text extraction."
        elif contrast_std < 30.0:
            status = PrecheckStatus.WARN
            message = "The page contrast is marginal and may reduce OCR quality."
        else:
            status = PrecheckStatus.PASS
            message = "The page contrast is strong enough for OCR and forensic overlays."
        return PrecheckCheckResult(
            key="contrast",
            label="Contrast & Binarization",
            status=status,
            message=message,
            value=f"std {contrast_std:.1f}, Otsu {otsu_threshold:.0f}",
            page_index=page_index,
        )

    def _edge_density_check(
        self,
        page_index: int,
        edge_density: float,
    ) -> PrecheckCheckResult:
        if edge_density < 0.0025:
            status = PrecheckStatus.BLOCK
            message = "The page appears too blank, washed out, or over-smoothed for review."
        elif edge_density < 0.006:
            status = PrecheckStatus.WARN
            message = "The page has weak structural edges and may miss faint content."
        else:
            status = PrecheckStatus.PASS
            message = "The page contains enough structural detail for document review."
        return PrecheckCheckResult(
            key="edges",
            label="Edge Detail",
            status=status,
            message=message,
            value=f"{edge_density * 100:.2f}% edge density",
            page_index=page_index,
        )

    def _blur_check(
        self,
        page_index: int,
        blur_variance: float,
    ) -> PrecheckCheckResult:
        if blur_variance < 20.0:
            status = PrecheckStatus.BLOCK
            message = "The page is too blurred for reliable OCR and tamper localization."
        elif blur_variance < 60.0:
            status = PrecheckStatus.WARN
            message = "The page is slightly blurred. Fine details may be lost."
        else:
            status = PrecheckStatus.PASS
            message = "The page sharpness is acceptable."
        return PrecheckCheckResult(
            key="blur",
            label="Sharpness",
            status=status,
            message=message,
            value=f"Laplacian variance {blur_variance:.1f}",
            page_index=page_index,
        )

    def _estimate_skew_degrees(self, edges: np.ndarray) -> float | None:
        lines = cv2.HoughLines(edges, 1, np.pi / 180, 160)
        if lines is None:
            return None

        angles: list[float] = []
        for line in lines[:60]:
            theta = float(line[0][1])
            angle = np.rad2deg(theta) - 90.0
            if -45.0 <= angle <= 45.0:
                angles.append(float(angle))

        if not angles:
            return None
        return float(np.median(np.array(angles, dtype=np.float32)))

    def _combine_status(self, statuses: list[PrecheckStatus]) -> PrecheckStatus:
        if any(status == PrecheckStatus.BLOCK for status in statuses):
            return PrecheckStatus.BLOCK
        if any(status == PrecheckStatus.WARN for status in statuses):
            return PrecheckStatus.WARN
        return PrecheckStatus.PASS

    def _build_summary(
        self,
        status: PrecheckStatus,
        blocking_count: int,
        warning_count: int,
    ) -> str:
        if status == PrecheckStatus.BLOCK:
            return (
                f"Precheck blocked full review. Resolve {blocking_count} blocking issue"
                f"{'' if blocking_count == 1 else 's'} before submitting."
            )
        if status == PrecheckStatus.WARN:
            return (
                f"Precheck passed with warnings. {warning_count} quality check"
                f"{'' if warning_count == 1 else 's'} need attention, but review can continue."
            )
        return "Precheck passed. The document is ready for full forensic review."

    def _crc32_hex(self, payload: bytes) -> str:
        return f"{zlib.crc32(payload) & 0xFFFFFFFF:08x}"
