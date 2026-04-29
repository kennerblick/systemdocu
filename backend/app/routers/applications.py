from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from typing import List

from ..database import get_db
from ..events import bus
from ..models import Application
from ..schemas import ApplicationCreate, ApplicationOut

router = APIRouter(prefix="/api/applications", tags=["applications"])


@router.get("", response_model=List[ApplicationOut])
async def list_applications(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Application))
    return result.scalars().all()


@router.post("", response_model=ApplicationOut, status_code=201)
async def create_application(payload: ApplicationCreate, db: AsyncSession = Depends(get_db)):
    obj = Application(**payload.model_dump())
    db.add(obj)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Anwendung existiert bereits")
    await db.refresh(obj)
    await bus.broadcast("data_changed", {"entity": "application"})
    return obj


@router.delete("/{app_id}", status_code=204)
async def delete_application(app_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Application).where(Application.id == app_id))
    obj = result.scalar_one_or_none()
    if not obj:
        raise HTTPException(status_code=404, detail="Application not found")
    await db.delete(obj)
    await db.commit()
    await bus.broadcast("data_changed", {"entity": "application"})
