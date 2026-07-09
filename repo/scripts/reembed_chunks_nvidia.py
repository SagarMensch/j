"""
Re-embed all document_chunks using NVIDIA nv-embedqa-e5-v5.

Usage:
    python reembed_chunks_nvidia.py --dry-run
    python reembed_chunks_nvidia.py
    python reembed_chunks_nvidia.py --batch-size 32 --limit 500
"""
import argparse
import json
import sys
import time
from pathlib import Path

from sqlalchemy import text


REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT / "backend") not in sys.path:
    sys.path.insert(0, str(REPO_ROOT / "backend"))

from app.core.config import get_settings
from app.db.postgres import engine


SELECT_CHUNKS_SQL = text("""
    SELECT
        dc.id::text AS chunk_id,
        dc.content,
        dc.section_title,
        dc.citation_label,
        dc.revision_id::text AS revision_id
    FROM document_chunks dc
    JOIN document_revisions dr ON dc.revision_id = dr.id
    WHERE dr.is_latest_approved = true
      AND dc.content IS NOT NULL
      AND length(dc.content) > 30
      AND dc.embedding IS NULL
    ORDER BY dc.id
    LIMIT :limit OFFSET :offset
""")


COUNT_CHUNKS_SQL = text("""
    SELECT COUNT(*) AS total
    FROM document_chunks dc
    JOIN document_revisions dr ON dc.revision_id = dr.id
    WHERE dr.is_latest_approved = true
      AND dc.content IS NOT NULL
      AND length(dc.content) > 30
      AND dc.embedding IS NULL
""")


UPDATE_EMBEDDING_SQL = text("""
    UPDATE document_chunks
    SET embedding = CAST(:embedding AS vector)
    WHERE id = CAST(:chunk_id AS uuid)
""")


CREATE_INDEX_SQL = text("""
    CREATE INDEX IF NOT EXISTS idx_document_chunks_embedding_hnsw
    ON document_chunks
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 200)
""")


ALTER_COLUMN_SQL = text("""
    ALTER TABLE document_chunks
    ALTER COLUMN embedding TYPE vector(1024)
""")


DROP_OLD_INDEX_SQL = text("""
    DROP INDEX IF EXISTS idx_document_chunks_embedding_ivfflat
""")


DROP_HNSW_INDEX_SQL = text("""
    DROP INDEX IF EXISTS idx_document_chunks_embedding_hnsw
""")


CLEAR_OLD_EMBEDDINGS_SQL = text("""
    UPDATE document_chunks SET embedding = NULL WHERE embedding IS NOT NULL
""")


def parse_args():
    parser = argparse.ArgumentParser(description="Re-embed all chunks with NVIDIA nv-embedqa-e5-v5")
    parser.add_argument("--batch-size", type=int, default=32, help="API batch size")
    parser.add_argument("--limit", type=int, default=0, help="Limit chunks (0 = all)")
    parser.add_argument("--offset", type=int, default=0, help="Start offset")
    parser.add_argument("--dry-run", action="store_true", help="Show counts only")
    parser.add_argument("--create-hnsw", action="store_true", help="Create HNSW index after embedding")
    parser.add_argument("--skip-prep", action="store_true", help="Skip DB preparation (column resize etc)")
    return parser.parse_args()


def get_total_chunks():
    with engine.connect() as conn:
        result = conn.execute(COUNT_CHUNKS_SQL).mappings().one()
        return int(result["total"])


def fetch_chunks(limit: int, offset: int):
    with engine.connect() as conn:
        rows = conn.execute(
            SELECT_CHUNKS_SQL, {"limit": limit, "offset": offset}
        ).mappings().all()
        return [dict(row) for row in rows]


def build_passage(content: str, section_title: str | None, citation_label: str | None) -> str:
    # 512 tokens ~ 380 chars for e5 tokenizer. Reserve 40 tokens for section+citation.
    MAX_CONTENT_CHARS = 300
    parts = []
    if section_title:
        parts.append(section_title[:100])
    if citation_label:
        parts.append(citation_label[:50])
    if content:
        parts.append(content[:MAX_CONTENT_CHARS])
    return " ".join(p for p in parts if p)


def embed_batch_nvidia(passages: list[str], settings, input_type: str = "passage", max_retries: int = 3) -> list[list[float]] | None:
    import httpx

    for attempt in range(max_retries):
        try:
            with httpx.Client(timeout=60.0) as client:
                payload = {
                    "model": settings.NVIDIA_EMBED_MODEL,
                    "input": passages,
                    "input_type": input_type,
                    "encoding_format": "float",
                }
                response = client.post(
                    settings.NVIDIA_API_BASE_URL.rstrip("/") + "/embeddings",
                    headers={
                        "Authorization": f"Bearer {settings.NVIDIA_EMBED_API_KEY}",
                        "Content-Type": "application/json",
                    },
                    json=payload,
                )
                if response.status_code == 400:
                    error_detail = response.text[:300]
                    if attempt < max_retries - 1:
                        time.sleep(1.0 * (attempt + 1))
                        continue
                    print(f"  [error] 400 after {max_retries} attempts: {error_detail}")
                    return None
                response.raise_for_status()
                data = response.json().get("data", [])
                ordered = sorted(data, key=lambda x: int(x.get("index", 0)))
                embeddings = [item["embedding"] for item in ordered]
                if len(embeddings) == len(passages):
                    return embeddings
                return None
        except Exception as e:
            if attempt < max_retries - 1:
                time.sleep(1.0 * (attempt + 1))
                continue
            print(f"  [error] NVIDIA API call failed: {e}")
            return None
    return None


def vector_literal(vector: list[float]) -> str:
    return "[" + ",".join(f"{float(v):.8f}" for v in vector) + "]"


def main():
    args = parse_args()
    settings = get_settings()

    total = get_total_chunks()
    limit = args.limit if args.limit > 0 else total
    print(f"Total chunks to embed: {total}")
    print(f"Processing: limit={limit}, offset={args.offset}, batch_size={args.batch_size}")
    print(f"Embedding model: {settings.NVIDIA_EMBED_MODEL}")
    print(f"NVIDIA API base: {settings.NVIDIA_API_BASE_URL}")
    print(f"NVIDIA API key: {'set' if settings.NVIDIA_EMBED_API_KEY else 'MISSING'}")

    if args.dry_run:
        return

    if not settings.NVIDIA_EMBED_API_KEY:
        print("[fatal] NVIDIA_EMBED_API_KEY is not set. Aborting.")
        sys.exit(1)

    if not args.skip_prep:
        print("\nStep 1: Preparing database (dropping old index, resizing column)...")
        with engine.begin() as conn:
            conn.execute(DROP_OLD_INDEX_SQL)
            print("  Dropped old IVFFlat index")
        with engine.begin() as conn:
            conn.execute(DROP_HNSW_INDEX_SQL)
            print("  Dropped old HNSW index (if any)")
        with engine.begin() as conn:
            conn.execute(CLEAR_OLD_EMBEDDINGS_SQL)
            print("  Cleared old embeddings")
        with engine.begin() as conn:
            conn.execute(ALTER_COLUMN_SQL)
            print("  Resized embedding column to vector(1024)")
    else:
        print("\nStep 1: Skipping DB preparation (--skip-prep)")

    print("\nStep 2: Generating embeddings with NVIDIA nv-embedqa-e5-v5...")
    processed = 0
    failed = 0
    start_time = time.perf_counter()

    for batch_offset in range(args.offset, args.offset + limit, args.batch_size):
        batch_limit = min(args.batch_size, limit - (batch_offset - args.offset))
        chunks = fetch_chunks(batch_limit, batch_offset)
        if not chunks:
            break

        passages = [
            build_passage(c["content"], c.get("section_title"), c.get("citation_label"))
            for c in chunks
        ]

        embeddings = embed_batch_nvidia(passages, settings)
        if embeddings is None:
            print(f"  [warn] Batch at offset {batch_offset} failed, trying individual items...")
            individual_ok = 0
            individual_fail = 0
            embeddings = []
            for i, (chunk, passage) in enumerate(zip(chunks, passages)):
                single = embed_batch_nvidia([passage], settings)
                if single is not None:
                    embeddings.append(single[0])
                    individual_ok += 1
                else:
                    embeddings.append([0.0] * 1024)
                    individual_fail += 1
                    print(f"    [skip] chunk {chunk['chunk_id'][:12]}... (content len={len(passage)})")
            if individual_ok > 0:
                print(f"    individual: {individual_ok} ok, {individual_fail} failed")
            else:
                failed += len(chunks)
                continue

        with engine.begin() as conn:
            for chunk, embedding in zip(chunks, embeddings):
                if all(v == 0.0 for v in embedding):
                    failed += 1
                    continue
                conn.execute(
                    UPDATE_EMBEDDING_SQL,
                    {
                        "chunk_id": chunk["chunk_id"],
                        "embedding": vector_literal(embedding),
                    },
                )

        processed += len(chunks)
        elapsed = time.perf_counter() - start_time
        rate = processed / max(elapsed, 0.001)
        eta = (limit - processed - (batch_offset - args.offset)) / max(rate, 0.001)
        print(
            f"  [{processed}/{limit}] embedded {len(chunks)} chunks "
            f"({rate:.1f} chunks/s, ETA {eta:.0f}s)"
        )
        time.sleep(0.1)

    elapsed = time.perf_counter() - start_time
    print(f"\nDone: {processed} embedded, {failed} failed, {elapsed:.1f}s total")

    if args.create_hnsw:
        print("Creating HNSW index...")
        with engine.begin() as conn:
            try:
                conn.execute(text("DROP INDEX IF EXISTS idx_document_chunks_embedding_ivfflat"))
            except Exception:
                pass
            conn.execute(CREATE_INDEX_SQL)
        print("HNSW index created (m=16, ef_construction=200)")

    print("Done. Restart the backend to use new embeddings.")


if __name__ == "__main__":
    main()
