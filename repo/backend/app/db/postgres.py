from sqlalchemy import create_engine, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.core.config import get_settings


settings = get_settings()


class Base(DeclarativeBase):
    pass


engine = create_engine(
    settings.postgres_dsn,
    pool_pre_ping=True,
    pool_size=settings.POSTGRES_POOL_SIZE,
    max_overflow=settings.POSTGRES_MAX_OVERFLOW,
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def check_postgres_connection() -> dict:
    with engine.connect() as connection:
        server_time = connection.execute(text("SELECT NOW()")).scalar_one()
    return {
        "status": "ok",
        "server_time": server_time.isoformat(),
        "database": settings.POSTGRES_DB,
        "host": settings.POSTGRES_HOST,
    }


def init_postgres() -> None:
    import app.models.relational  # noqa: F401

    Base.metadata.create_all(bind=engine)
