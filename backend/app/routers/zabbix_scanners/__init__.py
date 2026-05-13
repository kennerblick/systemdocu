"""
Zabbix item scanners — one module per service type.

Each module in this package must expose a top-level function:

    def scan(zapi, hostid: str, services: dict) -> None: ...

`services` is a shared dict  {service_type: {"version": ..., "instances": set()}}.
The scanner adds entries in-place; duplicate instances are handled automatically
because `instances` is a set.

To add a custom scanner, drop a new .py file here with a `scan()` function.
No registration required — all modules are discovered and called automatically.
"""

import importlib
import pkgutil
import logging
from pathlib import Path

logger = logging.getLogger("systemdocu")


def run_all_scanners(zapi, hostid: str, services: dict) -> None:
    package_dir = Path(__file__).parent
    for _, module_name, _ in pkgutil.iter_modules([str(package_dir)]):
        try:
            mod = importlib.import_module(f".{module_name}", package=__name__)
            if callable(getattr(mod, "scan", None)):
                mod.scan(zapi, hostid, services)
        except Exception as e:
            logger.warning("Scanner '%s' failed: %s", module_name, e)
