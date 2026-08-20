import BalanceIcon from "@mui/icons-material/Balance";
import GridOnIcon from "@mui/icons-material/GridOn";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import Grid from "@mui/material/Grid";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { fetchProperties, fetchRetentionRecommendation, type Property } from "../api/client";
import { exportRetentionReportToExcel } from "../exportRetentionReport";
import { formatIls } from "../format";

/** "לספוג או לתבוע" — compares self-absorbing a loss out of pocket against filing an
 * insurance claim on the property's active policy, using the same cost model as
 * backend/app/services/retention.py (claim cost = deductible paid + expected future
 * premium surcharge on the recovered amount). Requires a property with an active
 * policy; the deductible/limits used are read from that policy automatically. */
export default function RetentionCalculator() {
  const properties = useQuery({ queryKey: ["properties"], queryFn: fetchProperties });
  const insuredProperties = useMemo(
    () => (properties.data ?? []).filter((p): p is Property & { active_policy: NonNullable<Property["active_policy"]> } => !!p.active_policy),
    [properties.data],
  );

  const [propertyId, setPropertyId] = useState<number | "">("");
  const selectedProperty = insuredProperties.find((p) => p.property_id === propertyId);

  const [estimatedLoss, setEstimatedLoss] = useState<number | "">("");
  const [runParams, setRunParams] = useState<{ policyId: number; propertyId: number; loss: number } | null>(null);

  const result = useQuery({
    queryKey: ["retention-recommendation", runParams],
    queryFn: () =>
      fetchRetentionRecommendation({
        policy_id: runParams!.policyId,
        property_id: runParams!.propertyId,
        estimated_loss: runParams!.loss,
      }),
    enabled: !!runParams,
  });

  function handlePropertyChange(value: number) {
    setPropertyId(value);
    setRunParams(null);
    const prop = insuredProperties.find((p) => p.property_id === value);
    // Pre-fill a sensible starting estimate from the property's surveyed MFL, if any.
    if (prop?.risk_profile) setEstimatedLoss(prop.risk_profile.mfl_amount);
  }

  function calculate() {
    if (!selectedProperty || !estimatedLoss || Number(estimatedLoss) <= 0) return;
    setRunParams({ policyId: selectedProperty.active_policy!.policy_id, propertyId: selectedProperty.property_id, loss: Number(estimatedLoss) });
  }

  const data = result.data;

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
          <BalanceIcon color="action" />
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            מחשבון "לספוג או לתבוע"
          </Typography>
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          עבור נזק משוער בנכס מבוטח, המחשבון משווה בין ספיגה עצמית מלאה לבין הגשת תביעה (השתתפות עצמית + תוספת פרמיה
          עתידית צפויה על הסכום שיוחזר מהמבטח) וממליץ על החלופה הזולה יותר. ראו <code>backend/app/services/retention.py</code>.
        </Typography>

        <Stack direction="row" spacing={2} flexWrap="wrap" alignItems="center">
          <TextField
            select
            size="small"
            label="נכס מבוטח"
            value={propertyId}
            onChange={(e) => handlePropertyChange(Number(e.target.value))}
            sx={{ minWidth: 240 }}
          >
            {insuredProperties.map((p) => (
              <MenuItem key={p.property_id} value={p.property_id}>
                {p.name}
              </MenuItem>
            ))}
          </TextField>

          <TextField
            size="small"
            type="number"
            label="נזק משוער (₪)"
            value={estimatedLoss}
            onChange={(e) => setEstimatedLoss(e.target.value === "" ? "" : Number(e.target.value))}
            inputProps={{ min: 1 }}
            sx={{ width: 180 }}
          />

          <Button
            variant="contained"
            startIcon={result.isFetching ? <CircularProgress size={16} color="inherit" /> : <BalanceIcon />}
            onClick={calculate}
            disabled={!selectedProperty || !estimatedLoss || Number(estimatedLoss) <= 0 || result.isFetching}
          >
            {result.isFetching ? "מחשב..." : "חשב המלצה"}
          </Button>
        </Stack>

        {properties.data && insuredProperties.length === 0 && (
          <Alert severity="info" sx={{ mt: 2 }}>
            אין נכסים עם פוליסה פעילה במערכת כרגע.
          </Alert>
        )}

        {result.isError && (
          <Alert severity="error" sx={{ mt: 2 }}>
            שגיאה בחישוב ההמלצה. ודא שנבחר נכס עם פוליסה פעילה וסכום נזק תקין.
          </Alert>
        )}

        {selectedProperty?.active_policy && (
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
            פוליסה: {selectedProperty.active_policy.policy_number} ({selectedProperty.active_policy.insurer_name})
          </Typography>
        )}

        {data && (
          <>
            <Divider sx={{ my: 2 }} />
            <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 2 }}>
              <Box>
                <Chip
                  label={data.recommendation === "ABSORB" ? "המלצה: לספוג את הנזק עצמונית" : "המלצה: להגיש תביעה"}
                  color={data.recommendation === "ABSORB" ? "primary" : "success"}
                  sx={{ fontWeight: 700 }}
                />
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  חיסכון צפוי בבחירה זו לעומת החלופה: {formatIls(data.estimated_savings)}
                </Typography>
              </Box>
              <Button
                variant="outlined"
                size="small"
                startIcon={<GridOnIcon />}
                onClick={() => selectedProperty && exportRetentionReportToExcel(selectedProperty, data)}
              >
                ייצוא ל-Excel
              </Button>
            </Stack>

            <Grid container spacing={2}>
              <Grid item xs={12} md={6}>
                <Card
                  variant="outlined"
                  sx={{ borderColor: data.recommendation === "ABSORB" ? "primary.main" : undefined, borderWidth: data.recommendation === "ABSORB" ? 2 : 1 }}
                >
                  <CardContent>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
                      ספיגה עצמית
                    </Typography>
                    <Stack spacing={0.5}>
                      <RowValue label="עלות כוללת" value={formatIls(data.absorb_total_cost)} strong />
                      <RowValue label="השפעה על פרמיה" value="ללא" />
                    </Stack>
                  </CardContent>
                </Card>
              </Grid>
              <Grid item xs={12} md={6}>
                <Card
                  variant="outlined"
                  sx={{ borderColor: data.recommendation === "CLAIM" ? "success.main" : undefined, borderWidth: data.recommendation === "CLAIM" ? 2 : 1 }}
                >
                  <CardContent>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
                      הגשת תביעה
                    </Typography>
                    <Stack spacing={0.5}>
                      <RowValue label="השתתפות עצמית" value={formatIls(data.deductible)} />
                      <RowValue label="סכום בר-החזר מהמבטח" value={formatIls(data.claim_recoverable_amount)} />
                      <RowValue label="תשלום מכיס (השתתפות בפועל)" value={formatIls(data.claim_out_of_pocket)} />
                      <RowValue label="תוספת פרמיה עתידית צפויה" value={formatIls(data.expected_premium_surcharge)} />
                      <Divider />
                      <RowValue label="עלות כוללת" value={formatIls(data.claim_total_cost)} strong />
                    </Stack>
                  </CardContent>
                </Card>
              </Grid>
            </Grid>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function RowValue({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <Stack direction="row" justifyContent="space-between">
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2" sx={{ fontWeight: strong ? 700 : 400 }}>
        {value}
      </Typography>
    </Stack>
  );
}
