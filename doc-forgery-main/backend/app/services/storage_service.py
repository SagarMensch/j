from __future__ import annotations

import json
import logging
import re
import shutil
import sqlite3
from pathlib import Path
from typing import Any

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
        self.settings.db_path.parent.mkdir(parents=True, exist_ok=True)

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.settings.db_path)
        connection.row_factory = sqlite3.Row
        return connection

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
            forensic_risk_score REAL NOT NULL,
            engine_scores_json TEXT NOT NULL,
            duplicate_status TEXT NOT NULL,
            md5_hash TEXT NOT NULL,
            phash TEXT NOT NULL,
            nearest_match_analysis_id TEXT,
            hamming_distance INTEGER,
            processing_time_ms INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            upload_path TEXT NOT NULL,
            output_json_path TEXT NOT NULL,
            analysis_json TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS pages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            analysis_id TEXT NOT NULL,
            page_index INTEGER NOT NULL,
            width INTEGER NOT NULL,
            height INTEGER NOT NULL,
            artifacts_json TEXT NOT NULL,
            FOREIGN KEY (analysis_id) REFERENCES analyses (analysis_id)
        );

        CREATE TABLE IF NOT EXISTS regions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            analysis_id TEXT NOT NULL,
            region_id TEXT NOT NULL,
            page_index INTEGER NOT NULL,
            x INTEGER NOT NULL,
            y INTEGER NOT NULL,
            width INTEGER NOT NULL,
            height INTEGER NOT NULL,
            area_px INTEGER NOT NULL,
            mean_mask_score REAL NOT NULL,
            max_mask_score REAL NOT NULL,
            FOREIGN KEY (analysis_id) REFERENCES analyses (analysis_id)
        );

        CREATE TABLE IF NOT EXISTS duplicate_fingerprints (
            analysis_id TEXT PRIMARY KEY,
            filename TEXT NOT NULL,
            md5_hash TEXT NOT NULL,
            phash TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY (analysis_id) REFERENCES analyses (analysis_id)
        );

        CREATE TABLE IF NOT EXISTS ocr_anomalies (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            analysis_id TEXT NOT NULL,
            anomaly_type TEXT NOT NULL,
            description TEXT NOT NULL,
            page_index INTEGER,
            FOREIGN KEY (analysis_id) REFERENCES analyses (analysis_id)
        );
        """
        with self._connect() as connection:
            connection.executescript(schema)
            connection.commit()

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
            connection.execute("DELETE FROM pages WHERE analysis_id = ?", (analysis_id,))
            connection.execute("DELETE FROM regions WHERE analysis_id = ?", (analysis_id,))
            connection.execute("DELETE FROM ocr_anomalies WHERE analysis_id = ?", (analysis_id,))
            connection.execute(
                """
                INSERT OR REPLACE INTO analyses (
                    analysis_id, filename, document_type, submitter_id, page_count, device,
                    verdict, forensic_risk_score, engine_scores_json, duplicate_status,
                    md5_hash, phash, nearest_match_analysis_id, hamming_distance,
                    processing_time_ms, created_at, upload_path, output_json_path, analysis_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                    json.dumps(payload["engine_scores"]),
                    payload["duplicate_check"]["duplicate_status"],
                    payload["duplicate_check"]["md5_hash"],
                    payload["duplicate_check"]["phash"],
                    payload["duplicate_check"].get("nearest_match_analysis_id"),
                    payload["duplicate_check"].get("hamming_distance"),
                    payload["processing_time_ms"],
                    payload["created_at"],
                    str(upload_path),
                    str(output_json_path),
                    json.dumps(payload),
                ),
            )

            for page in payload["pages"]:
                connection.execute(
                    """
                    INSERT INTO pages (analysis_id, page_index, width, height, artifacts_json)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (
                        analysis_id,
                        page["page_index"],
                        page["width"],
                        page["height"],
                        json.dumps(page["artifacts"]),
                    ),
                )

                for region in page["tampered_regions"]:
                    connection.execute(
                        """
                        INSERT INTO regions (
                            analysis_id, region_id, page_index, x, y, width, height,
                            area_px, mean_mask_score, max_mask_score
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                    VALUES (?, ?, ?, ?)
                    """,
                    (
                        analysis_id,
                        anomaly["type"],
                        anomaly["description"],
                        anomaly.get("page_index"),
                    ),
                )

            connection.commit()

    def get_analysis(self, analysis_id: str) -> dict[str, Any] | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT analysis_json FROM analyses WHERE analysis_id = ?",
                (analysis_id,),
            ).fetchone()
        if not row:
            return None
        return json.loads(row["analysis_json"])

    def list_analyses(self, page: int, page_size: int) -> tuple[list[dict[str, Any]], int]:
        offset = (page - 1) * page_size
        with self._connect() as connection:
            total_row = connection.execute("SELECT COUNT(*) AS count FROM analyses").fetchone()
            rows = connection.execute(
                """
                SELECT analysis_id, filename, document_type, page_count, verdict,
                       forensic_risk_score, created_at
                FROM analyses
                ORDER BY created_at DESC
                LIMIT ? OFFSET ?
                """,
                (page_size, offset),
            ).fetchall()
        items = [dict(row) for row in rows]
        total = int(total_row["count"]) if total_row else 0
        return items, total

    def delete_analysis(self, analysis_id: str) -> bool:
        with self._connect() as connection:
            analysis_row = connection.execute(
                "SELECT upload_path FROM analyses WHERE analysis_id = ?",
                (analysis_id,),
            ).fetchone()
            if not analysis_row:
                return False

            connection.execute("DELETE FROM duplicate_fingerprints WHERE analysis_id = ?", (analysis_id,))
            connection.execute("DELETE FROM ocr_anomalies WHERE analysis_id = ?", (analysis_id,))
            connection.execute("DELETE FROM regions WHERE analysis_id = ?", (analysis_id,))
            connection.execute("DELETE FROM pages WHERE analysis_id = ?", (analysis_id,))
            connection.execute("DELETE FROM analyses WHERE analysis_id = ?", (analysis_id,))
            connection.commit()

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
                ORDER BY datetime(created_at) DESC
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
                INSERT OR REPLACE INTO duplicate_fingerprints
                (analysis_id, filename, md5_hash, phash, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (analysis_id, filename, md5_hash, phash, created_at),
            )
            connection.commit()
