"""SSE (Server-Sent Events) endpoint — TODO_SPEC.md "משימה 4": a long-lived
`GET /api/sse/stream` connection that pushes real-time events (currently just
`new_email`, broadcast from `services/email.py::send_email`) to a signed-in
user's open browser tab(s) instead of making the client poll.

Auth: browsers' `EventSource` API cannot set custom request headers, so the
normal `Authorization: Bearer <token>` path (`dependencies.permissions.
get_current_user`) doesn't work for this one endpoint. The frontend instead opens
`EventSource("/api/sse/stream?token=<access_token>")` and the token travels as a
query param; `_get_current_user_from_query` below reuses
`permissions.get_user_from_access_token` — the exact same decode + active-user
lookup `get_current_user` uses — so this endpoint enforces identical validity
checks, just fed from a different transport. A missing or invalid token gets the
same 401 any other endpoint would give.

Once authenticated, the handler registers one queue with the process-wide
`sse_manager` keyed by that caller's own `user_id` and streams whatever is put on
it — the manager's API has no way to address any other user's queue, so one
user's stream cannot leak another's events (see sse_manager.ConnectionManager's
docstring). The stream runs until the client disconnects or the server starts
shutting down (sse_manager.close_all, wired up in main.py's lifespan).
"""
from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session
from starlette.responses import StreamingResponse

from app.database import get_db
from app.dependencies.permissions import _UNAUTHORIZED, get_user_from_access_token
from app.services import sse_manager

router = APIRouter(prefix="/api/sse", tags=["sse"])

# How often to send a `: ping` comment line on an otherwise-idle connection, so
# reverse proxies / load balancers with an idle-connection timeout (typically
# 30-60s) don't silently kill the stream. SSE comment lines (leading `:`) are
# ignored by EventSource's `message`/named-event handlers, so this never shows up
# as a spurious event client-side.
HEARTBEAT_INTERVAL_SECONDS = 20


def _get_current_user_id_from_query(
    token: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> int:
    """Authenticates the stream and returns just the user_id — the stream itself
    never touches the DB again.

    The session is closed here, right after the lookup: `get_db`'s own cleanup only
    runs once the response has finished, which for this endpoint means when the
    long-lived stream closes. Holding it that long pinned one of the engine's pooled
    connections (5 + 10 overflow) for as long as each tab stayed open, so ~15 open
    tabs froze every DB-backed endpoint (login included). Closing twice is
    harmless."""
    if not token:
        raise _UNAUTHORIZED
    try:
        return get_user_from_access_token(token, db).user_id
    finally:
        db.close()


async def _event_stream(request: Request, user_id: int):
    queue = sse_manager.connect(user_id)
    try:
        while True:
            # Checked on every loop iteration (so at minimum once per heartbeat
            # interval, sooner if events are flowing) rather than relying only on
            # CancelledError — some proxies/clients close the TCP connection
            # without ever cancelling the ASGI task, and this is what notices
            # that case too.
            if await request.is_disconnected():
                break
            try:
                event = await asyncio.wait_for(queue.get(), timeout=HEARTBEAT_INTERVAL_SECONDS)
            except asyncio.TimeoutError:
                yield ": ping\n\n"
                continue
            if event is sse_manager.CLOSE_STREAM:
                # The server is shutting down (sse_manager.close_all). End the
                # response: uvicorn waits for every open one before the old worker
                # exits, so an endless stream would hang Ctrl+C and every --reload.
                break
            yield f"event: {event.get('type', 'message')}\ndata: {json.dumps(event, ensure_ascii=False)}\n\n"
    finally:
        # Runs on the normal break above, on the client disconnecting mid-`yield`
        # (StreamingResponse raises inside the generator, which propagates through
        # this finally), and on the request being cancelled outright
        # (asyncio.CancelledError / GeneratorExit are just exceptions that also
        # trigger `finally`) — so the queue is always deregistered exactly once,
        # however the stream ends. ConnectionManager.disconnect is itself
        # idempotent, so even an unexpected double-cleanup would be harmless.
        sse_manager.disconnect(user_id, queue)


@router.get("/stream")
async def stream(request: Request, user_id: int = Depends(_get_current_user_id_from_query)):
    return StreamingResponse(
        _event_stream(request, user_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            # nginx-specific: disable response buffering so events reach the
            # client as they're yielded instead of waiting for a full buffer.
            "X-Accel-Buffering": "no",
        },
    )
