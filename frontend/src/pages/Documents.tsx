import DeleteIcon from "@mui/icons-material/Delete";
import DescriptionIcon from "@mui/icons-material/Description";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import Autocomplete from "@mui/material/Autocomplete";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import Link from "@mui/material/Link";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import {
  deleteDocument,
  fetchClaims,
  fetchDocumentSignedUrl,
  fetchDocumentsForEntity,
  fetchIncidents,
  fetchPolicies,
  fetchProperties,
  fetchUsers,
  uploadDocument,
  type DocumentEntityType,
  type DocumentFile,
} from "../api/client";
import { DOCUMENT_TYPE_LABELS, formatDate } from "../format";

const ENTITY_TYPE_LABELS: Record<DocumentEntityType, string> = {
  INCIDENT: "אירוע",
  CLAIM: "תביעה",
  PROPERTY: "נכס",
  POLICY: "פוליסה",
};

const DOC_TYPE_OPTIONS = Object.keys(DOCUMENT_TYPE_LABELS);

interface EntityOption {
  id: number;
  label: string;
}

/** Row-level signed-URL fetch + open link, matching the two-step contract
 * already established in IncidentDetail.tsx (GET .../signed-url, then GET the
 * returned download_url). Kept local to this file since Documents.tsx is the
 * only other place, besides the incident drill-down, that needs it. */
function DocumentRow({ doc, onDelete }: { doc: DocumentFile; onDelete: (id: number) => void }) {
  const signed = useQuery({
    queryKey: ["document-signed-url", doc.document_id],
    queryFn: () => fetchDocumentSignedUrl(doc.document_id),
  });

  return (
    <TableRow>
      <TableCell>
        <Stack direction="row" spacing={1} alignItems="center">
          <DescriptionIcon fontSize="small" color="action" />
          <Typography variant="body2">{DOCUMENT_TYPE_LABELS[doc.doc_type] ?? doc.doc_type}</Typography>
        </Stack>
      </TableCell>
      <TableCell>{formatDate(doc.uploaded_at)}</TableCell>
      <TableCell>
        {signed.data ? (
          <Link href={signed.data.download_url} target="_blank" rel="noopener" variant="body2">
            פתיחה / הורדה
          </Link>
        ) : (
          <Typography variant="caption" color="text.secondary">
            טוען קישור...
          </Typography>
        )}
      </TableCell>
      <TableCell align="left">
        <IconButton size="small" onClick={() => onDelete(doc.document_id)} aria-label="מחק מסמך">
          <DeleteIcon fontSize="small" />
        </IconButton>
      </TableCell>
    </TableRow>
  );
}

export default function Documents() {
  const queryClient = useQueryClient();
  const [entityType, setEntityType] = useState<DocumentEntityType>("PROPERTY");
  const [entity, setEntity] = useState<EntityOption | null>(null);
  const [docType, setDocType] = useState<string>(DOC_TYPE_OPTIONS[0]);
  const [uploadedBy, setUploadedBy] = useState<number | "">("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const properties = useQuery({ queryKey: ["properties"], queryFn: fetchProperties });
  const incidents = useQuery({ queryKey: ["incidents", "all"], queryFn: () => fetchIncidents() });
  const claims = useQuery({ queryKey: ["claims", ""], queryFn: () => fetchClaims() });
  const policies = useQuery({ queryKey: ["policies", ""], queryFn: () => fetchPolicies() });
  const users = useQuery({ queryKey: ["users"], queryFn: fetchUsers });

  // Each entity type has its own natural human-readable label (property name,
  // incident code, claim number, policy number) — this maps the currently
  // selected entity type to the Autocomplete options it should offer.
  const entityOptions: EntityOption[] = useMemo(() => {
    switch (entityType) {
      case "PROPERTY":
        return (properties.data ?? []).map((p) => ({ id: p.property_id, label: `${p.name} (${p.property_code})` }));
      case "INCIDENT":
        return (incidents.data ?? []).map((i) => ({ id: i.incident_id, label: i.incident_code }));
      case "CLAIM":
        return (claims.data ?? []).map((c) => ({ id: c.claim_id, label: c.claim_number }));
      case "POLICY":
        return (policies.data ?? []).map((p) => ({ id: p.policy_id, label: `${p.policy_number} (${p.insurer_name})` }));
      default:
        return [];
    }
  }, [entityType, properties.data, incidents.data, claims.data, policies.data]);

  const documents = useQuery({
    queryKey: ["documents", "entity", entityType, entity?.id],
    queryFn: () => fetchDocumentsForEntity(entityType, entity!.id),
    enabled: !!entity,
  });

  const handleEntityTypeChange = (value: DocumentEntityType) => {
    setEntityType(value);
    setEntity(null);
    setUploadError(null);
  };

  const handleUpload = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0 || !entity) return;
    setUploading(true);
    setUploadError(null);
    try {
      for (const file of Array.from(fileList)) {
        await uploadDocument(entityType, entity.id, file, docType, uploadedBy === "" ? null : uploadedBy);
      }
      queryClient.invalidateQueries({ queryKey: ["documents", "entity", entityType, entity.id] });
    } catch {
      setUploadError("העלאת הקובץ נכשלה. נסו שוב.");
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (documentId: number) => {
    if (!entity) return;
    await deleteDocument(documentId);
    queryClient.invalidateQueries({ queryKey: ["documents", "entity", entityType, entity.id] });
  };

  return (
    <Stack spacing={3}>
      <Typography variant="h5" sx={{ fontWeight: 700 }}>
        ניהול מסמכים
      </Typography>
      <Typography variant="body2" color="text.secondary">
        העלאה וצפייה בפוליסות, דוחות שמאי, תכתובות ומסמכים נוספים המשויכים לנכס, אירוע, תביעה או פוליסה.
      </Typography>

      <Card variant="outlined">
        <CardContent>
          <Stack spacing={2}>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField
                select
                label="סוג ישות"
                value={entityType}
                onChange={(e) => handleEntityTypeChange(e.target.value as DocumentEntityType)}
                sx={{ minWidth: 180 }}
              >
                {(Object.keys(ENTITY_TYPE_LABELS) as DocumentEntityType[]).map((t) => (
                  <MenuItem key={t} value={t}>
                    {ENTITY_TYPE_LABELS[t]}
                  </MenuItem>
                ))}
              </TextField>

              <Autocomplete
                sx={{ minWidth: 280, flexGrow: 1 }}
                options={entityOptions}
                value={entity}
                onChange={(_, value) => setEntity(value)}
                isOptionEqualToValue={(a, b) => a.id === b.id}
                renderInput={(params) => <TextField {...params} label={`בחרו ${ENTITY_TYPE_LABELS[entityType]}`} />}
              />
            </Stack>

            {entity && (
              <Stack direction={{ xs: "column", sm: "row" }} spacing={2} alignItems={{ sm: "center" }}>
                <TextField
                  select
                  label="סוג מסמך"
                  value={docType}
                  onChange={(e) => setDocType(e.target.value)}
                  sx={{ minWidth: 200 }}
                >
                  {DOC_TYPE_OPTIONS.map((t) => (
                    <MenuItem key={t} value={t}>
                      {DOCUMENT_TYPE_LABELS[t]}
                    </MenuItem>
                  ))}
                </TextField>

                <TextField
                  select
                  label="הועלה על ידי (אופציונלי)"
                  value={uploadedBy}
                  onChange={(e) => setUploadedBy(e.target.value === "" ? "" : Number(e.target.value))}
                  sx={{ minWidth: 200 }}
                >
                  <MenuItem value="">לא צוין</MenuItem>
                  {(users.data ?? []).map((u) => (
                    <MenuItem key={u.user_id} value={u.user_id}>
                      {u.full_name}
                    </MenuItem>
                  ))}
                </TextField>

                <Button
                  variant="outlined"
                  component="label"
                  startIcon={<UploadFileIcon />}
                  disabled={uploading}
                >
                  {uploading ? "מעלה..." : "העלאת קובץ"}
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

            {uploadError && <Alert severity="error">{uploadError}</Alert>}
          </Stack>
        </CardContent>
      </Card>

      {entity ? (
        <Card variant="outlined">
          <CardContent>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 2 }}>
              מסמכים — {entity.label} ({documents.data?.length ?? 0})
            </Typography>
            {documents.isLoading ? (
              <Stack alignItems="center" sx={{ py: 3 }}>
                <CircularProgress size={24} />
              </Stack>
            ) : (documents.data ?? []).length > 0 ? (
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>סוג מסמך</TableCell>
                    <TableCell>תאריך העלאה</TableCell>
                    <TableCell>קישור</TableCell>
                    <TableCell align="left">פעולות</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(documents.data ?? []).map((d) => (
                    <DocumentRow key={d.document_id} doc={d} onDelete={handleDelete} />
                  ))}
                </TableBody>
              </Table>
            ) : (
              <Typography variant="body2" color="text.secondary">
                לא צורפו מסמכים לישות זו עדיין.
              </Typography>
            )}
          </CardContent>
        </Card>
      ) : (
        <Alert severity="info">בחרו סוג ישות וישות ספציפית כדי לצפות במסמכים המשויכים אליה או להעלות מסמך חדש.</Alert>
      )}
    </Stack>
  );
}
