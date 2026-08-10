"""Full, lossless database export/import as JSON.

Unlike the Excel export (human-readable, name-based, drops IDs/relations/
routers/clusters — see export_excel.py), this round-trips every table
verbatim, including primary keys and foreign keys, so an export can fully
reconstruct the database on another instance (or after a data loss) without
any of the gaps documented for the Excel-based restore path.

Import is a full replace: every table is truncated and reloaded from the
uploaded file. Two tables (environments/internet_routers/servers, and
services/service_instances) form circular foreign-key references, so rows
are inserted with those specific columns nulled out first, then patched in
a second pass once every row exists.
"""
import io
import json
from datetime import datetime, date

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse
from sqlalchemy import select, insert, text, DateTime
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import (
    Server, ServerIP, Service, ServiceInstance, InstanceIP, Storage,
    Environment, Application, Cluster, InstanceRelation, InternetRouter, Relation,
    server_environments, instance_environments, instance_applications,
    server_applications, router_environments, cluster_members,
)

router = APIRouter(tags=["db-transfer"])

# ORM tables, in an order that's safe to INSERT once the circular FK columns
# listed in _DEFERRED_FK are nulled out on the first pass.
_ORM_MODELS = [
    ("environments", Environment),
    ("internet_routers", InternetRouter),
    ("servers", Server),
    ("clusters", Cluster),
    ("applications", Application),
    ("storages", Storage),
    ("services", Service),
    ("service_instances", ServiceInstance),
    ("server_ips", ServerIP),
    ("instance_ips", InstanceIP),
    ("instance_relations", InstanceRelation),
    ("relations", Relation),
]
_JOIN_TABLES = [
    ("server_environments", server_environments),
    ("instance_environments", instance_environments),
    ("instance_applications", instance_applications),
    ("server_applications", server_applications),
    ("router_environments", router_environments),
    ("cluster_members", cluster_members),
]
_DEFERRED_FK = {
    "environments": ["default_gateway_router_id", "default_gateway_server_id"],
    "internet_routers": ["server_id"],
    "servers": ["gateway_router_id", "gateway_server_id"],
    "services": ["instance_id"],
    "service_instances": ["gateway_instance_id"],
}
_ALL_TABLE_NAMES = [n for n, _ in _ORM_MODELS] + [n for n, _ in _JOIN_TABLES]


def _row_to_dict(obj, columns) -> dict:
    out = {}
    for col in columns:
        val = getattr(obj, col.name)
        if isinstance(val, (datetime, date)):
            val = val.isoformat()
        out[col.name] = val
    return out


@router.get("/api/db-export")
async def export_db(db: AsyncSession = Depends(get_db)):
    data = {"version": 1, "exported_at": datetime.utcnow().isoformat(), "tables": {}}
    for name, model in _ORM_MODELS:
        result = await db.execute(select(model))
        data["tables"][name] = [_row_to_dict(r, model.__table__.columns) for r in result.scalars().all()]
    for name, table in _JOIN_TABLES:
        result = await db.execute(select(table))
        data["tables"][name] = [dict(r._mapping) for r in result.all()]

    payload = json.dumps(data, indent=2, default=str).encode("utf-8")
    return StreamingResponse(
        io.BytesIO(payload),
        media_type="application/json",
        headers={"Content-Disposition": "attachment; filename=systemdocu-export.json"},
    )


@router.post("/api/db-import")
async def import_db(file: UploadFile = File(...), db: AsyncSession = Depends(get_db)):
    raw = await file.read()
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Ungültige JSON-Datei")

    tables = data.get("tables")
    if not isinstance(tables, dict):
        raise HTTPException(status_code=400, detail="Ungültiges Export-Format (kein 'tables'-Objekt)")

    quoted = ", ".join(f'"{n}"' for n in _ALL_TABLE_NAMES)
    await db.execute(text(f"TRUNCATE TABLE {quoted} RESTART IDENTITY CASCADE"))

    # Pass 1: insert every row with its circular-FK columns nulled out, and
    # any column not present in the current schema dropped (forward
    # compatible with older exports missing newer columns).
    for name, model in _ORM_MODELS:
        rows = tables.get(name) or []
        if not rows:
            continue
        known_cols = set(model.__table__.columns.keys())
        deferred = set(_DEFERRED_FK.get(name, []))
        date_cols = {c.name for c in model.__table__.columns if isinstance(c.type, DateTime)}
        clean_rows = []
        for row in rows:
            r = {k: v for k, v in row.items() if k in known_cols}
            for col in deferred:
                r[col] = None
            for col in date_cols:
                if isinstance(r.get(col), str):
                    r[col] = datetime.fromisoformat(r[col])
            clean_rows.append(r)
        await db.execute(insert(model.__table__), clean_rows)

    # Pass 2: restore the deferred FK values now that every row exists.
    for name, model in _ORM_MODELS:
        deferred = _DEFERRED_FK.get(name, [])
        if not deferred:
            continue
        for row in tables.get(name) or []:
            updates = {col: row[col] for col in deferred if row.get(col) is not None}
            if updates:
                await db.execute(
                    model.__table__.update().where(model.__table__.c.id == row["id"]).values(**updates)
                )

    for name, table in _JOIN_TABLES:
        rows = tables.get(name) or []
        if rows:
            known_cols = set(table.columns.keys())
            clean_rows = [{k: v for k, v in row.items() if k in known_cols} for row in rows]
            await db.execute(insert(table), clean_rows)

    # RESTART IDENTITY reset every sequence to 1, but rows were inserted with
    # their original explicit ids — bump each sequence past the highest one
    # imported so the next auto-generated insert doesn't collide.
    for name, _model in _ORM_MODELS:
        await db.execute(text(
            f"SELECT setval(pg_get_serial_sequence('{name}', 'id'), "
            f"COALESCE((SELECT MAX(id) FROM {name}), 1), "
            f"(SELECT MAX(id) FROM {name}) IS NOT NULL)"
        ))

    await db.commit()
    return {"tables_imported": {n: len(tables.get(n) or []) for n in _ALL_TABLE_NAMES}}
