"""Add FK indexes and check constraints for data integrity and query performance.

All DDL is guarded so it can be re-run safely on databases that already
have some of these objects.

Revision ID: 0002
Revises: 0001
Create Date: 2026-04-29
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# (index_name, table, column)
_FK_INDEXES = [
    ("ix_services_server_id",                   "services",            "server_id"),
    ("ix_services_instance_id",                 "services",            "instance_id"),
    ("ix_service_instances_service_id",         "service_instances",   "service_id"),
    ("ix_service_instances_cluster_id",         "service_instances",   "cluster_id"),
    ("ix_service_instances_gateway_router_id",  "service_instances",   "gateway_router_id"),
    ("ix_service_instances_gateway_server_id",  "service_instances",   "gateway_server_id"),
    ("ix_service_instances_gateway_instance_id","service_instances",   "gateway_instance_id"),
    ("ix_servers_gateway_router_id",            "servers",             "gateway_router_id"),
    ("ix_servers_gateway_server_id",            "servers",             "gateway_server_id"),
    ("ix_internet_routers_upstream_router_id",  "internet_routers",    "upstream_router_id"),
    ("ix_internet_routers_server_id",           "internet_routers",    "server_id"),
    ("ix_environments_default_gw_router_id",    "environments",        "default_gateway_router_id"),
    ("ix_environments_default_gw_server_id",    "environments",        "default_gateway_server_id"),
    ("ix_instance_relations_source_instance_id","instance_relations",  "source_instance_id"),
    ("ix_instance_relations_target_instance_id","instance_relations",  "target_instance_id"),
    ("ix_instance_relations_source_cluster_id", "instance_relations",  "source_cluster_id"),
    ("ix_instance_relations_target_cluster_id", "instance_relations",  "target_cluster_id"),
    ("ix_relations_source_id",                  "relations",           "source_id"),
    ("ix_relations_target_id",                  "relations",           "target_id"),
]

# (constraint_name, table, expression)  — added NOT VALID to avoid locking on existing rows
_CHECK_CONSTRAINTS = [
    (
        "chk_ir_has_source",
        "instance_relations",
        "source_instance_id IS NOT NULL OR source_cluster_id IS NOT NULL",
    ),
    (
        "chk_ir_has_target",
        "instance_relations",
        "target_instance_id IS NOT NULL OR target_cluster_id IS NOT NULL",
    ),
]


def upgrade() -> None:
    conn = op.get_bind()

    for name, table, col in _FK_INDEXES:
        conn.execute(sa.text(
            f"CREATE INDEX IF NOT EXISTS {name} ON {table} ({col})"
        ))

    for cname, table, expr in _CHECK_CONSTRAINTS:
        conn.execute(sa.text(f"""
            DO $$ BEGIN
              IF NOT EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = '{cname}'
              ) THEN
                ALTER TABLE {table}
                ADD CONSTRAINT {cname} CHECK ({expr}) NOT VALID;
              END IF;
            END $$
        """))


def downgrade() -> None:
    conn = op.get_bind()

    for cname, table, _ in _CHECK_CONSTRAINTS:
        conn.execute(sa.text(f"""
            DO $$ BEGIN
              IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '{cname}') THEN
                ALTER TABLE {table} DROP CONSTRAINT {cname};
              END IF;
            END $$
        """))

    for name, table, _ in _FK_INDEXES:
        conn.execute(sa.text(f"DROP INDEX IF EXISTS {name}"))
