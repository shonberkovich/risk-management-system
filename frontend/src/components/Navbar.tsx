import AdminPanelSettingsIcon from "@mui/icons-material/AdminPanelSettings";
import BalanceIcon from "@mui/icons-material/Balance";
import CasinoIcon from "@mui/icons-material/Casino";
import CloudSyncIcon from "@mui/icons-material/CloudSync";
import CloseIcon from "@mui/icons-material/Close";
import DashboardIcon from "@mui/icons-material/Dashboard";
import DomainIcon from "@mui/icons-material/Domain";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import FolderIcon from "@mui/icons-material/Folder";
import GavelIcon from "@mui/icons-material/Gavel";
import HandymanIcon from "@mui/icons-material/Handyman";
import HistoryIcon from "@mui/icons-material/History";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import ListAltIcon from "@mui/icons-material/ListAlt";
import LogoutIcon from "@mui/icons-material/Logout";
import MailOutlineIcon from "@mui/icons-material/MailOutline";
import MenuIcon from "@mui/icons-material/Menu";
import MoreHorizIcon from "@mui/icons-material/MoreHoriz";
import NotificationsActiveIcon from "@mui/icons-material/NotificationsActive";
import PeopleAltIcon from "@mui/icons-material/PeopleAlt";
import PersonIcon from "@mui/icons-material/Person";
import ReportProblemIcon from "@mui/icons-material/ReportProblem";
import ShieldIcon from "@mui/icons-material/Shield";
import SummarizeIcon from "@mui/icons-material/Summarize";
import SyncIcon from "@mui/icons-material/Sync";
import VerifiedUserIcon from "@mui/icons-material/VerifiedUser";
import WifiIcon from "@mui/icons-material/Wifi";
import WifiOffIcon from "@mui/icons-material/WifiOff";
import AppBar from "@mui/material/AppBar";
import Avatar from "@mui/material/Avatar";
import Badge from "@mui/material/Badge";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Collapse from "@mui/material/Collapse";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import Drawer from "@mui/material/Drawer";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Toolbar from "@mui/material/Toolbar";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { alpha, useTheme } from "@mui/material/styles";
import useScrollTrigger from "@mui/material/useScrollTrigger";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Fragment, useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";

import { fetchEmails, previewNotifications } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { ROLE_LABELS } from "../format";
import { useOnlineStatus } from "../hooks/useOnlineStatus";
import { subscribeToSyncQueue, trySync } from "../offline/syncQueue";
import { ease, fonts } from "../ui/tokens";
import { useTokens } from "../ui/useTokens";
import ThemeToggle from "./ThemeToggle";

interface NavLeaf {
  kind: "link";
  to: string;
  label: string;
  icon: ReactNode;
  /** `undefined` = visible to every authenticated role. Mirrors the write-role sets enforced
   * server-side in backend/app/routers/*.py (require_roles(...)) — a role that can't write to a
   * section has little reason to see it in the nav, but ADMIN always sees everything (see canSee). */
  roles?: string[];
}

interface NavGroup {
  kind: "group";
  key: string;
  label: string;
  icon: ReactNode;
  roles?: string[];
  items: NavLeaf[];
}

type NavEntry = NavLeaf | NavGroup;

function canSee(roles: string[] | undefined, role: string | undefined): boolean {
  return !roles || roles.includes(role ?? "") || role === "ADMIN";
}

// Grouped nav structure. Individual leaf `roles` are the source of truth for visibility (same
// role sets the old flat nav used); a group only shows once at least one child is visible to
// the current user, so tightening/loosening a leaf's roles is all that's needed to reshape groups.
const NAV_ENTRIES: NavEntry[] = [
  { kind: "link", to: "/", label: "דשבורד", icon: <DashboardIcon fontSize="small" /> },
  // No `roles` restriction — matches routers/emails.py's module docstring: email is a
  // general internal tool, not role-gated (access is scoped per-message by mailbox
  // ownership server-side, not by role).
  { kind: "link", to: "/emails", label: "דואר", icon: <MailOutlineIcon fontSize="small" /> },
  {
    kind: "group",
    key: "assets",
    label: "נכסים ומפה",
    icon: <DomainIcon fontSize="small" />,
    items: [
      {
        kind: "link",
        to: "/properties",
        label: "נכסים",
        icon: <DomainIcon fontSize="small" />,
        roles: ["RISK_MANAGER", "PROPERTY_MANAGER", "RISK_OFFICER", "CFO"],
      },
      {
        kind: "link",
        to: "/mitigation",
        label: "הפחתת סיכון",
        icon: <HandymanIcon fontSize="small" />,
        roles: ["RISK_MANAGER", "PROPERTY_MANAGER"],
      },
    ],
  },
  {
    kind: "group",
    key: "incidents",
    label: "אירועים ותביעות",
    icon: <GavelIcon fontSize="small" />,
    items: [
      { kind: "link", to: "/report-incident", label: "דיווח אירוע", icon: <ReportProblemIcon fontSize="small" /> },
      {
        kind: "link",
        to: "/incidents",
        label: "ניהול אירועים",
        icon: <ListAltIcon fontSize="small" />,
        roles: ["RISK_MANAGER", "PROPERTY_MANAGER", "RISK_OFFICER", "FIELD_WORKER"],
      },
      {
        kind: "link",
        to: "/claims",
        label: "תביעות",
        icon: <GavelIcon fontSize="small" />,
        roles: ["RISK_MANAGER", "CFO", "ADJUSTER"],
      },
    ],
  },
  {
    kind: "group",
    key: "finance",
    label: "ניתוחים פיננסיים",
    icon: <BalanceIcon fontSize="small" />,
    items: [
      {
        kind: "link",
        to: "/policies",
        label: "פוליסות",
        icon: <ShieldIcon fontSize="small" />,
        // Matches backend/app/routers/policies.py's _POLICIES_READ_ROLES (the actual
        // server-side GET gate) rather than just the narrower write-role set: this is one
        // of the few GET endpoints that *is* role-gated (financial disclosure — see
        // dependencies/permissions.py's module docstring), so PROPERTY_MANAGER/
        // RISK_OFFICER/ADJUSTER genuinely can read policy data and previously had no way
        // to discover /policies from the nav (bug found during E2E nav-RBAC sweep).
        roles: ["RISK_MANAGER", "CFO", "PROPERTY_MANAGER", "RISK_OFFICER", "ADJUSTER"],
      },
      {
        kind: "link",
        to: "/simulation",
        label: "סימולציה ו-VaR",
        icon: <CasinoIcon fontSize="small" />,
        roles: ["RISK_MANAGER", "CFO"],
      },
      {
        kind: "link",
        to: "/retention",
        label: "השתתפות עצמית",
        icon: <BalanceIcon fontSize="small" />,
        roles: ["RISK_MANAGER", "CFO"],
      },
      {
        kind: "link",
        to: "/reports",
        label: "דוחות",
        icon: <SummarizeIcon fontSize="small" />,
        roles: ["RISK_MANAGER", "CFO"],
      },
    ],
  },
  {
    kind: "group",
    key: "compliance",
    label: "דוחות ציות ו-ISO",
    icon: <VerifiedUserIcon fontSize="small" />,
    items: [
      {
        kind: "link",
        to: "/compliance",
        label: "תאימות ISO 31000",
        icon: <VerifiedUserIcon fontSize="small" />,
        roles: ["RISK_MANAGER", "RISK_OFFICER", "CFO"],
      },
      {
        // ADMIN-only (see backend/app/routers/audit.py) — listed explicitly rather than relying
        // only on the ADMIN fallback in canSee, so the intent reads directly off this table.
        kind: "link",
        to: "/audit-log",
        label: "יומן ביקורת",
        icon: <HistoryIcon fontSize="small" />,
        roles: ["ADMIN"],
      },
    ],
  },
  {
    kind: "group",
    key: "more",
    label: "עוד",
    icon: <MoreHorizIcon fontSize="small" />,
    items: [
      { kind: "link", to: "/documents", label: "מסמכים", icon: <FolderIcon fontSize="small" /> },
      {
        // No `roles` restriction: the page itself gates each section per role (ERP/GIS/economics
        // vs. the weather feed, which routers/integrations.py leaves open to every authenticated
        // role) — a field worker still needs to see at least the weather-alerts section.
        kind: "link",
        to: "/integrations",
        label: "אינטגרציות",
        icon: <CloudSyncIcon fontSize="small" />,
      },
    ],
  },
  {
    kind: "group",
    key: "admin",
    label: "ניהול מערכת",
    icon: <AdminPanelSettingsIcon fontSize="small" />,
    // ADMIN-only (see backend/app/routers/users.py + role_permissions.py).
    roles: ["ADMIN"],
    items: [
      { kind: "link", to: "/users", label: "ניהול משתמשים", icon: <PeopleAltIcon fontSize="small" />, roles: ["ADMIN"] },
      { kind: "link", to: "/roles", label: "ניהול הרשאות", icon: <AdminPanelSettingsIcon fontSize="small" />, roles: ["ADMIN"] },
    ],
  },
];

/** Glass "pill" treatment shared by the toolbar icon buttons. */
const navIconSx = (isDark: boolean) =>
  ({
    color: "text.primary",
    width: { xs: 34, sm: 40 },
    height: { xs: 34, sm: 40 },
    bgcolor: isDark ? "rgba(255,255,255,0.035)" : "rgba(255,255,255,0.7)",
    border: `1px solid ${isDark ? "rgba(148, 163, 255, 0.12)" : "rgba(30, 38, 96, 0.12)"}`,
  }) as const;

// Same read-role set as routers/notifications.py's _NOTIFICATIONS_ROLES.
const NOTIFICATIONS_ROLES = ["RISK_MANAGER", "CFO"];

/** Small chip: shows live online/offline state and, when relevant, the offline-sync queue. */
function ConnectionStatus() {
  const { neon } = useTokens();
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
          label={
            <Stack direction="row" alignItems="center" spacing={0.75} component="span">
              <span className="rmis-pulse" />
              <span>מקוון</span>
            </Stack>
          }
          size="small"
          sx={{
            height: 28,
            px: 0.5,
            bgcolor: alpha(neon.low, 0.08),
            border: `1px solid ${alpha(neon.low, 0.28)}`,
            color: neon.low,
            fontWeight: 600,
            "& .MuiChip-icon": { color: neon.low, display: "none" },
          }}
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
          height: 26,
          bgcolor: "warning.main",
          color: "warning.contrastText",
          fontWeight: 500,
          cursor: online && pendingCount > 0 && !syncing ? "pointer" : "default",
          "& .MuiChip-icon": { color: "inherit" },
        }}
      />
    </Tooltip>
  );
}

export default function Navbar() {
  const location = useLocation();
  const { user, logout } = useAuth();
  const theme = useTheme();
  const { ink, neon, gradients } = useTokens();
  const isDark = theme.palette.mode === "dark";
  const NAV_ICON_SX = navIconSx(isDark);
  const scrolled = useScrollTrigger({ disableHysteresis: true, threshold: 8 });

  const [mobileOpen, setMobileOpen] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [userMenuAnchor, setUserMenuAnchor] = useState<HTMLElement | null>(null);

  const notificationsAllowed = canSee(NOTIFICATIONS_ROLES, user?.role);
  const { data: notifPreview } = useQuery({
    queryKey: ["nav-notifications-preview"],
    queryFn: previewNotifications,
    enabled: notificationsAllowed,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const notifCount = notifPreview?.length ?? 0;

  // Unread-inbox badge on the mail icon — same lightweight "fetch + count client-side"
  // approach as EmailSidebar's per-folder badges (see that component's doc comment);
  // Task 9 replaces the polling with SSE-driven invalidation of the same query key.
  const { data: inboxUnreadCount } = useQuery({
    queryKey: ["emails", "INBOX", "unread-count"],
    queryFn: () => fetchEmails("INBOX", 0, 200),
    select: (items) => items.filter((item) => !item.is_read).length,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const visibleEntries = useMemo(() => {
    return NAV_ENTRIES.map((entry) => {
      if (entry.kind === "link") return canSee(entry.roles, user?.role) ? entry : null;
      const items = entry.items.filter((item) => canSee(item.roles, user?.role));
      if (items.length === 0 || !canSee(entry.roles, user?.role)) return null;
      return { ...entry, items };
    }).filter((entry): entry is NavEntry => entry !== null);
  }, [user?.role]);

  const isActive = (to: string) =>
    to === "/" ? location.pathname === "/" : location.pathname === to || location.pathname.startsWith(`${to}/`);
  const isGroupActive = (group: NavGroup) => group.items.some((item) => isActive(item.to));

  const toggleMobileGroup = (key: string) =>
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const initials = user?.full_name
    ? user.full_name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase()
    : "?";

  return (
    <>
      <AppBar
        position="sticky"
        elevation={0}
        sx={{
          top: { xs: 8, md: 14 },
          mx: { xs: 1, sm: 1.5, md: 2.5 },
          width: "auto",
          overflow: "hidden",
          isolation: "isolate",
          borderRadius: { xs: "18px", md: "22px" },
          color: "text.primary",
          bgcolor: isDark
            ? scrolled
              ? "rgba(7, 10, 26, 0.78)"
              : "rgba(10, 15, 36, 0.48)"
            : scrolled
              ? "rgba(255, 255, 255, 0.82)"
              : "rgba(255, 255, 255, 0.55)",
          backgroundImage: `linear-gradient(90deg, ${alpha(neon.violet, 0.1)} 0%, transparent 35%, transparent 65%, ${alpha(neon.cyan, 0.08)} 100%)`,
          backdropFilter: "blur(24px) saturate(170%)",
          WebkitBackdropFilter: "blur(24px) saturate(170%)",
          border: `1px solid ${scrolled ? ink.lineStrong : ink.line}`,
          boxShadow: scrolled
            ? `0 24px 60px -24px ${isDark ? "rgba(0,0,0,0.9)" : "rgba(30,38,96,0.32)"}, 0 0 50px -30px ${alpha(neon.violet, 0.8)}, inset 0 1px 0 ${isDark ? "rgba(255,255,255,0.07)" : "#fff"}`
            : `inset 0 1px 0 ${isDark ? "rgba(255,255,255,0.06)" : "#fff"}`,
          transition: `background-color 0.5s ${ease.out}, box-shadow 0.5s ${ease.out}, border-color 0.5s ${ease.out}`,
          // Thin aurora "scanline" along the bottom edge of the floating bar.
          "&::before": {
            content: '""',
            position: "absolute",
            insetInline: "8%",
            bottom: 0,
            height: "1px",
            background: `linear-gradient(90deg, transparent, ${alpha(neon.violet, 0.9)}, ${alpha(neon.cyan, 0.9)}, transparent)`,
            opacity: scrolled ? 1 : 0.55,
            transition: `opacity 0.5s ${ease.out}`,
            pointerEvents: "none",
          },
        }}
      >
        <Toolbar sx={{ gap: { xs: 0.5, sm: 2 }, minHeight: { xs: 56, md: 68 }, px: { xs: 1, sm: 2 } }}>
          {/* Brand & identity */}
          <Box
            component={Link}
            to="/"
            sx={{
              display: "flex",
              alignItems: "center",
              gap: { xs: 1, sm: 1.5 },
              textDecoration: "none",
              color: "inherit",
              flexShrink: 0,
              "&:hover .rmis-brand-mark": { transform: "rotateY(180deg)" },
            }}
          >
            <Box sx={{ perspective: "400px", flexShrink: 0 }}>
              <Box
                className="rmis-brand-mark"
                sx={{
                  position: "relative",
                  width: { xs: 34, sm: 40 },
                  height: { xs: 34, sm: 40 },
                  borderRadius: "13px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  transformStyle: "preserve-3d",
                  transition: `transform 0.9s ${ease.out}`,
                  background: `conic-gradient(from 210deg, ${neon.violet}, ${neon.sky}, ${neon.cyan}, ${neon.magenta}, ${neon.violet})`,
                  boxShadow: `0 0 26px -4px ${alpha(neon.violet, 0.9)}, inset 0 1px 0 rgba(255,255,255,0.4)`,
                  "&::after": {
                    content: '""',
                    position: "absolute",
                    inset: "1.5px",
                    borderRadius: "11.5px",
                    background: "radial-gradient(circle at 30% 20%, #20275a, #02030A 80%)",
                  },
                }}
              >
                <ShieldIcon
                  sx={{
                    position: "relative",
                    zIndex: 1,
                    fontSize: 21,
                    color: "#fff",
                    filter: `drop-shadow(0 0 8px ${alpha(neon.cyan, 0.9)})`,
                  }}
                />
              </Box>
            </Box>
            <Box>
              <Stack direction="row" alignItems="center" spacing={1}>
                <Typography
                  variant="h6"
                  sx={{
                    fontFamily: fonts.display,
                    fontWeight: 800,
                    lineHeight: 1.05,
                    letterSpacing: "0.04em",
                    background: gradients.heading,
                    WebkitBackgroundClip: "text",
                    backgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                  }}
                >
                  RMIS
                </Typography>
                <Chip
                  label="Demo"
                  size="small"
                  variant="outlined"
                  sx={{
                    display: { xs: "none", sm: "inline-flex" },
                    height: 18,
                    fontSize: 9.5,
                    fontFamily: fonts.mono,
                    letterSpacing: "0.12em",
                    borderColor: alpha(neon.cyan, 0.45),
                    color: neon.cyan,
                    boxShadow: `0 0 12px -4px ${alpha(neon.cyan, 0.9)}`,
                  }}
                />
              </Stack>
              <Typography
                variant="caption"
                sx={{
                  color: "text.secondary",
                  display: { xs: "none", sm: "block" },
                  lineHeight: 1.3,
                  letterSpacing: "0.04em",
                }}
              >
                מערכת לניהול סיכונים
              </Typography>
            </Box>
          </Box>

          <Box sx={{ flexGrow: 1 }} />

          {/* Utility actions & profile */}
          <Stack direction="row" spacing={{ xs: 0.5, sm: 1 }} alignItems="center" sx={{ flexShrink: 0, ms: "auto" }}>
            <Tooltip title="דיווח אירוע חדש">
              <Button
                component={Link}
                to="/report-incident"
                variant="contained"
                color="secondary"
                size="small"
                startIcon={<ReportProblemIcon fontSize="small" />}
                sx={{ display: { xs: "none", sm: "inline-flex" }, fontWeight: 700, borderRadius: 999, px: 2.25 }}
              >
                דיווח אירוע
              </Button>
            </Tooltip>
            <Tooltip title="דיווח אירוע חדש">
              <IconButton
                component={Link}
                to="/report-incident"
                size="small"
                sx={{
                  display: { xs: "inline-flex", sm: "none" },
                  width: 34,
                  height: 34,
                  color: "#02110F",
                  backgroundImage: `linear-gradient(135deg, ${theme.palette.secondary.main}, ${neon.sky})`,
                  boxShadow: `0 0 18px -4px ${alpha(theme.palette.secondary.main, 0.9)}`,
                }}
              >
                <ReportProblemIcon fontSize="small" />
              </IconButton>
            </Tooltip>

            <Box sx={{ display: { xs: "none", md: "block" } }}>
              <ConnectionStatus />
            </Box>

            <ThemeToggle />

            <Tooltip title="דואר">
              <IconButton component={Link} to="/emails" sx={NAV_ICON_SX}>
                <Badge badgeContent={inboxUnreadCount ?? 0} color="error" max={9}>
                  <MailOutlineIcon fontSize="small" />
                </Badge>
              </IconButton>
            </Tooltip>

            {notificationsAllowed && (
              <Tooltip title="התראות">
                <IconButton component={Link} to="/notifications" sx={NAV_ICON_SX}>
                  <Badge badgeContent={notifCount} color="error" max={9}>
                    <NotificationsActiveIcon fontSize="small" />
                  </Badge>
                </IconButton>
              </Tooltip>
            )}

            {user && (
              <>
                <Box
                  onClick={(e) => setUserMenuAnchor(e.currentTarget)}
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                    cursor: "pointer",
                    borderRadius: 999,
                    pl: { xs: 0.25, sm: 0.5 },
                    pr: { xs: 0.25, md: 1.25 },
                    py: { xs: 0.25, sm: 0.5 },
                    border: `1px solid ${ink.line}`,
                    bgcolor: isDark ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.7)",
                    transition: `background-color 0.35s ${ease.out}, border-color 0.35s, box-shadow 0.45s ${ease.out}`,
                    "&:hover": {
                      bgcolor: alpha(neon.violet, 0.1),
                      borderColor: alpha(neon.violet, 0.45),
                      boxShadow: `0 0 28px -8px ${alpha(neon.violet, 0.8)}`,
                    },
                  }}
                >
                  <Avatar sx={{ width: { xs: 30, sm: 34 }, height: { xs: 30, sm: 34 }, fontSize: 13, fontWeight: 700 }}>
                    {initials}
                  </Avatar>
                  <Box sx={{ display: { xs: "none", md: "block" }, textAlign: "right", lineHeight: 1.1 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600, color: "text.primary", lineHeight: 1.2 }}>
                      {user.full_name}
                    </Typography>
                    <Typography variant="caption" sx={{ color: neon.cyan, fontWeight: 500 }}>
                      {ROLE_LABELS[user.role] ?? user.role}
                    </Typography>
                  </Box>
                  <KeyboardArrowDownIcon sx={{ color: "text.secondary", fontSize: 18, display: { xs: "none", md: "block" } }} />
                </Box>
                <Menu
                  anchorEl={userMenuAnchor}
                  open={!!userMenuAnchor}
                  onClose={() => setUserMenuAnchor(null)}
                  anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
                  transformOrigin={{ vertical: "top", horizontal: "center" }}
                >
                  <Box sx={{ px: 2, py: 1.5, minWidth: 200 }}>
                    <Typography variant="subtitle2" fontWeight={700}>
                      {user.full_name}
                    </Typography>
                    <Chip label={ROLE_LABELS[user.role] ?? user.role} size="small" sx={{ mt: 0.5 }} />
                  </Box>
                  <Divider />
                  {/* TODO_SPEC.md "משימה 14" step 2 — entry point to the new self-service
                      Profile Settings screen (signature editor). */}
                  <MenuItem component={Link} to="/profile" onClick={() => setUserMenuAnchor(null)}>
                    <ListItemIcon>
                      <PersonIcon fontSize="small" />
                    </ListItemIcon>
                    <ListItemText>הגדרות פרופיל</ListItemText>
                  </MenuItem>
                  <MenuItem
                    onClick={() => {
                      setUserMenuAnchor(null);
                      logout();
                    }}
                  >
                    <ListItemIcon>
                      <LogoutIcon fontSize="small" />
                    </ListItemIcon>
                    <ListItemText>התנתקות</ListItemText>
                  </MenuItem>
                </Menu>
              </>
            )}

            <Tooltip title="ניווט">
              <IconButton onClick={() => setMobileOpen(true)} sx={NAV_ICON_SX}>
                <MenuIcon />
              </IconButton>
            </Tooltip>
          </Stack>
        </Toolbar>
      </AppBar>

      {/* Nav sidebar (all breakpoints, toggled by the hamburger). anchor="right" here docks
          physically on the left: this app's emotion cache (rtlCache.ts) mirrors left/right for
          every emotion-generated style, including MUI's own Drawer paper — so the panel ends up
          next to the hamburger button that opens it, which sits on the physical left of the
          toolbar. */}
      <Drawer
        anchor="right"
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        PaperProps={{ sx: { width: { xs: "88vw", sm: 340 }, maxWidth: 360, display: "flex", flexDirection: "column" } }}
        data-testid="nav-drawer"
      >
        <Box sx={{ p: 2, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Stack direction="row" alignItems="center" spacing={1}>
            <Box
              sx={{
                width: 34,
                height: 34,
                borderRadius: "11px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: `conic-gradient(from 210deg, ${neon.violet}, ${neon.sky}, ${neon.cyan}, ${neon.magenta}, ${neon.violet})`,
                boxShadow: `0 0 22px -4px ${alpha(neon.violet, 0.9)}`,
              }}
            >
              <ShieldIcon sx={{ fontSize: 18, color: "#fff" }} />
            </Box>
            <Box>
              <Typography variant="subtitle1" fontWeight={800} sx={{ fontFamily: fonts.display, letterSpacing: "0.04em", lineHeight: 1.1 }}>
                RMIS
              </Typography>
              <Typography variant="overline" sx={{ display: "block", fontSize: 9, lineHeight: 1.4, color: neon.cyan }}>
                NAVIGATION
              </Typography>
            </Box>
          </Stack>
          <IconButton onClick={() => setMobileOpen(false)} size="small">
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>
        <Divider />
        <List sx={{ flexGrow: 1, overflowY: "auto", py: 1.5 }}>
          {visibleEntries.map((entry) =>
            entry.kind === "link" ? (
              <ListItemButton
                key={entry.to}
                component={Link}
                to={entry.to}
                selected={isActive(entry.to)}
                onClick={() => setMobileOpen(false)}
                data-testid={`nav-link-${entry.to}`}
              >
                <ListItemIcon>{entry.icon}</ListItemIcon>
                <ListItemText primary={entry.label} />
              </ListItemButton>
            ) : (
              <Fragment key={entry.key}>
                <ListItemButton
                  onClick={() => toggleMobileGroup(entry.key)}
                  selected={isGroupActive(entry)}
                  data-testid={`nav-group-${entry.key}`}
                >
                  <ListItemIcon>{entry.icon}</ListItemIcon>
                  <ListItemText primary={entry.label} primaryTypographyProps={{ fontWeight: 600 }} />
                  {expandedGroups.has(entry.key) ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                </ListItemButton>
                <Collapse in={expandedGroups.has(entry.key) || isGroupActive(entry)} timeout="auto" unmountOnExit>
                  <List component="div" disablePadding>
                    {entry.items.map((item) => (
                      <ListItemButton
                        key={item.to}
                        component={Link}
                        to={item.to}
                        selected={isActive(item.to)}
                        onClick={() => setMobileOpen(false)}
                        sx={{ pl: 5, "& .MuiListItemText-primary": { fontSize: "0.9rem" } }}
                        data-testid={`nav-link-${item.to}`}
                      >
                        <ListItemIcon>{item.icon}</ListItemIcon>
                        <ListItemText primary={item.label} />
                      </ListItemButton>
                    ))}
                  </List>
                </Collapse>
              </Fragment>
            ),
          )}
        </List>
        <Divider />
        {user && (
          <Box sx={{ p: 2 }}>
            <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 1.5 }}>
              <Avatar>{initials}</Avatar>
              <Box>
                <Typography variant="body2" fontWeight={700}>
                  {user.full_name}
                </Typography>
                <Chip label={ROLE_LABELS[user.role] ?? user.role} size="small" sx={{ mt: 0.25 }} />
              </Box>
            </Stack>
            <Stack spacing={1}>
              <ThemeToggle variant="row" />
              <Button
                fullWidth
                variant="outlined"
                color="inherit"
                startIcon={<PersonIcon />}
                component={Link}
                to="/profile"
                onClick={() => setMobileOpen(false)}
              >
                הגדרות פרופיל
              </Button>
              <Button
                fullWidth
                variant="outlined"
                color="inherit"
                startIcon={<LogoutIcon />}
                onClick={() => {
                  setMobileOpen(false);
                  logout();
                }}
              >
                התנתקות
              </Button>
            </Stack>
          </Box>
        )}
      </Drawer>
    </>
  );
}
