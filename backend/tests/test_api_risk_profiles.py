"""Integration tests: /api/properties/{property_id}/risk-profile (create/update the
Asset_Risk_Profiles survey) — TODO_SPEC.md §2, "API לסקרי סיכונים"."""
from tests.conftest import auth_headers


def _profile_payload(**overrides) -> dict:
    payload = {
        "survey_date": "2024-06-01",
        "flood_risk_score": 3,
        "fire_risk_score": 2,
        "earthquake_risk_score": 4,
        "mfl_amount": 5_000_000,
        "has_sprinklers": True,
    }
    payload.update(overrides)
    return payload


def test_get_risk_profile_404_when_none_exists(client, make_property):
    prop = make_property()
    resp = client.get(f"/api/properties/{prop.property_id}/risk-profile")
    assert resp.status_code == 404


def test_create_risk_profile_requires_auth(client, make_property):
    prop = make_property()
    resp = client.post(f"/api/properties/{prop.property_id}/risk-profile", json=_profile_payload())
    assert resp.status_code == 401


def test_create_risk_profile_forbidden_for_field_worker(client, make_user, make_property):
    field_worker = make_user(role="FIELD_WORKER")
    prop = make_property()
    resp = client.post(
        f"/api/properties/{prop.property_id}/risk-profile",
        json=_profile_payload(),
        headers=auth_headers(field_worker),
    )
    assert resp.status_code == 403


def test_create_risk_profile(client, make_user, make_property):
    risk_manager = make_user(role="RISK_MANAGER")
    prop = make_property()
    resp = client.post(
        f"/api/properties/{prop.property_id}/risk-profile",
        json=_profile_payload(),
        headers=auth_headers(risk_manager),
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["mfl_amount"] == 5_000_000
    assert body["has_sprinklers"] is True

    # Now reachable via the plain GET.
    fetched = client.get(f"/api/properties/{prop.property_id}/risk-profile")
    assert fetched.status_code == 200
    assert fetched.json()["profile_id"] == body["profile_id"]

    # ...and embedded in the property itself.
    prop_resp = client.get(f"/api/properties/{prop.property_id}")
    assert prop_resp.json()["risk_profile"]["profile_id"] == body["profile_id"]


def test_create_risk_profile_missing_property_is_404(client, make_user):
    admin = make_user(role="ADMIN")
    resp = client.post(
        "/api/properties/999999/risk-profile", json=_profile_payload(), headers=auth_headers(admin)
    )
    assert resp.status_code == 404


def test_create_risk_profile_conflict_when_one_exists(client, make_user, make_property):
    admin = make_user(role="ADMIN")
    headers = auth_headers(admin)
    prop = make_property()
    first = client.post(f"/api/properties/{prop.property_id}/risk-profile", json=_profile_payload(), headers=headers)
    assert first.status_code == 201

    second = client.post(f"/api/properties/{prop.property_id}/risk-profile", json=_profile_payload(), headers=headers)
    assert second.status_code == 409


def test_create_risk_profile_score_out_of_range_is_422(client, make_user, make_property):
    admin = make_user(role="ADMIN")
    prop = make_property()
    resp = client.post(
        f"/api/properties/{prop.property_id}/risk-profile",
        json=_profile_payload(flood_risk_score=6),
        headers=auth_headers(admin),
    )
    assert resp.status_code == 422


def test_update_risk_profile(client, make_user, make_property):
    admin = make_user(role="ADMIN")
    headers = auth_headers(admin)
    prop = make_property()
    client.post(f"/api/properties/{prop.property_id}/risk-profile", json=_profile_payload(), headers=headers)

    resp = client.put(
        f"/api/properties/{prop.property_id}/risk-profile",
        json={"mfl_amount": 6_000_000, "has_sprinklers": False},
        headers=headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["mfl_amount"] == 6_000_000
    assert body["has_sprinklers"] is False
    # Untouched fields keep their prior values.
    assert body["flood_risk_score"] == 3


def test_update_risk_profile_404_when_none_exists(client, make_user, make_property):
    admin = make_user(role="ADMIN")
    prop = make_property()
    resp = client.put(
        f"/api/properties/{prop.property_id}/risk-profile",
        json={"mfl_amount": 1_000_000},
        headers=auth_headers(admin),
    )
    assert resp.status_code == 404


def test_near_hazmat_site_defaults_false_and_is_settable(client, make_user, make_property):
    """TODO_SPEC.md §11 item 1: Asset_Risk_Profiles.near_hazmat_site — defaults to
    False when not supplied, and can be set on create and toggled on update, same
    as the pre-existing boolean field has_sprinklers."""
    admin = make_user(role="ADMIN")
    headers = auth_headers(admin)
    prop = make_property()

    created = client.post(
        f"/api/properties/{prop.property_id}/risk-profile", json=_profile_payload(), headers=headers
    )
    assert created.status_code == 201
    assert created.json()["near_hazmat_site"] is False  # not supplied in _profile_payload()

    updated = client.put(
        f"/api/properties/{prop.property_id}/risk-profile",
        json={"near_hazmat_site": True},
        headers=headers,
    )
    assert updated.status_code == 200
    assert updated.json()["near_hazmat_site"] is True
    # Untouched fields keep their prior values.
    assert updated.json()["has_sprinklers"] is True


def test_near_hazmat_site_settable_at_creation(client, make_user, make_property):
    admin = make_user(role="ADMIN")
    prop = make_property()
    resp = client.post(
        f"/api/properties/{prop.property_id}/risk-profile",
        json=_profile_payload(near_hazmat_site=True),
        headers=auth_headers(admin),
    )
    assert resp.status_code == 201
    assert resp.json()["near_hazmat_site"] is True
