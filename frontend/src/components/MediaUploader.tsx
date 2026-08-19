import CameraAltIcon from "@mui/icons-material/CameraAlt";
import DeleteIcon from "@mui/icons-material/Delete";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Grid from "@mui/material/Grid";
import IconButton from "@mui/material/IconButton";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useEffect, useMemo } from "react";

const ACCEPTED_TYPES = "image/*,video/*,application/pdf";
const MAX_FILE_BYTES = 25 * 1024 * 1024; // mirrors backend/app/routers/media.py's _MAX_UPLOAD_BYTES

interface MediaUploaderProps {
  files: File[];
  onFilesChange: (files: File[]) => void;
  disabled?: boolean;
}

/** Staging area for incident media: direct camera capture, regular file upload,
 * thumbnail preview, and per-file delete. Purely client-side — it does not talk
 * to the server itself, since incident media requires an incident_id that
 * doesn't exist yet while the report wizard is still in progress. The caller
 * (IncidentReport.tsx) uploads the staged files via POST /api/incidents/{id}/media
 * once the incident has actually been created. */
export default function MediaUploader({ files, onFilesChange, disabled }: MediaUploaderProps) {
  const previews = useMemo(() => files.map((f) => (f.type.startsWith("image/") ? URL.createObjectURL(f) : null)), [files]);

  useEffect(() => {
    return () => previews.forEach((url) => url && URL.revokeObjectURL(url));
  }, [previews]);

  const addFiles = (fileList: FileList | null) => {
    if (!fileList) return;
    const incoming = Array.from(fileList);
    const tooLarge = incoming.filter((f) => f.size > MAX_FILE_BYTES);
    const accepted = incoming.filter((f) => f.size <= MAX_FILE_BYTES);
    if (tooLarge.length > 0) {
      window.alert(
        `הקבצים הבאים חורגים מהגודל המרבי המותר (25MB) ולא נוספו: ${tooLarge.map((f) => f.name).join(", ")}`,
      );
    }
    if (accepted.length > 0) onFilesChange([...files, ...accepted]);
  };

  const removeAt = (idx: number) => onFilesChange(files.filter((_, i) => i !== idx));

  return (
    <Stack spacing={2}>
      <Grid container spacing={2}>
        <Grid item xs={6}>
          <Button
            fullWidth
            variant="outlined"
            component="label"
            startIcon={<CameraAltIcon />}
            disabled={disabled}
            sx={{ py: 3 }}
          >
            צלם תמונה
            <input
              type="file"
              accept="image/*"
              capture="environment"
              hidden
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </Button>
        </Grid>
        <Grid item xs={6}>
          <Button
            fullWidth
            variant="outlined"
            component="label"
            startIcon={<UploadFileIcon />}
            disabled={disabled}
            sx={{ py: 3 }}
          >
            העלה קובץ
            <input
              type="file"
              accept={ACCEPTED_TYPES}
              multiple
              hidden
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </Button>
        </Grid>
      </Grid>

      {files.length > 0 && (
        <Stack spacing={1}>
          <Typography variant="caption" color="text.secondary">
            קבצים מצורפים ({files.length})
          </Typography>
          <Grid container spacing={1}>
            {files.map((file, idx) => (
              <Grid item xs={6} sm={4} key={`${file.name}-${idx}`}>
                <Paper
                  variant="outlined"
                  sx={{ p: 1, display: "flex", alignItems: "center", gap: 1, position: "relative" }}
                >
                  {previews[idx] ? (
                    <Box
                      component="img"
                      src={previews[idx]!}
                      alt={file.name}
                      sx={{ width: 40, height: 40, objectFit: "cover", borderRadius: 1, flexShrink: 0 }}
                    />
                  ) : (
                    <InsertDriveFileIcon color="action" sx={{ flexShrink: 0 }} />
                  )}
                  <Typography variant="caption" noWrap sx={{ flex: 1, minWidth: 0 }}>
                    {file.name}
                  </Typography>
                  <IconButton size="small" onClick={() => removeAt(idx)} disabled={disabled} aria-label="מחק">
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Paper>
              </Grid>
            ))}
          </Grid>
        </Stack>
      )}
    </Stack>
  );
}
