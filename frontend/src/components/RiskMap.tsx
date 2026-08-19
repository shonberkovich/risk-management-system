import FormControlLabel from "@mui/material/FormControlLabel";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Typography from "@mui/material/Typography";
import { useMemo, useState } from "react";
import { Circle, CircleMarker, MapContainer, Popup, TileLayer } from "react-leaflet";

import type { Incident, Property, PropertyMapPoint } from "../api/client";
import { HAZARD_LABELS, formatIlsCompact } from "../format";

const COLOR_MAP: Record<PropertyMapPoint["status_color"], string> = {
  red: "#c62828",
  yellow: "#e69413",
  green: "#2e7d32",
};

const ACTIVE_INCIDENT_STATUSES = new Set(["NEW", "UNDER_INVESTIGATION", "CLAIM_FILED"]);

// Risk score is 1–5 (see backend/sql/schema.sql CHECK constraints); scaled to a
// visual radius in meters so a "5" hazard zone reads clearly at portfolio zoom.
const HAZARD_ZONE_METERS_PER_SCORE = 900;

function parseReportedCoordinates(raw: string | null): [number, number] | null {
  if (!raw) return null;
  const parts = raw.split(",").map((v) => Number(v.trim()));
  if (parts.length !== 2 || parts.some((v) => Number.isNaN(v))) return null;
  return [parts[0], parts[1]];
}

export default function RiskMap({
  points,
  properties,
  incidents,
}: {
  points: PropertyMapPoint[];
  properties?: Property[];
  incidents?: Incident[];
}) {
  const [showProperties, setShowProperties] = useState(true);
  const [showIncidents, setShowIncidents] = useState(true);
  const [showFloodZones, setShowFloodZones] = useState(false);
  const [showFireZones, setShowFireZones] = useState(false);

  const center: [number, number] =
    points.length > 0
      ? [points.reduce((s, p) => s + p.latitude, 0) / points.length, points.reduce((s, p) => s + p.longitude, 0) / points.length]
      : [31.9, 34.9];

  const activeIncidents = useMemo(
    () => (incidents ?? []).filter((i) => !i.is_draft && ACTIVE_INCIDENT_STATUSES.has(i.status)),
    [incidents],
  );

  const propertiesWithRiskProfile = useMemo(
    () => (properties ?? []).filter((p) => p.risk_profile !== null),
    [properties],
  );

  return (
    <Stack spacing={1}>
      <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
        <FormControlLabel
          control={<Switch size="small" checked={showProperties} onChange={(e) => setShowProperties(e.target.checked)} />}
          label={<Typography variant="caption">נכסים</Typography>}
        />
        <FormControlLabel
          control={<Switch size="small" checked={showIncidents} onChange={(e) => setShowIncidents(e.target.checked)} />}
          label={<Typography variant="caption">אירועים פעילים ({activeIncidents.length})</Typography>}
        />
        <FormControlLabel
          control={<Switch size="small" checked={showFloodZones} onChange={(e) => setShowFloodZones(e.target.checked)} />}
          label={<Typography variant="caption">אזורי הצפה</Typography>}
        />
        <FormControlLabel
          control={<Switch size="small" checked={showFireZones} onChange={(e) => setShowFireZones(e.target.checked)} />}
          label={<Typography variant="caption">אזורי שריפה</Typography>}
        />
      </Stack>

      <MapContainer
        center={center}
        zoom={7}
        style={{ height: 420, width: "100%", borderRadius: 8, overflow: "hidden" }}
        scrollWheelZoom={false}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {showFloodZones &&
          propertiesWithRiskProfile.map((p) => (
            <Circle
              key={`flood-${p.property_id}`}
              center={[p.latitude, p.longitude]}
              radius={(p.risk_profile?.flood_risk_score ?? 0) * HAZARD_ZONE_METERS_PER_SCORE}
              pathOptions={{ color: "#1565c0", fillColor: "#1565c0", fillOpacity: 0.12, weight: 1 }}
            />
          ))}

        {showFireZones &&
          propertiesWithRiskProfile.map((p) => (
            <Circle
              key={`fire-${p.property_id}`}
              center={[p.latitude, p.longitude]}
              radius={(p.risk_profile?.fire_risk_score ?? 0) * HAZARD_ZONE_METERS_PER_SCORE}
              pathOptions={{ color: "#d84315", fillColor: "#d84315", fillOpacity: 0.12, weight: 1 }}
            />
          ))}

        {showProperties &&
          points.map((p) => (
            <CircleMarker
              key={p.property_id}
              center={[p.latitude, p.longitude]}
              radius={10}
              pathOptions={{ color: COLOR_MAP[p.status_color], fillColor: COLOR_MAP[p.status_color], fillOpacity: 0.8 }}
            >
              <Popup>
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                  {p.name}
                </Typography>
                <Typography variant="caption" display="block">
                  שווי כינון: {formatIlsCompact(p.replacement_value)}
                </Typography>
                <Typography variant="caption" display="block">
                  אירועים פתוחים: {p.open_incidents}
                </Typography>
              </Popup>
            </CircleMarker>
          ))}

        {showIncidents &&
          activeIncidents.map((inc) => {
            const coords = parseReportedCoordinates(inc.reported_coordinates) ?? (() => {
              const property = points.find((p) => p.property_id === inc.property_id);
              return property ? ([property.latitude, property.longitude] as [number, number]) : null;
            })();
            if (!coords) return null;
            return (
              <CircleMarker
                key={`incident-${inc.incident_id}`}
                center={coords}
                radius={6}
                pathOptions={{ color: "#6a1b9a", fillColor: "#ce93d8", fillOpacity: 0.9, weight: 2 }}
              >
                <Popup>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                    {inc.incident_code}
                  </Typography>
                  <Typography variant="caption" display="block">
                    {HAZARD_LABELS[inc.hazard_type] ?? inc.hazard_type}
                  </Typography>
                  <Typography variant="caption" display="block">
                    אומדן נזק: {formatIlsCompact(inc.initial_estimated_loss)}
                  </Typography>
                </Popup>
              </CircleMarker>
            );
          })}
      </MapContainer>
    </Stack>
  );
}
