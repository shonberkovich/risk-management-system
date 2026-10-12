import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { Link as RouterLink } from "react-router-dom";

/** Any address App.tsx has no route for (a mistyped or outdated link) — before this,
 * such a URL rendered an empty page inside the layout with no hint of what happened. */
export default function NotFound() {
  return (
    <Stack spacing={3} alignItems="flex-start">
      <Typography variant="h5" sx={{ fontWeight: 700 }}>
        הדף לא נמצא
      </Typography>
      <Alert severity="warning">הכתובת שהוזנה אינה קיימת במערכת. ייתכן שהקישור שגוי או ישן.</Alert>
      <Button component={RouterLink} to="/" variant="contained">
        חזרה לדשבורד
      </Button>
    </Stack>
  );
}
