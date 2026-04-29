#!/usr/bin/env python3
import logging
import logging.handlers
import os
import fnmatch
import requests
from pyzabbix import ZabbixAPI
from dotenv import load_dotenv

load_dotenv()

LOG_DIR = os.getenv("LOG_DIR", "/logs")
os.makedirs(LOG_DIR, exist_ok=True)

_file_handler = logging.handlers.RotatingFileHandler(
    os.path.join(LOG_DIR, "zabbix_import.log"),
    maxBytes=10 * 1024 * 1024,
    backupCount=5,
    encoding="utf-8",
)
_file_handler.setLevel(logging.WARNING)
_file_handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s: %(message)s"))

_console_handler = logging.StreamHandler()
_console_handler.setLevel(logging.INFO)
_console_handler.setFormatter(logging.Formatter("%(levelname)s: %(message)s"))

logging.basicConfig(level=logging.INFO, handlers=[_file_handler, _console_handler])
logger = logging.getLogger("zabbix_import")

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
    "Template App NFS*": "nfs",
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
    try:
        zapi = ZabbixAPI(ZABBIX_URL)
        if ZABBIX_API_TOKEN:
            zapi.login(api_token=ZABBIX_API_TOKEN)
            logger.info("Zabbix login via API token")
        else:
            zapi.login(ZABBIX_USER, ZABBIX_PASSWORD)
            logger.info("Zabbix login via user/password")
    except Exception as e:
        logger.error("Zabbix login failed: %s", e)
        raise

    try:
        hosts = zapi.host.get(
            output=["hostid", "host", "name", "status"],
            selectInterfaces=["ip", "dns", "type"],
            selectParentTemplates=["name"],
        )
    except Exception as e:
        logger.error("Zabbix host.get failed: %s", e)
        raise

    payload_hosts = []
    for h in hosts:
        if h["status"] != "0":
            continue

        ip = None
        fqdn = None
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

    logger.info("Fetched %d active hosts from Zabbix", len(payload_hosts))

    try:
        resp = requests.post(API_URL, json={"hosts": payload_hosts}, timeout=30)
        resp.raise_for_status()
    except requests.HTTPError as e:
        logger.error("API request failed: %s – %s", e, resp.text)
        raise
    except requests.RequestException as e:
        logger.error("API request error: %s", e)
        raise

    result = resp.json()
    if result.get("skipped"):
        logger.warning("Import finished with skipped hosts: created=%d updated=%d skipped=%d",
                       result["created"], result["updated"], result["skipped"])
    else:
        logger.info("Import finished: created=%d updated=%d skipped=%d",
                    result["created"], result["updated"], result["skipped"])

    print(f"created={result['created']} updated={result['updated']} skipped={result['skipped']}")


if __name__ == "__main__":
    main()
