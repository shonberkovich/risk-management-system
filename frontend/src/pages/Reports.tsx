import AccountBalanceIcon from "@mui/icons-material/AccountBalance";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import PictureAsPdfIcon from "@mui/icons-material/PictureAsPdf";
import SendIcon from "@mui/icons-material/Send";
import SummarizeIcon from "@mui/icons-material/Summarize";
import TrendingDownIcon from "@mui/icons-material/TrendingDown";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import Alert from "@mui/material/Alert";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
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
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";

import {
  askQuestion,
  fetchClaims,
  fetchExposureByRegion,
  fetchKpis,
  fetchRegulatoryReport,
  streamExecutiveSummary,
} from "../api/client";
import ExecutiveReportPrintable from "../components/ExecutiveReportPrintable";
import KpiCard from "../components/KpiCard";
import { exportElementToPdf } from "../exportPdf";
import { formatIls } from "../format";

const SUGGESTED_QUESTIONS = [
  "כמה תביעות אושרו ועדיין לא שולמו?",
  "אילו נכסים בסיכון הצפה גבוה בלי מתזים?",
  "מה יחס הנזקים הכולל וה-TIV?",
  "אילו משימות הפחתת סיכון באיחור?",
];

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
}

const SOLVENCY_STATUS_COLORS: Record<string, "success" | "warning" | "error"> = {
  "יעד הון מולא": "success",
  "מעל המינימום הרגולטורי, מתחת ליעד": "warning",
  "הפרת דרישת הון (Breach)": "error",
};

export default function Reports() {
  // --- Regulatory report (Capital Market Authority / Solvency II style) ---
  const regulatoryReport = useQuery({ queryKey: ["financials", "regulatory-report"], queryFn: fetchRegulatoryReport });

  // --- Executive summary streaming ---
  const [summaryText, setSummaryText] = useState("");
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  // --- PDF export ---
  const kpis = useQuery({ queryKey: ["kpis"], queryFn: fetchKpis });
  const claims = useQuery({ queryKey: ["claims"], queryFn: () => fetchClaims() });
  const exposureByRegion = useQuery({ queryKey: ["exposure-by-region"], queryFn: fetchExposureByRegion });
  const printableRef = useRef<HTMLDivElement>(null);
  const [pdfExporting, setPdfExporting] = useState(false);

  async function exportPdf() {
    if (!printableRef.current || !kpis.data || !claims.data || !exposureByRegion.data) return;
    setPdfExporting(true);
    try {
      const dateStr = new Date().toISOString().slice(0, 10);
      await exportElementToPdf(printableRef.current, `executive-report-${dateStr}.pdf`);
    } finally {
      setPdfExporting(false);
    }
  }

  async function generateSummary() {
    setSummaryLoading(true);
    setSummaryError(null);
    setSummaryText("");
    try {
      const body = await streamExecutiveSummary();
      const reader = body.getReader();
      const decoder = new TextDecoder("utf-8");
      let done = false;
      while (!done) {
        const { value, done: streamDone } = await reader.read();
        done = streamDone;
        if (value) {
          setSummaryText((prev) => prev + decoder.decode(value, { stream: true }));
        }
      }
    } catch (e) {
      setSummaryError(e instanceof Error ? e.message : "שגיאה לא ידועה");
    } finally {
      setSummaryLoading(false);
    }
  }

  // --- Data Q&A chat ---
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  async function sendQuestion(question: string) {
    if (!question.trim() || chatLoading) return;
    setMessages((prev) => [...prev, { role: "user", text: question }]);
    setInput("");
    setChatLoading(true);
    try {
      const { answer } = await askQuestion(question);
      setMessages((prev) => [...prev, { role: "assistant", text: answer }]);
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", text: "שגיאה בקבלת תשובה מה-AI. ודא שהוגדר מפתח API." }]);
    } finally {
      setChatLoading(false);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    }
  }

  return (
    <Stack spacing={3}>
      <Typography variant="h5" sx={{ fontWeight: 700 }}>
        דוחות ותובנות AI
      </Typography>

      <Grid container spacing={3}>
        <Grid item xs={12} md={6}>
          <Card variant="outlined" sx={{ height: "100%" }}>
            <CardContent>
              <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <SummarizeIcon color="primary" />
                  <Typography variant="h6" sx={{ fontWeight: 700 }}>
                    דוח הנהלה (Executive Summary)
                  </Typography>
                </Stack>
                <Stack direction="row" spacing={1}>
                  <Button
                    variant="contained"
                    startIcon={summaryLoading ? <CircularProgress size={16} color="inherit" /> : <AutoAwesomeIcon />}
                    onClick={generateSummary}
                    disabled={summaryLoading}
                  >
                    {summaryLoading ? "מפיק דוח..." : "הפק דוח"}
                  </Button>
                  <Button
                    variant="outlined"
                    startIcon={pdfExporting ? <CircularProgress size={16} /> : <PictureAsPdfIcon />}
                    onClick={exportPdf}
                    disabled={pdfExporting || !kpis.data || !claims.data || !exposureByRegion.data}
                  >
                    ייצוא ל-PDF
                  </Button>
                </Stack>
              </Stack>

              {summaryError && <Alert severity="error" sx={{ mb: 2 }}>{summaryError}</Alert>}

              {summaryText ? (
                <Typography component="pre" variant="body2" sx={{ whiteSpace: "pre-wrap", fontFamily: "inherit", lineHeight: 1.8 }}>
                  {summaryText}
                </Typography>
              ) : (
                !summaryLoading && (
                  <Typography color="text.secondary" variant="body2">
                    לחץ על "הפק דוח" כדי לקבל תקציר מנהלים אוטומטי המבוסס על נתוני המערכת בזמן אמת.
                  </Typography>
                )
              )}
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={6}>
          <Card variant="outlined" sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
            <CardContent sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
                <AutoAwesomeIcon color="primary" />
                <Typography variant="h6" sx={{ fontWeight: 700 }}>
                  שאל את הנתונים
                </Typography>
              </Stack>

              <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mb: 2 }}>
                {SUGGESTED_QUESTIONS.map((q) => (
                  <Chip key={q} label={q} size="small" onClick={() => sendQuestion(q)} variant="outlined" />
                ))}
              </Stack>

              <Box sx={{ flexGrow: 1, minHeight: 200, maxHeight: 340, overflowY: "auto", mb: 2 }}>
                <Stack spacing={1.5}>
                  {messages.map((m, idx) => (
                    <Stack
                      key={idx}
                      direction="row"
                      spacing={1}
                      justifyContent={m.role === "user" ? "flex-end" : "flex-start"}
                    >
                      {m.role === "assistant" && (
                        <Avatar sx={{ width: 28, height: 28, bgcolor: "primary.main" }}>
                          <AutoAwesomeIcon fontSize="small" />
                        </Avatar>
                      )}
                      <Box
                        sx={{
                          bgcolor: m.role === "user" ? "primary.main" : "grey.100",
                          color: m.role === "user" ? "white" : "text.primary",
                          borderRadius: 2,
                          px: 1.5,
                          py: 1,
                          maxWidth: "80%",
                        }}
                      >
                        <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
                          {m.text}
                        </Typography>
                      </Box>
                    </Stack>
                  ))}
                  {chatLoading && <CircularProgress size={20} />}
                  <div ref={bottomRef} />
                </Stack>
              </Box>

              <Stack direction="row" spacing={1}>
                <TextField
                  fullWidth
                  size="small"
                  placeholder="שאל שאלה על הנתונים..."
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && sendQuestion(input)}
                />
                <Button variant="contained" onClick={() => sendQuestion(input)} disabled={chatLoading}>
                  <SendIcon fontSize="small" />
                </Button>
              </Stack>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Card variant="outlined">
        <CardContent>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
            <AccountBalanceIcon color="primary" />
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              דוח רגולטורי — רשות שוק ההון / Solvency II
            </Typography>
          </Stack>

          {regulatoryReport.isLoading && (
            <Stack alignItems="center" sx={{ py: 4 }}>
              <CircularProgress size={28} />
            </Stack>
          )}

          {regulatoryReport.isError && (
            <Alert severity="error">
              שגיאה בטעינת הדוח הרגולטורי. ודא שיש לך הרשאה לצפות בו (מנהל סיכונים / CFO / מנהל מערכת).
            </Alert>
          )}

          {regulatoryReport.data && (
            <Stack spacing={2}>
              <Typography variant="caption" color="text.secondary">
                שנת דיווח: {regulatoryReport.data.reporting_year ?? "-"} · דרישת הון (SCR) מבוססת סימולציית
                מונטה-קרלו ברמת ביטחון {regulatoryReport.data.capital_adequacy.scr_confidence_level} (
                {regulatoryReport.data.capital_adequacy.scr_simulation_iterations.toLocaleString("he-IL")} הדמיות) —
                קירוב הוראתי, ראו services/financials.py לפירוט ההנחות.
              </Typography>

              <Grid container spacing={2}>
                <Grid item xs={12} sm={6} md={3}>
                  <KpiCard
                    label="יחס כושר פירעון (Solvency Ratio)"
                    value={
                      regulatoryReport.data.capital_adequacy.solvency_ratio_percent !== null
                        ? `${regulatoryReport.data.capital_adequacy.solvency_ratio_percent}%`
                        : "אין נתונים"
                    }
                    subtext={regulatoryReport.data.capital_adequacy.status}
                    icon={<AccountBalanceIcon color="primary" fontSize="large" />}
                    accentColor="#1e5b8a"
                  />
                </Grid>
                <Grid item xs={12} sm={6} md={3}>
                  <KpiCard
                    label="הון עצמי זמין (Own Funds)"
                    value={
                      regulatoryReport.data.capital_adequacy.eligible_own_funds !== null
                        ? formatIls(regulatoryReport.data.capital_adequacy.eligible_own_funds)
                        : "אין נתונים"
                    }
                    icon={<TrendingUpIcon color="success" fontSize="large" />}
                    accentColor="#2e7d32"
                  />
                </Grid>
                <Grid item xs={12} sm={6} md={3}>
                  <KpiCard
                    label="דרישת הון (SCR)"
                    value={formatIls(regulatoryReport.data.capital_adequacy.solvency_capital_requirement)}
                    icon={<TrendingDownIcon color="warning" fontSize="large" />}
                    accentColor="#c0521f"
                  />
                </Grid>
                <Grid item xs={12} sm={6} md={3}>
                  <KpiCard
                    label="ריכוזיות חשיפה (MFL/TIV)"
                    value={
                      regulatoryReport.data.concentration_disclosure.concentration_percent !== null
                        ? `${regulatoryReport.data.concentration_disclosure.concentration_percent}%`
                        : "אין נתונים"
                    }
                    subtext={`MFL: ${formatIls(regulatoryReport.data.concentration_disclosure.maximum_foreseeable_loss)}`}
                    icon={<AccountBalanceIcon color="action" fontSize="large" />}
                    accentColor="#5c6bc0"
                  />
                </Grid>
              </Grid>

              <Chip
                label={`סטטוס כושר פירעון: ${regulatoryReport.data.capital_adequacy.status}`}
                color={SOLVENCY_STATUS_COLORS[regulatoryReport.data.capital_adequacy.status] ?? "default"}
                sx={{ alignSelf: "flex-start" }}
              />

              {regulatoryReport.data.multi_year_trends.length > 0 ? (
                <Box sx={{ overflowX: "auto" }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>שנה</TableCell>
                        <TableCell align="left">הכנסות</TableCell>
                        <TableCell align="left">רווח נקי</TableCell>
                        <TableCell align="left">הוצאות ביטוח</TableCell>
                        <TableCell align="left">נזקים ששולמו</TableCell>
                        <TableCell align="left">יחס נזקים (Loss Ratio)</TableCell>
                        <TableCell align="left">הוצאת ביטוח/הכנסות</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {regulatoryReport.data.multi_year_trends.map((t) => (
                        <TableRow key={t.year}>
                          <TableCell>{t.year}</TableCell>
                          <TableCell align="left">{formatIls(t.revenue)}</TableCell>
                          <TableCell align="left">{formatIls(t.net_income)}</TableCell>
                          <TableCell align="left">{formatIls(t.insurance_expense)}</TableCell>
                          <TableCell align="left">{formatIls(t.claim_losses_paid)}</TableCell>
                          <TableCell align="left">{t.loss_ratio !== null ? `${(t.loss_ratio * 100).toFixed(1)}%` : "-"}</TableCell>
                          <TableCell align="left">
                            {t.insurance_expense_to_revenue !== null ? `${(t.insurance_expense_to_revenue * 100).toFixed(1)}%` : "-"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Box>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  אין נתוני דוחות כספיים רב-שנתיים במערכת.
                </Typography>
              )}

              {regulatoryReport.data.trend_summary && (
                <Typography variant="caption" color="text.secondary">
                  מגמה {regulatoryReport.data.trend_summary.years_covered[0]}–
                  {regulatoryReport.data.trend_summary.years_covered[1]}: קצב צמיחה שנתי ממוצע (CAGR) של הכנסות{" "}
                  {regulatoryReport.data.trend_summary.revenue_cagr_pct ?? "-"}%
                  {regulatoryReport.data.trend_summary.claim_losses_cagr_pct !== null &&
                    ` לעומת ${regulatoryReport.data.trend_summary.claim_losses_cagr_pct}% בנזקים ששולמו`}
                  {regulatoryReport.data.trend_summary.cost_of_risk_outpacing_revenue
                    ? " — עלות הסיכון גדלה מהר יותר מההכנסות."
                    : " — עלות הסיכון אינה חורגת מקצב צמיחת ההכנסות."}
                </Typography>
              )}
            </Stack>
          )}
        </CardContent>
      </Card>

      {/* Off-screen (not display:none — html2canvas needs a laid-out element to capture)
          printable layout for the PDF export button above. */}
      {kpis.data && claims.data && exposureByRegion.data && (
        <Box sx={{ position: "fixed", top: 0, left: "-9999px" }}>
          <div ref={printableRef}>
            <ExecutiveReportPrintable
              kpis={kpis.data}
              claims={claims.data}
              regions={exposureByRegion.data}
              summaryText={summaryText || undefined}
            />
          </div>
        </Box>
      )}
    </Stack>
  );
}
