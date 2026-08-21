import Button from "@mui/material/Button";
import FormControlLabel from "@mui/material/FormControlLabel";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Typography from "@mui/material/Typography";
import { useMemo, useRef, useState } from "react";
import { Circle, CircleMarker, MapContainer, Popup, TileLayer } from "react-leaflet";
import type { Map as LeafletMap } from "leaflet";
import { useNavigate } from "react-router-dom";

import type { GeographicExposureCluster, Incident, Property, PropertyMapPoint } from "../api/client";
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
  exposureClusters,
}: {
  points: PropertyMapPoint[];
  properties?: Property[];
  incidents?: Incident[];
  exposureClusters?: GeographicExposureCluster[];
}) {
  const navigate = useNavigate();
  const [showProperties, setShowProperties] = useState(true);
  const [showIncidents, setShowIncidents] = useState(true);
  const [showFloodZones, setShowFloodZones] = useState(false);
  const [showFireZones, setShowFireZones] = useState(false);
  const [showExposureClusters, setShowExposureClusters] = useState(false);

  // Single source of truth for "which marker's popup is open". Rapid clicks across
  // different markers used to leave stale Popup DOM/handlers behind (each CircleMarker
  // managed its own uncontrolled popup), which could make "מעבר לתיק הנכס" navigate using
  // a previous click's property id. Tracking one selected id here — and explicitly closing
  // any currently-open popup on the map before a new marker's popup opens — means the
  // "view property" handler always reads the id of the marker that was actually clicked.
  const mapRef = useRef<LeafletMap | null>(null);
  const [selectedPropertyId, setSelectedPropertyId] = useState<number | null>(null);

  const selectProperty = (propertyId: number) => {
    mapRef.current?.closePopup();
    setSelectedPropertyId(propertyId);
  };

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

  const propertiesById = useMemo(
    () => new Map((properties ?? []).map((p) => [p.property_id, p])),
    [properties],
  );

  // Single-property "clusters" (radius_km = 0) aren't a concentration — only draw
  // circles for clusters that actually group multiple nearby properties.
  const multiPropertyClusters = useMemo(
    () => (exposureClusters ?? []).filter((c) => c.property_count > 1),
    [exposureClusters],
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
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={showExposureClusters}
              onChange={(e) => setShowExposureClusters(e.target.checked)}
            />
          }
          label={<Typography variant="caption">אשכולות חשיפה (TIV) ({multiPropertyClusters.length})</Typography>}
        />
      </Stack>

      <MapContainer
        ref={mapRef}
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

        {showExposureClusters &&
          multiPropertyClusters.map((c, idx) => (
            <Circle
              key={`cluster-${c.property_ids.join("-")}`}
              center={[c.center_lat, c.center_lon]}
              // radius_km is the actual distance from the cluster center to its
              // farthest member (see kpi.calculate_geographic_exposure_clusters);
              // a floor keeps small/tight clusters visible at portfolio zoom.
              radius={Math.max(c.radius_km * 1000, 1500)}
              pathOptions={{
                color: "#8e24aa",
                fillColor: "#8e24aa",
                fillOpacity: 0.08,
                weight: 2,
                dashArray: "6 4",
              }}
            >
              <Popup>
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                  אשכול חשיפה #{idx + 1} ({c.property_count} נכסים)
                </Typography>
                <Typography variant="caption" display="block">
                  {c.property_names.join(", ")}
                </Typography>
                <Typography variant="caption" display="block">
                  TIV מצטבר: {formatIlsCompact(c.cluster_tiv_total)}
                </Typography>
                <Typography variant="caption" display="block">
                  MFL מצטבר: {formatIlsCompact(c.cluster_mfl_total)}
                </Typography>
              </Popup>
            </Circle>
          ))}

        {showProperties &&
          points.map((p) => {
            const detail = propertiesById.get(p.property_id);
            const policy = detail?.active_policy;
            return (
              <CircleMarker
                key={p.property_id}
                center={[p.latitude, p.longitude]}
                radius={10}
                pathOptions={{ color: COLOR_MAP[p.status_color], fillColor: COLOR_MAP[p.status_color], fillOpacity: 0.8 }}
                eventHandlers={{
                  click: () => selectProperty(p.property_id),
                }}
              >
                <Popup
                  eventHandlers={{
                    remove: () => setSelectedPropertyId((cur) => (cur === p.property_id ? null : cur)),
                  }}
                >
                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                    {p.name}
                  </Typography>
                  <Typography variant="caption" display="block">
                    שווי כינון: {formatIlsCompact(p.replacement_value)}
                  </Typography>
                  <Typography variant="caption" display="block">
                    אירועים פתוחים: {p.open_incidents}
                  </Typography>
                  <Typography variant="caption" display="block">
                    מנהל אחראי: {detail?.manager_name ?? "לא משויך"}
                  </Typography>
                  {policy ? (
                    <>
                      <Typography variant="caption" display="block">
                        פוליסה פעילה: {policy.policy_number} ({policy.insurer_name})
                      </Typography>
                      <Typography variant="caption" display="block">
                        גבול אחריות: {formatIlsCompact(policy.per_event_limit ?? policy.total_limit)}
                      </Typography>
                    </>
                  ) : (
                    <Typography variant="caption" display="block">
                      אין פוליסה פעילה משויכת
                    </Typography>
                  )}
                  <Button
                    size="small"
                    variant="outlined"
                    sx={{ mt: 1 }}
                    // Reads the id from the single controlled `selectedPropertyId` state (set
                    // synchronously by this exact marker's click handler above), not from a
                    // per-render closure over `p` — that's what keeps rapid clicks on different
                    // markers from ever navigating to a previous click's property.
                    onClick={() => {
                      const targetId = selectedPropertyId ?? p.property_id;
                      navigate(`/properties/${targetId}`);
                    }}
                  >
                    מעבר לתיק הנכס
                  </Button>
                </Popup>
              </CircleMarker>
            );
          })}

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
                eventHandlers={{
                  click: () => mapRef.current?.closePopup(),
                }}
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
