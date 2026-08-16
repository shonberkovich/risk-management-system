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
export const updateIncidentStatus = (id: number, status: IncidentStatus) =>
  api.patch<Incident>(`/incidents/${id}/status`, { status }).then((r) => r.data);
export const fetchEligiblePolicies = (incidentId: number) =>
  api.get<Policy[]>(`/incidents/${incidentId}/eligible-policies`).then((r) => r.data);

export const fetchClaims = (status?: string) =>
  api.get<ClaimTrackingRow[]>("/claims", { params: status ? { status } : undefined }).then((r) => r.data);
export const createClaim = (payload: ClaimCreate) =>
  api.post<Claim>("/claims", payload).then((r) => r.data);
export const updateClaim = (id: number, payload: ClaimUpdate) =>
  api.patch<Claim>(`/claims/${id}`, payload).then((r) => r.data);

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

export const classifyIncident = (description: string) =>
  api.post<IncidentClassification>("/ai/classify-incident", { description }).then((r) => r.data);

export const askQuestion = (question: string) =>
  api.post<{ answer: string }>("/ai/ask", { question }).then((r) => r.data);
