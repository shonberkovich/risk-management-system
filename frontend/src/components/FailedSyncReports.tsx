import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useEffect, useState } from "react";

import {
  discardQueuedReport,
  getFailedReports,
  retryQueuedReport,
  subscribeToSyncQueue,
  type QueuedIncidentReport,
} from "../offline/syncQueue";
import { formatDateTime } from "../format";
import { useConfirmDialog } from "./ConfirmDialog";

const KIND_LABELS: Record<QueuedIncidentReport["operation"]["kind"], string> = {
  create: "דיווח אירוע חדש",
  "draft-update": "עדכון טיוטה",
  "draft-submit": "הגשת טיוטה",
  media: "צירוף תמונות",
};

function describe(item: QueuedIncidentReport): string {
  const op = item.operation;
  const description = "payload" in op ? op.payload.description?.trim() : "";
  const snippet = description ? ` — "${description.length > 60 ? `${description.slice(0, 60)}…` : description}"` : "";
  return `${KIND_LABELS[op.kind]}${snippet}`;
}

/** Offline-queued reports the server rejected (src/offline/syncQueue.ts), each with the
 * server's reason and what the user can do about it: retry (e.g. after fixing the cause
 * elsewhere) or discard. Renders nothing while there are none. */
export default function FailedSyncReports() {
  const [items, setItems] = useState<QueuedIncidentReport[]>([]);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [confirmDialog, confirm] = useConfirmDialog();

  useEffect(
    () =>
      subscribeToSyncQueue(() => {
        getFailedReports()
          .then(setItems)
          .catch(() => setItems([]));
      }),
    [],
  );

  if (items.length === 0) return confirmDialog;

  const retry = async (id: number) => {
    setBusyId(id);
    try {
      await retryQueuedReport(id);
    } finally {
      setBusyId(null);
    }
  };

  const discard = async (item: QueuedIncidentReport) => {
    const confirmed = await confirm({
      title: "מחיקת דיווח מהתור",
      message: `למחוק את "${describe(item)}" מהמכשיר? הוא לא יישלח לשרת.`,
      confirmLabel: "מחיקה",
      destructive: true,
    });
    if (!confirmed) return;
    setBusyId(item.id);
    try {
      await discardQueuedReport(item.id);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Alert severity="error" sx={{ mb: 2 }}>
      <AlertTitle>{items.length === 1 ? "דיווח אחד לא סונכרן" : `${items.length} דיווחים לא סונכרנו`}</AlertTitle>
      <Typography variant="body2" sx={{ mb: 1 }}>
        השרת דחה את הדיווחים הבאים, ולכן הם לא יישלחו אוטומטית. שאר הדיווחים ממשיכים להסתנכרן כרגיל.
      </Typography>
      <Stack spacing={1}>
        {items.map((item) => (
          <Stack
            key={item.id}
            direction={{ xs: "column", sm: "row" }}
            spacing={1}
            alignItems={{ sm: "center" }}
            justifyContent="space-between"
            data-testid="failed-sync-item"
          >
            <Stack spacing={0.25} sx={{ minWidth: 0 }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {describe(item)}
              </Typography>
              <Typography variant="caption">
                נשמר במכשיר: {formatDateTime(item.queuedAt)} · סיבה: {item.lastError ?? "לא ידועה"}
              </Typography>
            </Stack>
            <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
              <Button size="small" color="inherit" disabled={busyId !== null} onClick={() => retry(item.id)}>
                נסה שוב
              </Button>
              <Button size="small" color="inherit" disabled={busyId !== null} onClick={() => discard(item)}>
                מחק מהתור
              </Button>
            </Stack>
          </Stack>
        ))}
      </Stack>
      {confirmDialog}
    </Alert>
  );
}
