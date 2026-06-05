"""add disk_size_tb to storages

Revision ID: 0006
Revises: 0005
Create Date: 2026-06-05
"""
from alembic import op

revision = '0006'
down_revision = '0005'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE storages ADD COLUMN IF NOT EXISTS disk_size_tb INTEGER"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE storages DROP COLUMN IF EXISTS disk_size_tb")
