import re
import logging

logger = logging.getLogger("systemdocu")


def scan(zapi, hostid: str, services: dict) -> None:
    try:
        items = zapi.item.get(
            output=["name", "key_", "lastvalue"],
            hostids=[hostid],
            filter={"status": "0", "value_type": "4"},  # type=4 → text
            limit=200,
        )
        for item in items:
            key = item.get("key_", "").lower()
            name = item.get("name", "").lower()
            if ("get-vm" in key or "get-vm" in name or
                    "vm-list" in key or "vm-list" in name or
                    "hyper-v" in key or "hyper-v" in name or
                    "hyperv" in key or "hyperv" in name):
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

    lines = [l.strip() for l in text.strip().splitlines() if l.strip()]

    # Format A: "VMName    {ip, ...}" per line — PowerShell column output
    brace_re = re.compile(r'^(\S+)\s+\{[^}]*\}\s*$')
    brace_hits = [brace_re.match(l) for l in lines]
    brace_hits = [m for m in brace_hits if m]
    if brace_hits and len(brace_hits) >= max(1, len(lines) * 0.35):
        vms = []
        for m in brace_hits:
            name = m.group(1).rstrip('.')  # strip PS truncation (e.g. "kabeld-p...")
            if name and len(name) > 1 and not name.startswith('{'):
                vms.append(name)
        return vms

    # Format B: table with VMName header row + "---" separator
    vms = []
    header_passed = False
    for stripped in lines:
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
