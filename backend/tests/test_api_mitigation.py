"""Tests for routers/mitigation.py — mitigation-task CRUD, the automatic
OVERDUE-status derivation (_sync_overdue), and the ROI/ROI-summary endpoints.
"""
from __future__ import annotations

from datetime import date, timedelta

from tests.conftest import auth_headers

_WRITE_ROLES_PAYLOAD_DUE_DATE = (date.today() + timedelta(days=30)).isoformat()


def _create_payload(property_id: int, **overrides) -> dict:
    payload = {
        "property_id": property_id,
        "title": "התקנת מתזים",
        "cost_estimate": 100_000,
        "expected_annual_savings": 20_000,
        "due_date": _WRITE_ROLES_PAYLOAD_DUE_DATE,
    }
    payload.update(overrides)
    return payload


# ---------------------------------------------------------------------------
# Create
# ---------------------------------------------------------------------------


def test_create_task_happy_path(client, make_user, make_property):
    headers = auth_headers(make_user(role="RISK_MANAGER"))
    prop = make_property()
    resp = client.post("/api/mitigation-tasks", json=_create_payload(prop.property_id), headers=headers)
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["status"] == "OPEN"
    assert body["roi_percent"] == 20.0


def test_create_task_forbidden_for_field_worker(client, make_user, make_property):
    headers = auth_headers(make_user(role="FIELD_WORKER"))
    prop = make_property()
    resp = client.post("/api/mitigation-tasks", json=_create_payload(prop.property_id), headers=headers)
    assert resp.status_code == 403


def test_create_task_requires_auth(client, make_property):
    prop = make_property()
    resp = client.post("/api/mitigation-tasks", json=_create_payload(prop.property_id))
    assert resp.status_code == 401


def test_create_task_rejects_unknown_property(client, make_user):
    headers = auth_headers(make_user(role="ADMIN"))
    resp = client.post("/api/mitigation-tasks", json=_create_payload(999_999), headers=headers)
    assert resp.status_code == 404


def test_create_task_rejects_unknown_assigned_user(client, make_user, make_property):
    headers = auth_headers(make_user(role="ADMIN"))
    prop = make_property()
    resp = client.post(
        "/api/mitigation-tasks",
        json=_create_payload(prop.property_id, assigned_to_user_id=999_999),
        headers=headers,
    )
    assert resp.status_code == 404


def test_create_task_with_past_due_date_is_immediately_overdue(client, make_user, make_property):
    """_sync_overdue runs even on create — a task created with an already-past
    due_date must not start life as OPEN just because the caller never set a
    status explicitly."""
    headers = auth_headers(make_user(role="ADMIN"))
    prop = make_property()
    past_date = (date.today() - timedelta(days=5)).isoformat()
    resp = client.post(
        "/api/mitigation-tasks",
        json=_create_payload(prop.property_id, due_date=past_date),
        headers=headers,
    )
    assert resp.status_code == 201
    assert resp.json()["status"] == "OVERDUE"


def test_create_task_due_today_is_not_overdue(client, make_user, make_property):
    """Boundary: `due_date < date.today()` is strictly less-than, so a task
    due exactly today must NOT be forced to OVERDUE yet."""
    headers = auth_headers(make_user(role="ADMIN"))
    prop = make_property()
    resp = client.post(
        "/api/mitigation-tasks",
        json=_create_payload(prop.property_id, due_date=date.today().isoformat()),
        headers=headers,
    )
    assert resp.status_code == 201
    assert resp.json()["status"] == "OPEN"


def test_create_task_rejects_negative_cost_estimate(client, make_user, make_property):
    """cost_estimate/expected_annual_savings must be non-negative — same
    Field(ge=0) guard already used for claimed_amount/deductible_default
    elsewhere in schemas.py."""
    headers = auth_headers(make_user(role="ADMIN"))
    prop = make_property()
    resp = client.post(
        "/api/mitigation-tasks", json=_create_payload(prop.property_id, cost_estimate=-1), headers=headers
    )
    assert resp.status_code == 422


def test_create_task_rejects_negative_expected_annual_savings(client, make_user, make_property):
    headers = auth_headers(make_user(role="ADMIN"))
    prop = make_property()
    resp = client.post(
        "/api/mitigation-tasks",
        json=_create_payload(prop.property_id, expected_annual_savings=-1),
        headers=headers,
    )
    assert resp.status_code == 422


def test_create_task_with_zero_cost_estimate_has_null_roi(client, make_user, make_property):
    headers = auth_headers(make_user(role="ADMIN"))
    prop = make_property()
    resp = client.post(
        "/api/mitigation-tasks",
        json=_create_payload(prop.property_id, cost_estimate=0),
        headers=headers,
    )
    assert resp.status_code == 201
    assert resp.json()["roi_percent"] is None


# ---------------------------------------------------------------------------
# Update / _sync_overdue behavior
# ---------------------------------------------------------------------------


def test_update_task_setting_in_progress_with_past_due_date_stays_overdue(client, make_user, make_property):
    """A caller setting status=IN_PROGRESS in the same request as (or on top
    of) a past due_date must still land on OVERDUE — being "in progress"
    doesn't stop a task from being late, per the module docstring."""
    headers = auth_headers(make_user(role="ADMIN"))
    prop = make_property()
    past_date = (date.today() - timedelta(days=3)).isoformat()
    task_id = client.post(
        "/api/mitigation-tasks", json=_create_payload(prop.property_id, due_date=past_date), headers=headers
    ).json()["task_id"]

    resp = client.patch(f"/api/mitigation-tasks/{task_id}", json={"status": "IN_PROGRESS"}, headers=headers)

    assert resp.status_code == 200
    assert resp.json()["status"] == "OVERDUE"


def test_update_task_completed_status_survives_past_due_date(client, make_user, make_property):
    """COMPLETED is the one terminal state _sync_overdue must never override,
    even for a task whose due_date is in the past."""
    headers = auth_headers(make_user(role="ADMIN"))
    prop = make_property()
    past_date = (date.today() - timedelta(days=3)).isoformat()
    task_id = client.post(
        "/api/mitigation-tasks", json=_create_payload(prop.property_id, due_date=past_date), headers=headers
    ).json()["task_id"]

    resp = client.patch(f"/api/mitigation-tasks/{task_id}", json={"status": "COMPLETED"}, headers=headers)

    assert resp.status_code == 200
    assert resp.json()["status"] == "COMPLETED"


def test_task_reverts_from_overdue_to_open_when_due_date_moved_to_future(client, make_user, make_property):
    headers = auth_headers(make_user(role="ADMIN"))
    prop = make_property()
    past_date = (date.today() - timedelta(days=3)).isoformat()
    task_id = client.post(
        "/api/mitigation-tasks", json=_create_payload(prop.property_id, due_date=past_date), headers=headers
    ).json()["task_id"]
    assert client.get(f"/api/mitigation-tasks/{task_id}").json()["status"] == "OVERDUE"

    future_date = (date.today() + timedelta(days=10)).isoformat()
    resp = client.patch(f"/api/mitigation-tasks/{task_id}", json={"due_date": future_date}, headers=headers)

    assert resp.status_code == 200
    assert resp.json()["status"] == "OPEN"


def test_update_task_forbidden_for_field_worker(client, make_user, make_property):
    admin_headers = auth_headers(make_user(role="ADMIN"))
    prop = make_property()
    task_id = client.post("/api/mitigation-tasks", json=_create_payload(prop.property_id), headers=admin_headers).json()["task_id"]

    fw_headers = auth_headers(make_user(role="FIELD_WORKER"))
    resp = client.patch(f"/api/mitigation-tasks/{task_id}", json={"title": "שינוי"}, headers=fw_headers)
    assert resp.status_code == 403


def test_update_nonexistent_task_returns_404(client, make_user):
    headers = auth_headers(make_user(role="ADMIN"))
    resp = client.patch("/api/mitigation-tasks/999999", json={"title": "x"}, headers=headers)
    assert resp.status_code == 404


def test_update_task_rejects_unknown_assigned_user(client, make_user, make_property):
    headers = auth_headers(make_user(role="ADMIN"))
    prop = make_property()
    task_id = client.post("/api/mitigation-tasks", json=_create_payload(prop.property_id), headers=headers).json()["task_id"]

    resp = client.patch(f"/api/mitigation-tasks/{task_id}", json={"assigned_to_user_id": 999_999}, headers=headers)
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Read / ROI
# ---------------------------------------------------------------------------


def test_get_task_404_for_unknown_id(client):
    assert client.get("/api/mitigation-tasks/999999").status_code == 404


def test_list_tasks_auto_heals_stale_overdue_status_on_read(client, make_user, make_property, make_mitigation_task, db):
    """A task inserted directly with status="OVERDUE" and a due_date already in
    the future (e.g. stale data from before a due_date correction) must be
    healed back to OPEN the moment it's listed, not just on update."""
    prop = make_property()
    make_mitigation_task(prop.property_id, status="OVERDUE", due_date=date.today() + timedelta(days=5))

    resp = client.get("/api/mitigation-tasks")

    assert resp.status_code == 200
    assert all(t["status"] != "OVERDUE" for t in resp.json())


def test_roi_summary_sorts_descending_and_places_null_roi_last(client, make_user, make_property):
    headers = auth_headers(make_user(role="ADMIN"))
    prop = make_property()
    client.post("/api/mitigation-tasks", json=_create_payload(prop.property_id, cost_estimate=0, expected_annual_savings=0, title="No ROI"), headers=headers)
    client.post("/api/mitigation-tasks", json=_create_payload(prop.property_id, cost_estimate=100_000, expected_annual_savings=50_000, title="High ROI"), headers=headers)
    client.post("/api/mitigation-tasks", json=_create_payload(prop.property_id, cost_estimate=100_000, expected_annual_savings=10_000, title="Low ROI"), headers=headers)

    resp = client.get("/api/mitigation-tasks/roi-summary")

    assert resp.status_code == 200
    titles = [r["title"] for r in resp.json()]
    assert titles == ["High ROI", "Low ROI", "No ROI"]


def test_roi_summary_route_not_shadowed_by_task_id_route(client):
    """/roi-summary must resolve to the dedicated endpoint, not get swallowed
    by GET /{task_id} treating "roi-summary" as an int path param (which would
    422, not 200-with-a-list) — a route-ordering regression guard."""
    resp = client.get("/api/mitigation-tasks/roi-summary")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


def test_task_roi_breakdown_404_for_unknown_task(client):
    assert client.get("/api/mitigation-tasks/999999/roi").status_code == 404


def test_task_roi_breakdown_no_active_policy_attributes_all_savings_to_loss_savings(client, make_user, make_property):
    headers = auth_headers(make_user(role="ADMIN"))
    prop = make_property()
    task_id = client.post(
        "/api/mitigation-tasks",
        json=_create_payload(prop.property_id, cost_estimate=50_000, expected_annual_savings=10_000),
        headers=headers,
    ).json()["task_id"]

    resp = client.get(f"/api/mitigation-tasks/{task_id}/roi")

    assert resp.status_code == 200
    body = resp.json()
    assert body["has_active_policy"] is False
    assert body["expected_premium_savings"] == 0.0
    assert body["expected_loss_savings"] == 10_000.0
    assert body["payback_years"] == 5.0


def test_task_roi_breakdown_zero_savings_has_null_payback(client, make_user, make_property):
    headers = auth_headers(make_user(role="ADMIN"))
    prop = make_property()
    task_id = client.post(
        "/api/mitigation-tasks",
        json=_create_payload(prop.property_id, cost_estimate=50_000, expected_annual_savings=0),
        headers=headers,
    ).json()["task_id"]

    resp = client.get(f"/api/mitigation-tasks/{task_id}/roi")

    assert resp.status_code == 200
    assert resp.json()["payback_years"] is None
