from functools import lru_cache
from pathlib import Path
from urllib.parse import quote_plus

from pydantic import computed_field
from pydantic_settings import BaseSettings, SettingsConfigDict


BACKEND_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BACKEND_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    APP_NAME: str = "Jubilant Ingrevia Plant Assistant"
    DEBUG: bool = True

    GROQ_API_KEY: str = ""
    GROQ_MODEL: str = "llama-3.3-70b-versatile"
    PRIMARY_LLM_PROVIDER: str = "nvidia"
    PRIMARY_LLM_API_BASE: str = "https://integrate.api.nvidia.com/v1"
    PRIMARY_LLM_API_KEY: str = ""
    PRIMARY_LLM_MODEL: str = "z-ai/glm-5.1"
    PRIMARY_LLM_TIMEOUT_SECONDS: float = 10.0
    PRIMARY_LLM_ENABLE_THINKING: bool = False
    OPENROUTER_API_KEY: str = ""
    OPENROUTER_BASE_URL: str = "https://openrouter.ai/api/v1/chat/completions"
    OPENROUTER_VLM_MODEL: str = "nvidia/nemotron-nano-12b-v2-vl:free"

    NVIDIA_API_BASE_URL: str = "https://integrate.api.nvidia.com/v1"
    NVIDIA_RERANK_BASE_URL: str = "https://ai.api.nvidia.com/v1/retrieval"
    NVIDIA_EMBED_API_KEY: str = ""
    NVIDIA_EMBED_MODEL: str = "nvidia/llama-nemotron-embed-1b-v2"
    NVIDIA_RERANK_API_KEY: str = ""
    NVIDIA_RERANK_MODEL: str = "nvidia/llama-nemotron-rerank-1b-v2"
    NVIDIA_EMBED_VL_API_KEY: str = ""
    NVIDIA_EMBED_VL_MODEL: str = "nvidia/llama-nemotron-embed-vl-1b-v2"
    NVIDIA_RERANK_VL_API_KEY: str = ""
    NVIDIA_RERANK_VL_MODEL: str = "nvidia/llama-nemotron-rerank-vl-1b-v2"
    NVIDIA_OCR_API_KEY: str = ""
    NVIDIA_OCR_MODEL: str = "nvidia/nemotron-ocr-v1"
    NVIDIA_CONTENT_SAFETY_API_KEY: str = ""
    NVIDIA_CONTENT_SAFETY_MODEL: str = "nvidia/nemotron-3-content-safety"
    NVIDIA_HTTP_TIMEOUT_SECONDS: float = 30.0
    NVIDIA_CONTENT_SAFETY_TIMEOUT_SECONDS: float = 8.0
    NVIDIA_RERANK_TIMEOUT_SECONDS: float = 15.0
    NVIDIA_OCR_TIMEOUT_SECONDS: float = 60.0

    MISTRAL_API_KEY: str = ""
    MISTRAL_BASE_URL: str = "https://api.mistral.ai/v1"
    MISTRAL_MODEL: str = "mistral-small-latest"

    SARVAM_API_KEY: str = ""
    SARVAM_STT_URL: str = "https://api.sarvam.ai/speech-to-text"
    SARVAM_TTS_URL: str = "https://api.sarvam.ai/text-to-speech"
    SARVAM_TRANSLATE_URL: str = "https://api.sarvam.ai/translate"
    SARVAM_TTS_MODEL: str = "bulbul:v3"
    SARVAM_STT_MODEL: str = "saaras:v3"
    SARVAM_TRANSLATE_MODEL: str = "mayura:v1"
    SARVAM_TRANSLATE_MODE: str = "modern-colloquial"

    POSTGRES_HOST: str = "aws-1-ap-northeast-2.pooler.supabase.com"
    POSTGRES_PORT: int = 5432
    POSTGRES_DB: str = "postgres"
    POSTGRES_USER: str = "postgres.icketsnicvszewuzeyee"
    POSTGRES_PASSWORD: str = ""
    POSTGRES_POOL_SIZE: int = 5
    POSTGRES_MAX_OVERFLOW: int = 10

    NEO4J_URI: str = "bolt://localhost:7687"
    NEO4J_USERNAME: str = "neo4j"
    NEO4J_PASSWORD: str = ""
    NEO4J_DATABASE: str = "neo4j"

    QDRANT_URL: str = "http://localhost:6333"
    QDRANT_COLLECTION: str = "sop_documents"
    EMBEDDING_MODEL: str = "sentence-transformers/all-MiniLM-L6-v2"
    EMBEDDING_PROVIDER: str = "nvidia"
    HF_TOKEN: str = ""

    CONFIDENCE_THRESHOLD: float = 0.65
    MAX_CONTEXT_CHUNKS: int = 5
    RETRIEVAL_RERANKER_MODE: str = "light"
    RETRIEVAL_RERANKER_PROVIDER: str = "nvidia"
    RETRIEVAL_RERANKER_MODEL: str = "cross-encoder/ms-marco-MiniLM-L-6-v2"
    RETRIEVAL_RERANKER_BATCH_SIZE: int = 12
    CONTENT_SAFETY_PROVIDER: str = "nvidia"

    RAW_DATA_DIR: str = str(BACKEND_DIR / "data" / "raw")
    PROCESSED_DATA_DIR: str = str(BACKEND_DIR / "data" / "processed")
    SOP_OCR_MODE: str = "auto"
    SOP_OCR_PROVIDER: str = "nvidia"
    SOP_PDF_RENDER_DPI: int = 150
    SOP_OCR_DPI: int = 200
    SOP_OCR_MIN_TEXT_CHARS: int = 160
    SOP_OCR_CONFIDENCE_FLOOR: float = 0.72
    SOP_VLM_PAGE_LIMIT: int = 12

    @computed_field
    @property
    def postgres_dsn(self) -> str:
        password = quote_plus(self.POSTGRES_PASSWORD)
        return (
            f"postgresql+psycopg://{self.POSTGRES_USER}:{password}"
            f"@{self.POSTGRES_HOST}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"
        )

    @computed_field
    @property
    def has_voice_credentials(self) -> bool:
        return bool(self.GROQ_API_KEY and self.SARVAM_API_KEY)

    @computed_field
    @property
    def has_primary_llm_credentials(self) -> bool:
        return bool(self.PRIMARY_LLM_API_KEY)

    @computed_field
    @property
    def has_openrouter_credentials(self) -> bool:
        return bool(self.OPENROUTER_API_KEY)

    @computed_field
    @property
    def has_mistral_credentials(self) -> bool:
        return bool(self.MISTRAL_API_KEY)

    @computed_field
    @property
    def has_nvidia_embedding_credentials(self) -> bool:
        return bool(self.NVIDIA_EMBED_API_KEY)

    @computed_field
    @property
    def has_nvidia_rerank_credentials(self) -> bool:
        return bool(self.NVIDIA_RERANK_API_KEY)

    @computed_field
    @property
    def has_nvidia_ocr_credentials(self) -> bool:
        return bool(self.NVIDIA_OCR_API_KEY)

    @computed_field
    @property
    def has_nvidia_content_safety_credentials(self) -> bool:
        return bool(self.NVIDIA_CONTENT_SAFETY_API_KEY)

    @computed_field
    @property
    def has_graph_credentials(self) -> bool:
        return bool(self.NEO4J_URI and self.NEO4J_USERNAME and self.NEO4J_PASSWORD)

    @computed_field
    @property
    def has_postgres_credentials(self) -> bool:
        return bool(self.POSTGRES_HOST and self.POSTGRES_USER and self.POSTGRES_PASSWORD)


@lru_cache()
def get_settings() -> Settings:
    return Settings()
