from __future__ import annotations

from sqlalchemy import text

from app.db.postgres import engine


LEGACY_COLUMN_PATCHES = (
    ("document_chunks", "bbox_x0", "double precision"),
    ("document_chunks", "bbox_y0", "double precision"),
    ("document_chunks", "bbox_x1", "double precision"),
    ("document_chunks", "bbox_y1", "double precision"),
    ("document_revisions", "approval_status", "text"),
    ("extracted_pages", "vl_embedding", "vector(2048)"),
    ("extracted_pages", "vl_embedding_model", "text"),
)


MANDATORY_DDL_STATEMENTS = (
    """
    CREATE TABLE IF NOT EXISTS app_settings (
        setting_key text primary key,
        setting_value jsonb not null,
        updated_at timestamptz not null default now()
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS notifications (
        id uuid primary key default gen_random_uuid(),
        user_id uuid not null references users(id) on delete cascade,
        event_type text not null,
        severity text not null default 'info',
        title text not null,
        message text not null,
        cta_url text,
        channel text not null default 'in_app',
        event_key text unique,
        status text not null default 'unread',
        created_at timestamptz not null default now(),
        read_at timestamptz
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_notifications_user_status ON notifications(user_id, status)",
    """
    CREATE TABLE IF NOT EXISTS notification_delivery_logs (
        id uuid primary key default gen_random_uuid(),
        notification_id uuid not null references notifications(id) on delete cascade,
        channel text not null,
        delivery_status text not null default 'delivered',
        delivered_at timestamptz not null default now(),
        error_message text
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_notification_delivery_logs_notification ON notification_delivery_logs(notification_id)",
    """
    CREATE TABLE IF NOT EXISTS admin_audit_logs (
        id uuid primary key default gen_random_uuid(),
        actor_user_id uuid references users(id),
        action text not null,
        target_type text,
        target_id text,
        details jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now()
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_actor_created ON admin_audit_logs(actor_user_id, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_action_created ON admin_audit_logs(action, created_at DESC)",
    """
    CREATE TABLE IF NOT EXISTS guardrail_appeals (
        id uuid primary key default gen_random_uuid(),
        incident_id uuid not null references admin_audit_logs(id) on delete cascade,
        user_id uuid not null references users(id) on delete cascade,
        appeal_text text not null,
        status text not null default 'pending',
        reviewed_by_user_id uuid references users(id),
        resolution_notes text,
        created_at timestamptz not null default now(),
        reviewed_at timestamptz
    )
    """,
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_guardrail_appeals_incident_user ON guardrail_appeals(incident_id, user_id)",
    "CREATE INDEX IF NOT EXISTS idx_guardrail_appeals_status_created ON guardrail_appeals(status, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_guardrail_appeals_user_created ON guardrail_appeals(user_id, created_at DESC)",
    """
    CREATE TABLE IF NOT EXISTS chat_conversations (
        id uuid primary key default gen_random_uuid(),
        user_id uuid not null references users(id) on delete cascade,
        title text not null,
        language text not null default 'en',
        status text not null default 'active',
        metadata jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        last_message_at timestamptz not null default now()
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_chat_conversations_user_last_message ON chat_conversations(user_id, last_message_at DESC)",
    """
    CREATE TABLE IF NOT EXISTS chat_messages (
        id uuid primary key default gen_random_uuid(),
        conversation_id uuid not null references chat_conversations(id) on delete cascade,
        message_order integer not null,
        role text not null,
        content text not null,
        language text,
        citations jsonb not null default '[]'::jsonb,
        query_text text,
        retrieval_event_id uuid,
        response_mode text not null default 'text',
        created_at timestamptz not null default now()
    )
    """,
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_messages_conversation_order ON chat_messages(conversation_id, message_order)",
    "CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation_created ON chat_messages(conversation_id, created_at)",
    """
    CREATE TABLE IF NOT EXISTS chat_reader_conversations (
        id uuid primary key default gen_random_uuid(),
        user_id uuid not null references users(id) on delete cascade,
        title text not null,
        language text not null default 'en',
        status text not null default 'active',
        metadata jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        last_message_at timestamptz not null default now()
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_chat_reader_conversations_user_last_message ON chat_reader_conversations(user_id, last_message_at DESC)",
    """
    CREATE TABLE IF NOT EXISTS chat_reader_messages (
        id uuid primary key default gen_random_uuid(),
        conversation_id uuid not null references chat_reader_conversations(id) on delete cascade,
        message_order integer not null,
        role text not null,
        content text not null,
        language text,
        citations jsonb not null default '[]'::jsonb,
        query_text text,
        retrieval_event_id uuid,
        response_mode text not null default 'text',
        created_at timestamptz not null default now()
    )
    """,
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_reader_messages_conversation_order ON chat_reader_messages(conversation_id, message_order)",
    "CREATE INDEX IF NOT EXISTS idx_chat_reader_messages_conversation_created ON chat_reader_messages(conversation_id, created_at)",
)


NON_BLOCKING_BACKFILL_STATEMENTS = (
    """
    INSERT INTO chat_reader_conversations (
        id, user_id, title, language, status, metadata, created_at, updated_at, last_message_at
    )
    SELECT
        c.id,
        c.user_id,
        c.title,
        c.language,
        c.status,
        jsonb_set(COALESCE(c.metadata, '{}'::jsonb), '{scope}', '"reader"'::jsonb, true),
        c.created_at,
        c.updated_at,
        c.last_message_at
    FROM chat_conversations c
    WHERE COALESCE(c.metadata->>'scope', 'general') = 'reader'
    ON CONFLICT (id) DO NOTHING
    """,
    """
    INSERT INTO chat_reader_messages (
        id, conversation_id, message_order, role, content, language, citations, query_text, retrieval_event_id, response_mode, created_at
    )
    SELECT
        m.id,
        m.conversation_id,
        m.message_order,
        m.role,
        m.content,
        m.language,
        m.citations,
        m.query_text,
        m.retrieval_event_id,
        m.response_mode,
        m.created_at
    FROM chat_messages m
    INNER JOIN chat_conversations c
        ON c.id = m.conversation_id
    WHERE COALESCE(c.metadata->>'scope', 'general') = 'reader'
    ON CONFLICT (id) DO NOTHING
    """,
)


OPTIONAL_INDEX_STATEMENTS = (
    # Retrieval hot path indexes.
    "CREATE INDEX IF NOT EXISTS idx_document_revisions_latest_approved ON document_revisions(is_latest_approved) WHERE is_latest_approved = true",
    "CREATE INDEX IF NOT EXISTS idx_document_chunks_revision_created ON document_chunks(revision_id, created_at DESC)",
    """
    CREATE INDEX IF NOT EXISTS idx_document_chunks_fts
    ON document_chunks
    USING GIN (
        to_tsvector(
            'simple',
            coalesce(content, '') || ' ' || coalesce(section_title, '') || ' ' || coalesce(citation_label, '')
        )
    )
    """,
)


def ensure_database_compatibility() -> None:
    with engine.begin() as conn:
        for table_name, column_name, data_type in LEGACY_COLUMN_PATCHES:
            column_exists = conn.execute(
                text(
                    """
                    SELECT 1
                    FROM information_schema.columns
                    WHERE table_schema = 'public'
                      AND table_name = :table_name
                      AND column_name = :column_name
                    LIMIT 1
                    """
                ),
                {"table_name": table_name, "column_name": column_name},
            ).first()
            if column_exists:
                continue
            conn.execute(
                text(
                    f"ALTER TABLE {table_name} ADD COLUMN IF NOT EXISTS {column_name} {data_type}"
                )
            )

        for statement in MANDATORY_DDL_STATEMENTS:
            conn.execute(text(statement))

        for statement in NON_BLOCKING_BACKFILL_STATEMENTS:
            try:
                conn.execute(text(statement))
            except Exception as exc:
                print(f"[db_compat] Backfill skipped: {exc}")

        for statement in OPTIONAL_INDEX_STATEMENTS:
            try:
                conn.execute(text(statement))
            except Exception as exc:
                print(f"[db_compat] Optional index skipped: {exc}")
