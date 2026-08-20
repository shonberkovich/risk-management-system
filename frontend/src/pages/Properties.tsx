import AddIcon from "@mui/icons-material/Add";
import DomainIcon from "@mui/icons-material/Domain";
import EditIcon from "@mui/icons-material/Edit";
import ShieldIcon from "@mui/icons-material/Shield";
import WaterDropIcon from "@mui/icons-material/WaterDrop";
import LocalFireDepartmentIcon from "@mui/icons-material/LocalFireDepartment";
import PublicIcon from "@mui/icons-material/Public";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Grid from "@mui/material/Grid";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { fetchProperties, type Property } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import PropertyDialog from "../components/PropertyDialog";
import { ASSET_TYPE_LABELS, formatIlsCompact } from "../format";

const PROPERTY_WRITE_ROLES = ["RISK_MANAGER", "PROPERTY_MANAGER", "ADMIN"];

function RiskScoreBadge({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  const color = value >= 4 ? "error.main" : value >= 3 ? "warning.main" : "success.main";
  return (
    <Stack direction="row" spacing={0.5} alignItems="center">
      {icon}
      <Typography variant="caption" color="text.secondary">
        {label}:
      </Typography>
      <Typography variant="caption" sx={{ fontWeight: 700, color }}>
        {value}/5
      </Typography>
    </Stack>
  );
}

export default function Properties() {
  const { data: properties, isLoading } = useQuery({ queryKey: ["properties"], queryFn: fetchProperties });
  const { user } = useAuth();
  const navigate = useNavigate();
  const canWrite = !!user && PROPERTY_WRITE_ROLES.includes(user.role);

  const [dialogProperty, setDialogProperty] = useState<Property | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  if (isLoading) {
    return (
      <Stack alignItems="center" sx={{ py: 8 }}>
        <CircularProgress />
      </Stack>
    );
  }

  const openCreate = () => {
    setDialogProperty(null);
    setDialogOpen(true);
  };
  const openEdit = (p: Property) => {
    setDialogProperty(p);
    setDialogOpen(true);
  };

  return (
    <Stack spacing={3}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="h5" sx={{ fontWeight: 700 }}>
          רשימת נכסים ({properties?.length ?? 0})
        </Typography>
        {canWrite && (
          <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
            נכס חדש
          </Button>
        )}
      </Stack>

      <Grid container spacing={2}>
        {properties?.map((p) => (
          <Grid item xs={12} sm={6} md={4} key={p.property_id}>
            <Card variant="outlined" sx={{ height: "100%", position: "relative" }}>
              {canWrite && (
                <Tooltip title="עריכה">
                  <IconButton
                    size="small"
                    onClick={(e) => {
                      e.stopPropagation();
                      openEdit(p);
                    }}
                    sx={{ position: "absolute", top: 8, insetInlineStart: 8, zIndex: 1, bgcolor: "background.paper" }}
                  >
                    <EditIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
              <CardActionArea onClick={() => navigate(`/properties/${p.property_id}`)} sx={{ height: "100%" }}>
                <CardContent>
                  <Stack spacing={1.5}>
                    <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                      <Stack direction="row" spacing={1} alignItems="center">
                        <DomainIcon color="primary" />
                        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                          {p.name}
                        </Typography>
                      </Stack>
                      <Chip size="small" label={p.property_code} variant="outlined" />
                    </Stack>

                    <Typography variant="body2" color="text.secondary">
                      {p.address}
                    </Typography>

                    <Stack direction="row" spacing={1} flexWrap="wrap">
                      <Chip size="small" label={ASSET_TYPE_LABELS[p.asset_type] ?? p.asset_type} color="primary" variant="outlined" />
                      <Chip size="small" label={p.region} icon={<PublicIcon fontSize="small" />} variant="outlined" />
                      {p.risk_profile?.has_sprinklers && (
                        <Chip size="small" label="מתזים" icon={<ShieldIcon fontSize="small" />} color="success" variant="outlined" />
                      )}
                    </Stack>

                    <Stack direction="row" justifyContent="space-between">
                      <Typography variant="caption" color="text.secondary">
                        שווי כינון
                      </Typography>
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>
                        {formatIlsCompact(p.replacement_value)}
                      </Typography>
                    </Stack>

                    {p.risk_profile && (
                      <Stack direction="row" spacing={2} sx={{ pt: 1, borderTop: "1px solid", borderColor: "divider" }}>
                        <RiskScoreBadge label="הצפה" value={p.risk_profile.flood_risk_score} icon={<WaterDropIcon fontSize="small" color="info" />} />
                        <RiskScoreBadge label="אש" value={p.risk_profile.fire_risk_score} icon={<LocalFireDepartmentIcon fontSize="small" color="warning" />} />
                      </Stack>
                    )}
                  </Stack>
                </CardContent>
              </CardActionArea>
            </Card>
          </Grid>
        ))}
      </Grid>

      <PropertyDialog open={dialogOpen} property={dialogProperty} onClose={() => setDialogOpen(false)} />
    </Stack>
  );
}
