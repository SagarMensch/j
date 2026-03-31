import re
import uuid
from functools import lru_cache
from pathlib import Path
from typing import Any

from app.core.config import get_settings


def chunk_text(text: str, chunk_size: int = 500, overlap: int = 50) -> list[dict[str, Any]]:
    if not text or len(text.strip()) < 20:
        return []

    text = re.sub(r'\s+', ' ', text).strip()

    paragraphs = re.split(r'\n\s*\n', text)
    chunks = []
    current_chunk = ""

    for para in paragraphs:
        para = para.strip()
        if not para:
            continue

        if len(current_chunk) + len(para) + 1 <= chunk_size:
            current_chunk += (" " + para) if current_chunk else para
        else:
            if current_chunk:
                chunks.append(current_chunk.strip())

            if len(para) > chunk_size:
                words = para.split()
                temp_chunk = ""
                for word in words:
                    if len(temp_chunk) + len(word) + 1 <= chunk_size:
                        temp_chunk += (" " + word) if temp_chunk else word
                    else:
                        if temp_chunk:
                            chunks.append(temp_chunk.strip())
                        temp_chunk = word
                current_chunk = temp_chunk
            else:
                current_chunk = para

    if current_chunk:
        chunks.append(current_chunk.strip())

    processed_chunks = []
    for i, chunk in enumerate(chunks):
        if len(chunk) >= 30:
            processed_chunks.append({
                "chunk_index": i,
                "content": chunk,
                "char_count": len(chunk)
            })

    return processed_chunks


def extract_text_from_pdf_docling(file_path: str) -> str:
    try:
        from docling.document_converter import DocumentConverter

        converter = DocumentConverter()
        result = converter.convert(file_path)
        return result.document.export_to_markdown()
    except Exception as e:
        print(f"Docling extraction failed: {e}")
        return None


def extract_text_from_pdf_paddleocr(file_path: str) -> str:
    try:
        import tempfile

        ocr = _get_paddle_ocr()
        settings = get_settings()
        text_parts = []

        with tempfile.TemporaryDirectory() as tmp_dir:
            rendered = _render_pdf_images(file_path, Path(tmp_dir), dpi=settings.SOP_OCR_DPI)
            for page in rendered:
                result = ocr.ocr(page["image"])
                text_parts.extend(_extract_text_from_ocr_result(result))

        return "\n".join(text_parts)
    except Exception as e:
        print(f"PaddleOCR extraction failed: {e}")
        return None


def extract_text_from_pdf_fallback(file_path: str) -> str:
    try:
        from pypdf import PdfReader

        reader = PdfReader(file_path)
        text_parts = []

        for page in reader.pages:
            text = page.extract_text()
            if text:
                text_parts.append(text)

        return "\n".join(text_parts)
    except Exception as e:
        print(f"Fallback PDF extraction failed: {e}")
        return ""


def extract_text_from_pdf(file_path: str) -> str:
    text = extract_text_from_pdf_docling(file_path)
    if text and len(text.strip()) > 100:
        return text

    text = extract_text_from_pdf_paddleocr(file_path)
    if text and len(text.strip()) > 100:
        return text

    return extract_text_from_pdf_fallback(file_path)


def extract_text_from_txt(file_path: str) -> str:
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            return f.read()
    except Exception:
        try:
            with open(file_path, 'r', encoding='latin-1') as f:
                return f.read()
        except Exception:
            return ""

@lru_cache(maxsize=1)
def _get_paddle_ocr():
    import os
    os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")
    from paddleocr import PaddleOCR

    return PaddleOCR(use_angle_cls=True, lang="en")


def _render_pdf_images(file_path: str, output_dir: Path, *, dpi: int) -> list[dict[str, Any]]:
    try:
        import fitz
        import numpy as np
    except ModuleNotFoundError as exc:
        raise RuntimeError(
            "PyMuPDF is required for PDF rendering. Install backend requirements to continue."
        ) from exc

    output_dir.mkdir(parents=True, exist_ok=True)
    rendered = []
    doc = fitz.open(file_path)
    zoom = dpi / 72.0
    matrix = fitz.Matrix(zoom, zoom)
    for idx, page in enumerate(doc, start=1):
        pix = page.get_pixmap(matrix=matrix, alpha=False)
        image_path = output_dir / f"page_{idx:04d}.png"
        pix.save(str(image_path))
        img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)
        if pix.n == 4:
            img = img[:, :, :3]
        rendered.append(
            {
                "page_number": idx,
                "image_path": str(image_path),
                "image": img,
            }
        )
    return rendered


def _extract_text_from_ocr_result(result: Any) -> list[str]:
    texts: list[str] = []
    for entry in _iter_ocr_entries(result):
        text = (
            entry.get("text")
            or entry.get("rec_text")
            or entry.get("label")
            or entry.get("value")
        )
        if text and isinstance(text, str) and text.strip():
            texts.append(text.strip())
    return texts


def _normalize_bbox(bbox: Any) -> dict[str, float] | None:
    if not bbox:
        return None
    if isinstance(bbox, dict):
        if {"left", "top", "right", "bottom"} <= set(bbox.keys()):
            return {
                "left": float(bbox["left"]),
                "top": float(bbox["top"]),
                "right": float(bbox["right"]),
                "bottom": float(bbox["bottom"]),
            }
    if isinstance(bbox, (list, tuple)):
        if len(bbox) == 4 and all(isinstance(v, (int, float)) for v in bbox):
            x1, y1, x2, y2 = bbox
            return {
                "left": float(min(x1, x2)),
                "top": float(min(y1, y2)),
                "right": float(max(x1, x2)),
                "bottom": float(max(y1, y2)),
            }
        points = []
        for pt in bbox:
            if isinstance(pt, (list, tuple)) and len(pt) >= 2:
                points.append((float(pt[0]), float(pt[1])))
        if points:
            xs = [p[0] for p in points]
            ys = [p[1] for p in points]
            return {
                "left": min(xs),
                "top": min(ys),
                "right": max(xs),
                "bottom": max(ys),
            }
    return None


def _iter_ocr_entries(result: Any):
    if not result:
        return
    if isinstance(result, dict):
        result = (
            result.get("res")
            or result.get("result")
            or result.get("data")
            or result.get("outputs")
            or []
        )
    for line in result:
        if not line:
            continue
        if isinstance(line, dict):
            yield line
            continue
        if isinstance(line, (list, tuple)):
            if len(line) == 2 and isinstance(line[1], (list, tuple)):
                yield {"bbox": line[0], "text": line[1][0], "score": line[1][1] if len(line[1]) > 1 else None}
                continue
            for item in line:
                if not item:
                    continue
                if isinstance(item, dict):
                    yield item
                    continue
                if isinstance(item, (list, tuple)) and len(item) >= 2:
                    text = ""
                    score = None
                    if isinstance(item[1], (list, tuple)):
                        if item[1]:
                            text = item[1][0] if isinstance(item[1][0], str) else ""
                        if len(item[1]) > 1:
                            score = item[1][1]
                    elif isinstance(item[1], str):
                        text = item[1]
                    yield {"bbox": item[0], "text": text, "score": score}


def _ocr_blocks_from_image(image, page_number: int) -> tuple[list[dict[str, Any]], float | None]:
    import numpy as np

    ocr = _get_paddle_ocr()
    result = ocr.ocr(np.array(image)) or []
    blocks = []
    confidences = []
    reading_order = 0

    for entry in _iter_ocr_entries(result):
        text = (
            entry.get("text")
            or entry.get("rec_text")
            or entry.get("label")
            or entry.get("value")
        )
        if not text or not isinstance(text, str) or not text.strip():
            continue
        conf = entry.get("score")
        if conf is None:
            conf = entry.get("rec_score")
        if conf is None:
            conf = entry.get("confidence")
        bbox = entry.get("bbox") or entry.get("points") or entry.get("box")
        bbox_norm = _normalize_bbox(bbox)
        blocks.append(
            {
                "block_id": str(uuid.uuid4()),
                "page_number": page_number,
                "block_type": "paragraph",
                "section_title": None,
                "text": text.strip(),
                "bbox": bbox_norm,
                "confidence": float(conf) if conf is not None else None,
                "reading_order": reading_order,
            }
        )
        if conf is not None:
            confidences.append(float(conf))
        reading_order += 1

    avg_conf = sum(confidences) / len(confidences) if confidences else None
    return blocks, avg_conf


def _blocks_from_text(text: str, *, page_number: int = 1) -> list[dict[str, Any]]:
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    blocks = []
    for idx, para in enumerate(paragraphs):
        blocks.append(
            {
                "block_id": str(uuid.uuid4()),
                "page_number": page_number,
                "block_type": "paragraph",
                "section_title": None,
                "text": para,
                "bbox": None,
                "confidence": None,
                "reading_order": idx,
            }
        )
    return blocks


def _extract_pdf_page_texts(file_path: str) -> list[str]:
    from pypdf import PdfReader

    reader = PdfReader(file_path)
    return [page.extract_text() or "" for page in reader.pages]


def _chunk_type_for_blocks(blocks: list[dict[str, Any]]) -> str:
    block_types = {b.get("block_type") for b in blocks}
    if {"warning", "caution"} & block_types:
        return "warning"
    if "procedure_step" in block_types:
        return "procedure"
    return "section"


def _build_chunks_from_blocks(
    pages: list[dict[str, Any]],
    *,
    chunk_size: int = 900,
    overlap: int = 120,
) -> list[dict[str, Any]]:
    chunks = []
    current_blocks: list[dict[str, Any]] = []
    current_len = 0

    def finalize_chunk():
        nonlocal current_blocks, current_len
        if not current_blocks:
            return
        content = "\n".join(b["text"] for b in current_blocks if b.get("text"))
        if not content.strip():
            current_blocks = []
            current_len = 0
            return
        page_numbers = [b["page_number"] for b in current_blocks]
        page_start = min(page_numbers)
        page_end = max(page_numbers)
        section_title = next(
            (b.get("section_title") for b in current_blocks if b.get("section_title")),
            None,
        )
        citation_label = f"p.{page_start}" if page_start == page_end else f"p.{page_start}-{page_end}"
        chunks.append(
            {
                "chunk_index": len(chunks),
                "chunk_type": _chunk_type_for_blocks(current_blocks),
                "content": content.strip(),
                "page_start": page_start,
                "page_end": page_end,
                "section_title": section_title,
                "citation_label": citation_label,
                "block_ids": [b["block_id"] for b in current_blocks],
                "char_count": len(content),
            }
        )
        # Prepare overlap for next chunk
        overlap_blocks = []
        overlap_len = 0
        for block in reversed(current_blocks):
            overlap_len += len(block.get("text", "")) + 1
            overlap_blocks.insert(0, block)
            if overlap_len >= overlap:
                break
        current_blocks = overlap_blocks
        current_len = sum(len(b.get("text", "")) + 1 for b in current_blocks)

    for page in sorted(pages, key=lambda p: p["page_number"]):
        for block in sorted(page.get("blocks", []), key=lambda b: b.get("reading_order", 0)):
            text = (block.get("text") or "").strip()
            if not text:
                continue
            if current_len + len(text) + 1 <= chunk_size or not current_blocks:
                current_blocks.append(block)
                current_len += len(text) + 1
            else:
                finalize_chunk()
                current_blocks.append(block)
                current_len += len(text) + 1

    finalize_chunk()
    return chunks


def process_document(file_path: str, doc_id: str, revision_id: str) -> dict[str, Any]:
    settings = get_settings()
    ext = Path(file_path).suffix.lower()
    output_dir = Path(settings.PROCESSED_DATA_DIR) / doc_id / revision_id
    output_dir.mkdir(parents=True, exist_ok=True)

    pages: list[dict[str, Any]] = []
    classification = "unknown"
    total_text_chars = 0

    if ext == ".pdf":
        docling_text = extract_text_from_pdf_docling(file_path) or ""
        docling_ok = len(docling_text.strip()) > 200
        if docling_ok:
            docling_path = output_dir / "docling.md"
            docling_path.write_text(docling_text, encoding="utf-8")
        else:
            docling_path = None
        classification = "digital" if docling_ok else "scanned"
        ocr_mode = (settings.SOP_OCR_MODE or "auto").lower()
        if ocr_mode not in {"auto", "always", "never"}:
            ocr_mode = "auto"
        needs_ocr = ocr_mode == "always" or (ocr_mode == "auto" and not docling_ok)
        render_dpi = settings.SOP_OCR_DPI if needs_ocr else settings.SOP_PDF_RENDER_DPI

        rendered_pages = _render_pdf_images(file_path, output_dir / "pages", dpi=render_dpi)

        if needs_ocr:
            for page in rendered_pages:
                page_blocks, avg_conf = _ocr_blocks_from_image(page["image"], page["page_number"])
                raw_text = "\n".join(b["text"] for b in page_blocks if b.get("text"))
                total_text_chars += len(raw_text)
                pages.append(
                    {
                        "page_number": page["page_number"],
                        "classification": classification,
                        "extracted_text_chars": len(raw_text),
                        "raw_text": raw_text,
                        "markdown_path": str(docling_path) if docling_path else None,
                        "image_path": page["image_path"],
                        "ocr_used": True,
                        "ocr_confidence": avg_conf,
                        "blocks": page_blocks,
                    }
                )
        else:
            page_texts = _extract_pdf_page_texts(file_path)
            for page in rendered_pages:
                page_number = page["page_number"]
                text = page_texts[page_number - 1] if page_number - 1 < len(page_texts) else ""
                blocks = _blocks_from_text(text, page_number=page_number) if text.strip() else []
                total_text_chars += len(text)
                pages.append(
                    {
                        "page_number": page_number,
                        "classification": classification,
                        "extracted_text_chars": len(text),
                        "raw_text": text,
                        "markdown_path": str(docling_path) if docling_path else None,
                        "image_path": page["image_path"],
                        "ocr_used": False,
                        "ocr_confidence": None,
                        "blocks": blocks,
                    }
                )
    elif ext in [".txt", ".md"]:
        text = extract_text_from_txt(file_path)
        if text:
            blocks = _blocks_from_text(text, page_number=1)
            total_text_chars = len(text)
            pages.append(
                {
                    "page_number": 1,
                    "classification": "digital",
                    "extracted_text_chars": len(text),
                    "raw_text": text,
                    "markdown_path": None,
                    "image_path": None,
                    "ocr_used": False,
                    "ocr_confidence": None,
                    "blocks": blocks,
                }
            )
            classification = "digital"

    if not pages:
        return {
            "pages": [],
            "chunks": [],
            "page_count": 0,
            "classification": classification,
            "total_text_chars": 0,
        }

    chunks = _build_chunks_from_blocks(pages)

    return {
        "pages": pages,
        "chunks": chunks,
        "page_count": len(pages),
        "classification": classification,
        "total_text_chars": total_text_chars,
    }
