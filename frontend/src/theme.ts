import { createTheme } from "@mui/material/styles";

export const theme = createTheme({
  direction: "rtl",
  typography: {
    fontFamily: '"Assistant", "Segoe UI", Arial, sans-serif',
  },
  palette: {
    primary: { main: "#1e5b8a" },
    secondary: { main: "#c0521f" },
    error: { main: "#c62828" },
    warning: { main: "#e69413" },
    success: { main: "#2e7d32" },
    background: { default: "#f4f6f8" },
  },
  shape: { borderRadius: 10 },
});
