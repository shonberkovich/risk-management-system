"""Pure KPI / risk calculations. No LLM calls here."""
import math
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import models
from app.schemas import KpiSummary

CLUSTER_RADIUS_KM = 10.0


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlambda / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def calculate_tiv(db: Session) -> float:
    """Total Insured Value = sum of replacement_value for active properties."""
    props = db.scalars(select(models.Property).where(models.Property.is_active == True)).all()  # noqa: E712
    return float(sum(p.replacement_value for p in props))


def calculate_mfl(db: Session) -> float:
    """Maximum Foreseeable Loss: the highest total MFL exposure among properties
    clustered within CLUSTER_RADIUS_KM of one another (a single-event geographic
    concentration)."""
    rows = db.execute(
        select(models.Property.property_id, models.Property.latitude, models.Property.longitude,
               models.AssetRiskProfile.mfl_amount)
        .join(models.AssetRiskProfile, models.AssetRiskProfile.property_id == models.Property.property_id)
        .where(models.Property.is_active == True)  # noqa: E712
    ).all()

    if not rows:
        return 0.0

    best = 0.0
    for _, lat_a, lon_a, _ in rows:
        cluster_total = 0.0
        for _, lat_b, lon_b, mfl_b in rows:
            if _haversine_km(float(lat_a), float(lon_a), float(lat_b), float(lon_b)) <= CLUSTER_RADIUS_KM:
                cluster_total += float(mfl_b)
        best = max(best, cluster_total)
    return best


def calculate_loss_ratio(db: Session, year: int | None = None) -> tuple[float, float, float]:
    """Returns (loss_ratio, total_claimed_ytd, total_annual_premium)."""
    year = year or date.today().year
    policies = db.scalars(select(models.InsurancePolicy)).all()
    total_premium = float(sum(p.annual_premium for p in policies))

    claims = db.execute(
        select(models.Claim, models.Incident.incident_timestamp)
        .join(models.Incident, models.Incident.incident_id == models.Claim.incident_id)
    ).all()
    total_claimed = sum(
        float(c.claimed_amount) for c, ts in claims if ts.year == year
    )
    ratio = (total_claimed / total_premium) if total_premium else 0.0
    return ratio, total_claimed, total_premium


def calculate_open_claims(db: Session) -> tuple[int, float, float]:
    """Returns (count, total_claimed_open, total_approved_pending_payment)."""
    open_statuses = {"SUBMITTED", "IN_ADJUSTMENT", "APPROVED"}
    claims = db.scalars(select(models.Claim)).all()
    open_claims = [c for c in claims if c.claim_status in open_statuses]
    count = len(open_claims)
    total_claimed = float(sum(c.claimed_amount for c in open_claims))
    total_approved_pending = float(sum(
        c.approved_amount for c in open_claims if c.claim_status == "APPROVED"
    ))
    return count, total_claimed, total_approved_pending


def get_kpi_summary(db: Session) -> KpiSummary:
    tiv = calculate_tiv(db)
    mfl = calculate_mfl(db)
    loss_ratio, claimed_ytd, total_premium = calculate_loss_ratio(db)
    open_count, open_amount, approved_pending = calculate_open_claims(db)

    return KpiSummary(
        tiv=tiv,
        mfl=mfl,
        open_claims_count=open_count,
        open_claims_amount=open_amount,
        approved_pending_amount=approved_pending,
        loss_ratio=round(loss_ratio, 4),
        total_annual_premium=total_premium,
    )


def calculate_property_risk_score(profile: models.AssetRiskProfile) -> float:
    """0-100 composite risk score: weighted avg of flood/fire/earthquake (1-5 scale),
    reduced by 20% if sprinklers are present."""
    raw = (
        profile.flood_risk_score * 0.35
        + profile.fire_risk_score * 0.40
        + profile.earthquake_risk_score * 0.25
    )
    score = (raw / 5.0) * 100
    if profile.has_sprinklers:
        score *= 0.8
    return round(score, 1)


def calculate_mitigation_roi(task: models.MitigationTask) -> float | None:
    """ROI % = expected_annual_savings / cost_estimate * 100."""
    if not task.cost_estimate:
        return None
    return round((float(task.expected_annual_savings) / float(task.cost_estimate)) * 100, 1)
