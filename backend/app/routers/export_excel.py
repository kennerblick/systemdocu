import io
from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
import openpyxl
from openpyxl.styles import PatternFill, Font, Alignment, Border, Side
from openpyxl.utils import get_column_letter

from ..database import get_db
from ..models import Server, Service, ServiceInstance

router = APIRouter(tags=["export"])

# ── Style constants ────────────────────────────────────────────────────────────

HEADER_BG   = "1E3A5F"
HDR_FONT    = Font(bold=True, color="FFFFFF", size=11, name="Calibri")
THIN        = Side(style="thin", color="CBD5E1")
CELL_BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
MED         = Side(style="medium", color="94A3B8")
CENTER      = Alignment(horizontal="center", vertical="center", wrap_text=True)
LEFT        = Alignment(horizontal="left",   vertical="center", wrap_text=True)

OS_HEX = {
    "linux": "3B82F6", "windows": "60A5FA",
    "proxmox": "F97316", "esxi": "22C55E",
}
SVC_HEX = {
    "postgresql": "336791", "docker": "2496ED", "kubernetes": "326CE5",
    "hyperv": "00ADEF",    "samba": "D97706",   "sftp": "059669",
    "freeipa": "7C3AED",   "zabbix": "E53E3E",  "graylog": "2D3748",
    "veeam": "00B050",     "minio": "C83B0E",   "gateway": "0D9488",
    "webserver": "0EA5E9",
}

# ── Helpers ────────────────────────────────────────────────────────────────────

def _h(c: str) -> str:
    return c.lstrip("#").upper().zfill(6)


def _fill(c: str) -> PatternFill:
    return PatternFill("solid", fgColor=_h(c))


def _srv_hex(srv: Server) -> str:
    if srv.environments:
        return _h(srv.environments[0].color)
    return OS_HEX.get(srv.os_type, "888888")


def _cell(ws, row: int, col: int, value, bg: str, font: Font,
          align: Alignment = LEFT) -> None:
    c = ws.cell(row=row, column=col, value=value)
    c.fill   = _fill(bg)
    c.font   = font
    c.border = CELL_BORDER
    c.alignment = align


def _header_row(ws, titles: list[str]) -> None:
    for i, t in enumerate(titles, 1):
        _cell(ws, 1, i, t, HEADER_BG, HDR_FONT, CENTER)
    ws.row_dimensions[1].height = 22


def _merge(ws, col: int, r1: int, r2: int) -> None:
    if r2 > r1:
        ws.merge_cells(
            start_row=r1, start_column=col,
            end_row=r2,   end_column=col,
        )
        c = ws.cell(row=r1, column=col)
        c.alignment = CENTER


def _col_widths(ws, widths: list[int]) -> None:
    for i, w in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(i)].width = w


DATA_FONT  = Font(color="1F2937", size=10, name="Calibri")
WHITE_BOLD = Font(bold=True, color="FFFFFF", size=10, name="Calibri")
GREY_FONT  = Font(color="6B7280", size=10, name="Calibri", italic=True)

# ── Endpoint ───────────────────────────────────────────────────────────────────

@router.get("/api/export/excel")
async def export_excel(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Server).options(
            selectinload(Server.services)
            .selectinload(Service.instances)
            .selectinload(ServiceInstance.applications),
            selectinload(Server.tags),
            selectinload(Server.environments),
        )
    )
    servers = list(result.scalars().all())

    wb = openpyxl.Workbook()
    _build_sheet1(wb, servers)
    _build_sheet2(wb, servers)

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=systemdocu.xlsx"},
    )


# ── Sheet 1: Infrastruktur (Server → Service → Instanz → Anwendung) ───────────

BANDS1 = ["EFF6FF", "F0FDF4"]


def _build_sheet1(wb: openpyxl.Workbook, servers: list) -> None:
    ws = wb.active
    ws.title = "Infrastruktur"
    ws.freeze_panes = "A2"

    _header_row(ws, [
        "Server", "OS", "IP", "Umgebungen",
        "Service", "Version", "Port", "Instanz", "Anwendungen",
    ])
    _col_widths(ws, [22, 10, 16, 22, 14, 10, 7, 22, 35])

    servers = sorted(servers, key=lambda s: s.hostname.lower())
    row = 2
    for si, srv in enumerate(servers):
        envs = ", ".join(e.name for e in srv.environments)
        srv_hex = _srv_hex(srv)
        band    = BANDS1[si % 2]
        srv_r0  = row

        services = srv.services or []
        if not services:
            _write_srv_row(ws, row, srv, envs, "", "", "", "", "", band)
            row += 1
        else:
            for svc in services:
                svc_hex = SVC_HEX.get(svc.type, "4B5563")
                svc_r0  = row
                instances = svc.instances or []
                if not instances:
                    _write_srv_row(ws, row, srv, envs,
                                   svc.type, svc.version or "",
                                   str(svc.port) if svc.port else "",
                                   "", "", band)
                    _apply_svc_cell(ws, row, svc_hex)
                    row += 1
                else:
                    for inst in instances:
                        apps = ", ".join(a.name for a in inst.applications)
                        _write_srv_row(ws, row, srv, envs,
                                       svc.type, svc.version or "",
                                       str(svc.port) if svc.port else "",
                                       inst.name, apps, band)
                        _apply_svc_cell(ws, row, svc_hex)
                        row += 1

                svc_r1 = row - 1
                for c in (5, 6, 7):
                    _merge(ws, c, svc_r0, svc_r1)

        srv_r1 = row - 1
        for c in range(1, 5):
            _merge(ws, c, srv_r0, srv_r1)

        # Server name cell: coloured, bold
        top = ws.cell(row=srv_r0, column=1)
        top.fill  = _fill(srv_hex)
        top.font  = WHITE_BOLD
        top.alignment = CENTER

        # Thick left border on server group
        for r in range(srv_r0, row):
            c = ws.cell(row=r, column=1)
            c.border = Border(
                left=MED, right=THIN, top=THIN, bottom=THIN,
            )


def _write_srv_row(ws, row, srv, envs, svc_t, svc_v, svc_p, inst, apps, band):
    vals = [srv.hostname, srv.os_type, srv.ip or "", envs,
            svc_t, svc_v, svc_p, inst, apps]
    aligns = [CENTER, CENTER, CENTER, LEFT, CENTER, CENTER, CENTER, LEFT, LEFT]
    for col, (v, a) in enumerate(zip(vals, aligns), 1):
        _cell(ws, row, col, v, band, DATA_FONT, a)


def _apply_svc_cell(ws, row: int, svc_hex: str) -> None:
    c = ws.cell(row=row, column=5)
    c.fill = _fill(svc_hex)
    c.font = WHITE_BOLD
    c.alignment = CENTER


# ── Sheet 2: Anwendungen (Anwendung → Instanz → Server) ───────────────────────

BANDS2 = ["FFF7ED", "F0FDF4"]


def _build_sheet2(wb: openpyxl.Workbook, servers: list) -> None:
    ws = wb.create_sheet("Anwendungen")
    ws.freeze_panes = "A2"

    _header_row(ws, [
        "Anwendung", "Instanz", "Service", "Version",
        "Server", "OS", "IP", "Umgebungen",
    ])
    _col_widths(ws, [24, 22, 14, 10, 20, 10, 16, 22])

    # Build app → [(inst, svc, srv, envs)] map preserving app order
    app_map: dict[int, dict] = {}
    no_app: list[tuple] = []

    for srv in servers:
        envs = ", ".join(e.name for e in srv.environments)
        for svc in (srv.services or []):
            for inst in (svc.instances or []):
                if inst.applications:
                    for app in inst.applications:
                        if app.id not in app_map:
                            app_map[app.id] = {"app": app, "rows": []}
                        app_map[app.id]["rows"].append((inst, svc, srv, envs))
                else:
                    no_app.append((inst, svc, srv, envs))

    row = 2
    for ai, entry in enumerate(sorted(app_map.values(), key=lambda e: e["app"].name.lower())):
        app   = entry["app"]
        band  = BANDS2[ai % 2]
        app_r0 = row
        app_hex = _h(app.color)

        for inst, svc, srv, envs in entry["rows"]:
            svc_hex = SVC_HEX.get(svc.type, "4B5563")
            vals = [app.name, inst.name, svc.type, svc.version or "",
                    srv.hostname, srv.os_type, srv.ip or "", envs]
            aligns = [LEFT, LEFT, CENTER, CENTER, LEFT, CENTER, CENTER, LEFT]
            for col, (v, a) in enumerate(zip(vals, aligns), 1):
                _cell(ws, row, col, v, band, DATA_FONT, a)
            # App name cell: coloured
            ca = ws.cell(row=row, column=1)
            ca.fill = _fill(app_hex)
            ca.font = WHITE_BOLD
            # Service cell: coloured
            cs = ws.cell(row=row, column=3)
            cs.fill = _fill(svc_hex)
            cs.font = WHITE_BOLD
            cs.alignment = CENTER
            row += 1

        _merge(ws, 1, app_r0, row - 1)
        # Restore colour after merge reset
        top = ws.cell(row=app_r0, column=1)
        top.fill = _fill(app_hex)
        top.font = WHITE_BOLD

        # Thick left border on app group
        for r in range(app_r0, row):
            ws.cell(row=r, column=1).border = Border(
                left=MED, right=THIN, top=THIN, bottom=THIN,
            )

    # Instances with no application
    if no_app:
        no_r0 = row
        for inst, svc, srv, envs in no_app:
            svc_hex = SVC_HEX.get(svc.type, "4B5563")
            vals = ["(keine Anwendung)", inst.name, svc.type, svc.version or "",
                    srv.hostname, srv.os_type, srv.ip or "", envs]
            aligns = [LEFT, LEFT, CENTER, CENTER, LEFT, CENTER, CENTER, LEFT]
            for col, (v, a) in enumerate(zip(vals, aligns), 1):
                _cell(ws, row, col, v, "F3F4F6", GREY_FONT, a)
            row += 1
        _merge(ws, 1, no_r0, row - 1)
