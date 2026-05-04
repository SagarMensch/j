import os
import sys
from sqlalchemy import create_engine, text

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from server import engine

OLD_PREFIX_1 = r"C:\Users\sagar\Downloads\Ingreia\\"
OLD_PREFIX_2 = r"C:\Users\sagar\Downloads\Ingreia\\"
# Wait, r"\\" in python creates TWO backslashes because it's a raw string!
# Let me fix that.
OLD_PREFIX_1 = "C:\\Users\\sagar\\Downloads\\Ingreia\\"
OLD_PREFIX_2 = "C:/Users/sagar/Downloads/Ingreia/"
NEW_PREFIX = "E:\\Jubilant Ingrevia\\j\\"

with engine.begin() as conn:
    rows = conn.execute(
        text("SELECT id, file_path FROM document_revisions WHERE file_path IS NOT NULL")
    ).mappings().all()

    updated_count = 0
    for row in rows:
        old_path = row["file_path"]
        new_path = old_path
        
        if old_path.startswith(OLD_PREFIX_1):
            new_path = old_path.replace(OLD_PREFIX_1, NEW_PREFIX, 1)
        elif old_path.startswith(OLD_PREFIX_2):
            new_path = old_path.replace(OLD_PREFIX_2, NEW_PREFIX.replace('\\', '/'), 1)
            new_path = new_path.replace('/', '\\')

        if new_path != old_path:
            conn.execute(
                text("UPDATE document_revisions SET file_path = :new_path WHERE id = :id"),
                {"new_path": new_path, "id": row["id"]}
            )
            updated_count += 1
            print(f"Updated:\n  From: {old_path}\n  To:   {new_path}\n")

    print(f"Total paths updated: {updated_count}")
