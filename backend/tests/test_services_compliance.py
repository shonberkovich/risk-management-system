"""Unit tests for app/services/compliance.py — risk-level bands, section-status
thresholds, and the per-property mitigation-controls breakdown that
test_api_compliance.py (framework-section assertions) doesn't exercise directly.
Previously uncovered (TODO_SPEC.md §9, "בדיקות Backend")."""
from datetime import date

from app.services import compliance


def test_risk_level_bands(db, make_property, make_risk_profile):
    # קריטי (>=75)
    critical = make_property(property_code="P-CRIT")
    make_risk_profile(critical.property_id, flood_risk_score=5, fire_risk_score=5, earthquake_risk_score=5)
    # גבוה (50-74): raw = 3*0.35+3*0.40+3*0.25 = 3 -> score 60
    high = make_property(property_code="P-HIGH")
    make_risk_profile(high.property_id, flood_risk_score=3, fire_risk_score=3, earthquake_risk_score=3)
    # נמוך (<25): raw = 1 -> score 20
    low = make_property(property_code="P-LOW")
    make_risk_profile(low.property_id, flood_risk_score=1, fire_risk_score=1, earthquake_risk_score=1)

    report = compliance.build_iso31000_report(db)
    levels = {e["property_code"]: e["risk_level"] for e in report["entries"]}
    assert levels["P-CRIT"] == "קריטי"
    assert levels["P-HIGH"] == "גבוה"
    assert levels["P-LOW"] == "נמוך"


def test_property_without_risk_profile_is_not_evaluated(db, make_property):
    make_property()
    report = compliance.build_iso31000_report(db)
    assert report["entries"][0]["risk_level"] == "לא הוערך"
    assert report["entries"][0]["risk_score"] is None
    assert report["summary"]["properties_with_risk_assessment"] == 0


def test_section_status_reports_not_implemented_below_partial_threshold(db, make_property):
    # No risk assessments at all on any active property -> 0% coverage -> "לא מיושם".
    make_property()
    report = compliance.build_iso31000_report(db)
    coverage_section = next(s for s in report["framework_sections"] if s["clause"] == "6.4.2")
    assert coverage_section["status"] == "לא מיושם"


def test_mitigation_controls_are_broken_out_per_property(db, make_property, make_risk_profile, make_user, make_mitigation_task):
    prop = make_property()
    make_risk_profile(prop.property_id, survey_date=date.today())
    owner = make_user(role="RISK_MANAGER")

    make_mitigation_task(prop.property_id, status="COMPLETED", assigned_to_user_id=owner.user_id, due_date=date(2024, 1, 1))
    make_mitigation_task(prop.property_id, status="OVERDUE", due_date=date(2024, 2, 1))
    make_mitigation_task(prop.property_id, status="OPEN", due_date=date(2024, 3, 1))

    report = compliance.build_iso31000_report(db)
    entry = report["entries"][0]
    assert entry["completed_controls_count"] == 1
    assert entry["overdue_controls_count"] == 1
    assert entry["open_controls_count"] == 1
    assert len(entry["controls"]) == 3
    completed = next(c for c in entry["controls"] if c["status"] == "COMPLETED")
    assert completed["owner_name"] == owner.full_name
    assert report["summary"]["total_controls"] == 3
    assert report["summary"]["completed_controls_count"] == 1


def test_review_recency_counts_recently_surveyed_profiles(db, make_property, make_risk_profile):
    recent = make_property(property_code="P-RECENT")
    make_risk_profile(recent.property_id, survey_date=date.today())
    stale = make_property(property_code="P-STALE")
    make_risk_profile(stale.property_id, survey_date=date(2020, 1, 1))

    report = compliance.build_iso31000_report(db)
    monitoring_section = next(s for s in report["framework_sections"] if s["clause"] == "6.6")
    assert "1/2" in monitoring_section["metric_value"]
