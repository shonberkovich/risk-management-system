import { parse as parseExif } from "exifr";

export interface ExifSummary {
  /** GPS coordinates embedded in the photo, if the device tagged it (most phone cameras do
   * when location services were enabled at capture time). */
  latitude: number | null;
  longitude: number | null;
  /** When the photo was actually taken (EXIF DateTimeOriginal/CreateDate), which can differ
   * from the file's upload time — the whole point of surfacing it for an incident report. */
  capturedAt: Date | null;
}

const EMPTY: ExifSummary = { latitude: null, longitude: null, capturedAt: null };

/** Reads GPS + capture-time EXIF tags out of an uploaded photo, purely client-side (the file
 * never leaves the browser for this). Returns null for non-images or files with no usable
 * EXIF block (screenshots, downloaded/re-saved images, PNGs, most Android camera JPEGs that
 * strip GPS by default, etc.) — this is expected and common, not an error condition, so
 * callers should treat null as "no metadata available" rather than a failure to report. */
export async function extractExifSummary(file: File): Promise<ExifSummary | null> {
  if (!file.type.startsWith("image/")) return null;
  try {
    // Explicitly enable the GPS and Exif-date IFDs. Deliberately NOT using exifr's `pick`
    // option here — combining `pick` with `gps: true` filters out the raw GPSLatitude/
    // GPSLongitudeRef component tags before exifr computes the convenience `latitude`/
    // `longitude` decimal values from them, so `pick`-ing directly silently drops GPS
    // (confirmed while verifying this against a real EXIF-tagged JPEG). Just read off the
    // handful of fields we want from the full result below instead.
    const tags = await parseExif(file, { gps: true, exif: true });
    if (!tags) return EMPTY;
    const latitude = typeof tags.latitude === "number" ? tags.latitude : null;
    const longitude = typeof tags.longitude === "number" ? tags.longitude : null;
    const rawDate = tags.DateTimeOriginal ?? tags.CreateDate ?? null;
    const capturedAt = rawDate instanceof Date && !Number.isNaN(rawDate.getTime()) ? rawDate : null;
    if (latitude === null && longitude === null && capturedAt === null) return EMPTY;
    return { latitude, longitude, capturedAt };
  } catch {
    // Corrupt/truncated EXIF block, unsupported format variant, etc. — degrade to "no metadata"
    // rather than blocking the upload; the photo itself is still perfectly usable.
    return EMPTY;
  }
}
