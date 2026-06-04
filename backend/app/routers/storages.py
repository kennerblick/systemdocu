from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import List

from ..database import get_db
from ..events import bus
from ..models import Storage, ServiceInstance
from ..schemas import StorageCreate, StorageUpdate, StorageOut

router = APIRouter(tags=["storages"])


@router.get("/api/servers/{server_id}/storages", response_model=List[StorageOut])
async def list_storages(server_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Storage).where(Storage.server_id == server_id)
    )
    return result.scalars().all()


@router.post("/api/servers/{server_id}/storages", response_model=StorageOut, status_code=201)
async def create_storage(server_id: int, payload: StorageCreate, db: AsyncSession = Depends(get_db)):
    storage = Storage(server_id=server_id, **payload.model_dump())
    db.add(storage)
    await db.commit()
    await db.refresh(storage)
    await bus.broadcast("data_changed", {"entity": "storage"})
    return storage


@router.put("/api/storages/{storage_id}", response_model=StorageOut)
async def update_storage(storage_id: int, payload: StorageUpdate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Storage).where(Storage.id == storage_id))
    storage = result.scalar_one_or_none()
    if not storage:
        raise HTTPException(status_code=404, detail="Storage not found")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(storage, k, v)
    await db.commit()
    await db.refresh(storage)
    await bus.broadcast("data_changed", {"entity": "storage"})
    return storage


@router.delete("/api/storages/{storage_id}", status_code=204)
async def delete_storage(storage_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Storage).where(Storage.id == storage_id))
    storage = result.scalar_one_or_none()
    if not storage:
        raise HTTPException(status_code=404, detail="Storage not found")
    await db.delete(storage)
    await db.commit()
    await bus.broadcast("data_changed", {"entity": "storage"})


@router.put("/api/instances/{instance_id}/storage", response_model=dict)
async def set_instance_storage(instance_id: int, payload: dict, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(ServiceInstance).where(ServiceInstance.id == instance_id))
    inst = result.scalar_one_or_none()
    if not inst:
        raise HTTPException(status_code=404, detail="Instance not found")
    storage_id = payload.get("storage_id")
    if storage_id is not None:
        st_result = await db.execute(select(Storage).where(Storage.id == storage_id))
        if not st_result.scalar_one_or_none():
            raise HTTPException(status_code=404, detail="Storage not found")
    inst.storage_id = storage_id
    await db.commit()
    await bus.broadcast("data_changed", {"entity": "instance"})
    return {"storage_id": storage_id}
