from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from sqlalchemy.exc import IntegrityError
from typing import List

from ..database import get_db
from ..models import Server, Tag
from ..schemas import ServerCreate, ServerUpdate, ServerOut

router = APIRouter(prefix="/api/servers", tags=["servers"])


async def get_server_or_404(server_id: int, db: AsyncSession) -> Server:
    result = await db.execute(
        select(Server)
        .options(selectinload(Server.services), selectinload(Server.tags))
        .where(Server.id == server_id)
    )
    server = result.scalar_one_or_none()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    return server


@router.get("", response_model=List[ServerOut])
async def list_servers(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Server).options(selectinload(Server.services), selectinload(Server.tags))
    )
    return result.scalars().all()


@router.get("/{server_id}", response_model=ServerOut)
async def get_server(server_id: int, db: AsyncSession = Depends(get_db)):
    return await get_server_or_404(server_id, db)


@router.post("", response_model=ServerOut, status_code=201)
async def create_server(payload: ServerCreate, db: AsyncSession = Depends(get_db)):
    server = Server(**payload.model_dump())
    db.add(server)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail=f"Hostname '{payload.hostname}' existiert bereits")
    await db.refresh(server)
    return await get_server_or_404(server.id, db)


@router.put("/{server_id}", response_model=ServerOut)
async def update_server(server_id: int, payload: ServerUpdate, db: AsyncSession = Depends(get_db)):
    server = await get_server_or_404(server_id, db)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(server, field, value)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Hostname bereits vergeben")
    return await get_server_or_404(server_id, db)


@router.delete("/{server_id}", status_code=204)
async def delete_server(server_id: int, db: AsyncSession = Depends(get_db)):
    server = await get_server_or_404(server_id, db)
    await db.delete(server)
    await db.commit()


@router.post("/{server_id}/tags/{tag_id}", response_model=ServerOut)
async def add_tag(server_id: int, tag_id: int, db: AsyncSession = Depends(get_db)):
    server = await get_server_or_404(server_id, db)
    tag_result = await db.execute(select(Tag).where(Tag.id == tag_id))
    tag = tag_result.scalar_one_or_none()
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")
    if tag not in server.tags:
        server.tags.append(tag)
        await db.commit()
    return await get_server_or_404(server_id, db)


@router.delete("/{server_id}/tags/{tag_id}", response_model=ServerOut)
async def remove_tag(server_id: int, tag_id: int, db: AsyncSession = Depends(get_db)):
    server = await get_server_or_404(server_id, db)
    server.tags = [t for t in server.tags if t.id != tag_id]
    await db.commit()
    return await get_server_or_404(server_id, db)
