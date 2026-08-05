from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, model_validator

# A server/instance/environment may point at exactly one gateway target
# (a router, a plain server, or — for instances only — another instance),
# never several at once, since "which one wins" would be ambiguous both in
# the API response and in the graph rendering. Each group below is only
# checked on models that actually declare 2+ of its fields, so this one
# mixin covers Server, ServiceInstance and Environment. The same invariant
# is enforced at the database level via CHECK constraints (migration 0008)
# so it holds even for a future endpoint that forgets to use these schemas.
_GATEWAY_FIELD_GROUPS = [
    ("gateway_router_id", "gateway_server_id", "gateway_instance_id"),
    ("default_gateway_router_id", "default_gateway_server_id"),
]


class _SingleGatewayMixin(BaseModel):
    @model_validator(mode="after")
    def _check_single_gateway(self):
        for group in _GATEWAY_FIELD_GROUPS:
            present = [f for f in group if hasattr(self, f)]
            if len(present) < 2:
                continue
            set_fields = [f for f in present if getattr(self, f) is not None]
            if len(set_fields) > 1:
                raise ValueError(
                    f"Nur eines von {', '.join(present)} darf gesetzt sein (gefunden: {', '.join(set_fields)})"
                )
        return self


class StorageCreate(BaseModel):
    name: str
    raid_type: Optional[str] = None
    disk_count: Optional[int] = None
    size_gb: Optional[int] = None
    disk_size_tb: Optional[int] = None
    description: Optional[str] = None


class StorageUpdate(BaseModel):
    name: Optional[str] = None
    raid_type: Optional[str] = None
    disk_count: Optional[int] = None
    size_gb: Optional[int] = None
    disk_size_tb: Optional[int] = None
    description: Optional[str] = None


class StorageOut(StorageCreate):
    id: int
    server_id: int

    class Config:
        from_attributes = True


class EnvironmentBase(BaseModel):
    name: str
    description: Optional[str] = None
    color: str = "#3b82f6"
    subnet: Optional[str] = None
    gateway: Optional[str] = None
    default_gateway_router_id: Optional[int] = None
    default_gateway_server_id: Optional[int] = None


class EnvironmentCreate(EnvironmentBase, _SingleGatewayMixin):
    pass


class EnvironmentUpdate(_SingleGatewayMixin):
    name: Optional[str] = None
    description: Optional[str] = None
    color: Optional[str] = None
    subnet: Optional[str] = None
    gateway: Optional[str] = None
    default_gateway_router_id: Optional[int] = None
    default_gateway_server_id: Optional[int] = None


class EnvironmentOut(EnvironmentBase):
    id: int

    class Config:
        from_attributes = True


class ApplicationBase(BaseModel):
    name: str
    description: Optional[str] = None
    color: str = "#8b5cf6"


class ApplicationCreate(ApplicationBase):
    pass


class ApplicationOut(ApplicationBase):
    id: int

    class Config:
        from_attributes = True


class ServiceInstanceBase(BaseModel):
    name: str
    description: Optional[str] = None
    fqdn: Optional[str] = None
    ip: Optional[str] = None
    is_gateway: bool = False
    available: bool = True
    gateway: Optional[str] = None
    gateway_router_id: Optional[int] = None
    gateway_server_id: Optional[int] = None
    gateway_instance_id: Optional[int] = None


class ServiceInstanceCreate(ServiceInstanceBase, _SingleGatewayMixin):
    pass


class ServiceInstanceUpdate(_SingleGatewayMixin):
    name: Optional[str] = None
    description: Optional[str] = None
    fqdn: Optional[str] = None
    ip: Optional[str] = None
    is_gateway: Optional[bool] = None
    available: Optional[bool] = None
    gateway: Optional[str] = None
    gateway_router_id: Optional[int] = None
    gateway_server_id: Optional[int] = None
    gateway_instance_id: Optional[int] = None
    service_id: Optional[int] = None


class ServiceBase(BaseModel):
    type: str
    version: Optional[str] = None
    port: Optional[int] = None
    detail: Optional[str] = None


class ServiceCreate(ServiceBase):
    pass


class ServiceSimpleOut(ServiceBase):
    id: int
    server_id: Optional[int] = None
    instance_id: Optional[int] = None

    class Config:
        from_attributes = True


class ServiceInstanceOut(ServiceInstanceBase):
    id: int
    service_id: Optional[int] = None
    cluster_id: Optional[int] = None
    storage_id: Optional[int] = None
    applications: List[ApplicationOut] = []
    environments: List[EnvironmentOut] = []
    own_services: List[ServiceSimpleOut] = []

    class Config:
        from_attributes = True


class ServiceOut(ServiceBase):
    id: int
    server_id: Optional[int] = None
    instance_id: Optional[int] = None
    instances: List[ServiceInstanceOut] = []

    class Config:
        from_attributes = True


class ServerBase(BaseModel):
    hostname: str
    common_name: Optional[str] = None
    ip: Optional[str] = None
    gateway: Optional[str] = None
    os_type: str = "linux"
    description: Optional[str] = None
    is_gateway: bool = False
    gateway_router_id: Optional[int] = None
    gateway_server_id: Optional[int] = None


class ServerCreate(ServerBase, _SingleGatewayMixin):
    pass


class ServerUpdate(_SingleGatewayMixin):
    hostname: Optional[str] = None
    common_name: Optional[str] = None
    ip: Optional[str] = None
    gateway: Optional[str] = None
    os_type: Optional[str] = None
    description: Optional[str] = None
    is_gateway: Optional[bool] = None
    gateway_router_id: Optional[int] = None
    gateway_server_id: Optional[int] = None


class ServerOut(ServerBase):
    id: int
    created_at: datetime
    services: List[ServiceOut] = []
    environments: List[EnvironmentOut] = []
    applications: List[ApplicationOut] = []
    storages: List[StorageOut] = []

    class Config:
        from_attributes = True


class RelationBase(BaseModel):
    source_id: int
    target_id: int
    type: str = "connects_to"


class RelationCreate(RelationBase):
    pass


class RelationOut(RelationBase):
    id: int

    class Config:
        from_attributes = True


class InstanceRelationCreate(BaseModel):
    source_instance_id: Optional[int] = None
    source_cluster_id:  Optional[int] = None
    target_instance_id: Optional[int] = None
    target_cluster_id:  Optional[int] = None
    type: str = "connects_to"
    direction: str = "to"


class InstanceRelationOut(InstanceRelationCreate):
    id: int

    class Config:
        from_attributes = True


class InstanceRelationUpdate(BaseModel):
    type: Optional[str] = None
    direction: Optional[str] = None


class ClusterMemberOut(BaseModel):
    id: int
    name: str

    class Config:
        from_attributes = True


class ClusterOwnInstanceCreate(BaseModel):
    name: str
    fqdn: Optional[str] = None
    ip: Optional[str] = None
    description: Optional[str] = None


class ClusterOwnInstanceOut(BaseModel):
    id: int
    name: str
    fqdn: Optional[str] = None
    ip: Optional[str] = None
    description: Optional[str] = None
    environments: List[EnvironmentOut] = []

    class Config:
        from_attributes = True


class ClusterCreate(BaseModel):
    name: str
    description: Optional[str] = None
    service_type: str
    domain: Optional[str] = None


class ClusterUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    service_type: Optional[str] = None
    domain: Optional[str] = None


class ClusterOut(ClusterCreate):
    id: int
    members: List[ClusterMemberOut] = []
    own_instances: List[ClusterOwnInstanceOut] = []

    class Config:
        from_attributes = True


class InternetRouterCreate(BaseModel):
    name: str
    provider: Optional[str] = None
    external_ip: Optional[str] = None
    internal_ip: Optional[str] = None
    upstream_router_id: Optional[int] = None
    server_id: Optional[int] = None
    environment_ids: List[int] = []


class InternetRouterOut(BaseModel):
    id: int
    name: str
    provider: Optional[str] = None
    external_ip: Optional[str] = None
    internal_ip: Optional[str] = None
    upstream_router_id: Optional[int] = None
    server_id: Optional[int] = None
    environments: List[EnvironmentOut] = []

    class Config:
        from_attributes = True
