import re
import fnmatch
import logging
import os
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from pyzabbix import ZabbixAPI
from pydantic import BaseModel
from typing import List, Optional

from ..database import get_db
from ..models import Server, Service, ServiceInstance, ServerIP
from .zabbix_scanners import run_all_scanners

logger = logging.getLogger("systemdocu")
router = APIRouter(prefix="/api/zabbix", tags=["zabbix"])


def _get_zapi() -> ZabbixAPI:
    url = os.getenv("ZABBIX_URL")
    if not url:
        raise HTTPException(503, "Zabbix nicht konfiguriert (ZABBIX_URL fehlt)")
    try:
        import requests
        import urllib3
        ssl_verify = os.getenv("ZABBIX_VERIFY_SSL", "true").lower() != "false"
        if not ssl_verify:
            urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
        session = requests.Session()
        session.verify = ssl_verify
        zapi = ZabbixAPI(url, session=session)
        token = os.getenv("ZABBIX_API_TOKEN")
        if token:
            zapi.login(api_token=token)
        else:
            zapi.login(os.getenv("ZABBIX_USER"), os.getenv("ZABBIX_PASSWORD"))
        return zapi
    except Exception as e:
        raise HTTPException(503, f"Zabbix Login fehlgeschlagen: {e}")


@router.get("/ping")
def zabbix_ping():
    url = os.getenv("ZABBIX_URL")
    if not url:
        return {"status": "error", "message": "ZABBIX_URL nicht gesetzt"}
    try:
        zapi = _get_zapi()
        version = zapi.api_version()
        return {"status": "ok", "message": f"Verbunden mit {url} (v{version})"}
    except HTTPException as e:
        return {"status": "error", "message": e.detail}
    except Exception as e:
        return {"status": "error", "message": str(e)}


@router.get("/hosts")
def list_hosts():
    zapi = _get_zapi()

    groups = zapi.hostgroup.get(
        output=["groupid", "name"],
        search={"name": "Server/"},
        searchWildcardsEnabled=True,
    )
    if not groups:
        groups = zapi.hostgroup.get(output=["groupid", "name"], search={"name": "Server"})

    if not groups:
        return []

    hosts = zapi.host.get(
        output=["hostid", "host", "name", "status"],
        groupids=[g["groupid"] for g in groups],
        selectInterfaces=["ip", "type"],
        filter={"status": "0"},
    )

    result = []
    for h in hosts:
        ip = next((i["ip"] for i in h.get("interfaces", []) if i.get("ip") and i["ip"] != "0.0.0.0"), None)
        result.append({"hostid": h["hostid"], "hostname": h["host"], "display_name": h["name"], "ip": ip})

    return sorted(result, key=lambda x: x["hostname"].lower())


class _SvcIn(BaseModel):
    type: str
    version: Optional[str] = None
    instances: List[str] = []


LLD_PATTERNS = [
    ("pgsql.db.discovery*",                        "postgresql"),
    ("pg.db.discovery*",                           "postgresql"),
    ("samba.share*",                               "samba"),
    ("nfs.share.discovery*",                       "nfs"),
    ("nfs*discovery*",                             "nfs"),
    ("docker.container*.discovery*",               "docker"),
    ("kubernetes*discovery*",                      "kubernetes"),
    ("veeam*discovery*",                           "veeam"),
    ("vm.discovery*",                              "hyperv"),
    ("hyperv*discovery*",                          "hyperv"),
    ("minio*discovery*",                           "minio"),
    # full-key patterns (matched against the complete key_ including parameters)
    ("system.run[*pvesh*--type vm*",               "proxmox"),
]


def _scan_host_data(zapi: ZabbixAPI, zabbix_hostid: str) -> dict:
    hosts = zapi.host.get(
        output=["hostid", "host", "name"],
        hostids=[zabbix_hostid],
        selectInterfaces=["ip", "dns"],
        selectParentTemplates=["name"],
    )
    if not hosts:
        raise HTTPException(404, "Host nicht in Zabbix gefunden")

    host = hosts[0]
    template_names = [t["name"] for t in host.get("parentTemplates", [])]

    os_type = "linux"
    tpl_lower = [t.lower() for t in template_names]
    if any(fnmatch.fnmatch(t, "Template OS Windows*") for t in template_names):
        os_type = "windows"
    elif any("windows" in t for t in tpl_lower):
        os_type = "windows"
    elif any(fnmatch.fnmatch(t, "Template Virt Proxmox*") for t in template_names):
        os_type = "proxmox"
    elif any("proxmox" in t for t in tpl_lower):
        os_type = "proxmox"
    elif any(fnmatch.fnmatch(t, "Template Virt VMware ESXi*") for t in template_names):
        os_type = "esxi"
    elif any("esxi" in t or "vmware" in t for t in tpl_lower):
        os_type = "esxi"

    ip = next((i["ip"] for i in host.get("interfaces", []) if i.get("ip") and i["ip"] != "0.0.0.0"), None)
    fqdn = next((i["dns"] for i in host.get("interfaces", []) if i.get("dns")), None)

    services = {}  # type -> {version, instances set}

    lld_rules = zapi.discoveryrule.get(
        output=["itemid", "key_", "name"],
        hostids=[zabbix_hostid],
        filter={"status": "0"},
    )
    for rule in lld_rules:
        full_key = rule["key_"]
        base_key = full_key.split("[")[0]
        for pattern, svc_type in LLD_PATTERNS:
            key_to_match = full_key if "[" in pattern else base_key
            if fnmatch.fnmatch(key_to_match, pattern):
                names = _lld_instance_names(zapi, zabbix_hostid, rule)
                if names:
                    if svc_type not in services:
                        services[svc_type] = {"version": None, "instances": set()}
                    services[svc_type]["instances"].update(names)
                break

    run_all_scanners(zapi, zabbix_hostid, services)

    if "hyperv" in services and os_type == "linux":
        os_type = "windows"

    return {
        "hostid": zabbix_hostid,
        "hostname": host["host"],
        "fqdn": fqdn,
        "ip": ip,
        "os_type": os_type,
        "services": [
            {"type": svc_type, "version": data["version"], "instances": sorted(data["instances"])}
            for svc_type, data in services.items()
        ],
    }


@router.get("/scan/{zabbix_hostid}")
def scan_host(zabbix_hostid: str):
    return _scan_host_data(_get_zapi(), zabbix_hostid)


@router.get("/rescan/{server_id}")
async def rescan_server(server_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Server)
        .options(selectinload(Server.services).selectinload(Service.instances), selectinload(Server.ips))
        .where(Server.id == server_id)
    )
    server = result.scalar_one_or_none()
    if not server:
        raise HTTPException(404, "Server nicht gefunden")

    zapi = _get_zapi()

    zbx_hosts = zapi.host.get(output=["hostid", "host"], filter={"host": server.hostname})
    if not zbx_hosts and server.ips:
        first_ip = server.ips[0].ip
        ifaces = zapi.hostinterface.get(output=["hostid"], filter={"ip": first_ip})
        if ifaces:
            zbx_hosts = zapi.host.get(output=["hostid", "host"], hostids=[ifaces[0]["hostid"]])
    if not zbx_hosts:
        raise HTTPException(404, f"Kein Zabbix-Host für '{server.hostname}' gefunden")

    zabbix_hostid = zbx_hosts[0]["hostid"]
    scan = _scan_host_data(zapi, zabbix_hostid)

    zbx_by_type = {s["type"]: set(s["instances"]) for s in scan["services"]}

    db_by_type = {}
    for svc in server.services:
        db_by_type.setdefault(svc.type, {"service_id": svc.id, "instances": {}})
        for inst in svc.instances:
            db_by_type[svc.type]["instances"][inst.name] = {
                "id": inst.id, "available": inst.available
            }

    new_services = []
    missing_instances = []
    restore_instances = []

    for svc_type, zbx_insts in zbx_by_type.items():
        db_insts = db_by_type.get(svc_type, {}).get("instances", {})
        new_insts = [n for n in zbx_insts if n not in db_insts]
        if new_insts:
            new_services.append({"type": svc_type, "instances": sorted(new_insts)})
        for name, info in db_insts.items():
            if name in zbx_insts and not info["available"]:
                restore_instances.append({"id": info["id"], "name": name, "service_type": svc_type})

    for svc_type, db_svc in db_by_type.items():
        zbx_insts = zbx_by_type.get(svc_type, set())
        for name, info in db_svc["instances"].items():
            if name not in zbx_insts and info["available"]:
                missing_instances.append({"id": info["id"], "name": name, "service_type": svc_type})

    return {
        "zabbix_hostid": zabbix_hostid,
        "new_services": new_services,
        "missing_instances": missing_instances,
        "restore_instances": restore_instances,
    }


class _RescanApply(BaseModel):
    zabbix_hostid: str
    new_services: List[_SvcIn] = []
    missing_instance_ids: List[int] = []
    restore_instance_ids: List[int] = []


@router.post("/rescan/{server_id}")
async def apply_rescan(server_id: int, payload: _RescanApply, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Server).where(Server.id == server_id))
    server = result.scalar_one_or_none()
    if not server:
        raise HTTPException(404, "Server nicht gefunden")

    # Mark missing instances as unavailable
    for inst_id in payload.missing_instance_ids:
        r = await db.execute(select(ServiceInstance).where(ServiceInstance.id == inst_id))
        inst = r.scalar_one_or_none()
        if inst:
            inst.available = False

    # Restore previously unavailable instances
    for inst_id in payload.restore_instance_ids:
        r = await db.execute(select(ServiceInstance).where(ServiceInstance.id == inst_id))
        inst = r.scalar_one_or_none()
        if inst:
            inst.available = True

    # Add new services / instances
    for svc_data in payload.new_services:
        svc_result = await db.execute(
            select(Service).where(Service.server_id == server_id, Service.type == svc_data.type)
        )
        service = svc_result.scalar_one_or_none()
        if service is None:
            service = Service(server_id=server_id, type=svc_data.type, version=svc_data.version)
            db.add(service)
            await db.flush()

        existing = {i.name for i in (
            await db.execute(select(ServiceInstance).where(ServiceInstance.service_id == service.id))
        ).scalars().all()}
        for inst_name in svc_data.instances:
            if inst_name not in existing:
                db.add(ServiceInstance(service_id=service.id, name=inst_name))

    await db.commit()
    from ..events import bus
    await bus.broadcast("data_changed", {"entity": "instance"})
    return {"status": "ok"}


def _lld_instance_names(zapi, hostid, rule) -> set:
    names = set()
    try:
        prototypes = zapi.itemprototype.get(
            output=["key_", "name"],
            discoveryids=[rule["itemid"]],
            limit=3,
        )
        if not prototypes:
            return names

        proto = prototypes[0]
        proto_key = proto["key_"]
        proto_name = proto["name"]
        base_key = proto_key.split("[")[0]

        # Find primary macro in prototype
        macros = re.findall(r'\{#[A-Z0-9_]+\}', proto_name + proto_key)
        primary_macro = macros[0] if macros else None

        # Get all LLD-created items for this base key
        items = zapi.item.get(
            output=["key_", "name"],
            hostids=[hostid],
            search={"key_": base_key},
            filter={"flags": "4"},
            limit=500,
        )

        if not items:
            return names

        # Extract instance name from item name using proto_name as template
        if primary_macro:
            pos = proto_name.find(primary_macro)
            if pos >= 0:
                prefix = re.escape(proto_name[:pos])
                rest = proto_name[pos + len(primary_macro):]
                suffix = re.escape(rest.split(":")[0]) if rest else ""
                pattern = prefix + r"(.+?)" + (suffix if suffix else r"(?:[:\s]|$)")
                for item in items:
                    m = re.search(pattern, item["name"])
                    if m:
                        val = m.group(1).strip("'\" ")
                        if val:
                            names.add(val)

        # Fallback: compare key against prototype key to extract macro value
        if not names:
            proto_params = re.findall(r'[,\[]((?:"[^"]*"|[^,\]\[]+))', proto_key)
            for item in items:
                item_params = re.findall(r'[,\[]((?:"[^"]*"|[^,\]\[]+))', item["key_"])
                for p, i in zip(proto_params, item_params):
                    if p.startswith('{#') and i:
                        val = i.strip('"\'')
                        if val and val != p:
                            names.add(val)
                            break

    except Exception as e:
        logger.warning("LLD scan failed for rule '%s': %s", rule.get("name"), e)

    return names




# --- Import ---

class _InstIn(BaseModel):
    name: str
    description: Optional[str] = None


class ZabbixScanImport(BaseModel):
    hostname: str
    fqdn: Optional[str] = None
    ip: Optional[str] = None
    os_type: str = "linux"
    services: List[_SvcIn] = []


@router.post("/import")
async def import_scan(payload: ZabbixScanImport, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Server).options(selectinload(Server.ips)).where(Server.hostname == payload.hostname)
    )
    server = result.scalar_one_or_none()

    if server is None:
        server = Server(hostname=payload.hostname, fqdn=payload.fqdn, os_type=payload.os_type)
        if payload.ip:
            server.ips.append(ServerIP(ip=payload.ip.strip()))
        db.add(server)
        await db.flush()
    else:
        if payload.ip and payload.ip.strip() not in {x.ip for x in server.ips}:
            server.ips.append(ServerIP(ip=payload.ip.strip()))
        if payload.fqdn:
            server.fqdn = payload.fqdn
        server.os_type = payload.os_type

    for svc_data in payload.services:
        svc_result = await db.execute(
            select(Service).where(Service.server_id == server.id, Service.type == svc_data.type)
        )
        service = svc_result.scalar_one_or_none()
        if service is None:
            service = Service(server_id=server.id, type=svc_data.type, version=svc_data.version)
            db.add(service)
            await db.flush()

        existing = {i.name for i in (
            await db.execute(select(ServiceInstance).where(ServiceInstance.service_id == service.id))
        ).scalars().all()}

        for inst_name in svc_data.instances:
            if inst_name not in existing:
                db.add(ServiceInstance(service_id=service.id, name=inst_name))

    await db.commit()
    return {"status": "ok", "server_id": server.id, "hostname": server.hostname}
