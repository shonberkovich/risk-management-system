import LinkIcon from "@mui/icons-material/Link";
import Alert from "@mui/material/Alert";
import Autocomplete from "@mui/material/Autocomplete";
import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
  fetchClaims,
  fetchIncidents,
  fetchProperties,
  linkEmailToEntity,
  type ClaimTrackingRow,
  type EntityEmailEntityType,
  type Incident,
  type Property,
} from "../api/client";

const ENTITY_TYPE_LABELS: Record<EntityEmailEntityType, string> = {
  INCIDENT: "אירוע",
  CLAIM: "תביעה",
  PROPERTY: "נכס",
};

interface EntityOption {
  id: number;
  label: string;
}

/** Loads the id/name option list for whichever entity type is currently
 * selected, reusing the existing list-fetching functions already in
 * api/client.ts (fetchProperties/fetchIncidents/fetchClaims) rather than
 * standing up new ones just for this picker — per the task brief. Each
 * query is only `enabled` for the matching entity type, so switching the
 * type never fires more than one of the three list requests. */
function useEntityOptions(entityType: EntityEmailEntityType | ""): { options: EntityOption[]; isLoading: boolean } {
  const properties = useQuery({
    queryKey: ["properties"],
    queryFn: fetchProperties,
    enabled: entityType === "PROPERTY",
  });
  const incidents = useQuery({
    queryKey: ["incidents"],
    queryFn: () => fetchIncidents(),
    enabled: entityType === "INCIDENT",
  });
  const claims = useQuery({
    queryKey: ["claims"],
    queryFn: () => fetchClaims(),
    enabled: entityType === "CLAIM",
  });

  if (entityType === "PROPERTY") {
    return {
      isLoading: properties.isLoading,
      options: (properties.data ?? []).map((p: Property) => ({
        id: p.property_id,
        label: `${p.property_code} — ${p.name}`,
      })),
    };
  }
  if (entityType === "INCIDENT") {
    return {
      isLoading: incidents.isLoading,
      options: (incidents.data ?? []).map((i: Incident) => ({ id: i.incident_id, label: i.incident_code })),
    };
  }
  if (entityType === "CLAIM") {
    return {
      isLoading: claims.isLoading,
      options: (claims.data ?? []).map((c: ClaimTrackingRow) => ({
        id: c.claim_id,
        label: `${c.claim_number} — ${c.property_name}`,
      })),
    };
  }
  return { options: [], isLoading: false };
}

export interface EmailEntityLinkControlProps {
  /** The thread's root email_id (Emails.tsx passes thread.root.email_id — see
   * models.EntityEmail's docstring on the backend for why every link is keyed
   * on the root). POST /api/emails/{id}/link would resolve any message id in
   * the thread to the same root regardless, but passing the root directly
   * here keeps this component's own query-invalidation target unambiguous. */
  emailId: number;
}

/** TODO_SPEC.md "משימה 11" step 3 — "קשר לישות..." control shown inside the
 * thread detail panel (Emails.tsx): pick an entity type, then a specific
 * entity by code/name, then POST /api/emails/{id}/link. */
export default function EmailEntityLinkControl({ emailId }: EmailEntityLinkControlProps) {
  const queryClient = useQueryClient();
  const [entityType, setEntityType] = useState<EntityEmailEntityType | "">("");
  const [selected, setSelected] = useState<EntityOption | null>(null);

  const { options, isLoading } = useEntityOptions(entityType);

  const linkMutation = useMutation({
    mutationFn: () => {
      if (!entityType || !selected) throw new Error("entity not selected");
      return linkEmailToEntity(emailId, entityType, selected.id);
    },
    onSuccess: () => {
      if (entityType && selected) {
        queryClient.invalidateQueries({ queryKey: ["entity-emails", entityType, selected.id] });
      }
      setSelected(null);
    },
  });

  return (
    <Stack spacing={1} sx={{ mb: 2 }}>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <LinkIcon fontSize="small" color="action" />
        <TextField
          select
          size="small"
          label="קשר לישות..."
          value={entityType}
          onChange={(e) => {
            setEntityType(e.target.value as EntityEmailEntityType);
            setSelected(null);
            linkMutation.reset();
          }}
          sx={{ minWidth: 140 }}
        >
          {(Object.keys(ENTITY_TYPE_LABELS) as EntityEmailEntityType[]).map((t) => (
            <MenuItem key={t} value={t}>
              {ENTITY_TYPE_LABELS[t]}
            </MenuItem>
          ))}
        </TextField>

        {entityType && (
          <Autocomplete
            size="small"
            sx={{ minWidth: 260 }}
            options={options}
            loading={isLoading}
            value={selected}
            onChange={(_, value) => {
              setSelected(value);
              linkMutation.reset();
            }}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            renderInput={(params) => <TextField {...params} label="בחר..." />}
          />
        )}

        {entityType && selected && (
          <Button size="small" variant="outlined" disabled={linkMutation.isPending} onClick={() => linkMutation.mutate()}>
            {linkMutation.isPending ? "מקשר..." : "קשר"}
          </Button>
        )}
      </Stack>

      {linkMutation.isSuccess && (
        <Alert severity="success" sx={{ py: 0 }}>
          התכתובת קושרה בהצלחה.
        </Alert>
      )}
      {linkMutation.isError && (
        <Alert severity="error" sx={{ py: 0 }}>
          הקישור נכשל. נסו שוב.
        </Alert>
      )}
    </Stack>
  );
}
