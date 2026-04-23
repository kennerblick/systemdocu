from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import List

from ..database import get_db
from ..models import InternetRouter
from ..schemas import InternetRouterCreate, InternetRouterOut

router = APIRouter(prefix="/api/internet-routers", tags=["internet"])


@router.get("", response_model=List[InternetRouterOut])
async def list_routers(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(InternetRouter))
    return result.scalars().all()


@router.post("", response_model=InternetRouterOut, status_code=201)
async def create_router(payload: InternetRouterCreate, db: AsyncSession = Depends(get_db)):
    obj = InternetRouter(**payload.model_dump())
    db.add(obj)
    await db.commit()
    await db.refresh(obj)
    return obj


@router.put("/{router_id}", response_model=InternetRouterOut)
async def update_router(router_id: int, payload: InternetRouterCreate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(InternetRouter).where(InternetRouter.id == router_id))
    obj = result.scalar_one_or_none()
    if not obj:
        raise HTTPException(status_code=404, detail="Router not found")
    for field, value in payload.model_dump().items():
        setattr(obj, field, value)
    await db.commit()
    await db.refresh(obj)
    return obj


@router.delete("/{router_id}", status_code=204)
async def delete_router(router_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(InternetRouter).where(InternetRouter.id == router_id))
    obj = result.scalar_one_or_none()
    if not obj:
        raise HTTPException(status_code=404, detail="Router not found")
    await db.delete(obj)
    await db.commit()
