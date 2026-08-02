"""drop unused tags / server_tags tables

The tags feature was never wired up (router imported schemas that didn't
exist and was never registered in main.py) and the frontend never
referenced it. Removing the dead ORM models here; this drops the tables
in case the startup create_all safety net already created them.

Revision ID: 0007
Revises: 0006
Create Date: 2026-08-02
"""
from alembic import op

revision = '0007'
down_revision = '0006'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("DROP TABLE IF EXISTS server_tags")
    op.execute("DROP TABLE IF EXISTS tags")


def downgrade() -> None:
    op.execute(
        "CREATE TABLE IF NOT EXISTS tags ("
        "id SERIAL PRIMARY KEY, "
        "name VARCHAR(100) UNIQUE NOT NULL, "
        "color VARCHAR(7) DEFAULT '#888888')"
    )
    op.execute(
        "CREATE TABLE IF NOT EXISTS server_tags ("
        "server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE, "
        "tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE, "
        "PRIMARY KEY (server_id, tag_id))"
    )
