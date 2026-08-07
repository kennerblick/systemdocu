"""Domain model for systemdocu's heterogeneous-network CMDB.

Server           physical/virtual host (os_type distinguishes hypervisor hosts).
Service          a kind of software present on a Server or a standalone ServiceInstance.
ServiceInstance  one concrete instance of a Service (a VM, a database, a container...) —
                 can carry its own IP, gateway, Environment(s) and Application(s)
                 independent of its parent Server.
Environment      a logical/physical network segment (subnet + gateway) — the
                 "logisches Netzwerk" servers/instances/routers are placed into.
Application      a cross-cutting logical grouping of instances (e.g. "CRM"),
                 independent of which servers/environments they run in.
Cluster          a group of ServiceInstances acting as one unit (e.g. a DB or
                 k8s cluster) — see the two membership kinds on the class itself.
InternetRouter   a physical/logical internet uplink, chainable via upstream_router_id.
Relation / InstanceRelation
                 arbitrary dependency edges — server-level and instance/cluster-level
                 respectively; see the comment on Relation for why both exist.
"""
from datetime import datetime
from sqlalchemy import (
    Column, Integer, String, Text, DateTime, ForeignKey, Table, Boolean
)
from sqlalchemy.orm import relationship
from .database import Base

server_environments = Table(
    "server_environments", Base.metadata,
    Column("server_id", Integer, ForeignKey("servers.id", ondelete="CASCADE"), primary_key=True),
    Column("environment_id", Integer, ForeignKey("environments.id", ondelete="CASCADE"), primary_key=True),
)

instance_environments = Table(
    "instance_environments", Base.metadata,
    Column("instance_id", Integer, ForeignKey("service_instances.id", ondelete="CASCADE"), primary_key=True),
    Column("environment_id", Integer, ForeignKey("environments.id", ondelete="CASCADE"), primary_key=True),
)

instance_applications = Table(
    "instance_applications", Base.metadata,
    Column("instance_id", Integer, ForeignKey("service_instances.id", ondelete="CASCADE"), primary_key=True),
    Column("application_id", Integer, ForeignKey("applications.id", ondelete="CASCADE"), primary_key=True),
)

server_applications = Table(
    "server_applications", Base.metadata,
    Column("server_id", Integer, ForeignKey("servers.id", ondelete="CASCADE"), primary_key=True),
    Column("application_id", Integer, ForeignKey("applications.id", ondelete="CASCADE"), primary_key=True),
)

router_environments = Table(
    "router_environments", Base.metadata,
    Column("router_id", Integer, ForeignKey("internet_routers.id", ondelete="CASCADE"), primary_key=True),
    Column("environment_id", Integer, ForeignKey("environments.id", ondelete="CASCADE"), primary_key=True),
)

cluster_members = Table(
    "cluster_members", Base.metadata,
    Column("cluster_id", Integer, ForeignKey("clusters.id", ondelete="CASCADE"), primary_key=True),
    Column("instance_id", Integer, ForeignKey("service_instances.id", ondelete="CASCADE"), primary_key=True),
)


class Storage(Base):
    __tablename__ = "storages"
    id = Column(Integer, primary_key=True, index=True)
    server_id = Column(Integer, ForeignKey("servers.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(255), nullable=False)
    raid_type = Column(String(50), nullable=True)
    disk_count = Column(Integer, nullable=True)
    size_gb = Column(Integer, nullable=True)
    disk_size_tb = Column(Integer, nullable=True)
    description = Column(Text, nullable=True)

    server = relationship("Server", back_populates="storages")
    instances = relationship("ServiceInstance", back_populates="storage", foreign_keys="[ServiceInstance.storage_id]")


class Server(Base):
    __tablename__ = "servers"
    id = Column(Integer, primary_key=True, index=True)
    hostname = Column(String(255), unique=True, nullable=False)
    common_name = Column(String(255), nullable=True)
    fqdn = Column(String(255))
    ip = Column(Text)
    gateway = Column(String(45))
    os_type = Column(String(50), default="linux")
    description = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow)
    # is_gateway: OTHER nodes may point their gateway_*_id at this server.
    # gateway_router_id / gateway_server_id: where THIS server's own traffic exits —
    # at most one of the two may be set (enforced in schemas.py + a DB CHECK
    # constraint), never both.
    is_gateway = Column(Boolean, default=False)
    gateway_router_id = Column(Integer, ForeignKey("internet_routers.id", ondelete="SET NULL"), nullable=True)
    gateway_server_id = Column(Integer, ForeignKey("servers.id", ondelete="SET NULL"), nullable=True)

    services = relationship("Service", back_populates="server", cascade="all, delete-orphan")
    storages = relationship("Storage", back_populates="server", cascade="all, delete-orphan")
    environments = relationship("Environment", secondary=server_environments, back_populates="servers")
    applications = relationship("Application", secondary=server_applications, back_populates="servers")
    outgoing_relations = relationship("Relation", foreign_keys="Relation.source_id", back_populates="source", cascade="all, delete-orphan")
    incoming_relations = relationship("Relation", foreign_keys="Relation.target_id", back_populates="target")


class Service(Base):
    __tablename__ = "services"
    id = Column(Integer, primary_key=True, index=True)
    server_id = Column(Integer, ForeignKey("servers.id", ondelete="CASCADE"), nullable=True)
    instance_id = Column(Integer, ForeignKey("service_instances.id", ondelete="CASCADE"), nullable=True)
    type = Column(String(50), nullable=False)
    version = Column(String(50))
    port = Column(Integer)
    detail = Column(Text)

    server = relationship("Server", back_populates="services", foreign_keys=[server_id])
    instance = relationship("ServiceInstance", back_populates="own_services", foreign_keys=[instance_id])
    instances = relationship("ServiceInstance", back_populates="service",
                             foreign_keys="[ServiceInstance.service_id]",
                             cascade="all, delete-orphan")


class ServiceInstance(Base):
    __tablename__ = "service_instances"
    id = Column(Integer, primary_key=True, index=True)
    service_id = Column(Integer, ForeignKey("services.id", ondelete="CASCADE"), nullable=True)
    cluster_id = Column(Integer, ForeignKey("clusters.id", ondelete="CASCADE"), nullable=True)
    storage_id = Column(Integer, ForeignKey("storages.id", ondelete="SET NULL"), nullable=True)
    fqdn = Column(String(255), nullable=True)
    name = Column(String(255), nullable=False)
    description = Column(Text)
    ip = Column(Text)
    gateway = Column(String(45))
    # Same "at most one" rule as Server.gateway_*_id, extended with a third option
    # (another instance) since e.g. a VM's gateway can itself be a VM.
    gateway_router_id = Column(Integer, ForeignKey("internet_routers.id", ondelete="SET NULL"), nullable=True)
    gateway_server_id = Column(Integer, ForeignKey("servers.id", ondelete="SET NULL"), nullable=True)

    is_gateway = Column(Boolean, default=False)
    available = Column(Boolean, default=True, nullable=False, server_default='true')
    gateway_instance_id = Column(Integer, ForeignKey("service_instances.id", ondelete="SET NULL"), nullable=True)

    service = relationship("Service", back_populates="instances", foreign_keys=[service_id])
    cluster = relationship("Cluster", back_populates="own_instances", foreign_keys=[cluster_id])
    storage = relationship("Storage", back_populates="instances", foreign_keys=[storage_id])
    own_services = relationship("Service", back_populates="instance",
                                foreign_keys="[Service.instance_id]",
                                cascade="all, delete-orphan")
    environments = relationship("Environment", secondary=instance_environments, back_populates="instances")
    applications = relationship("Application", secondary=instance_applications, back_populates="instances")
    clusters = relationship("Cluster", secondary=cluster_members, back_populates="members")


class Environment(Base):
    __tablename__ = "environments"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), unique=True, nullable=False)
    description = Column(Text)
    color = Column(String(7), default="#3b82f6")
    subnet = Column(String(20))
    gateway = Column(String(45))
    default_gateway_router_id = Column(Integer, ForeignKey("internet_routers.id", ondelete="SET NULL"), nullable=True)
    default_gateway_server_id = Column(Integer, ForeignKey("servers.id", ondelete="SET NULL"), nullable=True)

    instances = relationship("ServiceInstance", secondary=instance_environments, back_populates="environments")
    servers = relationship("Server", secondary=server_environments, back_populates="environments")


class Application(Base):
    __tablename__ = "applications"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), unique=True, nullable=False)
    description = Column(Text)
    color = Column(String(7), default="#8b5cf6")

    instances = relationship("ServiceInstance", secondary=instance_applications, back_populates="applications")
    servers = relationship("Server", secondary=server_applications, back_populates="applications")


class Cluster(Base):
    __tablename__ = "clusters"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False, unique=True)
    description = Column(Text, nullable=True)
    service_type = Column(String(50), nullable=False)
    domain = Column(String(255), nullable=True)
    # Two distinct, non-overlapping ways an instance can belong to a cluster:
    # - members: existing ServiceInstances (already attached to a Server/Service)
    #   added via the cluster_members M:N table — e.g. a Postgres instance
    #   joining a replication cluster.
    # - own_instances: ServiceInstances created directly under this cluster with
    #   no Server/Service parent (POST /clusters/{id}/own-instances) — e.g. a
    #   cluster VIP that isn't tied to one physical host.
    members = relationship("ServiceInstance", secondary=cluster_members, back_populates="clusters")
    own_instances = relationship("ServiceInstance", back_populates="cluster",
                                 foreign_keys="[ServiceInstance.cluster_id]",
                                 cascade="all, delete-orphan")


class InstanceRelation(Base):
    __tablename__ = "instance_relations"
    id = Column(Integer, primary_key=True, index=True)
    source_instance_id = Column(Integer, ForeignKey("service_instances.id", ondelete="CASCADE"), nullable=True)
    source_cluster_id  = Column(Integer, ForeignKey("clusters.id",           ondelete="CASCADE"), nullable=True)
    target_instance_id = Column(Integer, ForeignKey("service_instances.id", ondelete="CASCADE"), nullable=True)
    target_cluster_id  = Column(Integer, ForeignKey("clusters.id",           ondelete="CASCADE"), nullable=True)
    type = Column(String(50), default="connects_to")
    direction = Column(String(10), nullable=False, default="to")


class InternetRouter(Base):
    __tablename__ = "internet_routers"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    provider = Column(String(255))
    external_ip = Column(String(100))
    internal_ip = Column(String(100))
    upstream_router_id = Column(Integer, ForeignKey("internet_routers.id", ondelete="SET NULL"), nullable=True)
    server_id = Column(Integer, ForeignKey("servers.id", ondelete="SET NULL"), nullable=True)

    environments = relationship("Environment", secondary=router_environments)
    upstream = relationship("InternetRouter", remote_side="InternetRouter.id", foreign_keys=[upstream_router_id])
    server = relationship("Server", foreign_keys=[server_id])


# Server-level counterpart to InstanceRelation above: a coarser dependency edge
# between two Servers, used when the relationship isn't specific to one service
# instance. Kept as a separate table/endpoint rather than folded into
# InstanceRelation since the two operate at different granularity (server vs.
# instance/cluster) and the frontend queries them independently.
class Relation(Base):
    __tablename__ = "relations"
    id = Column(Integer, primary_key=True, index=True)
    source_id = Column(Integer, ForeignKey("servers.id", ondelete="CASCADE"), nullable=False)
    target_id = Column(Integer, ForeignKey("servers.id", ondelete="CASCADE"), nullable=False)
    type = Column(String(50), default="connects_to")

    source = relationship("Server", foreign_keys=[source_id], back_populates="outgoing_relations")
    target = relationship("Server", foreign_keys=[target_id], back_populates="incoming_relations")
