"""Anthropic Claude integration: incident classification, executive summaries,
and natural-language data Q&A (tool use)."""
from collections.abc import Iterator
from typing import Literal

import anthropic
from anthropic import beta_tool
from pydantic import BaseModel, Field
from sqlalchemy import select

from app import models
from app.config import settings
from app.database import SessionLocal
from app.services import kpi as kpi_service

SYSTEM_CONTEXT = """אתה עוזר AI במערכת RMIS (Risk Management Information System) של חברת נדל"ן/לוגיסטיקה בישראל.
תפקידך לנתח דיווחי אירועי נזק בשפה טבעית ולסווג אותם לשדות מובנים עבור צוות ניהול הסיכונים."""


def get_client() -> anthropic.Anthropic:
    return anthropic.Anthropic(api_key=settings.anthropic_api_key or None)


class IncidentClassification(BaseModel):
    hazard_type: Literal["FLOOD", "FIRE", "STRUCTURAL_FAILURE", "THEFT", "ELECTRICAL", "OTHER"] = Field(
        description="סוג המפגע העיקרי המתואר באירוע"
    )
    severity_level: Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"] = Field(
        description="רמת חומרת הנזק: LOW=נזק נקודתי, MEDIUM=משמעותי אך מוכל, HIGH=נזק נרחב, CRITICAL=סכנת חיים/נזק אסון"
    )
    operational_impact: Literal["FULL_OPERATION", "PARTIAL_SHUTDOWN", "FULL_SHUTDOWN"] = Field(
        description="ההשפעה על המשך הפעילות התפעולית בנכס"
    )
    estimated_loss_ils: int = Field(description="הערכת נזק כספית ראשונית בשקלים, מבוססת על התיאור")
    business_interruption_likely: bool = Field(description="האם צפוי אובדן רווחים/הפסקת פעילות עסקית משמעותית")
    reasoning: str = Field(description="הסבר קצר בעברית לסיווג שבוצע, 1-2 משפטים")
    confidence: float = Field(description="רמת ביטחון בסיווג, בין 0.0 ל-1.0", ge=0.0, le=1.0)


def classify_incident(description: str) -> IncidentClassification:
    client = get_client()
    response = client.messages.parse(
        model=settings.anthropic_model,
        max_tokens=1024,
        system=SYSTEM_CONTEXT,
        messages=[{
            "role": "user",
            "content": (
                "סווג את דיווח האירוע הבא לשדות מובנים. "
                "התבסס רק על מה שמתואר בטקסט, ואם משהו לא ברור - בחר את האפשרות הסבירה ביותר "
                "והפחת את רמת הביטחון בהתאם.\n\n"
                f"תיאור האירוע:\n{description}"
            ),
        }],
        output_format=IncidentClassification,
    )
    return response.parsed_output


# ---------------------------------------------------------------------------
# Executive summary (streaming)
# ---------------------------------------------------------------------------

def stream_executive_summary() -> Iterator[str]:
    """Builds a Hebrew management narrative from live KPI/claims/mitigation data
    and streams the response text as it's generated."""
    db = SessionLocal()
    try:
        summary = kpi_service.get_kpi_summary(db)
        overdue_tasks = db.scalars(
            select(models.MitigationTask).where(models.MitigationTask.status == "OVERDUE")
        ).all()

        data_context = (
            f"TIV (סך שווי מבוטח): {summary.tiv:,.0f} ₪\n"
            f"MFL (חשיפה מקסימלית באשכול גיאוגרפי): {summary.mfl:,.0f} ₪\n"
            f"תביעות פתוחות: {summary.open_claims_count} בסך {summary.open_claims_amount:,.0f} ₪\n"
            f"סכום מאושר הממתין לגבייה: {summary.approved_pending_amount:,.0f} ₪\n"
            f"יחס נזקים (Loss Ratio): {summary.loss_ratio:.1%}\n"
            f"פרמיה שנתית כוללת: {summary.total_annual_premium:,.0f} ₪\n"
            f"מספר משימות הפחתת סיכון באיחור: {len(overdue_tasks)}\n"
        )
        if overdue_tasks:
            data_context += "משימות באיחור: " + "; ".join(t.title for t in overdue_tasks[:5]) + "\n"
    finally:
        db.close()

    client = get_client()
    with client.messages.stream(
        model=settings.anthropic_model,
        max_tokens=2048,
        system=(
            "אתה מנהל סיכונים בכיר הכותב תקציר מנהלים (Executive Summary) בעברית עבור "
            "דירקטוריון החברה. הטקסט צריך להיות מקצועי, תמציתי, מבוסס אך ורק על הנתונים "
            "שסופקו, ולכלול 2-3 המלצות פעולה קונקרטיות. אל תמציא נתונים שלא סופקו."
        ),
        messages=[{
            "role": "user",
            "content": f"להלן נתוני המצב הנוכחי של תיק הנכסים והסיכונים:\n\n{data_context}\n\nכתוב תקציר מנהלים.",
        }],
    ) as stream:
        for text in stream.text_stream:
            yield text


# ---------------------------------------------------------------------------
# Natural-language data Q&A (secure tool use — every tool runs a fixed,
# parameterized query; the model never generates raw SQL)
# ---------------------------------------------------------------------------

@beta_tool
def get_kpis() -> str:
    """Returns the current top-level risk KPIs: TIV, MFL, open claims, loss ratio."""
    db = SessionLocal()
    try:
        s = kpi_service.get_kpi_summary(db)
        return (
            f"TIV={s.tiv:.0f}, MFL={s.mfl:.0f}, open_claims_count={s.open_claims_count}, "
            f"open_claims_amount={s.open_claims_amount:.0f}, "
            f"approved_pending_amount={s.approved_pending_amount:.0f}, "
            f"loss_ratio={s.loss_ratio:.4f}, total_annual_premium={s.total_annual_premium:.0f}"
        )
    finally:
        db.close()


@beta_tool
def query_properties(region: str = "", min_flood_risk: int = 0, min_fire_risk: int = 0) -> str:
    """Query properties, optionally filtered by region (מרכז/צפון/דרום) and/or
    minimum flood or fire risk score (1-5). Returns name, region, risk scores, sprinklers."""
    db = SessionLocal()
    try:
        stmt = select(models.Property, models.AssetRiskProfile).join(
            models.AssetRiskProfile, models.AssetRiskProfile.property_id == models.Property.property_id
        )
        if region:
            stmt = stmt.where(models.Property.region == region)
        if min_flood_risk:
            stmt = stmt.where(models.AssetRiskProfile.flood_risk_score >= min_flood_risk)
        if min_fire_risk:
            stmt = stmt.where(models.AssetRiskProfile.fire_risk_score >= min_fire_risk)
        rows = db.execute(stmt).all()
        if not rows:
            return "לא נמצאו נכסים התואמים את הסינון."
        return "\n".join(
            f"{p.name} ({p.region}): סיכון הצפה={rp.flood_risk_score}, סיכון אש={rp.fire_risk_score}, "
            f"מתזים={'כן' if rp.has_sprinklers else 'לא'}, שווי כינון={p.replacement_value:.0f}"
            for p, rp in rows
        )
    finally:
        db.close()


@beta_tool
def query_claims(status: str = "") -> str:
    """Query insurance claims, optionally filtered by status
    (DRAFT/SUBMITTED/IN_ADJUSTMENT/APPROVED/REJECTED/SETTLED)."""
    db = SessionLocal()
    try:
        stmt = select(models.Claim, models.Incident, models.Property).join(
            models.Incident, models.Incident.incident_id == models.Claim.incident_id
        ).join(models.Property, models.Property.property_id == models.Incident.property_id)
        if status:
            stmt = stmt.where(models.Claim.claim_status == status)
        rows = db.execute(stmt).all()
        if not rows:
            return "לא נמצאו תביעות התואמות את הסינון."
        return "\n".join(
            f"{c.claim_number} ({p.name}, {p.region}): נתבע={c.claimed_amount:.0f}, "
            f"מאושר={c.approved_amount:.0f}, סטטוס={c.claim_status}"
            for c, i, p in rows
        )
    finally:
        db.close()


@beta_tool
def query_incidents(status: str = "", hazard_type: str = "") -> str:
    """Query damage incidents, optionally filtered by status
    (NEW/UNDER_INVESTIGATION/CLAIM_FILED/CLOSED) and/or hazard_type
    (FLOOD/FIRE/STRUCTURAL_FAILURE/THEFT/ELECTRICAL/OTHER)."""
    db = SessionLocal()
    try:
        stmt = select(models.Incident, models.Property).join(
            models.Property, models.Property.property_id == models.Incident.property_id
        )
        if status:
            stmt = stmt.where(models.Incident.status == status)
        if hazard_type:
            stmt = stmt.where(models.Incident.hazard_type == hazard_type)
        rows = db.execute(stmt).all()
        if not rows:
            return "לא נמצאו אירועים התואמים את הסינון."
        return "\n".join(
            f"{i.incident_code} ({p.name}): סוג={i.hazard_type}, חומרה={i.severity_level}, "
            f"סטטוס={i.status}, אומדן נזק={i.initial_estimated_loss:.0f}"
            for i, p in rows
        )
    finally:
        db.close()


@beta_tool
def query_mitigation_tasks(status: str = "") -> str:
    """Query risk mitigation tasks, optionally filtered by status
    (OPEN/IN_PROGRESS/COMPLETED/OVERDUE)."""
    db = SessionLocal()
    try:
        stmt = select(models.MitigationTask, models.Property).join(
            models.Property, models.Property.property_id == models.MitigationTask.property_id
        )
        if status:
            stmt = stmt.where(models.MitigationTask.status == status)
        rows = db.execute(stmt).all()
        if not rows:
            return "לא נמצאו משימות התואמות את הסינון."
        return "\n".join(
            f"{t.title} ({p.name}): עלות={t.cost_estimate:.0f}, חיסכון שנתי צפוי={t.expected_annual_savings:.0f}, "
            f"סטטוס={t.status}, יעד={t.due_date}"
            for t, p in rows
        )
    finally:
        db.close()


ASK_TOOLS = [get_kpis, query_properties, query_claims, query_incidents, query_mitigation_tasks]


def ask_question(question: str) -> str:
    client = get_client()
    runner = client.beta.messages.tool_runner(
        model=settings.anthropic_model,
        max_tokens=2048,
        system=(
            "אתה עוזר נתונים למנהל סיכונים. ענה על שאלות אך ורק על סמך תוצאות הכלים שברשותך - "
            "אל תמציא נתונים. אם השאלה לא קשורה לנתוני הנכסים/סיכונים/תביעות, הסבר שאתה יכול "
            "לענות רק על שאלות בנושא זה. ענה בעברית, בתמציתיות ובבהירות."
        ),
        tools=ASK_TOOLS,
        messages=[{"role": "user", "content": question}],
    )
    final_text = ""
    for message in runner:
        for block in message.content:
            if block.type == "text":
                final_text = block.text
    return final_text or "לא הצלחתי לענות על השאלה."
