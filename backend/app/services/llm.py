"""Anthropic Claude integration: incident classification, executive summaries,
natural-language data Q&A (tool use), and email thread summarization/reply
drafting (TODO_SPEC.md "משימה 15")."""
import html as html_lib
from collections.abc import Iterator
from typing import Literal

import anthropic
import bleach
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


# ---------------------------------------------------------------------------
# Email thread summarization + reply drafting (TODO_SPEC.md "משימה 15")
#
# Privacy (spec step 5): both functions below take only `messages: list[dict]`
# — plain data the *caller* (routers/emails.py) builds from exactly one
# thread's own Email rows, already scoped to what the requesting user is
# allowed to see (see routers/emails.py's `_thread_messages_for_ai`). Nothing
# here queries the DB, calls kpi_service, or otherwise reaches for
# system-wide context the way ASK_TOOLS above deliberately does for the
# broader Q&A feature — this is a narrow, single-thread operation only.
# ---------------------------------------------------------------------------

EMAIL_AI_SYSTEM_CONTEXT = (
    "אתה עוזר AI במערכת RMIS (Risk Management Information System) המסייע לעובד לנהל "
    "תכתובת דוא\"ל פנימית בעברית. אתה רואה אך ורק את הודעות שרשור הדוא\"ל הספציפי "
    "שסופק לך בהודעת המשתמש - אין לך גישה לנתונים נוספים כלשהם במערכת (לא לנכסים, "
    "לא לתביעות, לא לשרשורים אחרים). ענה תמיד בעברית."
)


def _strip_html_to_plain_text(body_html: str) -> str:
    """Strips all markup down to plain text before it ever becomes prompt
    content (spec step 5: "don't send raw HTML/markup as prompt content").
    Reuses the same bleach tag-stripping already used to sanitize
    Email.body_html (see services/email.py's sanitize_body_html) but with an
    empty tag allowlist, so every tag is removed rather than a safe subset
    kept; html.unescape resolves any leftover entities (e.g. &amp;) back to
    plain characters."""
    return html_lib.unescape(bleach.clean(body_html, tags=[], attributes={}, strip=True)).strip()


def _format_thread_for_prompt(messages: list[dict]) -> str:
    """Renders `messages` (each a {"sender": str, "created_at": str,
    "body_html": str} dict for one message in the thread, oldest first) into
    a plain-text transcript for the prompt. Purely a formatting/stripping
    step over what's already been passed in - see this section's module
    docstring for why the DB-querying/access-scoping happens one layer up,
    in routers/emails.py, not here."""
    blocks = []
    for m in messages:
        sender = m.get("sender", "")
        created_at = m.get("created_at", "")
        body = _strip_html_to_plain_text(m.get("body_html", ""))
        blocks.append(f"מאת: {sender} | {created_at}\n{body}")
    return "\n\n---\n\n".join(blocks)


def summarize_email_thread(messages: list[dict]) -> str:
    """Returns a Hebrew executive summary (spec: 3 sentences or fewer) of the
    given thread messages. `messages` must be exactly this thread's own
    messages - see this section's module docstring."""
    transcript = _format_thread_for_prompt(messages)
    client = get_client()
    response = client.messages.create(
        model=settings.anthropic_model,
        max_tokens=512,
        system=EMAIL_AI_SYSTEM_CONTEXT,
        messages=[{
            "role": "user",
            "content": (
                "להלן שרשור הודעות דוא\"ל. סכם אותו בעברית בשלושה משפטים לכל היותר - "
                "תמציתי וממוקד בנושא הפנייה, בהחלטות/בקשות המרכזיות ובסטטוס הנוכחי. "
                "אל תמציא פרטים שלא מופיעים בשרשור.\n\n"
                f"{transcript}"
            ),
        }],
    )
    return next((block.text for block in response.content if block.type == "text"), "").strip()


def suggest_email_reply(messages: list[dict]) -> str:
    """Drafts a professional Hebrew reply based on the thread (particularly
    its last message), returned as plain text - the same shape
    EmailComposeModal.tsx's body TextField/`initialBody` prop already expects
    (see that component's module docstring: `initialBody` is plain text, and
    `plainTextToHtml` wraps it into `<p>...</p>` only at send time), so the
    frontend can drop this straight into a reply-mode compose without any
    HTML round-trip. `messages` must be exactly this thread's own messages -
    see this section's module docstring. Never sent automatically - the
    frontend always opens this pre-filled but editable (spec step 4)."""
    transcript = _format_thread_for_prompt(messages)
    client = get_client()
    response = client.messages.create(
        model=settings.anthropic_model,
        max_tokens=1024,
        system=EMAIL_AI_SYSTEM_CONTEXT,
        messages=[{
            "role": "user",
            "content": (
                "להלן שרשור הודעות דוא\"ל. נסח טיוטת תגובה מקצועית בעברית להודעה האחרונה "
                "בשרשור, בטון עסקי ומנומס, המתייחסת לתוכן השרשור בפועל. "
                "החזר טקסט רגיל בלבד - ללא כותרות, ללא תגי HTML, וללא חתימה (החתימה "
                "האישית של המשתמש מתווספת אוטומטית בעורך הדוא\"ל). אפשר להפריד בין "
                "פסקאות בשורה ריקה.\n\n"
                f"{transcript}"
            ),
        }],
    )
    return next((block.text for block in response.content if block.type == "text"), "").strip()
