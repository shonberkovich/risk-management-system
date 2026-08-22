"""In-memory pub/sub for Server-Sent Events (TODO_SPEC.md, "משימה 4": push
real-time notifications — currently just `new_email`, wired in from
`services/email.py` — to any browser tab a user has open, no polling).

Keyed by `user_id`, not by a single connection: a user may have the app open in
several tabs at once, so each tab registers its own `asyncio.Queue` and every one
of them receives every event broadcast to that `user_id`.

No persistence and no cross-process fan-out — this mirrors how
`services/notifications.py` "sends" without a real provider (see that module's
docstring): a single in-process dict is enough for this course demo's one-worker
dev server, not a real broker like Redis pub/sub a multi-process deployment would
need. `broadcast()` for a `user_id` with no open connection is a silent no-op —
the mailbox itself (Task 5's `GET /api/emails`) is the source of truth; this is
just the live nudge to go re-fetch it, so a dropped event is harmless.

Everything here is synchronous (no I/O happens directly in connect/disconnect/
broadcast — only `asyncio.Queue`, whose put/get are the async parts, used by the
router). That keeps this module trivial to unit-test without an event loop.
"""
from __future__ import annotations

import asyncio
from collections import defaultdict


class ConnectionManager:
    """Holds the set of open `asyncio.Queue`s per `user_id`. A user's stream can
    only ever be fed events broadcast to *their own* `user_id` — there is no API
    on this class to enumerate or address another user's queues, which is what
    makes "never leak one user's events into another's stream" true by
    construction rather than by careful call-site discipline."""

    def __init__(self) -> None:
        self._connections: dict[int, set[asyncio.Queue]] = defaultdict(set)

    def connect(self, user_id: int) -> asyncio.Queue:
        """Registers a new queue for `user_id` (one per open tab/connection) and
        returns it. The caller (routers/sse.py) reads from this queue for the
        lifetime of one SSE stream and must call disconnect() with the same
        queue when the stream ends."""
        queue: asyncio.Queue = asyncio.Queue()
        self._connections[user_id].add(queue)
        return queue

    def disconnect(self, user_id: int, queue: asyncio.Queue) -> None:
        """Deregisters `queue`. Safe to call even if `user_id`/`queue` was never
        registered (or was already disconnected) — idempotent, so cleanup code
        never needs to guard against calling it twice. Once a user's last queue
        is removed, the now-empty set itself is dropped too, so a user who
        disconnected their last tab and a user who was never connected look
        identical in `_connections` — the dict does not grow without bound as
        users come and go over the process's lifetime."""
        queues = self._connections.get(user_id)
        if queues is None:
            return
        queues.discard(queue)
        if not queues:
            del self._connections[user_id]

    def broadcast(self, user_id: int, event: dict) -> None:
        """Puts the JSON-serializable `event` dict onto every queue currently
        registered for `user_id`. No-op (not an error) if that user has no open
        connection right now — see module docstring."""
        for queue in self._connections.get(user_id, ()):
            queue.put_nowait(event)

    def connection_count(self, user_id: int) -> int:
        """Number of currently-open queues for `user_id`. Mainly for tests that
        want to assert cleanup actually happened rather than just "didn't
        raise"."""
        return len(self._connections.get(user_id, ()))


# Process-wide singleton: every request handler and the email service share one
# ConnectionManager, the same way `services/notifications.py` has one implicit
# routing table for the life of the process. Tests that want an isolated instance
# (rather than the shared singleton) should construct their own ConnectionManager()
# directly instead of importing `manager`.
manager = ConnectionManager()


def connect(user_id: int) -> asyncio.Queue:
    return manager.connect(user_id)


def disconnect(user_id: int, queue: asyncio.Queue) -> None:
    manager.disconnect(user_id, queue)


def broadcast(user_id: int, event: dict) -> None:
    manager.broadcast(user_id, event)
