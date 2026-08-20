import AdminPanelSettingsIcon from "@mui/icons-material/AdminPanelSettings";
import DashboardIcon from "@mui/icons-material/Dashboard";
import DomainIcon from "@mui/icons-material/Domain";
import BalanceIcon from "@mui/icons-material/Balance";
import CasinoIcon from "@mui/icons-material/Casino";
import FolderIcon from "@mui/icons-material/Folder";
import GavelIcon from "@mui/icons-material/Gavel";
import HandymanIcon from "@mui/icons-material/Handyman";
import HistoryIcon from "@mui/icons-material/History";
import ListAltIcon from "@mui/icons-material/ListAlt";
import LogoutIcon from "@mui/icons-material/Logout";
import PeopleAltIcon from "@mui/icons-material/PeopleAlt";
import ShieldIcon from "@mui/icons-material/Shield";
import ReportProblemIcon from "@mui/icons-material/ReportProblem";
import SummarizeIcon from "@mui/icons-material/Summarize";
import SyncIcon from "@mui/icons-material/Sync";
import VerifiedUserIcon from "@mui/icons-material/VerifiedUser";
import WifiIcon from "@mui/icons-material/Wifi";
import WifiOffIcon from "@mui/icons-material/WifiOff";
import AppBar from "@mui/material/AppBar";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Toolbar from "@mui/material/Toolbar";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";

import { useAuth } from "../auth/AuthContext";
import CopilotWidget from "./CopilotWidget";
import { ROLE_LABELS } from "../format";
import { useOnlineStatus } from "../hooks/useOnlineStatus";
import { subscribeToSyncQueue, trySync } from "../offline/syncQueue";

// `roles: undefined` = visible to every authenticated role. Mirrors the write-role sets
// enforced server-side in backend/app/routers/*.py (require_roles(...)) — a role that
// can't write to a section has little reason to see it in the nav, but ADMIN always
// sees everything regardless of this list (see filter below).
const NAV_ITEMS: { to: string; label: string; icon: ReactNode; roles?: string[] }[] = [
  { to: "/", label: "דשבורד", icon: <DashboardIcon fontSize="small" /> },
  {
    to: "/properties",
    label: "נכסים",
    icon: <DomainIcon fontSize="small" />,
    roles: ["RISK_MANAGER", "PROPERTY_MANAGER", "RISK_OFFICER", "CFO"],
  },
  { to: "/report-incident", label: "דיווח אירוע", icon: <ReportProblemIcon fontSize="small" /> },
  {
    to: "/incidents",
    label: "ניהול אירועים",
    icon: <ListAltIcon fontSize="small" />,
    roles: ["RISK_MANAGER", "PROPERTY_MANAGER", "RISK_OFFICER", "FIELD_WORKER"],
  },
  {
    to: "/claims",
    label: "תביעות",
    icon: <GavelIcon fontSize="small" />,
    roles: ["RISK_MANAGER", "CFO", "ADJUSTER"],
  },
  {
    to: "/policies",
    label: "פוליסות",
    icon: <ShieldIcon fontSize="small" />,
    roles: ["RISK_MANAGER", "CFO"],
  },
  {
    to: "/mitigation",
    label: "הפחתת סיכון",
    icon: <HandymanIcon fontSize="small" />,
    roles: ["RISK_MANAGER", "PROPERTY_MANAGER"],
  },
  {
    to: "/simulation",
    label: "סימולציה ו-VaR",
    icon: <CasinoIcon fontSize="small" />,
    roles: ["RISK_MANAGER", "CFO"],
  },
  {
    to: "/retention",
    label: "השתתפות עצמית",
    icon: <BalanceIcon fontSize="small" />,
    roles: ["RISK_MANAGER", "CFO"],
  },
  { to: "/documents", label: "מסמכים", icon: <FolderIcon fontSize="small" /> },
  {
    to: "/reports",
    label: "דוחות",
    icon: <SummarizeIcon fontSize="small" />,
    roles: ["RISK_MANAGER", "CFO"],
  },
  {
    to: "/compliance",
    label: "תאימות ISO 31000",
    icon: <VerifiedUserIcon fontSize="small" />,
    roles: ["RISK_MANAGER", "RISK_OFFICER", "CFO"],
  },
  {
    to: "/audit-log",
    label: "יומן ביקורת",
    icon: <HistoryIcon fontSize="small" />,
    // ADMIN-only (see backend/app/routers/audit.py) — listed explicitly rather than
    // relying only on the `|| user?.role === "ADMIN"` fallback below, so the intent
    // ("admins only, no one else") reads directly off this table.
    roles: ["ADMIN"],
  },
  {
    to: "/users",
    label: "ניהול משתמשים",
    icon: <PeopleAltIcon fontSize="small" />,
    // ADMIN-only (see backend/app/routers/users.py's GET /admin + write endpoints).
    roles: ["ADMIN"],
  },
  {
    to: "/roles",
    label: "ניהול הרשאות",
    icon: <AdminPanelSettingsIcon fontSize="small" />,
    // ADMIN-only (see backend/app/routers/role_permissions.py).
    roles: ["ADMIN"],
  },
];

/** Small AppBar chip: shows live online/offline state and, when relevant, the offline-sync queue. */
function ConnectionStatus() {
  const online = useOnlineStatus();
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => subscribeToSyncQueue((state) => {
    setPendingCount(state.pendingCount);
    setSyncing(state.syncing);
  }), []);

  if (online && pendingCount === 0) {
    return (
      <Tooltip title="מחובר לרשת">
        <Chip
          icon={<WifiIcon fontSize="small" />}
          label="מקוון"
          size="small"
          sx={{ height: 24, bgcolor: "rgba(255,255,255,0.15)", color: "white", "& .MuiChip-icon": { color: "white" } }}
        />
      </Tooltip>
    );
  }

  const label = !online
    ? pendingCount > 0
      ? `לא מקוון · ${pendingCount} ממתינים`
      : "לא מקוון"
    : `${pendingCount} ממתינים לסנכרון`;

  return (
    <Tooltip title={online ? "יש דיווחים ממתינים לסנכרון — לחצו לניסיון סנכרון" : "אין חיבור לרשת — הדיווחים החדשים יישמרו במכשיר"}>
      <Chip
        icon={syncing ? <CircularProgress size={14} color="inherit" /> : !online ? <WifiOffIcon fontSize="small" /> : <SyncIcon fontSize="small" />}
        label={syncing ? "מסנכרן..." : label}
        size="small"
        onClick={online && pendingCount > 0 && !syncing ? () => trySync() : undefined}
        sx={{
          height: 24,
          bgcolor: "warning.main",
          color: "warning.contrastText",
          cursor: online && pendingCount > 0 && !syncing ? "pointer" : "default",
          "& .MuiChip-icon": { color: "inherit" },
        }}
      />
    </Tooltip>
  );
}

export default function Layout({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { user, logout } = useAuth();

  const visibleItems = NAV_ITEMS.filter(
    (item) => !item.roles || item.roles.includes(user?.role ?? "") || user?.role === "ADMIN",
  );

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
      <AppBar position="sticky" color="primary" elevation={1}>
        <Toolbar sx={{ gap: 3 }}>
          <Typography variant="h6" sx={{ fontWeight: 700, flexShrink: 0 }}>
            🏢 RMIS — מערכת ניהול סיכונים
          </Typography>
          <Stack direction="row" spacing={1} sx={{ flexGrow: 1, overflowX: "auto" }}>
            {visibleItems.map((item) => (
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
                  flexShrink: 0,
                }}
              >
                {item.label}
              </Button>
            ))}
          </Stack>
          <ConnectionStatus />
          {user && (
            <Stack direction="row" spacing={1} alignItems="center" sx={{ flexShrink: 0 }}>
              <Stack alignItems="flex-end" spacing={0}>
                <Typography variant="body2" sx={{ fontWeight: 600, lineHeight: 1.2 }}>
                  {user.full_name}
                </Typography>
                <Chip
                  label={ROLE_LABELS[user.role] ?? user.role}
                  size="small"
                  sx={{ height: 18, fontSize: 11, bgcolor: "rgba(255,255,255,0.2)", color: "white" }}
                />
              </Stack>
              <Tooltip title="התנתקות">
                <IconButton color="inherit" onClick={logout} size="small">
                  <LogoutIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Stack>
          )}
        </Toolbar>
      </AppBar>
      <Box component="main" sx={{ p: { xs: 2, md: 3 }, maxWidth: 1600, mx: "auto" }}>
        {children}
      </Box>
      <CopilotWidget />
    </Box>
  );
}
