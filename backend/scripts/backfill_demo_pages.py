from __future__ import annotations

import sys
import uuid
from pathlib import Path

from sqlalchemy import text

REPO_ROOT = Path(__file__).resolve().parents[2]
WORKSPACE_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT / "backend"))

from app.db.postgres import engine
from app.services.sop_pipeline import process_document


PDF_MAP = {
    "SOP-CHM-001": WORKSPACE_ROOT / "documents" / "documents" / "23.SOP. Chemical Handling.pdf",
    "SMP-MNT-002": WORKSPACE_ROOT / "documents" / "documents" / "8-2-Chemical-Sampling-SOP-20220502_final.pdf",
    "WID-SAF-003": WORKSPACE_ROOT / "documents" / "documents" / "Standard Operating Procedures (SOPs) for safe operations on hazardous and dangerous manufacturing processes.pdf",
}


def main() -> int:
    with engine.begin() as conn:
        revisions = {
            row["code"]: dict(row)
            for row in conn.execute(
                text(
                    """
                    SELECT
                        d.id::text AS document_id,
                        d.code,
                        dr.id::text AS revision_id
                    FROM documents d
                    JOIN document_revisions dr ON dr.document_id = d.id
                    WHERE dr.is_latest_approved = true
                      AND d.code = ANY(:codes)
                    """
                ),
                {"codes": list(PDF_MAP.keys())},
            ).mappings()
        }

    missing = [code for code in PDF_MAP if code not in revisions]
    if missing:
        raise RuntimeError(f"Missing live revisions for: {', '.join(missing)}")

    for code, pdf_path in PDF_MAP.items():
        revision = revisions[code]
        print(f"--- backfilling {code} from {pdf_path.name}")
        extraction = process_document(
            str(pdf_path),
            revision["document_id"],
            revision["revision_id"],
        )
        pages = extraction.get("pages", [])
        if not pages:
            raise RuntimeError(f"No pages extracted for {code}")

        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    DELETE FROM extracted_blocks
                    WHERE page_id IN (
                        SELECT id FROM extracted_pages
                        WHERE revision_id = CAST(:revision_id AS uuid)
                    )
                    """
                ),
                {"revision_id": revision["revision_id"]},
            )
            conn.execute(
                text("DELETE FROM extracted_pages WHERE revision_id = CAST(:revision_id AS uuid)"),
                {"revision_id": revision["revision_id"]},
            )

            conn.execute(
                text(
                    """
                    UPDATE document_revisions
                    SET
                        file_path = :file_path,
                        page_count = :page_count,
                        extraction_classification = :classification,
                        extraction_status = 'completed',
                        updated_at = NOW()
                    WHERE id = CAST(:revision_id AS uuid)
                    """
                ),
                {
                    "revision_id": revision["revision_id"],
                    "file_path": str(pdf_path),
                    "page_count": extraction.get("page_count", 0),
                    "classification": extraction.get("classification", "unknown"),
                },
            )

            page_id_map: dict[int, str] = {}
            for page in pages:
                page_id = str(uuid.uuid4())
                page_id_map[page["page_number"]] = page_id
                conn.execute(
                    text(
                        """
                        INSERT INTO extracted_pages (
                            id, revision_id, page_number, classification, extracted_text_chars,
                            raw_text, markdown_path, image_path, ocr_used, ocr_confidence, created_at
                        )
                        VALUES (
                            CAST(:id AS uuid), CAST(:revision_id AS uuid), :page_number, :classification,
                            :extracted_text_chars, :raw_text, :markdown_path, :image_path, :ocr_used,
                            :ocr_confidence, NOW()
                        )
                        """
                    ),
                    {
                        "id": page_id,
                        "revision_id": revision["revision_id"],
                        "page_number": page["page_number"],
                        "classification": page.get("classification", "unknown"),
                        "extracted_text_chars": page.get("extracted_text_chars", 0),
                        "raw_text": page.get("raw_text"),
                        "markdown_path": page.get("markdown_path"),
                        "image_path": page.get("image_path"),
                        "ocr_used": page.get("ocr_used", False),
                        "ocr_confidence": page.get("ocr_confidence"),
                    },
                )

            for page in pages:
                page_id = page_id_map[page["page_number"]]
                for block in page.get("blocks", []):
                    bbox = block.get("bbox") or {}
                    conn.execute(
                        text(
                            """
                            INSERT INTO extracted_blocks (
                                id, page_id, block_type, section_title, text,
                                bbox_left, bbox_top, bbox_right, bbox_bottom,
                                confidence, reading_order, created_at
                            )
                            VALUES (
                                CAST(:id AS uuid), CAST(:page_id AS uuid), :block_type, :section_title, :text,
                                :bbox_left, :bbox_top, :bbox_right, :bbox_bottom,
                                :confidence, :reading_order, NOW()
                            )
                            """
                        ),
                        {
                            "id": block["block_id"],
                            "page_id": page_id,
                            "block_type": block.get("block_type", "paragraph"),
                            "section_title": block.get("section_title"),
                            "text": block.get("text") or "",
                            "bbox_left": bbox.get("left"),
                            "bbox_top": bbox.get("top"),
                            "bbox_right": bbox.get("right"),
                            "bbox_bottom": bbox.get("bottom"),
                            "confidence": block.get("confidence"),
                            "reading_order": block.get("reading_order"),
                        },
                    )

        print(
            {
                "code": code,
                "revision_id": revision["revision_id"],
                "pages": extraction.get("page_count", 0),
                "classification": extraction.get("classification", "unknown"),
            }
        )

    print("Backfill complete.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
