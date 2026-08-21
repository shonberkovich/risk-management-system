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
    monkeypatch.setattr(ai_orchestrator, "classify_intent", lambda message, history=None: _fake_decision("COMPLIANCE_AGENT"))

    orchestrator = ai_orchestrator.AgentOrchestrator(db, session_id=None, user=None)
    result = orchestrator.handle("האם הנכס עומד בתקן ISO 31000?")

    assert result.agent == "COMPLIANCE_AGENT"
    assert "טרם מומש" in result.answer
