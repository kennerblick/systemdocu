"""add server_applications join table

Lets a whole Server be assigned directly to an Application, for hosts
that are entirely dedicated to one application rather than only some of
their service instances — mirrors server_environments.

Revision ID: 0009
Revises: 0008
Create Date: 2026-08-05
"""
from alembic import op

revision = '0009'
down_revision = '0008'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS server_applications (
            server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
            application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
            PRIMARY KEY (server_id, application_id)
        )
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS server_applications")
