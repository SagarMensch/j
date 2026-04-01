import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(REPO_ROOT / "backend"))

from sqlalchemy import text
from sqlalchemy.exc import ProgrammingError

from app.db.postgres import engine
from app.services.training_builder import generate_learning_assets, persist_learning_assets


APP_SETTINGS_DEFAULTS = {
    "assessment_passing_score": 70,
    "certification_validity_days": 365,
}


def load_app_settings(conn):
    settings_payload = dict(APP_SETTINGS_DEFAULTS)
    try:
        rows = conn.execute(
            text("SELECT setting_key, setting_value FROM app_settings")
        ).mappings()
    except ProgrammingError:
        return settings_payload
    for row in rows:
        settings_payload[row["setting_key"]] = row["setting_value"]
    return settings_payload


def main():
    with engine.begin() as conn:
        app_settings = load_app_settings(conn)
        revisions = conn.execute(
            text(
                """
                SELECT
                    d.id::text AS document_id,
                    d.code,
                    d.title,
                    d.document_type,
                    dr.id::text AS revision_id,
                    dr.revision_label
                FROM documents d
                JOIN document_revisions dr
                  ON dr.document_id = d.id
                 AND dr.is_latest_approved = true
                ORDER BY d.code
                """
            )
        ).mappings().all()

        if not revisions:
            print("No approved revisions found.")
            return

        for revision in revisions:
            chunks = [
                {
                    "id": row["id"],
                    "source_chunk_id": row["id"],
                    "chunk_index": row["chunk_index"],
                    "content": row["content"] or "",
                    "section_title": row["section_title"],
                    "citation_label": row["citation_label"],
                    "page_start": row["page_start"],
                }
                for row in conn.execute(
                    text(
                        """
                        SELECT
                            id::text AS id,
                            chunk_index,
                            content,
                            section_title,
                            citation_label,
                            page_start
                        FROM document_chunks
                        WHERE revision_id = CAST(:revision_id AS uuid)
                        ORDER BY chunk_index
                        """
                    ),
                    {"revision_id": revision["revision_id"]},
                ).mappings()
            ]

            if not chunks:
                print(f"Skipping {revision['code']}: no chunks found.")
                continue

            assets = generate_learning_assets(
                document_code=revision["code"],
                document_title=revision["title"],
                document_type=revision["document_type"] or "sop",
                chunks=chunks,
            )
            if assets.get("module"):
                assets["module"]["validity_days"] = int(
                    app_settings.get("certification_validity_days", 365)
                )
            if assets.get("assessment"):
                assets["assessment"]["passing_score"] = float(
                    app_settings.get("assessment_passing_score", 70)
                )

            result = persist_learning_assets(
                conn,
                document_id=revision["document_id"],
                revision_id=revision["revision_id"],
                assets=assets,
            )
            print(
                f"{revision['code']}: module={result.get('module_id')} assessment={result.get('assessment_id')}"
            )


if __name__ == "__main__":
    main()
