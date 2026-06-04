"""add storages table and storage_id to service_instances

Revision ID: 0005
Revises: 0004
Create Date: 2026-06-04
"""
from alembic import op

revision = '0005'
down_revision = '0004'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS storages (
            id SERIAL PRIMARY KEY,
            server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
            name VARCHAR(255) NOT NULL,
            raid_type VARCHAR(50),
            disk_count INTEGER,
            size_gb INTEGER,
            description TEXT
        )
    """)
    op.execute(
        "ALTER TABLE service_instances ADD COLUMN IF NOT EXISTS storage_id INTEGER REFERENCES storages(id) ON DELETE SET NULL"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE service_instances DROP COLUMN IF EXISTS storage_id")
    op.execute("DROP TABLE IF EXISTS storages")
