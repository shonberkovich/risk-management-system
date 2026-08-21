import Box from "@mui/material/Box";
import type { ReactNode } from "react";

import CopilotWidget from "./CopilotWidget";
import Navbar from "./Navbar";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
      <Navbar />
      <Box component="main" sx={{ p: { xs: 2, md: 3 }, maxWidth: 1600, mx: "auto" }}>
        {children}
      </Box>
      <CopilotWidget />
    </Box>
  );
}
