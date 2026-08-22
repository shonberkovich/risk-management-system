import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import DeleteIcon from "@mui/icons-material/Delete";
import DescriptionIcon from "@mui/icons-material/Description";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import Grid from "@mui/material/Grid";
import IconButton from "@mui/material/IconButton";
import Link from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";

import {
  deleteIncidentMedia,
  fetchDocumentSignedUrl,
  fetchDocumentsForEntity,
  fetchIncidentDrilldown,
  fetchMediaSignedUrl,
  fetchProperty,
  type ClaimWithPayments,
  type DocumentFile,
  type IncidentMedia,
} from "../api/client";
import { useAuth } from "../auth/AuthContext";
import {
  CLAIM_STATUS_LABELS,
  DOCUMENT_TYPE_LABELS,
  HAZARD_LABELS,
  INCIDENT_STATUS_LABELS,
  OPERATIONAL_IMPACT_LABELS,
  PAYMENT_TYPE_LABELS,
  SEVERITY_COLORS,
  SEVERITY_LABELS,
  formatDate,
  formatIls,
} from "../format";

// Same RISK_MANAGER/ADMIN set backend/app/routers/media.py enforces server-side
// (inline require_roles("RISK_MANAGER", "ADMIN") on DELETE /api/media/{id}, same
// narrower-than-canWrite set PropertyDetail.tsx's DOCUMENT_DELETE_ROLES uses for
// the equivalent document-delete case) — gates the media thumbnail's delete button.
const MEDIA_DELETE_ROLES = ["RISK_MANAGER", "ADMIN"];

const INCIDENT_STATUS_COLOR: Record<string, "default" | "warning" | "success" | "error" | "info"> = {
  NEW: "info",
  UNDER_INVESTIGATION: "warning",
  CLAIM_FILED: "default",
  CLOSED: "success",
};

const CLAIM_STATUS_COLOR: Record<string, "default" | "warning" | "success" | "error" | "info"> = {
  DRAFT: "default",
  SUBMITTED: "info",
  IN_ADJUSTMENT: "warning",
  APPROVED: "success",
  REJECTED: "error",
  SETTLED: "success",
};

// Media/documents are stored behind the two-step signed-URL contract
// (GET .../signed-url → then GET the returned download_url) rather than a
// direct static path — this thumbnail/link resolves that on mount and shows
// a graceful fallback if the underlying file isn't actually on disk (true
// for the illustrative seeded Documents rows, which point at fake external
// s3_url values rather than real local storage keys).
function MediaThumbnail({ media, canDelete }: { media: IncidentMedia; canDelete: boolean }) {
  const signed = useQuery({
    queryKey: ["media-signed-url", media.media_id],
    queryFn: () => fetchMediaSignedUrl(media.media_id),
  });
  const isImage = media.file_type.startsWith("image/");
  const queryClient = useQueryClient();

  const deleteMutation = useMutation({
    mutationFn: () => deleteIncidentMedia(media.media_id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["incident-drilldown", media.incident_id] }),
  });

  return (
    <Card variant="outlined" sx={{ position: "relative" }}>
      {canDelete && (
        <Tooltip title="מחיקת מדיה">
          <IconButton
            size="small"
            disabled={deleteMutation.isPending}
            onClick={() => {
              if (window.confirm("למחוק את הקובץ הזה?")) deleteMutation.mutate();
            }}
            sx={{
              position: "absolute",
              top: 4,
              insetInlineEnd: 4,
              zIndex: 1,
              bgcolor: "background.paper",
              "&:hover": { bgcolor: "background.paper" },
            }}
          >
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      )}
      {isImage && signed.data ? (
        <Box
          component="img"
          src={signed.data.download_url}
          alt={`תמונה מהשטח - ${formatDate(media.captured_at)}`}
          sx={{ width: "100%", height: 140, objectFit: "cover", display: "block" }}
        />
      ) : (
        <Stack alignItems="center" justifyContent="center" sx={{ height: 140, bgcolor: "action.hover" }}>
          <InsertDriveFileIcon fontSize="large" color="action" />
        </Stack>
      )}
      <CardContent sx={{ py: 1, "&:last-child": { pb: 1 } }}>
        <Typography variant="caption" display="block" color="text.secondary">
          {formatDate(media.captured_at)}
        </Typography>
        {media.gps_latitude != null && media.gps_longitude != null && (
          <Typography variant="caption" display="block" color="text.secondary">
            {media.gps_latitude.toFixed(4)}, {media.gps_longitude.toFixed(4)}
          </Typography>
        )}
        {deleteMutation.isError && (
          <Typography variant="caption" display="block" color="error.main">
            מחיקה נכשלה.
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}

function DocumentRow({ doc }: { doc: DocumentFile }) {
  const signed = useQuery({
    queryKey: ["document-signed-url", doc.document_id],
    queryFn: () => fetchDocumentSignedUrl(doc.document_id),
  });

  return (
    <Stack direction="row" spacing={1} alignItems="center">
      <DescriptionIcon fontSize="small" color="action" />
      <Typography variant="body2" sx={{ flex: 1 }}>
        {DOCUMENT_TYPE_LABELS[doc.doc_type] ?? doc.doc_type}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        {formatDate(doc.uploaded_at)}
      </Typography>
      {signed.data ? (
        <Link href={signed.data.download_url} target="_blank" rel="noopener" variant="caption">
          פתיחה
        </Link>
      ) : (
        <Typography variant="caption" color="text.secondary">
          —
        </Typography>
      )}
    </Stack>
  );
}

function ClaimCard({ claim }: { claim: ClaimWithPayments }) {
  const documents = useQuery({
    queryKey: ["documents", "CLAIM", claim.claim_id],
    queryFn: () => fetchDocumentsForEntity("CLAIM", claim.claim_id),
  });
  const paid = claim.payments.reduce((sum, p) => sum + p.amount, 0);

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            {claim.claim_number}
          </Typography>
          <Chip size="small" label={CLAIM_STATUS_LABELS[claim.claim_status] ?? claim.claim_status} color={CLAIM_STATUS_COLOR[claim.claim_status]} />
        </Stack>

        <Grid container spacing={2} sx={{ mb: 1 }}>
          <Grid item xs={6} sm={3}>
            <Typography variant="caption" color="text.secondary" display="block">
              סכום נתבע
            </Typography>
            <Typography sx={{ fontWeight: 700 }}>{formatIls(claim.claimed_amount)}</Typography>
          </Grid>
          <Grid item xs={6} sm={3}>
            <Typography variant="caption" color="text.secondary" display="block">
              השתתפות עצמית
            </Typography>
            <Typography sx={{ fontWeight: 700 }}>{formatIls(claim.deductible_applied)}</Typography>
          </Grid>
          <Grid item xs={6} sm={3}>
            <Typography variant="caption" color="text.secondary" display="block">
              סכום מאושר
            </Typography>
            <Typography sx={{ fontWeight: 700 }}>{formatIls(claim.approved_amount)}</Typography>
          </Grid>
          <Grid item xs={6} sm={3}>
            <Typography variant="caption" color="text.secondary" display="block">
              שולם בפועל
            </Typography>
            <Typography sx={{ fontWeight: 700 }}>{formatIls(paid)}</Typography>
          </Grid>
        </Grid>

        <Typography variant="caption" color="text.secondary" display="block">
          שמאי אחראי: {claim.adjuster_name ?? "לא שויך"}
          {claim.expected_payment_date && ` · צפי תשלום: ${formatDate(claim.expected_payment_date)}`}
        </Typography>

        <Divider sx={{ my: 1.5 }} />

        <Typography variant="caption" sx={{ fontWeight: 600 }} display="block" gutterBottom>
          תשלומים
        </Typography>
        {claim.payments.length > 0 ? (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>תאריך</TableCell>
                <TableCell>סוג</TableCell>
                <TableCell align="left">סכום</TableCell>
                <TableCell>אסמכתא</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {claim.payments.map((p) => (
                <TableRow key={p.payment_id}>
                  <TableCell>{formatDate(p.payment_date)}</TableCell>
                  <TableCell>{PAYMENT_TYPE_LABELS[p.payment_type] ?? p.payment_type}</TableCell>
                  <TableCell align="left">{formatIls(p.amount)}</TableCell>
                  <TableCell>{p.reference_number ?? "-"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <Typography variant="body2" color="text.secondary">
            טרם נרשמו תשלומים לתביעה זו.
          </Typography>
        )}

        <Typography variant="caption" sx={{ fontWeight: 600, mt: 1.5 }} display="block" gutterBottom>
          מסמכים (כולל דוח שמאי)
        </Typography>
        {documents.isLoading ? (
          <CircularProgress size={16} />
        ) : (documents.data ?? []).length > 0 ? (
          <Stack spacing={0.5}>
            {(documents.data ?? []).map((d) => (
              <DocumentRow key={d.document_id} doc={d} />
            ))}
          </Stack>
        ) : (
          <Typography variant="body2" color="text.secondary">
            לא צורפו מסמכים לתביעה זו.
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}

export default function IncidentDetail() {
  const { id } = useParams<{ id: string }>();
  const incidentId = Number(id);
  const navigate = useNavigate();
  const { user } = useAuth();
  const canDeleteMedia = !!user && MEDIA_DELETE_ROLES.includes(user.role);

  const drilldown = useQuery({
    queryKey: ["incident-drilldown", incidentId],
    queryFn: () => fetchIncidentDrilldown(incidentId),
    enabled: !Number.isNaN(incidentId),
  });

  const property = useQuery({
    queryKey: ["property", drilldown.data?.incident.property_id],
    queryFn: () => fetchProperty(drilldown.data!.incident.property_id),
    enabled: !!drilldown.data,
  });

  if (drilldown.isLoading) {
    return (
      <Stack alignItems="center" sx={{ py: 8 }}>
        <CircularProgress />
      </Stack>
    );
  }

  if (drilldown.isError || !drilldown.data) {
    return <Alert severity="error">האירוע המבוקש לא נמצא.</Alert>;
  }

  const { incident, media, claims, documents } = drilldown.data;

  return (
    <Stack spacing={3}>
      <Stack direction="row" spacing={1} alignItems="center">
        <IconButton size="small" onClick={() => navigate("/incidents")} aria-label="חזרה לרשימת אירועים">
          <ArrowForwardIcon />
        </IconButton>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>
          תיק אירוע — {incident.incident_code}
        </Typography>
      </Stack>

      <Card variant="outlined">
        <CardContent>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
            <Chip size="small" label={INCIDENT_STATUS_LABELS[incident.status] ?? incident.status} color={INCIDENT_STATUS_COLOR[incident.status]} />
            <Chip size="small" label={SEVERITY_LABELS[incident.severity_level] ?? incident.severity_level} color={SEVERITY_COLORS[incident.severity_level]} />
            <Chip size="small" variant="outlined" label={HAZARD_LABELS[incident.hazard_type] ?? incident.hazard_type} />
            <Chip size="small" variant="outlined" label={OPERATIONAL_IMPACT_LABELS[incident.operational_impact] ?? incident.operational_impact} />
            {incident.business_interruption_requested && <Chip size="small" color="warning" label="נדרש כיסוי אובדן רווחים" />}
          </Stack>

          <Grid container spacing={2}>
            <Grid item xs={12} sm={6} md={3}>
              <Typography variant="caption" color="text.secondary" display="block">
                נכס
              </Typography>
              <Typography sx={{ fontWeight: 700 }}>{property.data?.name ?? `#${incident.property_id}`}</Typography>
              {property.data && (
                <Typography variant="caption" color="text.secondary">
                  {property.data.address}
                </Typography>
              )}
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <Typography variant="caption" color="text.secondary" display="block">
                תאריך אירוע
              </Typography>
              <Typography sx={{ fontWeight: 700 }}>{formatDate(incident.incident_timestamp)}</Typography>
              {incident.area_or_building && (
                <Typography variant="caption" color="text.secondary">
                  {incident.area_or_building}
                </Typography>
              )}
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <Typography variant="caption" color="text.secondary" display="block">
                אומדן נזק ראשוני
              </Typography>
              <Typography sx={{ fontWeight: 700 }}>{formatIls(incident.initial_estimated_loss)}</Typography>
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <Typography variant="caption" color="text.secondary" display="block">
                סיווג
              </Typography>
              <Typography sx={{ fontWeight: 700 }}>
                {incident.ai_classified ? `AI (ביטחון ${((incident.ai_confidence ?? 0) * 100).toFixed(0)}%)` : "ידני"}
              </Typography>
            </Grid>
          </Grid>

          <Divider sx={{ my: 2 }} />

          <Typography variant="caption" color="text.secondary" display="block" gutterBottom>
            תיאור
          </Typography>
          <Typography variant="body2">{incident.description}</Typography>
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardContent>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 2 }}>
            תמונות ומדיה מהשטח ({media.length})
          </Typography>
          {media.length > 0 ? (
            <Grid container spacing={2}>
              {media.map((m) => (
                <Grid item xs={6} sm={4} md={3} key={m.media_id}>
                  <MediaThumbnail media={m} canDelete={canDeleteMedia} />
                </Grid>
              ))}
            </Grid>
          ) : (
            <Typography variant="body2" color="text.secondary">
              לא צורפה מדיה מהשטח לאירוע זה.
            </Typography>
          )}
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardContent>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
            מסמכים מצורפים לאירוע ({documents.length})
          </Typography>
          {documents.length > 0 ? (
            <Stack spacing={0.5}>
              {documents.map((d) => (
                <DocumentRow key={d.document_id} doc={d} />
              ))}
            </Stack>
          ) : (
            <Typography variant="body2" color="text.secondary">
              לא צורפו מסמכים ישירות לאירוע (מסמכי תביעה, כגון דוח שמאי, מופיעים תחת התביעה המשויכת למטה).
            </Typography>
          )}
        </CardContent>
      </Card>

      <Stack spacing={2}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
          תביעה משויכת ({claims.length})
        </Typography>
        {claims.length > 0 ? (
          claims.map((c) => <ClaimCard key={c.claim_id} claim={c} />)
        ) : (
          <Alert severity="info">טרם הוגשה תביעה עבור אירוע זה.</Alert>
        )}
      </Stack>
    </Stack>
  );
}
