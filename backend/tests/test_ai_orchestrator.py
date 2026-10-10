"""Unit tests for AgentOrchestrator (TODO_SPEC.md §2) — session load/create,
context persistence, and Agent_Actions_Log writes. `classify_intent` (a real
Anthropic call) is monkeypatched so these run without ANTHROPIC_API_KEY."""
from app import models
from app.services import ai_orchestrator


def _fake_decision(agent: str, reasoning: str = "test"):
    return ai_orchestrator.RoutingDecision(agent=agent, reasoning=reasoning)


def test_handle_creates_new_session_and_logs_action(db, monkeypatch):
    monkeypatch.setattr(ai_orchestrator, "classify_intent", lambda message, history=None: _fake_decision("DATA_AGENT"))
    monkeypatch.setitem(ai_orchestrator.AGENT_REGISTRY, "DATA_AGENT", lambda message, history: "42")

    orchestrator = ai_orchestrator.AgentOrchestrator(db, session_id=None, user=None)
    result = orchestrator.handle("מה ה-TIV הכולל?")

    assert result.agent == "DATA_AGENT"
    assert result.answer == "42"
    assert result.session_id

    session = db.get(models.AgentSession, result.session_id)
    assert session is not None
    actions = db.query(models.AgentActionLog).filter_by(session_id=result.session_id).all()
    assert len(actions) == 1
    assert actions[0].action_type == "ROUTE_DATA_AGENT"
    assert actions[0].status == "executed"


def test_handle_reuses_existing_session_and_accumulates_history(db, monkeypatch):
    monkeypatch.setattr(ai_orchestrator, "classify_intent", lambda message, history=None: _fake_decision("DATA_AGENT"))
    monkeypatch.setitem(ai_orchestrator.AGENT_REGISTRY, "DATA_AGENT", lambda message, history: f"answer-{len(history)}")

    orchestrator = ai_orchestrator.AgentOrchestrator(db, session_id=None, user=None)
    first = orchestrator.handle("שאלה ראשונה")

    orchestrator2 = ai_orchestrator.AgentOrchestrator(db, session_id=first.session_id, user=None)
    second = orchestrator2.handle("שאלה שנייה")

    assert second.session_id == first.session_id
    assert second.answer == "answer-1"  # saw the first exchange in history
    actions = db.query(models.AgentActionLog).filter_by(session_id=first.session_id).all()
    assert len(actions) == 2


def test_unregistered_agent_falls_back_gracefully(db, monkeypatch):
    # COMPLIANCE_AGENT/EXTERNAL_DATA_AGENT are genuinely registered once
    # services/agents/{action_agent,data_agent}.py have been imported
    # elsewhere in the test session (routers/ai.py does this at import time) —
    # so this test removes the registration to exercise the
    # not-yet-implemented fallback path itself, independent of whether those
    # agent modules happen to be loaded.
    monkeypatch.setattr(ai_orchestrator, "classify_intent", lambda message, history=None: _fake_decision("COMPLIANCE_AGENT"))
    monkeypatch.delitem(ai_orchestrator.AGENT_REGISTRY, "COMPLIANCE_AGENT", raising=False)

    orchestrator = ai_orchestrator.AgentOrchestrator(db, session_id=None, user=None)
    result = orchestrator.handle("האם הנכס עומד בתקן ISO 31000?")

    assert result.agent == "COMPLIANCE_AGENT"
    assert "טרם מומש" in result.answer


def test_field_worker_is_not_answered_by_financial_data_agent(db, make_user, monkeypatch):
    """DATA_AGENT's tools expose TIV/claims/premiums — FIELD_WORKER is denied those
    everywhere else, so the orchestrator must not run that agent for them."""
    monkeypatch.setattr(ai_orchestrator, "classify_intent", lambda message, history=None: _fake_decision("DATA_AGENT"))
    called = []
    monkeypatch.setitem(
        ai_orchestrator.AGENT_REGISTRY, "DATA_AGENT", lambda message, history: called.append(message) or "TIV=1"
    )
    field_worker = make_user(role="FIELD_WORKER")

    result = ai_orchestrator.AgentOrchestrator(db, session_id=None, user=field_worker).handle("מה ה-TIV?")

    assert called == []
    assert "TIV=1" not in result.answer
    action = db.query(models.AgentActionLog).filter_by(session_id=result.session_id).one()
    assert action.status == "denied"


def test_field_worker_can_use_external_data_agent(db, make_user, monkeypatch):
    monkeypatch.setattr(
        ai_orchestrator, "classify_intent", lambda message, history=None: _fake_decision("EXTERNAL_DATA_AGENT")
    )
    monkeypatch.setitem(ai_orchestrator.AGENT_REGISTRY, "EXTERNAL_DATA_AGENT", lambda message, history: "סערה")
    field_worker = make_user(role="FIELD_WORKER")

    result = ai_orchestrator.AgentOrchestrator(db, session_id=None, user=field_worker).handle("מזג אוויר?")

    assert result.answer == "סערה"


def test_another_users_session_id_starts_a_fresh_session(db, make_user, monkeypatch):
    monkeypatch.setattr(ai_orchestrator, "classify_intent", lambda message, history=None: _fake_decision("DATA_AGENT"))
    monkeypatch.setitem(ai_orchestrator.AGENT_REGISTRY, "DATA_AGENT", lambda message, history: f"answer-{len(history)}")
    owner = make_user(role="RISK_MANAGER")
    other = make_user(role="CFO")

    first = ai_orchestrator.AgentOrchestrator(db, session_id=None, user=owner).handle("שאלה פרטית")
    second = ai_orchestrator.AgentOrchestrator(db, session_id=first.session_id, user=other).handle("שאלה")

    assert second.session_id != first.session_id
    assert second.answer == "answer-0"  # didn't see the owner's history