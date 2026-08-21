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

A third, event-driven direction was added for the "פתיחת משימה אוטומטית
ב-ERP/תחזוקה בעת אירוע בחומרה קריטית" task: `open_maintenance_ticket` shapes
a single `Incidents` row (severity_level == "CRITICAL") into a maintenance
work-order the way an ERP/CMMS ticket-creation call would expect it, and
"opens" it the same simulated way — logged at WARNING (a critical incident is
noisier than a routine claim posting) with status="simulated_ticket". Called
from `routers/incidents.py` right after a CRITICAL incident is created or a
CRITICAL draft is submitted; unlike the pull/post functions above it is a
side effect of another router's write path, not its own endpoint, so it takes
an already-loaded `Incident` ORM object rather than querying for one.
`open_maintenance_ticket` itself never raises: the simulated "opening" call is
wrapped in a small retry-with-backoff (`_open_ticket_with_retry`, up to
`_TICKET_MAX_ATTEMPTS`), and if every attempt fails the ticket is appended to
an in-process `_pending_tickets` queue (see `retry_pending_tickets` /
`get_pending_tickets`) instead of the sync being silently dropped — added for
TODO_SPEC.md §3, "אובדן סנכרון תקלות בנפילת ERP מדומה".

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
import random
import time
from datetime import date, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import models

logger = logging.getLogger("rmis.integrations.erp")

# --- Retry/backoff + pending-queue for open_maintenance_ticket ---------------
# Added for TODO_SPEC.md §3, "אובדן סנכרון תקלות בנפילת ERP מדומה": even a
# simulated ERP call can represent a transient failure (the real SAP RFC /
# Priority REST call this stands in for would occasionally time out or 5xx),
# and routers/incidents.py calls open_maintenance_ticket() as a side effect of
# incident creation — it must never raise and break that write path. So the
# "opening" step is wrapped in a small retry-with-backoff, and if every retry
# still fails the ticket is queued in-process instead of lost, for a caller to
# re-attempt later via retry_pending_tickets().
_TICKET_MAX_ATTEMPTS = 3
_TICKET_BACKOFF_BASE_SECONDS = 0.25  # short: this is a mocked call, not a real network round trip; doubles each retry

# Course-project stand-in for "the outbound call sometimes fails transiently" —
# there's no real ERP endpoint to actually be flaky, so a small deterministic
# chance of raising is injected in _simulate_erp_ticket_call so the retry path
# has something real to retry against, the same spirit as the "simulated"
# pattern used elsewhere in this module.
_SIMULATED_TICKET_FAILURE_RATE = 0.15

# In-process queue of tickets whose simulated ERP call failed after every
# retry attempt. A simple module-level list is enough for this demo's scope
# (no persistent broker) — see retry_pending_tickets() to drain it.
_pending_tickets: list[dict] = []


class ErpTicketOpenError(RuntimeError):
    """Raised internally by _simulate_erp_ticket_call to represent a transient
    failure opening the ERP/CMMS ticket. Caught and retried by
    _open_ticket_with_retry; never escapes open_maintenance_ticket itself."""


def _simulate_erp_ticket_call(ticket: dict) -> None:
    """Stands in for the actual outbound SAP RFC / Priority REST call that
    would open the maintenance ticket. Occasionally raises ErpTicketOpenError
    to simulate a transient network failure (see _SIMULATED_TICKET_FAILURE_RATE
    above); a real integration replaces this function's body with the actual
    call and keeps the retry/queue wrapper around it unchanged."""
    if random.random() < _SIMULATED_TICKET_FAILURE_RATE:
        raise ErpTicketOpenError(
            f"simulated transient network failure opening {ticket['ticket_number']}"
        )


def _open_ticket_with_retry(ticket: dict) -> bool:
    """Attempts _simulate_erp_ticket_call up to _TICKET_MAX_ATTEMPTS times with
    short exponential backoff between attempts (plain time.sleep — this
    module's callers are all sync). Returns True once a call succeeds, False
    if every attempt failed. Never raises: a caller that exhausts retries just
    gets False back and decides what to do (open_maintenance_ticket queues it)."""
    for attempt in range(1, _TICKET_MAX_ATTEMPTS + 1):
        try:
            _simulate_erp_ticket_call(ticket)
            return True
        except ErpTicketOpenError as exc:
            logger.warning(
                "[SIMULATED ERP TICKET] attempt %d/%d failed for %s: %s",
                attempt, _TICKET_MAX_ATTEMPTS, ticket.get("ticket_number"), exc,
            )
            if attempt < _TICKET_MAX_ATTEMPTS:
                time.sleep(_TICKET_BACKOFF_BASE_SECONDS * (2 ** (attempt - 1)))
    return False


def retry_pending_tickets() -> dict:
    """Re-attempts every ticket currently queued in _pending_tickets (i.e.
    every open_maintenance_ticket call that failed all its retries). Tickets
    that succeed this time are removed from the queue and flip to
    status="simulated_ticket"; tickets that fail again stay queued for a
    future call. Safe to call repeatedly (e.g. from a scheduled job or an
    admin action) — never raises."""
    global _pending_tickets
    still_pending: list[dict] = []
    retried_ok = 0
    for ticket in _pending_tickets:
        if _open_ticket_with_retry(ticket):
            ticket["status"] = "simulated_ticket"
            ticket["opened_at"] = datetime.utcnow().isoformat()
            retried_ok += 1
            logger.warning(
                "[SIMULATED ERP TICKET] queued ticket %s opened successfully on retry",
                ticket.get("ticket_number"),
            )
        else:
            still_pending.append(ticket)
    _pending_tickets = still_pending
    logger.info(
        "[SIMULATED ERP TICKET] retry_pending_tickets: %d opened, %d still pending",
        retried_ok, len(_pending_tickets),
    )
    return {"retried_ok": retried_ok, "still_pending": len(_pending_tickets)}


def get_pending_tickets() -> list[dict]:
    """Read-only snapshot of tickets currently queued for retry (copies of the
    dicts, so a caller can't mutate the internal queue directly)."""
    return [dict(t) for t in _pending_tickets]

# In a real integration this would come from the ERP's chart of accounts /
# backend/.env config; fixed here for the same reason DEFAULT_RECIPIENTS is
# fixed in notifications.py — no account-directory table in the schema.
GL_CASH_ACCOUNT = "1010-CASH"
GL_RECEIVABLE_ACCOUNT = "1200-AR-INSURANCE"

_TICKET_TRIGGER_SEVERITY = "CRITICAL"


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


def open_maintenance_ticket(incident: models.Incident) -> dict | None:
    """Shapes a CRITICAL-severity incident into an ERP/CMMS maintenance work-order
    and "opens" it (logged at WARNING, status="simulated_ticket"). Returns None
    for any incident below CRITICAL severity — the router decides whether to call
    this at all, but the guard is repeated here so the function is safe to call
    unconditionally too. Takes an already-loaded Incident (not a db/id pair) since
    the caller (routers/incidents.py) always already has the row in hand right
    after creating or submitting it."""
    if incident.severity_level != _TICKET_TRIGGER_SEVERITY:
        return None

    ticket = {
        "ticket_number": f"ERP-TCK-{incident.incident_code}",
        "incident_id": incident.incident_id,
        "incident_code": incident.incident_code,
        "property_id": incident.property_id,
        "hazard_type": incident.hazard_type,
        "severity_level": incident.severity_level,
        "priority": "URGENT",
        "summary": f"טיפול דחוף נדרש — אירוע קריטי {incident.incident_code} ({incident.hazard_type})",
        "description": incident.description,
        "opened_at": datetime.utcnow().isoformat(),
        "source_system": "RMIS",
        "target_system": "ERP-SIM",
        "status": "simulated_ticket",
    }

    if _open_ticket_with_retry(ticket):
        logger.warning(
            "[SIMULATED ERP TICKET] opened %s for incident %s (property %s, hazard %s)",
            ticket["ticket_number"], incident.incident_code, incident.property_id, incident.hazard_type,
        )
    else:
        # All retries exhausted: never let this propagate into the
        # incident-creation write path in routers/incidents.py — log clearly
        # and queue the ticket so retry_pending_tickets() can pick it up later
        # instead of the sync being silently lost.
        ticket["status"] = "queued_for_retry"
        _pending_tickets.append(ticket)
        logger.error(
            "[SIMULATED ERP TICKET] failed to open %s for incident %s after %d attempts; queued for later retry",
            ticket["ticket_number"], incident.incident_code, _TICKET_MAX_ATTEMPTS,
        )
    return ticket
