"""GraphML export of the full topology.

Unlike the Excel export (human-readable, name-based, one row per instance —
see export_excel.py) and the JSON export (verlustfrei but table-shaped, meant
for backup/restore — see db_transfer.py), this produces an actual *graph*:
every Server, ServiceInstance, Cluster, Environment, Application and
InternetRouter becomes a GraphML node, and every relationship between them
(hosting, cluster membership, environment/application membership, gateway
links, router chaining, and the free-form Relation/InstanceRelation edges)
becomes a GraphML edge. The result opens directly in graph-analysis/diagram
tools such as yEd, Gephi or Cytoscape for layouting, filtering or further
analysis outside systemdocu itself.

GraphML (http://graphml.graphdrawing.org/) is a plain, well-known XML
schema, so this is built with the standard library's ElementTree rather than
pulling in a graph library — no extra dependency, and it mirrors the
hand-rolled approach already used for the Excel export (openpyxl aside).

Every node/edge also carries the yFiles GraphML extension (the "y:"-prefixed
elements below) alongside the plain <data> attributes: yEd renders nodes
*without* it all at an identical default position/size, so hundreds of nodes
end up perfectly stacked on top of each other — indistinguishable from a
single, empty-looking box. The extension gives each node an actual (if
simple, grid-based — real coordinates only exist client-side, in the app's
own live layout, not stored server-side) position, size, shape and fill, and
each edge an arrowhead and label, so the file is immediately readable; yEd's
own layout algorithms (Layout menu) can then rearrange it however preferred.
"""
import io
import xml.etree.ElementTree as ET
from collections import defaultdict

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from ..database import get_db
from ..models import (
    Server, Service, ServiceInstance, Environment, Application, Cluster,
    InternetRouter, Relation, InstanceRelation,
)

router = APIRouter(tags=["export"])

GRAPHML_NS = "http://graphml.graphdrawing.org/xmlns"
Y_NS = "http://www.yworks.com/xml/graphml"
ET.register_namespace("", GRAPHML_NS)
ET.register_namespace("y", Y_NS)


def _y(tag: str) -> str:
    return f"{{{Y_NS}}}{tag}"


# (key id, applies to "node"/"edge", attribute name, GraphML type)
_KEYS = [
    ("d_label",        "node", "label",         "string"),
    ("d_kind",         "node", "kind",          "string"),
    ("d_hostname",     "node", "hostname",      "string"),
    ("d_common_name",  "node", "common_name",   "string"),
    ("d_fqdn",         "node", "fqdn",          "string"),
    ("d_os_type",      "node", "os_type",       "string"),
    ("d_service_type", "node", "service_type",  "string"),
    ("d_ips",          "node", "ips",           "string"),
    ("d_host",         "node", "host",          "string"),
    ("d_environments", "node", "environments",  "string"),
    ("d_applications", "node", "applications",  "string"),
    ("d_members",      "node", "members",       "string"),
    ("d_subnet",       "node", "subnet",        "string"),
    ("d_color",        "node", "color",         "string"),
    ("d_provider",     "node", "provider",      "string"),
    ("d_external_ip",  "node", "external_ip",   "string"),
    ("d_internal_ip",  "node", "internal_ip",   "string"),
    ("d_is_gateway",   "node", "is_gateway",    "boolean"),
    ("d_description",  "node", "description",   "string"),
    ("d_version",      "node", "version",       "string"),
    ("d_port",         "node", "port",          "string"),
    ("e_label",        "edge", "label",         "string"),
    ("e_kind",         "edge", "kind",          "string"),
    ("e_direction",    "edge", "direction",     "string"),
]

# yEd-visible shape/fill per node kind (a "generic node" for anything
# unlisted) — environment/application nodes carry their own DB color instead
# and only fall back to this if unset.
_KIND_STYLE = {
    "environment": {"shape": "hexagon",  "color": "#22c55e", "height": 40.0},
    "application": {"shape": "hexagon",  "color": "#3b82f6", "height": 40.0},
    "router":      {"shape": "diamond",  "color": "#f97316", "height": 40.0},
    "server":      {"shape": "rectangle", "color": "#1e4080", "height": 30.0},
    "instance":    {"shape": "ellipse",  "color": "#2a6a4a", "height": 30.0},
    "cluster":     {"shape": "diamond",  "color": "#7c3aed", "height": 40.0},
}
_DEFAULT_STYLE = {"shape": "rectangle", "color": "#5a6a8a", "height": 30.0}

# One row per kind, top to bottom, purely so the initial (pre-layout) view
# groups similar things together instead of interleaving them at random.
_KIND_ROW = {"environment": 0, "application": 1, "router": 2, "server": 3, "instance": 4, "cluster": 5}
_ROW_HEIGHT = 150.0
_NODE_GAP = 30.0


def _node_id(kind: str, obj_id: int) -> str:
    return f"{kind}_{obj_id}"


class _GraphBuilder:
    """Accumulates GraphML <node>/<edge> elements and writes them, plus the
    fixed <key> declarations above, into a single <graph> element."""

    def __init__(self):
        self.graph = ET.Element(
            "graph", {"id": "systemdocu", "edgedefault": "directed"}
        )
        self._edge_seq = 0
        self._kind_next_x: dict[str, float] = defaultdict(float)

    def _node_geometry(self, kind: str, label: str) -> tuple[float, float, float, float]:
        """Places nodes of the same kind left-to-right in their own row,
        packed by each node's own (label-based) width - see module docstring
        for why any position at all is needed here."""
        style = _KIND_STYLE.get(kind, _DEFAULT_STYLE)
        width = max(80.0, min(240.0, 9.0 * len(label or "") + 24.0))
        height = style["height"]
        x = self._kind_next_x[kind]
        y = _KIND_ROW.get(kind, len(_KIND_ROW)) * _ROW_HEIGHT
        self._kind_next_x[kind] = x + width + _NODE_GAP
        return x, y, width, height

    def add_node(self, node_id: str, **attrs) -> None:
        el = ET.SubElement(self.graph, "node", {"id": node_id})
        for name, value in attrs.items():
            if value is None or value == "":
                continue
            key = "d_" + name
            data = ET.SubElement(el, "data", {"key": key})
            data.text = str(value).lower() if name == "is_gateway" else str(value)

        kind = attrs.get("kind", "")
        label = str(attrs.get("label") or node_id)
        style = _KIND_STYLE.get(kind, _DEFAULT_STYLE)
        fill = attrs.get("color") or style["color"]
        x, y, width, height = self._node_geometry(kind, label)

        gfx = ET.SubElement(el, "data", {"key": "d_gfx"})
        shape_node = ET.SubElement(gfx, _y("ShapeNode"))
        ET.SubElement(shape_node, _y("Geometry"), {
            "x": f"{x:.1f}", "y": f"{y:.1f}", "width": f"{width:.1f}", "height": f"{height:.1f}",
        })
        ET.SubElement(shape_node, _y("Fill"), {"color": fill, "transparent": "false"})
        ET.SubElement(shape_node, _y("BorderStyle"), {"color": "#000000", "type": "line", "width": "1.0"})
        node_label = ET.SubElement(shape_node, _y("NodeLabel"))
        node_label.text = label
        ET.SubElement(shape_node, _y("Shape"), {"type": style["shape"]})

    def add_edge(self, source: str, target: str, **attrs) -> None:
        self._edge_seq += 1
        el = ET.SubElement(
            self.graph, "edge",
            {"id": f"e{self._edge_seq}", "source": source, "target": target},
        )
        for name, value in attrs.items():
            if value is None or value == "":
                continue
            data = ET.SubElement(el, "data", {"key": "e_" + name})
            data.text = str(value)

        gfx = ET.SubElement(el, "data", {"key": "e_gfx"})
        poly_edge = ET.SubElement(gfx, _y("PolyLineEdge"))
        ET.SubElement(poly_edge, _y("LineStyle"), {"color": "#4a6a8a", "type": "line", "width": "1.0"})
        direction = attrs.get("direction")
        arrows = {"source": "none", "target": "standard"}
        if direction == "both":
            arrows["source"] = "standard"
        elif direction == "none":
            arrows["target"] = "none"
        ET.SubElement(poly_edge, _y("Arrows"), arrows)
        label_text = attrs.get("label")
        if label_text:
            edge_label = ET.SubElement(poly_edge, _y("EdgeLabel"))
            edge_label.text = str(label_text)


def _build_document(
    servers: list[Server],
    environments: list[Environment],
    applications: list[Application],
    clusters: list[Cluster],
    routers: list[InternetRouter],
    relations: list[Relation],
    instance_relations: list[InstanceRelation],
) -> ET.Element:
    root = ET.Element("graphml", {"xmlns": GRAPHML_NS})
    for key_id, for_, name, type_ in _KEYS:
        ET.SubElement(root, "key", {
            "id": key_id, "for": for_,
            "attr.name": name, "attr.type": type_,
        })
    # yFiles graphics keys — see module docstring. No attr.name/attr.type:
    # yfiles.type tells yEd the <data> holds a <y:ShapeNode>/<y:PolyLineEdge>
    # rather than a plain attribute value.
    ET.SubElement(root, "key", {"for": "node", "id": "d_gfx", "yfiles.type": "nodegraphics"})
    ET.SubElement(root, "key", {"for": "edge", "id": "e_gfx", "yfiles.type": "edgegraphics"})

    g = _GraphBuilder()

    # ── Environments, Applications, Routers ──────────────────────────────
    for env in environments:
        g.add_node(_node_id("environment", env.id), label=env.name, kind="environment",
                   subnet=env.subnet, color=env.color, description=env.description)
    for app in applications:
        g.add_node(_node_id("application", app.id), label=app.name, kind="application",
                   color=app.color, description=app.description)
    for r in routers:
        g.add_node(_node_id("router", r.id), label=r.name, kind="router",
                   provider=r.provider, external_ip=r.external_ip, internal_ip=r.internal_ip)
    for r in routers:
        if r.upstream_router_id:
            g.add_edge(_node_id("router", r.id), _node_id("router", r.upstream_router_id),
                       kind="upstream", label="upstream")
        if r.server_id:
            g.add_edge(_node_id("router", r.id), _node_id("server", r.server_id),
                       kind="linked_server", label="Verknüpfter Server")
        for env in r.environments or []:
            g.add_edge(_node_id("router", r.id), _node_id("environment", env.id),
                       kind="gateway_for", label="Gateway für")

    # ── Clusters (node now, members wired once instances exist below) ───
    for cl in clusters:
        g.add_node(_node_id("cluster", cl.id), label=cl.name, kind="cluster",
                   service_type=cl.service_type, fqdn=cl.domain, description=cl.description)

    # ── Servers, their Services/Instances, and every edge that touches them
    for srv in servers:
        ips = ", ".join(x.ip for x in srv.ips)
        g.add_node(_node_id("server", srv.id), label=srv.hostname, kind="server",
                   hostname=srv.hostname, common_name=srv.common_name, fqdn=srv.fqdn,
                   os_type=srv.os_type, ips=ips, is_gateway=srv.is_gateway,
                   description=srv.description)

        for env in srv.environments or []:
            g.add_edge(_node_id("server", srv.id), _node_id("environment", env.id),
                       kind="member_of", label="Umgebung")
        for app in srv.applications or []:
            g.add_edge(_node_id("server", srv.id), _node_id("application", app.id),
                       kind="belongs_to", label="Anwendung")
        if srv.gateway_router_id:
            g.add_edge(_node_id("server", srv.id), _node_id("router", srv.gateway_router_id),
                       kind="gateway", label="Gateway")
        if srv.gateway_server_id:
            g.add_edge(_node_id("server", srv.id), _node_id("server", srv.gateway_server_id),
                       kind="gateway", label="Gateway")

        for svc in srv.services or []:
            for inst in svc.instances or []:
                inst_ips = ", ".join(x.ip for x in inst.ips)
                envs = ", ".join(e.name for e in (inst.environments or []))
                apps = ", ".join(a.name for a in (inst.applications or []))
                g.add_node(
                    _node_id("instance", inst.id), label=inst.name, kind="instance",
                    fqdn=inst.fqdn, service_type=svc.type, host=srv.hostname,
                    ips=inst_ips, environments=envs, applications=apps,
                    is_gateway=inst.is_gateway, description=inst.description,
                    version=svc.version, port=svc.port,
                )
                g.add_edge(_node_id("server", srv.id), _node_id("instance", inst.id),
                           kind="hosts", label=svc.type)
                for env in inst.environments or []:
                    g.add_edge(_node_id("instance", inst.id), _node_id("environment", env.id),
                               kind="member_of", label="Umgebung")
                for app in inst.applications or []:
                    g.add_edge(_node_id("instance", inst.id), _node_id("application", app.id),
                               kind="belongs_to", label="Anwendung")
                if inst.gateway_router_id:
                    g.add_edge(_node_id("instance", inst.id), _node_id("router", inst.gateway_router_id),
                               kind="gateway", label="Gateway")
                if inst.gateway_server_id:
                    g.add_edge(_node_id("instance", inst.id), _node_id("server", inst.gateway_server_id),
                               kind="gateway", label="Gateway")
                if inst.gateway_instance_id:
                    g.add_edge(_node_id("instance", inst.id), _node_id("instance", inst.gateway_instance_id),
                               kind="gateway", label="Gateway")
                for cl in inst.clusters or []:
                    g.add_edge(_node_id("cluster", cl.id), _node_id("instance", inst.id),
                               kind="cluster_member", label=cl.name)

        # A cluster's own_instances (created directly under it, no Server
        # parent) still need to exist as nodes — otherwise instance_relations
        # pointing at them below would reference a non-existent id.
    for cl in clusters:
        for inst in cl.own_instances or []:
            inst_ips = ", ".join(x.ip for x in inst.ips)
            envs = ", ".join(e.name for e in (inst.environments or []))
            g.add_node(
                _node_id("instance", inst.id), label=inst.name, kind="instance",
                fqdn=inst.fqdn, service_type=cl.service_type, ips=inst_ips,
                environments=envs, description=inst.description,
            )
            g.add_edge(_node_id("cluster", cl.id), _node_id("instance", inst.id),
                       kind="cluster_member", label=cl.name)

    # ── Server-Server relations ───────────────────────────────────────────
    for rel in relations:
        g.add_edge(_node_id("server", rel.source_id), _node_id("server", rel.target_id),
                   kind=rel.type, label=rel.type)

    # ── Instance/Cluster relations ────────────────────────────────────────
    for ir in instance_relations:
        src = _node_id("cluster", ir.source_cluster_id) if ir.source_cluster_id \
            else _node_id("instance", ir.source_instance_id)
        tgt = _node_id("cluster", ir.target_cluster_id) if ir.target_cluster_id \
            else _node_id("instance", ir.target_instance_id)
        g.add_edge(src, tgt, kind=ir.type, label=ir.type, direction=ir.direction)

    root.append(g.graph)
    return root


@router.get("/api/export/graphml")
async def export_graphml(db: AsyncSession = Depends(get_db)):
    servers_result = await db.execute(
        select(Server).options(
            selectinload(Server.services).selectinload(Service.instances)
            .selectinload(ServiceInstance.ips),
            selectinload(Server.services).selectinload(Service.instances)
            .selectinload(ServiceInstance.environments),
            selectinload(Server.services).selectinload(Service.instances)
            .selectinload(ServiceInstance.applications),
            selectinload(Server.services).selectinload(Service.instances)
            .selectinload(ServiceInstance.clusters),
            selectinload(Server.environments),
            selectinload(Server.applications),
            selectinload(Server.ips),
        )
    )
    servers = list(servers_result.scalars().all())

    environments = (await db.execute(select(Environment))).scalars().all()
    applications = (await db.execute(select(Application))).scalars().all()
    routers = (await db.execute(
        select(InternetRouter).options(selectinload(InternetRouter.environments))
    )).scalars().all()
    clusters = (await db.execute(
        select(Cluster).options(
            selectinload(Cluster.own_instances).selectinload(ServiceInstance.ips),
            selectinload(Cluster.own_instances).selectinload(ServiceInstance.environments),
        )
    )).scalars().all()
    relations = (await db.execute(select(Relation))).scalars().all()
    instance_relations = (await db.execute(select(InstanceRelation))).scalars().all()

    root = _build_document(
        servers, environments, applications, clusters, routers,
        relations, instance_relations,
    )

    buf = io.BytesIO()
    ET.ElementTree(root).write(buf, encoding="utf-8", xml_declaration=True)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/xml",
        headers={"Content-Disposition": "attachment; filename=systemdocu.graphml"},
    )
