"""Unit tests for AgentOrchestrator (TODO_SPEC.md §2) — session load/create,
context persistence, Agent_Actions_Log writes, role-based tool gating, the
answer-tag labelling and the streaming turn. The real Anthropic call is faked
(`run_agent_turn` / `stream_agent_turn`, or `llm.get_client` for the turn
functions themselves), and agent snapshots are stubbed so nothing touches the
real DB or network."""
import json
from types import SimpleNamespace

import anthropic
import pytest

from app import models
from app.config import settings
from app.services import ai_orchestrator, llm
from app.services.agents import action_agent, data_agent  # noqa: F401 — register their tools
from tests.conftest import auth_headers


@pytest.fixture()
def stub_snapshots(monkeypatch):
    """Replace every registered agent's snapshot with fixed text (the real ones
    read the production DB / live external feeds)."""
    for agent, spec in list(ai_orchestrator.AGENT_TOOLS.items()):
        if spec.snapshot is not None:
            monkeypatch.setitem(
                ai_orchestrator.AGENT_TOOLS, agent, spec._replace(snapshot=lambda agent=agent: f"SNAP-{agent}")
            )


def _fake_turn(answer, agent="DATA_AGENT", used=()):
    return lambda message, history, agents: (agent, list(used), answer(history) if callable(answer) else answer)


def test_handle_creates_new_session_and_logs_action(db, monkeypatch):
    monkeypatch.setattr(ai_orchestrator, "run_agent_turn", _fake_turn("42", used=["get_kpis"]))

    orchestrator = ai_orchestrator.AgentOrchestrator(db, session_id=None, user=None)
    result = orchestrator.handle("מה ה-TIV הכולל?")

    assert result.agent == "DATA_AGENT"
    assert result.answer == "42"
    assert "get_kpis" in result.reasoning
    assert result.session_id

    session = db.get(models.AgentSession, result.session_id)
    assert session is not None
    actions = db.query(models.AgentActionLog).filter_by(session_id=result.session_id).all()
    assert len(actions) == 1
    assert actions[0].action_type == "ROUTE_DATA_AGENT"
    assert actions[0].status == "executed"


def test_handle_reuses_existing_session_and_accumulates_history(db, monkeypatch):
    monkeypatch.setattr(ai_orchestrator, "run_agent_turn", _fake_turn(lambda history: f"answer-{len(history)}"))

    orchestrator = ai_orchestrator.AgentOrchestrator(db, session_id=None, user=None)
    first = orchestrator.handle("שאלה ראשונה")

    orchestrator2 = ai_orchestrator.AgentOrchestrator(db, session_id=first.session_id, user=None)
    second = orchestrator2.handle("שאלה שנייה")

    assert second.session_id == first.session_id
    assert second.answer == "answer-1"  # saw the first exchange in history
    actions = db.query(models.AgentActionLog).filter_by(session_id=first.session_id).all()
    assert len(actions) == 2


def test_field_worker_is_only_offered_external_data(db, make_user, monkeypatch):
    """DATA_AGENT's tools expose TIV/claims/premiums and COMPLIANCE_AGENT's the
    compliance report — FIELD_WORKER is denied those everywhere else, so their
    tools must never even be offered to the model for that role."""
    seen = []
    monkeypatch.setattr(
        ai_orchestrator,
        "run_agent_turn",
        lambda message, history, agents: seen.append(agents) or ("EXTERNAL_DATA_AGENT", [], "סערה"),
    )
    field_worker = make_user(role="FIELD_WORKER")

    result = ai_orchestrator.AgentOrchestrator(db, session_id=None, user=field_worker).handle("מה ה-TIV?")

    assert seen == [["EXTERNAL_DATA_AGENT"]]
    assert result.answer == "סערה"


def test_allowed_agents_by_role(make_user):
    assert set(ai_orchestrator.allowed_agents(make_user(role="RISK_MANAGER"))) == {
        "DATA_AGENT", "COMPLIANCE_AGENT", "EXTERNAL_DATA_AGENT",
    }
    assert set(ai_orchestrator.allowed_agents(make_user(role="ADJUSTER"))) == {"DATA_AGENT", "EXTERNAL_DATA_AGENT"}
    assert ai_orchestrator.allowed_agents(make_user(role="FIELD_WORKER")) == ["EXTERNAL_DATA_AGENT"]


def test_turn_request_for_field_worker_has_no_internal_tools_or_snapshots(stub_snapshots):
    request, tool_owner = ai_orchestrator._turn_request("מה ה-TIV?", [], ["EXTERNAL_DATA_AGENT"])

    tool_names = {t.name for t in request["tools"]}
    assert tool_names and tool_names.isdisjoint({t.name for t in llm.ASK_TOOLS})
    assert set(tool_owner.values()) == {"EXTERNAL_DATA_AGENT"}
    assert "SNAP-EXTERNAL_DATA_AGENT" in request["system"]
    assert "SNAP-DATA_AGENT" not in request["system"]
    assert "SNAP-COMPLIANCE_AGENT" not in request["system"]
    assert "אין לתפקידך הרשאה" in request["system"]


def test_turn_request_replays_history_and_inlines_snapshots(stub_snapshots):
    history = [{"message": "שאלה קודמת", "agent": "DATA_AGENT", "answer": "תשובה קודמת"}]
    request, _ = ai_orchestrator._turn_request("ועכשיו?", history, ai_orchestrator.allowed_agents(None))

    assert request["messages"] == [
        {"role": "user", "content": "שאלה קודמת"},
        {"role": "assistant", "content": "תשובה קודמת"},
        {"role": "user", "content": "ועכשיו?"},
    ]
    assert "SNAP-DATA_AGENT" in request["system"]
    assert "SNAP-COMPLIANCE_AGENT" in request["system"]
    assert request["output_config"] == {"effort": settings.anthropic_effort}


def test_another_users_session_id_starts_a_fresh_session(db, make_user, monkeypatch):
    monkeypatch.setattr(ai_orchestrator, "run_agent_turn", _fake_turn(lambda history: f"answer-{len(history)}"))
    owner = make_user(role="RISK_MANAGER")
    other = make_user(role="CFO")

    first = ai_orchestrator.AgentOrchestrator(db, session_id=None, user=owner).handle("שאלה פרטית")
    second = ai_orchestrator.AgentOrchestrator(db, session_id=first.session_id, user=other).handle("שאלה")

    assert second.session_id != first.session_id
    assert second.answer == "answer-0"  # didn't see the owner's history


def test_split_tag():
    agents = ["DATA_AGENT", "EXTERNAL_DATA_AGENT"]
    assert ai_orchestrator._split_tag("[EXTERNAL]\nאין התרעות", agents) == ("EXTERNAL_DATA_AGENT", "אין התרעות")
    assert ai_orchestrator._split_tag("אין תגית", agents) == (None, "אין תגית")
    # A tag for an agent this user may not use is stripped but not trusted.
    assert ai_orchestrator._split_tag("[COMPLIANCE] טקסט", agents) == (None, "טקסט")


# --- streaming turn, against a fake tool runner -----------------------------

def _text_event(text):
    return SimpleNamespace(type="content_block_delta", delta=SimpleNamespace(type="text_delta", text=text))


class _FakeStream:
    def __init__(self, deltas, tool_names=()):
        self._events = [_text_event(d) for d in deltas]
        self._content = [SimpleNamespace(type="tool_use", name=n) for n in tool_names]

    def __iter__(self):
        return iter(self._events)

    def get_final_message(self):
        return SimpleNamespace(content=self._content)


def _fake_client(turns):
    def tool_runner(**kwargs):
        assert kwargs.get("stream") is True
        return iter(turns)
    return SimpleNamespace(beta=SimpleNamespace(messages=SimpleNamespace(tool_runner=tool_runner)))


def _run_stream(monkeypatch, turns, agents=("DATA_AGENT", "COMPLIANCE_AGENT", "EXTERNAL_DATA_AGENT")):
    monkeypatch.setattr(llm, "get_client", lambda: _fake_client(turns))
    return list(ai_orchestrator.stream_agent_turn("שאלה", [], list(agents)))


def test_stream_strips_tag_split_across_deltas_and_labels_by_it(monkeypatch, stub_snapshots):
    events = _run_stream(monkeypatch, [_FakeStream(["[EXT", "ERNAL]", "\nאין ", "התרעות."])])

    text = "".join(e["delta"] for e in events if e["type"] == "text")
    assert text == "אין התרעות."
    assert events[-1] == {"type": "final", "agent": "EXTERNAL_DATA_AGENT", "used": [], "answer": "אין התרעות."}


def test_stream_resets_preamble_before_tool_call_and_labels_by_tool(monkeypatch, stub_snapshots):
    events = _run_stream(
        monkeypatch,
        [_FakeStream(["[DATA] בודק..."], tool_names=["get_property_compliance"]), _FakeStream(["[DATA]\nתקין."])],
    )

    assert {"type": "reset"} in events
    final = events[-1]
    assert final["answer"] == "תקין."
    assert final["used"] == ["get_property_compliance"]
    assert final["agent"] == "COMPLIANCE_AGENT"  # the tool's owner wins over the tag


def test_stream_without_tag_passes_text_through(monkeypatch, stub_snapshots):
    events = _run_stream(monkeypatch, [_FakeStream(["שלום ", "עולם"])], agents=["EXTERNAL_DATA_AGENT"])

    assert "".join(e["delta"] for e in events if e["type"] == "text") == "שלום עולם"
    assert events[-1]["agent"] == "EXTERNAL_DATA_AGENT"


# --- POST /api/ai/agent-chat/stream -----------------------------------------

def _ndjson(resp):
    return [json.loads(line) for line in resp.text.splitlines() if line.strip()]


def test_agent_chat_stream_endpoint_streams_and_persists(client, db, make_user, monkeypatch):
    monkeypatch.setattr(settings, "anthropic_api_key", "test-key-not-real")

    def fake_stream(message, history, agents):
        yield {"type": "text", "delta": "יש 9 "}
        yield {"type": "text", "delta": "תביעות."}
        yield {"type": "final", "agent": "DATA_AGENT", "used": [], "answer": "יש 9 תביעות."}

    monkeypatch.setattr(ai_orchestrator, "stream_agent_turn", fake_stream)
    user = make_user(role="RISK_MANAGER")

    resp = client.post("/api/ai/agent-chat/stream", json={"message": "כמה תביעות?"}, headers=auth_headers(user))

    assert resp.status_code == 200
    events = _ndjson(resp)
    assert [e["type"] for e in events] == ["text", "text", "done"]
    done = events[-1]
    assert done["answer"] == "יש 9 תביעות."
    assert done["agent"] == "DATA_AGENT"
    db.expire_all()
    session = db.get(models.AgentSession, done["session_id"])
    assert json.loads(session.context_data)["history"][0]["answer"] == "יש 9 תביעות."
    assert db.query(models.AgentActionLog).filter_by(session_id=done["session_id"]).count() == 1


def test_agent_chat_stream_endpoint_reports_ai_failure_as_error_event(client, make_user, monkeypatch):
    monkeypatch.setattr(settings, "anthropic_api_key", "test-key-not-real")

    def failing_stream(message, history, agents):
        yield {"type": "text", "delta": "חלקי"}
        raise anthropic.APIConnectionError(request=None)

    monkeypatch.setattr(ai_orchestrator, "stream_agent_turn", failing_stream)
    user = make_user(role="RISK_MANAGER")

    resp = client.post("/api/ai/agent-chat/stream", json={"message": "שאלה"}, headers=auth_headers(user))

    events = _ndjson(resp)
    assert events[-1] == {"type": "error", "detail": "AI service unreachable"}
