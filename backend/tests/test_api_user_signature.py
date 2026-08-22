"""Integration tests: PATCH /api/users/{id}/signature — TODO_SPEC.md "משימה 14"
step 2 (self-only update, 403 for anyone else's user_id — see routers/users.py's
module docstring for why this endpoint uses 403 rather than Task 5's 404
"not yours" convention), sanitization (reusing services/email.sanitize_body_html
verbatim), and the signature round-tripping back out via GET /api/auth/me."""
from tests.conftest import auth_headers


def test_update_signature_requires_auth(client, make_user):
    target = make_user(role="FIELD_WORKER")
    resp = client.patch(f"/api/users/{target.user_id}/signature", json={"signature": "<p>hi</p>"})
    assert resp.status_code == 401


def test_user_can_update_own_signature(client, make_user):
    user = make_user(role="FIELD_WORKER")
    resp = client.patch(
        f"/api/users/{user.user_id}/signature",
        json={"signature": "<p>ישראל ישראלי</p>"},
        headers=auth_headers(user),
    )
    assert resp.status_code == 200
    assert resp.json()["signature"] == "<p>ישראל ישראלי</p>"


def test_user_cannot_update_someone_elses_signature(client, make_user):
    me = make_user(role="FIELD_WORKER")
    other = make_user(role="FIELD_WORKER")
    resp = client.patch(
        f"/api/users/{other.user_id}/signature",
        json={"signature": "<p>גניבת זהות</p>"},
        headers=auth_headers(me),
    )
    assert resp.status_code == 403

    # Confirm nothing was actually written for `other`.
    other_me = client.get("/api/auth/me", headers=auth_headers(other))
    assert other_me.json()["signature"] is None


def test_admin_cannot_update_another_users_signature_either(client, make_user):
    """This endpoint is deliberately not an ADMIN-privileged write (see
    routers/users.py docstring) — even an ADMIN may only touch their own row here,
    unlike PATCH /api/users/{id} which is ADMIN-only for every *other* field."""
    admin = make_user(role="ADMIN")
    other = make_user(role="FIELD_WORKER")
    resp = client.patch(
        f"/api/users/{other.user_id}/signature",
        json={"signature": "<p>x</p>"},
        headers=auth_headers(admin),
    )
    assert resp.status_code == 403


def test_update_missing_user_id_is_403_not_404(client, make_user):
    """See routers/users.py's module docstring: a user_id that doesn't belong to the
    caller is 403 even if it doesn't exist at all, matching this endpoint's
    "ownership check, not existence check" design — unlike routers/emails.py's
    404-for-privacy convention, there's no secret to protect in a user_id (GET
    /api/users already lists every user_id openly)."""
    me = make_user(role="FIELD_WORKER")
    resp = client.patch(
        "/api/users/999999/signature",
        json={"signature": "<p>x</p>"},
        headers=auth_headers(me),
    )
    assert resp.status_code == 403


def test_signature_html_is_sanitized_on_write(client, make_user):
    """Reuses services/email.sanitize_body_html verbatim — same allow-list as
    Email.body_html (TODO_SPEC.md "משימה 10"): script tags/event handlers stripped,
    a small safe-tag allow-list kept."""
    user = make_user(role="FIELD_WORKER")
    resp = client.patch(
        f"/api/users/{user.user_id}/signature",
        json={"signature": "<p>שלום</p><script>alert(1)</script><img src=x onerror=alert(2)>"},
        headers=auth_headers(user),
    )
    assert resp.status_code == 200
    signature = resp.json()["signature"]
    assert "<script" not in signature
    assert "onerror" not in signature
    assert "<p>שלום</p>" in signature
    # bleach strips the disallowed tag but keeps its inert text content (documented
    # behavior — see sanitize_body_html's own docstring).
    assert "alert(1)" in signature


def test_clearing_signature_sets_null_without_sanitizing(client, make_user):
    user = make_user(role="FIELD_WORKER")
    client.patch(
        f"/api/users/{user.user_id}/signature",
        json={"signature": "<p>ישן</p>"},
        headers=auth_headers(user),
    )
    resp = client.patch(
        f"/api/users/{user.user_id}/signature",
        json={"signature": None},
        headers=auth_headers(user),
    )
    assert resp.status_code == 200
    assert resp.json()["signature"] is None


def test_signature_round_trips_via_auth_me(client, make_user):
    user = make_user(role="RISK_MANAGER")
    client.patch(
        f"/api/users/{user.user_id}/signature",
        json={"signature": "<p>בברכה, מנהל סיכונים</p>"},
        headers=auth_headers(user),
    )
    me = client.get("/api/auth/me", headers=auth_headers(user))
    assert me.status_code == 200
    assert me.json()["signature"] == "<p>בברכה, מנהל סיכונים</p>"


def test_signature_defaults_to_null_for_a_new_user(client, make_user):
    user = make_user(role="FIELD_WORKER")
    me = client.get("/api/auth/me", headers=auth_headers(user))
    assert me.json()["signature"] is None


def test_signature_included_in_login_token_pair(client, make_user):
    """TokenPair.user is UserMeOut too (see schemas.py) — the frontend's AuthContext
    gets the signature immediately on login, without a follow-up /auth/me call."""
    user = make_user(role="FIELD_WORKER", email="sigtest@example.com")
    client.patch(
        f"/api/users/{user.user_id}/signature",
        json={"signature": "<p>חתימה</p>"},
        headers=auth_headers(user),
    )
    login_resp = client.post("/api/auth/login", json={"email": "sigtest@example.com", "password": "Demo1234!"})
    assert login_resp.status_code == 200
    assert login_resp.json()["user"]["signature"] == "<p>חתימה</p>"


def test_open_users_list_does_not_leak_signatures(client, make_user):
    """UserOut (used by the open GET /api/users picker) deliberately stays without
    `signature` — only UserMeOut (self-only endpoints) carries it. See schemas.py's
    UserMeOut docstring."""
    user = make_user(role="FIELD_WORKER")
    client.patch(
        f"/api/users/{user.user_id}/signature",
        json={"signature": "<p>סודי</p>"},
        headers=auth_headers(user),
    )
    listed = client.get("/api/users").json()
    row = next(u for u in listed if u["user_id"] == user.user_id)
    assert "signature" not in row


# --- TODO_SPEC.md "משימה 14" step 5 (optional) — auto-generated default signature ---

def test_new_employee_gets_a_default_name_plus_role_signature(client, make_user):
    admin = make_user(role="ADMIN")
    resp = client.post(
        "/api/users",
        json={"full_name": "ישראל ישראלי", "email": "israel@example.com", "role": "PROPERTY_MANAGER"},
        headers=auth_headers(admin),
    )
    assert resp.status_code == 201
    created = resp.json()

    me = client.get("/api/auth/me", headers=auth_headers(_as_user_row(created)))
    assert "ישראל ישראלי" in me.json()["signature"]
    assert "מנהל נכסים" in me.json()["signature"]


def test_default_signature_html_is_escaped_before_sanitizing(client, make_user):
    """full_name is admin-typed free text — confirms it can't inject markup into the
    auto-generated signature (see _default_signature's doc comment)."""
    admin = make_user(role="ADMIN")
    resp = client.post(
        "/api/users",
        json={"full_name": "<b>שם</b>", "email": "injected@example.com", "role": "FIELD_WORKER"},
        headers=auth_headers(admin),
    )
    assert resp.status_code == 201
    created = resp.json()
    me = client.get("/api/auth/me", headers=auth_headers(_as_user_row(created)))
    signature = me.json()["signature"]
    # The literal text is preserved (as HTML-escaped, inert entities), not
    # interpreted as an actual <b> tag pair the user didn't sanitize themselves.
    assert "&lt;b&gt;" in signature or "&lt;b&gt;שם&lt;/b&gt;" in signature


def test_new_employee_can_edit_or_clear_the_default_signature(client, make_user):
    admin = make_user(role="ADMIN")
    created = client.post(
        "/api/users",
        json={"full_name": "דנה כהן", "email": "dana2@example.com", "role": "CFO"},
        headers=auth_headers(admin),
    ).json()
    headers = auth_headers(_as_user_row(created))

    resp = client.patch(f"/api/users/{created['user_id']}/signature", json={"signature": None}, headers=headers)
    assert resp.status_code == 200
    assert resp.json()["signature"] is None


class _RowLike:
    """Minimal shim so auth_headers(...) (which reads .user_id/.role) can mint a
    token for a user created through the API (a dict), not the make_user fixture
    (a models.User) — avoids duplicating create_access_token's own signature here."""

    def __init__(self, row: dict):
        self.user_id = row["user_id"]
        self.role = row["role"]


def _as_user_row(row: dict) -> _RowLike:
    return _RowLike(row)
