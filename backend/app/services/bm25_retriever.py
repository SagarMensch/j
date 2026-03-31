import re
from typing import Any

from rank_bm25 import BM25Okapi
from sqlalchemy import text

from app.db.postgres import engine


class BM25Retriever:
    def __init__(self, max_chunks: int = 10000):
        self.max_chunks = max_chunks
        self.chunks = []
        self.bm25 = None
        self.chunk_metadata = []

    def load_chunks(self, query: str = None):
        where_clause = """
            WHERE dc.content IS NOT NULL AND length(dc.content) > 30
              AND dr.is_latest_approved = true
        """
        params = {}

        query_sql = f"""
            SELECT
                dc.id::text as chunk_id,
                dc.content,
                d.code as document_code,
                d.title as document_title,
                dr.id::text as revision_id,
                dr.revision_label,
                dc.page_start,
                dc.page_end,
                dc.citation_label,
                dc.section_title,
                dc.block_ids,
                dc.bbox_x0,
                dc.bbox_y0,
                dc.bbox_x1,
                dc.bbox_y1
            FROM document_chunks dc
            JOIN document_revisions dr ON dc.revision_id = dr.id
            JOIN documents d ON dr.document_id = d.id
            {where_clause}
            LIMIT {self.max_chunks}
        """

        with engine.connect() as conn:
            result = conn.execute(text(query_sql), params)

            rows = result.mappings().all()

            self.chunks = []
            self.chunk_metadata = []

            for row in rows:
                content = row["content"]
                self.chunks.append(self._tokenize(content))
                self.chunk_metadata.append(dict(row))

        if self.chunks:
            self.bm25 = BM25Okapi(self.chunks)

    def _tokenize(self, text: str) -> list[str]:
        if not text:
            return []
        text = text.lower()
        text = re.sub(r'[^\w\s]', ' ', text)
        tokens = text.split()
        return [t for t in tokens if len(t) > 1]

    def search(self, query: str, top_k: int = 5) -> list[dict[str, Any]]:
        self.load_chunks(query)

        if not self.bm25 or not self.chunks:
            return []

        query_tokens = self._tokenize(query)

        scores = self.bm25.get_scores(query_tokens)

        top_indices = sorted(range(len(scores)), key=lambda i: scores[i], reverse=True)[:top_k]

        results = []
        for idx in top_indices:
            if scores[idx] > 0:
                meta = self.chunk_metadata[idx]
                results.append({
                    "chunk_id": meta["chunk_id"],
                    "document_code": meta["document_code"],
                    "document_title": meta["document_title"],
                    "revision_id": meta["revision_id"],
                    "revision_label": meta["revision_label"],
                    "page_start": meta["page_start"],
                    "page_end": meta["page_end"],
                    "citation_label": meta["citation_label"],
                    "section_title": meta["section_title"],
                    "block_ids": meta.get("block_ids") or [],
                    "content": meta["content"],
                    "bbox_x0": meta.get("bbox_x0"),
                    "bbox_y0": meta.get("bbox_y0"),
                    "bbox_x1": meta.get("bbox_x1"),
                    "bbox_y1": meta.get("bbox_y1"),
                    "bm25_score": round(scores[idx], 4)
                })

        return results


_bm25_retriever = None


def get_bm25_retriever() -> BM25Retriever:
    global _bm25_retriever
    if _bm25_retriever is None:
        _bm25_retriever = BM25Retriever()
    return _bm25_retriever


def refresh_bm25_index():
    global _bm25_retriever
    _bm25_retriever = BM25Retriever()
