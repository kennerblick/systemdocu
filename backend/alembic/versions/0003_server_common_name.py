"""add common_name to servers

Revision ID: 0003
Revises: 0002
Create Date: 2026-05-06
"""
from alembic import op
import sqlalchemy as sa

revision = '0003'
down_revision = '0002'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE servers ADD COLUMN IF NOT EXISTS common_name VARCHAR(255)"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE servers DROP COLUMN IF EXISTS common_name")
