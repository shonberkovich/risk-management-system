"""Comprehensive RBAC regression matrix for every *write* endpoint (POST/PUT/
PATCH/DELETE) across the API — the write-side counterpart to
test_rbac_regression.py's GET-endpoint map.

For every write endpoint, this checks the FULL set of 7 roles (RISK_MANAGER,
CFO, PROPERTY_MANAGER, FIELD_WORKER, ADMIN, RISK_OFFICER, ADJUSTER) — not just
"one wrong role gets 403, one right role gets 200" — so a role accidentally
left out of (or wrongly included in) a `require_roles(...)` tuple shows up as
a failure here, not just for whichever role a narrower spot-check happened to
pick. Anonymous (no token) is checked separately once per endpoint group
(always 401, same everywhere) rather than per-role, to keep the matrix
readable.

Each endpoint's own dedicated test file (test_api_properties_crud.py,
test_api_claims.py, test_api_mitigation.py, ...) already covers its
CRUD/validation *logic* — this file is deliberately narrow: only the
role/status-code split, exercised against every role at once.
"""
from __future__ import annotations

from datetime import date, timedelta

from tests.conftest import auth_headers

ALL_ROLES = ("RISK_MANAGER", "CFO", "PROPERTY_MANAGER", "FIELD_WORKER", "ADMIN", "RISK_OFFICER", "ADJUSTER")


def _assert_anonymous_401(client, method: str, path: str, json_payload: dict | None = None):
    call = getattr(client, method.lower())
    resp = call(path, json=json_payload) if json_payload is not None else call(path)
    assert resp.status_code == 401, f"anonymous {method} {path} should be 401, got {resp.status_code}"


# ---------------------------------------------------------------------------
# properties.py — _PROPERTIES_WRITE_ROLES = RISK_MANAGER, PROPERTY_MANAGER, ADMIN
# ---------------------------------------------------------------------------


def _property_payload(code: str) -> dict:
    return {
        "property_code": code,
        "name": "נכס בדיקת הרשאות",
        "address": "רחוב הבדיקה 1",
        "region": "מרכז",
        "latitude": 32.08,
        "longitude": 34.78,
        "asset_type": "OFFICE_BUILDING",
        "replacement_value": 1_000_000,
        "book_value": 800_000,
    }


def test_create_property_role_matrix(client, make_user):
    allowed = {"RISK_MANAGER", "PROPERTY_MANAGER", "ADMIN"}
    _assert_anonymous_401(client, "POST", "/api/properties", _property_payload("PRP-RBAC-ANON"))
    for role in ALL_ROLES:
        user = make_user(role=role)
        resp = client.post("/api/properties", json=_property_payload(f"PRP-RBAC-{role}"), headers=auth_headers(user))
        if role in allowed:
            assert resp.status_code == 201, f"{role}: {resp.status_code} {resp.text}"
        else:
            assert resp.status_code == 403, f"{role}: {resp.status_code} {resp.text}"


# ---------------------------------------------------------------------------
# risk_profiles.py — _RISK_PROFILE_WRITE_ROLES = RISK_MANAGER, PROPERTY_MANAGER, ADMIN
# ---------------------------------------------------------------------------


def test_create_risk_profile_role_matrix(client, make_user, make_property):
    allowed = {"RISK_MANAGER", "PROPERTY_MANAGER", "ADMIN"}
    payload = {
        "survey_date": "2026-01-01",
        "flood_risk_score": 2,
        "fire_risk_score": 2,
        "earthquake_risk_score": 2,
        "mfl_amount": 100_000,
        "has_sprinklers": False,
    }
    _assert_anonymous_401(client, "POST", f"/api/properties/{make_property().property_id}/risk-profile", payload)
    for role in ALL_ROLES:
        prop = make_property()
        user = make_user(role=role)
        resp = client.post(f"/api/properties/{prop.property_id}/risk-profile", json=payload, headers=auth_headers(user))
        if role in allowed:
            assert resp.status_code == 201, f"{role}: {resp.status_code} {resp.text}"
        else:
            assert resp.status_code == 403, f"{role}: {resp.status_code} {resp.text}"


# ---------------------------------------------------------------------------
# claims.py — _CLAIMS_WRITE_ROLES = RISK_MANAGER, CFO, ADJUSTER, ADMIN
# ---------------------------------------------------------------------------


def test_create_claim_role_matrix(client, make_user, make_property, make_incident, make_policy):
    allowed = {"RISK_MANAGER", "CFO", "ADJUSTER", "ADMIN"}
    _assert_anonymous_401(client, "POST", "/api/claims", {})
    for role in ALL_ROLES:
        prop = make_property()
        incident = make_incident(prop.property_id)
        policy = make_policy()
        payload = {"incident_id": incident.incident_id, "policy_id": policy.policy_id, "claimed_amount": 10_000}
        user = make_user(role=role)
        resp = client.post("/api/claims", json=payload, headers=auth_headers(user))
        if role in allowed:
            assert resp.status_code == 201, f"{role}: {resp.status_code} {resp.text}"
        else:
            assert resp.status_code == 403, f"{role}: {resp.status_code} {resp.text}"


def test_create_claim_payment_role_matrix(client, make_user, make_property, make_incident, make_policy, make_claim):
    allowed = {"RISK_MANAGER", "CFO", "ADJUSTER", "ADMIN"}
    payload = {"payment_date": "2026-01-01", "amount": 1_000, "payment_type": "ADVANCE"}
    for role in ALL_ROLES:
        prop = make_property()
        incident = make_incident(prop.property_id)
        policy = make_policy()
        claim = make_claim(incident.incident_id, policy.policy_id, claim_status="APPROVED", approved_amount=10_000)
        user = make_user(role=role)
        resp = client.post(f"/api/claims/{claim.claim_id}/payments", json=payload, headers=auth_headers(user))
        if role in allowed:
            assert resp.status_code == 201, f"{role}: {resp.status_code} {resp.text}"
        else:
            assert resp.status_code == 403, f"{role}: {resp.status_code} {resp.text}"


# ---------------------------------------------------------------------------
# incidents.py — status update: _STATUS_WRITE_ROLES = RISK_MANAGER,
# PROPERTY_MANAGER, RISK_OFFICER, ADMIN
# ---------------------------------------------------------------------------


def test_update_incident_status_role_matrix(client, make_user, make_property, make_incident):
    allowed = {"RISK_MANAGER", "PROPERTY_MANAGER", "RISK_OFFICER", "ADMIN"}
    payload = {"status": "UNDER_INVESTIGATION"}
    _assert_anonymous_401(client, "PATCH", f"/api/incidents/{make_incident(make_property().property_id).incident_id}/status", payload)
    for role in ALL_ROLES:
        prop = make_property()
        incident = make_incident(prop.property_id)
        user = make_user(role=role)
        resp = client.patch(f"/api/incidents/{incident.incident_id}/status", json=payload, headers=auth_headers(user))
        if role in allowed:
            assert resp.status_code == 200, f"{role}: {resp.status_code} {resp.text}"
        else:
            assert resp.status_code == 403, f"{role}: {resp.status_code} {resp.text}"


def test_trigger_seismic_scan_role_matrix(client, make_user):
    """incidents.py's _SEISMIC_TRIGGER_ROLES is deliberately narrower than
    _STATUS_WRITE_ROLES — PROPERTY_MANAGER/RISK_OFFICER can change an
    incident's status but must NOT be able to trigger the seismic scan."""
    allowed = {"RISK_MANAGER", "ADMIN"}
    for role in ALL_ROLES:
        user = make_user(role=role)
        resp = client.post("/api/incidents/check-seismic-activity", headers=auth_headers(user))
        if role in allowed:
            assert resp.status_code == 200, f"{role}: {resp.status_code} {resp.text}"
        else:
            assert resp.status_code == 403, f"{role}: {resp.status_code} {resp.text}"


# ---------------------------------------------------------------------------
# mitigation.py — _MITIGATION_WRITE_ROLES = RISK_MANAGER, PROPERTY_MANAGER, ADMIN
# ---------------------------------------------------------------------------


def test_create_mitigation_task_role_matrix(client, make_user, make_property):
    allowed = {"RISK_MANAGER", "PROPERTY_MANAGER", "ADMIN"}
    due = (date.today() + timedelta(days=30)).isoformat()
    for role in ALL_ROLES:
        prop = make_property()
        payload = {"property_id": prop.property_id, "title": "משימת בדיקה", "cost_estimate": 1000, "due_date": due}
        user = make_user(role=role)
        resp = client.post("/api/mitigation-tasks", json=payload, headers=auth_headers(user))
        if role in allowed:
            assert resp.status_code == 201, f"{role}: {resp.status_code} {resp.text}"
        else:
            assert resp.status_code == 403, f"{role}: {resp.status_code} {resp.text}"


# ---------------------------------------------------------------------------
# policies.py — _POLICIES_WRITE_ROLES = RISK_MANAGER, CFO, ADMIN
# ---------------------------------------------------------------------------


def _policy_payload(number: str) -> dict:
    return {
        "policy_number": number,
        "insurer_name": "מבטח בדיקה",
        "start_date": "2026-01-01",
        "end_date": "2027-01-01",
        "total_limit": 1_000_000,
        "deductible_default": 10_000,
        "annual_premium": 50_000,
    }


def test_create_policy_role_matrix(client, make_user):
    """RISK_OFFICER/ADJUSTER can read policies (_POLICIES_READ_ROLES includes
    them) but must NOT be able to write them — the read/write role sets for
    policies are deliberately different."""
    allowed = {"RISK_MANAGER", "CFO", "ADMIN"}
    for role in ALL_ROLES:
        user = make_user(role=role)
        resp = client.post("/api/policies", json=_policy_payload(f"POL-RBAC-{role}"), headers=auth_headers(user))
        if role in allowed:
            assert resp.status_code == 201, f"{role}: {resp.status_code} {resp.text}"
        else:
            assert resp.status_code == 403, f"{role}: {resp.status_code} {resp.text}"


def test_assign_policy_asset_role_matrix(client, make_user, make_policy, make_property):
    allowed = {"RISK_MANAGER", "CFO", "ADMIN"}
    for role in ALL_ROLES:
        policy = make_policy()
        prop = make_property()
        user = make_user(role=role)
        resp = client.post(
            f"/api/policies/{policy.policy_id}/assets", json={"property_id": prop.property_id}, headers=auth_headers(user)
        )
        if role in allowed:
            assert resp.status_code == 201, f"{role}: {resp.status_code} {resp.text}"
        else:
            assert resp.status_code == 403, f"{role}: {resp.status_code} {resp.text}"


# ---------------------------------------------------------------------------
# notifications.py — dispatch: _NOTIFICATIONS_ROLES = RISK_MANAGER, CFO, ADMIN
# recipients write: _RECIPIENTS_WRITE_ROLES = ADMIN only
# ---------------------------------------------------------------------------


def test_dispatch_notifications_role_matrix(client, make_user):
    allowed = {"RISK_MANAGER", "CFO", "ADMIN"}
    for role in ALL_ROLES:
        user = make_user(role=role)
        resp = client.post("/api/notifications/dispatch", headers=auth_headers(user))
        if role in allowed:
            assert resp.status_code == 200, f"{role}: {resp.status_code} {resp.text}"
        else:
            assert resp.status_code == 403, f"{role}: {resp.status_code} {resp.text}"


def test_create_notification_recipient_role_matrix(client, make_user):
    """ADMIN-only — notably CFO/RISK_MANAGER can dispatch notifications
    (above) but must NOT be able to manage who receives them."""
    allowed = {"ADMIN"}
    for role in ALL_ROLES:
        payload = {
            "role": "RISK_MANAGER",
            "display_name": "נמען בדיקה",
            "email": "recipient@example.com",
            "phone": "050-0000000",
            "channels": ["EMAIL"],
        }
        user = make_user(role=role)
        resp = client.post("/api/notifications/recipients", json=payload, headers=auth_headers(user))
        if role in allowed:
            assert resp.status_code == 201, f"{role}: {resp.status_code} {resp.text}"
        else:
            assert resp.status_code == 403, f"{role}: {resp.status_code} {resp.text}"


# ---------------------------------------------------------------------------
# role_permissions.py — _ROLE_PERMISSIONS_WRITE_ROLES = ADMIN only
# ---------------------------------------------------------------------------


def test_create_role_permission_role_matrix(client, make_user):
    allowed = {"ADMIN"}
    for role in ALL_ROLES:
        payload = {"role": "RISK_MANAGER", "permission_key": f"test:key:{role}", "description": None}
        user = make_user(role=role)
        resp = client.post("/api/role-permissions", json=payload, headers=auth_headers(user))
        if role in allowed:
            assert resp.status_code == 201, f"{role}: {resp.status_code} {resp.text}"
        else:
            assert resp.status_code == 403, f"{role}: {resp.status_code} {resp.text}"


# ---------------------------------------------------------------------------
# users.py — _USERS_WRITE_ROLES = ADMIN only. This is the highest-stakes
# check in the whole matrix: creating/editing a User (including setting its
# role) must be unreachable by every non-ADMIN role, with no exceptions —
# a gap here would be a direct privilege-escalation path.
# ---------------------------------------------------------------------------


def test_create_user_role_matrix(client, make_user):
    """Actor users are all created via `make_user` up front, before any POST
    /api/users call — `make_user`'s counter-assigned ids and the router's own
    DB-auto-assigned ids both start from 1 on SQLite's plain-rowid
    autoincrement, so interleaving the two (create an actor, then let the
    router auto-assign an id, then create the next actor) risks a primary
    key collision between them. Not a collision an app bug could cause on
    real SQL Server IDENTITY columns — purely a test-fixture ordering
    concern — but doing all the `make_user` calls first sidesteps it either way."""
    allowed = {"ADMIN"}
    actors = [(role, make_user(role=role)) for role in ALL_ROLES]
    for i, (role, user) in enumerate(actors):
        payload = {"full_name": "משתמש בדיקה", "email": f"rbac-test-{role}-{i}@example.com", "role": "ADMIN"}
        resp = client.post("/api/users", json=payload, headers=auth_headers(user))
        if role in allowed:
            assert resp.status_code == 201, f"{role}: {resp.status_code} {resp.text}"
        else:
            assert resp.status_code == 403, f"{role}: {resp.status_code} {resp.text}"


def test_update_user_role_matrix(client, make_user):
    """A non-ADMIN must not be able to PATCH *any* user's role — including
    their own account (self-escalation). Same actors-created-up-front
    ordering as test_create_user_role_matrix, for the same reason."""
    allowed = {"ADMIN"}
    actors = [(role, make_user(role=role), make_user(role="FIELD_WORKER")) for role in ALL_ROLES]
    for role, user, target in actors:
        resp = client.patch(f"/api/users/{target.user_id}", json={"role": "ADMIN"}, headers=auth_headers(user))
        if role in allowed:
            assert resp.status_code == 200, f"{role}: {resp.status_code} {resp.text}"
        else:
            assert resp.status_code == 403, f"{role}: {resp.status_code} {resp.text}"


def test_non_admin_cannot_escalate_own_role_via_self_patch(client, make_user):
    """Direct self-escalation attempt: a FIELD_WORKER PATCHing their *own*
    user_id to set role=ADMIN must still 403 — being the target of the
    update, not just any update, must not carry different permissions."""
    field_worker = make_user(role="FIELD_WORKER")
    resp = client.patch(
        f"/api/users/{field_worker.user_id}", json={"role": "ADMIN"}, headers=auth_headers(field_worker)
    )
    assert resp.status_code == 403
    refreshed = client.get("/api/users/admin", headers=auth_headers(make_user(role="ADMIN")))
    roles_by_id = {u["user_id"]: u["role"] for u in refreshed.json()}
    assert roles_by_id[field_worker.user_id] == "FIELD_WORKER"


# ---------------------------------------------------------------------------
# documents.py / media.py DELETE — hardcoded ("RISK_MANAGER", "ADMIN") inline
# (not a named module constant, unlike every other router) — worth its own
# explicit matrix entry precisely because it's the one write-role set not
# defined as a `_X_WRITE_ROLES` tuple, making it easier to silently drift.
# ---------------------------------------------------------------------------


def test_delete_document_role_matrix(client, make_user, make_property, tmp_path, monkeypatch):
    from app.services import storage
    monkeypatch.setattr(storage, "STORAGE_ROOT", tmp_path)

    allowed = {"RISK_MANAGER", "ADMIN"}
    for role in ALL_ROLES:
        prop = make_property()
        admin = make_user(role="ADMIN")
        import io
        uploaded = client.post(
            f"/api/documents/entity/PROPERTY/{prop.property_id}",
            params={"doc_type": "PHOTO"},
            files={"file": ("f.pdf", io.BytesIO(b"data"), "application/pdf")},
            headers=auth_headers(admin),
        ).json()
        user = make_user(role=role)
        resp = client.delete(f"/api/documents/{uploaded['document_id']}", headers=auth_headers(user))
        if role in allowed:
            assert resp.status_code == 204, f"{role}: {resp.status_code} {resp.text}"
        else:
            assert resp.status_code == 403, f"{role}: {resp.status_code} {resp.text}"
