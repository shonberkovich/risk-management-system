import DeleteIcon from "@mui/icons-material/Delete";
import Alert from "@mui/material/Alert";
import Autocomplete from "@mui/material/Autocomplete";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
  assignPolicyAsset,
  fetchPolicyAssets,
  fetchProperties,
  unassignPolicyAsset,
  type Policy,
  type Property,
} from "../api/client";
import { formatIls } from "../format";

export default function PolicyAssetsDialog({
  open,
  policy,
  onClose,
}: {
  open: boolean;
  policy: Policy | null;
  onClose: () => void;
}) {
  const [selectedProperty, setSelectedProperty] = useState<Property | null>(null);
  const queryClient = useQueryClient();
  const policyId = policy?.policy_id;

  const assets = useQuery({
    queryKey: ["policy-assets", policyId],
    queryFn: () => fetchPolicyAssets(policyId!),
    enabled: open && !!policyId,
  });
  const properties = useQuery({ queryKey: ["properties"], queryFn: fetchProperties, enabled: open });

  const assignedIds = new Set((assets.data ?? []).map((a) => a.property_id));
  const availableProperties = (properties.data ?? []).filter((p) => !assignedIds.has(p.property_id));

  const assignMutation = useMutation({
    mutationFn: () => assignPolicyAsset(policyId!, { property_id: selectedProperty!.property_id }),
    onSuccess: () => {
      setSelectedProperty(null);
      queryClient.invalidateQueries({ queryKey: ["policy-assets", policyId] });
    },
  });

  const unassignMutation = useMutation({
    mutationFn: (propertyId: number) => unassignPolicyAsset(policyId!, propertyId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["policy-assets", policyId] }),
  });

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>נכסים מבוטחים — {policy?.policy_number}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Stack direction="row" spacing={1}>
            <Autocomplete
              fullWidth
              options={availableProperties}
              getOptionLabel={(p) => `${p.name} (${p.property_code})`}
              value={selectedProperty}
              onChange={(_, value) => setSelectedProperty(value)}
              renderInput={(params) => <TextField {...params} label="הוספת נכס לפוליסה" size="small" />}
            />
            <Button
              variant="contained"
              disabled={!selectedProperty || assignMutation.isPending}
              onClick={() => assignMutation.mutate()}
            >
              הוסף
            </Button>
          </Stack>

          {assignMutation.isError && <Alert severity="error">הוספת הנכס נכשלה.</Alert>}

          {assets.isLoading ? (
            <Stack alignItems="center" sx={{ py: 3 }}>
              <CircularProgress size={24} />
            </Stack>
          ) : (assets.data ?? []).length === 0 ? (
            <Typography color="text.secondary" variant="body2">
              אין עדיין נכסים משויכים לפוליסה זו.
            </Typography>
          ) : (
            <List dense disablePadding>
              {(assets.data ?? []).map((a) => (
                <ListItem
                  key={a.property_id}
                  disableGutters
                  secondaryAction={
                    <IconButton
                      edge="end"
                      size="small"
                      disabled={unassignMutation.isPending}
                      onClick={() => unassignMutation.mutate(a.property_id)}
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  }
                >
                  <ListItemText
                    primary={a.property_name}
                    secondary={a.specific_deductible != null ? `השתתפות עצמית ייעודית: ${formatIls(a.specific_deductible)}` : undefined}
                  />
                </ListItem>
              ))}
            </List>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>סגירה</Button>
      </DialogActions>
    </Dialog>
  );
}
