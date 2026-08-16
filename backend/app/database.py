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
    params = urllib.parse.quote_plus(get_connection_string())
    return f"mssql+pyodbc:///?odbc_connect={params}"


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
