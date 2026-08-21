"""Regression test for the AI router's auth requirement.

Historically `routers/ai.py` only had the IP-based rate-limit dependency
(`enforce_ai_rate_limit`) and no `get_current_user`/`require_roles` at all — anyone,
logged in or not, could call `/api/ai/*`, contradicting docs/README.md §6 which already
described the router as "authenticated" (the frontend was already sending a bearer
token on every call in anticipation of this, see api/client.ts). `require_roles()`
(no args = authenticated, any role — not role-restricted, since FIELD_WORKER,
RISK_MANAGER, ADMIN etc. all legitimately use these endpoints) was added to close that
gap. These tests only check the 401/200-shape of the auth gate itself, not the AI
behavior — no ANTHROPIC_API_KEY is configured in tests, so an authenticated call still
ends in a 503 ("AI features are not configured"), which is enough to prove the request
got past the auth dependency.
"""
from tests.conftest import auth_headers


def test_classify_incident_without_token_is_401(client):
    resp = client.post("/api/ai/classify-incident", json={"description": "שריפה במחסן"})
    assert resp.status_code == 401


def test_classify_incident_with_token_passes_auth_gate(client, make_user):
    user = make_user(role="FIELD_WORKER", email="field-ai-test@example.com")
    resp = client.post(
        "/api/ai/classify-incident",
        json={"description": "שריפה במחסן"},
        headers=auth_headers(user),
    )
    # Auth passed; no ANTHROPIC_API_KEY in the test env so the endpoint's own
    # _require_api_key() check is what returns 503, not the auth dependency.
    assert resp.status_code == 503


def test_ask_without_token_is_401(client):
    resp = client.post("/api/ai/ask", json={"question": "מה ה-TIV הכולל?"})
    assert resp.status_code == 401


def test_ask_with_token_passes_auth_gate(client, make_user):
    user = make_user(role="RISK_MANAGER", email="rm-ai-test@example.com")
    resp = client.post(
        "/api/ai/ask",
        json={"question": "מה ה-TIV הכולל?"},
        headers=auth_headers(user),
    )
    assert resp.status_code == 503


def test_executive_summary_without_token_is_401(client):
    resp = client.get("/api/ai/executive-summary")
    assert resp.status_code == 401


def test_executive_summary_with_token_passes_auth_gate(client, make_user):
    user = make_user(role="CFO", email="cfo-ai-test@example.com")
    resp = client.get("/api/ai/executive-summary", headers=auth_headers(user))
    assert resp.status_code == 503
