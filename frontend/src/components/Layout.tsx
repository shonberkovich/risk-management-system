import DashboardIcon from "@mui/icons-material/Dashboard";
import DomainIcon from "@mui/icons-material/Domain";
import BalanceIcon from "@mui/icons-material/Balance";
import CasinoIcon from "@mui/icons-material/Casino";
import GavelIcon from "@mui/icons-material/Gavel";
import HandymanIcon from "@mui/icons-material/Handyman";
import ListAltIcon from "@mui/icons-material/ListAlt";
import ShieldIcon from "@mui/icons-material/Shield";
import ReportProblemIcon from "@mui/icons-material/ReportProblem";
import SummarizeIcon from "@mui/icons-material/Summarize";
import AppBar from "@mui/material/AppBar";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";

const NAV_ITEMS = [
  { to: "/", label: "דשבורד", icon: <DashboardIcon fontSize="small" /> },
  { to: "/properties", label: "נכסים", icon: <DomainIcon fontSize="small" /> },
  { to: "/report-incident", label: "דיווח אירוע", icon: <ReportProblemIcon fontSize="small" /> },
  { to: "/incidents", label: "ניהול אירועים", icon: <ListAltIcon fontSize="small" /> },
  { to: "/claims", label: "תביעות", icon: <GavelIcon fontSize="small" /> },
  { to: "/policies", label: "פוליסות", icon: <ShieldIcon fontSize="small" /> },
  { to: "/mitigation", label: "הפחתת סיכון", icon: <HandymanIcon fontSize="small" /> },
  { to: "/simulation", label: "סימולציה ו-VaR", icon: <CasinoIcon fontSize="small" /> },
  { to: "/retention", label: "השתתפות עצמית", icon: <BalanceIcon fontSize="small" /> },
  { to: "/reports", label: "דוחות", icon: <SummarizeIcon fontSize="small" /> },
];

export default function Layout({ children }: { children: ReactNode }) {
  const location = useLocation();

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
      <AppBar position="sticky" color="primary" elevation={1}>
        <Toolbar sx={{ gap: 3 }}>
          <Typography variant="h6" sx={{ fontWeight: 700, flexShrink: 0 }}>
            🏢 RMIS — מערכת ניהול סיכונים
          </Typography>
          <Stack direction="row" spacing={1} sx={{ flexGrow: 1 }}>
            {NAV_ITEMS.map((item) => (
              <Button
                key={item.to}
                component={Link}
                to={item.to}
                startIcon={item.icon}
                sx={{
                  color: "white",
                  opacity: location.pathname === item.to ? 1 : 0.75,
                  fontWeight: location.pathname === item.to ? 700 : 400,
                  borderBottom: location.pathname === item.to ? "2px solid white" : "2px solid transparent",
                  borderRadius: 0,
                }}
              >
                {item.label}
              </Button>
            ))}
          </Stack>
        </Toolbar>
      </AppBar>
      <Box component="main" sx={{ p: { xs: 2, md: 3 }, maxWidth: 1600, mx: "auto" }}>
        {children}
      </Box>
    </Box>
  );
}
