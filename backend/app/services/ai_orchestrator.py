"""Agent Orchestrator (TODO_SPEC.md §2) — the single entry point multi-turn AI
chat goes through. Given a free-text user message (optionally continuing an
existing `Agent_Sessions` row for short/long-term context, see
`services/agents/` and `models.AgentSession`/`AgentActionLog` from
TODO_SPEC.md §1), it:

1. loads/creates the session and its rolling context,
2. classifies intent with Anthropic structured outputs into a fixed set of
   agent labels (`AgentType`) — the model only ever picks a label, never
   free-form routing logic,
3. dispatches to the matching agent handler from `AGENT_REGISTRY`,
4. persists the exchange back onto the session's context and appends an
   `Agent_Actions_Log` row (this module's own audit trail of what it routed
   to and why — distinct from any action a downstream agent itself proposes).

Downstream agents (TODO_SPEC.md §4 `data_agent.py`, §5 `action_agent.py`)
register themselves into `AGENT_REGISTRY` below; until they exist, those
labels fall back to a "not yet implemented" response instead of erroring, so
this module works standalone.
"""
from __future__ import annotations

import json
import uuid
from collections.abc import Callable
from datetime import datetime, timezone
from typing import Literal

import anthropic
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app import models
from app.config import settings
from app.services import llm

AgentType = Literal["DATA_AGENT", "COMPLIANCE_AGENT", "EXTERNAL_DATA_AGENT"]

# How many prior (user, agent, answer) exchanges are kept in context_data and
# replayed back to the intent classifier — bounds both the DB row size and the
# prompt size; older turns simply age out rather than being summarized.
_MAX_HISTORY_TURNS = 8

_ROUTING_SYSTEM_PROMPT = """אתה שכבת הניתוב (Orchestrator) של מערך סוכני AI במערכת RMIS לניהול סיכונים.
תפקידך היחיד הוא לקרוא את פניית המשתמש (ואת היסטוריית השיחה, אם קיימת) ולהחליט לאיזה סוכן מתמחה לנתב אותה:

- DATA_AGENT: שאלות על נתונים פנימיים במערכת - נכסים, סיכונים, תביעות, אירועים, משימות הפחתת סיכון, KPI-ים.
- COMPLIANCE_AGENT: בקשות הקשורות לתאימות/ציות (Compliance), תקנים (כמו ISO 31000), המלצות על פעולות תיקון,
  או יצירת טיוטות/הצעות לפעולה במערכת (כמו פתיחת משימת מיטיגציה או טיוטת אירוע).
- EXTERNAL_DATA_AGENT: שאלות שדורשות נתוני מאקרו חיצוניים - מזג אוויר, רעידות אדמה/סייסמולוגיה, נתונים סביבתיים/כלכליים.

בחר את הסוכן המתאים ביותר בלבד. אל תענה על השאלה בעצמך."""


class RoutingDecision(BaseModel):
    agent: AgentType = Field(description="הסוכן המתאים ביותר לטיפול בפנייה")
    reasoning: str = Field(description="הסבר קצר בעברית לבחירה, משפט אחד")


def _get_client() -> anthropic.Anthropic:
    return anthropic.Anthropic(api_key=settings.anthropic_api_key or None)


def classify_intent(message: str, history: list[dict] | None = None) -> RoutingDecision:
    """Structured-output routing decision — the model returns strictly
    `RoutingDecision` JSON, never SQL or free-form instructions."""
    client = _get_client()
    context_lines = []
    for turn in (history or [])[-_MAX_HISTORY_TURNS:]:
        context_lines.append(f"משתמש: {turn.get('message', '')}")
        context_lines.append(f"סוכן ({turn.get('agent', '')}): {turn.get('answer', '')[:300]}")
    context_block = ("\n".join(context_lines) + "\n\n") if context_lines else ""

    response = client.messages.parse(
        model=settings.anthropic_model,
        max_tokens=512,
        system=_ROUTING_SYSTEM_PROMPT,
        messages=[{
            "role": "user",
            "content": f"{context_block}פנייה נוכחית: {message}",
        }],
        output_format=RoutingDecision,
    )
    return response.parsed_output


def _run_data_agent(message: str, history: list[dict]) -> str:
    return llm.ask_question(message)


def _not_implemented(agent_name: str) -> Callable[[str, list[dict]], str]:
    def _handler(message: str, history: list[dict]) -> str:
        return f"סוכן {agent_name} טרם מומש במלואו — יתווסף בהמשך פיתוח מערך הסוכנים."
    return _handler


# Populated here for DATA_AGENT; COMPLIANCE_AGENT / EXTERNAL_DATA_AGENT are
# registered by services/agents/action_agent.py and services/agents/data_agent.py
# respectively once those modules exist (TODO_SPEC.md §4/§5) — see each
# module's bottom-of-file registration call.
AGENT_REGISTRY: dict[AgentType, Callable[[str, list[dict]], str]] = {
    "DATA_AGENT": _run_data_agent,
    "COMPLIANCE_AGENT": _not_implemented("COMPLIANCE_AGENT"),
    "EXTERNAL_DATA_AGENT": _not_implemented("EXTERNAL_DATA_AGENT"),
}


def register_agent(agent: AgentType, handler: Callable[[str, list[dict]], str]) -> None:
    """Lets a downstream agent module (data_agent.py / action_agent.py) plug
    itself into the orchestrator without this module importing them directly
    (avoids a circular/heavy import at orchestrator load time)."""
    AGENT_REGISTRY[agent] = handler


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
                return existing
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
        decision = classify_intent(message, history)
        handler = AGENT_REGISTRY.get(decision.agent, _not_implemented(decision.agent))
        answer = handler(message, history)

        history.append({"message": message, "agent": decision.agent, "answer": answer})
        self._save_history(history)
        self._log_action(
            action_type=f"ROUTE_{decision.agent}",
            payload={"message": message, "reasoning": decision.reasoning},
            status="executed",
        )
        self.db.commit()

        return AgentChatResult(
            session_id=self.session.session_id,
            agent=decision.agent,
            reasoning=decision.reasoning,
            answer=answer,
        )
