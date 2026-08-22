import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import SaveIcon from "@mui/icons-material/Save";
import SettingsIcon from "@mui/icons-material/Settings";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CircularProgress from "@mui/material/CircularProgress";
import Snackbar from "@mui/material/Snackbar";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useEffect, useState } from "react";

import { useAuth } from "../auth/AuthContext";
import { ROLE_LABELS } from "../format";

/** TODO_SPEC.md "משימה 14" step 2 — minimal self-service "Profile Settings" screen.
 * No such page existed before this task (checked frontend/src/pages/ for anything
 * self-service like "MyProfile"/"Settings"/"Account" — none found), so this is the
 * first one; kept intentionally small (just the signature editor this task needs)
 * rather than growing into a general account-settings page nothing else asks for yet.
 *
 * Signature editor: same plain multiline TextField approach EmailComposeModal.tsx
 * settled on for its own body field (Task 8) — no rich-text editor dependency in
 * this project, so free-form HTML authoring isn't offered here either. The value
 * typed here is sent as-is to `PATCH /api/users/{id}/signature`, which sanitizes it
 * server-side (services/email.sanitize_body_html, same allow-list as email bodies)
 * before storing it — this screen doesn't need to (and doesn't try to) sanitize
 * client-side. */
export default function ProfileSettings() {
  const { user, updateSignature } = useAuth();
  const [signature, setSignature] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedOpen, setSavedOpen] = useState(false);

  // Load the current signature into the editor once the user is known. Does not
  // re-run on every render — only when the underlying value actually changes (e.g.
  // after a save) — so it doesn't clobber text the user is mid-typing.
  useEffect(() => {
    setSignature(user?.signature ?? "");
  }, [user?.signature]);

  const dirty = signature !== (user?.signature ?? "");

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await updateSignature(signature.trim() === "" ? null : signature);
      setSavedOpen(true);
    } catch {
      setError("שמירת החתימה נכשלה. נסו שוב.");
    } finally {
      setSaving(false);
    }
  };

  if (!user) {
    return <Alert severity="error">יש להתחבר כדי לצפות בהגדרות הפרופיל.</Alert>;
  }

  return (
    <Stack spacing={3} sx={{ maxWidth: 640 }}>
      <Stack direction="row" spacing={1} alignItems="center">
        <SettingsIcon color="primary" fontSize="large" />
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>
            הגדרות פרופיל
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {user.full_name} · {ROLE_LABELS[user.role] ?? user.role}
          </Typography>
        </Box>
      </Stack>

      <Card variant="outlined">
        <CardContent>
          <Stack spacing={2}>
            <Box>
              <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                חתימת מייל אישית
              </Typography>
              <Typography variant="caption" color="text.secondary">
                תצורף אוטומטית לתחתית כל מייל חדש שתכתבו. בתגובות, החתימה תופיע מעל ההודעה
                המצוטטת ולא תוכפל בפתיחה חוזרת של החלון.
              </Typography>
            </Box>

            <TextField
              label="חתימה"
              fullWidth
              multiline
              minRows={4}
              disabled={saving}
              value={signature}
              onChange={(e) => setSignature(e.target.value)}
              placeholder={"לדוגמה:\nישראל ישראלי\nמנהל סיכונים, RMIS"}
              slotProps={{ htmlInput: { "data-testid": "signature-textfield" } }}
            />

            {error && <Alert severity="error">{error}</Alert>}

            <Stack direction="row" justifyContent="flex-end">
              <Button
                variant="contained"
                startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <SaveIcon fontSize="small" />}
                disabled={!dirty || saving}
                onClick={handleSave}
                data-testid="save-signature-button"
              >
                שמירה
              </Button>
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      <Snackbar
        open={savedOpen}
        autoHideDuration={3000}
        onClose={() => setSavedOpen(false)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert severity="success" variant="filled" icon={<CheckCircleIcon fontSize="small" />}>
          החתימה נשמרה בהצלחה.
        </Alert>
      </Snackbar>
    </Stack>
  );
}
