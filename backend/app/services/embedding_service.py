from functools import lru_cache

from app.core.config import get_settings


@lru_cache(maxsize=1)
def get_embedding_model():
    from sentence_transformers import SentenceTransformer
    
    settings = get_settings()
    model_name = settings.EMBEDDING_MODEL or "sentence-transformers/all-MiniLM-L6-v2"
    return SentenceTransformer(model_name, device="cpu")


def embed_texts(texts: list[str]) -> list[list[float]]:
    if not texts:
        return []
    
    model = get_embedding_model()
    embeddings = model.encode(texts, normalize_embeddings=True, show_progress_bar=False)
    return embeddings.tolist()


def embed_query(query: str) -> list[float]:
    model = get_embedding_model()
    embedding = model.encode([query], normalize_embeddings=True)[0]
    return embedding.tolist()
