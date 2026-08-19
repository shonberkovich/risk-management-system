"""Document Management (DMS) endpoints: upload/list/delete/download documents
attached to a policy, claim, incident, or property (policy PDFs, adjuster
reports, correspondence, survey reports — see seed.py's Documents rows for the
demo data this mirrors). This is the same simulated-storage contract
routers/media.py already established over services/storage.py (see that
module's docstring for why this persists to a local media_storage/ directory
and "signs" URLs locally rather than calling a real S3/Blob provider) —
Documents is simply a second, entity-polymorphic table over the same storage
layer, so this router is deliberately a near-mirror of media.py rather than a
new storage abstraction.

entity_type is one of "INCIDENT" | "CLAIM" | "PROPERTY" | "POLICY" (matches
Documents.entity_type / schemas.DocumentEntityType); _ENTITY_MODELS below maps
each to its ORM model so entity_id can be validated to actually exist before a
document is attached to it or listed for it.

The entity-scoped routes live under /entity/{entity_type}/{entity_id} rather
than directly under /{entity_type}/{entity_id} — with entity_type typed as a
str-based Literal, Starlette commits to the first *structurally* matching
route before FastAPI validates the Literal value, so a bare
/{entity_type}/{entity_id} would shadow /{document_id}/signed-url for any
2-segment path (e.g. GET /api/documents/9/signed-url would wrongly match
entity_type="9", entity_id="signed-url" and 422 on Literal validation instead
of falling through). The /entity/ prefix removes the ambiguity outright
instead of relying on route registration order.
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import models, schemas
from app.database import get_db
from app.dependencies.permissions import require_roles
from app.services import storage

router = APIRouter(prefix="/api/documents", tags=["documents"])

_MAX_UPLOAD_BYTES = 25 * 1024 * 1024  # 25 MB — same ceiling as media.py's incident uploads

_ENTITY_MODELS: dict[str, type] = {
    "INCIDENT": models.Incident,
    "CLAIM": models.Claim,
    "PROPERTY": models.Property,
    "POLICY": models.InsurancePolicy,
}


def _get_entity_or_404(db: Session, entity_type: schemas.DocumentEntityType, entity_id: int) -> None:
    model = _ENTITY_MODELS[entity_type]
    if db.get(model, entity_id) is None:
        raise HTTPException(404, f"{entity_type} {entity_id} not found")


@router.post("/entity/{entity_type}/{entity_id}", response_model=schemas.DocumentOut, status_code=201)
async def upload_document(
    entity_type: schemas.DocumentEntityType,
    entity_id: int,
    file: UploadFile,
    doc_type: str = Query(..., description='e.g. "POLICY_DOCUMENT", "ADJUSTER_REPORT", "CORRESPONDENCE", "PHOTO", "SURVEY_REPORT"'),
    uploaded_by: int | None = Query(None, description="Users.user_id"),
    db: Session = Depends(get_db),
    _user: models.User = Depends(require_roles()),  # any authenticated role
):
    _get_entity_or_404(db, entity_type, entity_id)
    if not file.filename:
        raise HTTPException(400, "חסר שם קובץ")

    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(400, "הקובץ ריק")
    if len(file_bytes) > _MAX_UPLOAD_BYTES:
        raise HTTPException(400, f"הקובץ חורג מהגודל המרבי המותר ({_MAX_UPLOAD_BYTES // (1024 * 1024)}MB)")

    upload_result = storage.upload_file(file_bytes, file.filename, entity_type, entity_id)

    document = models.Document(
        entity_type=entity_type,
        entity_id=entity_id,
        s3_url=upload_result.storage_key,
        doc_type=doc_type,
        uploaded_by=uploaded_by,
        uploaded_at=datetime.now(timezone.utc).replace(tzinfo=None),
    )
    db.add(document)
    db.commit()
    db.refresh(document)
    return document


@router.get("/entity/{entity_type}/{entity_id}", response_model=list[schemas.DocumentOut])
def list_documents(entity_type: schemas.DocumentEntityType, entity_id: int, db: Session = Depends(get_db)):
    _get_entity_or_404(db, entity_type, entity_id)
    return db.scalars(
        select(models.Document)
        .where(models.Document.entity_type == entity_type, models.Document.entity_id == entity_id)
        .order_by(models.Document.uploaded_at.desc())
    ).all()


@router.delete("/{document_id}", status_code=204)
def delete_document(
    document_id: int,
    db: Session = Depends(get_db),
    _user: models.User = Depends(require_roles("RISK_MANAGER", "ADMIN")),
):
    document = db.get(models.Document, document_id)
    if not document:
        raise HTTPException(404, "Document not found")
    storage.delete_file(document.s3_url)  # no-op (returns False) if the file is already gone
    db.delete(document)
    db.commit()


@router.get("/{document_id}/signed-url", response_model=schemas.SignedUrlOut)
def get_document_signed_url(document_id: int, db: Session = Depends(get_db)):
    document = db.get(models.Document, document_id)
    if not document:
        raise HTTPException(404, "Document not found")
    signed = storage.generate_signed_url(document.s3_url)
    return {
        **signed,
        "download_url": (
            f"/api/documents/download?key={signed['storage_key']}"
            f"&expires={signed['expires_at']}&token={signed['token']}"
        ),
    }


@router.get("/download")
def download_document(
    key: str = Query(...),
    expires: int = Query(...),
    token: str = Query(...),
):
    """Serves the actual file bytes — the read-side counterpart to
    /api/documents/{document_id}/signed-url. Validates the token+expiry before
    touching disk, exactly as /api/media/download does for incident media."""
    if not storage.is_signed_url_valid(key, expires, token):
        raise HTTPException(403, "קישור ההורדה אינו תקף או שפג תוקפו")

    dest = storage.STORAGE_ROOT / key
    if not dest.exists():
        raise HTTPException(404, "הקובץ לא נמצא באחסון")

    content_type = storage.ALLOWED_CONTENT_TYPES.get(key.rsplit(".", 1)[-1].lower(), "application/octet-stream")
    return Response(content=dest.read_bytes(), media_type=content_type)
