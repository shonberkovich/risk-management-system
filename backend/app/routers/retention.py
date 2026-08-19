from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app import models, schemas
from app.database import get_db
from app.services import retention

router = APIRouter(prefix="/api/retention", tags=["retention"])


@router.get("/recommendation", response_model=schemas.RetentionRecommendation)
def get_retention_recommendation(
    policy_id: int = Query(..., description="Insurance_Policies.policy_id"),
    property_id: int = Query(..., description="Properties.property_id"),
    estimated_loss: float = Query(..., gt=0, description="Estimated loss amount (₪)"),
    db: Session = Depends(get_db),
):
    """Given a damage estimate and a policy, recommends absorbing the loss vs. filing
    a claim (see services/retention.py for the cost model: full loss out-of-pocket for
    self-absorb, vs. deductible + expected future premium surcharge for filing).
    404 if the policy or the property doesn't exist."""
    if db.get(models.InsurancePolicy, policy_id) is None:
        raise HTTPException(404, "Policy not found")
    if db.get(models.Property, property_id) is None:
        raise HTTPException(404, "Property not found")

    return retention.calculate_retention_recommendation(db, policy_id, property_id, estimated_loss)


@router.get("/incidents/{incident_id}", response_model=schemas.RetentionRecommendation)
def get_retention_recommendation_for_incident(incident_id: int, db: Session = Depends(get_db)):
    """Convenience variant: runs the same recommendation using an existing incident's
    initial_estimated_loss and its property's active policy. 404 if the incident
    doesn't exist or its property has no active policy coverage to compare against."""
    result = retention.suggest_for_incident(db, incident_id)
    if result is None:
        raise HTTPException(404, "Incident not found or has no active policy coverage")
    return result
