from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from typing import List

from ..database import get_db
from ..models import Service, Server, ServiceInstance
from ..schemas import ServiceCreate, ServiceOut

router = APIRouter(tags=["services"])

_svc_options = [
    selectinload(Service.instances).selectinload(ServiceInstance.applications),
    selectinload(Service.instances).selectinload(ServiceInstance.environments),
]


@router.get("/api/servers/{server_id}/services", response_model=List[ServiceOut])
async def list_services(server_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Service).options(*_svc_options).where(Service.server_id == server_id)
    )
    return result.scalars().all()


@router.post("/api/servers/{server_id}/services", response_model=ServiceOut, status_code=201)
async def create_service(server_id: int, payload: ServiceCreate, db: AsyncSession = Depends(get_db)):
    server_result = await db.execute(select(Server).where(Server.id == server_id))
    if not server_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Server not found")
    dup = await db.execute(
        select(Service).where(Service.server_id == server_id, Service.type == payload.type)
    )
    if dup.scalar_one_or_none():
        raise HTTPException(status_code=409, detail=f"Service '{payload.type}' existiert bereits auf diesem Server")
    service = Service(server_id=server_id, **payload.model_dump())
    db.add(service)
    await db.commit()
    result = await db.execute(
        select(Service).options(*_svc_options).where(Service.id == service.id)
    )
    return result.scalar_one()


@router.delete("/api/services/{service_id}", status_code=204)
async def delete_service(service_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Service).where(Service.id == service_id))
    service = result.scalar_one_or_none()
    if not service:
        raise HTTPException(status_code=404, detail="Service not found")
    await db.delete(service)
    await db.commit()
