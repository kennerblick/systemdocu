from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel


class EnvironmentBase(BaseModel):
    name: str
    description: Optional[str] = None
    color: str = "#3b82f6"


class EnvironmentCreate(EnvironmentBase):
    pass


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


class ServiceInstanceCreate(ServiceInstanceBase):
    pass


class ServiceInstanceOut(ServiceInstanceBase):
    id: int
    service_id: int
    environments: List[EnvironmentOut] = []
    applications: List[ApplicationOut] = []

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


class TagBase(BaseModel):
    name: str
    color: str = "#888888"


class TagCreate(TagBase):
    pass


class TagOut(TagBase):
    id: int

    class Config:
        from_attributes = True


class ServerBase(BaseModel):
    hostname: str
    fqdn: Optional[str] = None
    ip: Optional[str] = None
    os_type: str = "linux"
    description: Optional[str] = None


class ServerCreate(ServerBase):
    pass


class ServerUpdate(BaseModel):
    hostname: Optional[str] = None
    fqdn: Optional[str] = None
    ip: Optional[str] = None
    os_type: Optional[str] = None
    description: Optional[str] = None


class ServerOut(ServerBase):
    id: int
    created_at: datetime
    services: List[ServiceOut] = []
    tags: List[TagOut] = []
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


class ZabbixHost(BaseModel):
    hostname: str
    fqdn: Optional[str] = None
    ip: Optional[str] = None
    os_type: str = "linux"
    services: List[ServiceCreate] = []


class ZabbixImportPayload(BaseModel):
    hosts: List[ZabbixHost]
