import re
import logging

logger = logging.getLogger("systemdocu")

_PATTERN = re.compile(r'^ProxmoxVM\s+\[(\d+)\]:\s*Name\s*$', re.IGNORECASE)


def scan(zapi, hostid: str, services: dict) -> None:
    try:
        items = zapi.item.get(
            output=["name", "lastvalue"],
            hostids=[hostid],
            filter={"status": "0"},
            search={"name": "ProxmoxVM"},
            limit=500,
        )
        for item in items:
            m = _PATTERN.match(item.get("name", ""))
            if m:
                vmid = m.group(1)
                vmname = (item.get("lastvalue") or "").strip()
                if vmname:
                    if "proxmox" not in services:
                        services["proxmox"] = {"version": None, "instances": set()}
                    services["proxmox"]["instances"].add(f"[{vmid}] {vmname}")
    except Exception as e:
        logger.warning("Proxmox VM item scan failed: %s", e)
