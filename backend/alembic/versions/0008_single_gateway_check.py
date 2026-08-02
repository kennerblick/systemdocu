"""enforce at most one gateway target per row

A server/instance/environment must point at exactly one gateway target
(router, plain server, or — for instances — another instance), never
several at once — see the matching _SingleGatewayMixin in schemas.py.
That Pydantic validator only catches full Create payloads and requests
that explicitly conflict; a partial PATCH that sets one field while an
older value lingers in another column would slip past it. These CHECK
constraints are the actual, unconditional guarantee.

Revision ID: 0008
Revises: 0007
Create Date: 2026-08-02
"""
from alembic import op

revision = '0008'
down_revision = '0007'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE servers ADD CONSTRAINT ck_servers_single_gateway "
        "CHECK (num_nonnulls(gateway_router_id, gateway_server_id) <= 1)"
    )
    op.execute(
        "ALTER TABLE service_instances ADD CONSTRAINT ck_instances_single_gateway "
        "CHECK (num_nonnulls(gateway_router_id, gateway_server_id, gateway_instance_id) <= 1)"
    )
    op.execute(
        "ALTER TABLE environments ADD CONSTRAINT ck_environments_single_default_gateway "
        "CHECK (num_nonnulls(default_gateway_router_id, default_gateway_server_id) <= 1)"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE servers DROP CONSTRAINT IF EXISTS ck_servers_single_gateway")
    op.execute("ALTER TABLE service_instances DROP CONSTRAINT IF EXISTS ck_instances_single_gateway")
    op.execute("ALTER TABLE environments DROP CONSTRAINT IF EXISTS ck_environments_single_default_gateway")
