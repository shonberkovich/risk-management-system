"""Read-only user lookup. Exists solely to power UI pickers (e.g. assigning an
executor to a mitigation task) with real names instead of raw user_ids; it is
NOT an auth/user-management surface — no login, sessions, or permission
enforcement here. See CLAUDE.md "Deliberately out of scope"."""
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import models, schemas
from app.database import get_db

router = APIRouter(prefix="/api/users", tags=["users"])


@router.get("", response_model=list[schemas.UserOut])
def list_users(db: Session = Depends(get_db)):
    return db.scalars(select(models.User).order_by(models.User.full_name)).all()
