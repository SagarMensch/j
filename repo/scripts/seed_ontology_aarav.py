import sys
from pathlib import Path
import uuid

# Add backend to path so we can import the app modules
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from sqlalchemy import text
from app.db.postgres import engine
from app.db.neo4j import get_driver
from app.core.config import get_settings

def purge_neo4j():
    print("[PURGE] Purging existing Neo4j graph data...")
    settings = get_settings()
    driver = get_driver()
    with driver.session(database=settings.NEO4J_DATABASE) as session:
        session.run("MATCH (n) DETACH DELETE n").consume()
    print("[PURGE] Neo4j graph purged.")

def fetch_postgres_data():
    data = {}
    with engine.connect() as conn:
        # Fetch users
        users = conn.execute(text("SELECT id, employee_code, full_name, email, role, department_id FROM users")).fetchall()
        data['users'] = [dict(u._mapping) for u in users]
        
        # Fetch departments
        depts = conn.execute(text("SELECT id, name FROM departments")).fetchall()
        data['departments'] = [dict(d._mapping) for d in depts]
        
        # Fetch training modules
        modules = conn.execute(text("SELECT id, title, criticality, module_type FROM training_modules")).fetchall()
        data['modules'] = [dict(m._mapping) for m in modules]
        
        # Fetch assignments
        assignments = conn.execute(text("SELECT id, user_id, module_id, status, progress_percent FROM training_assignments")).fetchall()
        data['assignments'] = [dict(a._mapping) for a in assignments]
        
    return data

def build_ontology(data):
    print("[LOAD] Building Palantir-style Ontology in Neo4j...")
    settings = get_settings()
    driver = get_driver()
    
    # 1. Create Central Admin Node (Aarav Sharma)
    aarav_id = None
    for u in data['users']:
        if 'aarav' in str(u.get('email', '')).lower() or 'aarav' in str(u.get('full_name', '')).lower():
            aarav_id = str(u['id'])
            break
    if not aarav_id:
        aarav_id = str(uuid.uuid4())
    
    with driver.session(database=settings.NEO4J_DATABASE) as session:
        session.run("""
            MERGE (u:User {email: 'aarav.sharma@ingreia.com'})
            SET u.id = $id,
                u.full_name = 'Aarav Sharma',
                u.role = 'Super Admin',
                u.is_central_node = true
            MERGE (r:Role {name: 'Super Admin'})
            MERGE (u)-[:HAS_ROLE]->(r)
        """, {"id": aarav_id})
        print(" -> Central Node (Aarav Sharma) created.")
        
        # 2. Create Departments
        for dept in data['departments']:
            session.run("""
                MERGE (d:Department {id: $id})
                SET d.name = $name
                WITH d
                MATCH (admin:User {email: 'aarav.sharma@ingreia.com'})
                MERGE (admin)-[:OVERSEES]->(d)
            """, {"id": str(dept['id']), "name": dept['name']})
        print(f" -> {len(data['departments'])} Departments created and linked to Admin.")
            
        # 3. Create Users and Roles
        for user in data['users']:
            if str(user['id']) == aarav_id:
                continue
            
            session.run("""
                MERGE (u:User {id: $id})
                SET u.full_name = $full_name,
                    u.email = $email,
                    u.employee_code = $employee_code
                    
                MERGE (r:Role {name: $role})
                MERGE (u)-[:HAS_ROLE]->(r)
            """, {
                "id": str(user['id']),
                "full_name": user['full_name'],
                "email": user['email'],
                "employee_code": user['employee_code'] or '',
                "role": user['role']
            })
            
            # Logic: If user is Admin, they supervise Aarav. Otherwise, Aarav supervises them.
            is_admin = 'admin' in str(user['full_name']).lower() or 'admin' in str(user['role']).lower()
            
            if is_admin:
                session.run("""
                    MATCH (u:User {id: $id})
                    MATCH (aarav:User {email: 'aarav.sharma@ingreia.com'})
                    MERGE (u)-[:SUPERVISES]->(aarav)
                    MERGE (aarav)-[:REPORTS_TO]->(u)
                """, {"id": str(user['id'])})
            else:
                session.run("""
                    MATCH (u:User {id: $id})
                    MATCH (aarav:User {email: 'aarav.sharma@ingreia.com'})
                    MERGE (u)-[:REPORTS_TO]->(aarav)
                    MERGE (aarav)-[:SUPERVISES]->(u)
                """, {"id": str(user['id'])})
            
            if user['department_id']:
                session.run("""
                    MATCH (u:User {id: $user_id})
                    MATCH (d:Department {id: $dept_id})
                    MERGE (u)-[:BELONGS_TO]->(d)
                """, {"user_id": str(user['id']), "dept_id": str(user['department_id'])})
                
        print(f" -> {len(data['users'])} Users created and linked to Central Node.")
        
        # 4. Create Training Modules
        for mod in data['modules']:
            session.run("""
                MERGE (tm:TrainingModule {id: $id})
                SET tm.title = $title,
                    tm.criticality = $criticality,
                    tm.module_type = $module_type
            """, {
                "id": str(mod['id']),
                "title": mod['title'],
                "criticality": mod['criticality'],
                "module_type": mod['module_type']
            })
        print(f" -> {len(data['modules'])} Training Modules created.")
            
        # 5. Create Assignments
        for assign in data['assignments']:
            session.run("""
                MATCH (u:User {id: $user_id})
                MATCH (tm:TrainingModule {id: $module_id})
                MERGE (u)-[rel:ASSIGNED_TO]->(tm)
                SET rel.status = $status,
                    rel.progress_percent = $progress_percent
            """, {
                "user_id": str(assign['user_id']),
                "module_id": str(assign['module_id']),
                "status": assign['status'],
                "progress_percent": assign['progress_percent']
            })
        print(f" -> {len(data['assignments'])} Assignments mapped as edges.")
            
    print("[LOAD] Palantir-style Ontology successfully seeded to Neo4j!")

def verify_load():
    settings = get_settings()
    driver = get_driver()
    with driver.session(database=settings.NEO4J_DATABASE) as session:
        nodes = session.run("MATCH (n) RETURN count(n) as c").single()['c']
        edges = session.run("MATCH ()-[r]->() RETURN count(r) as c").single()['c']
        print(f"[VERIFY] Neo4j Graph now contains {nodes} nodes and {edges} edges.")

def main():
    purge_neo4j()
    data = fetch_postgres_data()
    build_ontology(data)
    verify_load()

if __name__ == "__main__":
    main()
