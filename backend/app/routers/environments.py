from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from sqlalchemy.exc import IntegrityError
from typing import List

from ..database import get_db
from ..events import bus
from ..models import Environment, InternetRouter, Server
from ..schemas import EnvironmentCreate, EnvironmentUpdate, EnvironmentOut

router = APIRouter(prefix="/api/environments", tags=["environments"])


async def _ensure_gateway_linked(db: AsyncSession, env: Environment) -> bool:
    """A Standard-Gateway set on an environment must also be tagged as
    belonging to that environment (router_environments / server_environments),
    otherwise dropdowns that filter gateway candidates by environment
    membership (e.g. the server/instance edit forms) never offer it —
    those two relationships were previously maintained independently."""
    changed = False
    if env.default_gateway_router_id:
        result = await db.execute(
            select(InternetRouter)
            .options(selectinload(InternetRouter.environments))
            .where(InternetRouter.id == env.default_gateway_router_id)
        )
        router_obj = result.scalar_one_or_none()
        if router_obj and env not in router_obj.environments:
            router_obj.environments.append(env)
            changed = True
    if env.default_gateway_server_id:
        result = await db.execute(
            select(Server)
            .options(selectinload(Server.environments))
            .where(Server.id == env.default_gateway_server_id)
        )
        server_obj = result.scalar_one_or_none()
        if server_obj and env not in server_obj.environments:
            server_obj.environments.append(env)
            changed = True
    return changed


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
    if await _ensure_gateway_linked(db, obj):
        await db.commit()
        await db.refresh(obj)
    await bus.broadcast("data_changed", {"entity": "environment"})
    return obj


@router.put("/{env_id}", response_model=EnvironmentOut)
async def update_environment(env_id: int, payload: EnvironmentUpdate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Environment).where(Environment.id == env_id))
    obj = result.scalar_one_or_none()
    if not obj:
        raise HTTPException(status_code=404, detail="Environment not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(obj, field, value)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Name bereits vergeben")
    await db.refresh(obj)
    if await _ensure_gateway_linked(db, obj):
        await db.commit()
        await db.refresh(obj)
    await bus.broadcast("data_changed", {"entity": "environment"})
    return obj


@router.delete("/{env_id}", status_code=204)
async def delete_environment(env_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Environment).where(Environment.id == env_id))
    obj = result.scalar_one_or_none()
    if not obj:
        raise HTTPException(status_code=404, detail="Environment not found")
    await db.delete(obj)
    await db.commit()
    await bus.broadcast("data_changed", {"entity": "environment"})
