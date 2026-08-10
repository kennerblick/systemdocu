from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, insert
from sqlalchemy.orm import selectinload
from sqlalchemy.exc import IntegrityError
from typing import List

from ..database import get_db
from ..events import bus
from ..models import Server, Service, ServiceInstance, Environment, Application, Storage, ServerIP, server_applications
from ..schemas import ServerCreate, ServerUpdate, ServerOut, IpCreate, IpOut

router = APIRouter(prefix="/api/servers", tags=["servers"])

_server_options = [
    selectinload(Server.services)
        .selectinload(Service.instances)
        .selectinload(ServiceInstance.applications),
    selectinload(Server.services)
        .selectinload(Service.instances)
        .selectinload(ServiceInstance.environments),
    selectinload(Server.services)
        .selectinload(Service.instances)
        .selectinload(ServiceInstance.own_services),
    selectinload(Server.services)
        .selectinload(Service.instances)
        .selectinload(ServiceInstance.ips),
    selectinload(Server.environments),
    selectinload(Server.applications),
    selectinload(Server.storages),
    selectinload(Server.ips),
]


async def _attach_inherited_app_ids(db: AsyncSession, servers: list) -> None:
    """Sets a transient `.inherited_application_ids` attribute on each Server —
    the subset of its `.applications` that were assigned with
    inherit_to_instances=True, i.e. that should count as applying to every
    service/instance on the server (in filters and the Excel export)."""
    if not servers:
        return
    server_ids = [s.id for s in servers]
    result = await db.execute(
        select(server_applications.c.server_id, server_applications.c.application_id)
        .where(
            server_applications.c.server_id.in_(server_ids),
            server_applications.c.inherit_to_instances.is_(True),
        )
    )
    by_server: dict[int, list[int]] = {}
    for server_id, app_id in result.all():
        by_server.setdefault(server_id, []).append(app_id)
    for s in servers:
        s.inherited_application_ids = by_server.get(s.id, [])


async def get_server_or_404(server_id: int, db: AsyncSession) -> Server:
    result = await db.execute(
        select(Server)
        .options(*_server_options)
        .where(Server.id == server_id)
    )
    server = result.scalar_one_or_none()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    await _attach_inherited_app_ids(db, [server])
    return server


@router.get("", response_model=List[ServerOut])
async def list_servers(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Server).options(*_server_options)
    )
    servers = list(result.scalars().all())
    await _attach_inherited_app_ids(db, servers)
    return servers


@router.get("/{server_id}", response_model=ServerOut)
async def get_server(server_id: int, db: AsyncSession = Depends(get_db)):
    return await get_server_or_404(server_id, db)


@router.post("", response_model=ServerOut, status_code=201)
async def create_server(payload: ServerCreate, db: AsyncSession = Depends(get_db)):
    data = payload.model_dump()
    ips = data.pop("ips")
    server = Server(**data)
    seen_ips = set()
    for ip in ips:
        ip = ip.strip()
        if ip and ip not in seen_ips:
            seen_ips.add(ip)
            server.ips.append(ServerIP(ip=ip))
    db.add(server)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail=f"Hostname '{payload.hostname}' existiert bereits")
    await db.refresh(server)
    await bus.broadcast("data_changed", {"entity": "server"})
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
    await bus.broadcast("data_changed", {"entity": "server"})
    return await get_server_or_404(server_id, db)


@router.delete("/{server_id}", status_code=204)
async def delete_server(server_id: int, db: AsyncSession = Depends(get_db)):
    server = await get_server_or_404(server_id, db)
    await db.delete(server)
    await db.commit()
    await bus.broadcast("data_changed", {"entity": "server"})


@router.post("/{server_id}/environments/{env_id}", response_model=ServerOut)
async def add_server_environment(server_id: int, env_id: int, db: AsyncSession = Depends(get_db)):
    server = await get_server_or_404(server_id, db)
    env_result = await db.execute(select(Environment).where(Environment.id == env_id))
    env = env_result.scalar_one_or_none()
    if not env:
        raise HTTPException(status_code=404, detail="Environment not found")
    if env not in server.environments:
        server.environments.append(env)
        if not server.gateway_router_id and not server.gateway_server_id:
            if env.default_gateway_router_id:
                server.gateway_router_id = env.default_gateway_router_id
            elif env.default_gateway_server_id:
                server.gateway_server_id = env.default_gateway_server_id
        await db.commit()
        await bus.broadcast("data_changed", {"entity": "server"})
    return await get_server_or_404(server_id, db)


@router.delete("/{server_id}/environments/{env_id}", response_model=ServerOut)
async def remove_server_environment(server_id: int, env_id: int, db: AsyncSession = Depends(get_db)):
    server = await get_server_or_404(server_id, db)
    server.environments = [e for e in server.environments if e.id != env_id]
    await db.commit()
    await bus.broadcast("data_changed", {"entity": "server"})
    return await get_server_or_404(server_id, db)


@router.post("/{server_id}/applications/{app_id}", response_model=ServerOut)
async def add_server_application(
    server_id: int, app_id: int, inherit_to_instances: bool = False, db: AsyncSession = Depends(get_db)
):
    server = await get_server_or_404(server_id, db)
    app_result = await db.execute(select(Application).where(Application.id == app_id))
    app = app_result.scalar_one_or_none()
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")
    if app not in server.applications:
        await db.execute(
            insert(server_applications).values(
                server_id=server_id, application_id=app_id, inherit_to_instances=inherit_to_instances
            )
        )
        await db.commit()
        await bus.broadcast("data_changed", {"entity": "server"})
    return await get_server_or_404(server_id, db)


@router.delete("/{server_id}/applications/{app_id}", response_model=ServerOut)
async def remove_server_application(server_id: int, app_id: int, db: AsyncSession = Depends(get_db)):
    server = await get_server_or_404(server_id, db)
    server.applications = [a for a in server.applications if a.id != app_id]
    await db.commit()
    await bus.broadcast("data_changed", {"entity": "server"})
    return await get_server_or_404(server_id, db)


@router.post("/{server_id}/ips", response_model=IpOut, status_code=201)
async def add_server_ip(server_id: int, payload: IpCreate, db: AsyncSession = Depends(get_db)):
    await get_server_or_404(server_id, db)
    ip = payload.ip.strip()
    if not ip:
        raise HTTPException(status_code=422, detail="IP darf nicht leer sein")
    server_ip = ServerIP(server_id=server_id, ip=ip)
    db.add(server_ip)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail=f"IP '{ip}' ist bei diesem Server bereits erfasst")
    await db.refresh(server_ip)
    await bus.broadcast("data_changed", {"entity": "server"})
    return server_ip


@router.delete("/{server_id}/ips/{ip_id}", status_code=204)
async def delete_server_ip(server_id: int, ip_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(ServerIP).where(ServerIP.id == ip_id, ServerIP.server_id == server_id)
    )
    server_ip = result.scalar_one_or_none()
    if not server_ip:
        raise HTTPException(status_code=404, detail="IP not found")
    await db.delete(server_ip)
    await db.commit()
    await bus.broadcast("data_changed", {"entity": "server"})
