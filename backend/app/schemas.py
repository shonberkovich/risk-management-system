from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

HazardType = Literal["FLOOD", "FIRE", "STRUCTURAL_FAILURE", "THEFT", "ELECTRICAL", "OTHER"]
SeverityLevel = Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"]
OperationalImpact = Literal["FULL_OPERATION", "PARTIAL_SHUTDOWN", "FULL_SHUTDOWN"]
IncidentStatus = Literal["NEW", "UNDER_INVESTIGATION", "CLAIM_FILED", "CLOSED"]
ClaimStatus = Literal["DRAFT", "SUBMITTED", "IN_ADJUSTMENT", "APPROVED", "REJECTED", "SETTLED"]
AssetType = Literal["LOGISTICS_CENTER", "OFFICE_BUILDING", "RETAIL", "INFRASTRUCTURE"]
MitigationStatus = Literal["OPEN", "IN_PROGRESS", "COMPLETED", "OVERDUE"]
PolicyStatus = Literal["ACTIVE", "EXPIRED", "PENDING_RENEWAL"]
PaymentType = Literal["ADVANCE", "FINAL_SETTLEMENT"]
UserRole = Literal["RISK_MANAGER", "CFO", "PROPERTY_MANAGER", "FIELD_WORKER", "ADMIN", "RISK_OFFICER", "ADJUSTER"]


# --- Users ---
# UserOut: read-only lookup (name + role) for UI pickers such as mitigation-task
# executor assignment. Deliberately excludes email/created_at/is_active — GET
# /api/users is open to any caller, so it stays minimal. Full user administration
# (create/edit/disable, see UserAdminOut + UserCreate/UserUpdate below) is ADMIN-only,
# TODO_SPEC.md §2 "ניהול משתמשים (users.py)".
class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    user_id: int
    full_name: str
    role: str


class UserAdminOut(BaseModel):
    """Fuller shape returned by the ADMIN-only write endpoints — includes the fields
    UserOut deliberately omits from the open GET /api/users lookup."""
    model_config = ConfigDict(from_attributes=True)
    user_id: int
    full_name: str
    email: str
    role: UserRole
    is_active: bool
    created_at: datetime


class UserCreate(BaseModel):
    full_name: str
    email: str
    role: UserRole
    password: str | None = None  # None = no local password (SSO-only), same as seed.py's convention


class RolePermissionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    role_permission_id: int
    role: UserRole
    permission_key: str
    description: str | None = None


class RolePermissionCreate(BaseModel):
    role: UserRole
    permission_key: str
    description: str | None = None


class RolePermissionUpdate(BaseModel):
    """description only — role and permission_key together identify the row
    (UQ_RolePermissions_RoleKey); changing either is really "delete this row, create a
    different one", not an edit, so they're left out of the update shape."""
    description: str | None = None


class UserUpdate(BaseModel):
    """Partial update — also how role changes and disabling happen (is_active=False),
    rather than separate dedicated endpoints, same convention as ClaimUpdate covering
    claim_status changes."""
    full_name: str | None = None
    email: str | None = None
    role: UserRole | None = None
    password: str | None = None
    is_active: bool | None = None


# --- Auth ---
class LoginRequest(BaseModel):
    email: str
    password: str


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: UserOut


class RefreshRequest(BaseModel):
    refresh_token: str


class AccessToken(BaseModel):
    access_token: str
    token_type: str = "bearer"


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
    near_hazmat_site: bool = False


class RiskProfileCreate(BaseModel):
    """Payload for POST /api/properties/{property_id}/risk-profile — creating the
    first (and only, see AssetRiskProfile's 1:1 relationship to Property) survey for
    a property. Score bounds (1-5) mirror schema.sql's CHECK constraints, surfaced
    here as a 422 instead of a raw DB error."""
    survey_date: date
    flood_risk_score: int = Field(ge=1, le=5)
    fire_risk_score: int = Field(ge=1, le=5)
    earthquake_risk_score: int = Field(ge=1, le=5)
    mfl_amount: float
    has_sprinklers: bool
    notes: str | None = None
    near_hazmat_site: bool = False


class RiskProfileUpdate(BaseModel):
    """Payload for PUT /api/properties/{property_id}/risk-profile — partial update
    (re-survey) of the existing profile."""
    survey_date: date | None = None
    flood_risk_score: int | None = Field(default=None, ge=1, le=5)
    fire_risk_score: int | None = Field(default=None, ge=1, le=5)
    earthquake_risk_score: int | None = Field(default=None, ge=1, le=5)
    mfl_amount: float | None = None
    has_sprinklers: bool | None = None
    notes: str | None = None
    near_hazmat_site: bool | None = None


class PropertyActivePolicyOut(BaseModel):
    policy_id: int
    policy_number: str
    insurer_name: str
    total_limit: float
    per_event_limit: float | None = None
    specific_deductible: float | None = None


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
    manager_name: str | None = None
    active_policy: PropertyActivePolicyOut | None = None


class PropertyCreate(BaseModel):
    """Payload for POST /api/properties. Mirrors Property's non-generated columns —
    property_id/created_at/updated_at are server-assigned, is_active defaults to True
    (a property is created active; use DELETE to deactivate)."""
    property_code: str
    name: str
    address: str
    region: str
    region_id: int | None = None
    latitude: float
    longitude: float
    asset_type: AssetType
    replacement_value: float
    book_value: float
    primary_manager_id: int | None = None


class PropertyUpdate(BaseModel):
    """Payload for PUT /api/properties/{id}. All fields optional (partial update,
    same convention as MitigationTaskUpdate/PolicyUpdate) despite PUT's usual
    full-replace connotation — chosen to match how the other write routers in this
    codebase already use PUT/PATCH interchangeably for partial updates."""
    property_code: str | None = None
    name: str | None = None
    address: str | None = None
    region: str | None = None
    region_id: int | None = None
    latitude: float | None = None
    longitude: float | None = None
    asset_type: AssetType | None = None
    replacement_value: float | None = None
    book_value: float | None = None
    primary_manager_id: int | None = None
    is_active: bool | None = None


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
    resolved_address: str | None = None


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


class ClaimReserveOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    reserve_id: int
    claim_id: int
    reserve_amount: float
    expected_payment_date: date | None = None
    updated_at: datetime


class ClaimReserveCreate(BaseModel):
    reserve_amount: float
    expected_payment_date: date | None = None


class ClaimReserveUpdate(BaseModel):
    reserve_amount: float | None = None
    expected_payment_date: date | None = None


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
    per_event_limit: float | None = None
    bi_waiting_period_hours: int | None = None
    exclusions: str | None = None


class PolicyCreate(BaseModel):
    policy_number: str
    insurer_name: str
    start_date: date
    end_date: date
    total_limit: float
    deductible_default: float
    annual_premium: float
    status: PolicyStatus = "ACTIVE"
    per_event_limit: float | None = None
    bi_waiting_period_hours: int | None = None
    exclusions: str | None = None


class PolicyUpdate(BaseModel):
    insurer_name: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    total_limit: float | None = None
    deductible_default: float | None = None
    annual_premium: float | None = None
    status: PolicyStatus | None = None
    per_event_limit: float | None = None
    bi_waiting_period_hours: int | None = None
    exclusions: str | None = None


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
    alert_type: Literal["geographic_exposure", "incident_concentration", "critical_incident"]
    severity: Literal["warning", "critical"]
    title: str
    message: str
    property_ids: list[int]
    value: float
    threshold: float


class NotificationOut(BaseModel):
    recipient_role: str
    recipient_name: str
    channel: Literal["EMAIL", "SMS", "PUSH"]
    contact: str
    alert_type: Literal["geographic_exposure", "incident_concentration", "critical_incident"]
    severity: Literal["warning", "critical"]
    title: str
    message: str
    property_ids: list[int]
    value: float
    threshold: float
    status: str | None = None  # None for a routing preview (not yet "sent"); "simulated" after dispatch


NotificationChannel = Literal["EMAIL", "SMS", "PUSH"]
NotificationSeverity = Literal["warning", "critical"]


class NotificationRecipientOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    recipient_id: int
    role: str
    display_name: str
    email: str
    phone: str
    channels: list[NotificationChannel]
    min_severity: NotificationSeverity
    is_active: bool


class NotificationRecipientCreate(BaseModel):
    role: str
    display_name: str
    email: str
    phone: str
    channels: list[NotificationChannel]
    min_severity: NotificationSeverity = "warning"
    is_active: bool = True


class NotificationRecipientUpdate(BaseModel):
    role: str | None = None
    display_name: str | None = None
    email: str | None = None
    phone: str | None = None
    channels: list[NotificationChannel] | None = None
    min_severity: NotificationSeverity | None = None
    is_active: bool | None = None


class NotificationLogOut(BaseModel):
    """One row of the Notification_Log audit trail — a notification that was
    actually dispatched (status="simulated"), as opposed to NotificationOut which
    also covers not-yet-sent preview routing. See TODO_SPEC.md §1."""
    log_id: int
    alert_type: Literal["geographic_exposure", "incident_concentration", "critical_incident"]
    severity: NotificationSeverity
    recipient_role: str
    recipient_name: str
    channel: NotificationChannel
    contact: str
    title: str
    message: str
    property_ids: list[int]
    value: float
    threshold: float
    status: str
    sent_at: datetime


class ErpBookValueOut(BaseModel):
    property_id: int
    property_code: str
    name: str
    book_value: float
    replacement_value: float
    as_of: str
    source_system: str
    status: str


class ErpClaimReceiptPostingOut(BaseModel):
    payment_id: int
    claim_id: int
    claim_number: str
    property_code: str
    payment_date: str
    amount: float
    payment_type: str
    debit_account: str
    credit_account: str
    memo: str
    status: str
    posted_at: str | None = None


class GisRiskLayerOut(BaseModel):
    property_id: int
    property_code: str
    name: str
    latitude: float
    longitude: float
    flood_zone: str
    flood_zone_description: str
    climate_risk_index: int
    internal_flood_risk_score: int | None = None
    mismatch_with_internal_survey: bool
    source_system: str
    as_of: str
    status: str


class WeatherAlertOut(BaseModel):
    property_id: int
    property_code: str
    name: str
    latitude: float
    longitude: float
    alert_type: str
    severity: str
    as_of: str
    issued_at: str
    source_system: str
    status: str


class EconomicIndexSeriesOut(BaseModel):
    as_of: str
    base_date: str
    construction_cost_index: float
    cpi_index: float
    source_system: str


class ReplacementValueUpdateOut(BaseModel):
    property_id: int
    property_code: str
    name: str
    current_replacement_value: float
    suggested_replacement_value: float
    drift_percent: float
    baseline_date: str
    as_of: str
    recommended_for_revaluation: bool
    source_system: str


# --- Real external connectors (TODO_SPEC.md §12) ---
class BoiSeriesOut(BaseModel):
    series: str
    value: float | None = None
    unit: str
    status: str
    source_system: str


class BoiMarketDataOut(BaseModel):
    as_of: str
    series: list[BoiSeriesOut]
    source_system: str


class HomeFrontAlertOut(BaseModel):
    category: str
    title: str
    areas: list[str]


class HomeFrontAffectedPropertyOut(BaseModel):
    property_id: int
    property_code: str
    name: str
    region: str
    matched_area: str


class HomeFrontAlertsOut(BaseModel):
    status: str
    alerts: list[HomeFrontAlertOut]
    source_system: str
    affected_properties: list[HomeFrontAffectedPropertyOut] = []


class SeismologyEventOut(BaseModel):
    event_time: str
    latitude: float
    longitude: float
    depth_km: float
    magnitude: float
    region: str


class SeismologyBulletinOut(BaseModel):
    status: str
    events: list[SeismologyEventOut]
    source_system: str


class NearestPropertyToEpicenterOut(BaseModel):
    property_id: int
    property_code: str
    name: str
    distance_km: float
    felt_locally: bool


class HazmatSiteOut(BaseModel):
    name: str
    latitude: float
    longitude: float
    address: str | None = None


class HazmatSitesOut(BaseModel):
    status: str
    sites: list[HazmatSiteOut]
    source_system: str


class PropertyHazmatProximityOut(BaseModel):
    property_id: int
    property_code: str
    name: str
    within_hazard_radius: bool
    distance_km: float | None = None
    nearest_site: HazmatSiteOut | None = None


class ReverseGeocodeOut(BaseModel):
    status: str
    address: str | None = None
    source_system: str


class ComplianceControlOut(BaseModel):
    task_id: int
    title: str
    status: str
    due_date: str
    owner_name: str | None = None
    cost_estimate: float
    roi_percent: float | None = None


class ComplianceRiskEntryOut(BaseModel):
    property_id: int
    property_code: str
    name: str
    region: str
    risk_owner_name: str | None = None
    has_risk_assessment: bool
    last_reviewed: str | None = None
    flood_risk_score: int | None = None
    fire_risk_score: int | None = None
    earthquake_risk_score: int | None = None
    risk_score: float | None = None
    risk_level: Literal["לא הוערך", "נמוך", "בינוני", "גבוה", "קריטי"]
    mfl_amount: float | None = None
    controls: list[ComplianceControlOut]
    open_controls_count: int
    overdue_controls_count: int
    completed_controls_count: int


class ComplianceFrameworkSectionOut(BaseModel):
    standard: str
    clause: str
    title: str
    description: str
    status: Literal["מיושם", "מיושם חלקית", "לא מיושם"]
    metric_label: str
    metric_value: str


class ComplianceReportSummaryOut(BaseModel):
    total_properties: int
    properties_with_risk_assessment: int
    risk_assessment_coverage_percent: float
    avg_risk_score: float | None = None
    high_or_critical_risk_count: int
    properties_without_owner_count: int
    total_controls: int
    open_controls_count: int
    overdue_controls_count: int
    completed_controls_count: int
    control_completion_percent: float


class ComplianceReportOut(BaseModel):
    generated_at: str
    standard: str
    summary: ComplianceReportSummaryOut
    framework_sections: list[ComplianceFrameworkSectionOut]
    entries: list[ComplianceRiskEntryOut]


class FinancialStatementOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    statement_id: int
    year: int
    total_assets: float
    revenue: float
    net_income: float
    insurance_expense: float
    total_liabilities: float | None = None
    total_equity: float | None = None
    gross_profit: float | None = None
    operating_profit: float | None = None


class FinancialStatementCreate(BaseModel):
    """Payload for POST /api/financials/statements — entering a multi-year financial
    statement. total_liabilities/total_equity/gross_profit/operating_profit are
    optional (nullable on the model, see models.FinancialStatement) so a statement can
    be entered from a simpler income-statement-only source and completed later."""
    year: int
    total_assets: float
    revenue: float
    net_income: float
    insurance_expense: float
    total_liabilities: float | None = None
    total_equity: float | None = None
    gross_profit: float | None = None
    operating_profit: float | None = None


class MultiYearTrendOut(BaseModel):
    year: int
    revenue: float
    net_income: float
    total_assets: float
    insurance_expense: float
    total_liabilities: float | None = None
    total_equity: float | None = None
    gross_profit: float | None = None
    operating_profit: float | None = None
    claim_losses_paid: float
    premium_paid: float
    insurance_expense_to_revenue: float | None = None
    net_income_margin: float | None = None
    gross_margin: float | None = None
    operating_margin: float | None = None
    equity_ratio: float | None = None
    losses_to_asset_value: float | None = None
    loss_ratio: float | None = None
    revenue_growth_pct: float | None = None
    losses_growth_pct: float | None = None


class TrendSummaryOut(BaseModel):
    years_covered: list[int]
    revenue_cagr_pct: float | None = None
    claim_losses_cagr_pct: float | None = None
    avg_insurance_expense_to_revenue: float | None = None
    avg_loss_ratio: float | None = None
    cost_of_risk_outpacing_revenue: bool


class CapitalAdequacyOut(BaseModel):
    eligible_own_funds: float | None = None
    solvency_capital_requirement: float
    solvency_ratio_percent: float | None = None
    status: str
    scr_confidence_level: str
    scr_simulation_iterations: int


class ConcentrationDisclosureOut(BaseModel):
    total_insured_value: float
    maximum_foreseeable_loss: float
    concentration_percent: float | None = None


class RegulatoryReportOut(BaseModel):
    generated_at: str
    reporting_year: int | None = None
    capital_adequacy: CapitalAdequacyOut
    concentration_disclosure: ConcentrationDisclosureOut
    multi_year_trends: list[MultiYearTrendOut]
    trend_summary: TrendSummaryOut | None = None


class AuditLogEntryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    log_id: int
    user_id: int | None = None
    user_name: str | None = None
    entity_type: str
    entity_id: int
    action: str
    old_value: str | None = None
    new_value: str | None = None
    timestamp: datetime
    ip_address: str | None = None


class AuditLogPageOut(BaseModel):
    total: int
    limit: int
    offset: int
    entries: list[AuditLogEntryOut]
