"""Server-Sent Events broadcast bus.

Usage in routers:
    from ..events import bus
    await bus.broadcast("data_changed", {"entity": "server"})

Usage in endpoint:
    from .events import bus
    # see main.py for the /api/events endpoint
"""
import asyncio
import json
from contextlib import asynccontextmanager
from typing import AsyncIterator


class EventBus:
    def __init__(self) -> None:
        self._queues: list[asyncio.Queue[str]] = []

    async def broadcast(self, event: str, data: dict | None = None) -> None:
        if not self._queues:
            return
        msg = f"event: {event}\ndata: {json.dumps(data or {})}\n\n"
        for q in list(self._queues):
            try:
                q.put_nowait(msg)
            except asyncio.QueueFull:
                pass  # slow / lagging client — skip rather than block

    @asynccontextmanager
    async def subscribe(self) -> AsyncIterator[asyncio.Queue[str]]:
        q: asyncio.Queue[str] = asyncio.Queue(maxsize=64)
        self._queues.append(q)
        try:
            yield q
        finally:
            try:
                self._queues.remove(q)
            except ValueError:
                pass


bus = EventBus()
