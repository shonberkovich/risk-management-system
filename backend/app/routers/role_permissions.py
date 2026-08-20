"""Role_Permissions CRUD — TODO_SPEC.md §2, "ניהול Role_Permissions".

Important scope note: this manages the *catalog* of what each role is documented to
be permitted to do (role, permission_key, description) — it replaces the fixed
seed.py list as the editable source for that catalog. It does **not** change how
authorization is actually enforced: every router still gates writes with hardcoded
`require_roles(*roles)` tuples (see dependencies/permissions.py), same as before this
task. Wiring live enforcement to read from this table dynamically would touch every
router's role tuples and is a materially larger change than "view/edit the permission
catalog" — out of scope here, consistent with how this table has always been
descriptive/reference data (seed.py's comment above the INSERT) rather than something
any endpoint queries at request time.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import models, schemas
from app.database import get_db
from app.dependencies.permissions import require_roles

router = APIRouter(prefix="/api/role-permissions", tags=["role-permissions"])

# Same ADMIN-only convention as routers/users.py — editing the permission catalog is
# an administrative action.
_ROLE_PERMISSIONS_WRITE_ROLES = ("ADMIN",)


@router.get("", response_model=list[schemas.RolePermissionOut])
def list_role_permissions(role: str | None = None, db: Session = Depends(get_db)):
    stmt = select(models.RolePermission).order_by(
        models.RolePermission.role, models.RolePermission.permission_key
    )
    if role:
        stmt = stmt.where(models.RolePermission.role == role)
    return db.scalars(stmt).all()


@router.post("", response_model=schemas.RolePermissionOut, status_code=201)
def create_role_permission(
    payload: schemas.RolePermissionCreate,
    db: Session = Depends(get_db),
    _user: models.User = Depends(require_roles(*_ROLE_PERMISSIONS_WRITE_ROLES)),
):
    row = models.RolePermission(**payload.model_dump())
    db.add(row)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(400, "Permission already exists for this role")
    db.refresh(row)
    return row


@router.patch("/{role_permission_id}", response_model=schemas.RolePermissionOut)
def update_role_permission(
    role_permission_id: int,
    payload: schemas.RolePermissionUpdate,
    db: Session = Depends(get_db),
    _user: models.User = Depends(require_roles(*_ROLE_PERMISSIONS_WRITE_ROLES)),
):
    row = db.get(models.RolePermission, role_permission_id)
    if not row:
        raise HTTPException(404, "Role permission not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(row, field, value)
    db.commit()
    db.refresh(row)
    return row


@router.delete("/{role_permission_id}", status_code=204)
def delete_role_permission(
    role_permission_id: int,
    db: Session = Depends(get_db),
    _user: models.User = Depends(require_roles(*_ROLE_PERMISSIONS_WRITE_ROLES)),
):
    row = db.get(models.RolePermission, role_permission_id)
    if not row:
        raise HTTPException(404, "Role permission not found")
    db.delete(row)
    db.commit()
