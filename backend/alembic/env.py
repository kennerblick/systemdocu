import asyncio
import os
import sys
from pathlib import Path
from logging.config import fileConfig

# Ensure the project root (/app inside the container) is on sys.path so that
# 'from app.models import Base' resolves correctly regardless of how alembic
# is invoked (entrypoint.sh, docker exec, etc.)
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import pool
from sqlalchemy.ext.asyncio import async_engine_from_config

from alembic import context

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Override URL from environment variables
_db_url = (
    f"postgresql+asyncpg://{os.getenv('POSTGRES_USER', 'cmdb')}:"
    f"{os.getenv('POSTGRES_PASSWORD', 'cmdb')}@"
    f"{os.getenv('POSTGRES_HOST', 'postgres')}/"
    f"{os.getenv('POSTGRES_DB', 'cmdb')}"
)
config.set_main_option("sqlalchemy.url", _db_url)

from app.models import Base  # noqa: E402
target_metadata = Base.metadata


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


def run_migrations_online() -> None:
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
