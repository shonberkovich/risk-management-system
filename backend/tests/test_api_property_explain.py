"""POST /api/ai/properties/{property_id}/explain ("הסבר לי את הנכס") —
routers/ai.py + services/property_explain.py.

The Anthropic client is faked at `llm.get_client()` (same approach as
test_api_email_ai.py), here with the `.messages.stream()` context manager the
endpoint uses, capturing the request kwargs so the tests can assert on exactly
what reached the prompt.
"""
from __future__ import annotations

import json
from datetime import date, datetime

import anthropic

from app.config import settings
from app.services import llm
from tests.conftest import auth_headers


class _FakeStream:
    def __init__(self, deltas: list[str], error: Exception | None):
        self._deltas = deltas
        self._error = error

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    @property
    def text_stream(self):
        yield from self._deltas
        if self._error is not None:
            raise self._error


class _FakeMessages:
    def __init__(self, capture: list[dict], deltas: list[str], error: Exception | None):
        self._capture = capture
        self._deltas = deltas
        self._error = error

    def stream(self, **kwargs):
        self._capture.append(kwargs)
        return _FakeStream(self._deltas, self._error)


class _FakeClient:
    def __init__(self, capture, deltas, error):
        self.messages = _FakeMessages(capture, deltas, error)


def _install_fake_client(monkeypatch, deltas=("הנכס ", "בסיכון גבוה."), error=None) -> list[dict]:
    monkeypatch.setattr(settings, "anthropic_api_key", "test-key-not-real")
    capture: list[dict] = []
    monkeypatch.setattr(llm, "get_client", lambda: _FakeClient(capture, list(deltas), error))
    return capture


def _ndjson(resp) -> list[dict]:
    return [json.loads(line) for line in resp.text.splitlines() if line.strip()]


def _explain(client, property_id, user):
    return client.post(f"/api/ai/properties/{property_id}/explain", headers=auth_headers(user))


def _seed_two_properties(make_property, make_risk_profile, make_incident, make_policy, make_claim, make_mitigation_task):
    """Property A (the one explained) and B (must never leak into A's prompt),
    each with distinctive markers."""
    a = make_property(name="מחסן אלפא MARKER_A")
    b = make_property(name="מגדל בטא MARKER_B")
    make_risk_profile(a.property_id, flood_risk_score=4, fire_risk_score=5, earthquake_risk_score=2, has_sprinklers=False)
    make_risk_profile(b.property_id, flood_risk_score=1, fire_risk_score=1, earthquake_risk_score=1)
    policy = make_policy(covers=a.property_id, policy_number="POL-ALPHA", end_date=date(2099, 1, 1))
    inc_a = make_incident(
        a.property_id, incident_code="INC-A-001", description="שריפה במחסן INCIDENT_A",
        initial_estimated_loss=345_679, incident_timestamp=datetime(2025, 3, 1),
    )
    make_incident(a.property_id, incident_code="INC-A-DRAFT", description="טיוטה DRAFT_A", is_draft=True)
    inc_b = make_incident(b.property_id, incident_code="INC-B-001", description="הצפה INCIDENT_B")
    make_claim(inc_a.incident_id, policy.policy_id, claim_number="CLM-A-001", claimed_amount=123_457, approved_amount=0)
    make_claim(inc_b.incident_id, policy.policy_id, claim_number="CLM-B-001", claimed_amount=999_111)
    make_mitigation_task(a.property_id, title="התקנת מתזים TASK_A", cost_estimate=100_000, expected_annual_savings=37_000)
    make_mitigation_task(a.property_id, title="משימה שהושלמה DONE_A", status="COMPLETED")
    make_mitigation_task(b.property_id, title="ניקוז TASK_B")
    return a, b


# --- guards ------------------------------------------------------------------


def test_explain_without_token_is_401(client, make_property):
    prop = make_property()
    resp = client.post(f"/api/ai/properties/{prop.property_id}/explain")
    assert resp.status_code == 401


def test_explain_503_without_api_key(client, make_user, make_property):
    prop = make_property()
    resp = _explain(client, prop.property_id, make_user(role="RISK_MANAGER"))
    assert resp.status_code == 503


def test_explain_404_for_unknown_property(client, make_user, monkeypatch):
    capture = _install_fake_client(monkeypatch)
    resp = _explain(client, 999_999, make_user(role="RISK_MANAGER"))
    assert resp.status_code == 404
    assert capture == []  # never reached the model


def test_explain_rate_limited(client, make_user, make_property, monkeypatch):
    _install_fake_client(monkeypatch)
    monkeypatch.setattr(settings, "ai_rate_limit_per_window", 1)
    user = make_user(role="RISK_MANAGER")
    prop = make_property()
    assert _explain(client, prop.property_id, user).status_code == 200
    assert _explain(client, prop.property_id, user).status_code == 429


# --- stream ------------------------------------------------------------------


def test_explain_streams_text_then_done(client, make_user, make_property, make_risk_profile, monkeypatch):
    capture = _install_fake_client(monkeypatch, deltas=["ציון הסיכון ", "גבוה בגלל ", "סיכון השריפה."])
    prop = make_property()
    make_risk_profile(prop.property_id)

    resp = _explain(client, prop.property_id, make_user(role="RISK_MANAGER"))

    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("application/x-ndjson")
    events = _ndjson(resp)
    assert events == [
        {"type": "text", "delta": "ציון הסיכון "},
        {"type": "text", "delta": "גבוה בגלל "},
        {"type": "text", "delta": "סיכון השריפה."},
        {"type": "done"},
    ]
    # One small, low-effort call on the configured model.
    (kwargs,) = capture
    assert kwargs["model"] == settings.anthropic_model
    assert kwargs["output_config"] == {"effort": settings.anthropic_effort}
    assert kwargs["max_tokens"] <= 1024
    assert "tools" not in kwargs


def test_explain_ai_failure_mid_stream_is_error_event(client, make_user, make_property, monkeypatch):
    _install_fake_client(monkeypatch, deltas=["חלקי"], error=anthropic.APIConnectionError(request=None))
    prop = make_property()

    resp = _explain(client, prop.property_id, make_user(role="RISK_MANAGER"))

    assert resp.status_code == 200  # already streaming when the failure happened
    events = _ndjson(resp)
    assert events[0] == {"type": "text", "delta": "חלקי"}
    assert events[-1] == {"type": "error", "detail": "AI service unreachable"}
    assert {"type": "done"} not in events


# --- prompt content ----------------------------------------------------------


def test_prompt_has_this_property_only(
    client, make_user, make_property, make_risk_profile, make_incident, make_policy, make_claim,
    make_mitigation_task, monkeypatch,
):
    a, _b = _seed_two_properties(
        make_property, make_risk_profile, make_incident, make_policy, make_claim, make_mitigation_task
    )
    capture = _install_fake_client(monkeypatch)

    resp = _explain(client, a.property_id, make_user(role="RISK_MANAGER"))
    assert resp.status_code == 200

    prompt = capture[0]["messages"][0]["content"]
    for marker in ("MARKER_A", "INC-A-001", "INCIDENT_A", "CLM-A-001", "TASK_A", "POL-ALPHA"):
        assert marker in prompt, marker
    # Score 4*.35+5*.4+2*.25 = 3.9/5 -> 78.0, no sprinklers.
    assert "78.0/100" in prompt
    for leaked in ("MARKER_B", "INC-B-001", "INCIDENT_B", "CLM-B-001", "999,111", "TASK_B"):
        assert leaked not in prompt, leaked
    # Drafts and completed tasks aren't part of the picture.
    assert "DRAFT_A" not in prompt
    assert "DONE_A" not in prompt


def test_financial_role_gets_money_figures(
    client, make_user, make_property, make_risk_profile, make_incident, make_policy, make_claim,
    make_mitigation_task, monkeypatch,
):
    a, _ = _seed_two_properties(
        make_property, make_risk_profile, make_incident, make_policy, make_claim, make_mitigation_task
    )
    capture = _install_fake_client(monkeypatch)

    assert _explain(client, a.property_id, make_user(role="CFO")).status_code == 200

    prompt = capture[0]["messages"][0]["content"]
    assert "123,457 ₪" in prompt  # claimed amount
    assert "345,679 ₪" in prompt  # incident loss estimate
    assert "ROI 37%" in prompt  # 37,000 / 100,000


def test_field_worker_gets_analysis_without_financial_figures(
    client, make_user, make_property, make_risk_profile, make_incident, make_policy, make_claim,
    make_mitigation_task, monkeypatch,
):
    """FIELD_WORKER is outside _FINANCIAL_READ_ROLES: not a 403 (the property page
    is open to every role), but claim amounts, loss estimates and mitigation
    cost/ROI never reach the prompt. What PropertyDetail already shows every
    role (replacement value, MFL, policy limit) stays."""
    a, _ = _seed_two_properties(
        make_property, make_risk_profile, make_incident, make_policy, make_claim, make_mitigation_task
    )
    capture = _install_fake_client(monkeypatch)

    resp = _explain(client, a.property_id, make_user(role="FIELD_WORKER"))
    assert resp.status_code == 200

    prompt = capture[0]["messages"][0]["content"]
    for hidden in ("123,457", "345,679", "ROI", "37,000", "100,000", "סך נתבע"):
        assert hidden not in prompt, hidden
    # Still a useful analysis: the score, incidents, claims and tasks themselves.
    for kept in ("78.0/100", "INC-A-001", "CLM-A-001", "TASK_A", "10,000,000 ₪"):
        assert kept in prompt, kept


def test_compliance_status_only_for_compliance_roles(
    client, make_user, make_property, make_risk_profile, monkeypatch,
):
    prop = make_property()
    make_risk_profile(prop.property_id, flood_risk_score=5, fire_risk_score=5, earthquake_risk_score=5)
    capture = _install_fake_client(monkeypatch)

    _explain(client, prop.property_id, make_user(role="RISK_OFFICER"))
    _explain(client, prop.property_id, make_user(role="PROPERTY_MANAGER"))

    officer_prompt = capture[0]["messages"][0]["content"]
    manager_prompt = capture[1]["messages"][0]["content"]
    assert "תאימות ISO 31000: חריגה" in officer_prompt
    assert "אין בעל אחריות" in officer_prompt  # critical risk, no manager assigned
    assert "תאימות" not in manager_prompt
