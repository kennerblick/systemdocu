from datetime import datetime
from sqlalchemy import (
    Column, Integer, String, Text, DateTime, ForeignKey, Table
)
from sqlalchemy.orm import relationship
from .database import Base

server_tags = Table(
    "server_tags", Base.metadata,
    Column("server_id", Integer, ForeignKey("servers.id", ondelete="CASCADE"), primary_key=True),
    Column("tag_id", Integer, ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True),
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


class Server(Base):
    __tablename__ = "servers"
    id = Column(Integer, primary_key=True, index=True)
    hostname = Column(String(255), unique=True, nullable=False)
    fqdn = Column(String(255))
    ip = Column(String(45))
    os_type = Column(String(50), default="linux")
    description = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow)

    services = relationship("Service", back_populates="server", cascade="all, delete-orphan")
    tags = relationship("Tag", secondary=server_tags, back_populates="servers")
    outgoing_relations = relationship("Relation", foreign_keys="Relation.source_id", back_populates="source", cascade="all, delete-orphan")
    incoming_relations = relationship("Relation", foreign_keys="Relation.target_id", back_populates="target")


class Service(Base):
    __tablename__ = "services"
    id = Column(Integer, primary_key=True, index=True)
    server_id = Column(Integer, ForeignKey("servers.id", ondelete="CASCADE"), nullable=False)
    type = Column(String(50), nullable=False)
    version = Column(String(50))
    port = Column(Integer)
    detail = Column(Text)

    server = relationship("Server", back_populates="services")
    instances = relationship("ServiceInstance", back_populates="service", cascade="all, delete-orphan")


class ServiceInstance(Base):
    __tablename__ = "service_instances"
    id = Column(Integer, primary_key=True, index=True)
    service_id = Column(Integer, ForeignKey("services.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(255), nullable=False)
    description = Column(Text)

    service = relationship("Service", back_populates="instances")
    environments = relationship("Environment", secondary=instance_environments, back_populates="instances")
    applications = relationship("Application", secondary=instance_applications, back_populates="instances")


class Environment(Base):
    __tablename__ = "environments"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), unique=True, nullable=False)
    description = Column(Text)
    color = Column(String(7), default="#3b82f6")

    instances = relationship("ServiceInstance", secondary=instance_environments, back_populates="environments")


class Application(Base):
    __tablename__ = "applications"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), unique=True, nullable=False)
    description = Column(Text)
    color = Column(String(7), default="#8b5cf6")

    instances = relationship("ServiceInstance", secondary=instance_applications, back_populates="instances")


class Tag(Base):
    __tablename__ = "tags"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), unique=True, nullable=False)
    color = Column(String(7), default="#888888")

    servers = relationship("Server", secondary=server_tags, back_populates="tags")


class Relation(Base):
    __tablename__ = "relations"
    id = Column(Integer, primary_key=True, index=True)
    source_id = Column(Integer, ForeignKey("servers.id", ondelete="CASCADE"), nullable=False)
    target_id = Column(Integer, ForeignKey("servers.id", ondelete="CASCADE"), nullable=False)
    type = Column(String(50), default="connects_to")

    source = relationship("Server", foreign_keys=[source_id], back_populates="outgoing_relations")
    target = relationship("Server", foreign_keys=[target_id], back_populates="incoming_relations")
