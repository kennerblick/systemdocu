from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel


class EnvironmentBase(BaseModel):
    name: str
    description: Optional[str] = None
    color: str = "#3b82f6"
    subnet: Optional[str] = None
    gateway: Optional[str] = None


class EnvironmentCreate(EnvironmentBase):
    pass


class EnvironmentUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    color: Optional[str] = None
    subnet: Optional[str] = None
    gateway: Optional[str] = None


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
    ip: Optional[str] = None


class ServiceInstanceCreate(ServiceInstanceBase):
    pass


class ServiceInstanceUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    ip: Optional[str] = None


class ServiceInstanceOut(ServiceInstanceBase):
    id: int
    service_id: int
    applications: List[ApplicationOut] = []
    environments: List[EnvironmentOut] = []

    class Config:
        from_attributes = True


class ServiceBase(BaseModel):
    type: str
    version: Optional[str] = None
    port: Optional[int] = None
    detail: Optional[str] = None


class ServiceCreate(ServiceBase):
    pass


class ServiceOut(ServiceBase):
    id: int
    server_id: int
    instances: List[ServiceInstanceOut] = []

    class Config:
        from_attributes = True


class ServerBase(BaseModel):
    hostname: str
    ip: Optional[str] = None
    os_type: str = "linux"
    description: Optional[str] = None


class ServerCreate(ServerBase):
    pass


class ServerUpdate(BaseModel):
    hostname: Optional[str] = None
    ip: Optional[str] = None
    os_type: Optional[str] = None
    description: Optional[str] = None


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
    source_instance_id: int
    target_instance_id: int
    type: str = "connects_to"


class InstanceRelationOut(InstanceRelationCreate):
    id: int

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
