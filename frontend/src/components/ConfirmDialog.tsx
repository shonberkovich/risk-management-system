import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle } from "@mui/material";
import { useCallback, useId, useRef, useState, type ReactNode } from "react";

export interface ConfirmOptions {
  title: string;
  message: string;
  /** Label of the confirming button (default "אישור"). */
  confirmLabel?: string;
  /** Styles the confirming button as destructive (delete/deactivate). */
  destructive?: boolean;
}

/** In-app replacement for `window.confirm()`.
 *
 * Native dialogs are unreliable: embedded browsers and sandboxed frames suppress them,
 * and then `window.confirm()` returns false without showing anything — so the action
 * behind it (e.g. Notifications' simulated dispatch) silently did nothing. Chrome also
 * lets a user turn a page's dialogs off for good. This renders a regular MUI dialog
 * instead, styled like the rest of the app.
 *
 * Usage: `const [confirmDialog, confirm] = useConfirmDialog();` — render `{confirmDialog}`
 * somewhere in the component, then `if (await confirm({ title, message })) { ... }`.
 * Resolves true only on the confirming button; cancel, Escape and a backdrop click all
 * resolve false. */
export function useConfirmDialog(): [ReactNode, (options: ConfirmOptions) => Promise<boolean>] {
  const [open, setOpen] = useState(false);
  // Kept after closing so the text doesn't blank out during the exit transition.
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolveRef = useRef<((confirmed: boolean) => void) | null>(null);
  const titleId = useId();

  const settle = useCallback((confirmed: boolean) => {
    resolveRef.current?.(confirmed);
    resolveRef.current = null;
    setOpen(false);
  }, []);

  const confirm = useCallback((next: ConfirmOptions) => {
    resolveRef.current?.(false); // a newer prompt supersedes one still open
    setOptions(next);
    setOpen(true);
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
    });
  }, []);

  const dialog = (
    <Dialog open={open} onClose={() => settle(false)} maxWidth="xs" fullWidth aria-labelledby={titleId}>
      <DialogTitle id={titleId}>{options?.title}</DialogTitle>
      <DialogContent>
        <DialogContentText>{options?.message}</DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => settle(false)}>ביטול</Button>
        <Button
          variant="contained"
          color={options?.destructive ? "error" : "primary"}
          onClick={() => settle(true)}
          autoFocus
        >
          {options?.confirmLabel ?? "אישור"}
        </Button>
      </DialogActions>
    </Dialog>
  );

  return [dialog, confirm];
}
