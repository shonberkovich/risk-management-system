from datetime import date, datetime

from sqlalchemy import (
    BigInteger, Boolean, Date, DateTime, ForeignKey, Numeric, SmallInteger, Unicode, UnicodeText,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class User(Base):
    __tablename__ = "Users"

    user_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    full_name: Mapped[str] = mapped_column(Unicode(100))
    email: Mapped[str] = mapped_column(Unicode(200), unique=True)
    role: Mapped[str] = mapped_column(Unicode(30))
    created_at: Mapped[datetime] = mapped_column(DateTime)


class Property(Base):
    __tablename__ = "Properties"

    property_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    property_code: Mapped[str] = mapped_column(Unicode(30), unique=True)
    name: Mapped[str] = mapped_column(Unicode(200))
    address: Mapped[str] = mapped_column(Unicode(300))
    region: Mapped[str] = mapped_column(Unicode(50))
    latitude: Mapped[float] = mapped_column(Numeric(9, 6))
    longitude: Mapped[float] = mapped_column(Numeric(9, 6))
    asset_type: Mapped[str] = mapped_column(Unicode(30))
    replacement_value: Mapped[float] = mapped_column(Numeric(18, 2))
    book_value: Mapped[float] = mapped_column(Numeric(18, 2))
    primary_manager_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("Users.user_id"), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime)
    updated_at: Mapped[datetime] = mapped_column(DateTime)

    risk_profile: Mapped["AssetRiskProfile"] = relationship(back_populates="property_", uselist=False)
    incidents: Mapped[list["Incident"]] = relationship(back_populates="property_")
    mitigation_tasks: Mapped[list["MitigationTask"]] = relationship(back_populates="property_")


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
    per_event_limit: Mapped[float | None] = mapped_column(Numeric(18, 2), nullable=True)
    bi_waiting_period_hours: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    exclusions: Mapped[str | None] = mapped_column(UnicodeText, nullable=True)


class PolicyAsset(Base):
    __tablename__ = "Policy_Assets"

    policy_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("Insurance_Policies.policy_id"), primary_key=True)
    property_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("Properties.property_id"), primary_key=True)
    specific_deductible: Mapped[float | None] = mapped_column(Numeric(18, 2), nullable=True)


class Incident(Base):
    __tablename__ = "Incidents"

    incident_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    incident_code: Mapped[str] = mapped_column(Unicode(20), unique=True)
    property_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("Properties.property_id"))
    reported_by_user_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("Users.user_id"), nullable=True)
    incident_timestamp: Mapped[datetime] = mapped_column(DateTime)
    hazard_type: Mapped[str] = mapped_column(Unicode(30))
    severity_level: Mapped[str] = mapped_column(Unicode(20))
    operational_impact: Mapped[str] = mapped_column(Unicode(20))
    initial_estimated_loss: Mapped[float] = mapped_column(Numeric(18, 2))
    description: Mapped[str] = mapped_column(UnicodeText)
    status: Mapped[str] = mapped_column(Unicode(30))
    ai_classified: Mapped[bool] = mapped_column(Boolean, default=False)
    ai_confidence: Mapped[float | None] = mapped_column(Numeric(4, 3), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime)
    is_draft: Mapped[bool] = mapped_column(Boolean, default=False)
    business_interruption_requested: Mapped[bool] = mapped_column(Boolean, default=False)
    area_or_building: Mapped[str | None] = mapped_column(Unicode(150), nullable=True)
    reported_coordinates: Mapped[str | None] = mapped_column(Unicode(50), nullable=True)

    property_: Mapped["Property"] = relationship(back_populates="incidents")
    media: Mapped[list["IncidentMedia"]] = relationship(back_populates="incident")
    claims: Mapped[list["Claim"]] = relationship(back_populates="incident")


class IncidentMedia(Base):
    __tablename__ = "Incident_Media"

    media_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    incident_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("Incidents.incident_id"))
    file_path: Mapped[str] = mapped_column(Unicode(500))
    file_type: Mapped[str] = mapped_column(Unicode(50))
    captured_at: Mapped[datetime] = mapped_column(DateTime)

    incident: Mapped["Incident"] = relationship(back_populates="media")


class Claim(Base):
    __tablename__ = "Claims"

    claim_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    claim_number: Mapped[str] = mapped_column(Unicode(30), unique=True)
    incident_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("Incidents.incident_id"))
    policy_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("Insurance_Policies.policy_id"))
    claimed_amount: Mapped[float] = mapped_column(Numeric(18, 2))
    deductible_applied: Mapped[float] = mapped_column(Numeric(18, 2), default=0)
    approved_amount: Mapped[float] = mapped_column(Numeric(18, 2), default=0)
    claim_status: Mapped[str] = mapped_column(Unicode(20))
    adjuster_name: Mapped[str | None] = mapped_column(Unicode(100), nullable=True)
    expected_payment_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime)

    incident: Mapped["Incident"] = relationship(back_populates="claims")
    payments: Mapped[list["ClaimPayment"]] = relationship(back_populates="claim")
    reserves: Mapped[list["ClaimReserve"]] = relationship(back_populates="claim")


class ClaimPayment(Base):
    __tablename__ = "Claim_Payments"

    payment_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    claim_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("Claims.claim_id"))
    payment_date: Mapped[date] = mapped_column(Date)
    amount: Mapped[float] = mapped_column(Numeric(18, 2))
    reference_number: Mapped[str | None] = mapped_column(Unicode(50), nullable=True)
    payment_type: Mapped[str] = mapped_column(Unicode(20))

    claim: Mapped["Claim"] = relationship(back_populates="payments")


class ClaimReserve(Base):
    __tablename__ = "Claim_Reserves"

    reserve_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    claim_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("Claims.claim_id"))
    reserve_amount: Mapped[float] = mapped_column(Numeric(18, 2))
    expected_payment_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime)

    claim: Mapped["Claim"] = relationship(back_populates="reserves")


class MitigationTask(Base):
    __tablename__ = "Mitigation_Tasks"

    task_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    property_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("Properties.property_id"))
    title: Mapped[str] = mapped_column(Unicode(200))
    cost_estimate: Mapped[float] = mapped_column(Numeric(18, 2))
    expected_annual_savings: Mapped[float] = mapped_column(Numeric(18, 2), default=0)
    due_date: Mapped[date] = mapped_column(Date)
    status: Mapped[str] = mapped_column(Unicode(20))
    assigned_to_user_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("Users.user_id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime)

    property_: Mapped["Property"] = relationship(back_populates="mitigation_tasks")
