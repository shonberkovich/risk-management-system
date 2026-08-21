import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import HighlightOffIcon from "@mui/icons-material/HighlightOff";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
  confirmAgentAction,
  createMitigationTask,
  rejectAgentAction,
  type ActionProposal,
} from "../../api/client";

/** Human-in-the-loop "Action Card" (TODO_SPEC.md §7) — rendered inline in the AI
 * Assistant's chat log whenever the Compliance Agent proposes an action
 * (currently: a Mitigation_Task for a non-compliant property). Confirming creates
 * the task for real via the existing mitigation-tasks endpoint and refreshes the
 * Mitigation screen's query cache; rejecting just records the decision. Either way
 * the underlying Agent_Actions_Log row (action_id) is updated so the
 * proposed -> confirmed/rejected lifecycle (models.AgentActionLog) is auditable. */
export default function ActionCard({
  actionId,
  proposal,
}: {
  actionId: number;
  proposal: ActionProposal;
}) {
  const [resolution, setResolution] = useState<"confirmed" | "rejected" | null>(null);
  const queryClient = useQueryClient();

  const confirmMutation = useMutation({
    mutationFn: async () => {
      await createMitigationTask(proposal.proposed_task);
      await confirmAgentAction(actionId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mitigation-tasks"] });
      setResolution("confirmed");
    },
  });

  const rejectMutation = useMutation({
    mutationFn: () => rejectAgentAction(actionId),
    onSuccess: () => setResolution("rejected"),
  });

  const busy = confirmMutation.isPending || rejectMutation.isPending;

  return (
    <Paper
      variant="outlined"
      sx={{ p: 1.5, maxWidth: "90%", borderColor: "warning.main", bgcolor: "#fff8e1" }}
    >
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
        <WarningAmberIcon fontSize="small" color="warning" />
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
          הצעת פעולה: משימת הפחתת סיכון
        </Typography>
        <Chip size="small" label={proposal.risk_level} color="warning" variant="outlined" />
      </Stack>
      <Typography variant="body2" sx={{ mb: 0.5 }}>
        {proposal.property_name}: {proposal.reasoning}
      </Typography>
      <Typography variant="body2" sx={{ mb: 1, fontWeight: 600 }}>
        {proposal.proposed_task.title} — יעד: {proposal.proposed_task.due_date}
      </Typography>

      {resolution === "confirmed" ? (
        <Chip size="small" color="success" icon={<CheckCircleOutlineIcon />} label="המשימה נוצרה" />
      ) : resolution === "rejected" ? (
        <Chip size="small" icon={<HighlightOffIcon />} label="ההצעה נדחתה" />
      ) : (
        <Stack direction="row" spacing={1}>
          <Button
            size="small"
            variant="contained"
            color="warning"
            disabled={busy}
            onClick={() => confirmMutation.mutate()}
          >
            אשר וצור משימה
          </Button>
          <Button size="small" disabled={busy} onClick={() => rejectMutation.mutate()}>
            בטל
          </Button>
        </Stack>
      )}
    </Paper>
  );
}
