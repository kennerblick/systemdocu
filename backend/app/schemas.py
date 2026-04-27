from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel


class EnvironmentBase(BaseModel):
    name: str
    description: Optional[str] = None
    color: str = "#3b82f6"
    subnet: Optional[str] = None
    gateway: Optional[str] = None
    default_gateway_router_id: Optional[int] = None
    default_gateway_server_id: Optional[int] = None


class EnvironmentCreate(EnvironmentBase):
    pass


class EnvironmentUpdate(BaseModel):
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
    gateway: Optional[str] = None
    gateway_router_id: Optional[int] = None
    gateway_server_id: Optional[int] = None


class ServiceInstanceCreate(ServiceInstanceBase):
    pass


class ServiceInstanceUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    fqdn: Optional[str] = None
    ip: Optional[str] = None
    gateway: Optional[str] = None
    gateway_router_id: Optional[int] = None
    gateway_server_id: Optional[int] = None
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
    ip: Optional[str] = None
    gateway: Optional[str] = None
    os_type: str = "linux"
    description: Optional[str] = None
    is_gateway: bool = False
    gateway_router_id: Optional[int] = None
    gateway_server_id: Optional[int] = None


class ServerCreate(ServerBase):
    pass


class ServerUpdate(BaseModel):
    hostname: Optional[str] = None
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


class ZabbixHost(BaseModel):
    hostname: str
    fqdn: Optional[str] = None
    ip: Optional[str] = None
    os_type: str = "linux"
    services: List[ServiceCreate] = []


class ZabbixImportPayload(BaseModel):
    hosts: List[ZabbixHost]
