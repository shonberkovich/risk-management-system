"""Round-trip tests for `app.services.encryption` and the model columns that use it.

Covers the TODO_SPEC.md §3 "הצפנת שדות רגישים" scope: Claims.adjuster_name,
Insurance_Policies.per_event_limit, Policy_Assets.specific_deductible, and
Audit_Log.old_value/new_value — plus the pre-existing Claim_Payments.reference_number.
"""
from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app import models
from app.services.encryption import decrypt_value, encrypt_value


def _raw_column_value(db: Session, table: str, id_column: str, id_value: int, column: str) -> str:
    """Bypasses the ORM's TypeDecorator to read exactly what's stored in the column,
    so tests can assert the ciphertext (not the decrypted value) is what's persisted."""
    row = db.execute(
        text(f"SELECT {column} FROM {table} WHERE {id_column} = :id"), {"id": id_value}
    ).first()
    return row[0]


def test_encrypt_decrypt_round_trip():
    ciphertext = encrypt_value("hello")
    assert ciphertext != "hello"
    assert decrypt_value(ciphertext) == "hello"


def test_claim_adjuster_name_encrypted_at_rest(db: Session, make_property, make_policy, make_incident, make_claim):
    prop = make_property()
    policy = make_policy()
    incident = make_incident(prop.property_id)
    claim = make_claim(incident.incident_id, policy.policy_id, adjuster_name="ישראל ישראלי")
    db.expire_all()

    stored = _raw_column_value(db, "Claims", "claim_id", claim.claim_id, "adjuster_name")
    assert stored != "ישראל ישראלי"  # ciphertext, not plaintext, on disk

    reloaded = db.get(models.Claim, claim.claim_id)
    assert reloaded.adjuster_name == "ישראל ישראלי"  # transparently decrypted on read


def test_policy_per_event_limit_encrypted_at_rest(db: Session, make_policy):
    policy = make_policy(per_event_limit=1_000_000)
    db.expire_all()

    stored = _raw_column_value(db, "Insurance_Policies", "policy_id", policy.policy_id, "per_event_limit")
    assert stored != "1000000"
    assert stored != "1000000.0"

    reloaded = db.get(models.InsurancePolicy, policy.policy_id)
    assert float(reloaded.per_event_limit) == 1_000_000


def test_policy_asset_specific_deductible_encrypted_at_rest(db: Session, make_property, make_policy):
    prop = make_property()
    policy = make_policy()
    asset = models.PolicyAsset(policy_id=policy.policy_id, property_id=prop.property_id, specific_deductible=25_000)
    db.add(asset)
    db.commit()
    db.expire_all()

    stored = db.execute(
        text(
            "SELECT specific_deductible FROM Policy_Assets WHERE policy_id = :p AND property_id = :a"
        ),
        {"p": policy.policy_id, "a": prop.property_id},
    ).first()[0]
    assert stored != "25000"

    reloaded = db.get(models.PolicyAsset, {"policy_id": policy.policy_id, "property_id": prop.property_id})
    assert float(reloaded.specific_deductible) == 25_000


def test_audit_log_old_new_value_encrypted_at_rest(db: Session):
    entry = models.AuditLog(
        user_id=None,
        entity_type="CLAIM",
        entity_id=1,
        action="UPDATE",
        old_value='{"claim_status": "SUBMITTED"}',
        new_value='{"claim_status": "APPROVED"}',
        timestamp=datetime(2024, 1, 1),
    )
    db.add(entry)
    db.commit()
    db.expire_all()

    stored_old = _raw_column_value(db, "Audit_Log", "log_id", entry.log_id, "old_value")
    stored_new = _raw_column_value(db, "Audit_Log", "log_id", entry.log_id, "new_value")
    assert stored_old != '{"claim_status": "SUBMITTED"}'
    assert stored_new != '{"claim_status": "APPROVED"}'

    reloaded = db.get(models.AuditLog, entry.log_id)
    assert reloaded.old_value == '{"claim_status": "SUBMITTED"}'
    assert reloaded.new_value == '{"claim_status": "APPROVED"}'


def test_pre_existing_plaintext_value_still_readable(db: Session, make_property, make_policy):
    """Rows written before a column became encrypted (or via seed.py's raw pyodbc
    inserts, which bypass the ORM type) must remain readable as-is — see
    `EncryptedString.process_result_value`'s InvalidToken fallback."""
    prop = make_property()
    policy = make_policy()
    db.execute(
        text(
            "INSERT INTO Policy_Assets (policy_id, property_id, specific_deductible) "
            "VALUES (:p, :a, :v)"
        ),
        {"p": policy.policy_id, "a": prop.property_id, "v": "10000.00"},
    )
    db.commit()
    db.expire_all()

    reloaded = db.get(models.PolicyAsset, {"policy_id": policy.policy_id, "property_id": prop.property_id})
    assert reloaded.specific_deductible == "10000.00"


def test_pre_existing_non_ascii_plaintext_value_still_readable(db: Session, make_property, make_policy, make_incident, make_claim):
    """Same as `test_pre_existing_plaintext_value_still_readable`, but for legacy plaintext
    containing non-ASCII characters (e.g. a Hebrew `Claims.adjuster_name` seeded before this
    column was encrypted — this is exactly `seed.py`'s raw pyodbc path). `decrypt_value`'s
    `ciphertext.encode("ascii")` raises `UnicodeEncodeError` on such values *before* Fernet
    ever gets a chance to reject them as an invalid token, so `EncryptedString
    .process_result_value`'s fallback must catch `UnicodeError` too, not just `InvalidToken`
    — this was a real bug that 500'd `GET /api/analytics/cashflow` (and any other query
    touching `Claims`) against real seeded data."""
    prop = make_property()
    policy = make_policy()
    incident = make_incident(property_id=prop.property_id)
    claim = make_claim(incident_id=incident.incident_id, policy_id=policy.policy_id)
    db.execute(
        text("UPDATE Claims SET adjuster_name = :v WHERE claim_id = :id"),
        {"v": "רונית כהן", "id": claim.claim_id},
    )
    db.commit()
    db.expire_all()

    reloaded = db.get(models.Claim, claim.claim_id)
    assert reloaded.adjuster_name == "רונית כהן"
