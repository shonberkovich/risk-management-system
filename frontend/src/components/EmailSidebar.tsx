import ArchiveIcon from "@mui/icons-material/Archive";
import DeleteIcon from "@mui/icons-material/Delete";
import InboxIcon from "@mui/icons-material/Inbox";
import SendIcon from "@mui/icons-material/Send";
import Badge from "@mui/material/Badge";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { fetchEmails, type EmailFolder } from "../api/client";

/** TODO_SPEC.md "משימה 7" step 2 — folder nav with an unread-count badge per
 * folder (Inbox especially). Matches EmailFolder's actual backend values,
 * minus SPAM (not asked for by this task's folder list: דואר נכנס/נשלח/ארכיון/אשפה). */
const FOLDERS: { value: EmailFolder; label: string; icon: ReactNode }[] = [
  { value: "INBOX", label: "דואר נכנס", icon: <InboxIcon fontSize="small" /> },
  { value: "SENT", label: "נשלח", icon: <SendIcon fontSize="small" /> },
  { value: "ARCHIVE", label: "ארכיון", icon: <ArchiveIcon fontSize="small" /> },
  { value: "TRASH", label: "אשפה", icon: <DeleteIcon fontSize="small" /> },
];

/** One lightweight unread-count query per folder. `limit: 200` is enough to cover this
 * demo's seeded mailboxes; polling cadence matches Navbar's notification-bell badge.
 * Task 9 replaces this polling with SSE-driven invalidation of the same ["emails", ...]
 * query keys, so no changes will be needed here beyond removing the interval. */
function useUnreadCount(folder: EmailFolder): number {
  const { data } = useQuery({
    queryKey: ["emails", folder, "unread-count"],
    queryFn: () => fetchEmails(folder, 0, 200),
    select: (items) => items.filter((item) => !item.is_read).length,
    staleTime: 15_000,
    refetchInterval: 30_000,
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

export default function EmailSidebar({
  selected,
  onSelect,
}: {
  selected: EmailFolder;
  onSelect: (folder: EmailFolder) => void;
}) {
  return (
    <List dense sx={{ minWidth: 190 }} data-testid="email-sidebar">
      {FOLDERS.map((folder) => (
        <FolderItem key={folder.value} folder={folder} selected={selected === folder.value} onSelect={onSelect} />
      ))}
    </List>
  );
}
