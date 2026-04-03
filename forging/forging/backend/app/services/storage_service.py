from __future__ import annotations

import json
import logging
import re
import shutil
from pathlib import Path
from typing import Any

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from app.core.config import Settings


class StorageService:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.logger = logging.getLogger(self.__class__.__name__)
        self._ensure_directories()
        self._initialise_database()

    def _ensure_directories(self) -> None:
        self.settings.data_dir.mkdir(parents=True, exist_ok=True)
        self.settings.uploads_dir.mkdir(parents=True, exist_ok=True)
        self.settings.outputs_dir.mkdir(parents=True, exist_ok=True)
        self.settings.artifacts_dir.mkdir(parents=True, exist_ok=True)

    def _connect(self) -> psycopg.Connection:
        return psycopg.connect(self.settings.database_url, row_factory=dict_row)

    def _initialise_database(self) -> None:
        schema = """
        CREATE TABLE IF NOT EXISTS analyses (
            analysis_id TEXT PRIMARY KEY,
            filename TEXT NOT NULL,
            document_type TEXT,
            submitter_id TEXT,
            page_count INTEGER NOT NULL,
            device TEXT NOT NULL,
            verdict TEXT NOT NULL,
            forensic_risk_score DOUBLE PRECISION NOT NULL,
            engine_scores_json JSONB NOT NULL,
            duplicate_status TEXT NOT NULL,
            md5_hash TEXT NOT NULL,
            phash TEXT NOT NULL,
            nearest_match_analysis_id TEXT,
            hamming_distance INTEGER,
            processing_time_ms INTEGER NOT NULL,
            created_at TIMESTAMPTZ NOT NULL,
            upload_path TEXT NOT NULL,
            output_json_path TEXT NOT NULL,
            analysis_json JSONB NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_analyses_created_at ON analyses (created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_analyses_verdict ON analyses (verdict);
        CREATE INDEX IF NOT EXISTS idx_analyses_risk ON analyses (forensic_risk_score DESC);

        CREATE TABLE IF NOT EXISTS pages (
            id BIGSERIAL PRIMARY KEY,
            analysis_id TEXT NOT NULL REFERENCES analyses (analysis_id) ON DELETE CASCADE,
            page_index INTEGER NOT NULL,
            width INTEGER NOT NULL,
            height INTEGER NOT NULL,
            artifacts_json JSONB NOT NULL
        );

        CREATE TABLE IF NOT EXISTS regions (
            id BIGSERIAL PRIMARY KEY,
            analysis_id TEXT NOT NULL REFERENCES analyses (analysis_id) ON DELETE CASCADE,
            region_id TEXT NOT NULL,
            page_index INTEGER NOT NULL,
            x INTEGER NOT NULL,
            y INTEGER NOT NULL,
            width INTEGER NOT NULL,
            height INTEGER NOT NULL,
            area_px INTEGER NOT NULL,
            mean_mask_score DOUBLE PRECISION NOT NULL,
            max_mask_score DOUBLE PRECISION NOT NULL
        );

        CREATE TABLE IF NOT EXISTS duplicate_fingerprints (
            analysis_id TEXT PRIMARY KEY REFERENCES analyses (analysis_id) ON DELETE CASCADE,
            filename TEXT NOT NULL,
            md5_hash TEXT NOT NULL,
            phash TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_duplicate_fingerprints_created_at
            ON duplicate_fingerprints (created_at DESC);

        CREATE TABLE IF NOT EXISTS ocr_anomalies (
            id BIGSERIAL PRIMARY KEY,
            analysis_id TEXT NOT NULL REFERENCES analyses (analysis_id) ON DELETE CASCADE,
            anomaly_type TEXT NOT NULL,
            description TEXT NOT NULL,
            page_index INTEGER
        );
        """
        with self._connect() as connection:
            for statement in schema.split(";"):
                sql = statement.strip()
                if sql:
                    connection.execute(sql)

    def database_ready(self) -> bool:
        try:
            with self._connect() as connection:
                connection.execute("SELECT 1")
            return True
        except Exception:
            self.logger.exception("Database connectivity check failed")
            return False

    def sanitise_filename(self, filename: str) -> str:
        safe = re.sub(r"[^A-Za-z0-9._-]+", "_", filename.strip())
        return safe or "upload.bin"

    def save_upload(self, analysis_id: str, filename: str, payload: bytes) -> Path:
        safe_name = self.sanitise_filename(filename)
        path = self.settings.uploads_dir / f"{analysis_id}_{safe_name}"
        path.write_bytes(payload)
        self.logger.info("Upload saved", extra={"analysis_id": analysis_id, "path": str(path)})
        return path

    def output_dir(self, analysis_id: str) -> Path:
        path = self.settings.outputs_dir / analysis_id
        path.mkdir(parents=True, exist_ok=True)
        return path

    def save_analysis_json(self, analysis_id: str, payload: dict[str, Any]) -> Path:
        path = self.output_dir(analysis_id) / "analysis.json"
        path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        return path

    def store_analysis(self, payload: dict[str, Any], upload_path: Path) -> None:
        analysis_id = payload["analysis_id"]
        output_json_path = self.save_analysis_json(analysis_id, payload)

        with self._connect() as connection:
            connection.execute("DELETE FROM analyses WHERE analysis_id = %s", (analysis_id,))
            connection.execute(
                """
                INSERT INTO analyses (
                    analysis_id, filename, document_type, submitter_id, page_count, device,
                    verdict, forensic_risk_score, engine_scores_json, duplicate_status,
                    md5_hash, phash, nearest_match_analysis_id, hamming_distance,
                    processing_time_ms, created_at, upload_path, output_json_path, analysis_json
                ) VALUES (
                    %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
                )
                """,
                (
                    analysis_id,
                    payload["filename"],
                    payload.get("document_type"),
                    payload.get("submitter_id"),
                    payload["page_count"],
                    payload["device"],
                    payload["verdict"],
                    payload["forensic_risk_score"],
                    Jsonb(payload["engine_scores"]),
                    payload["duplicate_check"]["duplicate_status"],
                    payload["duplicate_check"]["md5_hash"],
                    payload["duplicate_check"]["phash"],
                    payload["duplicate_check"].get("nearest_match_analysis_id"),
                    payload["duplicate_check"].get("hamming_distance"),
                    payload["processing_time_ms"],
                    payload["created_at"],
                    str(upload_path),
                    str(output_json_path),
                    Jsonb(payload),
                ),
            )

            for page in payload["pages"]:
                connection.execute(
                    """
                    INSERT INTO pages (analysis_id, page_index, width, height, artifacts_json)
                    VALUES (%s, %s, %s, %s, %s)
                    """,
                    (
                        analysis_id,
                        page["page_index"],
                        page["width"],
                        page["height"],
                        Jsonb(page["artifacts"]),
                    ),
                )

                for region in page["tampered_regions"]:
                    connection.execute(
                        """
                        INSERT INTO regions (
                            analysis_id, region_id, page_index, x, y, width, height,
                            area_px, mean_mask_score, max_mask_score
                        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        """,
                        (
                            analysis_id,
                            region["region_id"],
                            region["page_index"],
                            region["x"],
                            region["y"],
                            region["width"],
                            region["height"],
                            region["area_px"],
                            region["mean_mask_score"],
                            region["max_mask_score"],
                        ),
                    )

            for anomaly in payload["ocr_anomalies"]:
                connection.execute(
                    """
                    INSERT INTO ocr_anomalies (analysis_id, anomaly_type, description, page_index)
                    VALUES (%s, %s, %s, %s)
                    """,
                    (
                        analysis_id,
                        anomaly["type"],
                        anomaly["description"],
                        anomaly.get("page_index"),
                    ),
                )

    def get_analysis(self, analysis_id: str) -> dict[str, Any] | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT analysis_json FROM analyses WHERE analysis_id = %s",
                (analysis_id,),
            ).fetchone()

        if not row:
            return None

        payload = row["analysis_json"]
        if isinstance(payload, str):
            return json.loads(payload)
        return payload

    def list_analyses(self, page: int, page_size: int) -> tuple[list[dict[str, Any]], int]:
        offset = (page - 1) * page_size
        with self._connect() as connection:
            total_row = connection.execute("SELECT COUNT(*) AS count FROM analyses").fetchone()
            rows = connection.execute(
                """
                SELECT
                    analysis_id,
                    filename,
                    document_type,
                    submitter_id,
                    page_count,
                    verdict,
                    forensic_risk_score,
                    duplicate_status,
                    processing_time_ms,
                    created_at
                FROM analyses
                ORDER BY created_at DESC
                LIMIT %s OFFSET %s
                """,
                (page_size, offset),
            ).fetchall()

        items = [dict(row) for row in rows]
        total = int(total_row["count"]) if total_row else 0
        return items, total

    def get_dashboard_summary(
        self,
        recent_limit: int = 8,
        flagged_limit: int = 8,
    ) -> dict[str, Any]:
        with self._connect() as connection:
            overview = connection.execute(
                """
                SELECT
                    COUNT(*) AS total_analyses,
                    COUNT(*) FILTER (WHERE verdict = 'CLEAN') AS clean_count,
                    COUNT(*) FILTER (WHERE verdict = 'SUSPICIOUS') AS suspicious_count,
                    COUNT(*) FILTER (WHERE verdict = 'CONFIRMED_FORGERY') AS confirmed_forgery_count,
                    COUNT(*) FILTER (WHERE duplicate_status = 'EXACT_DUPLICATE') AS exact_duplicate_count,
                    COUNT(*) FILTER (WHERE duplicate_status = 'NEAR_DUPLICATE') AS near_duplicate_count,
                    COALESCE(AVG(forensic_risk_score), 0.0) AS average_risk_score,
                    COALESCE(AVG(processing_time_ms), 0.0) AS average_processing_time_ms,
                    COALESCE(AVG((engine_scores_json ->> 'ela_score')::double precision), 0.0) AS ela_score,
                    COALESCE(AVG((engine_scores_json ->> 'srm_score')::double precision), 0.0) AS srm_score,
                    COALESCE(AVG((engine_scores_json ->> 'noiseprint_score')::double precision), 0.0) AS noiseprint_score,
                    COALESCE(AVG((engine_scores_json ->> 'dino_vit_score')::double precision), 0.0) AS dino_vit_score,
                    COALESCE(AVG((engine_scores_json ->> 'ocr_anomaly_score')::double precision), 0.0) AS ocr_anomaly_score,
                    COALESCE(AVG((engine_scores_json ->> 'phash_score')::double precision), 0.0) AS phash_score,
                    COALESCE(AVG((engine_scores_json ->> 'segmentation_score')::double precision), 0.0) AS segmentation_score
                FROM analyses
                """
            ).fetchone()

            anomaly_row = connection.execute(
                "SELECT COUNT(*) AS count FROM ocr_anomalies"
            ).fetchone()

            recent_rows = connection.execute(
                """
                SELECT
                    analysis_id,
                    filename,
                    document_type,
                    submitter_id,
                    page_count,
                    verdict,
                    forensic_risk_score,
                    duplicate_status,
                    processing_time_ms,
                    created_at
                FROM analyses
                ORDER BY created_at DESC
                LIMIT %s
                """,
                (recent_limit,),
            ).fetchall()

            flagged_rows = connection.execute(
                """
                SELECT
                    analysis_id,
                    filename,
                    document_type,
                    submitter_id,
                    page_count,
                    verdict,
                    forensic_risk_score,
                    duplicate_status,
                    processing_time_ms,
                    created_at
                FROM analyses
                WHERE verdict <> 'CLEAN'
                ORDER BY forensic_risk_score DESC, created_at DESC
                LIMIT %s
                """,
                (flagged_limit,),
            ).fetchall()

        overview = dict(overview or {})
        return {
            "total_analyses": int(overview.get("total_analyses", 0)),
            "clean_count": int(overview.get("clean_count", 0)),
            "suspicious_count": int(overview.get("suspicious_count", 0)),
            "confirmed_forgery_count": int(overview.get("confirmed_forgery_count", 0)),
            "exact_duplicate_count": int(overview.get("exact_duplicate_count", 0)),
            "near_duplicate_count": int(overview.get("near_duplicate_count", 0)),
            "total_ocr_anomalies": int((anomaly_row or {}).get("count", 0)),
            "average_risk_score": float(overview.get("average_risk_score", 0.0) or 0.0),
            "average_processing_time_ms": float(
                overview.get("average_processing_time_ms", 0.0) or 0.0
            ),
            "engine_averages": {
                "ela_score": float(overview.get("ela_score", 0.0) or 0.0),
                "srm_score": float(overview.get("srm_score", 0.0) or 0.0),
                "noiseprint_score": float(overview.get("noiseprint_score", 0.0) or 0.0),
                "dino_vit_score": float(overview.get("dino_vit_score", 0.0) or 0.0),
                "ocr_anomaly_score": float(overview.get("ocr_anomaly_score", 0.0) or 0.0),
                "phash_score": float(overview.get("phash_score", 0.0) or 0.0),
                "segmentation_score": float(overview.get("segmentation_score", 0.0) or 0.0),
            },
            "recent_analyses": [dict(row) for row in recent_rows],
            "flagged_analyses": [dict(row) for row in flagged_rows],
        }

    def delete_analysis(self, analysis_id: str) -> bool:
        with self._connect() as connection:
            analysis_row = connection.execute(
                "SELECT upload_path FROM analyses WHERE analysis_id = %s",
                (analysis_id,),
            ).fetchone()
            if not analysis_row:
                return False

            connection.execute("DELETE FROM analyses WHERE analysis_id = %s", (analysis_id,))

        upload_path = Path(analysis_row["upload_path"])
        if upload_path.exists():
            upload_path.unlink()
        shutil.rmtree(self.settings.outputs_dir / analysis_id, ignore_errors=True)
        shutil.rmtree(self.settings.artifacts_dir / analysis_id, ignore_errors=True)
        return True

    def list_fingerprints(self) -> list[dict[str, Any]]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT analysis_id, filename, md5_hash, phash, created_at
                FROM duplicate_fingerprints
                ORDER BY created_at DESC
                """
            ).fetchall()
        return [dict(row) for row in rows]

    def upsert_fingerprint(
        self,
        analysis_id: str,
        filename: str,
        md5_hash: str,
        phash: str,
        created_at: str,
    ) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO duplicate_fingerprints
                    (analysis_id, filename, md5_hash, phash, created_at)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (analysis_id) DO UPDATE SET
                    filename = EXCLUDED.filename,
                    md5_hash = EXCLUDED.md5_hash,
                    phash = EXCLUDED.phash,
                    created_at = EXCLUDED.created_at
                """,
                (analysis_id, filename, md5_hash, phash, created_at),
            )
