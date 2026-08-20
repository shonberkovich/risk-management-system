import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import PictureAsPdfIcon from "@mui/icons-material/PictureAsPdf";
import SendIcon from "@mui/icons-material/Send";
import SummarizeIcon from "@mui/icons-material/Summarize";
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
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";

import { askQuestion, fetchClaims, fetchExposureByRegion, fetchKpis, streamExecutiveSummary } from "../api/client";
import ExecutiveReportPrintable from "../components/ExecutiveReportPrintable";
import { exportElementToPdf } from "../exportPdf";

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

export default function Reports() {
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
