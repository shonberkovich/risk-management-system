import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import MyLocationIcon from "@mui/icons-material/MyLocation";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import Alert from "@mui/material/Alert";
import Autocomplete from "@mui/material/Autocomplete";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import FormControlLabel from "@mui/material/FormControlLabel";
import Grid from "@mui/material/Grid";
import LinearProgress from "@mui/material/LinearProgress";
import Stack from "@mui/material/Stack";
import Step from "@mui/material/Step";
import StepLabel from "@mui/material/StepLabel";
import Stepper from "@mui/material/Stepper";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import { useMutation, useQuery } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { useEffect, useRef, useState } from "react";

import {
  classifyIncident,
  createIncident,
  fetchIncident,
  fetchProperties,
  submitDraftIncident,
  updateDraftIncident,
  uploadIncidentMedia,
  type HazardType,
  type Incident,
  type IncidentClassification,
  type IncidentCreate,
  type OperationalImpact,
  type Property,
  type SeverityLevel,
} from "../api/client";
import MediaUploader from "../components/MediaUploader";
import { distanceKm, useGeolocation } from "../hooks/useGeolocation";
import { HAZARD_LABELS, OPERATIONAL_IMPACT_LABELS, SEVERITY_LABELS } from "../format";
import { enqueueIncidentReport, subscribeToSyncQueue, trySync } from "../offline/syncQueue";

const STEPS = ["מיקום וזיהוי הנכס", "פרטי הנזק והחומרה", "אומדן כספי ותיאור", "תיעוד ושליחה"];

const NEARBY_RADIUS_KM = 15;

// Persists only the draft incident's id — the fields themselves live server-side
// (via PATCH /api/incidents/{id}) so "save as draft, come back later" survives
// a closed tab / different device login, not just a page refresh.
const DRAFT_STORAGE_KEY = "rmis_incident_draft_id";

// Pill-shaped, color-coded, large-touch-target choice buttons — sized for
// gloved/one-handed use in the field on a phone, not just desktop mouse use.
const PILL_BUTTON_SX = {
  borderRadius: 999,
  px: 3,
  py: 1.5,
  minHeight: 48,
  fontSize: "1rem",
  fontWeight: 600,
};

const HAZARD_OPTIONS: { value: HazardType; color: string }[] = [
  { value: "FLOOD", color: "#0277bd" },
  { value: "FIRE", color: "#c62828" },
  { value: "STRUCTURAL_FAILURE", color: "#6d4c41" },
  { value: "THEFT", color: "#6a1b9a" },
  { value: "ELECTRICAL", color: "#f9a825" },
  { value: "OTHER", color: "#616161" },
];
const SEVERITY_OPTIONS: { value: SeverityLevel; color: string }[] = [
  { value: "LOW", color: "#2e7d32" },
  { value: "MEDIUM", color: "#e69413" },
  { value: "HIGH", color: "#e64a19" },
  { value: "CRITICAL", color: "#c62828" },
];
const IMPACT_OPTIONS: OperationalImpact[] = ["FULL_OPERATION", "PARTIAL_SHUTDOWN", "FULL_SHUTDOWN"];

export default function IncidentReport() {
  const [activeStep, setActiveStep] = useState(0);
  const [property, setProperty] = useState<Property | null>(null);
  const [timestamp, setTimestamp] = useState(() => new Date().toISOString().slice(0, 16));
  const [hazardType, setHazardType] = useState<HazardType | "">("");
  const [severity, setSeverity] = useState<SeverityLevel | "">("");
  const [impact, setImpact] = useState<OperationalImpact | "">("");
  const [loss, setLoss] = useState("");
  const [description, setDescription] = useState("");
  const [businessInterruption, setBusinessInterruption] = useState(false);
  const [aiResult, setAiResult] = useState<IncidentClassification | null>(null);
  const [mediaFiles, setMediaFiles] = useState<File[]>([]);
  const [mediaUploadError, setMediaUploadError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [submittedOffline, setSubmittedOffline] = useState(false);
  const [draftId, setDraftId] = useState<number | null>(null);
  const [draftCode, setDraftCode] = useState<string | null>(null);
  const [draftNotice, setDraftNotice] = useState<string | null>(null);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const draftResumeAttempted = useRef(false);

  const { data: properties } = useQuery({ queryKey: ["properties"], queryFn: fetchProperties });
  const geo = useGeolocation();

  // Reflects the on-device offline queue (see src/offline/syncQueue.ts) so a field user
  // who reported several incidents without connectivity can see they're still pending.
  useEffect(() => {
    return subscribeToSyncQueue((state) => {
      setPendingSyncCount(state.pendingCount);
      setSyncing(state.syncing);
    });
  }, []);

  // Resume a previously saved draft (if any) once the property list is loaded,
  // so the Autocomplete can be matched to a real Property object.
  useEffect(() => {
    if (draftResumeAttempted.current || !properties) return;
    draftResumeAttempted.current = true;
    const storedId = localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!storedId) return;
    fetchIncident(Number(storedId))
      .then((incident) => {
        if (!incident.is_draft) {
          localStorage.removeItem(DRAFT_STORAGE_KEY);
          return;
        }
        setDraftId(incident.incident_id);
        setDraftCode(incident.incident_code);
        setProperty(properties.find((p) => p.property_id === incident.property_id) ?? null);
        setTimestamp(incident.incident_timestamp.slice(0, 16));
        setHazardType(incident.hazard_type);
        setSeverity(incident.severity_level);
        setImpact(incident.operational_impact);
        setLoss(String(incident.initial_estimated_loss));
        setDescription(incident.description);
        setBusinessInterruption(incident.business_interruption_requested);
        setDraftNotice(`נטענה טיוטה קודמת (מס' ${incident.incident_code}) — ניתן להמשיך למלא ולשלוח.`);
      })
      .catch(() => localStorage.removeItem(DRAFT_STORAGE_KEY));
  }, [properties]);

  const nearbyProperties = geo.coords
    ? (properties ?? [])
        .map((p) => ({ property: p, distance: distanceKm(geo.coords!, { latitude: p.latitude, longitude: p.longitude }) }))
        .filter((x) => x.distance <= NEARBY_RADIUS_KM)
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 5)
    : [];

  const classifyMutation = useMutation({
    mutationFn: () => classifyIncident(description),
    onSuccess: (result) => {
      setAiResult(result);
      setHazardType(result.hazard_type);
      setSeverity(result.severity_level);
      setImpact(result.operational_impact);
      setLoss(String(result.estimated_loss_ils));
      if (result.business_interruption_likely) setBusinessInterruption(true);
    },
  });

  const saveDraftMutation = useMutation({
    mutationFn: () => {
      const reportedCoordinates = geo.coords ? `${geo.coords.latitude},${geo.coords.longitude}` : null;
      if (draftId != null) {
        return updateDraftIncident(draftId, {
          property_id: property?.property_id,
          incident_timestamp: timestamp ? new Date(timestamp).toISOString() : undefined,
          hazard_type: hazardType || undefined,
          severity_level: severity || undefined,
          operational_impact: impact || undefined,
          initial_estimated_loss: loss ? Number(loss) : undefined,
          description,
          business_interruption_requested: businessInterruption,
          reported_coordinates: reportedCoordinates,
        });
      }
      // Draft rows still need a value in every required column — fields the
      // user hasn't reached yet get a placeholder that PATCH will overwrite
      // once they fill them in (see update_draft_incident in incidents.py).
      return createIncident({
        property_id: property!.property_id,
        incident_timestamp: timestamp ? new Date(timestamp).toISOString() : new Date().toISOString(),
        hazard_type: hazardType || "OTHER",
        severity_level: severity || "LOW",
        operational_impact: impact || "FULL_OPERATION",
        initial_estimated_loss: Number(loss) || 0,
        description: description || "(טיוטה — יושלם מאוחר יותר)",
        is_draft: true,
        business_interruption_requested: businessInterruption,
        reported_coordinates: reportedCoordinates,
      });
    },
    onSuccess: (incident) => {
      setDraftId(incident.incident_id);
      setDraftCode(incident.incident_code);
      localStorage.setItem(DRAFT_STORAGE_KEY, String(incident.incident_id));
      setDraftNotice(`נשמר כטיוטה (מס' ${incident.incident_code}) בשעה ${new Date().toLocaleTimeString("he-IL")} — ניתן לצאת ולחזור מאוחר יותר.`);
    },
  });

  type SubmitResult = { offline: false; incident: Incident } | { offline: true };

  const submitMutation = useMutation({
    mutationFn: async (): Promise<SubmitResult> => {
      const reportedCoordinates = geo.coords ? `${geo.coords.latitude},${geo.coords.longitude}` : null;
      try {
        if (draftId != null) {
          await updateDraftIncident(draftId, {
            property_id: property!.property_id,
            incident_timestamp: new Date(timestamp).toISOString(),
            hazard_type: hazardType as HazardType,
            severity_level: severity as SeverityLevel,
            operational_impact: impact as OperationalImpact,
            initial_estimated_loss: Number(loss) || 0,
            description,
            business_interruption_requested: businessInterruption,
            reported_coordinates: reportedCoordinates,
          });
          const incident = await submitDraftIncident(draftId);
          return { offline: false, incident };
        }
        const incident = await createIncident({
          property_id: property!.property_id,
          incident_timestamp: new Date(timestamp).toISOString(),
          hazard_type: hazardType as HazardType,
          severity_level: severity as SeverityLevel,
          operational_impact: impact as OperationalImpact,
          initial_estimated_loss: Number(loss) || 0,
          description,
          ai_classified: aiResult !== null,
          ai_confidence: aiResult?.confidence ?? null,
          business_interruption_requested: businessInterruption,
          reported_coordinates: reportedCoordinates,
        });
        return { offline: false, incident };
      } catch (err) {
        // A missing response (vs. a 4xx/5xx with one) means the request never reached the
        // server — treat that, and an explicit navigator.onLine === false, as "offline" and
        // fall back to the local queue instead of surfacing a hard failure to the field user.
        const isNetworkFailure = !navigator.onLine || (isAxiosError(err) && !err.response);
        if (!isNetworkFailure) throw err;

        // Offline fallback only ever queues a full new-incident submission — draft PATCH/submit
        // itself isn't queued (see src/offline/syncQueue.ts for the rationale).
        const payload: IncidentCreate = {
          property_id: property!.property_id,
          incident_timestamp: new Date(timestamp).toISOString(),
          hazard_type: hazardType as HazardType,
          severity_level: severity as SeverityLevel,
          operational_impact: impact as OperationalImpact,
          initial_estimated_loss: Number(loss) || 0,
          description,
          ai_classified: aiResult !== null,
          ai_confidence: aiResult?.confidence ?? null,
          business_interruption_requested: businessInterruption,
          reported_coordinates: reportedCoordinates,
        };
        await enqueueIncidentReport(payload, mediaFiles);
        return { offline: true };
      }
    },
    onSuccess: async (result) => {
      if (result.offline) {
        localStorage.removeItem(DRAFT_STORAGE_KEY);
        setDraftId(null);
        setDraftCode(null);
        setSubmittedOffline(true);
        setSubmitted("—");
        return;
      }
      const { incident } = result;
      setMediaUploadError(null);
      if (mediaFiles.length > 0) {
        const failed: string[] = [];
        for (const file of mediaFiles) {
          try {
            await uploadIncidentMedia(incident.incident_id, file);
          } catch {
            failed.push(file.name);
          }
        }
        if (failed.length > 0) {
          setMediaUploadError(`העלאת הקבצים הבאים נכשלה: ${failed.join(", ")}. הדיווח עצמו נשלח בהצלחה.`);
        }
      }
      localStorage.removeItem(DRAFT_STORAGE_KEY);
      setDraftId(null);
      setDraftCode(null);
      setSubmittedOffline(false);
      setSubmitted(incident.incident_code);
    },
  });

  const canNext = [
    !!property && !!timestamp,
    !!hazardType && !!severity && !!impact,
    !!description.trim(),
    true,
  ][activeStep];

  if (submitted) {
    return (
      <Card sx={{ maxWidth: 520, mx: "auto", mt: 6, textAlign: "center", p: 3 }}>
        <CheckCircleIcon color={submittedOffline ? "warning" : "success"} sx={{ fontSize: 64 }} />
        <Typography variant="h5" sx={{ fontWeight: 700, mt: 1 }}>
          {submittedOffline ? "הדיווח נשמר במכשיר" : "הדיווח נשלח בהצלחה"}
        </Typography>
        {submittedOffline ? (
          <Typography color="text.secondary" sx={{ my: 1 }}>
            אין חיבור לרשת כרגע — הדיווח (כולל הקבצים המצורפים) נשמר על המכשיר וישלח אוטומטית ברגע שהחיבור יחזור.
          </Typography>
        ) : (
          <Typography color="text.secondary" sx={{ my: 1 }}>
            מספר אירוע: <strong>{submitted}</strong>
          </Typography>
        )}
        {mediaUploadError && (
          <Alert severity="warning" sx={{ textAlign: "right", mt: 1 }}>
            {mediaUploadError}
          </Alert>
        )}
        <Button
          variant="contained"
          sx={{ mt: 2 }}
          onClick={() => {
            setSubmitted(null);
            setSubmittedOffline(false);
            setActiveStep(0);
            setProperty(null);
            setHazardType("");
            setSeverity("");
            setImpact("");
            setLoss("");
            setDescription("");
            setBusinessInterruption(false);
            setAiResult(null);
            setMediaFiles([]);
            setMediaUploadError(null);
            setDraftId(null);
            setDraftCode(null);
            setDraftNotice(null);
          }}
        >
          דווח אירוע נוסף
        </Button>
      </Card>
    );
  }

  return (
    <Box sx={{ maxWidth: 720, mx: "auto" }}>
      <Alert
        severity="error"
        icon={<WarningAmberIcon sx={{ fontSize: 32 }} />}
        sx={{ mb: 3, fontWeight: 700, fontSize: "1.05rem", py: 1.5, alignItems: "center" }}
      >
        במקרה של סכנת חיים חייג 102/100 מיד
      </Alert>

      {pendingSyncCount > 0 && (
        <Alert
          severity="info"
          sx={{ mb: 2 }}
          action={
            <Button
              color="inherit"
              size="small"
              disabled={syncing}
              startIcon={syncing ? <CircularProgress size={14} color="inherit" /> : undefined}
              onClick={() => trySync()}
            >
              {syncing ? "מסנכרן..." : "נסה לסנכרן עכשיו"}
            </Button>
          }
        >
          {pendingSyncCount} דיווחים ממתינים לסנכרון מהמכשיר הזה (נשמרו כשלא הייתה רשת).
        </Alert>
      )}

      <Typography variant="h5" sx={{ fontWeight: 700, mb: 1 }}>
        דיווח על אירוע נזק חדש
        {draftCode && (
          <Chip size="small" color="default" label={`טיוטה: ${draftCode}`} sx={{ mr: 1.5, fontWeight: 400 }} />
        )}
      </Typography>

      {draftNotice && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setDraftNotice(null)}>
          {draftNotice}
        </Alert>
      )}

      <Stepper activeStep={activeStep} sx={{ mb: 4 }} alternativeLabel>
        {STEPS.map((label) => (
          <Step key={label}>
            <StepLabel>{label}</StepLabel>
          </Step>
        ))}
      </Stepper>

      <Card variant="outlined">
        <CardContent>
          {activeStep === 0 && (
            <Stack spacing={2}>
              <Button
                variant="outlined"
                startIcon={geo.loading ? <CircularProgress size={16} /> : <MyLocationIcon />}
                disabled={geo.loading}
                onClick={geo.request}
                sx={{ alignSelf: "flex-start", minHeight: 48, px: 2.5, fontSize: "1rem" }}
              >
                אתר את מיקומי והצע נכסים קרובים
              </Button>

              {geo.error && <Alert severity="warning">{geo.error}</Alert>}

              {geo.coords && nearbyProperties.length === 0 && (
                <Alert severity="info">לא נמצאו נכסים ברדיוס {NEARBY_RADIUS_KM} ק"מ מהמיקום הנוכחי.</Alert>
              )}

              {nearbyProperties.length > 0 && (
                <Box>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>
                    נכסים קרובים למיקום שלך
                  </Typography>
                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                    {nearbyProperties.map(({ property: p, distance }) => (
                      <Chip
                        key={p.property_id}
                        label={`${p.name} · ${distance.toFixed(1)} ק"מ`}
                        color={property?.property_id === p.property_id ? "primary" : "default"}
                        onClick={() => setProperty(p)}
                        sx={{ mb: 1, height: 40, fontSize: "0.9rem", px: 0.5 }}
                      />
                    ))}
                  </Stack>
                </Box>
              )}

              <Autocomplete
                options={properties ?? []}
                getOptionLabel={(p) => `${p.name} (${p.property_code})`}
                value={property}
                onChange={(_, value) => setProperty(value)}
                renderInput={(params) => <TextField {...params} label="נכס" required />}
              />
              <TextField
                label="תאריך ושעת האירוע"
                type="datetime-local"
                value={timestamp}
                onChange={(e) => setTimestamp(e.target.value)}
                InputLabelProps={{ shrink: true }}
              />
            </Stack>
          )}

          {activeStep === 1 && (
            <Stack spacing={3}>
              <Box>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  סוג הנזק
                </Typography>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  {HAZARD_OPTIONS.map((h) => (
                    <Button
                      key={h.value}
                      variant="outlined"
                      onClick={() => setHazardType(h.value)}
                      style={{
                        backgroundColor: hazardType === h.value ? h.color : "transparent",
                        color: hazardType === h.value ? "white" : h.color,
                        borderColor: h.color,
                      }}
                      sx={{ ...PILL_BUTTON_SX, "&:hover": { bgcolor: h.color, color: "white" } }}
                    >
                      {HAZARD_LABELS[h.value]}
                    </Button>
                  ))}
                </Stack>
              </Box>

              <Box>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  רמת חומרה
                </Typography>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  {SEVERITY_OPTIONS.map((s) => (
                    <Button
                      key={s.value}
                      variant="outlined"
                      onClick={() => setSeverity(s.value)}
                      style={{
                        backgroundColor: severity === s.value ? s.color : "transparent",
                        color: severity === s.value ? "white" : s.color,
                        borderColor: s.color,
                      }}
                      sx={{ ...PILL_BUTTON_SX, "&:hover": { bgcolor: s.color, color: "white" } }}
                    >
                      {SEVERITY_LABELS[s.value]}
                    </Button>
                  ))}
                </Stack>
              </Box>

              <Box>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  סטטוס פעילות בנכס
                </Typography>
                <ToggleButtonGroup
                  value={impact}
                  exclusive
                  onChange={(_, v) => v && setImpact(v)}
                  sx={{ flexWrap: "wrap", gap: 1 }}
                >
                  {IMPACT_OPTIONS.map((i) => (
                    <ToggleButton key={i} value={i} sx={{ ...PILL_BUTTON_SX, border: "1px solid" }}>
                      {OPERATIONAL_IMPACT_LABELS[i]}
                    </ToggleButton>
                  ))}
                </ToggleButtonGroup>
              </Box>
            </Stack>
          )}

          {activeStep === 2 && (
            <Stack spacing={2}>
              <TextField
                label="תיאור האירוע"
                multiline
                minRows={4}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="לדוגמה: פיצוץ בצינור מים ראשי בקומה 1 שגרם להצפה באזור האריזה..."
              />
              <Button
                variant="outlined"
                startIcon={classifyMutation.isPending ? <CircularProgress size={16} /> : <AutoAwesomeIcon />}
                disabled={!description.trim() || classifyMutation.isPending}
                onClick={() => classifyMutation.mutate()}
                sx={{ alignSelf: "flex-start" }}
              >
                נתח עם AI
              </Button>

              {classifyMutation.isError && (
                <Alert severity="warning">ניתוח ה-AI נכשל. ניתן להמשיך ולמלא ידנית.</Alert>
              )}

              {aiResult && (
                <Alert severity="info" icon={<AutoAwesomeIcon fontSize="small" />}>
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>
                    ניתוח AI (ביטחון: {(aiResult.confidence * 100).toFixed(0)}%)
                  </Typography>
                  <Typography variant="body2">{aiResult.reasoning}</Typography>
                  <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                    <Chip size="small" label={HAZARD_LABELS[aiResult.hazard_type]} />
                    <Chip size="small" label={SEVERITY_LABELS[aiResult.severity_level]} />
                    {aiResult.business_interruption_likely && (
                      <Chip size="small" color="warning" label="צפוי אובדן רווחים" />
                    )}
                  </Stack>
                </Alert>
              )}

              <TextField
                label="הערכת נזק ראשונית (₪)"
                type="number"
                value={loss}
                onChange={(e) => setLoss(e.target.value)}
              />

              <FormControlLabel
                sx={{ alignSelf: "flex-start" }}
                control={
                  <Checkbox
                    checked={businessInterruption}
                    onChange={(e) => setBusinessInterruption(e.target.checked)}
                    sx={{ p: 1.25 }}
                  />
                }
                label={
                  <Box>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      בקשה לכיסוי אובדן רווחים (הפסקת פעילות)
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      סמן אם האירוע גרם, או צפוי לגרום, לאובדן הכנסות עקב הפסקת פעילות בנכס
                    </Typography>
                  </Box>
                }
              />
            </Stack>
          )}

          {activeStep === 3 && (
            <Stack spacing={2}>
              <MediaUploader files={mediaFiles} onFilesChange={setMediaFiles} disabled={submitMutation.isPending} />

              {submitMutation.isPending && (
                <Stack spacing={0.5}>
                  <LinearProgress />
                  {mediaFiles.length > 0 && (
                    <Typography variant="caption" color="text.secondary">
                      שולח דיווח ומעלה {mediaFiles.length} קבצים...
                    </Typography>
                  )}
                </Stack>
              )}
              {submitMutation.isError && <Alert severity="error">שליחת הדיווח נכשלה. נסה שוב.</Alert>}
            </Stack>
          )}

          <Stack
            direction="row"
            justifyContent="space-between"
            alignItems="center"
            flexWrap="wrap"
            useFlexGap
            gap={1}
            sx={{ mt: 4 }}
          >
            <Button
              disabled={activeStep === 0}
              onClick={() => setActiveStep((s) => s - 1)}
              sx={{ minHeight: 48, px: 2.5, fontSize: "1rem" }}
            >
              חזרה
            </Button>
            <Button
              startIcon={saveDraftMutation.isPending ? <CircularProgress size={16} /> : undefined}
              disabled={!property || saveDraftMutation.isPending}
              onClick={() => saveDraftMutation.mutate()}
              sx={{ minHeight: 48, px: 2.5, fontSize: "1rem" }}
            >
              שמור כטיוטה
            </Button>
            {activeStep < STEPS.length - 1 ? (
              <Button
                variant="contained"
                disabled={!canNext}
                onClick={() => setActiveStep((s) => s + 1)}
                sx={{ minHeight: 48, px: 3, fontSize: "1rem" }}
              >
                המשך
              </Button>
            ) : (
              <Button
                variant="contained"
                color="secondary"
                disabled={submitMutation.isPending}
                onClick={() => submitMutation.mutate()}
                sx={{ minHeight: 48, px: 3, fontSize: "1rem" }}
              >
                שלח דיווח למטה
              </Button>
            )}
          </Stack>
          {saveDraftMutation.isError && (
            <Alert severity="error" sx={{ mt: 2 }}>
              שמירת הטיוטה נכשלה. נסה שוב.
            </Alert>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
