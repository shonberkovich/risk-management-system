"""Retention optimizer: self-absorb-vs-claim comparison. Pure calculations, no LLM
calls here (mirrors kpi.py / cashflow.py).

The core question this answers: for a given (or estimated) loss amount on a property,
is it cheaper over time to pay out of pocket ("retain" the loss) or to file an
insurance claim? Filing recovers money now but is assumed to raise the policy's future
premium (insurers reprice on experience/loss history) — so a claim's true cost is the
deductible paid up front *plus* that expected future premium surcharge, not just the
deductible.

PREMIUM_SURCHARGE_RATE is a simplifying, fixed assumption (this is a course demo, not
an actuarial pricing engine — see docs/README.md §8): every shekel recovered from the
insurer is assumed to cost PREMIUM_SURCHARGE_RATE shekels in extra premium at the next
renewal, reflecting worsened claims experience.
"""
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import models

PREMIUM_SURCHARGE_RATE = 0.15  # expected future premium increase per ₪ recovered from a claim
ACTIVE_POLICY_STATUS = "ACTIVE"


def get_effective_deductible(db: Session, policy_id: int, property_id: int) -> float:
    """The deductible that actually applies to this property under this policy:
    Policy_Assets.specific_deductible overrides Insurance_Policies.deductible_default
    when set for that specific property."""
    policy_asset = db.get(models.PolicyAsset, {"policy_id": policy_id, "property_id": property_id})
    if policy_asset is not None and policy_asset.specific_deductible is not None:
        return float(policy_asset.specific_deductible)

    policy = db.get(models.InsurancePolicy, policy_id)
    return float(policy.deductible_default) if policy else 0.0


def get_active_policy_for_property(db: Session, property_id: int) -> models.InsurancePolicy | None:
    """The first ACTIVE policy covering this property via Policy_Assets, or None if
    the property has no active coverage."""
    return db.scalars(
        select(models.InsurancePolicy)
        .join(models.PolicyAsset, models.PolicyAsset.policy_id == models.InsurancePolicy.policy_id)
        .where(
            models.PolicyAsset.property_id == property_id,
            models.InsurancePolicy.status == ACTIVE_POLICY_STATUS,
        )
    ).first()


def calculate_retention_recommendation(
    db: Session, policy_id: int, property_id: int, estimated_loss: float
) -> dict:
    """Compares self-absorbing estimated_loss against filing a claim on policy_id for
    property_id, and recommends whichever is cheaper.

    - Self-absorb cost: the full estimated_loss, with no premium impact.
    - Claim cost: out-of-pocket (the deductible, or the whole loss if it's below the
      deductible — insurance never pays under the deductible) plus the expected future
      premium surcharge on whatever the insurer would recover (see module docstring),
      capped by the policy's per_event_limit if one is set.

    Returns a breakdown dict; recommendation is "ABSORB" or "CLAIM".
    """
    policy = db.get(models.InsurancePolicy, policy_id)
    if policy is None:
        raise ValueError(f"Policy {policy_id} not found")

    deductible = get_effective_deductible(db, policy_id, property_id)
    estimated_loss = float(estimated_loss)

    if estimated_loss <= deductible:
        # Below deductible: insurance recovers nothing regardless of filing, so there's
        # nothing to compare — self-absorb is the only real option.
        recoverable = 0.0
    else:
        recoverable = estimated_loss - deductible
        if policy.per_event_limit is not None:
            recoverable = min(recoverable, float(policy.per_event_limit))

    claim_out_of_pocket = estimated_loss - recoverable
    expected_premium_surcharge = round(recoverable * PREMIUM_SURCHARGE_RATE, 2)
    claim_total_cost = round(claim_out_of_pocket + expected_premium_surcharge, 2)
    absorb_total_cost = round(estimated_loss, 2)

    recommendation = "ABSORB" if absorb_total_cost <= claim_total_cost else "CLAIM"
    savings = round(abs(absorb_total_cost - claim_total_cost), 2)

    return {
        "policy_id": policy_id,
        "property_id": property_id,
        "estimated_loss": round(estimated_loss, 2),
        "deductible": round(deductible, 2),
        "claim_recoverable_amount": round(recoverable, 2),
        "claim_out_of_pocket": round(claim_out_of_pocket, 2),
        "expected_premium_surcharge": expected_premium_surcharge,
        "claim_total_cost": claim_total_cost,
        "absorb_total_cost": absorb_total_cost,
        "recommendation": recommendation,
        "estimated_savings": savings,
    }


def suggest_for_incident(db: Session, incident_id: int) -> dict | None:
    """Convenience wrapper for a not-yet-claimed incident: looks up its property's
    active policy and runs calculate_retention_recommendation using the incident's
    initial_estimated_loss. Returns None if the incident has no active policy coverage
    to compare against."""
    incident = db.get(models.Incident, incident_id)
    if incident is None:
        return None

    policy = get_active_policy_for_property(db, incident.property_id)
    if policy is None:
        return None

    result = calculate_retention_recommendation(
        db, policy.policy_id, incident.property_id, float(incident.initial_estimated_loss)
    )
    result["incident_id"] = incident_id
    return result
