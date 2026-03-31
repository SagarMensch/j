import sys
from pathlib import Path

from sqlalchemy import text


REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "backend"))

from app.core.config import get_settings
from app.db.neo4j import get_driver
from app.db.postgres import engine


def purge_documents(document_type: str | None = None) -> dict:
    settings = get_settings()
    doc_ids: list[str] = []
    doc_count = 0

    with engine.begin() as conn:
        if not document_type:
            doc_count = int(conn.execute(text("SELECT count(*) FROM documents")).scalar() or 0)
            conn.execute(
                text(
                    """
                    TRUNCATE TABLE
                        assessment_questions,
                        assessment_attempts,
                        assessments,
                        certifications,
                        training_steps,
                        training_modules,
                        training_assignments,
                        document_chunks,
                        extracted_blocks,
                        extracted_pages,
                        document_revisions,
                        documents
                    RESTART IDENTITY CASCADE
                    """
                )
            )
        else:
            rows = conn.execute(
                text("SELECT id::text AS id FROM documents WHERE document_type = :doc_type"),
                {"doc_type": document_type},
            ).mappings()

            doc_ids = [row["id"] for row in rows]
            if not doc_ids:
                return {"documents_deleted": 0, "neo4j": "skipped"}

            revision_rows = conn.execute(
                text(
                    """
                    SELECT id::text AS id
                    FROM document_revisions
                    WHERE document_id = ANY(CAST(:doc_ids AS uuid[]))
                    """
                ),
                {"doc_ids": doc_ids},
            ).mappings()
            revision_ids = [row["id"] for row in revision_rows]

            module_rows = conn.execute(
                text(
                    """
                    SELECT id::text AS id
                    FROM training_modules
                    WHERE source_document_id = ANY(CAST(:doc_ids AS uuid[]))
                       OR source_revision_id = ANY(CAST(:rev_ids AS uuid[]))
                    """
                ),
                {"doc_ids": doc_ids, "rev_ids": revision_ids or ["00000000-0000-0000-0000-000000000000"]},
            ).mappings()
            module_ids = [row["id"] for row in module_rows]

            if module_ids:
                conn.execute(
                    text("DELETE FROM certifications WHERE module_id = ANY(CAST(:module_ids AS uuid[]))"),
                    {"module_ids": module_ids},
                )
                conn.execute(
                    text(
                        """
                        DELETE FROM assessment_attempts
                        WHERE assessment_id IN (
                            SELECT id FROM assessments WHERE module_id = ANY(CAST(:module_ids AS uuid[]))
                        )
                        """
                    ),
                    {"module_ids": module_ids},
                )
                conn.execute(
                    text(
                        """
                        DELETE FROM assessment_questions
                        WHERE assessment_id IN (
                            SELECT id FROM assessments WHERE module_id = ANY(CAST(:module_ids AS uuid[]))
                        )
                        """
                    ),
                    {"module_ids": module_ids},
                )
                conn.execute(
                    text("DELETE FROM assessments WHERE module_id = ANY(CAST(:module_ids AS uuid[]))"),
                    {"module_ids": module_ids},
                )
                conn.execute(
                    text("DELETE FROM training_steps WHERE module_id = ANY(CAST(:module_ids AS uuid[]))"),
                    {"module_ids": module_ids},
                )
                conn.execute(
                    text("DELETE FROM training_modules WHERE id = ANY(CAST(:module_ids AS uuid[]))"),
                    {"module_ids": module_ids},
                )

            conn.execute(
                text("DELETE FROM documents WHERE id = ANY(CAST(:doc_ids AS uuid[]))"),
                {"doc_ids": doc_ids},
            )

    neo4j_status = "skipped"
    if settings.has_graph_credentials:
        try:
            driver = get_driver()
            with driver.session(database=settings.NEO4J_DATABASE) as session:
                session.run(
                    """
                    MATCH (n)
                    WHERE any(label IN labels(n) WHERE label IN [
                        'Document','DocumentRevision','DocumentChunk',
                        'ExtractedPage','ExtractedBlock',
                        'TrainingModule','TrainingStep',
                        'Assessment','AssessmentQuestion'
                    ])
                    DETACH DELETE n
                    """
                ).consume()
            neo4j_status = "purged"
        except Exception:
            neo4j_status = "error"

    processed_dir = Path(settings.PROCESSED_DATA_DIR)
    if not document_type and processed_dir.exists():
        import shutil

        shutil.rmtree(processed_dir, ignore_errors=True)
        processed_dir.mkdir(parents=True, exist_ok=True)

    return {
        "documents_deleted": doc_count if not document_type else len(doc_ids),
        "neo4j": neo4j_status,
    }


if __name__ == "__main__":
    result = purge_documents()
    print(f"Deleted {result['documents_deleted']} documents. Neo4j: {result['neo4j']}")
