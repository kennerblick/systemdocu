import os
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import DeclarativeBase, sessionmaker

DATABASE_URL = (
    f"postgresql+asyncpg://{os.getenv('POSTGRES_USER','cmdb')}:"
    f"{os.getenv('POSTGRES_PASSWORD','cmdb')}@"
    f"{os.getenv('POSTGRES_HOST','postgres')}/"
    f"{os.getenv('POSTGRES_DB','cmdb')}"
)

engine = create_async_engine(
    DATABASE_URL,
    echo=False,
    pool_size=10,
    max_overflow=20,
    pool_pre_ping=True,
    pool_recycle=1800,
)
AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db():
    async with AsyncSessionLocal() as session:
        yield session
