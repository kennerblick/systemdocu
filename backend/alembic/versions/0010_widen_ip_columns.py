"""widen ip columns to support many comma-separated addresses

servers.ip and service_instances.ip were VARCHAR(45) — enough for one or
two IPv4 addresses, but the UI/README advertise entering multiple
comma-separated IPs per server/instance, which silently 500'd once the
combined string exceeded 45 chars (Postgres "value too long" error).

Revision ID: 0010
Revises: 0009
Create Date: 2026-08-07
"""
from alembic import op

revision = '0010'
down_revision = '0009'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Guarded: on a brand-new database, migration 0001 creates the schema from
    # the *current* models.py (via Base.metadata.create_all), which by now
    # already has no servers.ip / service_instances.ip column — 0011 replaced
    # it with server_ips/instance_ips. Without this guard, a fresh install
    # fails here since the column this migration widens never existed.
    op.execute("""
        DO $$ BEGIN
          IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name='servers' AND column_name='ip'
          ) THEN
            ALTER TABLE servers ALTER COLUMN ip TYPE TEXT;
          END IF;
        END $$
    """)
    op.execute("""
        DO $$ BEGIN
          IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name='service_instances' AND column_name='ip'
          ) THEN
            ALTER TABLE service_instances ALTER COLUMN ip TYPE TEXT;
          END IF;
        END $$
    """)


def downgrade() -> None:
    op.execute("ALTER TABLE servers ALTER COLUMN ip TYPE VARCHAR(45)")
    op.execute("ALTER TABLE service_instances ALTER COLUMN ip TYPE VARCHAR(45)")
