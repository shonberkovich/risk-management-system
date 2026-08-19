"""Pure KPI / risk calculations. No LLM calls here."""
import math
from collections import defaultdict
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


def _geographic_clusters(db: Session) -> list[tuple[list[int], float]]:
    """Groups properties into overlapping clusters of anything within CLUSTER_RADIUS_KM
    of a given anchor property, returning (property_ids, cluster_mfl_total) per distinct
    cluster (deduped by identical membership)."""
    rows = db.execute(
        select(models.Property.property_id, models.Property.latitude, models.Property.longitude,
               models.AssetRiskProfile.mfl_amount)
        .join(models.AssetRiskProfile, models.AssetRiskProfile.property_id == models.Property.property_id)
        .where(models.Property.is_active == True)  # noqa: E712
    ).all()

    seen: set[frozenset[int]] = set()
    clusters: list[tuple[list[int], float]] = []
    for pid_a, lat_a, lon_a, _ in rows:
        ids: list[int] = []
        total = 0.0
        for pid_b, lat_b, lon_b, mfl_b in rows:
            if _haversine_km(float(lat_a), float(lon_a), float(lat_b), float(lon_b)) <= CLUSTER_RADIUS_KM:
                ids.append(pid_b)
                total += float(mfl_b)
        key = frozenset(ids)
        if key in seen:
            continue
        seen.add(key)
        clusters.append((sorted(ids), total))
    return clusters


def calculate_mfl(db: Session) -> float:
    """Maximum Foreseeable Loss: the highest total MFL exposure among properties
    clustered within CLUSTER_RADIUS_KM of one another (a single-event geographic
    concentration)."""
    clusters = _geographic_clusters(db)
    return max((total for _, total in clusters), default=0.0)


def calculate_geographic_exposure_clusters(db: Session) -> list[dict]:
    """Enriches _geographic_clusters (property membership + cumulative MFL) with the
    geometric details needed to draw exposure circles on the map and report cumulative
    limits per cluster: the cluster's centroid (mean lat/lon of its members), its actual
    radius (max distance from that centroid to any member — not the fixed
    CLUSTER_RADIUS_KM used to *form* the cluster, which is just the neighbor-inclusion
    threshold), and the cluster's cumulative TIV (sum of replacement_value) alongside the
    existing cumulative MFL. Sorted descending by cluster_mfl_total (largest single-event
    concentration first), matching how calculate_mfl / calculate_alerts prioritize
    clusters."""
    clusters = _geographic_clusters(db)
    if not clusters:
        return []

    prop_rows = db.execute(
        select(models.Property.property_id, models.Property.name, models.Property.latitude,
               models.Property.longitude, models.Property.replacement_value)
        .where(models.Property.is_active == True)  # noqa: E712
    ).all()
    prop_by_id = {
        pid: {"name": name, "lat": float(lat), "lon": float(lon), "tiv": float(rv)}
        for pid, name, lat, lon, rv in prop_rows
    }

    result: list[dict] = []
    for property_ids, mfl_total in clusters:
        members = [prop_by_id[pid] for pid in property_ids]
        center_lat = sum(m["lat"] for m in members) / len(members)
        center_lon = sum(m["lon"] for m in members) / len(members)
        radius_km = max(
            (_haversine_km(center_lat, center_lon, m["lat"], m["lon"]) for m in members),
            default=0.0,
        )
        tiv_total = sum(m["tiv"] for m in members)

        result.append({
            "property_ids": property_ids,
            "property_names": [m["name"] for m in members],
            "property_count": len(property_ids),
            "center_lat": round(center_lat, 6),
            "center_lon": round(center_lon, 6),
            "radius_km": round(radius_km, 2),
            "cluster_mfl_total": round(mfl_total, 2),
            "cluster_tiv_total": round(tiv_total, 2),
        })

    result.sort(key=lambda c: c["cluster_mfl_total"], reverse=True)
    return result


def calculate_exposure_by_region(db: Session) -> list[dict]:
    """TIV, MFL and total claimed amount per Region, for comparing geographic
    concentration against the cluster-based view in calculate_geographic_exposure_clusters
    (this groups by the administrative Regions table rather than physical proximity —
    the two can disagree, e.g. two properties in different regions but geographically
    close to a border still cluster together in _geographic_clusters).

    - tiv: sum of replacement_value for active properties in the region.
    - mfl: sum of Asset_Risk_Profiles.mfl_amount for active properties in the region
      (a simple sum, not a clustered max like calculate_mfl — this reports the region's
      total foreseeable-loss capacity, not a single-event concentration).
    - total_claimed: sum of Claims.claimed_amount for claims on incidents at properties
      in the region (all claims regardless of status, matching how claimed_amount is
      used elsewhere, e.g. calculate_open_claims).

    Properties with no region_id are grouped under a synthetic "unassigned" entry.
    Sorted descending by tiv."""
    regions = {r.region_id: r.name for r in db.scalars(select(models.Region)).all()}

    props = db.scalars(
        select(models.Property).where(models.Property.is_active == True)  # noqa: E712
    ).all()
    props_by_id = {p.property_id: p for p in props}

    tiv_by_region: dict[int | None, float] = defaultdict(float)
    for p in props:
        tiv_by_region[p.region_id] += float(p.replacement_value)

    profiles = db.scalars(select(models.AssetRiskProfile)).all()
    mfl_by_region: dict[int | None, float] = defaultdict(float)
    for profile in profiles:
        prop = props_by_id.get(profile.property_id)
        if prop is None:
            continue
        mfl_by_region[prop.region_id] += float(profile.mfl_amount)

    claims = db.execute(
        select(models.Claim, models.Incident.property_id)
        .join(models.Incident, models.Incident.incident_id == models.Claim.incident_id)
    ).all()
    claimed_by_region: dict[int | None, float] = defaultdict(float)
    for claim, property_id in claims:
        prop = props_by_id.get(property_id)
        if prop is None:
            continue
        claimed_by_region[prop.region_id] += float(claim.claimed_amount)

    region_ids = set(tiv_by_region) | set(mfl_by_region) | set(claimed_by_region)
    result = [
        {
            "region_id": region_id,
            "region_name": regions.get(region_id, "לא משויך") if region_id is not None else "לא משויך",
            "tiv": round(tiv_by_region.get(region_id, 0.0), 2),
            "mfl": round(mfl_by_region.get(region_id, 0.0), 2),
            "total_claimed": round(claimed_by_region.get(region_id, 0.0), 2),
        }
        for region_id in region_ids
    ]
    result.sort(key=lambda r: r["tiv"], reverse=True)
    return result


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


def calculate_loss_ratio_trend(db: Session) -> list[tuple[int, float, float, float]]:
    """Loss ratio per calendar year present in the claims data. Premiums reflect
    current active policies (annual figures, not tied to a specific year), so only
    the claimed-amount side varies by year — same assumption as calculate_loss_ratio.
    Returns a list of (year, loss_ratio, total_claimed, total_annual_premium), sorted
    ascending by year."""
    policies = db.scalars(select(models.InsurancePolicy)).all()
    total_premium = float(sum(p.annual_premium for p in policies))

    claims = db.execute(
        select(models.Claim, models.Incident.incident_timestamp)
        .join(models.Incident, models.Incident.incident_id == models.Claim.incident_id)
    ).all()

    claimed_by_year: dict[int, float] = {}
    for c, ts in claims:
        claimed_by_year[ts.year] = claimed_by_year.get(ts.year, 0.0) + float(c.claimed_amount)

    return [
        (year, round((claimed / total_premium) if total_premium else 0.0, 4), claimed, total_premium)
        for year, claimed in sorted(claimed_by_year.items())
    ]


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


# --- Mitigation ROI, full breakdown ---
# Mitigation_Tasks only stores one number, expected_annual_savings — the task owner's
# estimate of the total dollar benefit of completing the task. This service turns that
# single figure into a cost-vs-savings breakdown for the dashboard: where the expected
# savings come from (premium credit vs. reduced expected losses), the ROI %, and a
# simple payback period.
#
# The schema has no separate "premium savings" vs. "loss savings" columns, so the split
# below is a fixed, documented assumption (course demo, not an actuarial pricing model —
# see docs/README.md §8, and mirrors the fixed-rate style already used in
# retention.PREMIUM_SURCHARGE_RATE): a property under an active insurance policy is
# assumed to get part of its savings as a premium credit (insurers reward risk-reducing
# investments like sprinklers), with the remainder counted as reduced expected losses
# (the retained/self-insured portion, e.g. amounts below the deductible). A property
# with no active policy has no premium to get credit against, so all of its savings are
# attributed to reduced expected losses.
MITIGATION_PREMIUM_SAVINGS_SHARE = 0.40  # share of expected_annual_savings booked as premium credit, when insured


def calculate_mitigation_roi_breakdown(db: Session, task_id: int) -> dict | None:
    """Cost-vs-savings breakdown for one mitigation task. Returns None if the task
    doesn't exist. See module comment above calculate_mitigation_roi_breakdown for the
    premium/loss savings split assumption."""
    task = db.get(models.MitigationTask, task_id)
    if task is None:
        return None

    # Local import to avoid a module-load-order cycle (retention.py doesn't import kpi.py).
    from app.services.retention import get_active_policy_for_property

    cost = float(task.cost_estimate)
    total_savings = float(task.expected_annual_savings)
    has_active_policy = get_active_policy_for_property(db, task.property_id) is not None

    if has_active_policy and total_savings > 0:
        premium_savings = round(total_savings * MITIGATION_PREMIUM_SAVINGS_SHARE, 2)
        loss_savings = round(total_savings - premium_savings, 2)
    else:
        premium_savings = 0.0
        loss_savings = round(total_savings, 2)

    return {
        "task_id": task_id,
        "property_id": task.property_id,
        "title": task.title,
        "status": task.status,
        "cost_estimate": round(cost, 2),
        "expected_annual_savings_total": round(total_savings, 2),
        "expected_premium_savings": premium_savings,
        "expected_loss_savings": loss_savings,
        "has_active_policy": has_active_policy,
        "roi_percent": calculate_mitigation_roi(task),
        "payback_years": round(cost / total_savings, 2) if total_savings > 0 else None,
    }


def calculate_mitigation_roi_summary(db: Session) -> list[dict]:
    """calculate_mitigation_roi_breakdown for every mitigation task, sorted descending
    by roi_percent (tasks with no cost_estimate, hence no ROI, sort last)."""
    task_ids = db.scalars(select(models.MitigationTask.task_id)).all()
    results = [calculate_mitigation_roi_breakdown(db, task_id) for task_id in task_ids]
    results.sort(key=lambda r: (r["roi_percent"] is None, -(r["roi_percent"] or 0)))
    return results


# --- Threshold alerts ---
# Deliberately simple, fixed thresholds (no per-tenant configuration) — the goal is to
# demonstrate a working alerts mechanism, not a full rules engine (see docs/README.md §8).
GEO_EXPOSURE_THRESHOLD_RATIO = 0.20  # a geographic cluster's combined MFL vs. total TIV
INCIDENT_CONCENTRATION_THRESHOLD = 3  # open incidents on a single property

OPEN_INCIDENT_STATUSES = {"NEW", "UNDER_INVESTIGATION", "CLAIM_FILED"}


def calculate_alerts(
    db: Session,
    geo_exposure_threshold_ratio: float | None = None,
    incident_concentration_threshold: int | None = None,
) -> list[dict]:
    """Returns a list of threshold-crossing alerts: geographic exposure clusters whose
    combined MFL exceeds geo_exposure_threshold_ratio of TIV, and properties whose open
    incident count reaches incident_concentration_threshold. Each alert is a dict matching
    schemas.AlertOut.

    Both thresholds default to the fixed module constants (GEO_EXPOSURE_THRESHOLD_RATIO,
    INCIDENT_CONCENTRATION_THRESHOLD) when omitted, so existing callers are unaffected;
    passing them explicitly lets a caller (e.g. notifications.dispatch_notifications) use
    per-call/configurable thresholds instead of editing the module constants."""
    geo_exposure_threshold_ratio = (
        GEO_EXPOSURE_THRESHOLD_RATIO if geo_exposure_threshold_ratio is None else geo_exposure_threshold_ratio
    )
    incident_concentration_threshold = (
        INCIDENT_CONCENTRATION_THRESHOLD if incident_concentration_threshold is None else incident_concentration_threshold
    )

    alerts: list[dict] = []
    tiv = calculate_tiv(db)
    props_by_id = {p.property_id: p.name for p in db.scalars(select(models.Property)).all()}

    if tiv > 0:
        geo_threshold = tiv * geo_exposure_threshold_ratio
        for property_ids, cluster_mfl in _geographic_clusters(db):
            if len(property_ids) < 2 or cluster_mfl <= geo_threshold:
                continue
            names = ", ".join(props_by_id.get(pid, f"#{pid}") for pid in property_ids)
            alerts.append({
                "alert_type": "geographic_exposure",
                "severity": "critical" if cluster_mfl > geo_threshold * 1.5 else "warning",
                "title": "ריכוז חשיפה גיאוגרפית חוצה סף",
                "message": f"אשכול של {len(property_ids)} נכסים ({names}) בטווח {CLUSTER_RADIUS_KM:.0f} ק\"מ "
                           f"עם חשיפת MFL מצטברת החורגת מ-{geo_exposure_threshold_ratio:.0%} מסך שווי מבוטח (TIV).",
                "property_ids": property_ids,
                "value": round(cluster_mfl, 2),
                "threshold": round(geo_threshold, 2),
            })

    incidents = db.scalars(select(models.Incident)).all()
    open_counts: dict[int, int] = {}
    for i in incidents:
        if i.status in OPEN_INCIDENT_STATUSES:
            open_counts[i.property_id] = open_counts.get(i.property_id, 0) + 1
    for property_id, count in open_counts.items():
        if count < incident_concentration_threshold:
            continue
        name = props_by_id.get(property_id, f"#{property_id}")
        alerts.append({
            "alert_type": "incident_concentration",
            "severity": "critical" if count >= incident_concentration_threshold + 2 else "warning",
            "title": "ריכוז אירועים פתוחים בנכס",
            "message": f'לנכס "{name}" יש {count} אירועים פתוחים במקביל, מעל הסף המוגדר ({incident_concentration_threshold}).',
            "property_ids": [property_id],
            "value": float(count),
            "threshold": float(incident_concentration_threshold),
        })

    severity_rank = {"critical": 0, "warning": 1}
    alerts.sort(key=lambda a: severity_rank[a["severity"]])
    return alerts
