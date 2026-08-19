import axios from "axios";

export const api = axios.create({ baseURL: "/api" });

// --- Types (mirror backend/app/schemas.py) ---

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
  roi_percent: number | null;
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

export const fetchClaims = (status?: string) =>
  api.get<ClaimTrackingRow[]>("/claims", { params: status ? { status } : undefined }).then((r) => r.data);
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
export const fetchAlerts = () => api.get<Alert[]>("/analytics/alerts").then((r) => r.data);
export const fetchGeographicExposureClusters = () =>
  api.get<GeographicExposureCluster[]>("/analytics/geographic-exposure-clusters").then((r) => r.data);

export const classifyIncident = (description: string) =>
  api.post<IncidentClassification>("/ai/classify-incident", { description }).then((r) => r.data);

export const askQuestion = (question: string) =>
  api.post<{ answer: string }>("/ai/ask", { question }).then((r) => r.data);
