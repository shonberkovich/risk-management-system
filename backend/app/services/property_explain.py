""""הסבר לי את הנכס" — a short (3-4 sentence) Hebrew analysis of one property,
streamed (POST /api/ai/properties/{property_id}/explain in routers/ai.py).

Latency is the point of the design: the whole context is gathered here in one
pass of a few cheap DB reads, rendered as compact text, and sent in a single
streamed model call. No tool loop, so the first words arrive after one model
round trip (about a second).

The context covers only the one property: its row and risk profile, its
composite risk score (kpi.calculate_property_risk_score) and how it ranks in
the portfolio, recent incidents and claims, open mitigation tasks with their
ROI (kpi.calculate_mitigation_roi), and, for compliance roles, its
compliance status.

Role gating mirrors what the rest of the app shows each role:
- Money figures that only financial endpoints disclose (claim amounts,
  incident loss estimates, mitigation cost/savings/ROI) are included only for
  ai_orchestrator.FINANCIAL_READ_ROLES, the same set routers/ai.py and
  routers/analytics.py gate on. Other roles (FIELD_WORKER) get the same
  analysis without them.
- Replacement value, MFL and the active policy's limit are shown on
  PropertyDetail to every role (GET /api/properties/{id} is open), so they are
  included for everyone.
- Compliance status follows ai_orchestrator.COMPLIANCE_ROLES (routers/compliance.py).
"""
from __future__ import annotations

from collections.abc import Iterator
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app import models
from app.config import settings
from app.services import kpi, llm
from app.services.ai_orchestrator import COMPLIANCE_ROLES, FINANCIAL_READ_ROLES

# Enough history to explain the score without bloating the prompt.
_MAX_INCIDENTS = 5
_MAX_CLAIMS = 5
_MAX_TASKS = 4
_MAX_DESCRIPTION_CHARS = 90
# ~90 Hebrew words come to ~200-300 output tokens; the cap only stops runaways.
_MAX_TOKENS = 600

_HAZARDS = {
    "FLOOD": "הצפה", "FIRE": "שריפה", "STRUCTURAL_FAILURE": "כשל מבני",
    "THEFT": "פריצה", "ELECTRICAL": "תקלת חשמל", "OTHER": "אחר",
}
_SEVERITIES = {"LOW": "נמוכה", "MEDIUM": "בינונית", "HIGH": "גבוהה", "CRITICAL": "קריטית"}
_INCIDENT_STATUSES = {
    "NEW": "חדש", "UNDER_INVESTIGATION": "בבירור", "CLAIM_FILED": "הוגשה תביעה", "CLOSED": "סגור",
}
_CLAIM_STATUSES = {
    "DRAFT": "טיוטה", "SUBMITTED": "הוגשה", "IN_ADJUSTMENT": "בשמאות", "APPROVED": "אושרה",
    "REJECTED": "נדחתה", "SETTLED": "סולקה",
}
_TASK_STATUSES = {"OPEN": "פתוחה", "IN_PROGRESS": "בביצוע", "OVERDUE": "באיחור"}
_ASSET_TYPES = {
    "LOGISTICS_CENTER": "מרכז לוגיסטי", "OFFICE_BUILDING": "מבנה משרדים",
    "RETAIL": "מסחרי", "INFRASTRUCTURE": "תשתית",
}

SYSTEM_PROMPT = """אתה אנליסט סיכונים בכיר במערכת RMIS. כתוב ניתוח של נכס אחד בעברית: פסקה אחת של 3-4 משפטים קצרים, עד כ-90 מילים בסך הכול, בלי כותרות, רשימות או Markdown.
כסה בדיוק שלושה דברים: (1) למה ציון הסיכון של הנכס הוא מה שהוא - המרכיב או שניים שמשפיעים עליו יותר מכול; (2) האירועים והתביעות המשמעותיים, בסיכום ולא אחד-אחד; (3) פעולה אחת או שתיים בעלות הערך הגבוה ביותר (למשל משימת הפחתת סיכון והתשואה שלה).
התבסס אך ורק על הנתונים שסופקו. אל תמציא נתונים ואל תציין סכומים שלא מופיעים בהם."""

_NO_FINANCIAL_NOTE = (
    "סכומי תביעות, אומדני נזק ועלויות/תשואת משימות הושמטו בהתאם להרשאות המשתמש - "
    "אל תציין שהם חסרים, פשוט נתח את השאר."
)


def _ils(amount) -> str:
    return f"{float(amount):,.0f} ₪"


def _risk_level(score: float) -> str:
    # Same bands as services/compliance._risk_level.
    if score >= 75:
        return "קריטי"
    if score >= 50:
        return "גבוה"
    if score >= 25:
        return "בינוני"
    return "נמוך"


def _portfolio_rank(db: Session, property_id: int, score: float) -> str:
    """Where this property's score sits among the active portfolio's scores."""
    profiles = db.scalars(
        select(models.AssetRiskProfile)
        .join(models.Property, models.Property.property_id == models.AssetRiskProfile.property_id)
        .where(models.Property.is_active == True)  # noqa: E712
    ).all()
    scores = [kpi.calculate_property_risk_score(p) for p in profiles if p.property_id != property_id]
    if not scores:
        return ""
    rank = 1 + sum(1 for s in scores if s > score)
    avg = sum(scores + [score]) / (len(scores) + 1)
    return f"; מקום {rank} מתוך {len(scores) + 1} נכסים בתיק (ממוצע התיק {avg:.1f})"


def _risk_lines(db: Session, prop: models.Property) -> list[str]:
    profile = prop.risk_profile
    if profile is None:
        return ["סקר סיכונים: טרם נערך - אין ציון סיכון מחושב."]
    score = kpi.calculate_property_risk_score(profile)
    sprinklers = "יש מתזים (הפחתה של 20% בציון)" if profile.has_sprinklers else "אין מתזים (ללא הפחתת 20%)"
    lines = [
        f"ציון סיכון מרוכב: {score:.1f}/100, רמה {_risk_level(score)}{_portfolio_rank(db, prop.property_id, score)}.",
        f"מרכיבי הציון (1-5): הצפה {profile.flood_risk_score} (משקל 35%), שריפה {profile.fire_risk_score} "
        f"(משקל 40%), רעידת אדמה {profile.earthquake_risk_score} (משקל 25%); {sprinklers}.",
        f"סקר אחרון: {profile.survey_date.isoformat()}; MFL: {_ils(profile.mfl_amount)}"
        + ("; בקרבת אתר חומרים מסוכנים" if profile.near_hazmat_site else "") + ".",
    ]
    if profile.notes:
        lines.append(f"הערות הסקר: {profile.notes.strip()[:_MAX_DESCRIPTION_CHARS * 2]}")
    return lines


def _incident_lines(incidents: list[models.Incident], financial: bool) -> list[str]:
    if not incidents:
        return ["אירועי נזק: אין."]
    open_count = sum(1 for i in incidents if i.status in kpi.OPEN_INCIDENT_STATUSES)
    lines = [f"אירועי נזק: {len(incidents)} בסך הכול, {open_count} פתוחים. האחרונים:"]
    for i in incidents[:_MAX_INCIDENTS]:
        desc = " ".join(i.description.split())[:_MAX_DESCRIPTION_CHARS]
        loss = f", אומדן נזק {_ils(i.initial_estimated_loss)}" if financial else ""
        lines.append(
            f"- {i.incident_code} ({i.incident_timestamp.date().isoformat()}): "
            f"{_HAZARDS.get(i.hazard_type, i.hazard_type)}, חומרה {_SEVERITIES.get(i.severity_level, i.severity_level)}, "
            f"{_INCIDENT_STATUSES.get(i.status, i.status)}{loss}. {desc}"
        )
    return lines


def _claim_lines(claims: list[tuple[models.Claim, str]], financial: bool) -> list[str]:
    if not claims:
        return ["תביעות ביטוח: אין."]
    header = f"תביעות ביטוח: {len(claims)}"
    if financial:
        header += (
            f", סך נתבע {_ils(sum(float(c.claimed_amount) for c, _ in claims))}, "
            f"סך מאושר {_ils(sum(float(c.approved_amount) for c, _ in claims))}"
        )
    lines = [header + ". האחרונות:"]
    for c, incident_code in claims[:_MAX_CLAIMS]:
        amounts = f", נתבע {_ils(c.claimed_amount)}, מאושר {_ils(c.approved_amount)}" if financial else ""
        lines.append(f"- {c.claim_number} (אירוע {incident_code}): {_CLAIM_STATUSES.get(c.claim_status, c.claim_status)}{amounts}")
    return lines


def _task_lines(tasks: list[models.MitigationTask], financial: bool) -> list[str]:
    if not tasks:
        return ["משימות הפחתת סיכון פתוחות: אין."]
    if financial:  # most valuable first, so the model's "best action" is on top
        tasks = sorted(tasks, key=lambda t: -(kpi.calculate_mitigation_roi(t) or 0))
    lines = [f"משימות הפחתת סיכון פתוחות: {len(tasks)}"]
    for t in tasks[:_MAX_TASKS]:
        money = ""
        if financial:
            roi = kpi.calculate_mitigation_roi(t)
            money = (
                f", עלות {_ils(t.cost_estimate)}, חיסכון שנתי צפוי {_ils(t.expected_annual_savings)}"
                + (f", ROI {roi:.0f}%" if roi is not None else "")
            )
        lines.append(f"- {t.title}: {_TASK_STATUSES.get(t.status, t.status)}, יעד {t.due_date.isoformat()}{money}")
    return lines


def _compliance_line(prop: models.Property, overdue_tasks: int, today: date) -> str:
    """Same per-property rule as action_agent.build_mitigation_task_proposal /
    compliance.build_iso31000_report, computed for one property directly."""
    profile = prop.risk_profile
    if profile is None:
        return "תאימות ISO 31000: חסר סקר סיכונים."
    level = _risk_level(kpi.calculate_property_risk_score(profile))
    gaps = []
    if level in ("גבוה", "קריטי") and prop.primary_manager_id is None:
        gaps.append("אין בעל אחריות לנכס בסיכון גבוה")
    if level in ("גבוה", "קריטי") and overdue_tasks:
        gaps.append(f"{overdue_tasks} בקרות באיחור")
    months = (today.year - profile.survey_date.year) * 12 + (today.month - profile.survey_date.month)
    if months > 12:
        gaps.append(f"הסקר בן {months} חודשים (מעל 12)")
    return "תאימות ISO 31000: " + ("חריגה - " + "; ".join(gaps) if gaps else "תקין") + "."


def build_property_context(db: Session, property_id: int, role: str | None) -> str | None:
    """The prompt's data block for one property, or None if it doesn't exist."""
    prop = db.scalar(
        select(models.Property)
        .options(
            joinedload(models.Property.risk_profile),
            joinedload(models.Property.primary_manager),
            joinedload(models.Property.policy_assets).joinedload(models.PolicyAsset.policy),
        )
        .where(models.Property.property_id == property_id)
    )
    if prop is None:
        return None
    financial = role in FINANCIAL_READ_ROLES

    incidents = db.scalars(
        select(models.Incident)
        .where(models.Incident.property_id == property_id, models.Incident.is_draft == False)  # noqa: E712
        .order_by(models.Incident.incident_timestamp.desc())
    ).all()
    claims = db.execute(
        select(models.Claim, models.Incident.incident_code)
        .join(models.Incident, models.Incident.incident_id == models.Claim.incident_id)
        .where(models.Incident.property_id == property_id)
        .order_by(models.Incident.incident_timestamp.desc(), models.Claim.claim_id.desc())
    ).all()
    open_tasks = db.scalars(
        select(models.MitigationTask)
        .where(models.MitigationTask.property_id == property_id, models.MitigationTask.status != "COMPLETED")
        .order_by(models.MitigationTask.due_date)
    ).all()

    active = [pa for pa in prop.policy_assets if pa.policy.status == "ACTIVE"]
    policy = max(active, key=lambda pa: pa.policy.end_date, default=None)
    lines = [
        f"נכס: {prop.name} ({prop.property_code}), {_ASSET_TYPES.get(prop.asset_type, prop.asset_type)}, "
        f"אזור {prop.region}{'' if prop.is_active else ', מושבת'}.",
        f"שווי כינון: {_ils(prop.replacement_value)}; מנהל אחראי: "
        f"{prop.primary_manager.full_name if prop.primary_manager else 'לא שויך'}.",
        (
            f"פוליסה פעילה: {policy.policy.policy_number} ({policy.policy.insurer_name}), "
            f"גבול כיסוי {_ils(policy.policy.total_limit)}."
            if policy else "פוליסה פעילה: אין."
        ),
        *_risk_lines(db, prop),
        *_incident_lines(list(incidents), financial),
        *_claim_lines(list(claims), financial),
        *_task_lines(list(open_tasks), financial),
    ]
    if role in COMPLIANCE_ROLES:
        overdue = sum(1 for t in open_tasks if t.status == "OVERDUE")
        lines.append(_compliance_line(prop, overdue, date.today()))
    if not financial:
        lines.append(_NO_FINANCIAL_NOTE)
    return "\n".join(lines)


def stream_property_explanation(context: str) -> Iterator[str]:
    """Streams the analysis text for an already-built context."""
    with llm.get_client().messages.stream(
        model=settings.anthropic_model,
        output_config={"effort": settings.anthropic_effort},
        max_tokens=_MAX_TOKENS,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": f"נתוני הנכס:\n{context}\n\nכתוב את הניתוח."}],
    ) as stream:
        yield from stream.text_stream
