"""One-off copy of every row from the local SQL Server LocalDB (RiskDB) into the
cloud Postgres database (Neon), keeping the same primary-key ids.

    venv\\Scripts\\python.exe -m scripts.copy_to_cloud            # copy
    venv\\Scripts\\python.exe -m scripts.copy_to_cloud --verify   # only compare row counts

Reads the target URL from CLOUD_DATABASE_URL (env var or backend/.env). The source
is only ever read — nothing is written to or deleted from LocalDB. Refuses to run if
any target table already holds rows, so it can't double-insert or clobber cloud data.

Rows go through the same SQLAlchemy column types the app uses, so encrypted columns
(services/encryption.py) are decrypted with FIELD_ENCRYPTION_KEY and re-encrypted with
it on the way in: the cloud must run with the same FIELD_ENCRYPTION_KEY as local.
"""
from __future__ import annotations

import os
import sys
import urllib.parse

from dotenv import dotenv_values
from sqlalchemy import create_engine, func, inspect, select, text

from app import models  # noqa: F401 — registers every table on Base.metadata
from app.config import _ENV_FILE
from app.database import Base, get_connection_string, normalize_postgres_url


def _engines():
    url = os.environ.get("CLOUD_DATABASE_URL") or dotenv_values(_ENV_FILE).get("CLOUD_DATABASE_URL")
    if not url:
        sys.exit("CLOUD_DATABASE_URL is not set (backend/.env or environment).")
    source = create_engine("mssql+pyodbc:///?odbc_connect=" + urllib.parse.quote_plus(get_connection_string()))
    target = create_engine(normalize_postgres_url(url))
    return source, target


def _counts(engine) -> dict[str, int]:
    with engine.connect() as conn:
        return {t.name: conn.scalar(select(func.count()).select_from(t)) for t in Base.metadata.sorted_tables}


def verify(source, target) -> bool:
    src, dst = _counts(source), _counts(target)
    ok = True
    for name in src:
        mark = "OK " if src[name] == dst[name] else "MISMATCH"
        ok &= src[name] == dst[name]
        print(f"{mark} {name:<26} local={src[name]:<6} cloud={dst[name]}")
    return ok


def copy(source, target) -> None:
    Base.metadata.create_all(target)
    existing = {n: c for n, c in _counts(target).items() if c}
    if existing:
        sys.exit(f"Cloud database already has data, refusing to copy: {existing}")

    with source.connect() as src, target.begin() as dst:
        for table in Base.metadata.sorted_tables:
            pk = list(table.primary_key.columns)
            rows = [dict(r._mapping) for r in src.execute(select(table).order_by(*pk))]
            if rows:
                dst.execute(table.insert(), rows)
            print(f"{table.name:<26} {len(rows)} rows")

        # Inserting explicit ids doesn't advance Postgres' identity sequences; move each
        # past the copied max id so the app's next INSERT doesn't collide.
        for table in Base.metadata.sorted_tables:
            for col in table.primary_key.columns:
                seq = dst.scalar(text("SELECT pg_get_serial_sequence(:t, :c)"), {"t": f'"{table.name}"', "c": col.name})
                if seq:
                    dst.execute(
                        text(f'SELECT setval(:s, COALESCE((SELECT MAX("{col.name}") FROM "{table.name}"), 0) + 1, false)'),
                        {"s": seq},
                    )


def main() -> None:
    source, target = _engines()
    if "--verify" not in sys.argv:
        copy(source, target)
    print("\nRow-count check:")
    sys.exit(0 if verify(source, target) else 1)


if __name__ == "__main__":
    main()
