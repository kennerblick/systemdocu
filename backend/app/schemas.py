from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel


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


class ZabbixHost(BaseModel):
    hostname: str
    fqdn: Optional[str] = None
    ip: Optional[str] = None
    os_type: str = "linux"
    services: List[ServiceCreate] = []


class ZabbixImportPayload(BaseModel):
    hosts: List[ZabbixHost]
