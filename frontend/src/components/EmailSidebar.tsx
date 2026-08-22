import AddIcon from "@mui/icons-material/Add";
import ArchiveIcon from "@mui/icons-material/Archive";
import DeleteIcon from "@mui/icons-material/Delete";
import InboxIcon from "@mui/icons-material/Inbox";
import LabelIcon from "@mui/icons-material/Label";
import SendIcon from "@mui/icons-material/Send";
import Badge from "@mui/material/Badge";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { ReactNode } from "react";

import { createLabel, deleteLabel, fetchEmails, fetchLabels, type EmailFolder, type Label } from "../api/client";

/** TODO_SPEC.md "משימה 7" step 2 — folder nav with an unread-count badge per
 * folder (Inbox especially). Matches EmailFolder's actual backend values,
 * minus SPAM (not asked for by this task's folder list: דואר נכנס/נשלח/ארכיון/אשפה). */
const FOLDERS: { value: EmailFolder; label: string; icon: ReactNode }[] = [
  { value: "INBOX", label: "דואר נכנס", icon: <InboxIcon fontSize="small" /> },
  { value: "SENT", label: "נשלח", icon: <SendIcon fontSize="small" /> },
  { value: "ARCHIVE", label: "ארכיון", icon: <ArchiveIcon fontSize="small" /> },
  { value: "TRASH", label: "אשפה", icon: <DeleteIcon fontSize="small" /> },
];

/** TODO_SPEC.md "משימה 16" step 3 — a small fixed swatch row rather than a full
 * color-wheel picker: MUI has no built-in color-wheel component, and a row of
 * preset chips is simpler and more consistent with this app's existing
 * (Material, non-fancy) form style than pulling in a new picker dependency
 * just for this one field. */
const LABEL_COLORS = ["#e53935", "#fb8c00", "#fdd835", "#43a047", "#1e88e5", "#5e35b1", "#8e24aa", "#6d4c41"];

/** One lightweight unread-count query per folder. `limit: 200` is enough to cover this
 * demo's seeded mailboxes. TODO_SPEC.md "משימה 9" made `useSSE` (mounted once in
 * Layout.tsx) the primary refresh path — it invalidates every `["emails", ...]` query,
 * this one included, the moment a `new_email` SSE event arrives — so the badge updates
 * without waiting on a poll. `refetchInterval` stays, just slowed way down, purely as a
 * fallback for the (rare) case the SSE connection itself is down. */
function useUnreadCount(folder: EmailFolder): number {
  const { data } = useQuery({
    queryKey: ["emails", folder, "unread-count"],
    queryFn: () => fetchEmails(folder, 0, 200),
    select: (items) => items.filter((item) => !item.is_read).length,
    staleTime: 15_000,
    refetchInterval: 120_000,
  });
  return data ?? 0;
}

function FolderItem({
  folder,
  selected,
  onSelect,
}: {
  folder: (typeof FOLDERS)[number];
  selected: boolean;
  onSelect: (folder: EmailFolder) => void;
}) {
  const unread = useUnreadCount(folder.value);
  return (
    <ListItemButton
      selected={selected}
      onClick={() => onSelect(folder.value)}
      data-testid={`email-folder-${folder.value}`}
    >
      <ListItemIcon>{folder.icon}</ListItemIcon>
      <ListItemText primary={folder.label} />
      {unread > 0 && <Badge badgeContent={unread} color="error" max={99} />}
    </ListItemButton>
  );
}

/** TODO_SPEC.md "משימה 16" step 3 — "צור תיקייה/תגית חדשה": a name field plus
 * the preset color-swatch row above, submitting POST /api/folders. Collapsed
 * behind a button by default so the fixed-folders nav stays uncluttered. */
function CreateLabelForm() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState(LABEL_COLORS[0]);

  const createMutation = useMutation({
    mutationFn: () => createLabel({ name: name.trim(), color }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["labels"] });
      setName("");
      setColor(LABEL_COLORS[0]);
      setOpen(false);
    },
  });

  if (!open) {
    return (
      <Button
        size="small"
        startIcon={<AddIcon fontSize="small" />}
        onClick={() => setOpen(true)}
        sx={{ mx: 1, my: 0.5, justifyContent: "flex-start" }}
        data-testid="open-create-label-form"
      >
        צור תיקייה/תגית חדשה
      </Button>
    );
  }

  return (
    <Box
      component="form"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) createMutation.mutate();
      }}
      sx={{ mx: 1, my: 1 }}
    >
      <Stack spacing={1}>
        <TextField
          size="small"
          label="שם התגית"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          data-testid="create-label-name-input"
        />
        <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
          {LABEL_COLORS.map((c) => (
            <Box
              key={c}
              component="button"
              type="button"
              onClick={() => setColor(c)}
              data-testid={`label-color-swatch-${c}`}
              aria-label={`בחר צבע ${c}`}
              aria-pressed={color === c}
              sx={{
                width: 22,
                height: 22,
                borderRadius: "50%",
                bgcolor: c,
                border: color === c ? "2px solid" : "1px solid rgba(0,0,0,0.2)",
                borderColor: color === c ? "text.primary" : undefined,
                cursor: "pointer",
                p: 0,
              }}
            />
          ))}
        </Stack>
        <Stack direction="row" spacing={1}>
          <Button
            size="small"
            variant="contained"
            type="submit"
            disabled={!name.trim() || createMutation.isPending}
            data-testid="create-label-submit"
          >
            צור
          </Button>
          <Button size="small" onClick={() => setOpen(false)}>
            ביטול
          </Button>
        </Stack>
      </Stack>
    </Box>
  );
}

/** TODO_SPEC.md "משימה 16" step 3 — one label row: clicking toggles it as the
 * active filter (Emails.tsx composes `activeLabelId` with the selected
 * folder/search, see that file's docstring), and a delete icon removes the
 * label outright via DELETE /api/folders/{id}. */
function LabelItem({ label, selected, onSelect }: { label: Label; selected: boolean; onSelect: (label: Label) => void }) {
  const queryClient = useQueryClient();
  const deleteMutation = useMutation({
    mutationFn: () => deleteLabel(label.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["labels"] }),
  });

  return (
    <ListItemButton selected={selected} onClick={() => onSelect(label)} data-testid={`email-label-${label.id}`}>
      <ListItemIcon>
        <LabelIcon fontSize="small" sx={{ color: label.color }} />
      </ListItemIcon>
      <ListItemText primary={label.name} />
      <IconButton
        size="small"
        aria-label={`מחק תגית ${label.name}`}
        onClick={(e) => {
          e.stopPropagation();
          deleteMutation.mutate();
        }}
      >
        <DeleteIcon fontSize="inherit" />
      </IconButton>
    </ListItemButton>
  );
}

export default function EmailSidebar({
  selected,
  onSelect,
  activeLabelId = null,
  onSelectLabel = () => {},
}: {
  selected: EmailFolder;
  onSelect: (folder: EmailFolder) => void;
  /** TODO_SPEC.md "משימה 16" step 5 — the currently active label filter (or
   * null for "no label filter"), and the callback to change it. Optional
   * (default no-op) so existing callers/tests that don't care about labels
   * keep working unchanged. */
  activeLabelId?: number | null;
  onSelectLabel?: (labelId: number | null) => void;
}) {
  const labelsQuery = useQuery({ queryKey: ["labels"], queryFn: fetchLabels });
  const labels = labelsQuery.data ?? [];

  const handleSelectLabel = (label: Label) => {
    onSelectLabel(activeLabelId === label.id ? null : label.id);
  };

  return (
    <List dense sx={{ minWidth: 190 }} data-testid="email-sidebar">
      {FOLDERS.map((folder) => (
        <FolderItem key={folder.value} folder={folder} selected={selected === folder.value} onSelect={onSelect} />
      ))}

      <Divider sx={{ my: 1 }} />
      <Typography variant="overline" color="text.secondary" sx={{ px: 2 }}>
        תגיות
      </Typography>
      {labels.map((label) => (
        <LabelItem key={label.id} label={label} selected={activeLabelId === label.id} onSelect={handleSelectLabel} />
      ))}
      <CreateLabelForm />
    </List>
  );
}
