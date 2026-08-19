"""Incident media endpoints: upload photos/video/PDF, list an incident's media,
delete, and hand out a signed download URL — the HTTP layer over
services/storage.py (see that module's docstring for why this simulates S3/Blob
rather than calling a real cloud provider).

Upload flow: the file is persisted via storage.upload_file (local
media_storage/, path convention "incidents/<incident_id>/<filename>"), and if
it's a JPEG/TIFF with EXIF data, storage.extract_image_metadata pulls out
DateTimeOriginal and GPS coordinates — DateTimeOriginal becomes the row's
captured_at (falling back to "now" when absent, since a photo taken without
EXIF metadata was still captured *some* time, and "now" is the closest fact we
actually have), and GPS coordinates populate gps_latitude/gps_longitude.

Download flow deliberately goes through the two-step signed-URL contract
generate_signed_url/is_signed_url_valid was built for in storage.py: a client
first asks for a signed URL (GET .../signed-url), then fetches the actual
bytes from the public download endpoint, which re-validates the token before
serving anything — this is the "future download endpoint" storage.py's
docstring anticipated.
"""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import models, schemas
from app.database import get_db
from app.dependencies.permissions import require_roles
from app.services import storage

router = APIRouter(tags=["media"])

_MAX_UPLOAD_BYTES = 25 * 1024 * 1024  # 25 MB — generous for a course-demo incident photo/video


def _parse_exif_datetime(value: str | None) -> datetime | None:
    """EXIF DateTimeOriginal comes as "YYYY:MM:DD HH:MM:SS" (colons in the date,
    not dashes — an EXIF quirk). Returns None if it's missing or malformed
    rather than raising, consistent with storage.py's None-on-missing pattern."""
    if not value:
        return None
    try:
        return datetime.strptime(value, "%Y:%m:%d %H:%M:%S")
    except ValueError:
        return None


@router.post("/api/incidents/{incident_id}/media", response_model=schemas.IncidentMediaOut, status_code=201)
async def upload_incident_media(
    incident_id: int,
    file: UploadFile,
    db: Session = Depends(get_db),
    _user: models.User = Depends(require_roles()),  # any authenticated role
):
    incident = db.get(models.Incident, incident_id)
    if not incident:
        raise HTTPException(404, "Incident not found")
    if not file.filename:
        raise HTTPException(400, "חסר שם קובץ")

    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(400, "הקובץ ריק")
    if len(file_bytes) > _MAX_UPLOAD_BYTES:
        raise HTTPException(400, f"הקובץ חורג מהגודל המרבי המותר ({_MAX_UPLOAD_BYTES // (1024 * 1024)}MB)")

    upload_result = storage.upload_file(file_bytes, file.filename, "INCIDENT", incident_id)

    captured_at = datetime.now()
    gps_latitude: float | None = None
    gps_longitude: float | None = None
    metadata = storage.extract_image_metadata(file_bytes)
    if metadata:
        captured_at = _parse_exif_datetime(metadata["captured_at"]) or captured_at
        if metadata["gps"]:
            gps_latitude = metadata["gps"]["latitude"]
            gps_longitude = metadata["gps"]["longitude"]

    media = models.IncidentMedia(
        incident_id=incident_id,
        file_path=upload_result.storage_key,
        file_type=upload_result.content_type,
        captured_at=captured_at,
        gps_latitude=gps_latitude,
        gps_longitude=gps_longitude,
    )
    db.add(media)
    db.commit()
    db.refresh(media)
    return media


@router.get("/api/incidents/{incident_id}/media", response_model=list[schemas.IncidentMediaOut])
def list_incident_media(incident_id: int, db: Session = Depends(get_db)):
    incident = db.get(models.Incident, incident_id)
    if not incident:
        raise HTTPException(404, "Incident not found")
    return db.scalars(
        select(models.IncidentMedia)
        .where(models.IncidentMedia.incident_id == incident_id)
        .order_by(models.IncidentMedia.captured_at.desc())
    ).all()


@router.delete("/api/media/{media_id}", status_code=204)
def delete_incident_media(
    media_id: int,
    db: Session = Depends(get_db),
    _user: models.User = Depends(require_roles("RISK_MANAGER", "ADMIN")),
):
    media = db.get(models.IncidentMedia, media_id)
    if not media:
        raise HTTPException(404, "Media not found")
    storage.delete_file(media.file_path)  # no-op (returns False) if the file is already gone
    db.delete(media)
    db.commit()


@router.get("/api/media/{media_id}/signed-url", response_model=schemas.SignedUrlOut)
def get_signed_url(media_id: int, db: Session = Depends(get_db)):
    media = db.get(models.IncidentMedia, media_id)
    if not media:
        raise HTTPException(404, "Media not found")
    signed = storage.generate_signed_url(media.file_path)
    return {
        **signed,
        "download_url": (
            f"/api/media/download?key={signed['storage_key']}"
            f"&expires={signed['expires_at']}&token={signed['token']}"
        ),
    }


@router.get("/api/media/download")
def download_media(
    key: str = Query(...),
    expires: int = Query(...),
    token: str = Query(...),
):
    """Serves the actual file bytes — the read-side counterpart to
    /api/media/{media_id}/signed-url. Validates the token+expiry before
    touching disk, exactly as a real presigned-URL download would."""
    if not storage.is_signed_url_valid(key, expires, token):
        raise HTTPException(403, "קישור ההורדה אינו תקף או שפג תוקפו")

    dest = storage.STORAGE_ROOT / key
    if not dest.exists():
        raise HTTPException(404, "הקובץ לא נמצא באחסון")

    content_type = storage.ALLOWED_CONTENT_TYPES.get(key.rsplit(".", 1)[-1].lower(), "application/octet-stream")
    return Response(content=dest.read_bytes(), media_type=content_type)
