"""Request parameters that drive a loop, a row count or a LIKE pattern are bounded, so
an absurd value is a 422 rather than a 500 or a worker stuck building a huge list."""
import pytest

from tests.conftest import auth_headers


@pytest.mark.parametrize("months", [0, -1, 121, 10**22])
def test_cashflow_months_ahead_out_of_range_is_422(client, make_user, months):
    resp = client.get(
        "/api/analytics/cashflow", params={"months_ahead": months}, headers=auth_headers(make_user(role="CFO"))
    )
    assert resp.status_code == 422, resp.text


@pytest.mark.parametrize("months", [1, 12, 120])
def test_cashflow_months_ahead_in_range_is_accepted(client, make_user, months):
    resp = client.get(
        "/api/analytics/cashflow", params={"months_ahead": months}, headers=auth_headers(make_user(role="CFO"))
    )
    assert resp.status_code == 200, resp.text
    assert len(resp.json()["monthly"]) <= months  # only months that have data


@pytest.mark.parametrize("limit", [-1, 0, 1001])
def test_notification_log_limit_out_of_range_is_422(client, make_user, limit):
    resp = client.get("/api/notifications/log", params={"limit": limit}, headers=auth_headers(make_user(role="ADMIN")))
    assert resp.status_code == 422, resp.text


def test_notification_log_default_limit_still_works(client, make_user):
    resp = client.get("/api/notifications/log", headers=auth_headers(make_user(role="ADMIN")))
    assert resp.status_code == 200


def test_login_with_an_overlong_email_is_422(client):
    resp = client.post("/api/auth/login", json={"email": "a" * 190 + "@example.com", "password": "x"})
    assert resp.status_code == 422


def test_email_search_query_is_capped(client, make_user):
    headers = auth_headers(make_user(role="RISK_MANAGER"))
    assert client.get("/api/emails", params={"q": "א" * 201}, headers=headers).status_code == 422
    assert client.get("/api/emails", params={"q": "א" * 200}, headers=headers).status_code == 200
