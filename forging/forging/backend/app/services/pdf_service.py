from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from PIL import Image

from app.core.config import Settings

try:
    import fitz
except ImportError:  # pragma: no cover - depends on optional install
    fitz = None


@dataclass(slots=True)
class RenderedPage:
    page_index: int
    image: Image.Image
    width: int
    height: int


class PDFService:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def render_document(self, file_path: Path) -> list[RenderedPage]:
        suffix = file_path.suffix.lower()
        if suffix == ".pdf":
            return self._render_pdf(file_path)
        if suffix in self.settings.allowed_upload_suffixes:
            image = Image.open(file_path).convert("RGB")
            return [
                RenderedPage(
                    page_index=1,
                    image=image,
                    width=image.width,
                    height=image.height,
                )
            ]
        raise ValueError(
            f"Unsupported file type '{suffix}'. Supported: {sorted(self.settings.allowed_upload_suffixes)}"
        )

    def _render_pdf(self, file_path: Path) -> list[RenderedPage]:
        if fitz is None:
            raise RuntimeError(
                "PyMuPDF is not installed. Install requirements before analyzing PDF files."
            )

        scale = self.settings.pdf_dpi / 72.0
        matrix = fitz.Matrix(scale, scale)
        document = fitz.open(file_path)
        pages: list[RenderedPage] = []
        try:
            for page_number, page in enumerate(document, start=1):
                pixmap = page.get_pixmap(matrix=matrix, alpha=False)
                image = Image.frombytes("RGB", [pixmap.width, pixmap.height], pixmap.samples)
                pages.append(
                    RenderedPage(
                        page_index=page_number,
                        image=image,
                        width=image.width,
                        height=image.height,
                    )
                )
        finally:
            document.close()
        return pages
