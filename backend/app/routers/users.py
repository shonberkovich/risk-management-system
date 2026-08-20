"""User lookup + administration.

GET / (list) stays open and minimal (name + role only) — it exists mainly to power UI
pickers (e.g. assigning an executor to a mitigation task) with real names instead of
raw user_ids, not as an admin surface. The write endpoints below (create, edit, role
change, disable — TODO_SPEC.md §2 "ניהול משתמשים") are ADMIN-only and return the
fuller UserAdminOut shape. There is still no self-service registration/password-reset
flow and no server-side session/token revocation beyond the is_active check
(dependencies/permissions.get_current_user) — that remains out of scope for this
course demo, same as documented for auth generally in routers/auth.py.
"""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import models, schemas
from app.database import get_db
from app.dependencies.permissions import require_roles
from app.services.auth import hash_password

router = APIRouter(prefix="/api/users", tags=["users"])

_USERS_WRITE_ROLES = ("ADMIN",)


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
