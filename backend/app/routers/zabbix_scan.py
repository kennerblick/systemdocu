import re
import fnmatch
import logging
import os
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pyzabbix import ZabbixAPI
from pydantic import BaseModel
from typing import List, Optional

from ..database import get_db
from ..models import Server, Service, ServiceInstance

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


LLD_PATTERNS = [
    ("pgsql.db.discovery*",           "postgresql"),
    ("pg.db.discovery*",              "postgresql"),
    ("samba.shares*",                 "samba"),
    ("samba.share.discovery*",        "samba"),
    ("docker.container.discovery*",   "docker"),
    ("kubernetes*discovery*",         "kubernetes"),
    ("veeam*discovery*",              "veeam"),
    ("vm.discovery*",                 "hyperv"),
    ("hyperv*discovery*",             "hyperv"),
    ("minio*discovery*",              "minio"),
]


@router.get("/scan/{zabbix_hostid}")
def scan_host(zabbix_hostid: str):
    zapi = _get_zapi()

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
    if any(fnmatch.fnmatch(t, "Template OS Windows*") for t in template_names):
        os_type = "windows"
    elif any(fnmatch.fnmatch(t, "Template Virt Proxmox*") for t in template_names):
        os_type = "proxmox"
    elif any(fnmatch.fnmatch(t, "Template Virt VMware ESXi*") for t in template_names):
        os_type = "esxi"

    ip = next((i["ip"] for i in host.get("interfaces", []) if i.get("ip") and i["ip"] != "0.0.0.0"), None)
    fqdn = next((i["dns"] for i in host.get("interfaces", []) if i.get("dns")), None)

    services = {}  # type -> {version, instances set}

    # LLD-based discovery
    lld_rules = zapi.discoveryrule.get(
        output=["itemid", "key_", "name"],
        hostids=[zabbix_hostid],
        filter={"status": "0"},
    )

    for rule in lld_rules:
        base_key = rule["key_"].split("[")[0]
        for pattern, svc_type in LLD_PATTERNS:
            if fnmatch.fnmatch(base_key, pattern):
                names = _lld_instance_names(zapi, zabbix_hostid, rule)
                if names:
                    if svc_type not in services:
                        services[svc_type] = {"version": None, "instances": set()}
                    services[svc_type]["instances"].update(names)
                break

    # Hyper-V: text item from PowerShell Get-VM
    _scan_hyperv_items(zapi, zabbix_hostid, services)

    return {
        "hostid": zabbix_hostid,
        "hostname": host["host"],
        "fqdn": fqdn,
        "ip": ip,
        "os_type": os_type,
        "services": [
            {
                "type": svc_type,
                "version": data["version"],
                "instances": sorted(data["instances"]),
            }
            for svc_type, data in services.items()
        ],
    }


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


def _scan_hyperv_items(zapi, hostid, services):
    try:
        items = zapi.item.get(
            output=["name", "key_", "lastvalue"],
            hostids=[hostid],
            filter={"status": "0", "value_type": "4"},  # type=4 → text
            limit=200,
        )
        for item in items:
            key = item.get("key_", "")
            name = item.get("name", "")
            if "Get-VM" in key or "VM-List" in name or "VM-list" in name or "Hyper-V VM" in name:
                vms = _parse_hyperv_output(item.get("lastvalue", ""))
                if vms:
                    if "hyperv" not in services:
                        services["hyperv"] = {"version": None, "instances": set()}
                    services["hyperv"]["instances"].update(vms)
    except Exception as e:
        logger.warning("Hyper-V item scan failed: %s", e)


def _parse_hyperv_output(text: str) -> list:
    if not text:
        return []
    vms = []
    header_passed = False
    for line in text.strip().splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        if re.match(r'^[-=]+', stripped):
            header_passed = True
            continue
        if not header_passed and re.search(r'VMName|Name', stripped, re.I):
            header_passed = True
            continue
        if header_passed:
            name = stripped.split()[0]
            if name and not name.startswith('{') and len(name) > 1:
                vms.append(name)
    return vms


# --- Import ---

class _InstIn(BaseModel):
    name: str
    description: Optional[str] = None


class _SvcIn(BaseModel):
    type: str
    version: Optional[str] = None
    instances: List[str] = []


class ZabbixScanImport(BaseModel):
    hostname: str
    fqdn: Optional[str] = None
    ip: Optional[str] = None
    os_type: str = "linux"
    services: List[_SvcIn] = []


@router.post("/import")
async def import_scan(payload: ZabbixScanImport, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Server).where(Server.hostname == payload.hostname))
    server = result.scalar_one_or_none()

    if server is None:
        server = Server(hostname=payload.hostname, fqdn=payload.fqdn, ip=payload.ip, os_type=payload.os_type)
        db.add(server)
        await db.flush()
    else:
        if payload.ip:
            server.ip = payload.ip
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
