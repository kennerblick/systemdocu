"""add inherit_to_instances flag to server_applications

Assigning an Application to a whole Server used to unconditionally show
that application as "inherited" on every service/instance of that server
(in filters and the Excel export) — surprising when someone tags a server
just for inventory purposes and every existing service/instance suddenly
appears to carry that application too. Adds an explicit opt-in flag,
defaulting to False for new assignments; existing assignments are
backfilled to True to preserve their current (relied-upon) behavior.

Revision ID: 0013
Revises: 0012
Create Date: 2026-08-10
"""
from alembic import op

revision = '0013'
down_revision = '0012'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE server_applications "
        "ADD COLUMN IF NOT EXISTS inherit_to_instances BOOLEAN NOT NULL DEFAULT false"
    )
    # Preserve today's behavior for assignments made before this flag existed —
    # only NEW assignments default to not inheriting.
    op.execute("UPDATE server_applications SET inherit_to_instances = true")


def downgrade() -> None:
    op.execute("ALTER TABLE server_applications DROP COLUMN IF EXISTS inherit_to_instances")
