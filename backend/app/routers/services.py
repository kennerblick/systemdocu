from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import List

from ..database import get_db
from ..models import Service, Server
from ..schemas import ServiceCreate, ServiceOut

router = APIRouter(tags=["services"])


@router.get("/api/servers/{server_id}/services", response_model=List[ServiceOut])
async def list_services(server_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Service).where(Service.server_id == server_id))
    return result.scalars().all()


@router.post("/api/servers/{server_id}/services", response_model=ServiceOut, status_code=201)
async def create_service(server_id: int, payload: ServiceCreate, db: AsyncSession = Depends(get_db)):
    server_result = await db.execute(select(Server).where(Server.id == server_id))
    if not server_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Server not found")
    service = Service(server_id=server_id, **payload.model_dump())
    db.add(service)
    await db.commit()
    await db.refresh(service)
    return service


@router.delete("/api/services/{service_id}", status_code=204)
async def delete_service(service_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Service).where(Service.id == service_id))
    service = result.scalar_one_or_none()
    if not service:
        raise HTTPException(status_code=404, detail="Service not found")
    await db.delete(service)
    await db.commit()
