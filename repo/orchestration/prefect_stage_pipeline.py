from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

from prefect import flow, task


REPO_ROOT = Path(__file__).resolve().parents[1]
PYTHON = sys.executable


def _run(command: list[str], cwd: Path | None = None):
    env = os.environ.copy()
    process = subprocess.run(command, cwd=str(cwd or REPO_ROOT), env=env, check=False, capture_output=True, text=True)
    if process.returncode != 0:
        raise RuntimeError(f"Command failed: {' '.join(command)}\nstdout:\n{process.stdout}\nstderr:\n{process.stderr}")
    return process.stdout.strip()


@task
def normalize_and_chunk():
    return _run([PYTHON, "scripts/normalize_and_chunk_stage1.py"], cwd=REPO_ROOT)


@task
def build_retrieval_assets():
    return _run(
        [
            PYTHON,
            "scripts/build_retrieval_assets_stage1.py",
            "--input-dir",
            "stage1_outputs/canonical",
            "--output-dir",
            "stage1_outputs/retrieval_assets",
            "--embedding-model",
            "sentence-transformers/all-MiniLM-L6-v2",
            "--device",
            "cpu",
            "--progress-every",
            "200",
        ],
        cwd=REPO_ROOT,
    )


@task
def load_to_datastores():
    return _run([PYTHON, "scripts/load_stage1_to_datastores.py", "--batch-size", "400"], cwd=REPO_ROOT)


@task
def seed_product_data():
    return _run([PYTHON, "scripts/seed_product_data_stage2.py"], cwd=REPO_ROOT)


@task
def quality_gates():
    script = (
        "from sqlalchemy import text; "
        "from app.db.postgres import engine; "
        "tables=['documents','document_chunks','users','training_modules','training_assignments','assessments','assessment_questions']; "
        "import json; "
        "out={}; "
        "with engine.connect() as c: "
        "  [out.setdefault(t, int(c.execute(text(f'select count(*) from {t}')).scalar_one())) for t in tables]; "
        "print(json.dumps(out))"
    )
    out = _run([PYTHON, "-c", script], cwd=REPO_ROOT / "backend")
    return out


@flow(name="jubilant-stage-pipeline")
def jubilant_stage_pipeline():
    normalize_and_chunk()
    build_retrieval_assets()
    load_to_datastores()
    seed_product_data()
    return quality_gates()


if __name__ == "__main__":
    result = jubilant_stage_pipeline()
    print(result)
