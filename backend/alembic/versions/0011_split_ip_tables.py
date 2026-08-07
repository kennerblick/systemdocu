"""split servers.ip / service_instances.ip into server_ips / instance_ips

Replaces the single comma-separated ip TEXT column on servers and
service_instances with a proper one-to-many table (one row per IP),
so individual IPs get their own identity, can be uniquely constrained
per parent, and managed (added/removed) independently instead of
editing one big string.

Revision ID: 0011
Revises: 0010
Create Date: 2026-08-07
"""
from alembic import op

revision = '0011'
down_revision = '0010'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS server_ips (
            id SERIAL PRIMARY KEY,
            server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
            ip VARCHAR(45) NOT NULL,
            UNIQUE (server_id, ip)
        )
    """)
    op.execute("""
        CREATE TABLE IF NOT EXISTS instance_ips (
            id SERIAL PRIMARY KEY,
            instance_id INTEGER NOT NULL REFERENCES service_instances(id) ON DELETE CASCADE,
            ip VARCHAR(45) NOT NULL,
            UNIQUE (instance_id, ip)
        )
    """)

    op.execute("""
        INSERT INTO server_ips (server_id, ip)
        SELECT s.id, trim(ip_val)
        FROM servers s, LATERAL unnest(string_to_array(s.ip, ',')) AS ip_val
        WHERE s.ip IS NOT NULL AND trim(ip_val) <> ''
        ON CONFLICT (server_id, ip) DO NOTHING
    """)
    op.execute("""
        INSERT INTO instance_ips (instance_id, ip)
        SELECT i.id, trim(ip_val)
        FROM service_instances i, LATERAL unnest(string_to_array(i.ip, ',')) AS ip_val
        WHERE i.ip IS NOT NULL AND trim(ip_val) <> ''
        ON CONFLICT (instance_id, ip) DO NOTHING
    """)

    op.execute("ALTER TABLE servers DROP COLUMN IF EXISTS ip")
    op.execute("ALTER TABLE service_instances DROP COLUMN IF EXISTS ip")


def downgrade() -> None:
    op.execute("ALTER TABLE servers ADD COLUMN IF NOT EXISTS ip TEXT")
    op.execute("ALTER TABLE service_instances ADD COLUMN IF NOT EXISTS ip TEXT")

    op.execute("""
        UPDATE servers s SET ip = agg.joined
        FROM (
            SELECT server_id, string_agg(ip, ',' ORDER BY id) AS joined
            FROM server_ips GROUP BY server_id
        ) agg
        WHERE agg.server_id = s.id
    """)
    op.execute("""
        UPDATE service_instances i SET ip = agg.joined
        FROM (
            SELECT instance_id, string_agg(ip, ',' ORDER BY id) AS joined
            FROM instance_ips GROUP BY instance_id
        ) agg
        WHERE agg.instance_id = i.id
    """)

    op.execute("DROP TABLE IF EXISTS server_ips")
    op.execute("DROP TABLE IF EXISTS instance_ips")
