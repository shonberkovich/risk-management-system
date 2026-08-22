"""User lookup + administration.

GET / (list) stays open and minimal (name + role only) — it exists mainly to power UI
pickers (e.g. assigning an executor to a mitigation task) with real names instead of
raw user_ids, not as an admin surface. The write endpoints below (create, edit, role
change, disable — TODO_SPEC.md §2 "ניהול משתמשים") are ADMIN-only and return the
fuller UserAdminOut shape. There is still no self-service registration/password-reset
flow and no server-side session/token revocation beyond the is_active check
(dependencies/permissions.get_current_user) — that remains out of scope for this
course demo, same as documented for auth generally in routers/auth.py.

`PATCH /{user_id}/signature` (TODO_SPEC.md "משימה 14") is this module's one
self-service (non-ADMIN) write endpoint — every other endpoint above is either open
(GET) or ADMIN-gated. It's a "not yours" ownership check, not a role check, so it
deliberately returns 403 rather than reusing routers/emails.py's 404-for-"not yours"
convention: that 404 exists specifically to stop a caller from confirming an
*email_id* exists in a mailbox they can't see (mailbox contents are private, and even
their existence is sensitive). A user_id carries no equivalent secret here — GET
/api/users already lists every user_id + name openly to any caller, admin or not — so
there's nothing to hide by pretending user #7 doesn't exist; 403 (matches this app's
general RBAC-failure convention, dependencies/permissions.require_roles) says plainly
"that's not yours" instead of a misleading 404.
"""
from datetime import datetime
from html import escape

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import models, schemas
from app.database import get_db
from app.dependencies.permissions import get_current_user, require_roles
from app.services.auth import hash_password
from app.services.email import sanitize_body_html

router = APIRouter(prefix="/api/users", tags=["users"])

_USERS_WRITE_ROLES = ("ADMIN",)

# TODO_SPEC.md "משימה 14" step 5 (optional) — Hebrew display labels for the default
# signature `create_user` seeds below. Duplicated from frontend/src/format.ts's
# ROLE_LABELS rather than shared: that module is frontend-only display formatting
# (also has severity/status colors, date formatting, etc. with no reason to exist
# in the backend), and this is the one spot the backend itself renders a role as
# Hebrew text rather than passing the raw enum value through. Keep in sync with
# ROLE_LABELS there if a role is renamed or added — schemas.UserRole is the actual
# source of truth for which roles exist; this dict only needs to cover all of them.
_ROLE_LABELS_HE = {
    "ADMIN": "מנהל מערכת",
    "RISK_MANAGER": "מנהל סיכונים",
    "RISK_OFFICER": "קצין סיכונים",
    "PROPERTY_MANAGER": "מנהל נכסים",
    "FIELD_WORKER": "עובד שטח",
    "CFO": 'סמנכ"ל כספים',
    "ADJUSTER": "שמאי",
}


def _default_signature(full_name: str, role: str) -> str:
    """TODO_SPEC.md "משימה 14" step 5 (optional) — "name + role" default signature
    for a newly-created employee, run through the exact same sanitize_body_html used
    for every other signature write (step 1) rather than trusted as pre-safe just
    because this code generated it — full_name in particular is admin-typed free
    text (schemas.UserCreate.full_name has no format constraint), so it's HTML-
    escaped before being wrapped in markup, the same way any other untrusted string
    would be before landing in an HTML fragment."""
    role_label = _ROLE_LABELS_HE.get(role, role)
    return sanitize_body_html(f"<p>{escape(full_name)}</p><p>{escape(role_label)}</p>")


@router.get("", response_model=list[schemas.UserOut])
def list_users(db: Session = Depends(get_db)):
    return db.scalars(select(models.User).order_by(models.User.full_name)).all()


@router.get("/admin", response_model=list[schemas.UserAdminOut])
def list_users_admin(
    db: Session = Depends(get_db),
    _user: models.User = Depends(require_roles(*_USERS_WRITE_ROLES)),
):
    """ADMIN-only fuller listing (email, is_active, created_at) for the user-management
    screen (TODO_SPEC.md §5, "ניהול משתמשים והרשאות") — kept as a separate endpoint
    rather than widening GET /api/users itself, since that one is deliberately open and
    minimal for use as a name/role picker elsewhere in the UI (see module docstring)."""
    return db.scalars(select(models.User).order_by(models.User.full_name)).all()


@router.post("", response_model=schemas.UserAdminOut, status_code=201)
def create_user(
    payload: schemas.UserCreate,
    db: Session = Depends(get_db),
    _user: models.User = Depends(require_roles(*_USERS_WRITE_ROLES)),
):
    user = models.User(
        full_name=payload.full_name,
        email=payload.email,
        role=payload.role,
        password_hash=hash_password(payload.password) if payload.password else None,
        is_active=True,
        created_at=datetime.now(),
        # TODO_SPEC.md "משימה 14" step 5 (optional) — auto-generated "name + role"
        # signature for the new employee; they can edit or clear it afterwards via
        # PATCH /{user_id}/signature like any other signature.
        signature=_default_signature(payload.full_name, payload.role),
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(400, "Email already exists")
    db.refresh(user)
    return user


@router.patch("/{user_id}", response_model=schemas.UserAdminOut)
def update_user(
    user_id: int,
    payload: schemas.UserUpdate,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_roles(*_USERS_WRITE_ROLES)),
):
    user = db.get(models.User, user_id)
    if not user:
        raise HTTPException(404, "User not found")

    updates = payload.model_dump(exclude_unset=True)
    if updates.get("is_active") is False and user_id == admin.user_id:
        raise HTTPException(400, "לא ניתן להשבית את המשתמש המחובר (עצמך)")

    password = updates.pop("password", None)
    if password:
        user.password_hash = hash_password(password)
    for field, value in updates.items():
        setattr(user, field, value)

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(400, "Email already exists")
    db.refresh(user)
    return user


@router.patch("/{user_id}/signature", response_model=schemas.UserMeOut)
def update_my_signature(
    user_id: int,
    payload: schemas.UserSignatureUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Self-service only — see module docstring for why "not yours" is 403 here,
    unlike routers/emails.py's 404 convention. Any authenticated, active user (not
    just ADMIN — require_roles is deliberately not used here) may set/clear their own
    signature; nobody, including ADMIN, may set anyone else's through this endpoint."""
    if user_id != current_user.user_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "ניתן לעדכן חתימה אישית בלבד")

    # Reuses services/email.sanitize_body_html verbatim (same bleach allow-list as
    # Email.body_html) rather than a second sanitizer — TODO_SPEC.md "משימה 14" step 1.
    # None (clearing the signature) is left as None, not run through the sanitizer.
    current_user.signature = (
        sanitize_body_html(payload.signature) if payload.signature is not None else None
    )

    db.commit()
    db.refresh(current_user)
    return current_user
