from datetime import date, datetime, timezone

from sqlalchemy import (
    BigInteger, Boolean, Date, DateTime, Float, ForeignKey, Numeric, SmallInteger, Unicode, UnicodeText,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.services.encryption import EncryptedString, EncryptedText


def _utcnow() -> datetime:
    """Python-side default for "now"-style timestamp columns (created_at/updated_at/
    timestamp/sent_at/...), returned as a naive datetime that is always UTC (never the
    server/local timezone). All DateTime columns in this file are naive by convention
    (SQL Server DATETIME2, no offset) — callers must pass UTC-normalized values (e.g.
    `datetime.now(timezone.utc).replace(tzinfo=None)`, not bare `datetime.now()`) for the
    same reason. This default only fires when a router omits the column entirely; it
    doesn't retroactively fix a call site that explicitly passes a local-time value."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


class User(Base):
    __tablename__ = "Users"

    user_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    full_name: Mapped[str] = mapped_column(Unicode(100))
    email: Mapped[str] = mapped_column(Unicode(200), unique=True)
    role: Mapped[str] = mapped_column(Unicode(30))
    password_hash: Mapped[str | None] = mapped_column(Unicode(255), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)


class Region(Base):
    __tablename__ = "Regions"

    region_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    region_code: Mapped[str] = mapped_column(Unicode(20), unique=True)
    name: Mapped[str] = mapped_column(Unicode(100))


class Property(Base):
    __tablename__ = "Properties"

    property_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    property_code: Mapped[str] = mapped_column(Unicode(30), unique=True)
    name: Mapped[str] = mapped_column(Unicode(200))
    address: Mapped[str] = mapped_column(Unicode(300))
    region: Mapped[str] = mapped_column(Unicode(50))
    region_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("Regions.region_id"), nullable=True)
    latitude: Mapped[float] = mapped_column(Numeric(9, 6))
    longitude: Mapped[float] = mapped_column(Numeric(9, 6))
    asset_type: Mapped[str] = mapped_column(Unicode(30))
    replacement_value: Mapped[float] = mapped_column(Numeric(18, 2))
    book_value: Mapped[float] = mapped_column(Numeric(18, 2))
    primary_manager_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("Users.user_id"), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)

    risk_profile: Mapped["AssetRiskProfile"] = relationship(back_populates="property_", uselist=False)
    incidents: Mapped[list["Incident"]] = relationship(back_populates="property_", passive_deletes=True)
    mitigation_tasks: Mapped[list["MitigationTask"]] = relationship(back_populates="property_", passive_deletes=True)
    primary_manager: Mapped["User | None"] = relationship()
    policy_assets: Mapped[list["PolicyAsset"]] = relationship(back_populates="property_", passive_deletes=True)


class AssetRiskProfile(Base):
    __tablename__ = "Asset_Risk_Profiles"

    profile_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    property_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("Properties.property_id"))
    survey_date: Mapped[date] = mapped_column(Date)
    flood_risk_score: Mapped[int] = mapped_column(SmallInteger)
    fire_risk_score: Mapped[int] = mapped_column(SmallInteger)
    earthquake_risk_score: Mapped[int] = mapped_column(SmallInteger)
    mfl_amount: Mapped[float] = mapped_column(Numeric(18, 2))
    has_sprinklers: Mapped[bool] = mapped_column(Boolean)
    notes: Mapped[str | None] = mapped_column(UnicodeText, nullable=True)
    # TODO_SPEC.md §11 item 1: proximity to a hazmat/dangerous-materials site,
    # feeding a fire-risk-score penalty (see app/integrations/environmental.py
    # and, per §13, routers/risk_profiles.py — out of this branch's scope).
    near_hazmat_site: Mapped[bool] = mapped_column(Boolean, default=False)

    property_: Mapped["Property"] = relationship(back_populates="risk_profile")


class InsurancePolicy(Base):
    __tablename__ = "Insurance_Policies"

    policy_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    policy_number: Mapped[str] = mapped_column(Unicode(50), unique=True)
    insurer_name: Mapped[str] = mapped_column(Unicode(150))
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date] = mapped_column(Date)
    total_limit: Mapped[float] = mapped_column(Numeric(18, 2))
    deductible_default: Mapped[float] = mapped_column(Numeric(18, 2))
    annual_premium: Mapped[float] = mapped_column(Numeric(18, 2))
    status: Mapped[str] = mapped_column(Unicode(20))
    # Encrypted at rest (see services/encryption.py) — a per-event coverage term that's
    # only ever read one policy at a time (never SUM'd/AVG'd across policies like
    # annual_premium/total_limit/deductible_default are), so it's safe to encrypt.
    per_event_limit: Mapped[str | None] = mapped_column(EncryptedString(64), nullable=True)
    bi_waiting_period_hours: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    exclusions: Mapped[str | None] = mapped_column(UnicodeText, nullable=True)


class PolicyAsset(Base):
    __tablename__ = "Policy_Assets"

    policy_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("Insurance_Policies.policy_id"), primary_key=True)
    property_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("Properties.property_id", ondelete="CASCADE"), primary_key=True
    )
    # Encrypted at rest (see services/encryption.py) — same rationale as
    # Insurance_Policies.per_event_limit above: a single-property coverage term, never
    # aggregated across rows.
    specific_deductible: Mapped[str | None] = mapped_column(EncryptedString(64), nullable=True)

    policy: Mapped["InsurancePolicy"] = relationship()
    property_: Mapped["Property"] = relationship(back_populates="policy_assets")


class Incident(Base):
    __tablename__ = "Incidents"

    incident_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    incident_code: Mapped[str] = mapped_column(Unicode(20), unique=True)
    property_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("Properties.property_id", ondelete="CASCADE"))
    reported_by_user_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("Users.user_id"), nullable=True)
    # When the incident actually happened, as reported by the field/property user — a
    # domain value, not a "now" default, but must still be normalized to naive UTC by the
    # caller before assignment (see `_utcnow` above) rather than a bare local `datetime.now()`.
    incident_timestamp: Mapped[datetime] = mapped_column(DateTime)
    hazard_type: Mapped[str] = mapped_column(Unicode(30))
    severity_level: Mapped[str] = mapped_column(Unicode(20))
    operational_impact: Mapped[str] = mapped_column(Unicode(20))
    initial_estimated_loss: Mapped[float] = mapped_column(Numeric(18, 2))
    description: Mapped[str] = mapped_column(UnicodeText)
    status: Mapped[str] = mapped_column(Unicode(30))
    ai_classified: Mapped[bool] = mapped_column(Boolean, default=False)
    ai_confidence: Mapped[float | None] = mapped_column(Numeric(4, 3), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)
    is_draft: Mapped[bool] = mapped_column(Boolean, default=False)
    business_interruption_requested: Mapped[bool] = mapped_column(Boolean, default=False)
    area_or_building: Mapped[str | None] = mapped_column(Unicode(150), nullable=True)
    reported_coordinates: Mapped[str | None] = mapped_column(Unicode(50), nullable=True)
    # TODO_SPEC.md §11 item 2: street address reverse-geocoded from
    # reported_coordinates via OSM Nominatim (see app/integrations/gis.py).
    # MUST be Unicode (not String) — see CLAUDE.md's Hebrew-text gotcha;
    # Nominatim can return Hebrew street/city names for Israeli coordinates.
    resolved_address: Mapped[str | None] = mapped_column(Unicode(255), nullable=True)

    property_: Mapped["Property"] = relationship(back_populates="incidents")
    media: Mapped[list["IncidentMedia"]] = relationship(back_populates="incident", passive_deletes=True)
    claims: Mapped[list["Claim"]] = relationship(back_populates="incident", passive_deletes=True)


class IncidentMedia(Base):
    __tablename__ = "Incident_Media"

    media_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    incident_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("Incidents.incident_id", ondelete="CASCADE"))
    file_path: Mapped[str] = mapped_column(Unicode(500))
    file_type: Mapped[str] = mapped_column(Unicode(50))
    captured_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)
    gps_latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    gps_longitude: Mapped[float | None] = mapped_column(Float, nullable=True)

    incident: Mapped["Incident"] = relationship(back_populates="media")


class Claim(Base):
    __tablename__ = "Claims"

    claim_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    claim_number: Mapped[str] = mapped_column(Unicode(30), unique=True)
    incident_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("Incidents.incident_id", ondelete="CASCADE"))
    policy_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("Insurance_Policies.policy_id"))
    claimed_amount: Mapped[float] = mapped_column(Numeric(18, 2))
    deductible_applied: Mapped[float] = mapped_column(Numeric(18, 2), default=0)
    approved_amount: Mapped[float] = mapped_column(Numeric(18, 2), default=0)
    claim_status: Mapped[str] = mapped_column(Unicode(20))
    # Encrypted at rest (see services/encryption.py) — personal data, read-and-displayed
    # only, never searched/aggregated. Widened from 100 to fit ciphertext.
    adjuster_name: Mapped[str | None] = mapped_column(EncryptedString(255), nullable=True)
    expected_payment_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)

    incident: Mapped["Incident"] = relationship(back_populates="claims")
    payments: Mapped[list["ClaimPayment"]] = relationship(back_populates="claim", passive_deletes=True)
    reserves: Mapped[list["ClaimReserve"]] = relationship(back_populates="claim", passive_deletes=True)


class ClaimPayment(Base):
    __tablename__ = "Claim_Payments"

    payment_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    claim_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("Claims.claim_id", ondelete="CASCADE"))
    payment_date: Mapped[date] = mapped_column(Date)
    amount: Mapped[float] = mapped_column(Numeric(18, 2))
    # Encrypted at rest (see services/encryption.py) — deliberately not `amount`, which
    # services/kpi.py aggregates in SQL (SUM/AVG); encrypting an aggregated column would
    # force decrypt-then-aggregate in Python, defeating the point of SQL-side aggregation.
    reference_number: Mapped[str | None] = mapped_column(EncryptedString(255), nullable=True)
    payment_type: Mapped[str] = mapped_column(Unicode(20))

    claim: Mapped["Claim"] = relationship(back_populates="payments")


class ClaimReserve(Base):
    __tablename__ = "Claim_Reserves"

    reserve_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    claim_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("Claims.claim_id", ondelete="CASCADE"))
    reserve_amount: Mapped[float] = mapped_column(Numeric(18, 2))
    expected_payment_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)

    claim: Mapped["Claim"] = relationship(back_populates="reserves")


class MitigationTask(Base):
    __tablename__ = "Mitigation_Tasks"

    task_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    property_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("Properties.property_id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(Unicode(200))
    cost_estimate: Mapped[float] = mapped_column(Numeric(18, 2))
    expected_annual_savings: Mapped[float] = mapped_column(Numeric(18, 2), default=0)
    due_date: Mapped[date] = mapped_column(Date)
    status: Mapped[str] = mapped_column(Unicode(20))
    assigned_to_user_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("Users.user_id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)

    property_: Mapped["Property"] = relationship(back_populates="mitigation_tasks")


class AuditLog(Base):
    __tablename__ = "Audit_Log"

    log_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    user_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("Users.user_id"), nullable=True)
    entity_type: Mapped[str] = mapped_column(Unicode(50))
    entity_id: Mapped[int] = mapped_column(BigInteger)
    action: Mapped[str] = mapped_column(Unicode(20))
    # Encrypted at rest (see services/encryption.py) — before/after snapshot of a
    # mutating request, which can itself carry other sensitive fields (e.g. a
    # user-creation payload). Never filtered/searched by value (routers/audit.py only
    # filters on entity_type/entity_id/user_id/action/timestamp).
    old_value: Mapped[str | None] = mapped_column(EncryptedText, nullable=True)
    new_value: Mapped[str | None] = mapped_column(EncryptedText, nullable=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)
    ip_address: Mapped[str | None] = mapped_column(Unicode(45), nullable=True)


class RolePermission(Base):
    __tablename__ = "Role_Permissions"
    __table_args__ = (
        # Mirrors schema.sql's UQ_RolePermissions_RoleKey — was previously only
        # enforced at the DB level (SQL Server), not on the in-memory SQLite test DB
        # built from this metadata, so tests couldn't catch a duplicate (role,
        # permission_key) pair. See CLAUDE.md's note on schema.sql/models.py index
        # mirroring gaps — this one is a data-integrity constraint, not just an index,
        # so it's mirrored here rather than left as a documented gap.
        UniqueConstraint("role", "permission_key", name="uq_role_permissions_role_key"),
    )

    role_permission_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    role: Mapped[str] = mapped_column(Unicode(30))
    permission_key: Mapped[str] = mapped_column(Unicode(100))
    description: Mapped[str | None] = mapped_column(Unicode(200), nullable=True)


class Document(Base):
    __tablename__ = "Documents"

    document_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    entity_type: Mapped[str] = mapped_column(Unicode(20))
    entity_id: Mapped[int] = mapped_column(BigInteger)
    s3_url: Mapped[str] = mapped_column(Unicode(500))
    doc_type: Mapped[str] = mapped_column(Unicode(30))
    uploaded_by: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("Users.user_id"), nullable=True)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)


class FinancialStatement(Base):
    __tablename__ = "Financial_Statements"

    statement_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    year: Mapped[int] = mapped_column(SmallInteger, unique=True)
    total_assets: Mapped[float] = mapped_column(Numeric(18, 2))
    revenue: Mapped[float] = mapped_column(Numeric(18, 2))
    net_income: Mapped[float] = mapped_column(Numeric(18, 2))
    insurance_expense: Mapped[float] = mapped_column(Numeric(18, 2))
    # Full balance sheet / P&L fields (nullable: existing rows and any statement
    # loaded before a full breakdown is available won't have these yet). Together
    # with total_assets these let financials.py compute shareholders' equity-based
    # capital adequacy instead of the total_assets proxy it used to fall back on,
    # and gross/operating margins alongside the existing net_income_margin.
    total_liabilities: Mapped[float | None] = mapped_column(Numeric(18, 2), nullable=True)
    total_equity: Mapped[float | None] = mapped_column(Numeric(18, 2), nullable=True)
    gross_profit: Mapped[float | None] = mapped_column(Numeric(18, 2), nullable=True)
    operating_profit: Mapped[float | None] = mapped_column(Numeric(18, 2), nullable=True)


class NotificationRecipient(Base):
    """Who gets paged by services/notifications.py, and how. Replaces the previous
    hardcoded DEFAULT_RECIPIENTS list in that module with a DB-backed table so
    recipients can eventually be managed through the UI (TODO_SPEC.md §1) instead of
    requiring a code change. `channels` is a comma-separated subset of EMAIL/SMS/PUSH
    (SQL Server LocalDB has no native array/set column type, and this mirrors the
    free-text convention already used for Users.role); parsed to a tuple by
    services/notifications.py, not enforced at the DB layer."""
    __tablename__ = "Notification_Recipients"

    recipient_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    role: Mapped[str] = mapped_column(Unicode(30))
    display_name: Mapped[str] = mapped_column(Unicode(100))
    email: Mapped[str] = mapped_column(Unicode(200))
    phone: Mapped[str] = mapped_column(Unicode(30))
    channels: Mapped[str] = mapped_column(Unicode(30))
    min_severity: Mapped[str] = mapped_column(Unicode(20), default="warning")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class NotificationLog(Base):
    """Audit trail of notifications actually dispatched by
    services/notifications.dispatch_notifications — one row per (alert, recipient,
    channel) combination that was "sent" (simulated, see that module's docstring).
    Write-only from the app's perspective at dispatch time; read via
    GET /api/notifications/log (TODO_SPEC.md §1, "טבלת Notification_Log"). Distinct
    from Notification_Recipients (who *can* be paged) — this is what was actually
    paged, and when. `property_ids` mirrors the comma-separated-string convention
    used for Notification_Recipients.channels (no array column type in SQL Server
    LocalDB)."""
    __tablename__ = "Notification_Log"

    log_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    alert_type: Mapped[str] = mapped_column(Unicode(50))
    severity: Mapped[str] = mapped_column(Unicode(20))
    recipient_role: Mapped[str] = mapped_column(Unicode(30))
    recipient_name: Mapped[str] = mapped_column(Unicode(100))
    channel: Mapped[str] = mapped_column(Unicode(10))
    contact: Mapped[str] = mapped_column(Unicode(200))
    title: Mapped[str] = mapped_column(Unicode(200))
    message: Mapped[str] = mapped_column(UnicodeText)
    property_ids: Mapped[str] = mapped_column(Unicode(500))  # comma-separated bigint list
    value: Mapped[float] = mapped_column(Numeric(18, 4))
    threshold: Mapped[float] = mapped_column(Numeric(18, 4))
    status: Mapped[str] = mapped_column(Unicode(20))
    sent_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)


class AgentSession(Base):
    """A conversation thread with the AI agent orchestrator (TODO_SPEC.md §1/§2) —
    one row per session, carrying short/long-term context so a multi-turn chat (or a
    later request that references the same session_id) can pick up where it left off
    without resending the whole history. `session_id` is a client-generated UUID
    string (not an identity column) so the frontend can mint it before the first
    message is ever persisted. `context_data` is a free-form JSON blob (serialized
    conversation state, last routed agent, tool results, etc.) — SQL Server LocalDB
    has no native JSON column type, so it's stored as NVARCHAR(MAX) like every other
    "structured text" column in this file (see Notification_Log.property_ids) and
    (de)serialized by the orchestrator layer, not enforced at the DB layer."""
    __tablename__ = "Agent_Sessions"

    session_id: Mapped[str] = mapped_column(Unicode(64), primary_key=True)
    user_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("Users.user_id"), nullable=True)
    context_data: Mapped[str | None] = mapped_column(UnicodeText, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)

    user: Mapped["User | None"] = relationship()
    actions: Mapped[list["AgentActionLog"]] = relationship(back_populates="session", passive_deletes=True)


class Email(Base):
    """An internal email/message (TODO_SPEC.md, "משימה 1"). `thread_id` is a
    self-referencing FK to this same table's `email_id`, pointing at the thread's
    root email (not a separate Threads table): the first message in a thread has
    `thread_id = NULL` (it *is* the root), and every reply sets `thread_id` to that
    root's `email_id` — so "all messages in a thread" is a flat
    `WHERE email_id = :root_id OR thread_id = :root_id` query, and the root is
    reachable in one hop from any reply instead of walking a parent chain. A
    separate `Email_Threads` table would model an arbitrary reply tree (parent-of-
    reply) but the spec (task 3 step 4 / task 2's `EmailThreadOut`) only calls for
    flat "all messages in this thread" retrieval, so the cheaper self-FK is enough.
    `status` is a plain free-text column for now (e.g. "SENT"/"DRAFT"); task 13
    adds a "SCHEDULED" status later — not built out here.

    `body_html` deliberately stays a plain `UnicodeText`, not `EncryptedText`
    (TODO_SPEC.md "משימה 10" step 3, explicitly optional) — considered and decided
    against, for two reasons: (1) `services/encryption.py`'s own docstring scopes
    `EncryptedText`/`EncryptedString` to columns that are "read-and-displayed-as-is,
    never summed or filtered by value in SQL"; `body_html` is exactly the column
    Task 10 step 4 adds a `LIKE`-based search over (`services/email.py`'s
    `list_emails_for_user`, `q` param) — an encrypted column can't be filtered at
    the DB layer at all (every row would need decrypting in Python first, which
    defeats a `LIKE` query's whole point), so encrypting here would directly break
    the very next step of this same task. (2) Per CLAUDE.md, this is a course demo
    over an internal, general-purpose (not role-gated) mailbox — not a regulated
    PII/financial column like `Claims.adjuster_name` or `Claim_Payments.
    reference_number`, the kind of field this app *does* encrypt. RBAC (Task 5) plus
    the Task 10 BCC/enumeration fixes above are this feature's real access-control
    boundary; DB-at-rest encryption of the body would add real complexity (breaking
    search, and every future feature that reads body_html — Task 15's AI summarizer
    included) for a demo-scoped, low-sensitivity data class. If a future task needs
    encryption here despite the search trade-off, `EncryptedText` is a drop-in swap
    for `UnicodeText` (see encryption.py) — no other refactor required."""
    __tablename__ = "Emails"

    email_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    sender_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("Users.user_id"))
    subject: Mapped[str] = mapped_column(Unicode(500))
    body_html: Mapped[str] = mapped_column(UnicodeText)
    thread_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("Emails.email_id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)
    status: Mapped[str] = mapped_column(Unicode(20), default="SENT")

    sender: Mapped["User"] = relationship()
    thread_root: Mapped["Email | None"] = relationship(remote_side="Email.email_id", back_populates="replies")
    replies: Mapped[list["Email"]] = relationship(back_populates="thread_root", passive_deletes=True)
    recipients: Mapped[list["EmailRecipient"]] = relationship(back_populates="email", passive_deletes=True)
    attachments: Mapped[list["EmailAttachment"]] = relationship(back_populates="email", passive_deletes=True)


class EmailRecipient(Base):
    """One (email, user) delivery record — one row per recipient per folder copy,
    including the sender's own SENT-folder copy (TODO_SPEC.md task 3 step 3;
    "SENT" isn't in task 2's literal folder list but is needed so a sender sees
    their own outgoing mail)."""
    __tablename__ = "Email_Recipients"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    email_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("Emails.email_id", ondelete="CASCADE"))
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("Users.user_id"))
    recipient_type: Mapped[str] = mapped_column(Unicode(10))
    is_read: Mapped[bool] = mapped_column(Boolean, default=False)
    folder: Mapped[str] = mapped_column(Unicode(20), default="INBOX")

    email: Mapped["Email"] = relationship(back_populates="recipients")
    user: Mapped["User"] = relationship()


class EmailAttachment(Base):
    __tablename__ = "Email_Attachments"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    email_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("Emails.email_id", ondelete="CASCADE"))
    file_path: Mapped[str] = mapped_column(Unicode(500))
    file_name: Mapped[str] = mapped_column(Unicode(255))
    file_size: Mapped[int] = mapped_column(BigInteger)
    content_type: Mapped[str] = mapped_column(Unicode(100))

    email: Mapped["Email"] = relationship(back_populates="attachments")


class EntityEmail(Base):
    """Contextual link between an email thread and a business entity (Incident/
    Claim/Property) — TODO_SPEC.md "משימה 11": "קישור שרשור מיילים ישירות
    לאירוע/תביעה/נכס". `email_id` always stores the THREAD ROOT's email_id
    (the same value `Email.thread_id` points at for every reply in that
    thread, or the message's own `email_id` if it has no `thread_id` at all —
    i.e. `email.thread_id if email.thread_id is not None else email.email_id`),
    never an individual reply's id. The spec's own wording is "link a
    *thread* to an entity", and every message in a thread already shares one
    root by construction (see `Email`'s docstring) — storing the root once
    means "is this thread linked to entity X" is a single equality check
    instead of a fan-out over every message in the thread, and a thread
    linked from any one of its messages (root or reply) is linked as a
    whole, matching how `GET /api/emails/{id}` already always resolves to a
    thread rather than a single message. A separate design (link the
    specific message id from the URL, not the root) would let one reply be
    "linked" while its siblings aren't, which doesn't match "link a
    thread" and would force every consumer of this table to re-derive the
    thread anyway to show it as one linked conversation.

    `entity_type` mirrors `Document.entity_type`'s naming style but is
    deliberately a narrower set: "INCIDENT"/"CLAIM"/"PROPERTY" only (no
    "POLICY" — the spec's own step 1 names only these three entities for
    this task, unlike Documents' four).

    `linked_by`/`linked_at` record who created the link and when. `auto_linked`
    distinguishes an automatic link created by the optional step-5
    subject-line detector (`services/email.autodetect_entity_links`) from one
    a user created via `POST /api/emails/{id}/link` — auto-created rows still
    set `linked_by` to the email's own sender (the person "responsible" for
    the auto-link), so the column is never nullable; `auto_linked` is what
    actually distinguishes the two origins, not a null-vs-set `linked_by`.

    The (email_id, entity_type, entity_id) uniqueness constraint prevents the
    same thread from being linked to the same entity twice (e.g. re-running
    auto-detection on a second reply in an already-linked thread, or a user
    clicking "link" twice) — `services/email.link_email_to_entity` is
    idempotent against it, returning the existing row instead of erroring."""
    __tablename__ = "Entity_Emails"
    __table_args__ = (
        UniqueConstraint("email_id", "entity_type", "entity_id", name="uq_entity_emails_email_entity"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    email_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("Emails.email_id", ondelete="CASCADE"))
    entity_type: Mapped[str] = mapped_column(Unicode(20))
    entity_id: Mapped[int] = mapped_column(BigInteger)
    linked_by: Mapped[int] = mapped_column(BigInteger, ForeignKey("Users.user_id"))
    linked_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)
    auto_linked: Mapped[bool] = mapped_column(Boolean, default=False)

    email: Mapped["Email"] = relationship()
    linked_by_user: Mapped["User"] = relationship()


class AgentActionLog(Base):
    """Audit trail of autonomous/semi-autonomous actions proposed or taken by an AI
    agent within a session (e.g. drafting an Incident, proposing a Mitigation_Task) —
    TODO_SPEC.md §1. `action_type` is a free-text label (e.g. "CREATE_INCIDENT_DRAFT",
    "CREATE_MITIGATION_TASK_PROPOSAL"); `payload` is the JSON the agent built for that
    action (candidate row data, tool call args/results), same NVARCHAR(MAX)-as-JSON
    convention as Agent_Sessions.context_data. `status` tracks the human-in-the-loop
    lifecycle used by the Action/Compliance agent (TODO_SPEC.md §5): "proposed" until
    a user approves it, then "confirmed"/"rejected"."""
    __tablename__ = "Agent_Actions_Log"

    action_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    session_id: Mapped[str] = mapped_column(
        Unicode(64), ForeignKey("Agent_Sessions.session_id", ondelete="CASCADE")
    )
    action_type: Mapped[str] = mapped_column(Unicode(50))
    payload: Mapped[str | None] = mapped_column(UnicodeText, nullable=True)
    status: Mapped[str] = mapped_column(Unicode(20), default="proposed")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)

    session: Mapped["AgentSession"] = relationship(back_populates="actions")
