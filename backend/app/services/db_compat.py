from __future__ import annotations

from sqlalchemy import text

from app.db.postgres import engine


DDL_STATEMENTS = (
    "ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS bbox_x0 double precision",
    "ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS bbox_y0 double precision",
    "ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS bbox_x1 double precision",
    "ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS bbox_y1 double precision",
    "ALTER TABLE document_revisions ADD COLUMN IF NOT EXISTS approval_status text",
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
)


def ensure_database_compatibility() -> None:
    with engine.begin() as conn:
        for statement in DDL_STATEMENTS:
            conn.execute(text(statement))
