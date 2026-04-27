from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from typing import List

from ..database import get_db
from ..models import Service, ServiceInstance, Environment, Application, InstanceRelation
from ..schemas import ServiceInstanceCreate, ServiceInstanceUpdate, ServiceInstanceOut, InstanceRelationCreate, InstanceRelationOut, InstanceRelationUpdate, ServiceCreate, ServiceSimpleOut

router = APIRouter(tags=["instances"])


async def get_instance_or_404(instance_id: int, db: AsyncSession) -> ServiceInstance:
    result = await db.execute(
        select(ServiceInstance)
        .options(
            selectinload(ServiceInstance.environments),
            selectinload(ServiceInstance.applications),
            selectinload(ServiceInstance.own_services),
        )
        .where(ServiceInstance.id == instance_id)
    )
    obj = result.scalar_one_or_none()
    if not obj:
        raise HTTPException(status_code=404, detail="Instance not found")
    return obj


@router.get("/api/services/{service_id}/instances", response_model=List[ServiceInstanceOut])
async def list_instances(service_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(ServiceInstance)
        .options(
            selectinload(ServiceInstance.environments),
            selectinload(ServiceInstance.applications),
        )
        .where(ServiceInstance.service_id == service_id)
    )
    return result.scalars().all()


@router.post("/api/services/{service_id}/instances", response_model=ServiceInstanceOut, status_code=201)
async def create_instance(service_id: int, payload: ServiceInstanceCreate, db: AsyncSession = Depends(get_db)):
    svc_result = await db.execute(select(Service).where(Service.id == service_id))
    if not svc_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Service not found")
    obj = ServiceInstance(service_id=service_id, **payload.model_dump())
    db.add(obj)
    await db.commit()
    return await get_instance_or_404(obj.id, db)


@router.delete("/api/instances/{instance_id}", status_code=204)
async def delete_instance(instance_id: int, db: AsyncSession = Depends(get_db)):
    obj = await get_instance_or_404(instance_id, db)
    await db.delete(obj)
    await db.commit()


@router.patch("/api/instances/{instance_id}", response_model=ServiceInstanceOut)
async def update_instance(instance_id: int, payload: ServiceInstanceUpdate, db: AsyncSession = Depends(get_db)):
    obj = await get_instance_or_404(instance_id, db)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(obj, field, value)
    await db.commit()
    return await get_instance_or_404(instance_id, db)


@router.post("/api/instances/{instance_id}/environments/{env_id}", response_model=ServiceInstanceOut)
async def add_environment(instance_id: int, env_id: int, db: AsyncSession = Depends(get_db)):
    obj = await get_instance_or_404(instance_id, db)
    env_result = await db.execute(select(Environment).where(Environment.id == env_id))
    env = env_result.scalar_one_or_none()
    if not env:
        raise HTTPException(status_code=404, detail="Environment not found")
    if env not in obj.environments:
        obj.environments.append(env)
        if not obj.gateway_router_id and not obj.gateway_server_id:
            if env.default_gateway_router_id:
                obj.gateway_router_id = env.default_gateway_router_id
            elif env.default_gateway_server_id:
                obj.gateway_server_id = env.default_gateway_server_id
        await db.commit()
    return await get_instance_or_404(instance_id, db)


@router.delete("/api/instances/{instance_id}/environments/{env_id}", response_model=ServiceInstanceOut)
async def remove_environment(instance_id: int, env_id: int, db: AsyncSession = Depends(get_db)):
    obj = await get_instance_or_404(instance_id, db)
    obj.environments = [e for e in obj.environments if e.id != env_id]
    await db.commit()
    return await get_instance_or_404(instance_id, db)


@router.post("/api/instances/{instance_id}/applications/{app_id}", response_model=ServiceInstanceOut)
async def add_application(instance_id: int, app_id: int, db: AsyncSession = Depends(get_db)):
    obj = await get_instance_or_404(instance_id, db)
    app_result = await db.execute(select(Application).where(Application.id == app_id))
    app = app_result.scalar_one_or_none()
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")
    if app not in obj.applications:
        obj.applications.append(app)
        await db.commit()
    return await get_instance_or_404(instance_id, db)


@router.delete("/api/instances/{instance_id}/applications/{app_id}", response_model=ServiceInstanceOut)
async def remove_application(instance_id: int, app_id: int, db: AsyncSession = Depends(get_db)):
    obj = await get_instance_or_404(instance_id, db)
    obj.applications = [a for a in obj.applications if a.id != app_id]
    await db.commit()
    return await get_instance_or_404(instance_id, db)


@router.get("/api/instance-relations", response_model=List[InstanceRelationOut])
async def list_instance_relations(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(InstanceRelation))
    return result.scalars().all()


@router.post("/api/instance-relations", response_model=InstanceRelationOut, status_code=201)
async def create_instance_relation(payload: InstanceRelationCreate, db: AsyncSession = Depends(get_db)):
    rel = InstanceRelation(**payload.model_dump())
    db.add(rel)
    await db.commit()
    await db.refresh(rel)
    return rel


@router.patch("/api/instance-relations/{rel_id}", response_model=InstanceRelationOut)
async def update_instance_relation(rel_id: int, payload: InstanceRelationUpdate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(InstanceRelation).where(InstanceRelation.id == rel_id))
    rel = result.scalar_one_or_none()
    if not rel:
        raise HTTPException(status_code=404, detail="Relation not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(rel, field, value)
    await db.commit()
    await db.refresh(rel)
    return rel


@router.delete("/api/instance-relations/{rel_id}", status_code=204)
async def delete_instance_relation(rel_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(InstanceRelation).where(InstanceRelation.id == rel_id))
    rel = result.scalar_one_or_none()
    if not rel:
        raise HTTPException(status_code=404, detail="Relation not found")
    await db.delete(rel)
    await db.commit()


@router.post("/api/instances/{instance_id}/services", response_model=ServiceSimpleOut, status_code=201)
async def create_instance_service(instance_id: int, payload: ServiceCreate, db: AsyncSession = Depends(get_db)):
    obj = await get_instance_or_404(instance_id, db)
    svc = Service(instance_id=instance_id, **payload.model_dump())
    db.add(svc)
    await db.commit()
    await db.refresh(svc)
    return svc


@router.delete("/api/instances/{instance_id}/services/{service_id}", status_code=204)
async def delete_instance_service(instance_id: int, service_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Service).where(Service.id == service_id, Service.instance_id == instance_id)
    )
    svc = result.scalar_one_or_none()
    if not svc:
        raise HTTPException(status_code=404, detail="Service not found")
    await db.delete(svc)
    await db.commit()
