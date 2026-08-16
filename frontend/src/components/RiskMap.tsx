import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { CircleMarker, MapContainer, Popup, TileLayer } from "react-leaflet";

import type { PropertyMapPoint } from "../api/client";
import { formatIlsCompact } from "../format";

const COLOR_MAP: Record<PropertyMapPoint["status_color"], string> = {
  red: "#c62828",
  yellow: "#e69413",
  green: "#2e7d32",
};

export default function RiskMap({ points }: { points: PropertyMapPoint[] }) {
  const center: [number, number] =
    points.length > 0
      ? [points.reduce((s, p) => s + p.latitude, 0) / points.length, points.reduce((s, p) => s + p.longitude, 0) / points.length]
      : [31.9, 34.9];

  return (
    <Box sx={{ height: 420, borderRadius: 2, overflow: "hidden", border: "1px solid", borderColor: "divider" }}>
      <MapContainer center={center} zoom={7} style={{ height: "100%", width: "100%" }} scrollWheelZoom={false}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {points.map((p) => (
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
      </MapContainer>
    </Box>
  );
}
