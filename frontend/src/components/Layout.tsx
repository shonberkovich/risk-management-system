import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Snackbar from "@mui/material/Snackbar";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import type { ReactNode } from "react";

import type { User } from "../api/client";
import { useSSE } from "../hooks/useSSE";
import type { NewEmailPayload } from "../hooks/useSSE";
import AIAssistant from "./AIAssistant/AIAssistant";
import { AIAssistantProvider } from "./AIAssistant/AIAssistantContext";
import Navbar from "./Navbar";

// AIAssistant (TODO_SPEC.md §6/§7, multi-agent orchestrator chat) supersedes the
// single-endpoint CopilotWidget as the system-wide assistant — CopilotWidget.tsx is
// left in place, just unmounted, rather than deleted. AIAssistantProvider wraps
// `children` (the routed pages) too, not just <AIAssistant/> itself, so e.g.
// PropertyDetail can call useAIAssistant().openWithProperty(...) to open the panel
// with its property's context pre-injected (TODO_SPEC.md §7).
//
// TODO_SPEC.md "משימה 9" — `useSSE()` is mounted exactly once here (App.tsx only ever
// renders <Layout> once it has an authenticated `user`, see App.tsx's `if (!user) return
// <Login/>` guard — so this component unmounting on logout is itself already the "close
// the EventSource on logout" cleanup path; useSSE also independently drops its connection
// the moment useAuth()'s `user` goes null, as defense in depth). It keeps running across
// route navigation since Layout wraps every routed page and isn't re-mounted per-route.
// The global toast (TODO_SPEC.md §9 step 3) reuses MUI's Snackbar/Alert — the same
// components AlertsBanner.tsx already renders inline alerts with — rather than adding a
// toast library (no `notistack` or similar already in package.json).
export default function Layout({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [toast, setToast] = useState<string | null>(null);

  const handleNewEmail = useCallback(
    (payload: NewEmailPayload) => {
      // Best-effort sender name from whatever GET /users response react-query already has
      // cached under ["emails"]'s neighboring ["users"] key (populated by e.g.
      // EmailComposeModal/Mitigation — both already fetch the same list). Falls back to a
      // generic label rather than issuing a fresh network call just to label a toast.
      const sender = queryClient.getQueryData<User[]>(["users"])?.find((u) => u.user_id === payload.sender_id);
      const senderLabel = sender?.full_name ?? `משתמש #${payload.sender_id}`;
      setToast(`מייל חדש מ-${senderLabel}: ${payload.subject}`);
    },
    [queryClient],
  );

  useSSE(handleNewEmail);

  return (
    <AIAssistantProvider>
      <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
        <Navbar />
        <Box component="main" sx={{ p: { xs: 2, md: 3 }, maxWidth: 1600, mx: "auto" }}>
          {children}
        </Box>
        <AIAssistant />
        <Snackbar
          open={toast !== null}
          autoHideDuration={6000}
          onClose={() => setToast(null)}
          anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
        >
          <Alert onClose={() => setToast(null)} severity="info" variant="filled" data-testid="new-email-toast">
            {toast}
          </Alert>
        </Snackbar>
      </Box>
    </AIAssistantProvider>
  );
}
