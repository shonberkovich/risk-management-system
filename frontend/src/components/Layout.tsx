import Box from "@mui/material/Box";
import type { ReactNode } from "react";

import AIAssistant from "./AIAssistant/AIAssistant";
import { AIAssistantProvider } from "./AIAssistant/AIAssistantContext";
import Navbar from "./Navbar";

// AIAssistant (TODO_SPEC.md §6/§7, multi-agent orchestrator chat) supersedes the
// single-endpoint CopilotWidget as the system-wide assistant — CopilotWidget.tsx is
// left in place, just unmounted, rather than deleted. AIAssistantProvider wraps
// `children` (the routed pages) too, not just <AIAssistant/> itself, so e.g.
// PropertyDetail can call useAIAssistant().openWithProperty(...) to open the panel
// with its property's context pre-injected (TODO_SPEC.md §7).
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <AIAssistantProvider>
      <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
        <Navbar />
        <Box component="main" sx={{ p: { xs: 2, md: 3 }, maxWidth: 1600, mx: "auto" }}>
          {children}
        </Box>
        <AIAssistant />
      </Box>
    </AIAssistantProvider>
  );
}
