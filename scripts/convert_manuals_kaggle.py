import argparse
import json
import os
import sys
from datetime import UTC, datetime
from pathlib import Path

import pypdfium2 as pdfium
from pydantic import ValidationError
from pypdf import PdfReader


REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT / "backend") not in sys.path:
    sys.path.insert(0, str(REPO_ROOT / "backend"))

from app.models.extraction import BoundingBox, ExtractionArtifact, ExtractionRunSummary, ExtractedBlock, ExtractedDocument, ExtractedPage


def parse_args():
    parser = argparse.ArgumentParser(
        description="GPU-oriented Stage 1 converter for Kaggle: native extraction for digital PDFs, OCR only for non-digital pages.",
    )
    parser.add_argument("--input-dir", default=str(REPO_ROOT / "equipment_manuals"))
    parser.add_argument("--output-dir", default=str(REPO_ROOT / "stage1_outputs" / "kaggle_manuals"))
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--num-threads", type=int, default=4)
    parser.add_argument("--scale", type=float, default=2.0, help="Render scale for OCR pages.")
    parser.add_argument("--lang", default="en", help="PaddleOCR language code.")
    parser.add_argument(
        "--device",
        choices=["auto", "cpu", "gpu"],
        default="auto",
        help="OCR device selection. auto prefers GPU when running on Kaggle.",
    )
    parser.add_argument(
        "--exclude",
        nargs="*",
        default=[],
        help="Document stems or filenames to skip, e.g. emanual1 emanual10.",
    )
    parser.add_argument(
        "--include",
        nargs="*",
        default=[],
        help="If set, only process these document stems or filenames.",
    )
    parser.add_argument("--shard-count", type=int, default=1, help="Split corpus into N shards.")
    parser.add_argument("--shard-index", type=int, default=0, help="0-based shard index.")
    parser.add_argument(
        "--disable-render-for-digital",
        action="store_true",
        help="Do not render page images for digital pages.",
    )
    parser.add_argument(
        "--page-limit",
        type=int,
        default=0,
        help="If > 0, only process this many pages per document.",
    )
    return parser.parse_args()


def normalize_names(items: list[str]) -> set[str]:
    return {item.lower() for item in items}


def should_process(pdf_path: Path, include: set[str], exclude: set[str], shard_count: int, shard_index: int, ordinal: int) -> bool:
    if include and pdf_path.stem.lower() not in include and pdf_path.name.lower() not in include:
        return False
    if pdf_path.stem.lower() in exclude or pdf_path.name.lower() in exclude:
        return False
    if shard_count > 1 and ordinal % shard_count != shard_index:
        return False
    return True


def safe_extract_page_text(page) -> str:
    try:
        return page.extract_text() or ""
    except Exception:
        return ""


def classify_page(char_count: int) -> str:
    if char_count >= 150:
        return "digital"
    if char_count <= 20:
        return "scanned"
    return "mixed"


def classify_document(page_classifications: list[str]) -> str:
    if not page_classifications:
        return "unknown"

    unique = set(page_classifications)
    if unique == {"digital"}:
        return "digital"
    if unique == {"scanned"}:
        return "scanned"
    return "mixed"


def inspect_pdf(pdf_path: Path, page_limit: int = 0) -> ExtractedDocument:
    reader = PdfReader(str(pdf_path))
    pages: list[ExtractedPage] = []
    total_chars = 0

    source_pages = reader.pages
    if page_limit > 0:
        source_pages = source_pages[:page_limit]

    for idx, page in enumerate(source_pages, start=1):
        text = safe_extract_page_text(page)
        char_count = len(text.strip())
        total_chars += char_count
        pages.append(
            ExtractedPage(
                page_number=idx,
                classification=classify_page(char_count),
                extracted_text_chars=char_count,
                raw_text=text,
            )
        )

    return ExtractedDocument(
        source_pdf=str(pdf_path),
        document_name=pdf_path.stem,
        classification=classify_document([p.classification for p in pages]),
        page_count=len(pages),
        total_text_chars=total_chars,
        pages=pages,
    )


def render_page(pdf: pdfium.PdfDocument, page_index: int, image_path: Path, scale: float) -> str:
    page = pdf[page_index]
    try:
        bitmap = page.render(scale=scale)
        pil_image = bitmap.to_pil()
        pil_image.save(image_path)
    finally:
        page.close()
    return str(image_path)


def get_use_gpu(device: str) -> bool:
    if device == "gpu":
        return True
    if device == "cpu":
        return False
    if os.environ.get("KAGGLE_KERNEL_RUN_TYPE"):
        return True
    visible = os.environ.get("CUDA_VISIBLE_DEVICES", "").strip()
    return bool(visible and visible != "-1")


def get_ocr_engine(lang: str, device: str):
    try:
        from paddleocr import PaddleOCR
    except ImportError as exc:
        raise RuntimeError(
            "PaddleOCR is not installed. Install it in Kaggle before running this script."
        ) from exc

    return PaddleOCR(
        use_angle_cls=False,
        lang=lang,
        use_gpu=get_use_gpu(device),
        show_log=False,
    )


def bbox_from_points(points) -> BoundingBox | None:
    try:
        xs = [float(point[0]) for point in points]
        ys = [float(point[1]) for point in points]
        return BoundingBox(left=min(xs), top=min(ys), right=max(xs), bottom=max(ys))
    except Exception:
        return None


def parse_paddleocr_result(page_number: int, result) -> tuple[str, float | None, list[ExtractedBlock]]:
    if not result:
        return "", None, []

    lines = result
    if (
        isinstance(result, list)
        and len(result) == 1
        and isinstance(result[0], list)
        and result[0]
    ):
        lines = result[0]

    blocks: list[ExtractedBlock] = []
    text_lines: list[str] = []
    confidences: list[float] = []

    for idx, line in enumerate(lines, start=1):
        if not isinstance(line, list) or len(line) != 2:
            continue
        points, rec = line
        if not isinstance(rec, (list, tuple)) or len(rec) < 2:
            continue

        text = str(rec[0]).strip()
        if not text:
            continue

        confidence = float(rec[1])
        text_lines.append(text)
        confidences.append(confidence)
        blocks.append(
            ExtractedBlock(
                block_id=f"p{page_number:04d}_ocr_{idx:04d}",
                block_type="paragraph",
                page_number=page_number,
                text=text,
                bbox=bbox_from_points(points),
                confidence=confidence,
                reading_order=idx,
            )
        )

    if not text_lines:
        return "", None, []

    avg_conf = sum(confidences) / len(confidences)
    return "\n".join(text_lines), avg_conf, blocks


def write_native_markdown(doc: ExtractedDocument, output_dir: Path) -> Path:
    lines: list[str] = [f"# {doc.document_name}", ""]
    for page in doc.pages:
        lines.append(f"## Page {page.page_number}")
        lines.append("")
        lines.append((page.raw_text or "").strip())
        lines.append("")

    md_path = output_dir / f"{doc.document_name}.native.md"
    md_path.write_text("\n".join(lines).strip() + "\n", encoding="utf-8")
    return md_path


def write_ocr_json(doc: ExtractedDocument, output_dir: Path) -> Path:
    page_payload = []
    for page in doc.pages:
        page_payload.append(
            {
                "page_number": page.page_number,
                "classification": page.classification,
                "ocr_used": page.ocr_used,
                "ocr_confidence": page.ocr_confidence,
                "image_path": page.image_path,
                "raw_text": page.raw_text,
                "blocks": [block.model_dump() for block in page.blocks],
            }
        )

    out_path = output_dir / f"{doc.document_name}.ocr.json"
    out_path.write_text(json.dumps(page_payload, indent=2, ensure_ascii=False), encoding="utf-8")
    return out_path


def write_manifest(doc: ExtractedDocument, output_dir: Path):
    manifest_path = output_dir / "manifest.json"
    manifest_path.write_text(doc.model_dump_json(indent=2), encoding="utf-8")


def main():
    args = parse_args()
    if args.shard_count < 1:
        raise ValueError("--shard-count must be >= 1")
    if not 0 <= args.shard_index < args.shard_count:
        raise ValueError("--shard-index must satisfy 0 <= shard-index < shard-count")

    input_dir = Path(args.input_dir).resolve()
    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    include = normalize_names(args.include)
    exclude = normalize_names(args.exclude)
    pdf_files = sorted(input_dir.glob("*.pdf"))

    summary = ExtractionRunSummary(
        started_at=datetime.now(UTC),
        source_directory=str(input_dir),
        output_directory=str(output_dir),
        document_count=0,
    )

    ocr = None

    for ordinal, pdf_path in enumerate(pdf_files):
        if not should_process(pdf_path, include, exclude, args.shard_count, args.shard_index, ordinal):
            print(f"[skip] {pdf_path.name}")
            continue

        summary.document_count += 1
        document_output_dir = output_dir / pdf_path.stem
        manifest_path = document_output_dir / "manifest.json"

        if manifest_path.exists() and not args.force:
            try:
                doc = ExtractedDocument.model_validate_json(manifest_path.read_text(encoding="utf-8"))
                summary.documents.append(doc)
                summary.successful_docling_runs += 1
                print(f"[skip] {pdf_path.name}: manifest already exists")
                continue
            except ValidationError:
                pass

        document_output_dir.mkdir(parents=True, exist_ok=True)
        print(f"[inspect] {pdf_path.name}")
        doc = inspect_pdf(pdf_path, page_limit=args.page_limit)

        if doc.classification != "digital" and ocr is None:
            print(f"[ocr-init] device={args.device}")
            ocr = get_ocr_engine(lang=args.lang, device=args.device)

        pdf = pdfium.PdfDocument(str(pdf_path))
        try:
            for page_index, page_model in enumerate(doc.pages):
                needs_ocr = page_model.classification != "digital"
                should_render = needs_ocr or not args.disable_render_for_digital

                if should_render:
                    image_dir = document_output_dir / "page_images"
                    image_dir.mkdir(parents=True, exist_ok=True)
                    image_path = image_dir / f"page_{page_model.page_number:04d}.png"
                    page_model.image_path = render_page(pdf, page_index, image_path, args.scale)

                if not needs_ocr:
                    continue

                if not page_model.image_path:
                    image_dir = document_output_dir / "page_images"
                    image_dir.mkdir(parents=True, exist_ok=True)
                    image_path = image_dir / f"page_{page_model.page_number:04d}.png"
                    page_model.image_path = render_page(pdf, page_index, image_path, args.scale)

                result = ocr.ocr(page_model.image_path, cls=False)
                ocr_text, avg_conf, blocks = parse_paddleocr_result(page_model.page_number, result)
                page_model.raw_text = ocr_text or page_model.raw_text
                page_model.ocr_used = True
                page_model.ocr_confidence = avg_conf
                page_model.blocks = blocks
        finally:
            pdf.close()

        native_md_path = write_native_markdown(doc, document_output_dir)
        ocr_json_path = write_ocr_json(doc, document_output_dir)
        doc.artifacts = [
            ExtractionArtifact(kind="markdown", path=str(native_md_path)),
            ExtractionArtifact(kind="json", path=str(ocr_json_path)),
        ]

        page_images_dir = document_output_dir / "page_images"
        if page_images_dir.exists():
            for path in sorted(page_images_dir.glob("*.png")):
                doc.artifacts.append(ExtractionArtifact(kind="page_images", path=str(path)))

        doc.docling_status = "success"
        doc.docling_error = None
        write_manifest(doc, document_output_dir)
        doc.artifacts.append(ExtractionArtifact(kind="manifest", path=str(manifest_path)))
        summary.documents.append(doc)
        summary.successful_docling_runs += 1
        print(f"[ok] {pdf_path.name} [{doc.classification}]")

    summary.completed_at = datetime.now(UTC)
    summary_path = output_dir / "run_summary.json"
    summary_path.write_text(summary.model_dump_json(indent=2), encoding="utf-8")
    print(f"[done] wrote summary to {summary_path}")


if __name__ == "__main__":
    main()
