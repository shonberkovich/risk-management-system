import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import BlockIcon from "@mui/icons-material/Block";
import DeleteIcon from "@mui/icons-material/Delete";
import DescriptionIcon from "@mui/icons-material/Description";
import EditIcon from "@mui/icons-material/Edit";
import LocalFireDepartmentIcon from "@mui/icons-material/LocalFireDepartment";
import PublicIcon from "@mui/icons-material/Public";
import ShieldIcon from "@mui/icons-material/Shield";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import WaterDropIcon from "@mui/icons-material/WaterDrop";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import Grid from "@mui/material/Grid";
import IconButton from "@mui/material/IconButton";
import Link from "@mui/material/Link";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import {
  deactivateProperty,
  deleteDocument,
  fetchDocumentSignedUrl,
  fetchDocumentsForEntity,
  fetchProperty,
  uploadDocument,
  type DocumentFile,
} from "../api/client";
import { useAuth } from "../auth/AuthContext";
import PropertyDialog from "../components/PropertyDialog";
import { ASSET_TYPE_LABELS, DOCUMENT_TYPE_LABELS, formatDate, formatIls, formatIlsCompact } from "../format";

const DOC_TYPE_OPTIONS = Object.keys(DOCUMENT_TYPE_LABELS);
// Same ADMIN/RISK_MANAGER/PROPERTY_MANAGER write-role set backend/app/routers/properties.py
// enforces server-side (_PROPERTIES_WRITE_ROLES) — mirrored here just to hide edit/deactivate
// controls from roles that would get a 403 anyway, not as the actual enforcement.
const PROPERTY_WRITE_ROLES = ["RISK_MANAGER", "PROPERTY_MANAGER", "ADMIN"];

function RiskScoreRow({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  const color = value >= 4 ? "error.main" : value >= 3 ? "warning.main" : "success.main";
  return (
    <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
      <Stack direction="row" spacing={0.5} alignItems="center">
        {icon}
        <Typography variant="body2">{label}</Typography>
      </Stack>
      <Typography variant="body2" sx={{ fontWeight: 700, color }}>
        {value} / 5
      </Typography>
    </Stack>
  );
}

function DocumentRow({ doc, onDelete, canWrite }: { doc: DocumentFile; onDelete: (id: number) => void; canWrite: boolean }) {
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
      {canWrite && (
        <IconButton size="small" onClick={() => onDelete(doc.document_id)} aria-label="מחק מסמך">
          <DeleteIcon fontSize="small" />
        </IconButton>
      )}
    </Stack>
  );
}

/** Full property drill-down (TODO_SPEC.md §5, "ניהול נכסים ותיק נכס") — the active
 * policy, documents, and risk survey for one property, plus edit/deactivate actions.
 * Risk-survey editing itself is out of scope here (shown read-only) — that's the next
 * TODO item, RiskSurveyDialog.tsx, which this page's risk-profile card is written to
 * plug into once it exists. */
export default function PropertyDetail() {
  const { id } = useParams<{ id: string }>();
  const propertyId = Number(id);
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const canWrite = !!user && PROPERTY_WRITE_ROLES.includes(user.role);

  const [editOpen, setEditOpen] = useState(false);
  const [docType, setDocType] = useState(DOC_TYPE_OPTIONS[0]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [deactivateError, setDeactivateError] = useState<string | null>(null);

  const property = useQuery({
    queryKey: ["property", propertyId],
    queryFn: () => fetchProperty(propertyId),
    enabled: !Number.isNaN(propertyId),
  });

  const documents = useQuery({
    queryKey: ["documents", "entity", "PROPERTY", propertyId],
    queryFn: () => fetchDocumentsForEntity("PROPERTY", propertyId),
    enabled: !Number.isNaN(propertyId),
  });

  const handleUpload = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setUploading(true);
    setUploadError(null);
    try {
      for (const file of Array.from(fileList)) {
        await uploadDocument("PROPERTY", propertyId, file, docType);
      }
      queryClient.invalidateQueries({ queryKey: ["documents", "entity", "PROPERTY", propertyId] });
    } catch {
      setUploadError("העלאת הקובץ נכשלה. נסו שוב.");
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteDoc = async (documentId: number) => {
    await deleteDocument(documentId);
    queryClient.invalidateQueries({ queryKey: ["documents", "entity", "PROPERTY", propertyId] });
  };

  const handleDeactivate = async () => {
    if (!window.confirm("להשבית את הנכס? הנכס לא יופיע יותר ברשימת הנכסים הפעילים.")) return;
    setDeactivateError(null);
    try {
      await deactivateProperty(propertyId);
      queryClient.invalidateQueries({ queryKey: ["properties"] });
      navigate("/properties");
    } catch {
      setDeactivateError("השבתת הנכס נכשלה.");
    }
  };

  if (property.isLoading) {
    return (
      <Stack alignItems="center" sx={{ py: 8 }}>
        <CircularProgress />
      </Stack>
    );
  }

  if (property.isError || !property.data) {
    return <Alert severity="error">הנכס המבוקש לא נמצא.</Alert>;
  }

  const p = property.data;

  return (
    <Stack spacing={3}>
      <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
        <Stack direction="row" spacing={1} alignItems="center">
          <IconButton size="small" onClick={() => navigate("/properties")} aria-label="חזרה לרשימת נכסים">
            <ArrowForwardIcon />
          </IconButton>
          <Box>
            <Typography variant="h5" sx={{ fontWeight: 700 }}>
              {p.name}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {p.property_code}
              {!p.is_active && " · מושבת"}
            </Typography>
          </Box>
        </Stack>
        {canWrite && (
          <Stack direction="row" spacing={1}>
            <Button variant="outlined" startIcon={<EditIcon />} onClick={() => setEditOpen(true)}>
              עריכה
            </Button>
            {p.is_active && (
              <Tooltip title="השבתת נכס">
                <Button color="error" variant="outlined" startIcon={<BlockIcon />} onClick={handleDeactivate}>
                  השבתה
                </Button>
              </Tooltip>
            )}
          </Stack>
        )}
      </Stack>

      {deactivateError && <Alert severity="error">{deactivateError}</Alert>}

      <Card variant="outlined">
        <CardContent>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6} md={3}>
              <Typography variant="caption" color="text.secondary" display="block">
                כתובת
              </Typography>
              <Typography sx={{ fontWeight: 600 }}>{p.address}</Typography>
            </Grid>
            <Grid item xs={6} sm={3} md={2}>
              <Typography variant="caption" color="text.secondary" display="block">
                אזור
              </Typography>
              <Chip size="small" label={p.region} icon={<PublicIcon fontSize="small" />} variant="outlined" />
            </Grid>
            <Grid item xs={6} sm={3} md={2}>
              <Typography variant="caption" color="text.secondary" display="block">
                סוג נכס
              </Typography>
              <Typography sx={{ fontWeight: 600 }}>{ASSET_TYPE_LABELS[p.asset_type] ?? p.asset_type}</Typography>
            </Grid>
            <Grid item xs={6} sm={3} md={2}>
              <Typography variant="caption" color="text.secondary" display="block">
                שווי כינון
              </Typography>
              <Typography sx={{ fontWeight: 700 }}>{formatIlsCompact(p.replacement_value)}</Typography>
            </Grid>
            <Grid item xs={6} sm={3} md={2}>
              <Typography variant="caption" color="text.secondary" display="block">
                ערך בספרים
              </Typography>
              <Typography sx={{ fontWeight: 700 }}>{formatIlsCompact(p.book_value)}</Typography>
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <Typography variant="caption" color="text.secondary" display="block">
                מנהל נכס אחראי
              </Typography>
              <Typography sx={{ fontWeight: 600 }}>{p.manager_name ?? "לא שויך"}</Typography>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      <Grid container spacing={3}>
        <Grid item xs={12} md={6}>
          <Card variant="outlined" sx={{ height: "100%" }}>
            <CardContent>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>
                <ShieldIcon fontSize="small" sx={{ verticalAlign: "middle", marginInlineEnd: 0.5 }} />
                פוליסה פעילה
              </Typography>
              {p.active_policy ? (
                <Stack spacing={1}>
                  <Stack direction="row" justifyContent="space-between">
                    <Typography variant="body2" color="text.secondary">
                      מספר פוליסה
                    </Typography>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {p.active_policy.policy_number}
                    </Typography>
                  </Stack>
                  <Stack direction="row" justifyContent="space-between">
                    <Typography variant="body2" color="text.secondary">
                      מבטח
                    </Typography>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {p.active_policy.insurer_name}
                    </Typography>
                  </Stack>
                  <Stack direction="row" justifyContent="space-between">
                    <Typography variant="body2" color="text.secondary">
                      גבול כיסוי כולל
                    </Typography>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {formatIls(p.active_policy.total_limit)}
                    </Typography>
                  </Stack>
                  {p.active_policy.per_event_limit != null && (
                    <Stack direction="row" justifyContent="space-between">
                      <Typography variant="body2" color="text.secondary">
                        גבול לאירוע
                      </Typography>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {formatIls(p.active_policy.per_event_limit)}
                      </Typography>
                    </Stack>
                  )}
                  {p.active_policy.specific_deductible != null && (
                    <Stack direction="row" justifyContent="space-between">
                      <Typography variant="body2" color="text.secondary">
                        השתתפות עצמית ספציפית
                      </Typography>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {formatIls(p.active_policy.specific_deductible)}
                      </Typography>
                    </Stack>
                  )}
                  <Link href="/policies" variant="caption" sx={{ pt: 0.5 }}>
                    צפייה בכל הפוליסות
                  </Link>
                </Stack>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  לנכס זה אין פוליסה פעילה כרגע.
                </Typography>
              )}
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={6}>
          <Card variant="outlined" sx={{ height: "100%" }}>
            <CardContent>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>
                סקר סיכונים
              </Typography>
              {p.risk_profile ? (
                <Stack spacing={1.5}>
                  <Typography variant="caption" color="text.secondary">
                    נסקר בתאריך {formatDate(p.risk_profile.survey_date)}
                  </Typography>
                  <RiskScoreRow label="סיכון הצפה" value={p.risk_profile.flood_risk_score} icon={<WaterDropIcon fontSize="small" color="info" />} />
                  <RiskScoreRow label="סיכון שריפה" value={p.risk_profile.fire_risk_score} icon={<LocalFireDepartmentIcon fontSize="small" color="warning" />} />
                  <RiskScoreRow label="סיכון רעידת אדמה" value={p.risk_profile.earthquake_risk_score} icon={<PublicIcon fontSize="small" />} />
                  <Divider />
                  <Stack direction="row" justifyContent="space-between">
                    <Typography variant="body2" color="text.secondary">
                      MFL (Maximum Foreseeable Loss)
                    </Typography>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>
                      {formatIls(p.risk_profile.mfl_amount)}
                    </Typography>
                  </Stack>
                  <Chip
                    size="small"
                    label={p.risk_profile.has_sprinklers ? "מותקנים מתזים" : "אין מתזים"}
                    color={p.risk_profile.has_sprinklers ? "success" : "default"}
                    variant="outlined"
                    sx={{ alignSelf: "flex-start" }}
                  />
                  {p.risk_profile.notes && (
                    <Typography variant="body2" color="text.secondary">
                      {p.risk_profile.notes}
                    </Typography>
                  )}
                </Stack>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  טרם נערך סקר סיכונים לנכס זה.
                </Typography>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Card variant="outlined">
        <CardContent>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              מסמכים מצורפים לנכס ({documents.data?.length ?? 0})
            </Typography>
            {canWrite && (
              <Stack direction="row" spacing={1} alignItems="center">
                <TextField
                  select
                  size="small"
                  label="סוג מסמך"
                  value={docType}
                  onChange={(e) => setDocType(e.target.value)}
                  sx={{ minWidth: 180 }}
                >
                  {DOC_TYPE_OPTIONS.map((t) => (
                    <MenuItem key={t} value={t}>
                      {DOCUMENT_TYPE_LABELS[t]}
                    </MenuItem>
                  ))}
                </TextField>
                <Button variant="outlined" component="label" size="small" startIcon={<UploadFileIcon />} disabled={uploading}>
                  {uploading ? "מעלה..." : "העלאת מסמך"}
                  <input
                    type="file"
                    multiple
                    hidden
                    onChange={(e) => {
                      handleUpload(e.target.files);
                      e.target.value = "";
                    }}
                  />
                </Button>
              </Stack>
            )}
          </Stack>

          {uploadError && (
            <Alert severity="error" sx={{ mb: 1.5 }}>
              {uploadError}
            </Alert>
          )}

          {documents.isLoading ? (
            <CircularProgress size={20} />
          ) : (documents.data ?? []).length > 0 ? (
            <Stack spacing={0.75}>
              {(documents.data ?? []).map((d) => (
                <DocumentRow key={d.document_id} doc={d} onDelete={handleDeleteDoc} canWrite={canWrite} />
              ))}
            </Stack>
          ) : (
            <Typography variant="body2" color="text.secondary">
              לא צורפו מסמכים לנכס זה עדיין.
            </Typography>
          )}
        </CardContent>
      </Card>

      <PropertyDialog open={editOpen} property={p} onClose={() => setEditOpen(false)} />
    </Stack>
  );
}
