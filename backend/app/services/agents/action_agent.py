"""Action & Compliance Agent (TODO_SPEC.md §5) — a risk-officer agent with
read access to `services/compliance.py`'s multi-framework report and the
ability to *propose* (never directly commit) a `Mitigation_Task` for a
non-compliant property. Human-in-the-loop by construction:

- `build_mitigation_task_proposal()` is a deterministic (no LLM) function that
  inspects `compliance.build_iso31000_report()` for one property and, if it's
  out of compliance, returns a payload shaped exactly like
  `schemas.MitigationTaskCreate` — ready for the frontend to POST to the
  existing `POST /api/mitigation-tasks` endpoint (routers/mitigation.py)
  *after* a user clicks "אשר" (TODO_SPEC.md §7's Action Card). Nothing here
  writes to `Mitigation_Tasks` itself.
- Building a proposal is the one thing this agent *does* commit on its own
  ("טיוטה", not a final action): it writes an `Agent_Actions_Log` row with
  `status="proposed"` so the recommendation is auditable even before/without
  user confirmation. Confirming/rejecting that row is the caller's job (see
  `mark_action_status` below), matching the models.AgentActionLog docstring's
  proposed -> confirmed/rejected lifecycle.

Registers itself as `COMPLIANCE_AGENT` in `ai_orchestrator.AGENT_REGISTRY` on
import (see that module's `register_agent`)."""
from __future__ import annotations

import json
from datetime import date, timedelta

import anthropic
from anthropic import beta_tool
from sqlalchemy.orm import Session

from app import models
from app.config import settings
from app.database import SessionLocal
from app.services import ai_orchestrator, compliance

SYSTEM_PROMPT = """אתה קצין ציות וסיכונים (Risk & Compliance Officer) בכיר במערכת RMIS.
תפקידך לנתח את מצב התאימות (Compliance) של תיק הנכסים מול תקנים (ISO 31000, Solvency II Pillar II,
חוזרי רשות שוק ההון) ולתת המלצות ברורות לפעולה. כאשר אתה מזהה נכס שחורג מתאימות (דירוג סיכון גבוה/קריטי
ללא בעל אחריות מוקצה, או בקרות הפחתת סיכון באיחור), עליך להשתמש בכלי propose_mitigation_task_for_property
כדי לבנות המלצה מובנית - אינך יוצר משימות בעצמך, רק מציע אותן לאישור משתמש.
ענה תמיד בעברית, בענייניות ובביסוס על נתוני הכלים בלבד."""

# Days from "today" a proposed mitigation task's due date defaults to — a
# deliberately short SLA since the trigger is a compliance gap, not routine
# maintenance (routers/mitigation.py itself keeps due_date free-form on
# create; this is just this agent's suggested default).
_PROPOSAL_DUE_DAYS = 30

_NON_COMPLIANT_LEVELS = ("גבוה", "קריטי")


def _find_entry(report: dict, property_id: int) -> dict | None:
    return next((e for e in report["entries"] if e["property_id"] == property_id), None)


def build_mitigation_task_proposal(db: Session, property_id: int) -> dict | None:
    """Returns a proposed `Mitigation_Task` payload (shaped like
    `MitigationTaskCreate`) for `property_id` if it's currently
    non-compliant, or None if the property is fine / doesn't exist. Never
    writes to Mitigation_Tasks — the caller (a confirmed Action Card,
    TODO_SPEC.md §7) does that via the existing mitigation-tasks endpoint."""
    report = compliance.build_iso31000_report(db)
    entry = _find_entry(report, property_id)
    if entry is None:
        return None

    is_non_compliant = (
        entry["risk_level"] in _NON_COMPLIANT_LEVELS
        and (entry["risk_owner_name"] is None or entry["overdue_controls_count"] > 0)
    )
    if not is_non_compliant:
        return None

    reasons = []
    if entry["risk_owner_name"] is None:
        reasons.append("לא מוקצה בעל אחריות לנכס בדירוג סיכון גבוה/קריטי")
    if entry["overdue_controls_count"] > 0:
        reasons.append(f"{entry['overdue_controls_count']} בקרות הפחתת סיכון באיחור")
    reasoning = "; ".join(reasons)

    proposed_task = {
        "property_id": property_id,
        "title": f"טיפול בחריגת תאימות — {entry['name']}",
        "cost_estimate": 0,
        "expected_annual_savings": 0,
        "due_date": (date.today() + timedelta(days=_PROPOSAL_DUE_DAYS)).isoformat(),
        "assigned_to_user_id": None,
    }

    return {
        "action_type": "CREATE_MITIGATION_TASK_PROPOSAL",
        "property_id": property_id,
        "property_name": entry["name"],
        "risk_level": entry["risk_level"],
        "reasoning": reasoning,
        "proposed_task": proposed_task,
    }


def log_proposal(db: Session, session_id: str, proposal: dict) -> models.AgentActionLog:
    """Writes the human-in-the-loop audit row for a proposal built by
    `build_mitigation_task_proposal`. Caller is responsible for `db.commit()`."""
    log = models.AgentActionLog(
        session_id=session_id,
        action_type=proposal["action_type"],
        payload=json.dumps(proposal, ensure_ascii=False),
        status="proposed",
    )
    db.add(log)
    db.flush()
    return log


def mark_action_status(db: Session, action_id: int, status: str) -> models.AgentActionLog | None:
    """Transitions a proposed Agent_Actions_Log row to 'confirmed' or
    'rejected' once a user has acted on its Action Card (TODO_SPEC.md §7).
    Caller commits."""
    log = db.get(models.AgentActionLog, action_id)
    if log is None:
        return None
    log.status = status
    return log


@beta_tool
def get_compliance_snapshot() -> str:
    """Returns a summary of the current multi-framework compliance report
    (ISO 31000 / Solvency II Pillar II / Capital Market Authority) — overall
    coverage, average risk score, and how many properties lack an assigned
    risk owner or have overdue mitigation controls."""
    db = SessionLocal()
    try:
        report = compliance.build_iso31000_report(db)
        s = report["summary"]
        lines = [
            f"כיסוי סקרי סיכונים: {s['risk_assessment_coverage_percent']}% "
            f"({s['properties_with_risk_assessment']}/{s['total_properties']})",
            f"ציון סיכון ממוצע: {s['avg_risk_score']}",
            f"נכסים בדירוג סיכון גבוה/קריטי: {s['high_or_critical_risk_count']}",
            f"נכסים ללא בעל אחריות: {s['properties_without_owner_count']}",
            f"בקרות הפחתה באיחור: {s['overdue_controls_count']}/{s['total_controls']}",
        ]
        return "\n".join(lines)
    finally:
        db.close()


@beta_tool
def get_property_compliance(property_id: int) -> str:
    """Returns the compliance detail for one property: risk level, whether
    it has an assigned owner, and its overdue/open control counts."""
    db = SessionLocal()
    try:
        report = compliance.build_iso31000_report(db)
        entry = _find_entry(report, property_id)
        if entry is None:
            return f"לא נמצא נכס עם מזהה {property_id}."
        return (
            f"{entry['name']}: דירוג סיכון={entry['risk_level']}, "
            f"בעל אחריות={entry['risk_owner_name'] or 'לא מוקצה'}, "
            f"בקרות פתוחות={entry['open_controls_count']}, באיחור={entry['overdue_controls_count']}, "
            f"הושלמו={entry['completed_controls_count']}"
        )
    finally:
        db.close()


@beta_tool
def propose_mitigation_task_for_property(property_id: int) -> str:
    """If `property_id` is currently non-compliant (high/critical risk with
    no assigned owner, or overdue mitigation controls), returns a JSON
    mitigation-task proposal for the user to review and confirm. Returns a
    plain message if the property is already compliant."""
    db = SessionLocal()
    try:
        proposal = build_mitigation_task_proposal(db, property_id)
        if proposal is None:
            return f"נכס {property_id} תואם כרגע לדרישות (אין חריגת תאימות לטיפול)."
        return json.dumps(proposal, ensure_ascii=False)
    finally:
        db.close()


ACTION_AGENT_TOOLS = [get_compliance_snapshot, get_property_compliance, propose_mitigation_task_for_property]


def _get_client() -> anthropic.Anthropic:
    return anthropic.Anthropic(api_key=settings.anthropic_api_key or None)


def run_action_agent(message: str, history: list[dict]) -> str:
    """Entry point registered as COMPLIANCE_AGENT in the orchestrator."""
    client = _get_client()
    runner = client.beta.messages.tool_runner(
        model=settings.anthropic_model,
        max_tokens=2048,
        system=SYSTEM_PROMPT,
        tools=ACTION_AGENT_TOOLS,
        messages=[{"role": "user", "content": message}],
    )
    final_text = ""
    for msg in runner:
        for block in msg.content:
            if block.type == "text":
                final_text = block.text
    return final_text or "לא הצלחתי להפיק ניתוח תאימות."


ai_orchestrator.register_agent("COMPLIANCE_AGENT", run_action_agent)
