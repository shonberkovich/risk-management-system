"""Tests for GET /api/compliance/iso31000-report and the Solvency II Pillar II /
Capital Market Authority sections added to services/compliance.py (TODO_SPEC.md §3
"הרחבת דוחות רגולציה")."""
from __future__ import annotations

from datetime import date

from app import models
from tests.conftest import auth_headers


def _standards(sections: list[dict]) -> set[str]:
    return {s["standard"] for s in sections}


def test_report_requires_auth(client):
    resp = client.get("/api/compliance/iso31000-report")
    assert resp.status_code == 401


def test_field_worker_forbidden(client, make_user):
    user = make_user(role="FIELD_WORKER")
    resp = client.get("/api/compliance/iso31000-report", headers=auth_headers(user))
    assert resp.status_code == 403


def test_report_includes_all_three_frameworks(client, make_user, make_property, make_risk_profile):
    prop = make_property()
    make_risk_profile(prop.property_id)
    user = make_user(role="RISK_MANAGER")

    resp = client.get("/api/compliance/iso31000-report", headers=auth_headers(user))
    assert resp.status_code == 200
    body = resp.json()

    sections = body["framework_sections"]
    standards = _standards(sections)
    assert any(s.startswith("ISO 31000") for s in standards)
    assert any("Solvency II" in s for s in standards)
    assert any("רשות שוק ההון" in s for s in standards)

    clauses = {s["clause"] for s in sections}
    assert {"6.4.2", "6.4.3", "6.4.4", "6.5", "6.6", "SII-44", "SII-45", "CMA-3", "CMA-7"} <= clauses
    assert "ISO 31000" in body["standard"]
    assert "Solvency II" in body["standard"]


def test_risk_management_function_section_reflects_active_risk_officer(client, make_user, make_property):
    make_property()
    admin = make_user(role="ADMIN")

    # No RISK_MANAGER/RISK_OFFICER yet (besides the admin making the call) -> not implemented.
    resp = client.get("/api/compliance/iso31000-report", headers=auth_headers(admin))
    section = next(s for s in resp.json()["framework_sections"] if s["clause"] == "SII-44")
    assert section["status"] == "לא מיושם"
    assert section["metric_value"] == "לא"

    make_user(role="RISK_OFFICER")
    resp2 = client.get("/api/compliance/iso31000-report", headers=auth_headers(admin))
    section2 = next(s for s in resp2.json()["framework_sections"] if s["clause"] == "SII-44")
    assert section2["status"] == "מיושם"
    assert section2["metric_value"] == "כן"


def test_capital_disclosure_section_reflects_financial_statements(client, db, make_user, make_property):
    make_property()
    admin = make_user(role="ADMIN")

    resp = client.get("/api/compliance/iso31000-report", headers=auth_headers(admin))
    section = next(s for s in resp.json()["framework_sections"] if s["clause"] == "CMA-7")
    assert section["status"] == "לא מיושם"
    assert section["metric_value"] == "אין נתונים כספיים"

    db.add(models.FinancialStatement(
        statement_id=1, year=2024, total_assets=100_000_000, revenue=20_000_000,
        net_income=2_000_000, insurance_expense=1_000_000,
    ))
    db.commit()

    resp2 = client.get("/api/compliance/iso31000-report", headers=auth_headers(admin))
    section2 = next(s for s in resp2.json()["framework_sections"] if s["clause"] == "CMA-7")
    assert section2["status"] == "מיושם"
    assert section2["metric_value"] == "זמין"


def test_cma3_and_iso644_share_the_same_ownership_metric(client, make_user, make_property, make_risk_profile):
    """CMA-3 and ISO 6.4.4 are two different frameworks' names for the same underlying
    evidence (risk ownership on high/critical-risk properties) — they should always
    report the same metric_value, by construction (see services/compliance.py)."""
    prop = make_property(primary_manager_id=None)
    make_risk_profile(prop.property_id, flood_risk_score=5, fire_risk_score=5, earthquake_risk_score=5)
    user = make_user(role="RISK_MANAGER")

    resp = client.get("/api/compliance/iso31000-report", headers=auth_headers(user))
    sections = resp.json()["framework_sections"]
    iso_section = next(s for s in sections if s["clause"] == "6.4.4")
    cma_section = next(s for s in sections if s["clause"] == "CMA-3")
    assert iso_section["metric_value"] == cma_section["metric_value"]
    assert iso_section["status"] == cma_section["status"]
