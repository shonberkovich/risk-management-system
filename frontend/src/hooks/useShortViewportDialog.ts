import useMediaQuery from "@mui/material/useMediaQuery";

/** `fullScreen` for form dialogs on short viewports — a phone held landscape (~375px tall).
 * A floating dialog there keeps its rounded-glass margins and leaves only ~170px of
 * scrollable form between its title and actions; going full screen hands those margins
 * back to the form. Portrait phones keep the floating dialog (theme's 12px gutter). */
export function useShortViewportDialog(): boolean {
  return useMediaQuery("(max-height: 500px)");
}
