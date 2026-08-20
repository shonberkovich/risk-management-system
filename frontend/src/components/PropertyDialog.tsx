import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Grid from "@mui/material/Grid";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { createProperty, fetchUsers, updateProperty, type AssetType, type Property } from "../api/client";
import { ASSET_TYPE_LABELS } from "../format";

const ASSET_TYPE_OPTIONS = Object.keys(ASSET_TYPE_LABELS) as AssetType[];

// Fixed to the three regions seed.py provisions (Regions table has no CRUD API of its
// own — see backend/app/seed.py's region_id_by_name) — a free-text region field on
// Property exists alongside region_id, but keeping the picker to these three matches
// every property already in the system and avoids inventing untracked region_ids.
const REGION_OPTIONS: { name: string; region_id: number }[] = [
  { name: "מרכז", region_id: 1 },
  { name: "צפון", region_id: 2 },
  { name: "דרום", region_id: 3 },
];

const emptyForm = {
  property_code: "",
  name: "",
  address: "",
  region: REGION_OPTIONS[0].name,
  latitude: "",
  longitude: "",
  asset_type: "OFFICE_BUILDING" as AssetType,
  replacement_value: "",
  book_value: "",
  primary_manager_id: "" as number | "",
};

export default function PropertyDialog({
  open,
  property,
  onClose,
}: {
  open: boolean;
  property: Property | null;
  onClose: () => void;
}) {
  const [form, setForm] = useState(emptyForm);
  const queryClient = useQueryClient();
  const isEdit = property !== null;

  const users = useQuery({ queryKey: ["users"], queryFn: fetchUsers });

  useEffect(() => {
    if (property) {
      setForm({
        property_code: property.property_code,
        name: property.name,
        address: property.address,
        region: property.region,
        latitude: String(property.latitude),
        longitude: String(property.longitude),
        asset_type: property.asset_type,
        replacement_value: String(property.replacement_value),
        book_value: String(property.book_value),
        primary_manager_id: "", // manager_name only (no id) comes back on Property; leave
        // untouched unless the user actively picks someone, so saving doesn't accidentally
        // clear an existing assignment (empty string is omitted from the PATCH payload below).
      });
    } else {
      setForm(emptyForm);
    }
  }, [property, open]);

  const mutation = useMutation({
    mutationFn: () => {
      const regionId = REGION_OPTIONS.find((r) => r.name === form.region)?.region_id ?? null;
      const shared = {
        property_code: form.property_code.trim(),
        name: form.name.trim(),
        address: form.address.trim(),
        region: form.region,
        region_id: regionId,
        latitude: Number(form.latitude) || 0,
        longitude: Number(form.longitude) || 0,
        asset_type: form.asset_type,
        replacement_value: Number(form.replacement_value) || 0,
        book_value: Number(form.book_value) || 0,
      };
      if (isEdit) {
        return updateProperty(property!.property_id, {
          ...shared,
          ...(form.primary_manager_id !== "" ? { primary_manager_id: Number(form.primary_manager_id) } : {}),
        });
      }
      return createProperty({
        ...shared,
        primary_manager_id: form.primary_manager_id === "" ? null : Number(form.primary_manager_id),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["properties"] });
      if (isEdit) queryClient.invalidateQueries({ queryKey: ["property", property!.property_id] });
      onClose();
    },
  });

  const canSubmit =
    form.property_code.trim() &&
    form.name.trim() &&
    form.address.trim() &&
    form.latitude !== "" &&
    form.longitude !== "" &&
    form.replacement_value !== "" &&
    form.book_value !== "";

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{isEdit ? "עריכת נכס" : "נכס חדש"}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Grid container spacing={2}>
            <Grid item xs={6}>
              <TextField
                label="קוד נכס"
                fullWidth
                disabled={isEdit}
                value={form.property_code}
                onChange={(e) => setForm((f) => ({ ...f, property_code: e.target.value }))}
              />
            </Grid>
            <Grid item xs={6}>
              <TextField
                select
                label="סוג נכס"
                fullWidth
                value={form.asset_type}
                onChange={(e) => setForm((f) => ({ ...f, asset_type: e.target.value as AssetType }))}
              >
                {ASSET_TYPE_OPTIONS.map((t) => (
                  <MenuItem key={t} value={t}>
                    {ASSET_TYPE_LABELS[t]}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid item xs={12}>
              <TextField
                label="שם הנכס"
                fullWidth
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                label="כתובת"
                fullWidth
                value={form.address}
                onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
              />
            </Grid>
            <Grid item xs={4}>
              <TextField
                select
                label="אזור"
                fullWidth
                value={form.region}
                onChange={(e) => setForm((f) => ({ ...f, region: e.target.value }))}
              >
                {REGION_OPTIONS.map((r) => (
                  <MenuItem key={r.name} value={r.name}>
                    {r.name}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid item xs={4}>
              <TextField
                label="קו רוחב (Latitude)"
                type="number"
                fullWidth
                value={form.latitude}
                onChange={(e) => setForm((f) => ({ ...f, latitude: e.target.value }))}
              />
            </Grid>
            <Grid item xs={4}>
              <TextField
                label="קו אורך (Longitude)"
                type="number"
                fullWidth
                value={form.longitude}
                onChange={(e) => setForm((f) => ({ ...f, longitude: e.target.value }))}
              />
            </Grid>
            <Grid item xs={6}>
              <TextField
                label="שווי כינון (₪)"
                type="number"
                fullWidth
                value={form.replacement_value}
                onChange={(e) => setForm((f) => ({ ...f, replacement_value: e.target.value }))}
              />
            </Grid>
            <Grid item xs={6}>
              <TextField
                label="ערך בספרים (₪)"
                type="number"
                fullWidth
                value={form.book_value}
                onChange={(e) => setForm((f) => ({ ...f, book_value: e.target.value }))}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                select
                label="מנהל נכס אחראי"
                fullWidth
                value={form.primary_manager_id}
                onChange={(e) =>
                  setForm((f) => ({ ...f, primary_manager_id: e.target.value === "" ? "" : Number(e.target.value) }))
                }
                helperText={isEdit ? "השאירו ריק כדי לשמור על השיוך הקיים" : undefined}
              >
                <MenuItem value="">לא שויך</MenuItem>
                {(users.data ?? []).map((u) => (
                  <MenuItem key={u.user_id} value={u.user_id}>
                    {u.full_name}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
          </Grid>

          {mutation.isError && (
            <Alert severity="error">
              {isEdit ? "עדכון הנכס נכשל." : "יצירת הנכס נכשלה — ייתכן שקוד הנכס כבר קיים."}
            </Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>ביטול</Button>
        <Button variant="contained" disabled={!canSubmit || mutation.isPending} onClick={() => mutation.mutate()}>
          {isEdit ? "שמירה" : "יצירה"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
