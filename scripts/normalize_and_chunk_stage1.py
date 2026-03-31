import argparse
import hashlib
import json
import re
import sys
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path
from zipfile import ZipFile


REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT / "backend") not in sys.path:
    sys.path.insert(0, str(REPO_ROOT / "backend"))

from app.models.canonical import CanonicalBlock, CanonicalChunk, CanonicalCorpusSummary, CanonicalDocumentBundle, EntityCandidate
from app.models.extraction import BoundingBox, ExtractedDocument


GLYPH_RE = re.compile(r"GLYPH<\d+>")
MULTISPACE_RE = re.compile(r"[ \t]{2,}")
BLANKLINE_RE = re.compile(r"\n{3,}")
PAGE_TAG_RE = re.compile(r"^\s*\d+\s*/\s*\d+\s*$")
EQUIPMENT_TAG_RE = re.compile(r"\b[A-Z]{1,4}\d{2,}[A-Z0-9/-]*\b")
MODEL_RE = re.compile(r"\b[A-Z]{2,}[A-Z0-9/_-]{3,}\b")
STEP_RE = re.compile(r"^\s*(?:step\s+\d+|[0-9]{1,2}[.)]|[a-z][.)])\s+", re.IGNORECASE)
WARNING_PREFIXES = ("danger", "warning", "caution", "note", "important")
PPE_TERMS = ("ppe", "helmet", "gloves", "goggles", "arc flash", "face shield", "safety shoes")
INTERLOCK_TERMS = ("interlock", "trip", "block", "lockout", "loto")
ALARM_TERMS = ("alarm", "trip", "fault", "alert")
CHEMICAL_TERMS = ("acid", "caustic", "solvent", "ammonia", "chlorine", "hydrogen")


def parse_args():
    parser = argparse.ArgumentParser(
        description="Normalize Stage 1 extraction outputs into canonical blocks, chunks, and entity candidates.",
    )
    parser.add_argument(
        "--input",
        default=str(REPO_ROOT / "kaggle_manuals_final.zip"),
        help="Input extraction directory or zip archive.",
    )
    parser.add_argument(
        "--output-dir",
        default=str(REPO_ROOT / "stage1_outputs" / "canonical"),
        help="Directory to write canonical bundles and summaries.",
    )
    parser.add_argument(
        "--exclude",
        nargs="*",
        default=[],
        help="Document stems or filenames to skip.",
    )
    parser.add_argument(
        "--include",
        nargs="*",
        default=[],
        help="If set, only normalize these document stems or filenames.",
    )
    parser.add_argument(
        "--min-line-chars",
        type=int,
        default=3,
        help="Minimum cleaned line length to retain as a candidate block.",
    )
    parser.add_argument(
        "--max-chunk-chars",
        type=int,
        default=1400,
        help="Soft limit for chunk content length before splitting.",
    )
    return parser.parse_args()


class ArtifactStore:
    def __init__(self, source: Path):
        self.source = source
        self.zip_file: ZipFile | None = None
        if source.is_file() and source.suffix.lower() == ".zip":
            self.zip_file = ZipFile(source)

    def close(self):
        if self.zip_file is not None:
            self.zip_file.close()

    def list_docs(self) -> list[str]:
        if self.zip_file is not None:
            docs = {name.split("/")[0] for name in self.zip_file.namelist() if "/" in name}
            return sorted(doc for doc in docs if doc)
        return sorted(path.name for path in self.source.iterdir() if path.is_dir())

    def has_file(self, relative_path: str) -> bool:
        if self.zip_file is not None:
            return relative_path in self.zip_file.namelist()
        return (self.source / relative_path).exists()

    def read_text(self, relative_path: str) -> str:
        if self.zip_file is not None:
            return self.zip_file.read(relative_path).decode("utf-8")
        return (self.source / relative_path).read_text(encoding="utf-8")

    def read_json(self, relative_path: str):
        return json.loads(self.read_text(relative_path))


def normalize_names(items: list[str]) -> set[str]:
    return {item.lower() for item in items}


def should_process(doc_name: str, include: set[str], exclude: set[str]) -> bool:
    return (not include or doc_name.lower() in include) and doc_name.lower() not in exclude


def stable_id(prefix: str, *parts: object) -> str:
    digest = hashlib.sha1("|".join(str(p) for p in parts).encode("utf-8")).hexdigest()[:16]
    return f"{prefix}_{digest}"


def clean_text(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = GLYPH_RE.sub(" ", text)
    text = MULTISPACE_RE.sub(" ", text)
    text = BLANKLINE_RE.sub("\n\n", text)
    return text.strip()


def normalize_line(text: str) -> str:
    text = clean_text(text)
    return text.strip(" -\t")


def is_heading(text: str) -> bool:
    if not text:
        return False
    compact = text.strip()
    if len(compact) > 140:
        return False
    if compact.endswith(":"):
        return True
    letters = [ch for ch in compact if ch.isalpha()]
    if not letters:
        return False
    uppercase_ratio = sum(1 for ch in letters if ch.isupper()) / len(letters)
    return uppercase_ratio > 0.75 or compact.istitle()


def classify_text_block(text: str) -> str:
    lowered = text.lower().strip()
    if not lowered:
        return "unknown"
    for prefix in WARNING_PREFIXES:
        if lowered.startswith(prefix):
            if prefix in {"danger", "warning"}:
                return "warning"
            if prefix == "important":
                return "note"
            return prefix
    if STEP_RE.match(text):
        return "procedure_step"
    if is_heading(text):
        return "heading"
    if text.lstrip().startswith(("-", "*", "\u2022")):
        return "list_item"
    if " | " in text or "\t" in text:
        return "table_like"
    return "paragraph"


def infer_safety_flags(text: str) -> list[str]:
    lowered = text.lower()
    flags: list[str] = []
    if any(term in lowered for term in PPE_TERMS):
        flags.append("ppe")
    if any(term in lowered for term in INTERLOCK_TERMS):
        flags.append("interlock")
    if any(term in lowered for term in ALARM_TERMS):
        flags.append("alarm")
    if any(term in lowered for term in CHEMICAL_TERMS):
        flags.append("chemical")
    if any(word in lowered for word in ("danger", "warning", "caution")):
        flags.append("hazard_language")
    return sorted(set(flags))


def extract_equipment_tags(text: str) -> list[str]:
    return sorted(set(match.group(0) for match in EQUIPMENT_TAG_RE.finditer(text)))


def build_entity_candidates(document_name: str, chunk_id: str, block: CanonicalBlock) -> list[EntityCandidate]:
    candidates: list[EntityCandidate] = []
    text = block.text
    lowered = text.lower()

    for tag in extract_equipment_tags(text):
        candidates.append(
            EntityCandidate(
                entity_id=stable_id("entity", document_name, block.block_id, "equipment", tag),
                entity_type="equipment",
                name=tag,
                normalized_name=tag.lower(),
                page_number=block.page_number,
                block_id=block.block_id,
                chunk_id=chunk_id,
                confidence=0.85,
                evidence_text=text[:500],
            )
        )

    for model in MODEL_RE.finditer(text):
        token = model.group(0)
        if len(token) < 5 or token.lower() in {tag.lower() for tag in extract_equipment_tags(text)}:
            continue
        candidates.append(
            EntityCandidate(
                entity_id=stable_id("entity", document_name, block.block_id, "model", token),
                entity_type="model_number",
                name=token,
                normalized_name=token.lower(),
                page_number=block.page_number,
                block_id=block.block_id,
                chunk_id=chunk_id,
                confidence=0.55,
                evidence_text=text[:500],
            )
        )

    if "alarm" in lowered or "fault" in lowered:
        candidates.append(
            EntityCandidate(
                entity_id=stable_id("entity", document_name, block.block_id, "alarm", lowered[:80]),
                entity_type="alarm",
                name=text[:120],
                normalized_name=text[:120].lower(),
                page_number=block.page_number,
                block_id=block.block_id,
                chunk_id=chunk_id,
                confidence=0.5,
                evidence_text=text[:500],
            )
        )
    if "interlock" in lowered:
        candidates.append(
            EntityCandidate(
                entity_id=stable_id("entity", document_name, block.block_id, "interlock", lowered[:80]),
                entity_type="interlock",
                name=text[:120],
                normalized_name=text[:120].lower(),
                page_number=block.page_number,
                block_id=block.block_id,
                chunk_id=chunk_id,
                confidence=0.55,
                evidence_text=text[:500],
            )
        )
    if any(term in lowered for term in PPE_TERMS):
        candidates.append(
            EntityCandidate(
                entity_id=stable_id("entity", document_name, block.block_id, "ppe", lowered[:80]),
                entity_type="ppe",
                name=text[:120],
                normalized_name=text[:120].lower(),
                page_number=block.page_number,
                block_id=block.block_id,
                chunk_id=chunk_id,
                confidence=0.6,
                evidence_text=text[:500],
            )
        )
    return candidates


def normalize_native_blocks(document_name: str, manifest: dict, min_line_chars: int) -> list[CanonicalBlock]:
    blocks: list[CanonicalBlock] = []
    last_seen_on_page: dict[int, set[str]] = {}
    current_section: dict[int, str | None] = {}

    for page in manifest.get("pages", []):
        page_number = int(page["page_number"])
        source_classification = page.get("classification", "unknown")
        seen = last_seen_on_page.setdefault(page_number, set())
        current_section.setdefault(page_number, None)
        raw_text = page.get("raw_text") or ""
        reading_order = 0

        for line in clean_text(raw_text).splitlines():
            candidate = normalize_line(line)
            if len(candidate) < min_line_chars or PAGE_TAG_RE.match(candidate):
                continue
            fingerprint = candidate.lower()
            if fingerprint in seen:
                continue
            seen.add(fingerprint)
            block_type = classify_text_block(candidate)
            quality_flags: list[str] = []
            if any(ord(ch) > 127 for ch in candidate):
                quality_flags.append("non_ascii")
            if len(candidate) > 400:
                quality_flags.append("long_line")
            if block_type == "heading":
                current_section[page_number] = candidate[:255]
            reading_order += 1
            blocks.append(
                CanonicalBlock(
                    block_id=stable_id("block", document_name, page_number, reading_order, candidate[:120]),
                    page_number=page_number,
                    block_type=block_type,
                    section_title=current_section[page_number],
                    text=candidate,
                    reading_order=reading_order,
                    source="native" if not page.get("ocr_used") else "hybrid",
                    source_classification=source_classification,
                    quality_flags=quality_flags,
                )
            )
    return blocks


def normalize_ocr_blocks(document_name: str, ocr_pages: list[dict], existing_ids: set[str]) -> list[CanonicalBlock]:
    blocks: list[CanonicalBlock] = []
    current_section: dict[int, str | None] = {}

    for page in ocr_pages:
        page_number = int(page["page_number"])
        current_section.setdefault(page_number, None)
        for idx, raw_block in enumerate(page.get("blocks", []), start=1):
            text = normalize_line(raw_block.get("text") or "")
            if not text:
                continue
            block_type = classify_text_block(text)
            if block_type == "heading":
                current_section[page_number] = text[:255]
            bbox = raw_block.get("bbox")
            bbox_model = BoundingBox(**bbox) if bbox else None
            block_id = stable_id("block", document_name, page_number, "ocr", idx, text[:120])
            if block_id in existing_ids:
                continue
            existing_ids.add(block_id)
            flags: list[str] = []
            confidence = raw_block.get("confidence")
            if confidence is not None and float(confidence) < 0.8:
                flags.append("low_ocr_confidence")
            blocks.append(
                CanonicalBlock(
                    block_id=block_id,
                    page_number=page_number,
                    block_type=block_type,
                    section_title=current_section[page_number],
                    text=text,
                    bbox=bbox_model,
                    confidence=float(confidence) if confidence is not None else None,
                    reading_order=int(raw_block.get("reading_order") or idx),
                    source="ocr",
                    source_classification=page.get("classification", "unknown"),
                    quality_flags=flags,
                )
            )
    return blocks


def chunk_type_for(block_type: str) -> str:
    mapping = {
        "warning": "warning",
        "caution": "warning",
        "note": "notes",
        "procedure_step": "procedure",
        "table_like": "table_like",
    }
    return mapping.get(block_type, "section")


def finalize_chunk(document_name: str, chunk_index: int, blocks: list[CanonicalBlock]) -> CanonicalChunk:
    page_numbers = [block.page_number for block in blocks]
    content = "\n".join(block.text for block in blocks).strip()
    content = clean_text(content)
    section_title = next((block.section_title for block in blocks if block.section_title), None)
    bbox_refs = [block.bbox for block in blocks if block.bbox is not None]
    safety_flags = sorted({flag for block in blocks for flag in infer_safety_flags(block.text)})
    equipment_tags = sorted({tag for block in blocks for tag in extract_equipment_tags(block.text)})
    chunk_type = chunk_type_for(blocks[0].block_type)
    quality_flags = sorted({flag for block in blocks for flag in block.quality_flags})
    citation = f"{document_name} p.{min(page_numbers)}"
    if min(page_numbers) != max(page_numbers):
        citation = f"{document_name} pp.{min(page_numbers)}-{max(page_numbers)}"
    return CanonicalChunk(
        chunk_id=stable_id("chunk", document_name, chunk_index, content[:160]),
        chunk_index=chunk_index,
        chunk_type=chunk_type,
        content=content,
        citation_label=citation,
        page_start=min(page_numbers),
        page_end=max(page_numbers),
        section_title=section_title,
        block_ids=[block.block_id for block in blocks],
        equipment_tags=equipment_tags,
        safety_flags=safety_flags,
        bbox_references=bbox_refs,
        token_estimate=max(1, len(content.split())),
        quality_flags=quality_flags,
    )


def merge_chunk_pair(document_name: str, chunk_index: int, left: CanonicalChunk, right: CanonicalChunk) -> CanonicalChunk:
    blocks = []
    for chunk in (left, right):
        pseudo_block = CanonicalBlock(
            block_id=stable_id("merged", document_name, chunk.chunk_id),
            page_number=chunk.page_start,
            block_type="heading" if chunk.chunk_type == "section" and chunk.token_estimate < 20 else "paragraph",
            section_title=chunk.section_title,
            text=chunk.content,
            reading_order=chunk.chunk_index,
            quality_flags=chunk.quality_flags,
        )
        blocks.append(pseudo_block)
    merged = finalize_chunk(document_name, chunk_index, blocks)
    merged.block_ids = left.block_ids + right.block_ids
    merged.equipment_tags = sorted(set(left.equipment_tags + right.equipment_tags))
    merged.safety_flags = sorted(set(left.safety_flags + right.safety_flags))
    merged.bbox_references = left.bbox_references + right.bbox_references
    merged.quality_flags = sorted(set(left.quality_flags + right.quality_flags))
    merged.page_start = min(left.page_start, right.page_start)
    merged.page_end = max(left.page_end, right.page_end)
    return merged


def compress_chunks(document_name: str, chunks: list[CanonicalChunk]) -> list[CanonicalChunk]:
    if not chunks:
        return chunks

    compressed: list[CanonicalChunk] = []
    cursor = 0
    next_index = 1
    while cursor < len(chunks):
        current = chunks[cursor]
        should_merge = (
            cursor + 1 < len(chunks)
            and current.chunk_type == "section"
            and current.token_estimate < 20
            and len(current.content) < 120
        )
        if should_merge:
            merged = merge_chunk_pair(document_name, next_index, current, chunks[cursor + 1])
            compressed.append(merged)
            cursor += 2
        else:
            current.chunk_index = next_index
            compressed.append(current)
            cursor += 1
        next_index += 1
    return compressed


def build_chunks(document_name: str, blocks: list[CanonicalBlock], max_chunk_chars: int) -> list[CanonicalChunk]:
    chunks: list[CanonicalChunk] = []
    current: list[CanonicalBlock] = []
    chunk_index = 1

    ordered = sorted(blocks, key=lambda block: (block.page_number, block.reading_order, block.block_id))
    for block in ordered:
        if not current:
            current = [block]
            continue

        current_len = sum(len(item.text) for item in current)
        boundary = False
        if block.block_type in {"heading", "warning", "caution", "note"} and current:
            boundary = True
        if current[-1].page_number != block.page_number and current_len > 600:
            boundary = True
        if current_len + len(block.text) > max_chunk_chars:
            boundary = True
        if current[-1].block_type != block.block_type and block.block_type in {"procedure_step", "table_like"}:
            boundary = True

        if boundary:
            chunks.append(finalize_chunk(document_name, chunk_index, current))
            chunk_index += 1
            current = [block]
        else:
            current.append(block)

    if current:
        chunks.append(finalize_chunk(document_name, chunk_index, current))
    return compress_chunks(document_name, chunks)


def load_manifest_and_ocr(store: ArtifactStore, doc_name: str) -> tuple[dict, list[dict]]:
    manifest = store.read_json(f"{doc_name}/manifest.json")
    ocr_path = f"{doc_name}/{doc_name}.ocr.json"
    ocr_pages = store.read_json(ocr_path) if store.has_file(ocr_path) else []
    return manifest, ocr_pages


def build_bundle(doc_name: str, manifest: dict, ocr_pages: list[dict], min_line_chars: int, max_chunk_chars: int) -> CanonicalDocumentBundle:
    native_blocks = normalize_native_blocks(doc_name, manifest, min_line_chars=min_line_chars)
    existing_ids = {block.block_id for block in native_blocks}
    ocr_blocks = normalize_ocr_blocks(doc_name, ocr_pages, existing_ids=existing_ids)
    all_blocks = sorted(native_blocks + ocr_blocks, key=lambda block: (block.page_number, block.reading_order, block.block_id))
    chunks = build_chunks(doc_name, all_blocks, max_chunk_chars=max_chunk_chars)

    entity_candidates: list[EntityCandidate] = []
    block_map = {block.block_id: block for block in all_blocks}
    for chunk in chunks:
        for block_id in chunk.block_ids:
            block = block_map[block_id]
            entity_candidates.extend(build_entity_candidates(doc_name, chunk.chunk_id, block))

    quality_counter = Counter(flag for block in all_blocks for flag in block.quality_flags)
    quality_counter.update(flag for chunk in chunks for flag in chunk.quality_flags)
    quality_summary = {
        "page_count": manifest.get("page_count", 0),
        "native_block_count": len(native_blocks),
        "ocr_block_count": len(ocr_blocks),
        "ocr_used_pages": sum(1 for page in manifest.get("pages", []) if page.get("ocr_used")),
        "low_ocr_confidence_blocks": quality_counter.get("low_ocr_confidence", 0),
    }

    return CanonicalDocumentBundle(
        document_name=doc_name,
        source_pdf=manifest.get("source_pdf", ""),
        classification=manifest.get("classification", "unknown"),
        page_count=int(manifest.get("page_count", 0)),
        total_text_chars=int(manifest.get("total_text_chars", 0)),
        block_count=len(all_blocks),
        chunk_count=len(chunks),
        generated_at=datetime.now(UTC),
        blocks=all_blocks,
        chunks=chunks,
        entity_candidates=entity_candidates,
        quality_summary=quality_summary,
    )


def write_bundle(output_dir: Path, bundle: CanonicalDocumentBundle):
    doc_dir = output_dir / bundle.document_name
    doc_dir.mkdir(parents=True, exist_ok=True)
    (doc_dir / "canonical_bundle.json").write_text(bundle.model_dump_json(indent=2), encoding="utf-8")
    (doc_dir / "canonical_chunks.jsonl").write_text(
        "\n".join(chunk.model_dump_json() for chunk in bundle.chunks) + ("\n" if bundle.chunks else ""),
        encoding="utf-8",
    )
    (doc_dir / "entity_candidates.jsonl").write_text(
        "\n".join(entity.model_dump_json() for entity in bundle.entity_candidates) + ("\n" if bundle.entity_candidates else ""),
        encoding="utf-8",
    )


def main():
    args = parse_args()
    source = Path(args.input).resolve()
    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    include = normalize_names(args.include)
    exclude = normalize_names(args.exclude)

    store = ArtifactStore(source)
    try:
        summary = CanonicalCorpusSummary(
            generated_at=datetime.now(UTC),
            source_directory=str(source),
            output_directory=str(output_dir),
        )

        for doc_name in store.list_docs():
            if not should_process(doc_name, include, exclude):
                print(f"[skip] {doc_name}")
                continue
            print(f"[normalize] {doc_name}")
            manifest, ocr_pages = load_manifest_and_ocr(store, doc_name)
            bundle = build_bundle(
                doc_name=doc_name,
                manifest=manifest,
                ocr_pages=ocr_pages,
                min_line_chars=args.min_line_chars,
                max_chunk_chars=args.max_chunk_chars,
            )
            write_bundle(output_dir, bundle)

            summary.document_count += 1
            summary.page_count += bundle.page_count
            summary.block_count += bundle.block_count
            summary.chunk_count += bundle.chunk_count
            summary.entity_candidate_count += len(bundle.entity_candidates)
            summary.classification_counts[bundle.classification] = summary.classification_counts.get(bundle.classification, 0) + 1
            for flag, count in bundle.quality_summary.items():
                if isinstance(count, int):
                    summary.quality_counters[flag] = summary.quality_counters.get(flag, 0) + count

        (output_dir / "canonical_summary.json").write_text(summary.model_dump_json(indent=2), encoding="utf-8")
        print(f"[done] wrote canonical summary to {output_dir / 'canonical_summary.json'}")
    finally:
        store.close()


if __name__ == "__main__":
    main()
