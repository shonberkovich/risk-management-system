"""Agent Orchestrator (TODO_SPEC.md §2) — the single entry point multi-turn AI
chat goes through. Given a free-text user message (optionally continuing an
existing `Agent_Sessions` row for short/long-term context, see
`services/agents/` and `models.AgentSession`/`AgentActionLog` from
TODO_SPEC.md §1), it:

1. loads/creates the session and its rolling context,
2. runs ONE tool-use turn whose tool set is the union of every specialist
   agent's tools that the user's role may use (`AGENT_TOOLS` +
   `AGENT_ALLOWED_ROLES`) — the model only ever picks a fixed tool + params,
3. labels the turn with the agent that owns the first tool the model called
   (that tool choice *is* the routing decision),
4. persists the exchange back onto the session's context and appends an
   `Agent_Actions_Log` row.

Routing used to be a separate structured-output call ahead of the agent's own
tool loop — three sequential model round trips (~5-6s per message). Folding
routing into the agent's first tool choice, and answering headline-KPI
questions straight from a snapshot in the prompt, brings a turn down to one or
two round trips. Role gating is stricter than before, too: a role's
disallowed tools are never offered at all, rather than relying on a router
label being right.

Downstream agents (TODO_SPEC.md §4 `data_agent.py`, §5 `action_agent.py`)
plug their prompt + tools in via `register_agent_tools()` below.
"""
from __future__ import annotations

import contextlib
import json
import re
import sys
import threading
import uuid
from collections.abc import Callable, Iterator
from datetime import datetime, timezone
from typing import Literal, NamedTuple

from pydantic import BaseModel
from sqlalchemy.orm import Session

from app import models
from app.config import settings
from app.database import SessionLocal
from app.services import kpi as kpi_service
from app.services import llm

AgentType = Literal["DATA_AGENT", "COMPLIANCE_AGENT", "EXTERNAL_DATA_AGENT"]

# How many prior (user, agent, answer) exchanges are kept in context_data and
# replayed into the next turn — bounds both the DB row size and the prompt
# size; older turns simply age out rather than being summarized.
_MAX_HISTORY_TURNS = 8

_BASE_SYSTEM_PROMPT = """אתה עוזר ה-AI של מערכת RMIS לניהול סיכונים בחברת נדל"ן/לוגיסטיקה בישראל.
ענה תמיד בעברית ובקצרה - משפט עד שלושה, או רשימה קצרה כשיש כמה פריטים, אלא אם התבקש פירוט. התבסס אך ורק על תמונת המצב שלמטה ועל תוצאות הכלים - אל תמציא נתונים.
אם התשובה כבר מופיעה בתמונת המצב, ענה ישירות בלי לקרוא לכלי.
אם השאלה לא קשורה לתחומים שלמטה, הסבר בקצרה במה אתה יכול לעזור."""

_DATA_AGENT_PROMPT = """נתונים פנימיים: נכסים, פרופילי סיכון, תביעות, אירועי נזק, משימות הפחתת סיכון ו-KPI-ים.
לפרטים שאינם בתמונת המצב השתמש בכלים get_kpis / query_properties / query_claims / query_incidents / query_mitigation_tasks."""

_NO_INTERNAL_DATA_PROMPT = """לתפקיד המשתמש אין הרשאה לנתונים פיננסיים/פנימיים או לנתוני תאימות. אם הוא שואל עליהם, השב:
"אין לתפקידך הרשאה לנתונים שהשאלה הזו דורשת (נתונים פיננסיים/תאימות). ניתן לשאול אותי על נתוני מאקרו חיצוניים -
מזג אוויר קיצוני, רעידות אדמה, חומרים מסוכנים בסביבת הנכסים ומדדים כלכליים." """

def _kpi_snapshot() -> str:
    """Headline numbers and the property list (with risk scores) inlined into the
    prompt, so the most common questions ("how many open claims?", "what's the
    TIV?", "which properties are at high flood risk?") need no tool round trip."""
    db = SessionLocal()
    try:
        s = kpi_service.get_kpi_summary(db)
        return "נכסים:\n" + llm.query_properties.call({}) + "\n" + (
            f"TIV (סך שווי מבוטח): {s.tiv:,.0f} ₪\n"
            f"MFL (חשיפה מקסימלית באשכול גיאוגרפי): {s.mfl:,.0f} ₪\n"
            f"תביעות פתוחות: {s.open_claims_count} בסך {s.open_claims_amount:,.0f} ₪\n"
            f"סכום מאושר הממתין לגבייה: {s.approved_pending_amount:,.0f} ₪\n"
            f"יחס נזקים (Loss Ratio): {s.loss_ratio:.1%}\n"
            f"פרמיה שנתית כוללת: {s.total_annual_premium:,.0f} ₪"
        )
    finally:
        db.close()


class AgentSpec(NamedTuple):
    prompt: str  # this agent's section of the system prompt
    tools: list  # @beta_tool functions the model may call
    # Cheap (DB-only) summary inlined into the prompt so overview questions are
    # answered without a tool round trip; None = tools only.
    snapshot: Callable[[], str] | None = None


# DATA_AGENT's tools live in services/llm.py (shared with POST /api/ai/ask); the
# other two register from services/agents/ via register_agent_tools().
AGENT_TOOLS: dict[AgentType, AgentSpec] = {
    "DATA_AGENT": AgentSpec(_DATA_AGENT_PROMPT, llm.ASK_TOOLS, _kpi_snapshot),
}


# Who may be *answered* by each agent, mirroring the REST endpoints behind the same
# data (routers/analytics.py _FINANCIAL_READ_ROLES, routers/compliance.py
# _COMPLIANCE_ROLES). /api/ai/agent-chat itself is open to every role (FIELD_WORKER
# uses the assistant too), so without this a FIELD_WORKER could get TIV/claims/
# premium figures from DATA_AGENT's tools that every financial endpoint denies them.
# None = no restriction (EXTERNAL_DATA_AGENT only reads public macro data —
# weather, earthquakes, hazmat layers, BOI indicators).
FINANCIAL_READ_ROLES = ("RISK_MANAGER", "CFO", "PROPERTY_MANAGER", "RISK_OFFICER", "ADJUSTER", "ADMIN")
COMPLIANCE_ROLES = ("RISK_MANAGER", "RISK_OFFICER", "CFO", "ADMIN")
AGENT_ALLOWED_ROLES: dict[AgentType, tuple[str, ...] | None] = {
    "DATA_AGENT": FINANCIAL_READ_ROLES,
    "COMPLIANCE_AGENT": COMPLIANCE_ROLES,
    "EXTERNAL_DATA_AGENT": None,
}


def register_agent_tools(
    agent: AgentType, prompt: str, tools: list, snapshot: Callable[[], str] | None = None
) -> None:
    """Lets a downstream agent module (data_agent.py / action_agent.py) plug
    its prompt section, tools and optional snapshot into the orchestrator
    without this module importing them directly (avoids a circular/heavy
    import at load time)."""
    AGENT_TOOLS[agent] = AgentSpec(prompt, list(tools), snapshot)


def allowed_agents(user: models.User | None) -> list[AgentType]:
    return [
        agent for agent in AGENT_TOOLS
        if (roles := AGENT_ALLOWED_ROLES.get(agent)) is None or user is None or user.role in roles
    ]


def warm_up_in_background() -> None:
    """At server start: open the pooled Claude connection (a free models
    lookup, no tokens) and prime every agent snapshot, so the first chat
    message pays neither the TLS handshake nor a cold external-data fetch.
    No-op without a key or under pytest; failures are ignored — the real
    request just does the work itself."""
    if not settings.anthropic_api_key or "pytest" in sys.modules:
        return

    def _warm() -> None:
        with contextlib.suppress(Exception):
            llm.get_client().models.retrieve(settings.anthropic_model)
        for spec in list(AGENT_TOOLS.values()):
            if spec.snapshot is not None:
                with contextlib.suppress(Exception):
                    spec.snapshot()

    threading.Thread(target=_warm, name="ai-warm-up", daemon=True).start()


def _turn_request(message: str, history: list[dict], agents: list[AgentType]) -> tuple[dict, dict[str, AgentType]]:
    """tool_runner kwargs for one chat turn over the tools of `agents`, plus a
    tool name -> owning agent map."""
    tool_owner: dict[str, AgentType] = {}
    tools: list = []
    sections = [_BASE_SYSTEM_PROMPT]
    snapshots = []
    for agent in agents:
        spec = AGENT_TOOLS[agent]
        sections.append(spec.prompt)
        tools.extend(spec.tools)
        tool_owner.update({t.name: agent for t in spec.tools})
        if spec.snapshot is not None and (snapshot := spec.snapshot()):
            snapshots.append(snapshot)
    if snapshots:
        sections.append("תמונת מצב נוכחית:\n" + "\n".join(snapshots))
    if "DATA_AGENT" not in agents:
        sections.append(_NO_INTERNAL_DATA_PROMPT)
    sections.append(_TAG_PROMPT)

    messages: list[dict] = []
    for turn in history[-_MAX_HISTORY_TURNS:]:
        messages.append({"role": "user", "content": turn.get("message") or "-"})
        messages.append({"role": "assistant", "content": turn.get("answer") or "-"})
    messages.append({"role": "user", "content": message})

    request = {
        "model": settings.anthropic_model,
        "output_config": {"effort": settings.anthropic_effort},
        "max_tokens": 2048,
        "system": "\n\n".join(sections),
        "tools": tools,
        "messages": messages,
    }
    return request, tool_owner


def _owning_agent(
    used: list[str], tool_owner: dict[str, AgentType], agents: list[AgentType], tagged: AgentType | None
) -> AgentType:
    """The agent a turn is labelled with: the owner of the first tool called,
    else the agent the model tagged its answer with (answers drawn straight
    from a snapshot call no tool), else a default."""
    first_owner = next((tool_owner[name] for name in used if name in tool_owner), None)
    return first_owner or tagged or ("DATA_AGENT" if "DATA_AGENT" in agents else agents[0])


_NO_ANSWER = "לא הצלחתי לענות על השאלה."

# The model opens every answer with one of these tags (see _TAG_PROMPT) so a
# turn answered from a snapshot, with no tool call, can still be labelled with
# the right agent. Stripped before the text reaches the user.
_AGENT_TAGS: dict[str, AgentType] = {
    "DATA": "DATA_AGENT", "COMPLIANCE": "COMPLIANCE_AGENT", "EXTERNAL": "EXTERNAL_DATA_AGENT",
}
_TAG_RE = re.compile(r"^\s*\[(DATA|COMPLIANCE|EXTERNAL)\]\s*")
_TAG_PROMPT = (
    "פתח כל תשובה בתגית אחת לפי סוג המידע שעליו היא מתבססת, ואחריה שורה חדשה: "
    "[DATA] לנתונים פנימיים, [COMPLIANCE] לתאימות וציות, [EXTERNAL] לנתוני מאקרו חיצוניים."
)
# Longest possible tag plus leading whitespace — past this, a stream that
# hasn't produced a tag never will.
_TAG_MAX_LEN = 16


def _split_tag(text: str, agents: list[AgentType]) -> tuple[AgentType | None, str]:
    match = _TAG_RE.match(text)
    if not match:
        return None, text
    agent = _AGENT_TAGS[match.group(1)]
    return (agent if agent in agents else None), text[match.end():]


def run_agent_turn(
    message: str, history: list[dict], agents: list[AgentType]
) -> tuple[AgentType, list[str], str]:
    """One tool-use turn over the tools of `agents`. Returns (agent owning the
    first tool called, names of every tool called, final answer text)."""
    request, tool_owner = _turn_request(message, history, agents)
    used: list[str] = []
    tagged: AgentType | None = None
    final_text = ""
    for msg in llm.get_client().beta.messages.tool_runner(**request):
        for block in msg.content:
            if block.type == "tool_use":
                used.append(block.name)
            elif block.type == "text":
                tag, final_text = _split_tag(block.text, agents)
                tagged = tagged or tag
    return _owning_agent(used, tool_owner, agents, tagged), used, final_text or _NO_ANSWER


def stream_agent_turn(message: str, history: list[dict], agents: list[AgentType]) -> Iterator[dict]:
    """Streaming twin of `run_agent_turn`: yields {"type": "text", "delta"} as
    the answer is written, {"type": "reset"} when text already sent turns out
    to be preamble before a tool call (the client clears it), and finally
    {"type": "final", "agent", "used", "answer"}."""
    request, tool_owner = _turn_request(message, history, agents)
    used: list[str] = []
    tagged: AgentType | None = None
    final_text = ""
    for stream in llm.get_client().beta.messages.tool_runner(**request, stream=True):
        turn_text = ""
        pending: str | None = ""  # text held back until the opening tag is resolved; None once it is
        for event in stream:
            if not (event.type == "content_block_delta" and event.delta.type == "text_delta"):
                continue
            delta = event.delta.text
            if pending is not None:
                pending += delta
                head = pending.lstrip()
                if head.startswith("[") and "]" not in head and len(pending) < _TAG_MAX_LEN:
                    continue  # might still be a tag — wait for more
                tag, delta = _split_tag(pending, agents)
                tagged = tagged or tag
                delta = delta.lstrip()
                pending = None
            elif not turn_text:
                delta = delta.lstrip()  # newline after a tag split across deltas
            if delta:
                turn_text += delta
                yield {"type": "text", "delta": delta}
        if pending:  # stream ended while still undecided
            tag, rest = _split_tag(pending, agents)
            tagged = tagged or tag
            if rest.strip():
                turn_text += rest.strip()
                yield {"type": "text", "delta": rest.strip()}
        tool_names = [b.name for b in stream.get_final_message().content if b.type == "tool_use"]
        if tool_names:
            used.extend(tool_names)
            if turn_text:
                yield {"type": "reset"}
        elif turn_text:
            final_text = turn_text
    yield {
        "type": "final",
        "agent": _owning_agent(used, tool_owner, agents, tagged),
        "used": used,
        "answer": final_text or _NO_ANSWER,
    }


class AgentChatResult(BaseModel):
    session_id: str
    agent: AgentType
    reasoning: str
    answer: str


class AgentOrchestrator:
    """Owns the request-scoped state for one orchestrated chat turn: the
    `Agent_Sessions` row (loaded or created), its parsed context, and writing
    both back (plus an `Agent_Actions_Log` entry) at the end of `handle()`."""

    def __init__(self, db: Session, session_id: str | None = None, user: models.User | None = None):
        self.db = db
        self.user = user
        self.session = self._load_or_create_session(session_id)

    def _load_or_create_session(self, session_id: str | None) -> models.AgentSession:
        if session_id:
            existing = self.db.get(models.AgentSession, session_id)
            if existing is not None:
                if self.user is None or existing.user_id in (None, self.user.user_id):
                    return existing
                # Someone else's session — never continue (or append to) another
                # user's conversation; start a fresh one under a new id instead.
                session_id = None
        new_id = session_id or str(uuid.uuid4())
        session = models.AgentSession(
            session_id=new_id,
            user_id=self.user.user_id if self.user else None,
        )
        self.db.add(session)
        self.db.flush()
        return session

    def _history(self) -> list[dict]:
        if not self.session.context_data:
            return []
        try:
            data = json.loads(self.session.context_data)
        except (TypeError, ValueError):
            return []
        return data.get("history", []) if isinstance(data, dict) else []

    def _save_history(self, history: list[dict]) -> None:
        trimmed = history[-_MAX_HISTORY_TURNS:]
        self.session.context_data = json.dumps({"history": trimmed}, ensure_ascii=False)
        self.session.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)

    def _log_action(self, action_type: str, payload: dict, status: str = "executed") -> None:
        self.db.add(models.AgentActionLog(
            session_id=self.session.session_id,
            action_type=action_type,
            payload=json.dumps(payload, ensure_ascii=False),
            status=status,
        ))

    def handle(self, message: str) -> AgentChatResult:
        history = self._history()
        agent, used_tools, answer = run_agent_turn(message, history, allowed_agents(self.user))
        return self._finish(history, message, agent, used_tools, answer)

    def handle_stream(self, message: str) -> Iterator[dict]:
        """Streaming twin of `handle()`: relays `stream_agent_turn`'s text/reset
        events, then persists the turn and yields {"type": "done", **AgentChatResult}."""
        history = self._history()
        for event in stream_agent_turn(message, history, allowed_agents(self.user)):
            if event["type"] == "final":
                result = self._finish(history, message, event["agent"], event["used"], event["answer"])
                yield {"type": "done", **result.model_dump()}
            else:
                yield event

    def _finish(
        self, history: list[dict], message: str, agent: AgentType, used_tools: list[str], answer: str
    ) -> AgentChatResult:
        reasoning = (
            "נענה באמצעות: " + ", ".join(dict.fromkeys(used_tools)) if used_tools
            else "נענה מתמונת המצב, ללא כלים"
        )

        history.append({"message": message, "agent": agent, "answer": answer})
        self._save_history(history)
        self._log_action(
            action_type=f"ROUTE_{agent}",
            payload={"message": message, "reasoning": reasoning},
        )
        self.db.commit()

        return AgentChatResult(
            session_id=self.session.session_id,
            agent=agent,
            reasoning=reasoning,
            answer=answer,
        )
