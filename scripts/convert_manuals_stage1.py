import argparse
import shutil
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path

import pypdfium2 as pdfium
from pydantic import ValidationError
from pypdf import PdfReader


REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT / "backend") not in sys.path:
    sys.path.insert(0, str(REPO_ROOT / "backend"))

from app.models.extraction import ExtractionArtifact, ExtractionRunSummary, ExtractedDocument, ExtractedPage


def parse_args():
    parser = argparse.ArgumentParser(
        description="Stage 1 conversion pipeline for the 20 equipment manuals.",
    )
    parser.add_argument(
        "--input-dir",
        default=str(REPO_ROOT / "equipment_manuals"),
        help="Directory containing source PDF manuals.",
    )
    parser.add_argument(
        "--output-dir",
        default=str(REPO_ROOT / "stage1_outputs" / "manuals"),
        help="Directory where markdown/json/images/manifests are written.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Re-run conversion even if an output manifest already exists.",
    )
    parser.add_argument(
        "--num-threads",
        type=int,
        default=4,
        help="Threads to pass to Docling.",
    )
    parser.add_argument(
        "--max-pages-render",
        type=int,
        default=0,
        help="If > 0, only render this many page images per document for quick tests.",
    )
    parser.add_argument(
        "--mode",
        choices=["fast", "deep"],
        default="fast",
        help=(
            "fast = classify all PDFs and use a lighter extraction path for digital documents. "
            "deep = use Docling on all files."
        ),
    )
    parser.add_argument(
        "--skip-render-for-digital",
        action="store_true",
        help="Skip page image rendering for documents classified as digital.",
    )
    parser.add_argument(
        "--docling-target",
        choices=["all", "digital", "non_digital"],
        default="all",
        help="Control which document classes are sent through Docling.",
    )
    parser.add_argument(
        "--disable-tables",
        action="store_true",
        help="Disable table extraction in Docling for faster runs.",
    )
    parser.add_argument(
        "--exclude",
        nargs="*",
        default=[],
        help="Document stems or filenames to skip, e.g. emanual1 emanual10.",
    )
    return parser.parse_args()


def get_docling_bin() -> Path:
    direct = Path(sys.executable).resolve().parent / "Scripts" / "docling.exe"
    if direct.exists():
        return direct

    resolved = shutil.which("docling")
    if resolved:
        return Path(resolved)

    raise FileNotFoundError(
        "Could not find docling.exe. Run this script with `py -3.12` where Docling is installed."
    )


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
    if "digital" in unique and "scanned" in unique:
        return "mixed"
    if unique == {"mixed"}:
        return "mixed"
    return "mixed"


def inspect_pdf(pdf_path: Path) -> tuple[ExtractedDocument, list[int]]:
    reader = PdfReader(str(pdf_path))
    page_char_counts: list[int] = []
    pages: list[ExtractedPage] = []

    for idx, page in enumerate(reader.pages, start=1):
        text = safe_extract_page_text(page)
        char_count = len(text.strip())
        page_char_counts.append(char_count)
        pages.append(
            ExtractedPage(
                page_number=idx,
                classification=classify_page(char_count),
                extracted_text_chars=char_count,
            )
        )

    doc = ExtractedDocument(
        source_pdf=str(pdf_path),
        document_name=pdf_path.stem,
        classification=classify_document([p.classification for p in pages]),
        page_count=len(pages),
        total_text_chars=sum(page_char_counts),
        pages=pages,
    )
    return doc, page_char_counts


def render_page_images(pdf_path: Path, output_dir: Path, max_pages_render: int = 0) -> list[str]:
    image_dir = output_dir / "page_images"
    image_dir.mkdir(parents=True, exist_ok=True)

    pdf = pdfium.PdfDocument(str(pdf_path))
    image_paths: list[str] = []

    try:
        limit = len(pdf)
        if max_pages_render > 0:
            limit = min(limit, max_pages_render)

        for index in range(limit):
            page = pdf[index]
            try:
                bitmap = page.render(scale=1.5)
                pil_image = bitmap.to_pil()
                image_path = image_dir / f"page_{index + 1:04d}.png"
                pil_image.save(image_path)
                image_paths.append(str(image_path))
            finally:
                page.close()
    finally:
        pdf.close()

    return image_paths


def run_docling(
    docling_bin: Path,
    pdf_path: Path,
    output_dir: Path,
    num_threads: int,
    enable_ocr: bool,
    enable_tables: bool,
) -> tuple[bool, str | None]:
    cmd = [
        str(docling_bin),
        str(pdf_path),
        "--from",
        "pdf",
        "--to",
        "md",
        "--to",
        "json",
        "--output",
        str(output_dir),
        "--pipeline",
        "standard",
        "--device",
        "cpu",
        "--num-threads",
        str(num_threads),
        "--image-export-mode",
        "referenced",
    ]

    if enable_ocr:
        cmd.append("--ocr")
    else:
        cmd.append("--no-ocr")

    if enable_tables:
        cmd.append("--tables")
    else:
        cmd.append("--no-tables")

    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if result.returncode == 0:
        return True, None

    error_text = (result.stderr or result.stdout or "").strip()
    return False, error_text[:4000] if error_text else "Docling failed with no error output."


def collect_docling_artifacts(output_dir: Path) -> list[ExtractionArtifact]:
    artifacts: list[ExtractionArtifact] = []
    for path in sorted(output_dir.rglob("*")):
        if not path.is_file():
            continue

        suffix = path.suffix.lower()
        if suffix == ".md":
            kind = "markdown"
        elif suffix == ".json":
            kind = "json"
        elif suffix in {".png", ".jpg", ".jpeg"}:
            kind = "page_images"
        elif suffix == ".log":
            kind = "log"
        else:
            continue

        artifacts.append(ExtractionArtifact(kind=kind, path=str(path)))
    return artifacts


def write_manifest(doc: ExtractedDocument, output_dir: Path):
    manifest_path = output_dir / "manifest.json"
    manifest_path.write_text(doc.model_dump_json(indent=2), encoding="utf-8")


def should_run_docling(doc_classification: str, mode: str, target: str) -> bool:
    if mode == "deep":
        return True

    if target == "all":
        return True
    if target == "digital":
        return doc_classification == "digital"
    if target == "non_digital":
        return doc_classification != "digital"
    return True


def should_enable_ocr(doc_classification: str, mode: str) -> bool:
    if mode == "deep":
        return True
    return doc_classification != "digital"


def write_native_markdown(doc: ExtractedDocument, output_dir: Path):
    lines: list[str] = [f"# {doc.document_name}", ""]
    for page in doc.pages:
        lines.append(f"## Page {page.page_number}")
        lines.append("")
        text = getattr(page, "raw_text", None) or ""
        lines.append(text.strip())
        lines.append("")

    md_path = output_dir / f"{doc.document_name}.native.md"
    md_path.write_text("\n".join(lines).strip() + "\n", encoding="utf-8")
    return md_path


def main():
    args = parse_args()
    input_dir = Path(args.input_dir).resolve()
    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    excluded = {item.lower() for item in args.exclude}

    docling_bin = get_docling_bin()
    pdf_files = sorted(input_dir.glob("*.pdf"))

    summary = ExtractionRunSummary(
        started_at=datetime.now(UTC),
        source_directory=str(input_dir),
        output_directory=str(output_dir),
        document_count=len(pdf_files),
    )

    for pdf_path in pdf_files:
        if pdf_path.stem.lower() in excluded or pdf_path.name.lower() in excluded:
            print(f"[exclude] {pdf_path.name}")
            continue

        document_output_dir = output_dir / pdf_path.stem
        manifest_path = document_output_dir / "manifest.json"

        if manifest_path.exists() and not args.force:
            try:
                doc = ExtractedDocument.model_validate_json(manifest_path.read_text(encoding="utf-8"))
                summary.documents.append(doc)
                if doc.docling_status == "success":
                    summary.successful_docling_runs += 1
                elif doc.docling_status == "failed":
                    summary.failed_docling_runs += 1
                print(f"[skip] {pdf_path.name}: manifest already exists")
                continue
            except ValidationError:
                pass

        document_output_dir.mkdir(parents=True, exist_ok=True)
        print(f"[inspect] {pdf_path.name}")
        doc, _ = inspect_pdf(pdf_path)

        reader = PdfReader(str(pdf_path))
        for page_obj, page_model in zip(reader.pages, doc.pages):
            page_model.raw_text = safe_extract_page_text(page_obj)

        if not (args.skip_render_for_digital and doc.classification == "digital"):
            print(f"[render] {pdf_path.name}")
            image_paths = render_page_images(pdf_path, document_output_dir, args.max_pages_render)
            for page, image_path in zip(doc.pages, image_paths):
                page.image_path = image_path
        else:
            print(f"[render-skip] {pdf_path.name}: digital document")

        native_md_path = write_native_markdown(doc, document_output_dir)
        doc.artifacts.append(ExtractionArtifact(kind="markdown", path=str(native_md_path)))

        if should_run_docling(doc.classification, args.mode, args.docling_target):
            print(f"[docling] {pdf_path.name}")
            success, error_text = run_docling(
                docling_bin=docling_bin,
                pdf_path=pdf_path,
                output_dir=document_output_dir,
                num_threads=args.num_threads,
                enable_ocr=should_enable_ocr(doc.classification, args.mode),
                enable_tables=not args.disable_tables,
            )
            doc.docling_status = "success" if success else "failed"
            doc.docling_error = error_text
        else:
            print(f"[docling-skip] {pdf_path.name}: class={doc.classification}, mode={args.mode}")
            success = True
            doc.docling_status = "skipped"
            doc.docling_error = None

        doc.artifacts = collect_docling_artifacts(document_output_dir)
        doc.artifacts.append(ExtractionArtifact(kind="manifest", path=str(manifest_path)))

        write_manifest(doc, document_output_dir)
        summary.documents.append(doc)

        if doc.docling_status in {"success", "skipped"}:
            summary.successful_docling_runs += 1
            print(f"[ok] {pdf_path.name} [{doc.classification}]")
        else:
            summary.failed_docling_runs += 1
            print(f"[fail] {pdf_path.name}: {error_text}")

    summary.completed_at = datetime.now(UTC)
    summary_path = output_dir / "run_summary.json"
    summary_path.write_text(summary.model_dump_json(indent=2), encoding="utf-8")
    print(f"[done] wrote summary to {summary_path}")


if __name__ == "__main__":
    main()
