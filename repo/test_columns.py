import os
from pathlib import Path
from urllib.parse import quote_plus
from sqlalchemy import create_engine, text

env_path = Path('backend/.env')
env = {}
if env_path.exists():
    for line in env_path.read_text(encoding='utf-8').splitlines():
        if '=' in line and not line.startswith('#'):
            k, v = line.split('=', 1)
            env[k.strip()] = v.strip()

pw = quote_plus(env.get('POSTGRES_PASSWORD', ''))
dsn = f"postgresql+psycopg://{env.get('POSTGRES_USER')}:{pw}@{env.get('POSTGRES_HOST')}:{env.get('POSTGRES_PORT')}/{env.get('POSTGRES_DB')}"
eng = create_engine(dsn)
with eng.connect() as conn:
    res = conn.execute(text("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'chat_messages'")).fetchall()
    print('Columns in chat_messages:')
    for r in res:
        print(f'  - {r[0]}: {r[1]}')
