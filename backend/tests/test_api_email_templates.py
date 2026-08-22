"""Integration tests: /api/email-templates CRUD — TODO_SPEC.md "משימה 12",
"תמיכה בתבניות מייל מוגדרות מראש (Email Templates)". Mirrors
test_api_role_permissions.py's structure (same ADMIN-write/open-read shape),
plus a couple of email-template-specific checks: that reading is open to any
authenticated *role* (not just ADMIN, since every role composes email) and
that an unauthenticated caller is rejected (unlike Role_Permissions' GET,
which is fully open — Email_Templates' GET is "authenticated, any role").
"""
from tests.conftest import auth_headers


def _template_payload(**overrides) -> dict:
    payload = {
        "name": "דרישת מסמכים משמאי",
        "subject_template": "בקשה למסמכים - תביעה {{claim_number}}",
        "body_template": "שלום {{client_name}},\n\nאנא שלחו את המסמכים הנדרשים עבור תביעה {{claim_number}}.",
    }
    payload.update(overrides)
    return payload


# ---------------------------------------------------------------------------
# Read access: any authenticated user, not just admins
# ---------------------------------------------------------------------------


def test_list_email_templates_requires_authentication(client):
    resp = client.get("/api/email-templates")
    assert resp.status_code == 401


def test_list_email_templates_open_to_any_authenticated_role(client, make_user):
    field_worker = make_user(role="FIELD_WORKER")
    resp = client.get("/api/email-templates", headers=auth_headers(field_worker))
    assert resp.status_code == 200
    assert resp.json() == []


def test_get_single_email_template_open_to_any_authenticated_role(client, make_user):
    admin = make_user(role="ADMIN")
    created = client.post("/api/email-templates", json=_template_payload(), headers=auth_headers(admin)).json()

    field_worker = make_user(role="FIELD_WORKER")
    resp = client.get(f"/api/email-templates/{created['id']}", headers=auth_headers(field_worker))
    assert resp.status_code == 200
    assert resp.json()["name"] == "דרישת מסמכים משמאי"


def test_get_missing_email_template_is_404(client, make_user):
    user = make_user(role="RISK_MANAGER")
    resp = client.get("/api/email-templates/999999", headers=auth_headers(user))
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Write access: admin-only
# ---------------------------------------------------------------------------


def test_create_email_template_requires_admin(client, make_user):
    risk_manager = make_user(role="RISK_MANAGER")
    resp = client.post("/api/email-templates", json=_template_payload(), headers=auth_headers(risk_manager))
    assert resp.status_code == 403


def test_create_email_template_requires_authentication(client):
    resp = client.post("/api/email-templates", json=_template_payload())
    assert resp.status_code == 401


def test_create_and_list_email_template(client, make_user):
    admin = make_user(role="ADMIN")
    resp = client.post("/api/email-templates", json=_template_payload(), headers=auth_headers(admin))
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["name"] == "דרישת מסמכים משמאי"
    assert body["subject_template"] == "בקשה למסמכים - תביעה {{claim_number}}"
    assert "{{client_name}}" in body["body_template"]
    assert body["created_by"] == admin.user_id
    assert "created_at" in body

    listed = client.get("/api/email-templates", headers=auth_headers(admin))
    assert listed.status_code == 200
    assert len(listed.json()) == 1


def test_update_email_template_requires_admin(client, make_user):
    admin = make_user(role="ADMIN")
    created = client.post("/api/email-templates", json=_template_payload(), headers=auth_headers(admin)).json()

    property_manager = make_user(role="PROPERTY_MANAGER")
    resp = client.patch(
        f"/api/email-templates/{created['id']}",
        json={"name": "שם חדש"},
        headers=auth_headers(property_manager),
    )
    assert resp.status_code == 403


def test_update_email_template_partial(client, make_user):
    admin = make_user(role="ADMIN")
    headers = auth_headers(admin)
    created = client.post("/api/email-templates", json=_template_payload(), headers=headers).json()

    resp = client.patch(
        f"/api/email-templates/{created['id']}",
        json={"subject_template": "עדכון סטטוס - {{claim_number}}"},
        headers=headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["subject_template"] == "עדכון סטטוס - {{claim_number}}"
    # Untouched fields stay the same.
    assert body["name"] == "דרישת מסמכים משמאי"
    assert body["body_template"] == created["body_template"]


def test_update_missing_email_template_is_404(client, make_user):
    admin = make_user(role="ADMIN")
    resp = client.patch("/api/email-templates/999999", json={"name": "x"}, headers=auth_headers(admin))
    assert resp.status_code == 404


def test_delete_email_template_requires_admin(client, make_user):
    admin = make_user(role="ADMIN")
    created = client.post("/api/email-templates", json=_template_payload(), headers=auth_headers(admin)).json()

    field_worker = make_user(role="FIELD_WORKER")
    resp = client.delete(f"/api/email-templates/{created['id']}", headers=auth_headers(field_worker))
    assert resp.status_code == 403


def test_delete_email_template(client, make_user):
    admin = make_user(role="ADMIN")
    headers = auth_headers(admin)
    created = client.post("/api/email-templates", json=_template_payload(), headers=headers).json()

    resp = client.delete(f"/api/email-templates/{created['id']}", headers=headers)
    assert resp.status_code == 204

    listed = client.get("/api/email-templates", headers=headers)
    assert listed.json() == []


def test_delete_missing_email_template_is_404(client, make_user):
    admin = make_user(role="ADMIN")
    resp = client.delete("/api/email-templates/999999", headers=auth_headers(admin))
    assert resp.status_code == 404
