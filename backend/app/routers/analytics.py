from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import models, schemas
from app.database import get_db
from app.services import kpi

router = APIRouter(prefix="/api/analytics", tags=["analytics"])

OPEN_INCIDENT_STATUSES = {"NEW", "UNDER_INVESTIGATION", "CLAIM_FILED"}


@router.get("/kpis", response_model=schemas.KpiSummary)
def get_kpis(db: Session = Depends(get_db)):
    return kpi.get_kpi_summary(db)


@router.get("/map", response_model=list[schemas.PropertyMapPoint])
def get_map_points(db: Session = Depends(get_db)):
    props = db.scalars(select(models.Property).where(models.Property.is_active == True)).all()  # noqa: E712
    incidents = db.scalars(select(models.Incident)).all()

    result = []
    for p in props:
        prop_incidents = [i for i in incidents if i.property_id == p.property_id]
        open_incidents = [i for i in prop_incidents if i.status in OPEN_INCIDENT_STATUSES]
        has_critical = any(i.severity_level == "CRITICAL" and i.status != "CLOSED" for i in prop_incidents)
        if has_critical:
            color = "red"
        elif open_incidents:
            color = "yellow"
        else:
            color = "green"

        result.append(schemas.PropertyMapPoint(
            property_id=p.property_id,
            name=p.name,
            latitude=float(p.latitude),
            longitude=float(p.longitude),
            asset_type=p.asset_type,
            replacement_value=float(p.replacement_value),
            status_color=color,
            open_incidents=len(open_incidents),
        ))
    return result


def _band(value: float, low_max: float, med_max: float) -> str:
    if value <= low_max:
        return "low"
    if value <= med_max:
        return "medium"
    return "high"


SEVERITY_RANK = {"LOW": 1, "MEDIUM": 2, "HIGH": 3, "CRITICAL": 4}


@router.get("/risk-matrix", response_model=list[schemas.RiskMatrixCell])
def get_risk_matrix(db: Session = Depends(get_db)):
    """3x3 probability x severity matrix. Probability derived from the property's
    composite risk score (Asset_Risk_Profiles); severity from worst open incident
    on that property (or a baseline low if none)."""
    props = db.scalars(
        select(models.Property).where(models.Property.is_active == True)  # noqa: E712
    ).all()
    profiles = {p.property_id: p for p in db.scalars(select(models.AssetRiskProfile)).all()}
    incidents = db.scalars(select(models.Incident)).all()

    cells: dict[tuple[str, str], list[int]] = {}
    for prop in props:
        profile = profiles.get(prop.property_id)
        risk_score = kpi.calculate_property_risk_score(profile) if profile else 0.0
        prob_band = _band(risk_score, 33, 66)

        prop_incidents = [i for i in incidents if i.property_id == prop.property_id]
        worst_rank = max((SEVERITY_RANK[i.severity_level] for i in prop_incidents), default=1)
        sev_band = _band(worst_rank, 1, 2)

        key = (prob_band, sev_band)
        cells.setdefault(key, []).append(prop.property_id)

    output = []
    for prob in ("low", "medium", "high"):
        for sev in ("low", "medium", "high"):
            ids = cells.get((prob, sev), [])
            output.append(schemas.RiskMatrixCell(
                probability_band=prob, severity_band=sev, count=len(ids), property_ids=ids,
            ))
    return output


@router.get("/hazard-distribution", response_model=list[schemas.HazardDistributionItem])
def get_hazard_distribution(db: Session = Depends(get_db)):
    rows = db.execute(
        select(models.Incident.hazard_type, func.count().label("cnt"))
        .group_by(models.Incident.hazard_type)
    ).all()
    total = sum(r.cnt for r in rows) or 1
    return [
        schemas.HazardDistributionItem(
            hazard_type=r.hazard_type, count=r.cnt, percent=round(r.cnt / total * 100, 1)
        )
        for r in rows
    ]
