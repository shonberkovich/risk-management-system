"""File storage service: upload, signed-URL generation, and EXIF/GPS metadata
extraction for incident media (photos/video/PDF). Pure I/O + calculation layer, no
LLM calls here (mirrors kpi.py / cashflow.py / retention.py) — and, importantly, no
real S3/Azure Blob delivery either.

The core question this answers: when a field worker uploads an incident photo, where
does the file live, how does the rest of the system get a URL to it, and what can we
learn from the photo itself (when/where was it taken)? A real cloud integration (an
actual AWS S3 / Azure Blob Storage account with IAM-scoped presigned URLs) is
explicitly out of scope for this course demo (see docs/README.md §8, "שמירת קבצים
בפועל למדיה של אירועים") — there's no bucket, no credentials in backend/.env, no
CDN. Instead, this module persists uploads to a local directory that stands in for
the bucket, and "signs" URLs by embedding a expiry timestamp + HMAC-style token
computed from a local secret — demonstrating the same upload/retrieve/expire contract
a real object-store SDK (`boto3`, `azure-storage-blob`) would expose, without
pretending to reach a real cloud endpoint.

This mirrors how routers/ai.py degrades gracefully without an ANTHROPIC_API_KEY, and
how notifications.py "sends" alerts by logging rather than calling a real
SendGrid/Twilio provider: the feature is fully exercised end-to-end, just without an
external side effect at the end. `Documents.s3_url` / seed.py's
`https://storage.rmis-demo.local/...` URLs (see models.py, seed.py) already establish
this fictional storage domain — this module's simulated URLs follow that same
convention.

EXIF/GPS extraction uses Pillow (added to requirements.txt for this task), reading
the image's `DateTimeOriginal` and `GPSInfo` EXIF tags where present. Most files
(video, PDF, or photos with EXIF stripped by the client) simply have no metadata to
extract — extract_image_metadata returns None rather than raising, exactly like the
other services' None-on-missing-data returns (e.g. simulation.simulate_property for
an unknown property_id).
"""
import hashlib
import io
import re
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import quote

from PIL import Image
from PIL.ExifTags import GPSTAGS, TAGS

# Local directory standing in for the cloud bucket. Gitignored (see .gitignore) —
# same treatment as backend/.env: environment-specific, not checked into the repo.
STORAGE_ROOT = Path(__file__).resolve().parent.parent.parent / "media_storage"

# Fictional storage domain already established by seed.py's demo Documents rows
# (e.g. "https://storage.rmis-demo.local/incidents/INC-2025-004-photo1.jpg") — this
# module's simulated URLs are made to look consistent with that existing demo data.
STORAGE_DOMAIN = "https://storage.rmis-demo.local"

# Local "signing secret" standing in for the private key a real cloud provider would
# hold. Fixed and checked into the repo — this is a course demo, not a security
# boundary that needs to survive rotation (see docs/README.md §8, encryption-at-rest
# and RBAC are explicitly out of scope too).
_SIGNING_SECRET = "rmis-demo-local-signing-secret"

DEFAULT_SIGNED_URL_TTL_SECONDS = 3600  # 1 hour, a typical presigned-URL default

ALLOWED_CONTENT_TYPES = {
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "png": "image/png",
    "mp4": "video/mp4",
    "mov": "video/quicktime",
    "pdf": "application/pdf",
}


# Longest file name kept from the client (extension included). The storage key adds
# "<entity>s/<id>/<32 hex>_" in front, and has to fit Documents.s3_url /
# Incident_Media.file_path / Email_Attachments.file_path (NVARCHAR(500)) — and, on
# disk, Windows' 260-character MAX_PATH together with the STORAGE_ROOT path in front
# of it (150 left too little room: the write failed with a 500).
MAX_FILENAME_CHARS = 100

_UNSAFE_FILENAME_CHARS = re.compile(r'[\x00-\x1f<>:"/\\|?*]')


@dataclass
class UploadResult:
    storage_key: str  # relative path within the bucket, e.g. "incidents/42/<32 hex>_photo1.jpg"
    url: str  # unsigned, permanent-looking reference URL (mirrors Documents.s3_url)
    size_bytes: int
    content_type: str


def _content_type_for(filename: str) -> str:
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    return ALLOWED_CONTENT_TYPES.get(ext, "application/octet-stream")


def safe_filename(filename: str) -> str:
    """The client's file name reduced to something safe to store and show: only the
    last path component (a browser may send "C:\\fakepath\\x.pdf", an attacker
    "../../x"), no characters Windows forbids in a name, no leading/trailing dots or
    spaces, and at most MAX_FILENAME_CHARS long (the extension is kept). Falls back to
    "file" when nothing usable is left."""
    name = re.split(r"[\\/]", filename)[-1]
    name = _UNSAFE_FILENAME_CHARS.sub("_", name).strip(" .")
    if not name:
        return "file"
    if len(name) > MAX_FILENAME_CHARS:
        stem, dot, ext = name.rpartition(".")
        if dot and 0 < len(ext) <= 10:
            name = stem[: MAX_FILENAME_CHARS - len(ext) - 1] + "." + ext
        else:
            name = name[:MAX_FILENAME_CHARS]
    return name


def resolve_key(storage_key: str) -> Path | None:
    """The on-disk path for storage_key, or None when it would land outside
    STORAGE_ROOT (e.g. a key containing ".."), so no caller can be steered into reading,
    writing or deleting an arbitrary file."""
    root = STORAGE_ROOT.resolve()
    dest = (root / storage_key).resolve()
    return dest if dest.is_relative_to(root) and dest != root else None


def upload_file(file_bytes: bytes, filename: str, entity_type: str, entity_id: int) -> UploadResult:
    """Persists file_bytes to the local storage root under
    <entity_type>/<entity_id>/<unique prefix>_<safe filename> (e.g.
    "incidents/42/3f2a…_photo1.jpg") and returns an UploadResult with a
    Documents.s3_url-style reference URL. entity_type mirrors Documents.entity_type
    ("INCIDENT", "CLAIM", "PROPERTY", "POLICY") but is not validated against that enum
    here — callers (routers/media.py, routers/documents.py) own that.

    The unique prefix matters: phone cameras routinely name every capture the same
    (e.g. "image.jpg"), and keying by the client name alone made a second upload
    overwrite the first one's bytes, with both rows then pointing at one file (deleting
    either broke the other). The client name is reduced by safe_filename, so it can't
    climb out of the storage root either."""
    storage_key = f"{entity_type.lower()}s/{entity_id}/{uuid.uuid4().hex}_{safe_filename(filename)}"
    dest = resolve_key(storage_key)
    if dest is None:  # can't happen with a sanitized name; kept as the last line of defense
        raise ValueError(f"storage key escapes the storage root: {storage_key!r}")
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(file_bytes)

    return UploadResult(
        storage_key=storage_key,
        url=f"{STORAGE_DOMAIN}/{storage_key}",
        size_bytes=len(file_bytes),
        content_type=_content_type_for(storage_key),
    )


def delete_file(storage_key: str) -> bool:
    """Removes a previously uploaded file. Returns False (no-op) if it doesn't
    exist, rather than raising — deleting an already-gone file is not an error for
    the caller (e.g. a retry after a partial failure)."""
    dest = resolve_key(storage_key)
    if dest is None or not dest.exists():
        return False
    dest.unlink()
    return True


def generate_signed_url(storage_key: str, expires_in_seconds: int = DEFAULT_SIGNED_URL_TTL_SECONDS) -> dict:
    """Builds a simulated presigned URL: a query string carrying an expiry Unix
    timestamp and a token derived from (storage_key, expiry, _SIGNING_SECRET). A real
    S3/Blob SDK would call out to the provider to mint this; here it's computed
    locally so is_signed_url_valid can verify it without any network dependency.
    Does not check that storage_key exists — signing a URL for an as-yet-unwritten
    key (e.g. for a client-side direct upload) is a legitimate real-world use case
    too.

    "url" is the illustrative, S3-presign-shaped reference (same STORAGE_DOMAIN as
    upload_file's URLs) — it's not actually fetchable, since there's no real cloud
    endpoint behind it. "token" is returned separately so a caller with an actual
    download endpoint (e.g. routers/media.py's GET /api/media/download) can build a
    real, fetchable URL against itself instead."""
    expires_at = int(time.time()) + expires_in_seconds
    token = _sign(storage_key, expires_at)
    return {
        "url": f"{STORAGE_DOMAIN}/{storage_key}?expires={expires_at}&token={token}",
        "storage_key": storage_key,
        "expires_at": expires_at,
        "token": token,
    }


def download_url(endpoint: str, signed: dict) -> str:
    """The fetchable URL for a generate_signed_url() result against one of this API's
    download endpoints (e.g. "/api/media/download"). The key is percent-encoded: a file
    name may contain "&", "#", "+" or spaces, which would otherwise break the query
    string (and with it the token check)."""
    return (
        f"{endpoint}?key={quote(signed['storage_key'], safe='/')}"
        f"&expires={signed['expires_at']}&token={signed['token']}"
    )


def is_signed_url_valid(storage_key: str, expires_at: int, token: str) -> bool:
    """Verifies a signed URL's token and that it hasn't expired — the read-side
    counterpart to generate_signed_url, for a future download endpoint to call
    before serving the file."""
    if int(time.time()) > expires_at:
        return False
    return token == _sign(storage_key, expires_at)


def _sign(storage_key: str, expires_at: int) -> str:
    payload = f"{storage_key}:{expires_at}:{_SIGNING_SECRET}"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:32]


def _dms_to_decimal(dms, ref: str) -> float:
    """Converts an EXIF GPS coordinate (degrees, minutes, seconds tuple) plus its
    hemisphere reference ('N'/'S'/'E'/'W') to a signed decimal-degrees float."""
    degrees, minutes, seconds = (float(v) for v in dms)
    decimal = degrees + minutes / 60 + seconds / 3600
    if ref in ("S", "W"):
        decimal = -decimal
    return decimal


def extract_image_metadata(file_bytes: bytes) -> dict | None:
    """Reads EXIF metadata from an image (JPEG/TIFF — the formats that carry EXIF)
    and pulls out the two fields a risk manager cares about for incident photos:
    when and where it was taken.

    Returns a dict with keys "captured_at" (str | None, from EXIF DateTimeOriginal)
    and "gps" (dict with "latitude"/"longitude" floats, or None if the image has no
    GPS tag — most photos don't, unless location services were on). Returns None
    entirely if file_bytes isn't a readable image (e.g. a PDF or video was passed
    in) or carries no EXIF block at all — not an error, just nothing to extract."""
    try:
        image = Image.open(io.BytesIO(file_bytes))
        exif = image.getexif()
    except Exception:
        return None

    if not exif:
        return None

    tags = {TAGS.get(tag_id, tag_id): value for tag_id, value in exif.items()}

    # DateTimeOriginal lives in the "Exif" sub-IFD (0x8769), not the top-level 0th
    # IFD — only the coarser "DateTime" (file-modified) tag is ever top-level.
    exif_ifd = exif.get_ifd(0x8769) if hasattr(exif, "get_ifd") else None
    if exif_ifd:
        exif_sub_tags = {TAGS.get(tag_id, tag_id): value for tag_id, value in exif_ifd.items()}
        captured_at = exif_sub_tags.get("DateTimeOriginal")
    else:
        captured_at = None
    captured_at = captured_at or tags.get("DateTime")

    gps = None
    gps_ifd = exif.get_ifd(0x8825) if hasattr(exif, "get_ifd") else None  # 0x8825 = GPSInfo IFD pointer
    if gps_ifd:
        gps_tags = {GPSTAGS.get(tag_id, tag_id): value for tag_id, value in gps_ifd.items()}
        lat = gps_tags.get("GPSLatitude")
        lat_ref = gps_tags.get("GPSLatitudeRef")
        lon = gps_tags.get("GPSLongitude")
        lon_ref = gps_tags.get("GPSLongitudeRef")
        if lat and lon and lat_ref and lon_ref:
            gps = {
                "latitude": round(_dms_to_decimal(lat, lat_ref), 6),
                "longitude": round(_dms_to_decimal(lon, lon_ref), 6),
            }

    if captured_at is None and gps is None:
        return None

    return {"captured_at": captured_at, "gps": gps}
