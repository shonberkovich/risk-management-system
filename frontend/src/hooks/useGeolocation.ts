import { useState } from "react";

export interface GeoCoords {
  latitude: number;
  longitude: number;
}

interface UseGeolocationResult {
  coords: GeoCoords | null;
  loading: boolean;
  error: string | null;
  request: () => void;
}

/** Wraps the browser Geolocation API in a small imperative hook — nothing fires
 * until `request()` is called (avoids surprising a field user with a permission
 * prompt on page load). Used by IncidentReport.tsx to suggest nearby properties. */
export function useGeolocation(): UseGeolocationResult {
  const [coords, setCoords] = useState<GeoCoords | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const request = () => {
    if (!navigator.geolocation) {
      setError("מיקום גיאוגרפי אינו נתמך בדפדפן זה");
      return;
    }
    setLoading(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setCoords({ latitude: position.coords.latitude, longitude: position.coords.longitude });
        setLoading(false);
      },
      (err) => {
        setError(
          err.code === err.PERMISSION_DENIED
            ? "הגישה למיקום נדחתה — ניתן לבחור נכס ידנית"
            : "לא ניתן לאתר את המיקום הנוכחי",
        );
        setLoading(false);
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  };

  return { coords, loading, error, request };
}

/** Great-circle distance between two lat/lng points, in km (haversine formula). */
export function distanceKm(a: GeoCoords, b: GeoCoords): number {
  const R = 6371;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
