import { CacheProvider } from "@emotion/react";
import CssBaseline from "@mui/material/CssBaseline";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import App from "./App";
import { AuthProvider } from "./auth/AuthContext";
import { registerAutoSync } from "./offline/syncQueue";
import { registerServiceWorker } from "./registerServiceWorker";
import { rtlCache } from "./rtlCache";
import { ColorModeProvider } from "./ui/ColorMode";
import { installSpotlight } from "./ui/spotlight";
import "./ui/spatial.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <CacheProvider value={rtlCache}>
      <ColorModeProvider>
        <CssBaseline />
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <AuthProvider>
              <App />
            </AuthProvider>
          </BrowserRouter>
        </QueryClientProvider>
      </ColorModeProvider>
    </CacheProvider>
  </React.StrictMode>,
);

registerServiceWorker();
installSpotlight();
registerAutoSync();
