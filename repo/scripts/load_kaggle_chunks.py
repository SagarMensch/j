import json
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from sqlalchemy import text
from app.db.postgres import engine
from app.db.neo4j import get_driver
from app.core.config import get_settings


REPO_ROOT = Path(__file__).resolve().parents[1]
KAGGLE_WORKING_DIR = REPO_ROOT / "kaggle" / "working"
CHUNKS_FILE = KAGGLE_WORKING_DIR / "chunks_with_embeddings (1).json"
BBOX_FILE = KAGGLE_WORKING_DIR / "bounding_boxes (1).json"


def purge_existing_data():
    print("[PURGE] Purging existing data from Supabase...")
    with engine.begin() as conn:
        conn.execute(text("""
            TRUNCATE TABLE document_chunks, document_revisions, documents 
            RESTART IDENTITY CASCADE
        """))
    print("[PURGE] Supabase purged.")
    
    print("[PURGE] Purging existing data from Neo4j...")
    settings = get_settings()
    driver = get_driver()
    with driver.session(database=settings.NEO4J_DATABASE) as session:
        session.run("MATCH (n) DETACH DELETE n").consume()
    print("[PURGE] Neo4j purged.")


def load_documents_and_chunks():
    print("[LOAD] Loading chunks from Kaggle output...")
    
    with open(CHUNKS_FILE, "r", encoding="utf-8") as f:
        chunks = json.load(f)
    
    with open(BBOX_FILE, "r", encoding="utf-8") as f:
        bboxes = json.load(f)
    
    bbox_map = {}
    for b in bboxes:
        chunk_id = b.get("chunk_id")
        if chunk_id:
            bbox_map[chunk_id] = {
                "x0": b.get("bbox_x0"),
                "y0": b.get("bbox_y0"),
                "x1": b.get("bbox_x1"),
                "y1": b.get("bbox_y1"),
            }
    
    doc_ids = {}
    chunk_rows = []
    
    for chunk in chunks:
        doc_code = chunk.get("doc_code", "unknown")
        if doc_code not in doc_ids:
            doc_id = str(uuid.uuid4())
            doc_ids[doc_code] = doc_id
        
        chunk_id = chunk.get("id", str(uuid.uuid4()))
        page_number = chunk.get("page_number", 1)
        
        bbox = bbox_map.get(chunk_id, {})
        
        chunk_rows.append({
            "id": chunk_id,
            "doc_id": doc_ids[doc_code],
            "doc_code": doc_code,
            "chunk_index": chunk.get("chunk_index", 0),
            "page_number": page_number,
            "section_title": chunk.get("section_title"),
            "content": chunk.get("chunk_text", ""),
            "embedding": chunk.get("embedding", []),
            "bbox_x0": bbox.get("x0"),
            "bbox_y0": bbox.get("y0"),
            "bbox_x1": bbox.get("x1"),
            "bbox_y1": bbox.get("y1"),
        })
    
    print(f"[LOAD] Loaded {len(chunk_rows)} chunks from {len(doc_ids)} documents")
    
    print("[LOAD] Inserting documents into Supabase...")
    with engine.begin() as conn:
        for doc_code, doc_id in doc_ids.items():
            conn.execute(
                text("""
                    INSERT INTO documents (id, code, title, document_type, department_name, source_filename, is_active)
                    VALUES (CAST(:id AS uuid), :code, :title, :document_type, :department_name, :source_filename, true)
                    ON CONFLICT (id) DO UPDATE SET 
                        code = EXCLUDED.code, 
                        title = EXCLUDED.title,
                        source_filename = EXCLUDED.source_filename,
                        updated_at = now()
                """),
                {
                    "id": doc_id,
                    "code": doc_code,
                    "title": doc_code,
                    "document_type": "sop_document",
                    "department_name": "operations",
                    "source_filename": f"{doc_code}.pdf",
                }
            )
            
            rev_id = str(uuid.uuid4())
            conn.execute(
                text("""
                    INSERT INTO document_revisions (id, document_id, revision_label, version_number, approval_status, is_latest_approved)
                    VALUES (CAST(:id AS uuid), CAST(:doc_id AS uuid), :revision_label, 1, 'approved', true)
                    ON CONFLICT (id) DO UPDATE SET 
                        revision_label = EXCLUDED.revision_label,
                        approval_status = EXCLUDED.approval_status,
                        is_latest_approved = EXCLUDED.is_latest_approved,
                        updated_at = now()
                """),
                {"id": rev_id, "doc_id": doc_id, "revision_label": "kaggle-v1"}
            )
            
            for chunk in chunk_rows:
                if chunk["doc_id"] == doc_id:
                    vector_str = None
                    if chunk["embedding"] and len(chunk["embedding"]) > 0:
                        vector_str = "[" + ",".join(f"{float(v):.8f}" for v in chunk["embedding"]) + "]"
                    
                    conn.execute(
                        text("""
                            INSERT INTO document_chunks (
                                id, revision_id, chunk_index, chunk_type, page_start, page_end,
                                section_title, citation_label, content, 
                                equipment_tags, safety_flags, block_ids,
                                bbox_x0, bbox_y0, bbox_x1, bbox_y1,
                                embedding
                            )
                            VALUES (
                                CAST(:id AS uuid), CAST(:revision_id AS uuid), :chunk_index, :chunk_type,
                                :page_start, :page_end, :section_title, :citation_label, :content,
                                CAST(:equipment_tags AS jsonb), CAST(:safety_flags AS jsonb), CAST(:block_ids AS jsonb),
                                :bbox_x0, :bbox_y0, :bbox_x1, :bbox_y1,
                                CAST(:embedding AS vector)
                            )
                            ON CONFLICT (id) DO UPDATE SET
                                chunk_index = EXCLUDED.chunk_index,
                                page_start = EXCLUDED.page_start,
                                page_end = EXCLUDED.page_end,
                                section_title = EXCLUDED.section_title,
                                citation_label = EXCLUDED.citation_label,
                                content = EXCLUDED.content,
                                equipment_tags = EXCLUDED.equipment_tags,
                                safety_flags = EXCLUDED.safety_flags,
                                block_ids = EXCLUDED.block_ids,
                                bbox_x0 = EXCLUDED.bbox_x0,
                                bbox_y0 = EXCLUDED.bbox_y0,
                                bbox_x1 = EXCLUDED.bbox_x1,
                                bbox_y1 = EXCLUDED.bbox_y1,
                                embedding = EXCLUDED.embedding,
                                updated_at = now()
                        """),
                        {
                            "id": chunk["id"],
                            "revision_id": rev_id,
                            "chunk_index": chunk["chunk_index"],
                            "chunk_type": "section",
                            "page_start": chunk["page_number"],
                            "page_end": chunk["page_number"],
                            "section_title": chunk["section_title"],
                            "citation_label": f"Page {chunk['page_number']}",
                            "content": chunk["content"][:10000],
                            "equipment_tags": "[]",
                            "safety_flags": "[]",
                            "block_ids": "[]",
                            "bbox_x0": chunk["bbox_x0"],
                            "bbox_y0": chunk["bbox_y0"],
                            "bbox_x1": chunk["bbox_x1"],
                            "bbox_y1": chunk["bbox_y1"],
                            "embedding": vector_str,
                        }
                    )
    
    print("[LOAD] Chunks loaded to Supabase with embeddings and bboxes")
    return doc_ids, chunk_rows


def load_to_neo4j(doc_ids, chunk_rows):
    print("[LOAD] Loading entities and relationships to Neo4j...")
    settings = get_settings()
    driver = get_driver()
    
    with driver.session(database=settings.NEO4J_DATABASE) as session:
        for doc_code, doc_id in doc_ids.items():
            session.run(
                """
                MERGE (d:Document {id: $doc_id})
                SET d.code = $doc_code, d.title = $doc_code, d.document_type = 'sop_document'
                """,
                {"doc_id": doc_id, "doc_code": doc_code}
            )
        
        for chunk in chunk_rows:
            session.run(
                """
                MERGE (c:Chunk {id: $chunk_id})
                SET c.chunk_index = $chunk_index,
                    c.page_number = $page_number,
                    c.content = left($content, 500),
                    c.section_title = $section_title,
                    c.bbox_x0 = $bbox_x0,
                    c.bbox_y0 = $bbox_y0,
                    c.bbox_x1 = $bbox_x1,
                    c.bbox_y1 = $bbox_y1
                WITH c
                MATCH (d:Document {id: $doc_id})
                MERGE (d)-[:HAS_CHUNK]->(c)
                """,
                {
                    "chunk_id": chunk["id"],
                    "chunk_index": chunk["chunk_index"],
                    "page_number": chunk["page_number"],
                    "content": chunk["content"],
                    "section_title": chunk["section_title"],
                    "doc_id": chunk["doc_id"],
                    "bbox_x0": chunk["bbox_x0"],
                    "bbox_y0": chunk["bbox_y0"],
                    "bbox_x1": chunk["bbox_x1"],
                    "bbox_y1": chunk["bbox_y1"],
                }
            )
    
    print("[LOAD] Graph data loaded to Neo4j")


def verify_load():
    print("[VERIFY] Verifying data in databases...")
    
    with engine.connect() as conn:
        doc_count = conn.execute(text("SELECT COUNT(*) FROM documents")).scalar()
        chunk_count = conn.execute(text("SELECT COUNT(*) FROM document_chunks")).scalar()
        print(f"[VERIFY] Supabase: {doc_count} documents, {chunk_count} chunks")
    
    settings = get_settings()
    driver = get_driver()
    with driver.session(database=settings.NEO4J_DATABASE) as session:
        result = session.run("MATCH (n) RETURN count(n) as count").single()
        print(f"[VERIFY] Neo4j: {result['count']} nodes")
    
    print("[VERIFY] Load complete!")


def main():
    print("=" * 60)
    print("Loading Kaggle chunks with embeddings to databases")
    print("=" * 60)
    
    purge_existing_data()
    doc_ids, chunk_rows = load_documents_and_chunks()
    load_to_neo4j(doc_ids, chunk_rows)
    verify_load()
    
    print("=" * 60)
    print("DONE - Data loaded successfully!")
    print("=" * 60)


if __name__ == "__main__":
    main()