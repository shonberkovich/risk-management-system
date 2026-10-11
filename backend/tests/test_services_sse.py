"""Unit tests for app/services/sse_manager.py and the auth surface of
GET /api/sse/stream (TODO_SPEC.md "משימה 4").

ConnectionManager is fully synchronous (asyncio.Queue objects are only ever
`put`/`get` from async code in routers/sse.py, never here), so it needs no
event loop / pytest-asyncio to test directly — each test below builds its own
ConnectionManager() instance rather than importing the process-wide `manager`
singleton, so tests can't leak state into each other.

Full success-path streaming (a valid token actually receiving `new_email`
events over the wire) is intentionally not exercised with FastAPI's TestClient:
the endpoint's generator only terminates on client disconnect or server shutdown
(heartbeating forever otherwise), so driving it through a synchronous test client
would hang rather than return. The server-shutdown path (CLOSE_STREAM: deliver
what's already queued, end, deregister) is instead driven directly against the
generator by test_event_stream_ends_when_the_server_shuts_down. The
client-disconnect paths are verified by direct reasoning plus the
ConnectionManager tests below: routers/sse.py registers exactly one queue per
stream via sse_manager.connect() and deregisters it in a `finally` block via
sse_manager.disconnect() (see that module's docstring) regardless of *how* the
generator exits (break on request.is_disconnected() or on CLOSE_STREAM, or any
exception propagating out of a `yield`, including CancelledError/GeneratorExit) —
so the same "always exactly one connect + one eventual disconnect, and
disconnect is idempotent" guarantees ConnectionManager.disconnect provides here
are exactly what prevents a queue leak over the life of the process. Also tested
here: the endpoint's auth dependency rejects a missing or invalid token before
any StreamingResponse/generator is ever created.
"""
from __future__ import annotations

import asyncio

import pytest

from app.services.sse_manager import CLOSE_STREAM, ConnectionManager


def test_connect_returns_a_queue_and_supports_multiple_per_user():
    manager = ConnectionManager()
    q1 = manager.connect(user_id=1)
    q2 = manager.connect(user_id=1)

    assert isinstance(q1, asyncio.Queue)
    assert q1 is not q2  # two tabs for the same user -> two independent queues
    assert manager.connection_count(1) == 2


def test_broadcast_delivers_to_every_queue_for_that_user_only():
    manager = ConnectionManager()
    q1 = manager.connect(user_id=1)
    q2 = manager.connect(user_id=1)
    other_q = manager.connect(user_id=2)

    event = {"type": "new_email", "email_id": 42}
    manager.broadcast(1, event)

    assert q1.get_nowait() == event
    assert q2.get_nowait() == event
    assert other_q.empty()  # user 2 must never see user 1's event


def test_broadcast_to_user_with_no_connection_is_a_silent_noop():
    manager = ConnectionManager()
    # No connect() call for user_id=999 at all — must not raise.
    manager.broadcast(999, {"type": "new_email", "email_id": 1})


def test_disconnect_removes_only_the_given_queue():
    manager = ConnectionManager()
    q1 = manager.connect(user_id=1)
    q2 = manager.connect(user_id=1)

    manager.disconnect(1, q1)

    assert manager.connection_count(1) == 1
    manager.broadcast(1, {"type": "new_email"})
    assert q2.get_nowait() == {"type": "new_email"}
    assert q1.empty()  # disconnected queue receives nothing more


def test_disconnect_last_queue_for_a_user_drops_the_entry_entirely():
    """Guards against the ConnectionManager leaking memory over time: once a
    user's last tab closes, their entry must be gone, not just empty — an
    internal dict of ever-growing empty sets for every user who has ever
    connected and left would itself be a slow leak."""
    manager = ConnectionManager()
    q = manager.connect(user_id=1)

    manager.disconnect(1, q)

    assert manager.connection_count(1) == 0
    assert 1 not in manager._connections  # entry itself removed, not left empty


def test_disconnect_is_idempotent_and_safe_for_unknown_user_or_queue():
    manager = ConnectionManager()
    q = manager.connect(user_id=1)
    manager.disconnect(1, q)

    manager.disconnect(1, q)  # disconnecting again must not raise
    manager.disconnect(1, asyncio.Queue())  # unknown queue for a known user
    manager.disconnect(404, asyncio.Queue())  # user that was never connected


def test_many_connect_disconnect_cycles_leave_no_residue():
    """A rough proxy for "no leak over time": repeatedly connecting and
    disconnecting the same user must always return to a clean baseline."""
    manager = ConnectionManager()
    for _ in range(50):
        q = manager.connect(user_id=7)
        manager.broadcast(7, {"type": "new_email"})
        manager.disconnect(7, q)

    assert manager.connection_count(7) == 0
    assert 7 not in manager._connections


# --- Server shutdown (close_all) ----------------------------------------------

def test_close_all_ends_every_open_queue_for_every_user():
    manager = ConnectionManager()
    queues = [manager.connect(user_id=1), manager.connect(user_id=1), manager.connect(user_id=2)]

    manager.close_all()

    for q in queues:
        assert q.get_nowait() is CLOSE_STREAM


def test_connect_after_close_all_returns_an_already_closed_unregistered_queue():
    manager = ConnectionManager()
    manager.close_all()

    q = manager.connect(user_id=1)

    assert q.get_nowait() is CLOSE_STREAM
    assert manager.connection_count(1) == 0
    manager.disconnect(1, q)  # the stream's `finally` still calls this — must stay safe


class _ConnectedRequest:
    async def is_disconnected(self) -> bool:
        return False


def test_event_stream_ends_when_the_server_shuts_down(monkeypatch):
    """Regression: the stream used to end only when the client disconnected, so
    uvicorn's graceful shutdown — which waits for every open response — never
    finished while a tab was open: Ctrl+C and every --reload left the dev server
    hanging. close_all must end it promptly (well before the 20s heartbeat), after
    delivering anything already queued, and the stream must deregister itself."""
    from app.routers import sse
    from app.services import sse_manager

    manager = ConnectionManager()
    monkeypatch.setattr(sse_manager, "manager", manager)

    async def scenario():
        chunks = []

        async def consume():
            async for chunk in sse._event_stream(_ConnectedRequest(), user_id=7):
                chunks.append(chunk)

        task = asyncio.create_task(consume())
        for _ in range(100):
            if manager.connection_count(7):
                break
            await asyncio.sleep(0.01)
        assert manager.connection_count(7) == 1

        manager.broadcast(7, {"type": "new_email", "email_id": 1})
        manager.close_all()
        await asyncio.wait_for(task, timeout=2)
        return chunks

    chunks = asyncio.run(scenario())

    assert len(chunks) == 1
    assert chunks[0].startswith("event: new_email\n")
    assert manager.connection_count(7) == 0


# --- GET /api/sse/stream auth -------------------------------------------------

def test_sse_stream_rejects_missing_token(client):
    resp = client.get("/api/sse/stream")
    assert resp.status_code == 401


def test_sse_stream_rejects_invalid_token(client):
    resp = client.get("/api/sse/stream", params={"token": "not-a-real-jwt"})
    assert resp.status_code == 401


def test_sse_stream_rejects_token_for_inactive_user(client, make_user):
    from app.services.auth import create_access_token

    user = make_user(role="PROPERTY_MANAGER", is_active=False)
    token = create_access_token(user.user_id, user.role)

    resp = client.get("/api/sse/stream", params={"token": token})
    assert resp.status_code == 401


@pytest.mark.parametrize("bad_token", ["", None])
def test_sse_stream_treats_empty_token_same_as_missing(client, bad_token):
    params = {} if bad_token is None else {"token": bad_token}
    resp = client.get("/api/sse/stream", params=params)
    assert resp.status_code == 401


# --- GET /api/sse/stream DB-session lifetime -----------------------------------

def test_sse_auth_releases_its_db_session_before_streaming(db, make_user):
    """Regression: the stream's auth dependency used to keep get_db's session (and its
    pooled connection) open for the whole life of the stream, so ~15 open tabs/proxied
    streams exhausted the pool and froze every DB-backed endpoint. The dependency must
    close the session itself as soon as the user is resolved."""
    from app.routers import sse
    from app.services.auth import create_access_token

    user = make_user(role="RISK_MANAGER")
    token = create_access_token(user.user_id, user.role)

    closed = []
    original_close = db.close

    def _spy_close():
        closed.append(True)
        original_close()

    db.close = _spy_close
    user_id = sse._get_current_user_id_from_query(token=token, db=db)

    assert user_id == user.user_id
    assert closed, "the auth dependency must close its DB session before the stream starts"


def test_sse_auth_closes_its_db_session_on_rejection_too(db, make_user):
    from fastapi import HTTPException

    from app.routers import sse

    closed = []
    original_close = db.close

    def _spy_close():
        closed.append(True)
        original_close()

    db.close = _spy_close
    with pytest.raises(HTTPException):
        sse._get_current_user_id_from_query(token="not-a-real-jwt", db=db)
    assert closed