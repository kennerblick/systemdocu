import asyncio
import logging
import logging.handlers
import os
from fastapi import FastAPI, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from .database import engine, Base, get_db
from .models import Server, Service, Relation, Environment, Application, InternetRouter
from .schemas import RelationCreate, RelationOut, ZabbixImportPayload, EnvironmentOut, ApplicationOut
from .routers import servers, services, instances, environments, applications, zabbix_scan, export_excel, internet, clusters
from .events import bus
from typing import List

LOG_DIR = os.getenv("LOG_DIR", "/logs")
os.makedirs(LOG_DIR, exist_ok=True)

_handler = logging.handlers.RotatingFileHandler(
    os.path.join(LOG_DIR, "backend.log"),
    maxBytes=10 * 1024 * 1024,
    backupCount=5,
    encoding="utf-8",
)
_handler.setLevel(logging.WARNING)
_handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))

logging.getLogger().addHandler(_handler)
logging.getLogger("uvicorn.error").addHandler(_handler)
logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)

logger = logging.getLogger("systemdocu")

app = FastAPI(title="systemdocu")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(servers.router)
app.include_router(services.router)
app.include_router(instances.router)
app.include_router(environments.router)
app.include_router(applications.router)
app.include_router(zabbix_scan.router)
app.include_router(export_excel.router)
app.include_router(internet.router)
app.include_router(clusters.router)


@app.on_event("startup")
async def startup():
    # Tables and schema are managed by Alembic (entrypoint.sh runs `alembic upgrade head`
    # before uvicorn starts).  The create_all call here is kept only as a safety net for
    # local dev runs without Docker where Alembic may not have been executed.
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    await seed_data()


async def seed_data():
    async with AsyncSession(engine) as db:
        result = await db.execute(select(Server))
        if result.scalars().first():
            return

        srv1 = Server(hostname="lin-app01", ip="10.0.1.10", os_type="linux",
                      description="Main application server")
        srv2 = Server(hostname="win-dc01", ip="10.0.1.20", os_type="windows",
                      description="Active Directory domain controller")
        srv3 = Server(hostname="prx-host01", ip="10.0.1.30", os_type="proxmox",
                      description="Proxmox hypervisor node")
        db.add_all([srv1, srv2, srv3])
        await db.flush()

        db.add_all([
            Service(server_id=srv1.id, type="postgresql", version="16", port=5432),
            Service(server_id=srv1.id, type="docker", version="24.0", port=None),
            Service(server_id=srv1.id, type="zabbix", version="6.4", port=10051),
            Service(server_id=srv2.id, type="samba", version="4.19", port=445),
            Service(server_id=srv2.id, type="freeipa", version="4.11", port=389),
            Service(server_id=srv3.id, type="kubernetes", version="1.29", port=6443),
            Service(server_id=srv3.id, type="minio", version="RELEASE.2024", port=9000),
        ])

        rel = Relation(source_id=srv1.id, target_id=srv3.id, type="depends_on")
        db.add(rel)

        await db.commit()


# ── Server-Sent Events ────────────────────────────────────────────────────────

@app.get("/api/events")
async def sse(request: Request):
    """SSE endpoint — clients receive a 'data_changed' event after any write."""
    async def stream():
        async with bus.subscribe() as q:
            yield ": connected\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    msg = await asyncio.wait_for(q.get(), timeout=25)
                    yield msg
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── Legacy endpoints (kept in main.py for backward-compat) ───────────────────

@app.get("/api/relations", response_model=List[RelationOut])
async def list_relations(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Relation))
    return result.scalars().all()


@app.post("/api/relations", response_model=RelationOut, status_code=201)
async def create_relation(payload: RelationCreate, db: AsyncSession = Depends(get_db)):
    rel = Relation(**payload.model_dump())
    db.add(rel)
    await db.commit()
    await db.refresh(rel)
    await bus.broadcast("data_changed", {"entity": "relation"})
    return rel


@app.get("/api/export/json")
async def export_json(db: AsyncSession = Depends(get_db)):
    servers_result = await db.execute(
        select(Server).options(selectinload(Server.services))
    )
    srvs = servers_result.scalars().all()
    rels_result = await db.execute(select(Relation))
    return {
        "servers": [
            {
                "id": s.id,
                "hostname": s.hostname,
                "ip": s.ip,
                "os_type": s.os_type,
                "description": s.description,
                "services": [
                    {"type": sv.type, "version": sv.version, "port": sv.port, "detail": sv.detail}
                    for sv in s.services
                ],
            }
            for s in srvs
        ],
        "relations": [
            {"id": r.id, "source_id": r.source_id, "target_id": r.target_id, "type": r.type}
            for r in rels_result.scalars().all()
        ],
    }


@app.post("/api/import/zabbix")
async def import_zabbix(payload: ZabbixImportPayload, db: AsyncSession = Depends(get_db)):
    created = updated = skipped = 0
    for host in payload.hosts:
        try:
            result = await db.execute(select(Server).where(Server.hostname == host.hostname))
            server = result.scalar_one_or_none()
            if server is None:
                server = Server(
                    hostname=host.hostname,
                    ip=host.ip,
                    os_type=host.os_type,
                )
                db.add(server)
                await db.flush()
                created += 1
            else:
                if host.ip:
                    server.ip = host.ip
                server.os_type = host.os_type
                updated += 1

            existing_types = {s.type for s in (
                await db.execute(select(Service).where(Service.server_id == server.id))
            ).scalars().all()}

            for svc in host.services:
                if svc.type not in existing_types:
                    db.add(Service(server_id=server.id, **svc.model_dump()))
        except Exception as e:
            logger.error("import_zabbix: error processing host %s: %s", host.hostname, e)
            skipped += 1

    await db.commit()
    await bus.broadcast("data_changed", {"entity": "server"})
    logger.warning("import_zabbix finished: created=%d updated=%d skipped=%d", created, updated, skipped) if skipped else None
    return {"created": created, "updated": updated, "skipped": skipped}
