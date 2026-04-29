"""Initial schema — create all tables if they don't exist yet.

Uses SQLAlchemy's create_all with checkfirst=True so this migration is
safe to run against both a fresh database and an existing one.  The
legacy inline ALTER TABLE statements from the old startup code are also
replayed here (all guarded with IF NOT EXISTS / NOT VALID) so partially-
migrated databases converge to the canonical schema.

Revision ID: 0001
Revises:
Create Date: 2026-04-29
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()

    # Create all tables (respects existing ones via checkfirst)
    from app.models import Base
    Base.metadata.create_all(conn, checkfirst=True)

    # Replay every column addition from the old startup migrations so that
    # databases that skipped some iterations catch up gracefully.
    idempotent_ddl = [
        "ALTER TABLE environments ADD COLUMN IF NOT EXISTS subnet VARCHAR(20)",
        "ALTER TABLE environments ADD COLUMN IF NOT EXISTS gateway VARCHAR(45)",
        "ALTER TABLE environments ADD COLUMN IF NOT EXISTS default_gateway_router_id INTEGER REFERENCES internet_routers(id) ON DELETE SET NULL",
        "ALTER TABLE environments ADD COLUMN IF NOT EXISTS default_gateway_server_id INTEGER REFERENCES servers(id) ON DELETE SET NULL",
        "ALTER TABLE service_instances ADD COLUMN IF NOT EXISTS ip VARCHAR(45)",
        "ALTER TABLE service_instances ADD COLUMN IF NOT EXISTS gateway VARCHAR(45)",
        "ALTER TABLE service_instances ADD COLUMN IF NOT EXISTS gateway_router_id INTEGER REFERENCES internet_routers(id) ON DELETE SET NULL",
        "ALTER TABLE service_instances ADD COLUMN IF NOT EXISTS gateway_server_id INTEGER REFERENCES servers(id) ON DELETE SET NULL",
        "ALTER TABLE service_instances ADD COLUMN IF NOT EXISTS fqdn VARCHAR(255)",
        "ALTER TABLE service_instances ADD COLUMN IF NOT EXISTS is_gateway BOOLEAN DEFAULT FALSE",
        "ALTER TABLE service_instances ADD COLUMN IF NOT EXISTS gateway_instance_id INTEGER REFERENCES service_instances(id) ON DELETE SET NULL",
        "ALTER TABLE service_instances ADD COLUMN IF NOT EXISTS cluster_id INTEGER REFERENCES clusters(id) ON DELETE CASCADE",
        "ALTER TABLE internet_routers ADD COLUMN IF NOT EXISTS server_id INTEGER REFERENCES servers(id) ON DELETE SET NULL",
        "ALTER TABLE servers ADD COLUMN IF NOT EXISTS gateway VARCHAR(45)",
        "ALTER TABLE servers ADD COLUMN IF NOT EXISTS is_gateway BOOLEAN DEFAULT FALSE",
        "ALTER TABLE servers ADD COLUMN IF NOT EXISTS gateway_router_id INTEGER REFERENCES internet_routers(id) ON DELETE SET NULL",
        "ALTER TABLE servers ADD COLUMN IF NOT EXISTS gateway_server_id INTEGER REFERENCES servers(id) ON DELETE SET NULL",
        "ALTER TABLE services ALTER COLUMN server_id DROP NOT NULL",
        "ALTER TABLE services ADD COLUMN IF NOT EXISTS instance_id INTEGER REFERENCES service_instances(id) ON DELETE CASCADE",
        "ALTER TABLE instance_relations ADD COLUMN IF NOT EXISTS direction VARCHAR(10) NOT NULL DEFAULT 'to'",
        "ALTER TABLE instance_relations ALTER COLUMN source_instance_id DROP NOT NULL",
        "ALTER TABLE instance_relations ALTER COLUMN target_instance_id DROP NOT NULL",
        "ALTER TABLE instance_relations ADD COLUMN IF NOT EXISTS source_cluster_id INTEGER REFERENCES clusters(id) ON DELETE CASCADE",
        "ALTER TABLE instance_relations ADD COLUMN IF NOT EXISTS target_cluster_id INTEGER REFERENCES clusters(id) ON DELETE CASCADE",
        "ALTER TABLE clusters ADD COLUMN IF NOT EXISTS domain VARCHAR(255)",
        "ALTER TABLE service_instances ALTER COLUMN service_id DROP NOT NULL",
        # Migrate legacy single environment_id on internet_routers to M2M table
        """
        DO $$ BEGIN
          IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name='internet_routers' AND column_name='environment_id'
          ) THEN
            INSERT INTO router_environments (router_id, environment_id)
            SELECT id, environment_id FROM internet_routers
            WHERE environment_id IS NOT NULL
            ON CONFLICT DO NOTHING;
          END IF;
        END $$
        """,
    ]
    for sql in idempotent_ddl:
        conn.execute(sa.text(sql.strip()))


def downgrade() -> None:
    conn = op.get_bind()
    from app.models import Base
    Base.metadata.drop_all(conn)
