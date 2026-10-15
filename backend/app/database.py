import urllib.parse

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import settings


def get_connection_string() -> str:
    """Raw ODBC connection string, used directly by pyodbc (e.g. in seed.py)."""
    return (
        f"DRIVER={{{settings.db_driver}}};"
        f"SERVER={settings.db_server};"
        f"DATABASE={settings.db_name};"
        "Trusted_Connection=yes;"
    )


def get_sqlalchemy_url() -> str:
    if settings.database_url:
        return normalize_postgres_url(settings.database_url)
    params = urllib.parse.quote_plus(get_connection_string())
    return f"mssql+pyodbc:///?odbc_connect={params}"


def normalize_postgres_url(url: str) -> str:
    """Neon/Render hand out "postgres://" or "postgresql://" URLs; point them at the
    psycopg (v3) driver this project installs instead of SQLAlchemy's psycopg2 default."""
    for prefix in ("postgres://", "postgresql://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix):]
    return url


engine = create_engine(get_sqlalchemy_url(), pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db: Session = SessionLocal()
    try:
        yield db
    finally:
        db.close()
