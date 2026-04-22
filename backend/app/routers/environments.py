from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from typing import List

from ..database import get_db
from ..models import Environment
from ..schemas import EnvironmentCreate, EnvironmentOut

router = APIRouter(prefix="/api/environments", tags=["environments"])


@router.get("", response_model=List[EnvironmentOut])
async def list_environments(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Environment))
    return result.scalars().all()


@router.post("", response_model=EnvironmentOut, status_code=201)
async def create_environment(payload: EnvironmentCreate, db: AsyncSession = Depends(get_db)):
    obj = Environment(**payload.model_dump())
    db.add(obj)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Umgebung existiert bereits")
    await db.refresh(obj)
    return obj


@router.delete("/{env_id}", status_code=204)
async def delete_environment(env_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Environment).where(Environment.id == env_id))
    obj = result.scalar_one_or_none()
    if not obj:
        raise HTTPException(status_code=404, detail="Environment not found")
    await db.delete(obj)
    await db.commit()
