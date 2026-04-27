import argparse
import json
from datetime import UTC, datetime
from pathlib import Path


def parse_args():
    parser = argparse.ArgumentParser(
        description="Build Stage 1 retrieval assets from canonical chunk exports.",
    )
    parser.add_argument(
        "--input-dir",
        default="stage1_outputs/canonical",
        help="Directory containing canonical document folders.",
    )
    parser.add_argument(
        "--output-dir",
        default="stage1_outputs/retrieval_assets",
        help="Directory to write embedding and BM25 assets.",
    )
    parser.add_argument(
        "--embedding-model",
        default="sentence-transformers/all-MiniLM-L6-v2",
        help="Sentence-transformers model used for chunk embeddings.",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=64,
        help="Embedding batch size.",
    )
    parser.add_argument(
        "--device",
        default="cpu",
        help="Embedding device passed to sentence-transformers.",
    )
    parser.add_argument(
        "--skip-embeddings",
        action="store_true",
        help="Build only lexical assets and metadata exports.",
    )
    parser.add_argument(
        "--progress-every",
        type=int,
        default=1,
        help="Write progress checkpoints every N embedding batches.",
    )
    return parser.parse_args()


def load_chunks(input_dir: Path) -> list[dict]:
    chunks: list[dict] = []
    for chunk_file in sorted(input_dir.glob("*/canonical_chunks.jsonl")):
        document_name = chunk_file.parent.name
        for line in chunk_file.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            record = json.loads(line)
            record["document_name"] = document_name
            chunks.append(record)
    return chunks


def tokenize_for_bm25(text: str) -> list[str]:
    return [token for token in text.lower().replace("/", " ").replace("-", " ").split() if token]


def build_lexical_asset(chunks: list[dict], output_dir: Path):
    bm25_docs = []
    for chunk in chunks:
        bm25_docs.append(
            {
                "chunk_id": chunk["chunk_id"],
                "document_name": chunk["document_name"],
                "citation_label": chunk["citation_label"],
                "section_title": chunk.get("section_title"),
                "tokens": tokenize_for_bm25(
                    " ".join(
                        part
                        for part in [
                            chunk.get("section_title") or "",
                            chunk.get("citation_label") or "",
                            chunk.get("content") or "",
                            " ".join(chunk.get("equipment_tags") or []),
                            " ".join(chunk.get("safety_flags") or []),
                        ]
                    )
                ),
            }
        )
    (output_dir / "bm25_corpus.json").write_text(json.dumps(bm25_docs, indent=2), encoding="utf-8")


def write_json(path: Path, payload: dict):
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def append_log_line(path: Path, payload: dict):
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(payload) + "\n")


def build_embedding_asset(
    chunks: list[dict],
    output_dir: Path,
    model_name: str,
    batch_size: int,
    device: str,
    progress_every: int,
):
    try:
        from sentence_transformers import SentenceTransformer
    except ImportError as exc:
        raise RuntimeError(
            "sentence-transformers is not installed. Install backend requirements before generating embeddings."
        ) from exc

    model = SentenceTransformer(model_name, device=device)
    progress_path = output_dir / "embedding_progress.json"
    progress_log_path = output_dir / "embedding_progress.jsonl"
    embedding_path = output_dir / "embedding_records.jsonl"
    total_chunks = len(chunks)
    total_batches = (total_chunks + batch_size - 1) // batch_size
    completed_batches = 0
    completed_chunks = 0
    embedding_dimension = 0

    progress_payload = {
        "status": "running",
        "embedding_model": model_name,
        "device": device,
        "batch_size": batch_size,
        "total_chunks": total_chunks,
        "total_batches": total_batches,
        "completed_chunks": 0,
        "completed_batches": 0,
        "started_at": datetime.now(UTC).isoformat(),
        "updated_at": datetime.now(UTC).isoformat(),
    }
    write_json(progress_path, progress_payload)

    with embedding_path.open("w", encoding="utf-8") as handle:
        for batch_start in range(0, total_chunks, batch_size):
            batch_end = min(batch_start + batch_size, total_chunks)
            batch_chunks = chunks[batch_start:batch_end]
            batch_vectors = model.encode(
                [chunk["content"] for chunk in batch_chunks],
                batch_size=batch_size,
                show_progress_bar=False,
                convert_to_numpy=True,
                normalize_embeddings=True,
            )

            for chunk, vector in zip(batch_chunks, batch_vectors):
                embedding_dimension = int(len(vector))
                record = {
                    "chunk_id": chunk["chunk_id"],
                    "document_name": chunk["document_name"],
                    "embedding_model": model_name,
                    "embedding_dimension": embedding_dimension,
                    "vector": vector.tolist(),
                }
                handle.write(json.dumps(record) + "\n")

            completed_batches += 1
            completed_chunks += len(batch_chunks)

            if completed_batches % progress_every == 0 or completed_batches == total_batches:
                progress_payload = {
                    "status": "running" if completed_batches < total_batches else "completed",
                    "embedding_model": model_name,
                    "device": device,
                    "batch_size": batch_size,
                    "total_chunks": total_chunks,
                    "total_batches": total_batches,
                    "completed_chunks": completed_chunks,
                    "completed_batches": completed_batches,
                    "embedding_dimension": embedding_dimension,
                    "started_at": progress_payload["started_at"],
                    "updated_at": datetime.now(UTC).isoformat(),
                }
                write_json(progress_path, progress_payload)
                append_log_line(progress_log_path, progress_payload)

    return {
        "embedding_model": model_name,
        "embedding_dimension": embedding_dimension,
        "embedding_count": total_chunks,
    }


def main():
    args = parse_args()
    input_dir = Path(args.input_dir).resolve()
    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    chunks = load_chunks(input_dir)
    build_lexical_asset(chunks, output_dir)

    retrieval_manifest = {
        "generated_at": datetime.now(UTC).isoformat(),
        "source_directory": str(input_dir),
        "output_directory": str(output_dir),
        "chunk_count": len(chunks),
        "embedding_status": "skipped" if args.skip_embeddings else "pending",
        "embedding_model": None,
        "embedding_dimension": None,
    }

    if not args.skip_embeddings:
        embedding_meta = build_embedding_asset(
            chunks=chunks,
            output_dir=output_dir,
            model_name=args.embedding_model,
            batch_size=args.batch_size,
            device=args.device,
            progress_every=max(1, args.progress_every),
        )
        retrieval_manifest["embedding_status"] = "generated"
        retrieval_manifest["embedding_model"] = embedding_meta["embedding_model"]
        retrieval_manifest["embedding_dimension"] = embedding_meta["embedding_dimension"]
        retrieval_manifest["embedding_count"] = embedding_meta["embedding_count"]

    (output_dir / "retrieval_manifest.json").write_text(json.dumps(retrieval_manifest, indent=2), encoding="utf-8")
    print(f"[done] wrote retrieval assets to {output_dir}")


if __name__ == "__main__":
    main()
