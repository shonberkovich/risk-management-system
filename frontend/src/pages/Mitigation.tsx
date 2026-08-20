import AddIcon from "@mui/icons-material/Add";
import AssignmentLateIcon from "@mui/icons-material/AssignmentLate";
import PaidIcon from "@mui/icons-material/Paid";
import PictureAsPdfIcon from "@mui/icons-material/PictureAsPdf";
import SavingsIcon from "@mui/icons-material/Savings";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CircularProgress from "@mui/material/CircularProgress";
import Grid from "@mui/material/Grid";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";

import {
  fetchMitigationRoiSummary,
  fetchMitigationTasks,
  fetchProperties,
  fetchUsers,
  updateMitigationTask,
  type MitigationStatus,
  type MitigationTask,
} from "../api/client";
import KpiCard from "../components/KpiCard";
import MitigationReportPrintable from "../components/MitigationReportPrintable";
import MitigationRoiDialog from "../components/MitigationRoiDialog";
import MitigationTable, { type MitigationRow } from "../components/MitigationTable";
import MitigationTaskDialog from "../components/MitigationTaskDialog";
import { exportElementToPdf } from "../exportPdf";
import { MITIGATION_STATUS_LABELS, formatIlsCompact } from "../format";

const STATUS_OPTIONS: MitigationStatus[] = ["OPEN", "IN_PROGRESS", "COMPLETED", "OVERDUE"];

const STATUS_ORDER: Record<MitigationStatus, number> = {
  OVERDUE: 0,
  IN_PROGRESS: 1,
  OPEN: 2,
  COMPLETED: 3,
};

export default function Mitigation() {
  const [status, setStatus] = useState<MitigationStatus | "">("");
  const [dialogTask, setDialogTask] = useState<MitigationTask | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [roiTaskId, setRoiTaskId] = useState<number | null>(null);

  const queryClient = useQueryClient();
  const tasks = useQuery({ queryKey: ["mitigation-tasks"], queryFn: fetchMitigationTasks });
  const properties = useQuery({ queryKey: ["properties"], queryFn: fetchProperties });
  const users = useQuery({ queryKey: ["users"], queryFn: fetchUsers });
  const roiSummary = useQuery({ queryKey: ["mitigation-tasks", "roi-summary"], queryFn: fetchMitigationRoiSummary });

  const printableRef = useRef<HTMLDivElement>(null);
  const [pdfExporting, setPdfExporting] = useState(false);

  async function exportPdf() {
    if (!printableRef.current) return;
    setPdfExporting(true);
    try {
      const dateStr = new Date().toISOString().slice(0, 10);
      await exportElementToPdf(printableRef.current, `mitigation-report-${dateStr}.pdf`);
    } finally {
      setPdfExporting(false);
    }
  }

  const markComplete = useMutation({
    mutationFn: (taskId: number) => updateMitigationTask(taskId, { status: "COMPLETED" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["mitigation-tasks"] }),
  });

  const rows: MitigationRow[] = useMemo(() => {
    const propertyNames = new Map((properties.data ?? []).map((p) => [p.property_id, p.name]));
    const userNames = new Map((users.data ?? []).map((u) => [u.user_id, u.full_name]));
    const all = (tasks.data ?? []).map((t) => ({
      ...t,
      property_name: propertyNames.get(t.property_id) ?? `נכס #${t.property_id}`,
      assigned_to_name: t.assigned_to_user_id !== null ? userNames.get(t.assigned_to_user_id) ?? `משתמש #${t.assigned_to_user_id}` : null,
    }));
    const filtered = status ? all.filter((t) => t.status === status) : all;
    return [...filtered].sort((a, b) => {
      const orderDiff = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
      if (orderDiff !== 0) return orderDiff;
      return a.due_date.localeCompare(b.due_date);
    });
  }, [tasks.data, properties.data, users.data, status]);

  const summary = useMemo(() => {
    const all = tasks.data ?? [];
    const openOrOverdue = all.filter((t) => t.status === "OPEN" || t.status === "OVERDUE");
    const overdueCount = all.filter((t) => t.status === "OVERDUE").length;
    const activeCost = all
      .filter((t) => t.status !== "COMPLETED")
      .reduce((sum, t) => sum + t.cost_estimate, 0);
    const totalSavings = all.reduce((sum, t) => sum + t.expected_annual_savings, 0);
    const roiValues = all.map((t) => t.roi_percent).filter((r): r is number => r !== null);
    const avgRoi = roiValues.length ? roiValues.reduce((a, b) => a + b, 0) / roiValues.length : null;
    return { openOrOverdueCount: openOrOverdue.length, overdueCount, activeCost, totalSavings, avgRoi };
  }, [tasks.data]);

  const roiByTaskId = useMemo(
    () => new Map((roiSummary.data ?? []).map((r) => [r.task_id, r])),
    [roiSummary.data],
  );

  const openCreate = () => {
    setDialogTask(null);
    setDialogOpen(true);
  };
  const openEdit = (task: MitigationTask) => {
    setDialogTask(task);
    setDialogOpen(true);
  };

  const loading = tasks.isLoading || properties.isLoading;

  if (loading) {
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
          משימות הפחתת סיכון
        </Typography>
        <Stack direction="row" spacing={1}>
          <Button
            variant="outlined"
            startIcon={pdfExporting ? <CircularProgress size={16} /> : <PictureAsPdfIcon />}
            onClick={exportPdf}
            disabled={pdfExporting || rows.length === 0}
          >
            ייצוא ל-PDF
          </Button>
          <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
            משימה חדשה
          </Button>
        </Stack>
      </Stack>

      <Grid container spacing={2}>
        <Grid item xs={12} sm={6} md={3}>
          <KpiCard
            label="משימות פתוחות / באיחור"
            value={`${summary.openOrOverdueCount}`}
            subtext={summary.overdueCount > 0 ? `${summary.overdueCount} באיחור` : undefined}
            trend={summary.overdueCount > 0 ? "up" : undefined}
            icon={<AssignmentLateIcon color="warning" fontSize="large" />}
            accentColor="#c0521f"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <KpiCard
            label="עלות משוערת כוללת (פתוחות)"
            value={formatIlsCompact(summary.activeCost)}
            icon={<PaidIcon color="error" fontSize="large" />}
            accentColor="#c62828"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <KpiCard
            label="חיסכון שנתי צפוי כולל"
            value={formatIlsCompact(summary.totalSavings)}
            icon={<SavingsIcon color="success" fontSize="large" />}
            accentColor="#2e7d32"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <KpiCard
            label="ROI ממוצע"
            value={summary.avgRoi !== null ? `${summary.avgRoi.toFixed(1)}%` : "-"}
            icon={<TrendingUpIcon color="primary" fontSize="large" />}
            accentColor="#1e5b8a"
          />
        </Grid>
      </Grid>

      <Card variant="outlined">
        <CardContent>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              רשימת משימות ({rows.length})
            </Typography>
            <TextField
              select
              size="small"
              label="סטטוס"
              value={status}
              onChange={(e) => setStatus(e.target.value as MitigationStatus | "")}
              sx={{ minWidth: 180 }}
            >
              <MenuItem value="">הכל</MenuItem>
              {STATUS_OPTIONS.map((s) => (
                <MenuItem key={s} value={s}>
                  {MITIGATION_STATUS_LABELS[s]}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
          <MitigationTable
            rows={rows}
            onEdit={openEdit}
            onShowRoi={(t) => setRoiTaskId(t.task_id)}
            onMarkComplete={(t) => markComplete.mutate(t.task_id)}
          />
        </CardContent>
      </Card>

      <MitigationTaskDialog open={dialogOpen} task={dialogTask} onClose={() => setDialogOpen(false)} />
      <MitigationRoiDialog open={roiTaskId !== null} taskId={roiTaskId} onClose={() => setRoiTaskId(null)} />

      {/* Off-screen (not display:none — html2canvas needs a laid-out element to capture)
          printable layout for the PDF export button above. Reuses `rows` — the same
          status-filtered, property/assignee-enriched list the on-screen table shows —
          so the exported PDF always matches what's currently visible on screen. */}
      {rows.length > 0 && (
        <Box sx={{ position: "fixed", top: 0, left: "-9999px" }}>
          <div ref={printableRef}>
            <MitigationReportPrintable rows={rows} roiByTaskId={roiByTaskId} summary={summary} />
          </div>
        </Box>
      )}
    </Stack>
  );
}
