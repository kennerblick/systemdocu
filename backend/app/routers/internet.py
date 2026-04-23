from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from typing import List

from ..database import get_db
from ..models import InternetRouter, Environment
from ..schemas import InternetRouterCreate, InternetRouterOut

router = APIRouter(prefix="/api/internet-routers", tags=["internet"])

_opts = [selectinload(InternetRouter.environments)]


async def get_router_or_404(router_id: int, db: AsyncSession) -> InternetRouter:
    result = await db.execute(
        select(InternetRouter).options(*_opts).where(InternetRouter.id == router_id)
    )
    obj = result.scalar_one_or_none()
    if not obj:
        raise HTTPException(status_code=404, detail="Router not found")
    return obj


async def _apply_environments(obj: InternetRouter, env_ids: List[int], db: AsyncSession):
    if env_ids:
        envs = (await db.execute(
            select(Environment).where(Environment.id.in_(env_ids))
        )).scalars().all()
        obj.environments = list(envs)
    else:
        obj.environments = []


@router.get("", response_model=List[InternetRouterOut])
async def list_routers(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(InternetRouter).options(*_opts))
    return result.scalars().all()


@router.post("", response_model=InternetRouterOut, status_code=201)
async def create_router(payload: InternetRouterCreate, db: AsyncSession = Depends(get_db)):
    env_ids = payload.environment_ids
    obj = InternetRouter(**payload.model_dump(exclude={"environment_ids"}))
    db.add(obj)
    await db.flush()
    await _apply_environments(obj, env_ids, db)
    await db.commit()
    return await get_router_or_404(obj.id, db)


@router.put("/{router_id}", response_model=InternetRouterOut)
async def update_router(router_id: int, payload: InternetRouterCreate, db: AsyncSession = Depends(get_db)):
    obj = await get_router_or_404(router_id, db)
    for field, value in payload.model_dump(exclude={"environment_ids"}).items():
        setattr(obj, field, value)
    await _apply_environments(obj, payload.environment_ids, db)
    await db.commit()
    return await get_router_or_404(router_id, db)


@router.delete("/{router_id}", status_code=204)
async def delete_router(router_id: int, db: AsyncSession = Depends(get_db)):
    obj = await get_router_or_404(router_id, db)
    await db.delete(obj)
    await db.commit()
