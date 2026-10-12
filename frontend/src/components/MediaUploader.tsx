import CameraAltIcon from "@mui/icons-material/CameraAlt";
import DeleteIcon from "@mui/icons-material/Delete";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Grid from "@mui/material/Grid";
import IconButton from "@mui/material/IconButton";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import PlaceIcon from "@mui/icons-material/Place";
import ScheduleIcon from "@mui/icons-material/Schedule";
import { useEffect, useMemo, useState } from "react";

import { extractExifSummary, type ExifSummary } from "../utils/exif";

// Same list as backend services/storage.py ALLOWED_CONTENT_TYPES (routers/media.py
// rejects anything else).
const ACCEPTED_TYPES = ".jpg,.jpeg,.png,.mp4,.mov,.pdf";
const ACCEPTED_EXTENSIONS = ["jpg", "jpeg", "png", "mp4", "mov", "pdf"];
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

  // EXIF (GPS + capture time) read per photo, keyed by File reference — File objects are
  // stable across re-renders as long as the caller doesn't rebuild the array unnecessarily
  // (IncidentReport.tsx only ever appends/removes, never re-wraps existing entries). `null`
  // means "checked, nothing usable"; a missing key means "not checked yet" (still loading or
  // not an image at all).
  const [exifByFile, setExifByFile] = useState<Map<File, ExifSummary | null>>(new Map());
  // Names of the files the last pick rejected as too large — shown inline rather than via
  // window.alert(), which embedded browsers suppress (the user then never learns why the
  // file didn't appear).
  const [tooLargeNames, setTooLargeNames] = useState<string[]>([]);
  // Same for files of a type the backend refuses (the camera input's image/* lets e.g.
  // HEIC/WebP through, and a file dialog's "all files" option anything).
  const [unsupportedNames, setUnsupportedNames] = useState<string[]>([]);

  useEffect(() => {
    const pending = files.filter((f) => f.type.startsWith("image/") && !exifByFile.has(f));
    if (pending.length === 0) return;
    let cancelled = false;
    (async () => {
      const results = await Promise.all(pending.map(async (f) => [f, await extractExifSummary(f)] as const));
      if (cancelled) return;
      setExifByFile((prev) => {
        const next = new Map(prev);
        results.forEach(([f, summary]) => next.set(f, summary));
        return next;
      });
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files]);

  const addFiles = (fileList: FileList | null) => {
    if (!fileList) return;
    const isSupported = (f: File) => ACCEPTED_EXTENSIONS.includes(f.name.split(".").pop()?.toLowerCase() ?? "");
    const incoming = Array.from(fileList);
    const unsupported = incoming.filter((f) => !isSupported(f));
    const tooLarge = incoming.filter((f) => isSupported(f) && f.size > MAX_FILE_BYTES);
    const accepted = incoming.filter((f) => isSupported(f) && f.size <= MAX_FILE_BYTES);
    setUnsupportedNames(unsupported.map((f) => f.name));
    setTooLargeNames(tooLarge.map((f) => f.name));
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

      {unsupportedNames.length > 0 && (
        <Alert severity="warning" onClose={() => setUnsupportedNames([])}>
          סוג הקובץ לא נתמך (ניתן לצרף JPG/PNG, MP4/MOV או PDF) — לא נוספו: {unsupportedNames.join(", ")}
        </Alert>
      )}

      {tooLargeNames.length > 0 && (
        <Alert severity="warning" onClose={() => setTooLargeNames([])}>
          הקבצים הבאים חורגים מהגודל המרבי המותר (25MB) ולא נוספו: {tooLargeNames.join(", ")}
        </Alert>
      )}

      {files.length > 0 && (
        <Stack spacing={1}>
          <Typography variant="caption" color="text.secondary">
            קבצים מצורפים ({files.length})
          </Typography>
          <Grid container spacing={1}>
            {files.map((file, idx) => {
              const exif = exifByFile.get(file);
              const hasLocation = exif?.latitude != null && exif?.longitude != null;
              return (
                <Grid item xs={6} sm={4} key={`${file.name}-${idx}`}>
                  <Paper
                    variant="outlined"
                    sx={{ p: 1, display: "flex", alignItems: "flex-start", gap: 1, position: "relative" }}
                  >
                    {previews[idx] ? (
                      <Box
                        component="img"
                        src={previews[idx]!}
                        alt={file.name}
                        sx={{ width: 40, height: 40, objectFit: "cover", borderRadius: 1, flexShrink: 0 }}
                      />
                    ) : (
                      <InsertDriveFileIcon color="action" sx={{ flexShrink: 0, mt: 0.5 }} />
                    )}
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="caption" noWrap sx={{ display: "block" }}>
                        {file.name}
                      </Typography>
                      {exif?.capturedAt && (
                        <Stack direction="row" spacing={0.5} alignItems="center">
                          <ScheduleIcon sx={{ fontSize: 12 }} color="action" />
                          <Typography variant="caption" color="text.secondary" noWrap>
                            {exif.capturedAt.toLocaleString("he-IL")}
                          </Typography>
                        </Stack>
                      )}
                      {hasLocation && (
                        <Stack direction="row" spacing={0.5} alignItems="center">
                          <PlaceIcon sx={{ fontSize: 12 }} color="action" />
                          <Typography variant="caption" color="text.secondary" noWrap>
                            {exif!.latitude!.toFixed(5)}, {exif!.longitude!.toFixed(5)}
                          </Typography>
                        </Stack>
                      )}
                    </Box>
                    <IconButton size="small" onClick={() => removeAt(idx)} disabled={disabled} aria-label="מחק">
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Paper>
                </Grid>
              );
            })}
          </Grid>
        </Stack>
      )}
    </Stack>
  );
}
