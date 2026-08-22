"""Integration tests: PUT /api/users/auto-responder — TODO_SPEC.md "משימה 18"
step 2. Unlike PATCH /api/users/{id}/signature, this endpoint's path carries no
user_id at all (the spec's own literal path), so it always acts on the caller's
own row by construction — there's no "someone else's id" for a test to try and
spoof, only "am I authenticated at all"."""
from datetime import date, timedelta

from tests.conftest import auth_headers


def test_update_auto_responder_requires_auth(client, make_user):
    make_user(role="FIELD_WORKER")
    resp = client.put(
        "/api/users/auto-responder",
        json={"auto_reply_enabled": True, "auto_reply_start": None, "auto_reply_end": None, "auto_reply_body": None},
    )
    assert resp.status_code == 401


def test_user_can_save_and_load_own_auto_responder_settings(client, make_user):
    user = make_user(role="FIELD_WORKER")
    start = date.today().isoformat()
    end = (date.today() + timedelta(days=7)).isoformat()

    resp = client.put(
        "/api/users/auto-responder",
        json={
            "auto_reply_enabled": True,
            "auto_reply_start": start,
            "auto_reply_end": end,
            "auto_reply_body": "<p>אני בחופשה</p>",
        },
        headers=auth_headers(user),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["auto_reply_enabled"] is True
    assert body["auto_reply_start"] == start
    assert body["auto_reply_end"] == end
    assert body["auto_reply_body"] == "<p>אני בחופשה</p>"

    # Round-trips back out via GET /auth/me too, same as signature does.
    me = client.get("/api/auth/me", headers=auth_headers(user))
    assert me.json()["auto_reply_enabled"] is True
    assert me.json()["auto_reply_start"] == start
    assert me.json()["auto_reply_end"] == end
    assert me.json()["auto_reply_body"] == "<p>אני בחופשה</p>"


def test_auto_responder_settings_are_self_only_by_construction(client, make_user):
    """There is no id in the request body/path for another user to be targeted by —
    two different callers hitting the same literal endpoint always write to their
    own row, never each other's."""
    alice = make_user(role="FIELD_WORKER")
    bob = make_user(role="FIELD_WORKER")

    client.put(
        "/api/users/auto-responder",
        json={"auto_reply_enabled": True, "auto_reply_start": None, "auto_reply_end": None, "auto_reply_body": "<p>אליס</p>"},
        headers=auth_headers(alice),
    )

    bob_me = client.get("/api/auth/me", headers=auth_headers(bob))
    assert bob_me.json()["auto_reply_enabled"] is False
    assert bob_me.json()["auto_reply_body"] is None


def test_auto_reply_body_is_sanitized_on_write(client, make_user):
    user = make_user(role="FIELD_WORKER")
    resp = client.put(
        "/api/users/auto-responder",
        json={
            "auto_reply_enabled": True,
            "auto_reply_start": None,
            "auto_reply_end": None,
            "auto_reply_body": "<p>שלום</p><script>alert(1)</script>",
        },
        headers=auth_headers(user),
    )
    assert resp.status_code == 200
    body = resp.json()["auto_reply_body"]
    assert "<script" not in body
    assert "<p>שלום</p>" in body


def test_clearing_auto_reply_body_sets_null_without_sanitizing(client, make_user):
    user = make_user(role="FIELD_WORKER")
    client.put(
        "/api/users/auto-responder",
        json={"auto_reply_enabled": True, "auto_reply_start": None, "auto_reply_end": None, "auto_reply_body": "<p>ישן</p>"},
        headers=auth_headers(user),
    )
    resp = client.put(
        "/api/users/auto-responder",
        json={"auto_reply_enabled": False, "auto_reply_start": None, "auto_reply_end": None, "auto_reply_body": None},
        headers=auth_headers(user),
    )
    assert resp.status_code == 200
    assert resp.json()["auto_reply_body"] is None
    assert resp.json()["auto_reply_enabled"] is False


def test_new_user_defaults_to_auto_responder_disabled(client, make_user):
    user = make_user(role="FIELD_WORKER")
    me = client.get("/api/auth/me", headers=auth_headers(user))
    assert me.json()["auto_reply_enabled"] is False
    assert me.json()["auto_reply_start"] is None
    assert me.json()["auto_reply_end"] is None
    assert me.json()["auto_reply_body"] is None
