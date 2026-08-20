"""ERP / accounting-system connector. Pure data-shaping/routing layer, no real
outbound HTTP calls — mirrors the "simulated" pattern used by
app/services/notifications.py.

The course brief (see docs/README.md §8, "אינטגרציית ERP (SAP/Priority) לסנכרון
שווי נכסים ותשלומים") describes two directions of sync with a general-ledger /
fixed-assets system such as SAP or Priority:

1. **Pull** — the ERP is the source of truth for a property's book value (after
   depreciation), so RMIS should periodically refresh `Properties.book_value`
   from it.
2. **Push** — every claim payment RMIS records is a real cash receipt against an
   insurance receivable, and needs a matching journal entry in the ERP's AR
   ledger so the finance team's books reconcile with the claims register.

There is no real ERP account, no credentials in `backend/.env`, and no
webhook/callback to confirm a posting actually landed — exactly the same
constraint `notifications.py` documents for SMS/Email/Push. So this module
does not open a network connection to anything. Instead:

- `pull_asset_book_values` reads `Properties` and returns the book-value rows
  formatted the way an ERP fixed-assets export would hand them back (i.e. it
  demonstrates the read side of the sync — what RMIS would overwrite
  `book_value` with on a real sync — without pretending an external system
  exists to disagree with our own numbers).
- `build_claim_receipt_postings` / `post_claim_receipts` turn `Claim_Payments`
  rows into AR journal-entry records (debit cash, credit insurance
  receivable) and "post" them by logging at INFO with status="simulated" —
  a real integration would swap the `logger.log` call for an actual SAP
  RFC / Priority REST call, keeping the row-shaping helpers unchanged.

Both directions are read-only with respect to RMIS's own data: nothing here
writes back to `Properties.book_value` or marks a `Claim_Payments` row as
"posted", because the schema has no ERP-sync-state column to persist that in
(same simplifying, documented gap as notifications.py not tracking delivery
receipts). A real integration would add a `last_erp_sync_at` / `erp_posted`
column and a scheduled job; here each call recomputes from scratch, scoped by
an optional date filter, so it's safe to call repeatedly without double-
counting on the RMIS side (a real ERP would still need idempotency keys on
its end, same as any at-least-once integration).
"""
import logging
from datetime import date, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import models

logger = logging.getLogger("rmis.integrations.erp")

# In a real integration this would come from the ERP's chart of accounts /
# backend/.env config; fixed here for the same reason DEFAULT_RECIPIENTS is
# fixed in notifications.py — no account-directory table in the schema.
GL_CASH_ACCOUNT = "1010-CASH"
GL_RECEIVABLE_ACCOUNT = "1200-AR-INSURANCE"


def pull_asset_book_values(db: Session, property_ids: list[int] | None = None) -> list[dict]:
    """Simulates an ERP fixed-assets export: one row per active property with the
    book value RMIS would refresh `Properties.book_value` from on a real sync.
    Does not write anything back — see module docstring."""
    stmt = select(models.Property).where(models.Property.is_active == True)  # noqa: E712
    if property_ids:
        stmt = stmt.where(models.Property.property_id.in_(property_ids))
    properties = db.scalars(stmt.order_by(models.Property.property_id)).all()

    rows = [
        {
            "property_id": p.property_id,
            "property_code": p.property_code,
            "name": p.name,
            "book_value": float(p.book_value),
            "replacement_value": float(p.replacement_value),
            "as_of": date.today().isoformat(),
            "source_system": "ERP-SIM",
            "status": "simulated_pull",
        }
        for p in properties
    ]
    logger.info("[SIMULATED ERP PULL] fetched book values for %d properties", len(rows))
    return rows


def build_claim_receipt_postings(
    db: Session,
    since: date | None = None,
    claim_id: int | None = None,
) -> list[dict]:
    """Shapes `Claim_Payments` rows into AR journal-entry records (one posting per
    payment: debit cash, credit the insurance receivable) — the "build" half of
    push, kept separate from "send" the same way notifications.build_notifications
    is separate from notifications.dispatch_notifications."""
    stmt = (
        select(models.ClaimPayment, models.Claim, models.Property)
        .join(models.Claim, models.ClaimPayment.claim_id == models.Claim.claim_id)
        .join(models.Incident, models.Claim.incident_id == models.Incident.incident_id)
        .join(models.Property, models.Incident.property_id == models.Property.property_id)
        .order_by(models.ClaimPayment.payment_date)
    )
    if since:
        stmt = stmt.where(models.ClaimPayment.payment_date >= since)
    if claim_id:
        stmt = stmt.where(models.ClaimPayment.claim_id == claim_id)

    postings = []
    for payment, claim, prop in db.execute(stmt).all():
        amount = float(payment.amount)
        postings.append({
            "payment_id": payment.payment_id,
            "claim_id": claim.claim_id,
            "claim_number": claim.claim_number,
            "property_code": prop.property_code,
            "payment_date": payment.payment_date.isoformat(),
            "amount": amount,
            "payment_type": payment.payment_type,
            "debit_account": GL_CASH_ACCOUNT,
            "credit_account": GL_RECEIVABLE_ACCOUNT,
            "memo": f"תקבול תביעה {claim.claim_number} — {prop.property_code}",
            "status": "built",
        })
    return postings


def post_claim_receipts(
    db: Session,
    since: date | None = None,
    claim_id: int | None = None,
) -> list[dict]:
    """build_claim_receipt_postings, then "posts" each entry to the simulated ERP
    ledger (logged at INFO, status flipped to "simulated_post"). See module
    docstring for why there's no real outbound call and no posted-state tracking."""
    postings = build_claim_receipt_postings(db, since=since, claim_id=claim_id)
    posted_at = datetime.utcnow().isoformat()
    for entry in postings:
        logger.info(
            "[SIMULATED ERP POST] %s: debit %s / credit %s, amount %.2f (%s)",
            entry["memo"], entry["debit_account"], entry["credit_account"], entry["amount"], entry["claim_number"],
        )
        entry["status"] = "simulated_post"
        entry["posted_at"] = posted_at
    return postings
