#!/usr/bin/env python3
import os
import sys
import json
import fnmatch
import requests
from pyzabbix import ZabbixAPI
from dotenv import load_dotenv

load_dotenv()

ZABBIX_URL = os.environ["ZABBIX_URL"]
ZABBIX_API_TOKEN = os.getenv("ZABBIX_API_TOKEN")
ZABBIX_USER = os.getenv("ZABBIX_USER")
ZABBIX_PASSWORD = os.getenv("ZABBIX_PASSWORD")
API_URL = os.getenv("SYSTEMDOCU_API_URL", "http://localhost:8000/api/import/zabbix")

TEMPLATE_MAP = {
    "Template DB PostgreSQL*": "postgresql",
    "Template App Docker*": "docker",
    "Template Kubernetes*": "kubernetes",
    "Template OS Windows*": "windows",
    "Template Virt Hyper*": "hyperv",
    "Template App Samba*": "samba",
    "Template App SSH*": "sftp",
    "Template App FreeIPA*": "freeipa",
    "Template App Zabbix*": "zabbix",
    "Template App Graylog*": "graylog",
}

OS_TEMPLATES = {
    "Template OS Windows*": "windows",
}


def map_templates(template_names):
    services = []
    os_type = "linux"
    for tpl in template_names:
        for pattern, svc_type in TEMPLATE_MAP.items():
            if fnmatch.fnmatch(tpl, pattern):
                if pattern in OS_TEMPLATES:
                    os_type = OS_TEMPLATES[pattern]
                else:
                    services.append({"type": svc_type, "version": None, "port": None, "detail": None})
    return os_type, services


def main():
    zapi = ZabbixAPI(ZABBIX_URL)
    if ZABBIX_API_TOKEN:
        zapi.login(api_token=ZABBIX_API_TOKEN)
    else:
        zapi.login(ZABBIX_USER, ZABBIX_PASSWORD)

    hosts = zapi.host.get(
        output=["hostid", "host", "name", "status"],
        selectInterfaces=["ip", "dns", "type"],
        selectParentTemplates=["name"],
    )

    payload_hosts = []
    for h in hosts:
        if h["status"] != "0":
            continue

        ip = None
        fqdn = None
        for iface in h.get("parentTemplates", []):
            pass
        for iface in h.get("interfaces", []):
            if iface.get("ip"):
                ip = iface["ip"]
            if iface.get("dns"):
                fqdn = iface["dns"]

        template_names = [t["name"] for t in h.get("parentTemplates", [])]
        os_type, services = map_templates(template_names)

        payload_hosts.append({
            "hostname": h["host"],
            "fqdn": fqdn or None,
            "ip": ip or None,
            "os_type": os_type,
            "services": services,
        })

    payload = {"hosts": payload_hosts}

    resp = requests.post(API_URL, json=payload, timeout=30)
    resp.raise_for_status()
    result = resp.json()
    print(f"created={result['created']} updated={result['updated']} skipped={result['skipped']}")


if __name__ == "__main__":
    main()
