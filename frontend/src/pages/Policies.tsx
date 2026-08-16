import AddIcon from "@mui/icons-material/Add";
import PaidIcon from "@mui/icons-material/Paid";
import SecurityIcon from "@mui/icons-material/Security";
import ShieldIcon from "@mui/icons-material/Shield";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CircularProgress from "@mui/material/CircularProgress";
import Grid from "@mui/material/Grid";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { fetchPolicies, type Policy, type PolicyStatus } from "../api/client";
import PolicyAssetsDialog from "../components/PolicyAssetsDialog";
import PolicyDialog from "../components/PolicyDialog";
import PolicyTable from "../components/PolicyTable";
import { POLICY_STATUS_LABELS, formatIlsCompact } from "../format";

const STATUS_OPTIONS: PolicyStatus[] = ["ACTIVE", "PENDING_RENEWAL", "EXPIRED"];

export default function Policies() {
  const [status, setStatus] = useState<PolicyStatus | "">("");
  const [dialogPolicy, setDialogPolicy] = useState<Policy | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [assetsPolicy, setAssetsPolicy] = useState<Policy | null>(null);

  const policies = useQuery({ queryKey: ["policies"], queryFn: () => fetchPolicies() });

  const rows = useMemo(() => {
    const all = policies.data ?? [];
    return status ? all.filter((p) => p.status === status) : all;
  }, [policies.data, status]);

  const summary = useMemo(() => {
    const all = policies.data ?? [];
    const active = all.filter((p) => p.status === "ACTIVE");
    const pendingRenewal = all.filter((p) => p.status === "PENDING_RENEWAL").length;
    const totalCoverage = active.reduce((sum, p) => sum + p.total_limit, 0);
    const totalPremium = active.reduce((sum, p) => sum + p.annual_premium, 0);
    return { count: all.length, activeCount: active.length, pendingRenewal, totalCoverage, totalPremium };
  }, [policies.data]);

  const openCreate = () => {
    setDialogPolicy(null);
    setDialogOpen(true);
  };
  const openEdit = (policy: Policy) => {
    setDialogPolicy(policy);
    setDialogOpen(true);
  };

  if (policies.isLoading) {
    return (
      <Stack alignItems="center" sx={{ py: 8 }}>
        <CircularProgress />
      </Stack>
    );
  }

  return (
    <Stack spacing={3}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="h5" sx={{ fontWeight: 700 }}>
          ניהול פוליסות ביטוח
        </Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
          פוליסה חדשה
        </Button>
      </Stack>

      <Grid container spacing={2}>
        <Grid item xs={12} sm={6} md={3}>
          <Card variant="outlined" sx={{ height: "100%", borderTop: "4px solid #1e5b8a" }}>
            <CardContent>
              <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                <Stack spacing={0.5}>
                  <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                    פוליסות פעילות
                  </Typography>
                  <Typography variant="h5" sx={{ fontWeight: 800 }}>
                    {summary.activeCount} / {summary.count}
                  </Typography>
                </Stack>
                <ShieldIcon color="primary" fontSize="large" />
              </Stack>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card variant="outlined" sx={{ height: "100%", borderTop: "4px solid #e69413" }}>
            <CardContent>
              <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                <Stack spacing={0.5}>
                  <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                    ממתינות לחידוש
                  </Typography>
                  <Typography variant="h5" sx={{ fontWeight: 800 }}>
                    {summary.pendingRenewal}
                  </Typography>
                </Stack>
                <WarningAmberIcon color="warning" fontSize="large" />
              </Stack>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card variant="outlined" sx={{ height: "100%", borderTop: "4px solid #2e7d32" }}>
            <CardContent>
              <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                <Stack spacing={0.5}>
                  <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                    סה"כ תקרת כיסוי (פעילות)
                  </Typography>
                  <Typography variant="h5" sx={{ fontWeight: 800 }}>
                    {formatIlsCompact(summary.totalCoverage)}
                  </Typography>
                </Stack>
                <SecurityIcon color="success" fontSize="large" />
              </Stack>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card variant="outlined" sx={{ height: "100%", borderTop: "4px solid #c62828" }}>
            <CardContent>
              <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                <Stack spacing={0.5}>
                  <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                    סה"כ פרמיה שנתית (פעילות)
                  </Typography>
                  <Typography variant="h5" sx={{ fontWeight: 800 }}>
                    {formatIlsCompact(summary.totalPremium)}
                  </Typography>
                </Stack>
                <PaidIcon color="error" fontSize="large" />
              </Stack>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Card variant="outlined">
        <CardContent>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              רשימת פוליסות ({rows.length})
            </Typography>
            <TextField
              select
              size="small"
              label="סטטוס"
              value={status}
              onChange={(e) => setStatus(e.target.value as PolicyStatus | "")}
              sx={{ minWidth: 180 }}
            >
              <MenuItem value="">הכל</MenuItem>
              {STATUS_OPTIONS.map((s) => (
                <MenuItem key={s} value={s}>
                  {POLICY_STATUS_LABELS[s]}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
          <PolicyTable rows={rows} onEdit={openEdit} onManageAssets={setAssetsPolicy} />
        </CardContent>
      </Card>

      <PolicyDialog open={dialogOpen} policy={dialogPolicy} onClose={() => setDialogOpen(false)} />
      <PolicyAssetsDialog open={!!assetsPolicy} policy={assetsPolicy} onClose={() => setAssetsPolicy(null)} />
    </Stack>
  );
}
