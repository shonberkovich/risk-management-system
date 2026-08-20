"""Multi-framework compliance report: risk mapping, risk/control ownership, and control
status, built entirely from data already in the schema (Properties, Asset_Risk_
Profiles, Mitigation_Tasks, Users, Role_Permissions, Financial_Statements) — no new
tables. Pure calculation layer, no LLM calls (mirrors kpi.py / notifications.py).

Covers three frameworks in one report, each mapped to concrete, computed metrics
already available in this system — `framework_sections` tags every entry with which
`standard` it belongs to:

ISO 31000:2018 describes a risk management *process* (clause 6), not a checklist of
documents to produce, so "compliance" here doesn't mean a pass/fail against a fixed
questionnaire — it means: for each process step, can this system show the artifact
that step requires, and how complete is it?

  6.4.2 Risk identification  -> % of active properties with a Asset_Risk_Profiles row
  6.4.3 Risk analysis        -> composite risk score computed for every assessed property
                                 (kpi.calculate_property_risk_score)
  6.4.4 Risk evaluation      -> % of high/critical-risk properties with an assigned
                                 risk owner (Properties.primary_manager_id) to act on the evaluation
  6.5   Risk treatment       -> % of open/overdue Mitigation_Tasks that are actually
                                 completed (a treatment plan that's never executed isn't treatment)
  6.6   Monitoring & review  -> % of risk assessments surveyed within the last 12 months
                                 (Asset_Risk_Profiles.survey_date) — a stale survey is a process gap
                                 even if the number on file looks fine

Solvency II — Pillar II (System of Governance, Art. 41-49) covers the *organizational*
side of risk management that Pillar I's capital-adequacy numbers (see
services/financials.py::build_regulatory_report — the Solvency-ratio-style disclosure,
deliberately kept separate from this module since it's a single financial-statement
calculation, not a process-maturity mapping) don't speak to:

  SII-44 Risk management function -> is there an active user actually holding the
                                      RISK_MANAGER/RISK_OFFICER role (Art. 44's named,
                                      accountable risk-management function)?
  SII-45 Own risk & solvency assessment (ORSA) -> reuses the same "surveyed within 12
                                      months" recency metric as ISO 6.6 — ORSA's defining
                                      requirement is exactly that periodic reassessment
                                      cadence, so the same underlying evidence satisfies
                                      both frameworks' equivalent clause (this is how real
                                      compliance mapping usually works: one control, many
                                      frameworks).

הנחיות שוק ההון (Israeli Capital Market, Insurance and Savings Authority — the local
regulator Solvency II's regime is modeled on for insurers) — mapped to its two most
concrete, checkable requirements for this system's scope:

  CMA-3 Risk ownership          -> reuses the same high/critical-risk-with-an-assigned-
                                    owner metric as ISO 6.4.4, under the Authority's own
                                    "risk owner" language.
  CMA-7 Capital disclosure readiness -> can the org actually produce a capital-adequacy
                                    disclosure right now? i.e. does at least one
                                    Financial_Statements row exist for
                                    financials.build_regulatory_report to run against.

Each section's status (מיושם / מיושם חלקית / לא מיושם) is a simple threshold on that
metric (>=90% / >=50% / below), not a legal or audit judgment — this is a course-project
approximation of what an auditor would otherwise assess manually, in the same spirit as
economics.py's simulated index or gis.py's simulated flood-zone lookup: it demonstrates
the shape of the analysis a real multi-framework compliance tool would produce, without
claiming to replace a certified auditor's or actuary's judgment. Deliberately out of
scope for the same reason: Solvency II Pillar III (quantitative reporting templates /
QRTs) and any binding legal interpretation of the Capital Market Authority's circulars —
both would require a real compliance/actuarial function to sign off on, not a computed
threshold.

Nothing here writes back to the DB — this is a read-only report, same as
economics.fetch_replacement_value_updates and gis.fetch_risk_layers.
"""
from datetime import date, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import models
from app.services.kpi import calculate_mitigation_roi, calculate_property_risk_score

_REVIEW_RECENCY_MONTHS = 12
_SECTION_FULL_THRESHOLD = 90.0
_SECTION_PARTIAL_THRESHOLD = 50.0


def _risk_level(score: float | None) -> str:
    if score is None:
        return "לא הוערך"
    if score >= 75:
        return "קריטי"
    if score >= 50:
        return "גבוה"
    if score >= 25:
        return "בינוני"
    return "נמוך"


def _section_status(metric_percent: float) -> str:
    if metric_percent >= _SECTION_FULL_THRESHOLD:
        return "מיושם"
    if metric_percent >= _SECTION_PARTIAL_THRESHOLD:
        return "מיושם חלקית"
    return "לא מיושם"


def _months_since(d: date, today: date) -> int:
    return (today.year - d.year) * 12 + (today.month - d.month)


def _solvency_ii_pillar2_sections(
    db: Session,
    users_by_id: dict[int, "models.User"],
    review_recency_percent: float,
    reviewed_recently_count: int,
    assessed_count: int,
) -> list[dict]:
    """Solvency II Pillar II (System of Governance) — see module docstring for the mapping."""
    standard = "Solvency II — Pillar II (מבנה ממשל תאגידי)"

    risk_function_active = any(
        u.is_active and u.role in ("RISK_MANAGER", "RISK_OFFICER") for u in users_by_id.values()
    )
    risk_function_percent = 100.0 if risk_function_active else 0.0

    return [
        {
            "standard": standard,
            "clause": "SII-44",
            "title": "פונקציית ניהול סיכונים (Risk Management Function)",
            "description": "קיים בעל תפקיד פעיל (RISK_MANAGER/RISK_OFFICER) האחראי על פונקציית ניהול הסיכונים בארגון, כנדרש בסעיף 44 ל-Solvency II.",
            "status": _section_status(risk_function_percent),
            "metric_label": "פונקציית ניהול סיכונים מאוישת ופעילה",
            "metric_value": "כן" if risk_function_active else "לא",
        },
        {
            "standard": standard,
            "clause": "SII-45",
            "title": "הערכת סיכונים וסולבנסי עצמית (ORSA)",
            "description": "סקרי הסיכונים הקיימים מתעדכנים באופן תקופתי — אותה תדירות עדכון שסעיף ה-ORSA דורש להערכת הסיכונים והסולבנסי העצמית.",
            "status": _section_status(review_recency_percent),
            "metric_label": "עדכניות הערכת סיכונים עצמית (מקביל ל-ORSA)",
            "metric_value": f"{review_recency_percent}% ({reviewed_recently_count}/{assessed_count})" if assessed_count else "אין סקרים",
        },
    ]


def _capital_market_authority_sections(
    db: Session,
    evaluation_percent: float,
    high_risk_with_owner: int,
    high_risk_properties: list[dict],
) -> list[dict]:
    """הנחיות רשות שוק ההון, ביטוח וחיסכון — see module docstring for the mapping."""
    standard = "רשות שוק ההון, ביטוח וחיסכון — חוזר ניהול סיכונים"

    has_financial_statement = (
        db.scalars(select(models.FinancialStatement.statement_id).limit(1)).first() is not None
    )
    capital_disclosure_percent = 100.0 if has_financial_statement else 0.0

    return [
        {
            "standard": standard,
            "clause": "CMA-3",
            "title": "הקצאת בעלי אחריות לניהול סיכונים",
            "description": "לכל נכס בדירוג סיכון גבוה/קריטי מוקצה בעל אחריות מזוהה, כנדרש בחוזרי ניהול הסיכונים של רשות שוק ההון לגופים מוסדיים.",
            "status": _section_status(evaluation_percent),
            "metric_label": "נכסי סיכון גבוה/קריטי עם בעל אחריות מוקצה",
            "metric_value": f"{evaluation_percent}% ({high_risk_with_owner}/{len(high_risk_properties)})",
        },
        {
            "standard": standard,
            "clause": "CMA-7",
            "title": "מוכנות לדיווח הלימות הון לדירקטוריון",
            "description": "קיים לפחות דוח כספי שנתי אחד (Financial_Statements) שממנו ניתן להפיק דוח הלימות הון/סולבנסי (services/financials.py::build_regulatory_report) לצורך דיווח לדירקטוריון.",
            "status": _section_status(capital_disclosure_percent),
            "metric_label": "זמינות דוח הלימות הון",
            "metric_value": "זמין" if has_financial_statement else "אין נתונים כספיים",
        },
    ]


def build_iso31000_report(db: Session) -> dict:
    today = date.today()

    properties = db.scalars(
        select(models.Property).where(models.Property.is_active == True)  # noqa: E712
    ).all()
    users_by_id = {u.user_id: u for u in db.scalars(select(models.User)).all()}
    tasks_by_property: dict[int, list[models.MitigationTask]] = {}
    for task in db.scalars(select(models.MitigationTask)).all():
        tasks_by_property.setdefault(task.property_id, []).append(task)

    entries: list[dict] = []
    total_controls = open_controls = overdue_controls = completed_controls = 0
    scored_count = 0
    score_sum = 0.0
    high_or_critical_count = 0
    without_owner_count = 0
    assessed_count = 0
    reviewed_recently_count = 0

    for prop in properties:
        owner = users_by_id.get(prop.primary_manager_id) if prop.primary_manager_id else None
        if owner is None:
            without_owner_count += 1

        profile = prop.risk_profile
        score = calculate_property_risk_score(profile) if profile else None
        level = _risk_level(score)
        if level in ("גבוה", "קריטי"):
            high_or_critical_count += 1
        if score is not None:
            scored_count += 1
            score_sum += score
        if profile is not None:
            assessed_count += 1
            if _months_since(profile.survey_date, today) <= _REVIEW_RECENCY_MONTHS:
                reviewed_recently_count += 1

        controls_out = []
        prop_open = prop_overdue = prop_completed = 0
        for task in sorted(tasks_by_property.get(prop.property_id, []), key=lambda t: t.due_date):
            # Read-only view of stored status, matching mitigation.py's own display
            # logic — this report doesn't re-run the OVERDUE auto-sync (a write), so
            # a task whose due_date has just passed may still show its last-synced
            # status until next touched via /api/mitigation-tasks.
            if task.status == "COMPLETED":
                prop_completed += 1
            elif task.status == "OVERDUE":
                prop_overdue += 1
            else:
                prop_open += 1
            task_owner = users_by_id.get(task.assigned_to_user_id) if task.assigned_to_user_id else None
            controls_out.append({
                "task_id": task.task_id,
                "title": task.title,
                "status": task.status,
                "due_date": task.due_date.isoformat(),
                "owner_name": task_owner.full_name if task_owner else None,
                "cost_estimate": float(task.cost_estimate),
                "roi_percent": calculate_mitigation_roi(task),
            })
        total_controls += len(controls_out)
        open_controls += prop_open
        overdue_controls += prop_overdue
        completed_controls += prop_completed

        entries.append({
            "property_id": prop.property_id,
            "property_code": prop.property_code,
            "name": prop.name,
            "region": prop.region,
            "risk_owner_name": owner.full_name if owner else None,
            "has_risk_assessment": profile is not None,
            "last_reviewed": profile.survey_date.isoformat() if profile else None,
            "flood_risk_score": profile.flood_risk_score if profile else None,
            "fire_risk_score": profile.fire_risk_score if profile else None,
            "earthquake_risk_score": profile.earthquake_risk_score if profile else None,
            "risk_score": score,
            "risk_level": level,
            "mfl_amount": float(profile.mfl_amount) if profile else None,
            "controls": controls_out,
            "open_controls_count": prop_open,
            "overdue_controls_count": prop_overdue,
            "completed_controls_count": prop_completed,
        })

    # Sort worst-first: unassessed/critical/high risk surfaces before low risk,
    # same "most-actionable-first" ordering convention as kpi.calculate_alerts.
    risk_order = {"קריטי": 0, "גבוה": 1, "בינוני": 2, "נמוך": 3, "לא הוערך": 4}
    entries.sort(key=lambda e: (risk_order[e["risk_level"]], e["property_code"]))

    total_properties = len(properties)
    coverage_percent = round((assessed_count / total_properties * 100) if total_properties else 0.0, 1)
    avg_score = round(score_sum / scored_count, 1) if scored_count else None
    control_completion_percent = round(
        (completed_controls / total_controls * 100) if total_controls else 0.0, 1
    )
    high_risk_properties = [e for e in entries if e["risk_level"] in ("גבוה", "קריטי")]
    high_risk_with_owner = sum(1 for e in high_risk_properties if e["risk_owner_name"] is not None)
    evaluation_percent = round(
        (high_risk_with_owner / len(high_risk_properties) * 100) if high_risk_properties else 100.0, 1
    )
    review_recency_percent = round(
        (reviewed_recently_count / assessed_count * 100) if assessed_count else 0.0, 1
    )

    _ISO = "ISO 31000:2018"
    framework_sections = [
        {
            "standard": _ISO,
            "clause": "6.4.2",
            "title": "זיהוי סיכונים (Risk Identification)",
            "description": "לכל נכס פעיל קיים סקר סיכונים (Asset_Risk_Profiles) המתעד חשיפה להצפה, שריפה ורעידת אדמה.",
            "status": _section_status(coverage_percent),
            "metric_label": "כיסוי סקרי סיכונים",
            "metric_value": f"{coverage_percent}% ({assessed_count}/{total_properties})",
        },
        {
            "standard": _ISO,
            "clause": "6.4.3",
            "title": "ניתוח סיכונים (Risk Analysis)",
            "description": "לכל נכס שנסקר מחושב ציון סיכון מרוכב (0-100) לפי חומרת חשיפה למפגעים והתקנת אמצעי מיגון.",
            "status": _section_status(coverage_percent),
            "metric_label": "ציון סיכון ממוצע בתיק",
            "metric_value": f"{avg_score}" if avg_score is not None else "אין נתונים",
        },
        {
            "standard": _ISO,
            "clause": "6.4.4",
            "title": "הערכת סיכונים (Risk Evaluation)",
            "description": "לכל נכס בדירוג סיכון גבוה/קריטי מוקצה בעל אחריות (מנהל נכס ראשי) לקבלת החלטות טיפול.",
            "status": _section_status(evaluation_percent),
            "metric_label": "נכסי סיכון גבוה/קריטי עם בעל אחריות מוקצה",
            "metric_value": f"{evaluation_percent}% ({high_risk_with_owner}/{len(high_risk_properties)})",
        },
        {
            "standard": _ISO,
            "clause": "6.5",
            "title": "טיפול בסיכונים (Risk Treatment)",
            "description": "משימות הפחתת סיכון (Mitigation_Tasks) שנפתחו עבור נכסים בסיכון מסתיימות בפועל ולא נותרות פתוחות/באיחור ללא הגבלת זמן.",
            "status": _section_status(control_completion_percent),
            "metric_label": "שיעור השלמת בקרות הפחתה",
            "metric_value": f"{control_completion_percent}% ({completed_controls}/{total_controls})",
        },
        {
            "standard": _ISO,
            "clause": "6.6",
            "title": "ניטור וסקירה (Monitoring & Review)",
            "description": "סקרי סיכונים קיימים מתעדכנים בתדירות סבירה (עד 12 חודשים) ולא נותרים בלתי-מעודכנים.",
            "status": _section_status(review_recency_percent),
            "metric_label": "סקרים שעודכנו ב-12 החודשים האחרונים",
            "metric_value": f"{review_recency_percent}% ({reviewed_recently_count}/{assessed_count})" if assessed_count else "אין סקרים",
        },
        *_solvency_ii_pillar2_sections(db, users_by_id, review_recency_percent, reviewed_recently_count, assessed_count),
        *_capital_market_authority_sections(
            db, evaluation_percent, high_risk_with_owner, high_risk_properties
        ),
    ]

    return {
        "generated_at": datetime.now().isoformat(),
        "standard": "ISO 31000:2018 + Solvency II (Pillar II) + חוזר ניהול סיכונים (רשות שוק ההון)",
        "summary": {
            "total_properties": total_properties,
            "properties_with_risk_assessment": assessed_count,
            "risk_assessment_coverage_percent": coverage_percent,
            "avg_risk_score": avg_score,
            "high_or_critical_risk_count": high_or_critical_count,
            "properties_without_owner_count": without_owner_count,
            "total_controls": total_controls,
            "open_controls_count": open_controls,
            "overdue_controls_count": overdue_controls,
            "completed_controls_count": completed_controls,
            "control_completion_percent": control_completion_percent,
        },
        "framework_sections": framework_sections,
        "entries": entries,
    }
