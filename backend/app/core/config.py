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
    OPENROUTER_API_KEY: str = ""

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

    CONFIDENCE_THRESHOLD: float = 0.65
    MAX_CONTEXT_CHUNKS: int = 5

    RAW_DATA_DIR: str = str(BACKEND_DIR / "data" / "raw")
    PROCESSED_DATA_DIR: str = str(BACKEND_DIR / "data" / "processed")
    SOP_OCR_MODE: str = "auto"
    SOP_PDF_RENDER_DPI: int = 150
    SOP_OCR_DPI: int = 200

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
    def has_graph_credentials(self) -> bool:
        return bool(self.NEO4J_URI and self.NEO4J_USERNAME and self.NEO4J_PASSWORD)

    @computed_field
    @property
    def has_postgres_credentials(self) -> bool:
        return bool(self.POSTGRES_HOST and self.POSTGRES_USER and self.POSTGRES_PASSWORD)


@lru_cache()
def get_settings() -> Settings:
    return Settings()
