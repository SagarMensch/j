import sys
from pathlib import Path
from sqlalchemy import text

REPO_ROOT = Path(r"c:\Users\ratho\Sequelstring AI\ingrevia").resolve()
sys.path.insert(0, str(REPO_ROOT / "backend"))

# Force fresh settings (clear any lru_cache from prior imports)
from app.core import config as cfg_mod
cfg_mod.get_settings.cache_clear()

from app.core.config import get_settings
settings = get_settings()

print("=" * 60)
print("CREDENTIALS LOADED")
print(f"  PG host : {settings.POSTGRES_HOST}")
print(f"  PG user : {settings.POSTGRES_USER}")
print(f"  Neo4j   : {settings.NEO4J_URI}")
print(f"  Neo4j DB: {settings.NEO4J_DATABASE}")
print("=" * 60)

# --- PostgreSQL ---
print("\n--- PostgreSQL Check ---")
try:
    from sqlalchemy import create_engine
    from urllib.parse import quote_plus
    pw = quote_plus(settings.POSTGRES_PASSWORD)
    dsn = f"postgresql+psycopg://{settings.POSTGRES_USER}:{pw}@{settings.POSTGRES_HOST}:{settings.POSTGRES_PORT}/{settings.POSTGRES_DB}"
    eng = create_engine(dsn, pool_pre_ping=True)
    with eng.connect() as conn:
        # Check if tables exist
        tables = conn.execute(text(
            "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name"
        )).fetchall()
        print(f"  Tables found: {len(tables)}")
        for t in tables:
            tname = t[0]
            try:
                cnt = conn.execute(text(f'SELECT count(*) FROM "{tname}"')).scalar()
                print(f"    {tname}: {cnt} rows")
            except Exception:
                print(f"    {tname}: (cannot count)")
    print("  PostgreSQL: OK")
except Exception as e:
    print(f"  PostgreSQL ERROR: {e}")

# --- Neo4j ---
print("\n--- Neo4j Check ---")
try:
    from neo4j import GraphDatabase
    driver = GraphDatabase.driver(
        settings.NEO4J_URI,
        auth=(settings.NEO4J_USERNAME, settings.NEO4J_PASSWORD),
    )
    driver.verify_connectivity()
    with driver.session(database=settings.NEO4J_DATABASE) as session:
        node_count = session.run("MATCH (n) RETURN count(n) AS c").single()["c"]
        print(f"  Total nodes: {node_count}")
        if node_count > 0:
            labels = session.run("CALL db.labels() YIELD label RETURN label").values()
            for lbl in labels:
                cnt = session.run(f"MATCH (n:`{lbl[0]}`) RETURN count(n) AS c").single()["c"]
                print(f"    :{lbl[0]} => {cnt} nodes")
        rel_count = session.run("MATCH ()-[r]->() RETURN count(r) AS c").single()["c"]
        print(f"  Total relationships: {rel_count}")
    driver.close()
    print("  Neo4j: OK")
except Exception as e:
    print(f"  Neo4j ERROR: {e}")

print("\nDone.")
