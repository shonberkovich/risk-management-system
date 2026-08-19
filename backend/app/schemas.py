from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

HazardType = Literal["FLOOD", "FIRE", "STRUCTURAL_FAILURE", "THEFT", "ELECTRICAL", "OTHER"]
SeverityLevel = Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"]
OperationalImpact = Literal["FULL_OPERATION", "PARTIAL_SHUTDOWN", "FULL_SHUTDOWN"]
IncidentStatus = Literal["NEW", "UNDER_INVESTIGATION", "CLAIM_FILED", "CLOSED"]
ClaimStatus = Literal["DRAFT", "SUBMITTED", "IN_ADJUSTMENT", "APPROVED", "REJECTED", "SETTLED"]
AssetType = Literal["LOGISTICS_CENTER", "OFFICE_BUILDING", "RETAIL", "INFRASTRUCTURE"]
MitigationStatus = Literal["OPEN", "IN_PROGRESS", "COMPLETED", "OVERDUE"]
PolicyStatus = Literal["ACTIVE", "EXPIRED", "PENDING_RENEWAL"]
PaymentType = Literal["ADVANCE", "FINAL_SETTLEMENT"]


# --- Properties ---
class RiskProfileOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    profile_id: int
    survey_date: date
    flood_risk_score: int
    fire_risk_score: int
    earthquake_risk_score: int
    mfl_amount: float
    has_sprinklers: bool
    notes: str | None = None


class PropertyOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    property_id: int
    property_code: str
    name: str
    address: str
    region: str
    latitude: float
    longitude: float
    asset_type: AssetType
    replacement_value: float
    book_value: float
    is_active: bool
    risk_profile: RiskProfileOut | None = None


class PropertyMapPoint(BaseModel):
    property_id: int
    name: str
    latitude: float
    longitude: float
    asset_type: AssetType
    replacement_value: float
    status_color: Literal["green", "yellow", "red"]
    open_incidents: int


# --- Incidents ---
class IncidentCreate(BaseModel):
    property_id: int
    reported_by_user_id: int | None = None
    incident_timestamp: datetime
    hazard_type: HazardType
    severity_level: SeverityLevel
    operational_impact: OperationalImpact
    initial_estimated_loss: float
    description: str
    ai_classified: bool = False
    ai_confidence: float | None = None
    is_draft: bool = False
    business_interruption_requested: bool = False
    area_or_building: str | None = None
    reported_coordinates: str | None = None  # "lat,lng"


class IncidentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    incident_id: int
    incident_code: str
    property_id: int
    incident_timestamp: datetime
    hazard_type: HazardType
    severity_level: SeverityLevel
    operational_impact: OperationalImpact
    initial_estimated_loss: float
    description: str
    status: IncidentStatus
    ai_classified: bool
    ai_confidence: float | None = None
    is_draft: bool
    business_interruption_requested: bool
    area_or_building: str | None = None
    reported_coordinates: str | None = None


class IncidentUpdate(BaseModel):
    """Edits a draft's content before submission — see PATCH /{incident_id}.
    Only usable while the incident is still a draft (is_draft=True)."""
    property_id: int | None = None
    incident_timestamp: datetime | None = None
    hazard_type: HazardType | None = None
    severity_level: SeverityLevel | None = None
    operational_impact: OperationalImpact | None = None
    initial_estimated_loss: float | None = None
    description: str | None = None
    business_interruption_requested: bool | None = None
    area_or_building: str | None = None
    reported_coordinates: str | None = None


class IncidentStatusUpdate(BaseModel):
    status: IncidentStatus


# --- Claims ---
class ClaimOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    claim_id: int
    claim_number: str
    incident_id: int
    policy_id: int
    claimed_amount: float
    deductible_applied: float
    approved_amount: float
    claim_status: ClaimStatus
    adjuster_name: str | None = None
    expected_payment_date: date | None = None


class ClaimCreate(BaseModel):
    incident_id: int
    policy_id: int
    claimed_amount: float
    deductible_applied: float = 0
    adjuster_name: str | None = None
    expected_payment_date: date | None = None


class ClaimUpdate(BaseModel):
    claim_status: ClaimStatus | None = None
    approved_amount: float | None = None
    adjuster_name: str | None = None
    expected_payment_date: date | None = None


class ClaimPaymentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    payment_id: int
    claim_id: int
    payment_date: date
    amount: float
    reference_number: str | None = None
    payment_type: PaymentType


class ClaimPaymentCreate(BaseModel):
    payment_date: date
    amount: float
    reference_number: str | None = None
    payment_type: PaymentType


class ClaimTrackingRow(BaseModel):
    claim_id: int
    claim_number: str
    property_name: str
    incident_date: datetime
    hazard_type: HazardType
    claimed_amount: float
    deductible_applied: float
    approved_amount: float
    claim_status: ClaimStatus
    expected_payment_date: date | None = None
    paid_amount: float = 0


# --- Policies ---
class PolicyOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    policy_id: int
    policy_number: str
    insurer_name: str
    start_date: date
    end_date: date
    total_limit: float
    deductible_default: float
    annual_premium: float
    status: PolicyStatus


class PolicyCreate(BaseModel):
    policy_number: str
    insurer_name: str
    start_date: date
    end_date: date
    total_limit: float
    deductible_default: float
    annual_premium: float
    status: PolicyStatus = "ACTIVE"


class PolicyUpdate(BaseModel):
    insurer_name: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    total_limit: float | None = None
    deductible_default: float | None = None
    annual_premium: float | None = None
    status: PolicyStatus | None = None


class PolicyAssetOut(BaseModel):
    policy_id: int
    property_id: int
    property_name: str
    specific_deductible: float | None = None


class PolicyAssetCreate(BaseModel):
    property_id: int
    specific_deductible: float | None = None


# --- Incident Media ---
class IncidentMediaOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    media_id: int
    incident_id: int
    file_path: str  # storage_key within media_storage — see services/storage.py
    file_type: str
    captured_at: datetime
    gps_latitude: float | None = None
    gps_longitude: float | None = None


DocumentEntityType = Literal["INCIDENT", "CLAIM", "PROPERTY", "POLICY"]


class DocumentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    document_id: int
    entity_type: DocumentEntityType
    entity_id: int
    s3_url: str  # storage_key within media_storage — see services/storage.py (mirrors IncidentMediaOut.file_path)
    doc_type: str
    uploaded_by: int | None = None
    uploaded_at: datetime


class ClaimWithPaymentsOut(ClaimOut):
    payments: list[ClaimPaymentOut] = []


class IncidentDrillDown(BaseModel):
    """Unified incident file: everything linked to one incident in a single call —
    the incident itself, its media, its claim(s) each with their payments, and any
    documents attached directly to it (Documents.entity_type == "INCIDENT")."""
    incident: IncidentOut
    media: list[IncidentMediaOut]
    claims: list[ClaimWithPaymentsOut]
    documents: list[DocumentOut]


class SignedUrlOut(BaseModel):
    url: str  # illustrative S3-style reference (see services/storage.py) — not fetchable
    download_url: str  # actually fetchable: GET /api/media/download?key=...&expires=...&token=...
    storage_key: str
    expires_at: int


# --- Mitigation ---
class MitigationTaskOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    task_id: int
    property_id: int
    title: str
    cost_estimate: float
    expected_annual_savings: float
    due_date: date
    status: MitigationStatus
    assigned_to_user_id: int | None = None
    roi_percent: float | None = None


class MitigationTaskCreate(BaseModel):
    property_id: int
    title: str
    cost_estimate: float
    expected_annual_savings: float = 0
    due_date: date
    assigned_to_user_id: int | None = None


class MitigationTaskUpdate(BaseModel):
    title: str | None = None
    cost_estimate: float | None = None
    expected_annual_savings: float | None = None
    due_date: date | None = None
    status: MitigationStatus | None = None
    assigned_to_user_id: int | None = None


class MitigationRoiBreakdown(BaseModel):
    task_id: int
    property_id: int
    title: str
    status: MitigationStatus
    cost_estimate: float
    expected_annual_savings_total: float
    expected_premium_savings: float
    expected_loss_savings: float
    has_active_policy: bool
    roi_percent: float | None = None
    payback_years: float | None = None


# --- Analytics ---
class KpiSummary(BaseModel):
    tiv: float                  # Total Insured Value
    mfl: float                  # Maximum Foreseeable Loss (max geographic cluster exposure)
    open_claims_count: int
    open_claims_amount: float
    approved_pending_amount: float
    loss_ratio: float           # claims YTD / premiums YTD
    total_annual_premium: float


class RiskMatrixCell(BaseModel):
    probability_band: Literal["low", "medium", "high"]
    severity_band: Literal["low", "medium", "high"]
    count: int
    property_ids: list[int]


class HazardDistributionItem(BaseModel):
    hazard_type: HazardType
    count: int
    percent: float


class LossRatioTrendPoint(BaseModel):
    year: int
    loss_ratio: float
    total_claimed: float
    total_annual_premium: float


class CashflowMonthPoint(BaseModel):
    month: str  # "YYYY-MM"
    expected_receipts: float
    open_reserves: float


class CashflowSummary(BaseModel):
    total_open_reserves: float
    total_expected_receipts: float
    unscheduled_reserves: float
    monthly: list[CashflowMonthPoint]


class RegionExposure(BaseModel):
    region_id: int | None = None
    region_name: str
    tiv: float
    mfl: float
    total_claimed: float


class GeographicExposureCluster(BaseModel):
    property_ids: list[int]
    property_names: list[str]
    property_count: int
    center_lat: float
    center_lon: float
    radius_km: float
    cluster_mfl_total: float
    cluster_tiv_total: float


class HistogramBucket(BaseModel):
    bucket_min: float
    bucket_max: float
    count: int


class PortfolioSimulationResult(BaseModel):
    iterations: int
    horizon_years: int
    properties_simulated: int
    expected_annual_loss: float
    worst_case_simulated_loss: float
    var_95: float
    var_99: float
    distribution: list[HistogramBucket]


class PropertySimulationResult(BaseModel):
    property_id: int
    iterations: int
    horizon_years: int
    annual_event_probability: float
    mfl_amount: float
    expected_annual_loss: float
    worst_case_simulated_loss: float
    var_95: float
    var_99: float
    distribution: list[HistogramBucket]


class RetentionRecommendation(BaseModel):
    policy_id: int
    property_id: int
    estimated_loss: float
    deductible: float
    claim_recoverable_amount: float
    claim_out_of_pocket: float
    expected_premium_surcharge: float
    claim_total_cost: float
    absorb_total_cost: float
    recommendation: str
    estimated_savings: float
    incident_id: int | None = None


class AlertOut(BaseModel):
    alert_type: Literal["geographic_exposure", "incident_concentration"]
    severity: Literal["warning", "critical"]
    title: str
    message: str
    property_ids: list[int]
    value: float
    threshold: float
