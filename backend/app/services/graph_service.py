from app.core.config import get_settings
from app.db.neo4j import get_driver


GRAPH_CONSTRAINTS = (
    "CREATE CONSTRAINT document_id IF NOT EXISTS FOR (n:Document) REQUIRE n.id IS UNIQUE",
    "CREATE CONSTRAINT document_revision_id IF NOT EXISTS FOR (n:DocumentRevision) REQUIRE n.id IS UNIQUE",
    "CREATE CONSTRAINT document_chunk_id IF NOT EXISTS FOR (n:DocumentChunk) REQUIRE n.id IS UNIQUE",
    "CREATE CONSTRAINT training_module_id IF NOT EXISTS FOR (n:TrainingModule) REQUIRE n.id IS UNIQUE",
    "CREATE CONSTRAINT training_step_id IF NOT EXISTS FOR (n:TrainingStep) REQUIRE n.id IS UNIQUE",
    "CREATE CONSTRAINT assessment_id IF NOT EXISTS FOR (n:Assessment) REQUIRE n.id IS UNIQUE",
    "CREATE CONSTRAINT user_id IF NOT EXISTS FOR (n:User) REQUIRE n.id IS UNIQUE",
)


def bootstrap_knowledge_graph() -> dict:
    settings = get_settings()
    driver = get_driver()
    applied = []

    with driver.session(database=settings.NEO4J_DATABASE) as session:
        for statement in GRAPH_CONSTRAINTS:
            session.run(statement).consume()
            applied.append(statement)

        session.run(
            """
            MERGE (platform:Platform {name: 'Jubilant Ingrevia AI Platform'})
            SET platform.updated_at = datetime()
            """
        ).consume()

    return {"status": "ok", "constraints_applied": len(applied)}
