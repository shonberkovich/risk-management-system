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
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
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
import { useState } from "react";

import {
  classifyIncident,
  createIncident,
  fetchProperties,
  uploadIncidentMedia,
  type HazardType,
  type IncidentClassification,
  type OperationalImpact,
  type Property,
  type SeverityLevel,
} from "../api/client";
import MediaUploader from "../components/MediaUploader";
import { distanceKm, useGeolocation } from "../hooks/useGeolocation";
import { HAZARD_LABELS, OPERATIONAL_IMPACT_LABELS, SEVERITY_LABELS } from "../format";

const STEPS = ["מיקום וזיהוי הנכס", "פרטי הנזק והחומרה", "אומדן כספי ותיאור", "תיעוד ושליחה"];

const NEARBY_RADIUS_KM = 15;

const HAZARD_OPTIONS: HazardType[] = ["FLOOD", "FIRE", "STRUCTURAL_FAILURE", "THEFT", "ELECTRICAL", "OTHER"];
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
  const [aiResult, setAiResult] = useState<IncidentClassification | null>(null);
  const [mediaFiles, setMediaFiles] = useState<File[]>([]);
  const [mediaUploadError, setMediaUploadError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<string | null>(null);

  const { data: properties } = useQuery({ queryKey: ["properties"], queryFn: fetchProperties });
  const geo = useGeolocation();

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
    },
  });

  const submitMutation = useMutation({
    mutationFn: () =>
      createIncident({
        property_id: property!.property_id,
        incident_timestamp: new Date(timestamp).toISOString(),
        hazard_type: hazardType as HazardType,
        severity_level: severity as SeverityLevel,
        operational_impact: impact as OperationalImpact,
        initial_estimated_loss: Number(loss) || 0,
        description,
        ai_classified: aiResult !== null,
        ai_confidence: aiResult?.confidence ?? null,
        reported_coordinates: geo.coords ? `${geo.coords.latitude},${geo.coords.longitude}` : null,
      }),
    onSuccess: async (incident) => {
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
        <CheckCircleIcon color="success" sx={{ fontSize: 64 }} />
        <Typography variant="h5" sx={{ fontWeight: 700, mt: 1 }}>
          הדיווח נשלח בהצלחה
        </Typography>
        <Typography color="text.secondary" sx={{ my: 1 }}>
          מספר אירוע: <strong>{submitted}</strong>
        </Typography>
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
            setActiveStep(0);
            setProperty(null);
            setHazardType("");
            setSeverity("");
            setImpact("");
            setLoss("");
            setDescription("");
            setAiResult(null);
            setMediaFiles([]);
            setMediaUploadError(null);
          }}
        >
          דווח אירוע נוסף
        </Button>
      </Card>
    );
  }

  return (
    <Box sx={{ maxWidth: 720, mx: "auto" }}>
      <Alert severity="error" icon={<WarningAmberIcon />} sx={{ mb: 3, fontWeight: 700 }}>
        במקרה של סכנת חיים חייג 102/100 מיד
      </Alert>

      <Typography variant="h5" sx={{ fontWeight: 700, mb: 2 }}>
        דיווח על אירוע נזק חדש
      </Typography>

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
                sx={{ alignSelf: "flex-start" }}
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
                        sx={{ mb: 1 }}
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
                <ToggleButtonGroup
                  value={hazardType}
                  exclusive
                  onChange={(_, v) => v && setHazardType(v)}
                  sx={{ flexWrap: "wrap", gap: 1 }}
                >
                  {HAZARD_OPTIONS.map((h) => (
                    <ToggleButton key={h} value={h} sx={{ borderRadius: 2, px: 2 }}>
                      {HAZARD_LABELS[h]}
                    </ToggleButton>
                  ))}
                </ToggleButtonGroup>
              </Box>

              <Box>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  רמת חומרה
                </Typography>
                <Stack direction="row" spacing={1} flexWrap="wrap">
                  {SEVERITY_OPTIONS.map((s) => (
                    <Button
                      key={s.value}
                      variant={severity === s.value ? "contained" : "outlined"}
                      onClick={() => setSeverity(s.value)}
                      sx={{
                        borderColor: s.color,
                        color: severity === s.value ? "white" : s.color,
                        bgcolor: severity === s.value ? s.color : "transparent",
                        "&:hover": { bgcolor: s.color, color: "white" },
                      }}
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
                <ToggleButtonGroup value={impact} exclusive onChange={(_, v) => v && setImpact(v)}>
                  {IMPACT_OPTIONS.map((i) => (
                    <ToggleButton key={i} value={i} sx={{ borderRadius: 2, px: 2 }}>
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

          <Stack direction="row" justifyContent="space-between" sx={{ mt: 4 }}>
            <Button disabled={activeStep === 0} onClick={() => setActiveStep((s) => s - 1)}>
              חזרה
            </Button>
            {activeStep < STEPS.length - 1 ? (
              <Button variant="contained" disabled={!canNext} onClick={() => setActiveStep((s) => s + 1)}>
                המשך
              </Button>
            ) : (
              <Button
                variant="contained"
                color="secondary"
                disabled={submitMutation.isPending}
                onClick={() => submitMutation.mutate()}
              >
                שלח דיווח למטה
              </Button>
            )}
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}
