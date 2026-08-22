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

// Same read-role set as routers/notifications.py's _NOTIFICATIONS_ROLES.
const NOTIFICATIONS_ROLES = ["RISK_MANAGER", "CFO"];

/** Small chip: shows live online/offline state and, when relevant, the offline-sync queue. */
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
          sx={{
            height: 26,
            bgcolor: alpha("#ffffff", 0.14),
            color: "#fff",
            fontWeight: 500,
            "& .MuiChip-icon": { color: "#fff" },
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
          bgcolor: alpha(theme.palette.primary.main, scrolled ? 0.94 : 0.82),
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          borderBottom: `1px solid ${alpha("#ffffff", 0.08)}`,
          boxShadow: scrolled ? "0 4px 24px rgba(0,0,0,0.18)" : "none",
          transition: "background-color 0.25s ease, box-shadow 0.25s ease",
        }}
      >
        <Toolbar sx={{ gap: 2, minHeight: 64 }}>
          {/* Brand & identity */}
          <Box
            component={Link}
            to="/"
            sx={{ display: "flex", alignItems: "center", gap: 1.25, textDecoration: "none", color: "inherit", flexShrink: 0 }}
          >
            <Box
              sx={{
                width: 38,
                height: 38,
                borderRadius: 2,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                background: `linear-gradient(135deg, ${theme.palette.secondary.main}, ${theme.palette.primary.dark ?? theme.palette.primary.main})`,
                boxShadow: "0 2px 10px rgba(0,0,0,0.3)",
              }}
            >
              <ShieldIcon sx={{ fontSize: 21, color: "#fff" }} />
            </Box>
            <Box>
              <Stack direction="row" alignItems="center" spacing={1}>
                <Typography variant="h6" sx={{ fontWeight: 800, lineHeight: 1.1, letterSpacing: 0.2 }}>
                  RMIS
                </Typography>
                <Chip
                  label="Demo"
                  size="small"
                  variant="outlined"
                  sx={{ height: 18, fontSize: 10, borderColor: alpha("#fff", 0.4), color: alpha("#fff", 0.9) }}
                />
              </Stack>
              <Typography
                variant="caption"
                sx={{ opacity: 0.75, display: { xs: "none", sm: "block" }, lineHeight: 1.2 }}
              >
                מערכת לניהול סיכונים
              </Typography>
            </Box>
          </Box>

          {/* Utility actions & profile */}
          <Stack direction="row" spacing={1} alignItems="center" sx={{ flexShrink: 0, ms: "auto" }}>
            <Tooltip title="דיווח אירוע חדש">
              <Button
                component={Link}
                to="/report-incident"
                variant="contained"
                color="secondary"
                size="small"
                startIcon={<ReportProblemIcon fontSize="small" />}
                sx={{ display: { xs: "none", sm: "inline-flex" }, fontWeight: 700, boxShadow: "0 2px 10px rgba(0,0,0,0.3)" }}
              >
                דיווח אירוע
              </Button>
            </Tooltip>
            <Tooltip title="דיווח אירוע חדש">
              <IconButton
                component={Link}
                to="/report-incident"
                size="small"
                sx={{ display: { xs: "inline-flex", sm: "none" }, color: "#fff", bgcolor: alpha(theme.palette.secondary.main, 0.9) }}
              >
                <ReportProblemIcon fontSize="small" />
              </IconButton>
            </Tooltip>

            <Box sx={{ display: { xs: "none", md: "block" } }}>
              <ConnectionStatus />
            </Box>

            <Tooltip title="דואר">
              <IconButton component={Link} to="/emails" sx={{ color: "#fff" }}>
                <Badge badgeContent={inboxUnreadCount ?? 0} color="error" max={9}>
                  <MailOutlineIcon fontSize="small" />
                </Badge>
              </IconButton>
            </Tooltip>

            {notificationsAllowed && (
              <Tooltip title="התראות">
                <IconButton component={Link} to="/notifications" sx={{ color: "#fff" }}>
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
                  sx={{ display: "flex", alignItems: "center", gap: 1, cursor: "pointer", borderRadius: 2, px: 0.5, py: 0.5, "&:hover": { bgcolor: alpha("#fff", 0.08) } }}
                >
                  <Avatar sx={{ width: 34, height: 34, bgcolor: alpha("#fff", 0.22), color: "#fff", fontSize: 14, fontWeight: 700 }}>
                    {initials}
                  </Avatar>
                  <Box sx={{ display: { xs: "none", md: "block" }, textAlign: "right", lineHeight: 1.1 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600, color: "#fff", lineHeight: 1.2 }}>
                      {user.full_name}
                    </Typography>
                    <Typography variant="caption" sx={{ color: alpha("#fff", 0.75) }}>
                      {ROLE_LABELS[user.role] ?? user.role}
                    </Typography>
                  </Box>
                  <KeyboardArrowDownIcon sx={{ color: "#fff", fontSize: 18, display: { xs: "none", md: "block" } }} />
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
              <IconButton onClick={() => setMobileOpen(true)} sx={{ color: "#fff" }}>
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
        PaperProps={{ sx: { width: 300, display: "flex", flexDirection: "column" } }}
        data-testid="nav-drawer"
      >
        <Box sx={{ p: 2, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Stack direction="row" alignItems="center" spacing={1}>
            <Box
              sx={{
                width: 32,
                height: 32,
                borderRadius: 1.5,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: `linear-gradient(135deg, ${theme.palette.secondary.main}, ${theme.palette.primary.main})`,
              }}
            >
              <ShieldIcon sx={{ fontSize: 18, color: "#fff" }} />
            </Box>
            <Typography variant="subtitle1" fontWeight={800}>
              RMIS
            </Typography>
          </Stack>
          <IconButton onClick={() => setMobileOpen(false)} size="small">
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>
        <Divider />
        <List sx={{ flexGrow: 1, overflowY: "auto" }}>
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
                        sx={{ pl: 5 }}
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
              <Avatar sx={{ bgcolor: "primary.main" }}>{initials}</Avatar>
              <Box>
                <Typography variant="body2" fontWeight={700}>
                  {user.full_name}
                </Typography>
                <Chip label={ROLE_LABELS[user.role] ?? user.role} size="small" sx={{ mt: 0.25 }} />
              </Box>
            </Stack>
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
          </Box>
        )}
      </Drawer>
    </>
  );
}
