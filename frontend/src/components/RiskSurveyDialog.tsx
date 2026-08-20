import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import Grid from "@mui/material/Grid";
import Slider from "@mui/material/Slider";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { createRiskProfile, updateRiskProfile, type RiskProfile } from "../api/client";

const SCORE_MARKS = [1, 2, 3, 4, 5].map((v) => ({ value: v, label: String(v) }));

const emptyForm = {
  survey_date: new Date().toISOString().slice(0, 10),
  flood_risk_score: 3,
  fire_risk_score: 3,
  earthquake_risk_score: 3,
  mfl_amount: "",
  has_sprinklers: false,
  notes: "",
};

function ScoreSlider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <Stack spacing={0.5}>
      <Typography variant="body2">{label}</Typography>
      <Slider
        value={value}
        onChange={(_, v) => onChange(v as number)}
        min={1}
        max={5}
        step={1}
        marks={SCORE_MARKS}
        valueLabelDisplay="auto"
      />
    </Stack>
  );
}

/** Create/update the one risk survey a property can have (models.AssetRiskProfile is 1:1
 * with Property — see backend/app/routers/risk_profiles.py's module docstring: POST if none
 * exists yet, PUT to re-survey). TODO_SPEC.md §5, "מסך סקר סיכונים" — the risk-profile card
 * in PropertyDetail.tsx opens this dialog for both the initial survey and re-surveys. */
export default function RiskSurveyDialog({
  open,
  propertyId,
  existing,
  onClose,
}: {
  open: boolean;
  propertyId: number;
  existing: RiskProfile | null;
  onClose: () => void;
}) {
  const [form, setForm] = useState(emptyForm);
  const queryClient = useQueryClient();
  const isEdit = existing !== null;

  useEffect(() => {
    if (existing) {
      setForm({
        survey_date: existing.survey_date.slice(0, 10),
        flood_risk_score: existing.flood_risk_score,
        fire_risk_score: existing.fire_risk_score,
        earthquake_risk_score: existing.earthquake_risk_score,
        mfl_amount: String(existing.mfl_amount),
        has_sprinklers: existing.has_sprinklers,
        notes: existing.notes ?? "",
      });
    } else {
      setForm(emptyForm);
    }
  }, [existing, open]);

  const mutation = useMutation({
    mutationFn: () => {
      const payload = {
        survey_date: form.survey_date,
        flood_risk_score: form.flood_risk_score,
        fire_risk_score: form.fire_risk_score,
        earthquake_risk_score: form.earthquake_risk_score,
        mfl_amount: Number(form.mfl_amount) || 0,
        has_sprinklers: form.has_sprinklers,
        notes: form.notes.trim() || null,
      };
      return isEdit ? updateRiskProfile(propertyId, payload) : createRiskProfile(propertyId, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["property", propertyId] });
      queryClient.invalidateQueries({ queryKey: ["properties"] });
      onClose();
    },
  });

  const canSubmit = form.survey_date && form.mfl_amount !== "";

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{isEdit ? "עדכון סקר סיכונים" : "סקר סיכונים חדש"}</DialogTitle>
      <DialogContent>
        <Stack spacing={2.5} sx={{ mt: 1 }}>
          <TextField
            label="תאריך סקר"
            type="date"
            fullWidth
            InputLabelProps={{ shrink: true }}
            value={form.survey_date}
            onChange={(e) => setForm((f) => ({ ...f, survey_date: e.target.value }))}
          />

          <ScoreSlider
            label="ציון סיכון הצפה"
            value={form.flood_risk_score}
            onChange={(v) => setForm((f) => ({ ...f, flood_risk_score: v }))}
          />
          <ScoreSlider
            label="ציון סיכון שריפה"
            value={form.fire_risk_score}
            onChange={(v) => setForm((f) => ({ ...f, fire_risk_score: v }))}
          />
          <ScoreSlider
            label="ציון סיכון רעידת אדמה"
            value={form.earthquake_risk_score}
            onChange={(v) => setForm((f) => ({ ...f, earthquake_risk_score: v }))}
          />

          <Grid container spacing={2} alignItems="center">
            <Grid item xs={7}>
              <TextField
                label="MFL — אומדן נזק מרבי צפוי (₪)"
                type="number"
                fullWidth
                value={form.mfl_amount}
                onChange={(e) => setForm((f) => ({ ...f, mfl_amount: e.target.value }))}
              />
            </Grid>
            <Grid item xs={5}>
              <FormControlLabel
                control={
                  <Switch
                    checked={form.has_sprinklers}
                    onChange={(e) => setForm((f) => ({ ...f, has_sprinklers: e.target.checked }))}
                  />
                }
                label="קיימים מתזים"
              />
            </Grid>
          </Grid>

          <TextField
            label="הערות (אמצעי מיגון נוספים, נסיבות מיוחדות וכו')"
            fullWidth
            multiline
            minRows={2}
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          />

          {mutation.isError && <Alert severity="error">שמירת הסקר נכשלה.</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>ביטול</Button>
        <Button variant="contained" disabled={!canSubmit || mutation.isPending} onClick={() => mutation.mutate()}>
          שמירה
        </Button>
      </DialogActions>
    </Dialog>
  );
}
