import argparse
import json
import sys
import uuid
from collections import defaultdict
from pathlib import Path
from typing import Iterable
from zipfile import ZipFile

from sqlalchemy import text


REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT / "backend") not in sys.path:
    sys.path.insert(0, str(REPO_ROOT / "backend"))

from app.db.neo4j import get_driver
from app.db.postgres import check_postgres_connection, engine
from app.core.config import get_settings
from app.services.graph_service import bootstrap_knowledge_graph


UUID_NAMESPACE = uuid.UUID("6a01fc2f-5cfd-46c5-99dd-b381f3d40511")

ENTITY_LABELS = {
    "equipment": "Equipment",
    "instrument_tag": "InstrumentTag",
    "alarm": "Alarm",
    "interlock": "Interlock",
    "safety_rule": "SafetyRule",
    "chemical": "Chemical",
    "ppe": "PPE",
    "model_number": "ModelNumber",
}


def parse_args():
    parser = argparse.ArgumentParser(
        description="Load Stage 1 canonical assets into Supabase(Postgres/pgvector) and Neo4j with idempotent upserts.",
    )
    parser.add_argument("--canonical-dir", default=str(REPO_ROOT / "stage1_outputs" / "canonical"))
    parser.add_argument("--retrieval-dir", default=str(REPO_ROOT / "stage1_outputs" / "retrieval_assets"))
    parser.add_argument("--extraction-archive", default=str(REPO_ROOT / "kaggle_manuals_final.zip"))
    parser.add_argument("--batch-size", type=int, default=500)
    parser.add_argument("--skip-postgres", action="store_true")
    parser.add_argument("--skip-neo4j", action="store_true")
    parser.add_argument("--skip-pages-blocks", action="store_true")
    parser.add_argument("--skip-embeddings", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def deterministic_uuid(*parts: object) -> str:
    source = "|".join(str(part) for part in parts)
    return str(uuid.uuid5(UUID_NAMESPACE, source))


def sanitize_text(value: str | None) -> str | None:
    if value is None:
        return None
    return value.replace("\x00", "")


def batched(rows: list[dict], batch_size: int) -> Iterable[list[dict]]:
    for idx in range(0, len(rows), batch_size):
        yield rows[idx : idx + batch_size]


def list_doc_names(canonical_dir: Path) -> list[str]:
    return sorted(path.name for path in canonical_dir.iterdir() if path.is_dir())


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def iter_jsonl(path: Path):
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        yield json.loads(line)


class ExtractionManifestStore:
    def __init__(self, source_path: Path):
        self.source_path = source_path
        self.zip_file: ZipFile | None = None
        if source_path.suffix.lower() == ".zip":
            self.zip_file = ZipFile(source_path)

    def close(self):
        if self.zip_file is not None:
            self.zip_file.close()

    def load_manifest(self, doc_name: str) -> dict:
        relative = f"{doc_name}/manifest.json"
        if self.zip_file is not None:
            return json.loads(self.zip_file.read(relative).decode("utf-8"))
        return json.loads((self.source_path / relative).read_text(encoding="utf-8"))


def connect_check():
    pg = check_postgres_connection()
    driver = get_driver()
    driver.verify_connectivity()
    return pg


def configure_postgres_session(conn):
    conn.execute(text("SET statement_timeout TO 0"))
    conn.execute(text("SET lock_timeout TO 0"))
    conn.execute(text("SET idle_in_transaction_session_timeout TO 0"))


def upsert_document_and_revision(conn, doc_name: str, bundle: dict) -> tuple[str, str]:
    document_id = deterministic_uuid("document", doc_name)
    revision_id = deterministic_uuid("revision", doc_name, "stage1")
    source_filename = Path(bundle.get("source_pdf") or f"{doc_name}.pdf").name

    conn.execute(
        text(
            """
            INSERT INTO documents (
                id, code, title, document_type, department_name, source_filename, is_active
            )
            VALUES (
                CAST(:id AS uuid), :code, :title, :document_type, :department_name, :source_filename, true
            )
            ON CONFLICT (id) DO UPDATE SET
                code = EXCLUDED.code,
                title = EXCLUDED.title,
                document_type = EXCLUDED.document_type,
                department_name = EXCLUDED.department_name,
                source_filename = EXCLUDED.source_filename,
                updated_at = now()
            """
        ),
        {
            "id": document_id,
            "code": doc_name,
            "title": doc_name,
            "document_type": "equipment_manual",
            "department_name": "operations",
            "source_filename": source_filename,
        },
    )

    conn.execute(
        text(
            """
            INSERT INTO document_revisions (
                id, document_id, revision_label, version_number, approval_status,
                is_latest_approved, file_path, page_count, extraction_classification, extraction_status
            )
            VALUES (
                CAST(:id AS uuid), CAST(:document_id AS uuid), :revision_label, 1, :approval_status,
                true, :file_path, :page_count, :extraction_classification, :extraction_status
            )
            ON CONFLICT (id) DO UPDATE SET
                revision_label = EXCLUDED.revision_label,
                approval_status = EXCLUDED.approval_status,
                is_latest_approved = EXCLUDED.is_latest_approved,
                file_path = EXCLUDED.file_path,
                page_count = EXCLUDED.page_count,
                extraction_classification = EXCLUDED.extraction_classification,
                extraction_status = EXCLUDED.extraction_status,
                updated_at = now()
            """
        ),
        {
            "id": revision_id,
            "document_id": document_id,
            "revision_label": "stage1-v1",
            "approval_status": "approved",
            "file_path": bundle.get("source_pdf") or "",
            "page_count": int(bundle.get("page_count", 0)),
            "extraction_classification": bundle.get("classification", "unknown"),
            "extraction_status": "success",
        },
    )
    return document_id, revision_id


def upsert_pages(conn, revision_id: str, manifest: dict, batch_size: int) -> dict[int, str]:
    rows = []
    page_id_map: dict[int, str] = {}
    for page in manifest.get("pages", []):
        page_number = int(page["page_number"])
        page_id = deterministic_uuid("page", revision_id, page_number)
        page_id_map[page_number] = page_id
        rows.append(
            {
                "id": page_id,
                "revision_id": revision_id,
                "page_number": page_number,
                "classification": page.get("classification", "unknown"),
                "extracted_text_chars": int(page.get("extracted_text_chars") or 0),
                "raw_text": sanitize_text(page.get("raw_text")),
                "markdown_path": sanitize_text(page.get("markdown_path")),
                "image_path": sanitize_text(page.get("image_path")),
                "ocr_used": bool(page.get("ocr_used", False)),
                "ocr_confidence": page.get("ocr_confidence"),
            }
        )

    statement = text(
        """
        INSERT INTO extracted_pages (
            id, revision_id, page_number, classification, extracted_text_chars,
            raw_text, markdown_path, image_path, ocr_used, ocr_confidence
        )
        VALUES (
            CAST(:id AS uuid), CAST(:revision_id AS uuid), :page_number, :classification,
            :extracted_text_chars, :raw_text, :markdown_path, :image_path, :ocr_used, :ocr_confidence
        )
        ON CONFLICT (id) DO UPDATE SET
            classification = EXCLUDED.classification,
            extracted_text_chars = EXCLUDED.extracted_text_chars,
            raw_text = EXCLUDED.raw_text,
            markdown_path = EXCLUDED.markdown_path,
            image_path = EXCLUDED.image_path,
            ocr_used = EXCLUDED.ocr_used,
            ocr_confidence = EXCLUDED.ocr_confidence
        """
    )
    for chunk in batched(rows, batch_size):
        conn.execute(statement, chunk)
    return page_id_map


def upsert_blocks(conn, doc_name: str, bundle: dict, page_id_map: dict[int, str], batch_size: int):
    rows = []
    for block in bundle.get("blocks", []):
        page_number = int(block["page_number"])
        page_id = page_id_map.get(page_number)
        if not page_id:
            continue
        bbox = block.get("bbox") or {}
        rows.append(
            {
                "id": deterministic_uuid("block", doc_name, block["block_id"]),
                "page_id": page_id,
                "block_type": block.get("block_type", "unknown"),
                "section_title": sanitize_text(block.get("section_title")),
                "text": sanitize_text(block.get("text", "")),
                "bbox_left": bbox.get("left"),
                "bbox_top": bbox.get("top"),
                "bbox_right": bbox.get("right"),
                "bbox_bottom": bbox.get("bottom"),
                "confidence": block.get("confidence"),
                "reading_order": int(block.get("reading_order") or 0),
            }
        )

    statement = text(
        """
        INSERT INTO extracted_blocks (
            id, page_id, block_type, section_title, text, bbox_left, bbox_top, bbox_right, bbox_bottom, confidence, reading_order
        )
        VALUES (
            CAST(:id AS uuid), CAST(:page_id AS uuid), :block_type, :section_title, :text,
            :bbox_left, :bbox_top, :bbox_right, :bbox_bottom, :confidence, :reading_order
        )
        ON CONFLICT (id) DO UPDATE SET
            block_type = EXCLUDED.block_type,
            section_title = EXCLUDED.section_title,
            text = EXCLUDED.text,
            bbox_left = EXCLUDED.bbox_left,
            bbox_top = EXCLUDED.bbox_top,
            bbox_right = EXCLUDED.bbox_right,
            bbox_bottom = EXCLUDED.bbox_bottom,
            confidence = EXCLUDED.confidence,
            reading_order = EXCLUDED.reading_order
        """
    )
    for chunk in batched(rows, batch_size):
        conn.execute(statement, chunk)


def upsert_chunks(conn, doc_name: str, revision_id: str, canonical_dir: Path, batch_size: int):
    rows = []
    for chunk in iter_jsonl(canonical_dir / doc_name / "canonical_chunks.jsonl"):
        rows.append(
            {
                "id": deterministic_uuid("chunk", chunk["chunk_id"]),
                "revision_id": revision_id,
                "chunk_index": int(chunk["chunk_index"]),
                "chunk_type": chunk.get("chunk_type", "section"),
                "page_start": int(chunk.get("page_start") or 0),
                "page_end": int(chunk.get("page_end") or 0),
                "section_title": sanitize_text(chunk.get("section_title")),
                "citation_label": sanitize_text(chunk.get("citation_label")),
                "content": sanitize_text(chunk.get("content", "")),
                "equipment_tags": json.dumps(chunk.get("equipment_tags") or []),
                "safety_flags": json.dumps(chunk.get("safety_flags") or []),
                "block_ids": json.dumps(chunk.get("block_ids") or []),
            }
        )

    statement = text(
        """
        INSERT INTO document_chunks (
            id, revision_id, chunk_index, chunk_type, page_start, page_end, section_title,
            citation_label, content, equipment_tags, safety_flags, block_ids
        )
        VALUES (
            CAST(:id AS uuid), CAST(:revision_id AS uuid), :chunk_index, :chunk_type, :page_start, :page_end,
            :section_title, :citation_label, :content,
            CAST(:equipment_tags AS jsonb), CAST(:safety_flags AS jsonb), CAST(:block_ids AS jsonb)
        )
        ON CONFLICT (id) DO UPDATE SET
            chunk_index = EXCLUDED.chunk_index,
            chunk_type = EXCLUDED.chunk_type,
            page_start = EXCLUDED.page_start,
            page_end = EXCLUDED.page_end,
            section_title = EXCLUDED.section_title,
            citation_label = EXCLUDED.citation_label,
            content = EXCLUDED.content,
            equipment_tags = EXCLUDED.equipment_tags,
            safety_flags = EXCLUDED.safety_flags,
            block_ids = EXCLUDED.block_ids
        """
    )
    for chunk_rows in batched(rows, batch_size):
        conn.execute(statement, chunk_rows)


def load_embeddings(conn, retrieval_dir: Path, batch_size: int):
    staging_table = "stage1_chunk_embedding_staging"
    conn.execute(text(f"CREATE TABLE IF NOT EXISTS {staging_table} (id uuid PRIMARY KEY, embedding vector(384));"))
    conn.execute(text(f"TRUNCATE {staging_table};"))

    insert_stmt = text(
        f"""
        INSERT INTO {staging_table} (id, embedding)
        VALUES (CAST(:id AS uuid), CAST(:embedding AS vector))
        ON CONFLICT (id) DO UPDATE SET embedding = EXCLUDED.embedding
        """
    )
    rows = []
    for record in iter_jsonl(retrieval_dir / "embedding_records.jsonl"):
        vector = record["vector"]
        vector_text = "[" + ",".join(f"{float(v):.8f}" for v in vector) + "]"
        rows.append(
            {
                "id": deterministic_uuid("chunk", record["chunk_id"]),
                "embedding": vector_text,
            }
        )
        if len(rows) >= batch_size:
            conn.execute(insert_stmt, rows)
            rows = []
    if rows:
        conn.execute(insert_stmt, rows)

    conn.execute(
        text(
            f"""
            UPDATE document_chunks dc
            SET embedding = s.embedding
            FROM {staging_table} s
            WHERE dc.id = s.id
            """
        )
    )


def neo4j_seed_documents_and_chunks(doc_name: str, doc_id: str, rev_id: str, canonical_dir: Path):
    chunk_rows = []
    for chunk in iter_jsonl(canonical_dir / doc_name / "canonical_chunks.jsonl"):
        chunk_rows.append(
            {
                "id": deterministic_uuid("chunk", chunk["chunk_id"]),
                "source_chunk_id": chunk["chunk_id"],
                "doc_name": doc_name,
                "chunk_index": int(chunk["chunk_index"]),
                "chunk_type": chunk.get("chunk_type", "section"),
                "page_start": int(chunk.get("page_start") or 0),
                "page_end": int(chunk.get("page_end") or 0),
                "citation_label": chunk.get("citation_label"),
            }
        )
    return {
        "doc_id": doc_id,
        "rev_id": rev_id,
        "doc_name": doc_name,
        "chunks": chunk_rows,
    }


def neo4j_seed_entities(doc_name: str, canonical_dir: Path):
    grouped = defaultdict(list)
    for entity in iter_jsonl(canonical_dir / doc_name / "entity_candidates.jsonl"):
        label = ENTITY_LABELS.get(entity.get("entity_type"), "DomainEntity")
        grouped[label].append(
            {
                "entity_id": deterministic_uuid("entity", entity["entity_id"]),
                "source_entity_id": entity["entity_id"],
                "name": entity.get("name"),
                "normalized_name": entity.get("normalized_name"),
                "page_number": int(entity.get("page_number") or 0),
                "confidence": float(entity.get("confidence") or 0),
                "chunk_node_id": deterministic_uuid("chunk", entity["chunk_id"]),
                "source_chunk_id": entity.get("chunk_id"),
                "evidence_text": sanitize_text((entity.get("evidence_text") or "")[:2000]),
            }
        )
    return grouped


def load_to_neo4j(canonical_dir: Path, doc_names: list[str], dry_run: bool):
    if dry_run:
        return

    bootstrap_knowledge_graph()
    driver = get_driver()
    settings = get_settings()
    with driver.session(database=settings.NEO4J_DATABASE) as session:
        for doc_name in doc_names:
            bundle = load_json(canonical_dir / doc_name / "canonical_bundle.json")
            doc_id = deterministic_uuid("document", doc_name)
            rev_id = deterministic_uuid("revision", doc_name, "stage1")
            payload = neo4j_seed_documents_and_chunks(doc_name, doc_id, rev_id, canonical_dir)

            session.run(
                """
                MERGE (d:Document {id: $doc_id})
                SET d.code = $doc_name,
                    d.title = $doc_name,
                    d.document_type = 'equipment_manual',
                    d.updated_at = datetime()
                MERGE (r:DocumentRevision {id: $rev_id})
                SET r.revision_label = 'stage1-v1',
                    r.classification = $classification,
                    r.page_count = $page_count,
                    r.updated_at = datetime()
                MERGE (d)-[:HAS_REVISION]->(r)
                """,
                {
                    "doc_id": payload["doc_id"],
                    "rev_id": payload["rev_id"],
                    "doc_name": payload["doc_name"],
                    "classification": bundle.get("classification", "unknown"),
                    "page_count": int(bundle.get("page_count", 0)),
                },
            ).consume()

            session.run(
                """
                UNWIND $rows AS row
                MERGE (c:DocumentChunk {id: row.id})
                SET c.source_chunk_id = row.source_chunk_id,
                    c.document_name = row.doc_name,
                    c.chunk_index = row.chunk_index,
                    c.chunk_type = row.chunk_type,
                    c.page_start = row.page_start,
                    c.page_end = row.page_end,
                    c.citation_label = row.citation_label,
                    c.updated_at = datetime()
                WITH c
                MATCH (r:DocumentRevision {id: $rev_id})
                MERGE (r)-[:HAS_CHUNK]->(c)
                """,
                {"rows": payload["chunks"], "rev_id": payload["rev_id"]},
            ).consume()

            entity_groups = neo4j_seed_entities(doc_name, canonical_dir)
            for label, rows in entity_groups.items():
                session.run(
                    f"""
                    UNWIND $rows AS row
                    MERGE (e:{label} {{id: row.entity_id}})
                    SET e.source_entity_id = row.source_entity_id,
                        e.name = row.name,
                        e.normalized_name = row.normalized_name,
                        e.updated_at = datetime()
                    WITH e, row
                    MATCH (c:DocumentChunk {{id: row.chunk_node_id}})
                    MERGE (c)-[rel:REFERENCES]->(e)
                    SET rel.confidence = row.confidence,
                        rel.source_chunk_id = row.source_chunk_id,
                        rel.source_page_number = row.page_number,
                        rel.evidence_text = row.evidence_text,
                        rel.updated_at = datetime()
                    """,
                    {"rows": rows},
                ).consume()


def main():
    args = parse_args()
    canonical_dir = Path(args.canonical_dir).resolve()
    retrieval_dir = Path(args.retrieval_dir).resolve()
    extraction_archive = Path(args.extraction_archive).resolve()
    doc_names = list_doc_names(canonical_dir)
    
    manifest_store = None
    if extraction_archive.exists():
        manifest_store = ExtractionManifestStore(extraction_archive)
    else:
        if not args.skip_postgres:
            print(f"[warn] extraction archive not found: {extraction_archive}")
            print("[warn] --skip-postgres flag required when extraction archive is missing")
            return
        print("[info] extraction archive not found, skipping manifest-dependent features")

    if args.dry_run:
        try:
            for doc_name in doc_names:
                bundle = load_json(canonical_dir / doc_name / "canonical_bundle.json")
                manifest = manifest_store.load_manifest(doc_name)
                print(
                    f"[dry-run] {doc_name}: pages={manifest.get('page_count', 0)} "
                    f"blocks={bundle.get('block_count', 0)} chunks={bundle.get('chunk_count', 0)} "
                    f"entities={len(list(iter_jsonl(canonical_dir / doc_name / 'entity_candidates.jsonl')))}"
                )
            print("[done] dry-run completed without datastore connections")
        finally:
            if manifest_store:
                manifest_store.close()
        return

    if not args.skip_postgres:
        pg_info = connect_check()
        print(f"[postgres] connected host={pg_info['host']} db={pg_info['database']}")
    else:
        print("[postgres] skipped by flag")

    try:
        if not args.skip_postgres:
            for doc_name in doc_names:
                with engine.begin() as conn:
                    configure_postgres_session(conn)
                    bundle = load_json(canonical_dir / doc_name / "canonical_bundle.json")
                    manifest = manifest_store.load_manifest(doc_name)
                    _, revision_id = upsert_document_and_revision(conn, doc_name, bundle)
                    page_id_map = upsert_pages(conn, revision_id, manifest, args.batch_size)
                    if not args.skip_pages_blocks:
                        upsert_blocks(conn, doc_name, bundle, page_id_map, args.batch_size)
                    upsert_chunks(conn, doc_name, revision_id, canonical_dir, args.batch_size)
                print(f"[postgres] loaded {doc_name}")

            if not args.skip_embeddings:
                with engine.begin() as conn:
                    configure_postgres_session(conn)
                    load_embeddings(conn, retrieval_dir, max(20, min(100, args.batch_size // 5)))
                print("[postgres] embeddings updated from retrieval assets")

        if not args.skip_neo4j:
            load_to_neo4j(canonical_dir, doc_names, args.dry_run)
            print("[neo4j] ontology and provenance graph load complete")

        print("[done] stage1 datastore load complete")
    finally:
        if manifest_store:
            manifest_store.close()


if __name__ == "__main__":
    main()
