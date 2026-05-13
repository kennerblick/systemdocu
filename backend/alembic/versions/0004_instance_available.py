"""add available flag to service_instances

Revision ID: 0004
Revises: 0003
Create Date: 2026-05-13
"""
from alembic import op

revision = '0004'
down_revision = '0003'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE service_instances ADD COLUMN IF NOT EXISTS available BOOLEAN NOT NULL DEFAULT TRUE"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE service_instances DROP COLUMN IF EXISTS available")
