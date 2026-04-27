from functools import lru_cache

from neo4j import GraphDatabase

from app.core.config import get_settings


@lru_cache()
def get_driver():
    settings = get_settings()
    return GraphDatabase.driver(
        settings.NEO4J_URI,
        auth=(settings.NEO4J_USERNAME, settings.NEO4J_PASSWORD),
    )


def check_neo4j_connection() -> dict:
    settings = get_settings()
    driver = get_driver()
    driver.verify_connectivity()
    with driver.session(database=settings.NEO4J_DATABASE) as session:
        record = session.run("RETURN datetime() AS now").single()
    return {
        "status": "ok",
        "database": settings.NEO4J_DATABASE,
        "server_time": str(record["now"]),
        "uri": settings.NEO4J_URI,
    }
