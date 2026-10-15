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
from app.services import ai_orchestrator, chat_charts, llm
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


def _fake_turn(answer, agent="DATA_AGENT", used=(), charts=()):
    return lambda message, history, agents: (
        agent, list(used), answer(history) if callable(answer) else answer, list(charts)
    )


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
        lambda message, history, agents: seen.append(agents) or ("EXTERNAL_DATA_AGENT", [], "סערה", []),
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
    assert request["thinking"] == {"type": "disabled"}  # no pre-answer thinking in the chat (latency)


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


# --- show_chart: input sanitizing and turn-request wiring -------------------

_LOSS_RATIO_CHART = {
    "chart_type": "bar",
    "title": "יחס הפסד לפי אזור",
    "unit": "%",
    "points": [{"label": "מרכז", "value": 42.5}, {"label": "צפון", "value": "18"}],
}
_LOSS_RATIO_CHART_CLEAN = {
    "chart_type": "bar",
    "title": "יחס הפסד לפי אזור",
    "x_label": "",
    "y_label": "",
    "unit": "%",
    "series": ["יחס הפסד לפי אזור"],
    "points": [{"label": "מרכז", "values": [42.5]}, {"label": "צפון", "values": [18.0]}],
}


def test_sanitize_chart_normalizes_a_simple_chart():
    assert chat_charts.sanitize_chart(_LOSS_RATIO_CHART) == _LOSS_RATIO_CHART_CLEAN


def test_sanitize_chart_bounds_sizes_and_keeps_only_numbers():
    chart = chat_charts.sanitize_chart({
        "chart_type": "radar",  # unknown -> bar
        "title": "כ" * 500 + "‮\x00",
        "unit": "₪" * 12,
        "series": ["א", "ב", "ג", "ד", "ה", 7],
        "points": [{"label": f"נקודה {n}", "values": [n, "x", True, float("inf"), 5, 6]} for n in range(80)]
        + [{"label": "", "value": 1}, "not-a-point", {"label": "ריק", "value": None}],
    })

    assert chart["chart_type"] == "bar"
    assert len(chart["title"]) <= 80 and "‮" not in chart["title"] and "\x00" not in chart["title"]
    assert len(chart["unit"]) <= 8
    assert chart["series"] == ["א", "ב", "ג", "ד"]  # capped, non-strings dropped
    assert len(chart["points"]) == chat_charts.MAX_POINTS
    # one value per series; non-numeric / bool / infinite values become null
    assert chart["points"][3] == {"label": "נקודה 3", "values": [3.0, None, None, None]}


def test_sanitize_chart_pie_uses_one_series_and_positive_slices_only():
    chart = chat_charts.sanitize_chart({
        "chart_type": "pie",
        "title": "תביעות לפי סטטוס",
        "series": ["כמות", "סכום"],
        "points": [
            {"label": "פתוחה", "values": [3, 900]},
            {"label": "נדחתה", "value": 0},
            {"label": "שגויה", "value": -2},
        ],
    })

    assert chart["series"] == ["כמות"]
    assert chart["points"] == [{"label": "פתוחה", "values": [3.0]}]


@pytest.mark.parametrize(
    "raw", [None, "chart", {"title": "x"}, {"title": "x", "points": [{"label": "a", "value": "n/a"}]}]
)
def test_sanitize_chart_rejects_unplottable_input(raw):
    assert chat_charts.sanitize_chart(raw) is None


def test_add_chart_skips_duplicates_and_caps_per_turn():
    charts = []
    assert chat_charts.add_chart(charts, _LOSS_RATIO_CHART) == _LOSS_RATIO_CHART_CLEAN
    assert chat_charts.add_chart(charts, _LOSS_RATIO_CHART) is None  # same chart twice
    for n in range(5):
        chat_charts.add_chart(charts, {**_LOSS_RATIO_CHART, "title": f"גרף {n}"})
    assert len(charts) == chat_charts.MAX_CHARTS_PER_TURN


def test_turn_request_offers_show_chart_to_every_role_without_an_owner(stub_snapshots):
    for agents in (["EXTERNAL_DATA_AGENT"], ai_orchestrator.allowed_agents(None)):
        request, tool_owner = ai_orchestrator._turn_request("גרף", [], agents)
        assert "show_chart" in {t.name for t in request["tools"]}
        assert "show_chart" not in tool_owner  # never decides which agent answered
        assert chat_charts.CHART_PROMPT in request["system"]


def test_turn_request_replays_past_charts_as_tool_calls(stub_snapshots):
    history = [
        {"message": "גרף יחס הפסד", "agent": "DATA_AGENT", "answer": "הנה הגרף.", "charts": [_LOSS_RATIO_CHART_CLEAN]},
        {"message": "תודה", "agent": "DATA_AGENT", "answer": "בשמחה."},
    ]
    messages = ai_orchestrator._history_messages(history, "ועכשיו כעוגה")

    assert messages[1] == {
        "role": "assistant",
        "content": [
            {"type": "text", "text": "הנה הגרף."},
            {"type": "tool_use", "id": "chart_0_0", "name": "show_chart", "input": _LOSS_RATIO_CHART_CLEAN},
        ],
    }
    assert messages[2] == {
        "role": "user",
        "content": [
            {"type": "tool_result", "tool_use_id": "chart_0_0", "content": chat_charts.CHART_SHOWN},
            {"type": "text", "text": "תודה"},
        ],
    }
    assert messages[3] == {"role": "assistant", "content": "בשמחה."}
    assert messages[4] == {"role": "user", "content": "ועכשיו כעוגה"}


# --- streaming turn, against a fake tool runner -----------------------------

def _text_event(text):
    return SimpleNamespace(type="content_block_delta", delta=SimpleNamespace(type="text_delta", text=text))


def _chart_block(chart_input):
    return SimpleNamespace(type="tool_use", name="show_chart", input=chart_input)


class _FakeStream:
    """One model turn: text deltas, then a content_block_stop per show_chart
    call (carrying its parsed input), and a final message listing every
    tool_use block. `consumed` records whether the runner got this far."""

    def __init__(self, deltas, tool_names=(), charts=()):
        chart_blocks = [_chart_block(c) for c in charts]
        self._events = [_text_event(d) for d in deltas] + [
            SimpleNamespace(type="content_block_stop", content_block=b) for b in chart_blocks
        ]
        self._content = [SimpleNamespace(type="tool_use", name=n) for n in tool_names] + chart_blocks
        self.consumed = False

    def __iter__(self):
        self.consumed = True
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
    assert events[-1] == {
        "type": "final", "agent": "EXTERNAL_DATA_AGENT", "used": [], "answer": "אין התרעות.", "charts": [],
    }


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


def test_stream_emits_chart_event_and_ends_after_a_chart_only_turn(monkeypatch, stub_snapshots):
    never_needed = _FakeStream(["[DATA]\nתשובה מיותרת"])
    events = _run_stream(
        monkeypatch, [_FakeStream(["[DATA]\nהנה ", "הגרף."], charts=[_LOSS_RATIO_CHART]), never_needed]
    )

    assert [e["type"] for e in events] == ["text", "text", "chart", "final"]
    assert events[2] == {"type": "chart", "chart": _LOSS_RATIO_CHART_CLEAN}
    final = events[-1]
    assert final["answer"] == "הנה הגרף."
    assert final["charts"] == [_LOSS_RATIO_CHART_CLEAN]
    assert final["used"] == []  # show_chart isn't a data tool...
    assert final["agent"] == "DATA_AGENT"  # ...so the tag decides the label
    assert not never_needed.consumed  # no extra model round trip for the tool's acknowledgement


def test_stream_chart_after_data_tool_keeps_reset_and_tool_credit(monkeypatch, stub_snapshots):
    events = _run_stream(
        monkeypatch,
        [
            _FakeStream(["[DATA] בודק..."], tool_names=["get_property_compliance"]),
            _FakeStream(["[DATA]\nלפי אזור:"], charts=[_LOSS_RATIO_CHART]),
        ],
    )

    assert [e["type"] for e in events] == ["text", "reset", "text", "chart", "final"]
    final = events[-1]
    assert final["answer"] == "לפי אזור:"
    assert final["used"] == ["get_property_compliance"]
    assert final["agent"] == "COMPLIANCE_AGENT"
    assert final["charts"] == [_LOSS_RATIO_CHART_CLEAN]


def test_stream_chart_without_text_waits_for_the_next_turn_text(monkeypatch, stub_snapshots):
    events = _run_stream(
        monkeypatch, [_FakeStream(["[DATA]"], charts=[_LOSS_RATIO_CHART]), _FakeStream(["הנה הגרף."])]
    )

    assert [e["type"] for e in events] == ["chart", "text", "final"]
    assert events[-1]["answer"] == "הנה הגרף."
    assert events[-1]["charts"] == [_LOSS_RATIO_CHART_CLEAN]


def test_stream_drops_an_unplottable_chart(monkeypatch, stub_snapshots):
    events = _run_stream(
        monkeypatch, [_FakeStream(["[DATA]\nאין נתונים."], charts=[{"title": "ריק", "points": []}])]
    )

    assert "chart" not in [e["type"] for e in events]
    assert events[-1]["charts"] == []
    assert events[-1]["answer"] == "אין נתונים."


def test_run_agent_turn_collects_charts_and_ends_after_a_chart_only_turn(monkeypatch, stub_snapshots):
    def text(t):
        return SimpleNamespace(type="text", text=t)

    turns = [
        SimpleNamespace(content=[text("[DATA] בודק"), SimpleNamespace(type="tool_use", name="query_claims")]),
        SimpleNamespace(content=[text("[DATA]\nהנה הגרף."), _chart_block(_LOSS_RATIO_CHART)]),
    ]

    def tool_runner(**kwargs):
        assert "stream" not in kwargs
        yield from turns
        raise AssertionError("asked the model again after a chart-only turn")

    monkeypatch.setattr(
        llm, "get_client",
        lambda: SimpleNamespace(beta=SimpleNamespace(messages=SimpleNamespace(tool_runner=tool_runner))),
    )

    agent, used, answer, charts = ai_orchestrator.run_agent_turn("גרף", [], ai_orchestrator.allowed_agents(None))

    assert (agent, used, answer) == ("DATA_AGENT", ["query_claims"], "הנה הגרף.")
    assert charts == [_LOSS_RATIO_CHART_CLEAN]


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


def test_agent_chat_stream_endpoint_streams_chart_event_and_includes_charts_in_done(
    client, db, make_user, monkeypatch
):
    monkeypatch.setattr(settings, "anthropic_api_key", "test-key-not-real")

    def fake_stream(message, history, agents):
        yield {"type": "text", "delta": "הנה הגרף."}
        yield {"type": "chart", "chart": _LOSS_RATIO_CHART_CLEAN}
        yield {
            "type": "final", "agent": "DATA_AGENT", "used": [], "answer": "הנה הגרף.",
            "charts": [_LOSS_RATIO_CHART_CLEAN],
        }

    monkeypatch.setattr(ai_orchestrator, "stream_agent_turn", fake_stream)
    user = make_user(role="RISK_MANAGER")

    resp = client.post("/api/ai/agent-chat/stream", json={"message": "גרף יחס הפסד"}, headers=auth_headers(user))

    events = _ndjson(resp)
    assert [e["type"] for e in events] == ["text", "chart", "done"]
    assert events[1]["chart"] == _LOSS_RATIO_CHART_CLEAN
    done = events[-1]
    assert done["charts"] == [_LOSS_RATIO_CHART_CLEAN]
    db.expire_all()
    history = json.loads(db.get(models.AgentSession, done["session_id"]).context_data)["history"]
    assert history[0]["charts"] == [_LOSS_RATIO_CHART_CLEAN]


def test_agent_chat_endpoint_returns_charts(client, make_user, monkeypatch):
    """The non-streaming endpoint (the 401-refresh fallback) carries the same charts."""
    monkeypatch.setattr(settings, "anthropic_api_key", "test-key-not-real")
    monkeypatch.setattr(
        ai_orchestrator, "run_agent_turn", _fake_turn("הנה הגרף.", charts=[_LOSS_RATIO_CHART_CLEAN])
    )
    user = make_user(role="RISK_MANAGER")

    resp = client.post("/api/ai/agent-chat", json={"message": "גרף יחס הפסד"}, headers=auth_headers(user))

    assert resp.status_code == 200
    assert resp.json()["answer"] == "הנה הגרף."
    assert resp.json()["charts"] == [_LOSS_RATIO_CHART_CLEAN]
