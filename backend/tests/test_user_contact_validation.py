"""Users and notification recipients: contact details have a valid shape, new
passwords have a minimum length, and an ADMIN can't change their own role (the same
lock-out as disabling themselves)."""
import pytest

from tests.conftest import auth_headers

BAD_EMAILS = ["not-an-email", "a@b", "@example.com", "a b@example.com", "a@@example.com", "a@example.com "]
BAD_PHONES = ["abc", "123", "050-000-000x", "+" + "1" * 16]
RECIPIENT = {"role": "RISK_MANAGER", "display_name": "נמען", "email": "r@example.com", "phone": "050-1234567",
             "channels": ["EMAIL"]}


@pytest.mark.parametrize("email", BAD_EMAILS)
def test_creating_a_user_with_a_malformed_email_is_422(client, make_user, email):
    resp = client.post(
        "/api/users",
        json={"full_name": "משתמש", "email": email, "role": "FIELD_WORKER"},
        headers=auth_headers(make_user(role="ADMIN")),
    )
    assert resp.status_code == 422, resp.text
    assert resp.json()["detail"][0]["loc"][-1] == "email"


def test_editing_a_user_to_a_malformed_email_is_422(client, make_user):
    target = make_user(role="FIELD_WORKER")
    resp = client.patch(
        f"/api/users/{target.user_id}", json={"email": "nope"}, headers=auth_headers(make_user(role="ADMIN"))
    )
    assert resp.status_code == 422, resp.text


@pytest.mark.parametrize("password", ["short", "1234567", "        "])
def test_a_new_password_shorter_than_8_is_422(client, make_user, password):
    headers = auth_headers(make_user(role="ADMIN"))
    created = client.post(
        "/api/users", json={"full_name": "משתמש", "email": "u@example.com", "role": "CFO", "password": password},
        headers=headers,
    )
    assert created.status_code == 422, created.text
    target = make_user(role="FIELD_WORKER")
    reset = client.patch(f"/api/users/{target.user_id}", json={"password": password}, headers=headers)
    assert reset.status_code == 422, reset.text


def test_an_empty_password_still_means_none_and_8_chars_is_accepted(client, make_user):
    headers = auth_headers(make_user(role="ADMIN"))
    sso_only = client.post(
        "/api/users", json={"full_name": "משתמש", "email": "sso@example.com", "role": "CFO", "password": ""},
        headers=headers,
    )
    assert sso_only.status_code == 201, sso_only.text
    with_password = client.post(
        "/api/users", json={"full_name": "משתמש", "email": "pw8@example.com", "role": "CFO", "password": "abcd1234"},
        headers=headers,
    )
    assert with_password.status_code == 201, with_password.text
    login = client.post("/api/auth/login", json={"email": "pw8@example.com", "password": "abcd1234"})
    assert login.status_code == 200


def test_a_duplicate_email_message_is_hebrew(client, make_user):
    existing = make_user(role="CFO")
    resp = client.post(
        "/api/users",
        json={"full_name": "משתמש", "email": existing.email, "role": "CFO"},
        headers=auth_headers(make_user(role="ADMIN")),
    )
    assert resp.status_code == 400
    assert resp.json()["detail"] == "כתובת האימייל כבר קיימת במערכת"


def test_an_admin_cannot_change_their_own_role(client, make_user):
    admin = make_user(role="ADMIN")
    resp = client.patch(f"/api/users/{admin.user_id}", json={"role": "CFO"}, headers=auth_headers(admin))
    assert resp.status_code == 400
    assert "עצמך" in resp.json()["detail"]
    # Re-sending the same role (the edit dialog sends the whole form) is fine.
    same = client.patch(
        f"/api/users/{admin.user_id}", json={"role": "ADMIN", "full_name": "מנהל"}, headers=auth_headers(admin)
    )
    assert same.status_code == 200, same.text


def test_an_admin_can_still_change_another_admins_role(client, make_user):
    other = make_user(role="ADMIN")
    resp = client.patch(
        f"/api/users/{other.user_id}", json={"role": "CFO"}, headers=auth_headers(make_user(role="ADMIN"))
    )
    assert resp.status_code == 200, resp.text


@pytest.mark.parametrize("email", BAD_EMAILS)
def test_a_recipient_with_a_malformed_email_is_422(client, make_user, email):
    resp = client.post(
        "/api/notifications/recipients", json={**RECIPIENT, "email": email}, headers=auth_headers(make_user(role="ADMIN"))
    )
    assert resp.status_code == 422, resp.text


@pytest.mark.parametrize("phone", BAD_PHONES)
def test_a_recipient_with_a_malformed_phone_is_422(client, make_user, phone):
    resp = client.post(
        "/api/notifications/recipients", json={**RECIPIENT, "phone": phone}, headers=auth_headers(make_user(role="ADMIN"))
    )
    assert resp.status_code == 422, resp.text


@pytest.mark.parametrize(
    "email,phone", [("", "+972-50-000-0001"), ("r@example.com", ""), ("r@example.com", "(03) 123 4567")]
)
def test_a_recipient_may_leave_email_or_phone_empty(client, make_user, email, phone):
    resp = client.post(
        "/api/notifications/recipients",
        json={**RECIPIENT, "email": email, "phone": phone},
        headers=auth_headers(make_user(role="ADMIN")),
    )
    assert resp.status_code == 201, resp.text


def test_a_recipient_role_must_be_a_known_role(client, make_user):
    headers = auth_headers(make_user(role="ADMIN"))
    assert client.post(
        "/api/notifications/recipients", json={**RECIPIENT, "role": "risk_manager"}, headers=headers
    ).status_code == 422
    created = client.post("/api/notifications/recipients", json=RECIPIENT, headers=headers)
    assert created.status_code == 201
    patched = client.patch(
        f"/api/notifications/recipients/{created.json()['recipient_id']}", json={"role": "JANITOR"}, headers=headers
    )
    assert patched.status_code == 422
