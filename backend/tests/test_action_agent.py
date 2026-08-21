"""Unit tests for the Action & Compliance Agent's deterministic (no-LLM)
proposal builder (TODO_SPEC.md §5) — build_mitigation_task_proposal only
uses services/compliance.py, so it's fully testable without ANTHROPIC_API_KEY."""
from app.services.agents import action_agent


def test_no_proposal_for_low_risk_property(db, make_property, make_risk_profile):
    prop = make_property(primary_manager_id=None)
    make_risk_profile(prop.property_id, flood_risk_score=1, fire_risk_score=1, earthquake_risk_score=1)

    proposal = action_agent.build_mitigation_task_proposal(db, prop.property_id)

    assert proposal is None


def test_proposal_for_high_risk_property_without_owner(db, make_property, make_risk_profile):
    prop = make_property(primary_manager_id=None)
    make_risk_profile(prop.property_id, flood_risk_score=5, fire_risk_score=5, earthquake_risk_score=5)

    proposal = action_agent.build_mitigation_task_proposal(db, prop.property_id)

    assert proposal is not None
    assert proposal["action_type"] == "CREATE_MITIGATION_TASK_PROPOSAL"
    assert proposal["property_id"] == prop.property_id
    assert proposal["risk_level"] == "קריטי"
    assert proposal["proposed_task"]["property_id"] == prop.property_id
    assert "due_date" in proposal["proposed_task"]


def test_no_proposal_for_high_risk_property_with_owner(db, make_property, make_risk_profile, make_user):
    manager = make_user(role="RISK_MANAGER", email="owner-test@example.com")
    prop = make_property(primary_manager_id=manager.user_id)
    make_risk_profile(prop.property_id, flood_risk_score=5, fire_risk_score=5, earthquake_risk_score=5)

    proposal = action_agent.build_mitigation_task_proposal(db, prop.property_id)

    assert proposal is None


def test_proposal_for_unknown_property_returns_none(db):
    assert action_agent.build_mitigation_task_proposal(db, 999999) is None


def test_log_proposal_and_mark_status(db, make_property, make_risk_profile):
    prop = make_property(primary_manager_id=None)
    make_risk_profile(prop.property_id, flood_risk_score=5, fire_risk_score=5, earthquake_risk_score=5)
    proposal = action_agent.build_mitigation_task_proposal(db, prop.property_id)

    log = action_agent.log_proposal(db, "test-session", proposal)
    db.commit()
    assert log.status == "proposed"

    updated = action_agent.mark_action_status(db, log.action_id, "confirmed")
    db.commit()
    assert updated.status == "confirmed"

    assert action_agent.mark_action_status(db, 999999, "confirmed") is None
