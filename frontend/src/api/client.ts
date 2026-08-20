import axios from "axios";

export const api = axios.create({ baseURL: "/api" });

// --- Auth: token storage + attach/refresh interceptors ---
// Tokens live in localStorage (not just memory) so a page refresh doesn't force
// re-login; see AuthContext for the React-facing session state built on top of this.
const ACCESS_TOKEN_KEY = "rmis_access_token";
const REFRESH_TOKEN_KEY = "rmis_refresh_token";

export const getAccessToken = () => localStorage.getItem(ACCESS_TOKEN_KEY);
export const getRefreshToken = () => localStorage.getItem(REFRESH_TOKEN_KEY);
export const setTokens = (accessToken: string, refreshToken: string) => {
  localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
};
const setAccessToken = (accessToken: string) => localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
export const clearTokens = () => {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
};

// Fired when the session ends (explicit logout, or a failed silent refresh) so
// AuthContext can reset its user state without every call site checking for 401s.
export const AUTH_LOGOUT_EVENT = "rmis:auth:logout";
const emitLogout = () => window.dispatchEvent(new Event(AUTH_LOGOUT_EVENT));

api.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) {
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// On a 401 from an expired access token, try one silent refresh + retry before
// giving up and logging the user out — avoids bouncing to /login on every access-token expiry.
let refreshInFlight: Promise<string> | null = null;

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;
    if (error.response?.status !== 401 || original?._retried || !getRefreshToken()) {
      if (error.response?.status === 401) emitLogout();
      return Promise.reject(error);
    }
    original._retried = true;
    try {
      refreshInFlight ??= api
        .post<AccessToken>("/auth/refresh", { refresh_token: getRefreshToken() })
        .then((r) => {
          setAccessToken(r.data.access_token);
          return r.data.access_token;
        })
        .finally(() => {
          refreshInFlight = null;
        });
      const newAccessToken = await refreshInFlight;
      original.headers = original.headers ?? {};
      original.headers.Authorization = `Bearer ${newAccessToken}`;
      return api(original);
    } catch {
      clearTokens();
      emitLogout();
      return Promise.reject(error);
    }
  },
);

// --- Types (mirror backend/app/schemas.py) ---

export interface LoginRequest {
  email: string;
  password: string;
}

export interface CurrentUser {
  user_id: number;
  full_name: string;
  role: string;
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  token_type: string;
  user: CurrentUser;
}

export interface AccessToken {
  access_token: string;
  token_type: string;
}

export type HazardType = "FLOOD" | "FIRE" | "STRUCTURAL_FAILURE" | "THEFT" | "ELECTRICAL" | "OTHER";
export type SeverityLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type OperationalImpact = "FULL_OPERATION" | "PARTIAL_SHUTDOWN" | "FULL_SHUTDOWN";
export type IncidentStatus = "NEW" | "UNDER_INVESTIGATION" | "CLAIM_FILED" | "CLOSED";
export type ClaimStatus = "DRAFT" | "SUBMITTED" | "IN_ADJUSTMENT" | "APPROVED" | "REJECTED" | "SETTLED";
export type AssetType = "LOGISTICS_CENTER" | "OFFICE_BUILDING" | "RETAIL" | "INFRASTRUCTURE";
export type MitigationStatus = "OPEN" | "IN_PROGRESS" | "COMPLETED" | "OVERDUE";
export type PolicyStatus = "ACTIVE" | "EXPIRED" | "PENDING_RENEWAL";

export interface RiskProfile {
  profile_id: number;
  survey_date: string;
  flood_risk_score: number;
  fire_risk_score: number;
  earthquake_risk_score: number;
  mfl_amount: number;
  has_sprinklers: boolean;
  notes: string | null;
}

export interface PropertyActivePolicy {
  policy_id: number;
  policy_number: string;
  insurer_name: string;
  total_limit: number;
  per_event_limit: number | null;
  specific_deductible: number | null;
}

export interface Property {
  property_id: number;
  property_code: string;
  name: string;
  address: string;
  region: string;
  latitude: number;
  longitude: number;
  asset_type: AssetType;
  replacement_value: number;
  book_value: number;
  is_active: boolean;
  risk_profile: RiskProfile | null;
  manager_name: string | null;
  active_policy: PropertyActivePolicy | null;
}

export interface PropertyMapPoint {
  property_id: number;
  name: string;
  latitude: number;
  longitude: number;
  asset_type: AssetType;
  replacement_value: number;
  status_color: "green" | "yellow" | "red";
  open_incidents: number;
}

export interface Incident {
  incident_id: number;
  incident_code: string;
  property_id: number;
  incident_timestamp: string;
  hazard_type: HazardType;
  severity_level: SeverityLevel;
  operational_impact: OperationalImpact;
  initial_estimated_loss: number;
  description: string;
  status: IncidentStatus;
  ai_classified: boolean;
  ai_confidence: number | null;
  is_draft: boolean;
  business_interruption_requested: boolean;
  area_or_building: string | null;
  reported_coordinates: string | null;
}

export interface IncidentCreate {
  property_id: number;
  reported_by_user_id?: number | null;
  incident_timestamp: string;
  hazard_type: HazardType;
  severity_level: SeverityLevel;
  operational_impact: OperationalImpact;
  initial_estimated_loss: number;
  description: string;
  ai_classified?: boolean;
  ai_confidence?: number | null;
  is_draft?: boolean;
  business_interruption_requested?: boolean;
  area_or_building?: string | null;
  reported_coordinates?: string | null;
}

export interface IncidentUpdate {
  property_id?: number;
  incident_timestamp?: string;
  hazard_type?: HazardType;
  severity_level?: SeverityLevel;
  operational_impact?: OperationalImpact;
  initial_estimated_loss?: number;
  description?: string;
  business_interruption_requested?: boolean;
  area_or_building?: string | null;
  reported_coordinates?: string | null;
}

export interface ClaimTrackingRow {
  claim_id: number;
  claim_number: string;
  property_name: string;
  incident_date: string;
  hazard_type: HazardType;
  claimed_amount: number;
  deductible_applied: number;
  approved_amount: number;
  claim_status: ClaimStatus;
  expected_payment_date: string | null;
  paid_amount: number;
}

export type PaymentType = "ADVANCE" | "FINAL_SETTLEMENT";

export interface ClaimPayment {
  payment_id: number;
  claim_id: number;
  payment_date: string;
  amount: number;
  reference_number: string | null;
  payment_type: PaymentType;
}

export interface ClaimPaymentCreate {
  payment_date: string;
  amount: number;
  reference_number?: string | null;
  payment_type: PaymentType;
}

export interface Claim {
  claim_id: number;
  claim_number: string;
  incident_id: number;
  policy_id: number;
  claimed_amount: number;
  deductible_applied: number;
  approved_amount: number;
  claim_status: ClaimStatus;
  adjuster_name: string | null;
  expected_payment_date: string | null;
}

export interface ClaimCreate {
  incident_id: number;
  policy_id: number;
  claimed_amount: number;
  deductible_applied?: number;
  adjuster_name?: string | null;
  expected_payment_date?: string | null;
}

export interface ClaimUpdate {
  claim_status?: ClaimStatus;
  approved_amount?: number;
  adjuster_name?: string | null;
  expected_payment_date?: string | null;
}

export interface MitigationTask {
  task_id: number;
  property_id: number;
  title: string;
  cost_estimate: number;
  expected_annual_savings: number;
  due_date: string;
  status: MitigationStatus;
  assigned_to_user_id: number | null;
  roi_percent: number | null;
}

export interface MitigationTaskCreate {
  property_id: number;
  title: string;
  cost_estimate: number;
  expected_annual_savings: number;
  due_date: string;
  assigned_to_user_id?: number | null;
}

export interface MitigationTaskUpdate {
  title?: string;
  cost_estimate?: number;
  expected_annual_savings?: number;
  due_date?: string;
  status?: MitigationStatus;
  assigned_to_user_id?: number | null;
}

export interface MitigationRoiBreakdown {
  task_id: number;
  property_id: number;
  title: string;
  status: MitigationStatus;
  cost_estimate: number;
  expected_annual_savings_total: number;
  expected_premium_savings: number;
  expected_loss_savings: number;
  has_active_policy: boolean;
  roi_percent: number | null;
  payback_years: number | null;
}

export interface User {
  user_id: number;
  full_name: string;
  role: string;
}

/** Fuller shape returned only by the ADMIN-only endpoints (GET /users/admin, POST/PATCH
 * /users) — the open GET /users lookup above stays minimal (see backend module docstring). */
export interface UserAdmin {
  user_id: number;
  full_name: string;
  email: string;
  role: string;
  is_active: boolean;
  created_at: string;
}

export interface UserCreate {
  full_name: string;
  email: string;
  role: string;
  password?: string | null;
}

export interface UserUpdate {
  full_name?: string;
  email?: string;
  role?: string;
  password?: string | null;
  is_active?: boolean;
}

export interface RolePermission {
  role_permission_id: number;
  role: string;
  permission_key: string;
  description: string | null;
}

export interface RolePermissionCreate {
  role: string;
  permission_key: string;
  description?: string | null;
}

export interface RolePermissionUpdate {
  description?: string | null;
}

export interface Policy {
  policy_id: number;
  policy_number: string;
  insurer_name: string;
  start_date: string;
  end_date: string;
  total_limit: number;
  deductible_default: number;
  annual_premium: number;
  status: PolicyStatus;
  per_event_limit: number | null;
  bi_waiting_period_hours: number | null;
  exclusions: string | null;
}

export interface PolicyCreate {
  policy_number: string;
  insurer_name: string;
  start_date: string;
  end_date: string;
  total_limit: number;
  deductible_default: number;
  annual_premium: number;
  status?: PolicyStatus;
  per_event_limit?: number | null;
  bi_waiting_period_hours?: number | null;
  exclusions?: string | null;
}

export type PolicyUpdate = Partial<PolicyCreate>;

export interface PolicyAsset {
  policy_id: number;
  property_id: number;
  property_name: string;
  specific_deductible: number | null;
}

export interface PolicyAssetCreate {
  property_id: number;
  specific_deductible?: number | null;
}

export interface KpiSummary {
  tiv: number;
  mfl: number;
  open_claims_count: number;
  open_claims_amount: number;
  approved_pending_amount: number;
  loss_ratio: number;
  total_annual_premium: number;
}

export interface RiskMatrixCell {
  probability_band: "low" | "medium" | "high";
  severity_band: "low" | "medium" | "high";
  count: number;
  property_ids: number[];
}

export interface HazardDistributionItem {
  hazard_type: HazardType;
  count: number;
  percent: number;
}

export interface LossRatioTrendPoint {
  year: number;
  loss_ratio: number;
  total_claimed: number;
  total_annual_premium: number;
}

export interface CashflowMonthPoint {
  month: string; // "YYYY-MM"
  expected_receipts: number;
  open_reserves: number;
}

export interface CashflowSummary {
  total_open_reserves: number;
  total_expected_receipts: number;
  unscheduled_reserves: number;
  monthly: CashflowMonthPoint[];
}

export interface RegionExposure {
  region_id: number | null;
  region_name: string;
  tiv: number;
  mfl: number;
  total_claimed: number;
}

export interface HistogramBucket {
  bucket_min: number;
  bucket_max: number;
  count: number;
}

export interface PortfolioSimulationResult {
  iterations: number;
  horizon_years: number;
  properties_simulated: number;
  expected_annual_loss: number;
  worst_case_simulated_loss: number;
  var_95: number;
  var_99: number;
  distribution: HistogramBucket[];
}

export interface PropertySimulationResult {
  property_id: number;
  iterations: number;
  horizon_years: number;
  annual_event_probability: number;
  mfl_amount: number;
  expected_annual_loss: number;
  worst_case_simulated_loss: number;
  var_95: number;
  var_99: number;
  distribution: HistogramBucket[];
}

export interface RetentionRecommendation {
  policy_id: number;
  property_id: number;
  estimated_loss: number;
  deductible: number;
  claim_recoverable_amount: number;
  claim_out_of_pocket: number;
  expected_premium_surcharge: number;
  claim_total_cost: number;
  absorb_total_cost: number;
  recommendation: "ABSORB" | "CLAIM";
  estimated_savings: number;
  incident_id: number | null;
}

export interface Alert {
  alert_type: "geographic_exposure" | "incident_concentration";
  severity: "warning" | "critical";
  title: string;
  message: string;
  property_ids: number[];
  value: number;
  threshold: number;
}

export interface GeographicExposureCluster {
  property_ids: number[];
  property_names: string[];
  property_count: number;
  center_lat: number;
  center_lon: number;
  radius_km: number;
  cluster_mfl_total: number;
  cluster_tiv_total: number;
}

export type ComplianceRiskLevel = "לא הוערך" | "נמוך" | "בינוני" | "גבוה" | "קריטי";

export interface ComplianceControl {
  task_id: number;
  title: string;
  status: string;
  due_date: string;
  owner_name: string | null;
  cost_estimate: number;
  roi_percent: number | null;
}

export interface ComplianceRiskEntry {
  property_id: number;
  property_code: string;
  name: string;
  region: string;
  risk_owner_name: string | null;
  has_risk_assessment: boolean;
  last_reviewed: string | null;
  flood_risk_score: number | null;
  fire_risk_score: number | null;
  earthquake_risk_score: number | null;
  risk_score: number | null;
  risk_level: ComplianceRiskLevel;
  mfl_amount: number | null;
  controls: ComplianceControl[];
  open_controls_count: number;
  overdue_controls_count: number;
  completed_controls_count: number;
}

export interface ComplianceFrameworkSection {
  standard: string;
  clause: string;
  title: string;
  description: string;
  status: "מיושם" | "מיושם חלקית" | "לא מיושם";
  metric_label: string;
  metric_value: string;
}

export interface ComplianceReportSummary {
  total_properties: number;
  properties_with_risk_assessment: number;
  risk_assessment_coverage_percent: number;
  avg_risk_score: number | null;
  high_or_critical_risk_count: number;
  properties_without_owner_count: number;
  total_controls: number;
  open_controls_count: number;
  overdue_controls_count: number;
  completed_controls_count: number;
  control_completion_percent: number;
}

export interface ComplianceReport {
  generated_at: string;
  standard: string;
  summary: ComplianceReportSummary;
  framework_sections: ComplianceFrameworkSection[];
  entries: ComplianceRiskEntry[];
}

export interface MultiYearTrend {
  year: number;
  revenue: number;
  net_income: number;
  total_assets: number;
  insurance_expense: number;
  total_liabilities: number | null;
  total_equity: number | null;
  gross_profit: number | null;
  operating_profit: number | null;
  claim_losses_paid: number;
  premium_paid: number;
  insurance_expense_to_revenue: number | null;
  net_income_margin: number | null;
  gross_margin: number | null;
  operating_margin: number | null;
  equity_ratio: number | null;
  losses_to_asset_value: number | null;
  loss_ratio: number | null;
  revenue_growth_pct: number | null;
  losses_growth_pct: number | null;
}

export interface TrendSummary {
  years_covered: [number, number];
  revenue_cagr_pct: number | null;
  claim_losses_cagr_pct: number | null;
  avg_insurance_expense_to_revenue: number | null;
  avg_loss_ratio: number | null;
  cost_of_risk_outpacing_revenue: boolean;
}

export interface CapitalAdequacy {
  eligible_own_funds: number | null;
  solvency_capital_requirement: number;
  solvency_ratio_percent: number | null;
  status: string;
  scr_confidence_level: string;
  scr_simulation_iterations: number;
}

export interface ConcentrationDisclosure {
  total_insured_value: number;
  maximum_foreseeable_loss: number;
  concentration_percent: number | null;
}

export interface RegulatoryReport {
  generated_at: string;
  reporting_year: number | null;
  capital_adequacy: CapitalAdequacy;
  concentration_disclosure: ConcentrationDisclosure;
  multi_year_trends: MultiYearTrend[];
  trend_summary: TrendSummary | null;
}

export interface IncidentMedia {
  media_id: number;
  incident_id: number;
  file_path: string;
  file_type: string;
  captured_at: string;
  gps_latitude: number | null;
  gps_longitude: number | null;
}

export type DocumentEntityType = "INCIDENT" | "CLAIM" | "PROPERTY" | "POLICY";

export interface DocumentFile {
  document_id: number;
  entity_type: DocumentEntityType;
  entity_id: number;
  s3_url: string;
  doc_type: string;
  uploaded_by: number | null;
  uploaded_at: string;
}

export interface SignedUrl {
  url: string;
  download_url: string;
  storage_key: string;
  expires_at: number;
}

export interface ClaimWithPayments extends Claim {
  payments: ClaimPayment[];
}

export interface IncidentDrillDown {
  incident: Incident;
  media: IncidentMedia[];
  claims: ClaimWithPayments[];
  documents: DocumentFile[];
}

export interface IncidentClassification {
  hazard_type: HazardType;
  severity_level: SeverityLevel;
  operational_impact: OperationalImpact;
  estimated_loss_ils: number;
  business_interruption_likely: boolean;
  reasoning: string;
  confidence: number;
}

// --- API calls ---

export const fetchProperties = () => api.get<Property[]>("/properties").then((r) => r.data);
export const fetchProperty = (id: number) => api.get<Property>(`/properties/${id}`).then((r) => r.data);

export const fetchIncidents = (params?: { status?: string; property_id?: number }) =>
  api.get<Incident[]>("/incidents", { params }).then((r) => r.data);
export const createIncident = (payload: IncidentCreate) =>
  api.post<Incident>("/incidents", payload).then((r) => r.data);
export const fetchIncident = (id: number) => api.get<Incident>(`/incidents/${id}`).then((r) => r.data);
export const updateDraftIncident = (id: number, payload: IncidentUpdate) =>
  api.patch<Incident>(`/incidents/${id}`, payload).then((r) => r.data);
export const submitDraftIncident = (id: number) =>
  api.patch<Incident>(`/incidents/${id}/submit`).then((r) => r.data);
export const updateIncidentStatus = (id: number, status: IncidentStatus) =>
  api.patch<Incident>(`/incidents/${id}/status`, { status }).then((r) => r.data);
export const fetchEligiblePolicies = (incidentId: number) =>
  api.get<Policy[]>(`/incidents/${incidentId}/eligible-policies`).then((r) => r.data);
export const fetchIncidentDrilldown = (incidentId: number) =>
  api.get<IncidentDrillDown>(`/incidents/${incidentId}/full`).then((r) => r.data);

export const uploadIncidentMedia = (incidentId: number, file: File) => {
  const form = new FormData();
  form.append("file", file);
  return api
    .post<IncidentMedia>(`/incidents/${incidentId}/media`, form, {
      headers: { "Content-Type": "multipart/form-data" },
    })
    .then((r) => r.data);
};
export const fetchIncidentMedia = (incidentId: number) =>
  api.get<IncidentMedia[]>(`/incidents/${incidentId}/media`).then((r) => r.data);
export const deleteIncidentMedia = (mediaId: number) =>
  api.delete(`/media/${mediaId}`).then(() => undefined);
export const fetchMediaSignedUrl = (mediaId: number) =>
  api.get<SignedUrl>(`/media/${mediaId}/signed-url`).then((r) => r.data);

export const fetchDocumentsForEntity = (entityType: DocumentEntityType, entityId: number) =>
  api.get<DocumentFile[]>(`/documents/entity/${entityType}/${entityId}`).then((r) => r.data);
export const fetchDocumentSignedUrl = (documentId: number) =>
  api.get<SignedUrl>(`/documents/${documentId}/signed-url`).then((r) => r.data);
export const uploadDocument = (
  entityType: DocumentEntityType,
  entityId: number,
  file: File,
  docType: string,
  uploadedBy?: number | null,
) => {
  const form = new FormData();
  form.append("file", file);
  return api
    .post<DocumentFile>(`/documents/entity/${entityType}/${entityId}`, form, {
      headers: { "Content-Type": "multipart/form-data" },
      params: { doc_type: docType, uploaded_by: uploadedBy ?? undefined },
    })
    .then((r) => r.data);
};
export const deleteDocument = (documentId: number) =>
  api.delete(`/documents/${documentId}`).then(() => undefined);

export const fetchClaims = (status?: string) =>
  api.get<ClaimTrackingRow[]>("/claims", { params: status ? { status } : undefined }).then((r) => r.data);
export const fetchClaim = (id: number) => api.get<Claim>(`/claims/${id}`).then((r) => r.data);
export const createClaim = (payload: ClaimCreate) =>
  api.post<Claim>("/claims", payload).then((r) => r.data);
export const updateClaim = (id: number, payload: ClaimUpdate) =>
  api.patch<Claim>(`/claims/${id}`, payload).then((r) => r.data);
export const fetchClaimPayments = (claimId: number) =>
  api.get<ClaimPayment[]>(`/claims/${claimId}/payments`).then((r) => r.data);
export const createClaimPayment = (claimId: number, payload: ClaimPaymentCreate) =>
  api.post<ClaimPayment>(`/claims/${claimId}/payments`, payload).then((r) => r.data);

export const fetchMitigationTasks = () =>
  api.get<MitigationTask[]>("/mitigation-tasks").then((r) => r.data);
export const fetchMitigationTask = (id: number) =>
  api.get<MitigationTask>(`/mitigation-tasks/${id}`).then((r) => r.data);
export const createMitigationTask = (payload: MitigationTaskCreate) =>
  api.post<MitigationTask>("/mitigation-tasks", payload).then((r) => r.data);
export const updateMitigationTask = (id: number, payload: MitigationTaskUpdate) =>
  api.patch<MitigationTask>(`/mitigation-tasks/${id}`, payload).then((r) => r.data);
export const fetchMitigationTaskRoi = (id: number) =>
  api.get<MitigationRoiBreakdown>(`/mitigation-tasks/${id}/roi`).then((r) => r.data);
export const fetchMitigationRoiSummary = () =>
  api.get<MitigationRoiBreakdown[]>("/mitigation-tasks/roi-summary").then((r) => r.data);

export const fetchUsers = () => api.get<User[]>("/users").then((r) => r.data);
export const fetchUsersAdmin = () => api.get<UserAdmin[]>("/users/admin").then((r) => r.data);
export const createUser = (payload: UserCreate) =>
  api.post<UserAdmin>("/users", payload).then((r) => r.data);
export const updateUser = (id: number, payload: UserUpdate) =>
  api.patch<UserAdmin>(`/users/${id}`, payload).then((r) => r.data);

export const fetchRolePermissions = (role?: string) =>
  api.get<RolePermission[]>("/role-permissions", { params: role ? { role } : undefined }).then((r) => r.data);
export const createRolePermission = (payload: RolePermissionCreate) =>
  api.post<RolePermission>("/role-permissions", payload).then((r) => r.data);
export const updateRolePermission = (id: number, payload: RolePermissionUpdate) =>
  api.patch<RolePermission>(`/role-permissions/${id}`, payload).then((r) => r.data);
export const deleteRolePermission = (id: number) =>
  api.delete(`/role-permissions/${id}`).then(() => undefined);

export const login = (payload: LoginRequest) => api.post<TokenPair>("/auth/login", payload).then((r) => r.data);
export const logout = () => api.post("/auth/logout").then(() => undefined);
export const fetchCurrentUser = () => api.get<CurrentUser>("/auth/me").then((r) => r.data);

export const fetchPolicies = (status?: string) =>
  api.get<Policy[]>("/policies", { params: status ? { status } : undefined }).then((r) => r.data);
export const fetchPolicy = (id: number) => api.get<Policy>(`/policies/${id}`).then((r) => r.data);
export const createPolicy = (payload: PolicyCreate) =>
  api.post<Policy>("/policies", payload).then((r) => r.data);
export const updatePolicy = (id: number, payload: PolicyUpdate) =>
  api.put<Policy>(`/policies/${id}`, payload).then((r) => r.data);

export const fetchPolicyAssets = (policyId: number) =>
  api.get<PolicyAsset[]>(`/policies/${policyId}/assets`).then((r) => r.data);
export const assignPolicyAsset = (policyId: number, payload: PolicyAssetCreate) =>
  api.post<PolicyAsset>(`/policies/${policyId}/assets`, payload).then((r) => r.data);
export const unassignPolicyAsset = (policyId: number, propertyId: number) =>
  api.delete(`/policies/${policyId}/assets/${propertyId}`);

export const fetchKpis = () => api.get<KpiSummary>("/analytics/kpis").then((r) => r.data);
export const fetchMapPoints = () => api.get<PropertyMapPoint[]>("/analytics/map").then((r) => r.data);
export const fetchRiskMatrix = () => api.get<RiskMatrixCell[]>("/analytics/risk-matrix").then((r) => r.data);
export const fetchHazardDistribution = () =>
  api.get<HazardDistributionItem[]>("/analytics/hazard-distribution").then((r) => r.data);
export const fetchLossRatioTrend = () =>
  api.get<LossRatioTrendPoint[]>("/analytics/loss-ratio-trend").then((r) => r.data);
export const fetchCashflowSummary = (monthsAhead = 12) =>
  api.get<CashflowSummary>("/analytics/cashflow", { params: { months_ahead: monthsAhead } }).then((r) => r.data);
export const fetchExposureByRegion = () =>
  api.get<RegionExposure[]>("/analytics/exposure-by-region").then((r) => r.data);
export const fetchPortfolioSimulation = (params: { iterations?: number; horizon_years?: number; seed?: number }) =>
  api.get<PortfolioSimulationResult>("/simulation/portfolio", { params }).then((r) => r.data);
export const fetchPropertySimulation = (
  propertyId: number,
  params: { iterations?: number; horizon_years?: number; seed?: number },
) => api.get<PropertySimulationResult>(`/simulation/properties/${propertyId}`, { params }).then((r) => r.data);
export const fetchRetentionRecommendation = (params: { policy_id: number; property_id: number; estimated_loss: number }) =>
  api.get<RetentionRecommendation>("/retention/recommendation", { params }).then((r) => r.data);
export const fetchRetentionRecommendationForIncident = (incidentId: number) =>
  api.get<RetentionRecommendation>(`/retention/incidents/${incidentId}`).then((r) => r.data);
export const fetchAlerts = () => api.get<Alert[]>("/analytics/alerts").then((r) => r.data);
export const fetchGeographicExposureClusters = () =>
  api.get<GeographicExposureCluster[]>("/analytics/geographic-exposure-clusters").then((r) => r.data);

export const fetchIso31000Report = () =>
  api.get<ComplianceReport>("/compliance/iso31000-report").then((r) => r.data);

export const fetchMultiYearTrends = () =>
  api.get<MultiYearTrend[]>("/financials/trends").then((r) => r.data);
export const fetchRegulatoryReport = () =>
  api.get<RegulatoryReport>("/financials/regulatory-report").then((r) => r.data);

export interface AuditLogEntry {
  log_id: number;
  user_id: number | null;
  user_name: string | null;
  entity_type: string;
  entity_id: number;
  action: string;
  old_value: string | null;
  new_value: string | null;
  timestamp: string;
  ip_address: string | null;
}

export interface AuditLogPage {
  total: number;
  limit: number;
  offset: number;
  entries: AuditLogEntry[];
}

export interface AuditLogFilters {
  entity_type?: string;
  entity_id?: number;
  user_id?: number;
  action?: string;
  date_from?: string;
  date_to?: string;
  limit?: number;
  offset?: number;
}

export const fetchAuditLog = (params: AuditLogFilters = {}) =>
  api.get<AuditLogPage>("/audit-log", { params }).then((r) => r.data);
export const fetchAuditLogEntityTypes = () =>
  api.get<string[]>("/audit-log/entity-types").then((r) => r.data);

export const classifyIncident = (description: string) =>
  api.post<IncidentClassification>("/ai/classify-incident", { description }).then((r) => r.data);

export const askQuestion = (question: string) =>
  api.post<{ answer: string }>("/ai/ask", { question }).then((r) => r.data);

// Plain-text streaming response (SSE-style chunks) — axios doesn't expose a readable-stream
// body in the browser, so this uses fetch() directly, but still attaches the same bearer
// token as every other call so the endpoint isn't left as the one unauthenticated caller.
export const streamExecutiveSummary = async () => {
  const token = getAccessToken();
  const res = await fetch("/api/ai/executive-summary", {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? `שגיאה (${res.status})`);
  }
  return res.body;
};
