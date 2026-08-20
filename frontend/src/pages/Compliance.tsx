import AssignmentIndIcon from "@mui/icons-material/AssignmentInd";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import FactCheckIcon from "@mui/icons-material/FactCheck";
import GppMaybeIcon from "@mui/icons-material/GppMaybe";
import VerifiedUserIcon from "@mui/icons-material/VerifiedUser";
import Accordion from "@mui/material/Accordion";
import AccordionDetails from "@mui/material/AccordionDetails";
import AccordionSummary from "@mui/material/AccordionSummary";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Grid from "@mui/material/Grid";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import { useQuery } from "@tanstack/react-query";

import { fetchIso31000Report, type ComplianceFrameworkSection, type ComplianceRiskLevel } from "../api/client";
import KpiCard from "../components/KpiCard";
import { MITIGATION_STATUS_LABELS, formatDate, formatIls } from "../format";

const RISK_LEVEL_COLORS: Record<ComplianceRiskLevel, "default" | "success" | "warning" | "error"> = {
  "לא הוערך": "default",
  נמוך: "success",
  בינוני: "warning",
  גבוה: "error",
  קריטי: "error",
};

const SECTION_STATUS_COLORS: Record<ComplianceFrameworkSection["status"], "success" | "warning" | "error"> = {
  מיושם: "success",
  "מיושם חלקית": "warning",
  "לא מיושם": "error",
};

const SECTION_STATUS_ICON: Record<ComplianceFrameworkSection["status"], typeof CheckCircleIcon> = {
  מיושם: CheckCircleIcon,
  "מיושם חלקית": GppMaybeIcon,
  "לא מיושם": GppMaybeIcon,
};

export default function Compliance() {
  const report = useQuery({ queryKey: ["compliance", "iso31000"], queryFn: fetchIso31000Report });

  if (report.isLoading) {
    return (
      <Stack alignItems="center" sx={{ py: 8 }}>
        <CircularProgress />
      </Stack>
    );
  }

  if (report.isError || !report.data) {
    return (
      <Alert severity="error">
        שגיאה בטעינת דוח התאימות. ודא שיש לך הרשאה לצפות בדוח (מנהל סיכונים / קצין סיכונים / CFO / מנהל מערכת).
      </Alert>
    );
  }

  const { summary, framework_sections, entries, generated_at, standard } = report.data;

  return (
    <Stack spacing={3}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap">
        <Stack direction="row" spacing={1} alignItems="center">
          <VerifiedUserIcon color="primary" fontSize="large" />
          <Box>
            <Typography variant="h5" sx={{ fontWeight: 700 }}>
              דוח תאימות {standard}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              הופק ב-{formatDate(generated_at)} · מיפוי סיכונים, בעלי אחריות וסטטוס בקרות
            </Typography>
          </Box>
        </Stack>
      </Stack>

      <Grid container spacing={2}>
        <Grid item xs={12} sm={6} md={3}>
          <KpiCard
            label="כיסוי סקרי סיכונים"
            value={`${summary.risk_assessment_coverage_percent}%`}
            subtext={`${summary.properties_with_risk_assessment}/${summary.total_properties} נכסים`}
            icon={<FactCheckIcon color="primary" fontSize="large" />}
            accentColor="#1e5b8a"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <KpiCard
            label="נכסים בסיכון גבוה/קריטי"
            value={`${summary.high_or_critical_risk_count}`}
            subtext={summary.properties_without_owner_count > 0 ? `${summary.properties_without_owner_count} ללא בעל אחריות` : undefined}
            trend={summary.properties_without_owner_count > 0 ? "up" : undefined}
            icon={<GppMaybeIcon color="error" fontSize="large" />}
            accentColor="#c62828"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <KpiCard
            label="שיעור השלמת בקרות"
            value={`${summary.control_completion_percent}%`}
            subtext={`${summary.completed_controls_count}/${summary.total_controls} בקרות`}
            icon={<CheckCircleIcon color="success" fontSize="large" />}
            accentColor="#2e7d32"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <KpiCard
            label="בקרות באיחור"
            value={`${summary.overdue_controls_count}`}
            icon={<AssignmentIndIcon color="warning" fontSize="large" />}
            accentColor="#c0521f"
          />
        </Grid>
      </Grid>

      <Card variant="outlined">
        <CardContent>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 2 }}>
            מיפוי לתהליך ניהול הסיכונים (ISO 31000 סעיף 6)
          </Typography>
          <Stack spacing={1.5}>
            {framework_sections.map((section) => {
              const Icon = SECTION_STATUS_ICON[section.status];
              return (
                <Stack
                  key={section.clause}
                  direction={{ xs: "column", sm: "row" }}
                  spacing={1.5}
                  alignItems={{ sm: "center" }}
                  sx={{ p: 1.5, borderRadius: 1, bgcolor: "grey.50" }}
                >
                  <Icon color={SECTION_STATUS_COLORS[section.status]} />
                  <Box sx={{ flexGrow: 1 }}>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>
                        {section.clause} — {section.title}
                      </Typography>
                      <Chip label={section.status} size="small" color={SECTION_STATUS_COLORS[section.status]} />
                    </Stack>
                    <Typography variant="caption" color="text.secondary">
                      {section.description}
                    </Typography>
                  </Box>
                  <Box sx={{ textAlign: { xs: "start", sm: "end" }, minWidth: 180 }}>
                    <Typography variant="caption" color="text.secondary" display="block">
                      {section.metric_label}
                    </Typography>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>
                      {section.metric_value}
                    </Typography>
                  </Box>
                </Stack>
              );
            })}
          </Stack>
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardContent>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 2 }}>
            מיפוי סיכונים לפי נכס ({entries.length})
          </Typography>
          <Stack spacing={1}>
            {entries.map((entry) => (
              <Accordion key={entry.property_id} disableGutters variant="outlined">
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  <Stack
                    direction={{ xs: "column", sm: "row" }}
                    spacing={1.5}
                    alignItems={{ sm: "center" }}
                    sx={{ width: "100%", pe: 2 }}
                  >
                    <Chip
                      label={entry.risk_level}
                      size="small"
                      color={RISK_LEVEL_COLORS[entry.risk_level]}
                      sx={{ minWidth: 72 }}
                    />
                    <Box sx={{ flexGrow: 1 }}>
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>
                        {entry.property_code} · {entry.name}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {entry.region} · בעל אחריות: {entry.risk_owner_name ?? "לא הוקצה"}
                      </Typography>
                    </Box>
                    <Stack direction="row" spacing={1}>
                      <Typography variant="caption" color="text.secondary">
                        ציון סיכון: {entry.risk_score ?? "-"}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        בקרות: {entry.completed_controls_count}/{entry.controls.length}
                        {entry.overdue_controls_count > 0 ? ` (${entry.overdue_controls_count} באיחור)` : ""}
                      </Typography>
                    </Stack>
                  </Stack>
                </AccordionSummary>
                <AccordionDetails>
                  <Grid container spacing={2} sx={{ mb: entry.controls.length ? 2 : 0 }}>
                    <Grid item xs={6} sm={3}>
                      <Typography variant="caption" color="text.secondary" display="block">
                        הצפה / שריפה / רעידת אדמה
                      </Typography>
                      <Typography variant="body2">
                        {entry.has_risk_assessment
                          ? `${entry.flood_risk_score} / ${entry.fire_risk_score} / ${entry.earthquake_risk_score}`
                          : "אין סקר סיכונים"}
                      </Typography>
                    </Grid>
                    <Grid item xs={6} sm={3}>
                      <Typography variant="caption" color="text.secondary" display="block">
                        עדכון סקר אחרון
                      </Typography>
                      <Typography variant="body2">{entry.last_reviewed ? formatDate(entry.last_reviewed) : "-"}</Typography>
                    </Grid>
                    <Grid item xs={6} sm={3}>
                      <Typography variant="caption" color="text.secondary" display="block">
                        MFL
                      </Typography>
                      <Typography variant="body2">{entry.mfl_amount !== null ? formatIls(entry.mfl_amount) : "-"}</Typography>
                    </Grid>
                  </Grid>

                  {entry.controls.length === 0 ? (
                    <Typography variant="caption" color="text.secondary">
                      לא הוגדרו משימות הפחתת סיכון (בקרות) עבור נכס זה.
                    </Typography>
                  ) : (
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>בקרה</TableCell>
                          <TableCell>סטטוס</TableCell>
                          <TableCell>יעד</TableCell>
                          <TableCell>אחראי</TableCell>
                          <TableCell align="left">ROI</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {entry.controls.map((control) => (
                          <TableRow key={control.task_id}>
                            <TableCell>{control.title}</TableCell>
                            <TableCell>
                              <Chip
                                label={MITIGATION_STATUS_LABELS[control.status] ?? control.status}
                                size="small"
                                color={
                                  control.status === "COMPLETED"
                                    ? "success"
                                    : control.status === "OVERDUE"
                                      ? "error"
                                      : "default"
                                }
                              />
                            </TableCell>
                            <TableCell>{formatDate(control.due_date)}</TableCell>
                            <TableCell>{control.owner_name ?? "לא הוקצה"}</TableCell>
                            <TableCell align="left">{control.roi_percent !== null ? `${control.roi_percent}%` : "-"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </AccordionDetails>
              </Accordion>
            ))}
          </Stack>
        </CardContent>
      </Card>
    </Stack>
  );
}
