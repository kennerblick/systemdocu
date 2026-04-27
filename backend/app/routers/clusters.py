from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from typing import List

from ..database import get_db
from ..models import Cluster, Service, ServiceInstance
from ..schemas import ClusterCreate, ClusterUpdate, ClusterOut, ServiceCreate, ServiceSimpleOut

router = APIRouter(prefix="/api/clusters", tags=["clusters"])


async def get_cluster_or_404(cluster_id: int, db: AsyncSession) -> Cluster:
    result = await db.execute(
        select(Cluster)
        .options(
            selectinload(Cluster.members),
            selectinload(Cluster.own_services).selectinload(Service.instances),
        )
        .where(Cluster.id == cluster_id)
    )
    obj = result.scalar_one_or_none()
    if not obj:
        raise HTTPException(status_code=404, detail="Cluster not found")
    return obj


@router.get("", response_model=List[ClusterOut])
async def list_clusters(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Cluster).options(
            selectinload(Cluster.members),
            selectinload(Cluster.own_services).selectinload(Service.instances),
        )
    )
    return result.scalars().all()


@router.post("", response_model=ClusterOut, status_code=201)
async def create_cluster(payload: ClusterCreate, db: AsyncSession = Depends(get_db)):
    obj = Cluster(**payload.model_dump())
    db.add(obj)
    await db.commit()
    return await get_cluster_or_404(obj.id, db)


@router.patch("/{cluster_id}", response_model=ClusterOut)
async def update_cluster(cluster_id: int, payload: ClusterUpdate, db: AsyncSession = Depends(get_db)):
    obj = await get_cluster_or_404(cluster_id, db)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(obj, field, value)
    await db.commit()
    return await get_cluster_or_404(cluster_id, db)


@router.delete("/{cluster_id}", status_code=204)
async def delete_cluster(cluster_id: int, db: AsyncSession = Depends(get_db)):
    obj = await get_cluster_or_404(cluster_id, db)
    await db.delete(obj)
    await db.commit()


@router.post("/{cluster_id}/instances/{instance_id}", response_model=ClusterOut)
async def add_cluster_member(cluster_id: int, instance_id: int, db: AsyncSession = Depends(get_db)):
    obj = await get_cluster_or_404(cluster_id, db)
    inst = (await db.execute(select(ServiceInstance).where(ServiceInstance.id == instance_id))).scalar_one_or_none()
    if not inst:
        raise HTTPException(status_code=404, detail="Instance not found")
    if inst not in obj.members:
        obj.members.append(inst)
        await db.commit()
    return await get_cluster_or_404(cluster_id, db)


@router.delete("/{cluster_id}/instances/{instance_id}", response_model=ClusterOut)
async def remove_cluster_member(cluster_id: int, instance_id: int, db: AsyncSession = Depends(get_db)):
    obj = await get_cluster_or_404(cluster_id, db)
    obj.members = [m for m in obj.members if m.id != instance_id]
    await db.commit()
    return await get_cluster_or_404(cluster_id, db)


@router.post("/{cluster_id}/services", response_model=ClusterOut, status_code=201)
async def add_cluster_service(cluster_id: int, payload: ServiceCreate, db: AsyncSession = Depends(get_db)):
    await get_cluster_or_404(cluster_id, db)
    svc = Service(cluster_id=cluster_id, **payload.model_dump())
    db.add(svc)
    await db.commit()
    return await get_cluster_or_404(cluster_id, db)


@router.delete("/{cluster_id}/services/{service_id}", status_code=204)
async def remove_cluster_service(cluster_id: int, service_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Service).where(Service.id == service_id, Service.cluster_id == cluster_id)
    )
    svc = result.scalar_one_or_none()
    if not svc:
        raise HTTPException(status_code=404, detail="Service not found")
    await db.delete(svc)
    await db.commit()
