from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import List

from ..database import get_db
from ..models import Tag
from ..schemas import TagCreate, TagOut

router = APIRouter(prefix="/api/tags", tags=["tags"])


@router.get("", response_model=List[TagOut])
async def list_tags(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Tag))
    return result.scalars().all()


@router.post("", response_model=TagOut, status_code=201)
async def create_tag(payload: TagCreate, db: AsyncSession = Depends(get_db)):
    existing = await db.execute(select(Tag).where(Tag.name == payload.name))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Tag already exists")
    tag = Tag(**payload.model_dump())
    db.add(tag)
    await db.commit()
    await db.refresh(tag)
    return tag
