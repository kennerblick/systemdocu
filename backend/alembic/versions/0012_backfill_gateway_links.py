"""backfill router_environments / server_environments for existing default gateways

environments.default_gateway_router_id / default_gateway_server_id could be
set independently of router_environments / server_environments (the tables
that gateway-candidate dropdowns actually filter by), so an environment
could have a "configured" default gateway that never showed up as an
option on its members' servers. The app now keeps these in sync going
forward (see routers/environments.py _ensure_gateway_linked) — this
migration backfills the links for environments saved before that fix.

Revision ID: 0012
Revises: 0011
Create Date: 2026-08-07
"""
from alembic import op

revision = '0012'
down_revision = '0011'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        INSERT INTO router_environments (router_id, environment_id)
        SELECT e.default_gateway_router_id, e.id
        FROM environments e
        WHERE e.default_gateway_router_id IS NOT NULL
        ON CONFLICT DO NOTHING
    """)
    op.execute("""
        INSERT INTO server_environments (server_id, environment_id)
        SELECT e.default_gateway_server_id, e.id
        FROM environments e
        WHERE e.default_gateway_server_id IS NOT NULL
        ON CONFLICT DO NOTHING
    """)


def downgrade() -> None:
    # Backfilled links are indistinguishable from manually-added ones —
    # nothing to safely revert.
    pass
