"""Unit tests for app/services/sse_manager.py and the auth surface of
GET /api/sse/stream (TODO_SPEC.md "משימה 4").

ConnectionManager is fully synchronous (asyncio.Queue objects are only ever
`put`/`get` from async code in routers/sse.py, never here), so it needs no
event loop / pytest-asyncio to test directly — each test below builds its own
ConnectionManager() instance rather than importing the process-wide `manager`
singleton, so tests can't leak state into each other.

Full success-path streaming (a valid token actually receiving `new_email`
events over the wire) is intentionally not exercised with FastAPI's TestClient:
the endpoint's generator only ever terminates on client-disconnect/heartbeat-
forever, so driving it through a synchronous test client would hang rather than
return. That behavior is instead verified by direct reasoning plus the
ConnectionManager tests below: routers/sse.py registers exactly one queue per
stream via sse_manager.connect() and deregisters it in a `finally` block via
sse_manager.disconnect() (see that module's docstring) regardless of *how* the
generator exits (normal break on request.is_disconnected(), or any exception
propagating out of a `yield`, including CancelledError/GeneratorExit) — so the
same "always exactly one connect + one eventual disconnect, and disconnect is
idempotent" guarantees ConnectionManager.disconnect provides here are exactly
what prevents a queue leak over the life of the process. What *is* practical
and is tested here: the endpoint's auth dependency rejects a missing or invalid
token before any StreamingResponse/generator is ever created.
"""
from __future__ import annotations

import asyncio

import pytest

from app.services.sse_manager import ConnectionManager


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
