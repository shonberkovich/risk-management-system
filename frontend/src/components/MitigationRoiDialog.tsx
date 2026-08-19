import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useQuery } from "@tanstack/react-query";

import { fetchMitigationTaskRoi } from "../api/client";
import { formatIls } from "../format";

export default function MitigationRoiDialog({
  open,
  taskId,
  onClose,
}: {
  open: boolean;
  taskId: number | null;
  onClose: () => void;
}) {
  const roi = useQuery({
    queryKey: ["mitigation-task-roi", taskId],
    queryFn: () => fetchMitigationTaskRoi(taskId!),
    enabled: open && taskId !== null,
  });

  const data = roi.data;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>פירוט ROI{data ? ` — ${data.title}` : ""}</DialogTitle>
      <DialogContent>
        {roi.isLoading && (
          <Stack alignItems="center" sx={{ py: 3 }}>
            <CircularProgress size={28} />
          </Stack>
        )}
        {roi.isError && <Alert severity="error">שגיאה בטעינת פירוט ה-ROI.</Alert>}
        {data && (
          <Stack spacing={1} sx={{ mt: 1 }}>
            <Row label="עלות המשימה" value={formatIls(data.cost_estimate)} />
            <Divider />
            <Row label="חיסכון פרמיה צפוי" value={formatIls(data.expected_premium_savings)} />
            <Row label="חיסכון אובדנים צפוי" value={formatIls(data.expected_loss_savings)} />
            <Row label="סה״כ חיסכון שנתי צפוי" value={formatIls(data.expected_annual_savings_total)} strong />
            <Divider />
            <Row label="ROI" value={data.roi_percent !== null ? `${data.roi_percent.toFixed(1)}%` : "-"} strong />
            <Row
              label="תקופת החזר השקעה"
              value={data.payback_years !== null ? `${data.payback_years.toFixed(1)} שנים` : "-"}
            />
            {!data.has_active_policy && (
              <Alert severity="info" sx={{ mt: 1 }}>
                לנכס זה אין פוליסה פעילה כרגע — חיסכון הפרמיה בפירוק לעיל הוא צפי בלבד ואינו מבוסס על פוליסה קיימת.
              </Alert>
            )}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>סגירה</Button>
      </DialogActions>
    </Dialog>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <Stack direction="row" justifyContent="space-between">
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2" sx={{ fontWeight: strong ? 700 : 400 }}>
        {value}
      </Typography>
    </Stack>
  );
}
