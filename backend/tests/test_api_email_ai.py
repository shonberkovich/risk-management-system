"""Integration tests for routers/emails.py's Task 15 AI endpoints
(POST /{email_id}/summarize, POST /{email_id}/suggest-reply) —
TODO_SPEC.md "משימה 15: סיכום מיילים ארוכים וסיווג באמצעות Claude AI".

Same no-ANTHROPIC_API_KEY-in-test-env assumption as test_api_ai_auth.py (no
backend/.env in the test environment, so `settings.anthropic_api_key` defaults
to "" unless a test explicitly monkeypatches it) — used below both to exercise
the 503 degradation path directly, and to isolate it from the 404
ownership-check tests (which monkeypatch a key in so they reach the ownership
check that actually matters for those tests, not just get lucky on which gate
fires first).

The mocked-client tests fake `app.services.llm.get_client()` rather than the
real `anthropic.Anthropic` — there's no existing test in this suite that
mocks `client.messages.create` directly (test_ai_orchestrator.py mocks at the
`classify_intent`/agent-function level instead), so this fakes the same
`.messages.create(**kwargs) -> response` shape `llm.py` actually calls,
capturing the kwargs so the privacy test can assert on exactly what was sent.
"""
from __future__ import annotations

from tests.conftest import auth_headers
from app.config import settings
from app.services import llm


class _FakeTextBlock:
    def __init__(self, text: str):
        self.type = "text"
        self.text = text


class _FakeResponse:
    def __init__(self, text: str):
        self.content = [_FakeTextBlock(text)]


class _FakeMessages:
    def __init__(self, capture: list[dict], text: str):
        self._capture = capture
        self._text = text

    def create(self, **kwargs):
        self._capture.append(kwargs)
        return _FakeResponse(self._text)


class _FakeClient:
    def __init__(self, capture: list[dict], text: str):
        self.messages = _FakeMessages(capture, text)


def _install_fake_client(monkeypatch, text: str) -> list[dict]:
    """Monkeypatches both the API-key gate (so the router's `_require_ai_api_key`
    passes) and `llm.get_client` (so no real Anthropic call is ever made).
    Returns the list every call's kwargs get appended to."""
    monkeypatch.setattr(settings, "anthropic_api_key", "test-key-not-real")
    capture: list[dict] = []
    monkeypatch.setattr(llm, "get_client", lambda: _FakeClient(capture, text))
    return capture


def _send(client, headers, *, to, subject="נושא", body_html="<p>שלום</p>", in_reply_to=None):
    payload = {"to": to, "cc": [], "bcc": [], "subject": subject, "body_html": body_html}
    if in_reply_to is not None:
        payload["in_reply_to"] = in_reply_to
    resp = client.post("/api/emails", json=payload, headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json()["email_id"]


# ---------------------------------------------------------------------------
# End-to-end with a mocked Anthropic client
# ---------------------------------------------------------------------------


def test_summarize_end_to_end_with_mocked_client(client, make_user, monkeypatch):
    sender = make_user(role="RISK_MANAGER")
    recipient = make_user(role="PROPERTY_MANAGER")
    email_id = _send(client, auth_headers(sender), to=[recipient.user_id], subject="עדכון סטטוס", body_html="<p>שלום, מצ\"ב עדכון.</p>")

    _install_fake_client(monkeypatch, "זהו סיכום קצר של השרשור.")

    resp = client.post(f"/api/emails/{email_id}/summarize", headers=auth_headers(recipient))
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"summary": "זהו סיכום קצר של השרשור."}


def test_suggest_reply_end_to_end_with_mocked_client(client, make_user, monkeypatch):
    sender = make_user(role="RISK_MANAGER")
    recipient = make_user(role="PROPERTY_MANAGER")
    email_id = _send(client, auth_headers(sender), to=[recipient.user_id], subject="בקשה", body_html="<p>אפשר לעדכן אותי?</p>")

    _install_fake_client(monkeypatch, "תודה על הפנייה, אעדכן בהקדם.")

    resp = client.post(f"/api/emails/{email_id}/suggest-reply", headers=auth_headers(recipient))
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"draft": "תודה על הפנייה, אעדכן בהקדם."}


# ---------------------------------------------------------------------------
# 404 for a non-participant — must not become a way to read someone else's mail
# ---------------------------------------------------------------------------


def test_summarize_404_for_non_participant(client, make_user, monkeypatch):
    sender = make_user(role="RISK_MANAGER")
    recipient = make_user(role="PROPERTY_MANAGER")
    bystander = make_user(role="CFO")
    email_id = _send(client, auth_headers(sender), to=[recipient.user_id])

    _install_fake_client(monkeypatch, "should not be reachable")

    resp = client.post(f"/api/emails/{email_id}/summarize", headers=auth_headers(bystander))
    assert resp.status_code == 404


def test_suggest_reply_404_for_non_participant(client, make_user, monkeypatch):
    sender = make_user(role="RISK_MANAGER")
    recipient = make_user(role="PROPERTY_MANAGER")
    bystander = make_user(role="CFO")
    email_id = _send(client, auth_headers(sender), to=[recipient.user_id])

    _install_fake_client(monkeypatch, "should not be reachable")

    resp = client.post(f"/api/emails/{email_id}/suggest-reply", headers=auth_headers(bystander))
    assert resp.status_code == 404


def test_summarize_404_for_nonexistent_email(client, make_user, monkeypatch):
    user = make_user(role="RISK_MANAGER")
    _install_fake_client(monkeypatch, "should not be reachable")
    resp = client.post("/api/emails/999999/summarize", headers=auth_headers(user))
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# 503 without ANTHROPIC_API_KEY configured (CLAUDE.md's documented pattern)
# ---------------------------------------------------------------------------


def test_summarize_503_without_api_key(client, make_user):
    sender = make_user(role="RISK_MANAGER")
    recipient = make_user(role="PROPERTY_MANAGER")
    email_id = _send(client, auth_headers(sender), to=[recipient.user_id])

    resp = client.post(f"/api/emails/{email_id}/summarize", headers=auth_headers(recipient))
    assert resp.status_code == 503


def test_suggest_reply_503_without_api_key(client, make_user):
    sender = make_user(role="RISK_MANAGER")
    recipient = make_user(role="PROPERTY_MANAGER")
    email_id = _send(client, auth_headers(sender), to=[recipient.user_id])

    resp = client.post(f"/api/emails/{email_id}/suggest-reply", headers=auth_headers(recipient))
    assert resp.status_code == 503


def test_summarize_without_token_is_401(client, make_user):
    sender = make_user(role="RISK_MANAGER")
    recipient = make_user(role="PROPERTY_MANAGER")
    email_id = _send(client, auth_headers(sender), to=[recipient.user_id])

    resp = client.post(f"/api/emails/{email_id}/summarize")
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# Privacy (spec step 5): the prompt must contain only this thread's own
# messages — no cross-thread data, no unrelated entities.
# ---------------------------------------------------------------------------


def test_prompt_payload_only_contains_this_threads_own_messages(client, make_user, monkeypatch):
    sender = make_user(role="RISK_MANAGER")
    recipient = make_user(role="PROPERTY_MANAGER")
    headers_sender = auth_headers(sender)
    headers_recipient = auth_headers(recipient)

    # The thread we'll summarize.
    root_id = _send(
        client, headers_sender, to=[recipient.user_id],
        subject="שרשור נבחר", body_html="<p>SECRET_MARKER_THREAD_A_ROOT</p>",
    )
    reply_resp = client.post(
        "/api/emails",
        json={
            "to": [sender.user_id], "cc": [], "bcc": [],
            "subject": "Re: שרשור נבחר", "body_html": "<p>SECRET_MARKER_THREAD_A_REPLY</p>",
            "in_reply_to": root_id,
        },
        headers=headers_recipient,
    )
    assert reply_resp.status_code == 201, reply_resp.text

    # A completely unrelated thread the same two users are also both on —
    # its content must never leak into thread A's prompt.
    _send(
        client, headers_sender, to=[recipient.user_id],
        subject="שרשור אחר לגמרי", body_html="<p>UNRELATED_MARKER_THREAD_B</p>",
    )

    capture = _install_fake_client(monkeypatch, "summary text")

    resp = client.post(f"/api/emails/{root_id}/summarize", headers=headers_recipient)
    assert resp.status_code == 200, resp.text

    assert len(capture) == 1
    prompt_content = capture[0]["messages"][0]["content"]

    assert "SECRET_MARKER_THREAD_A_ROOT" in prompt_content
    assert "SECRET_MARKER_THREAD_A_REPLY" in prompt_content
    assert "UNRELATED_MARKER_THREAD_B" not in prompt_content
    # No system-wide context tools/KPI-style data ever entered the prompt either.
    assert "TIV" not in prompt_content
