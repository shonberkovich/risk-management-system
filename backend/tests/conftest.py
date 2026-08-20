"""Shared pytest fixtures for backend unit/integration tests.

Tests run against an in-memory SQLite database, not the real SQL Server LocalDB —
`app/models.py` only uses portable SQLAlchemy types (Unicode/Numeric/Date/...), no
mssql-dialect-specific constructs, so `Base.metadata.create_all()` against SQLite is
enough to exercise the ORM layer and the pure-Python calculation services in
`app/services/*.py` without needing a real SQL Server instance in CI or on a dev
machine that hasn't run `sqlcmd -i sql/schema.sql` yet. Route-level tests (test_api_*)
additionally override the app's `get_db` dependency so FastAPI's TestClient talks to
the same in-memory database instead of the real one configured in `app/database.py`.
"""
from __future__ import annotations

from datetime import date, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import BigInteger, create_engine
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app import models
from app.database import Base, get_db
from app.services.auth import create_access_token, hash_password


# SQLite only auto-increments a primary key column whose *declared* type is exactly
# "INTEGER" (its ROWID-alias rule) — "BIGINT" (what SQLAlchemy's BigInteger normally
# compiles to, and what every primary key in app/models.py uses, to match SQL Server)
# is just a regular NOT NULL column with no default there, so router code that inserts
# a row without setting the PK by hand (the normal pattern everywhere in app/routers/,
# relying on SQL Server IDENTITY) would fail on SQLite with a NOT NULL violation. This
# makes the SQLite dialect compile BigInteger as INTEGER so its autoincrement rule
# applies — dialect-scoped, so it has no effect on the real mssql engine.
@compiles(BigInteger, "sqlite")
def _bigint_as_integer_on_sqlite(type_, compiler, **kw):
    return "INTEGER"


@pytest.fixture()
def engine():
    # StaticPool + check_same_thread=False: a single shared in-memory SQLite connection
    # for the whole test (otherwise each new connection gets its own empty :memory: db).
    eng = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(eng)
    yield eng
    eng.dispose()


@pytest.fixture()
def db(engine) -> Session:
    session_local = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    session = session_local()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture()
def client(engine, monkeypatch):
    """FastAPI TestClient wired to the same in-memory SQLite engine as the `db` fixture
    (both are bound to `engine`, and StaticPool means every session shares the one
    underlying SQLite connection — so data a test writes via `db`/the `make_*` factory
    fixtures is visible to requests made through this client, and vice versa).

    Two things need overriding to keep the whole request cleanly inside SQLite:
    1. `app.database.get_db` — the normal FastAPI dependency-injection path.
    2. `app.middleware.audit.SessionLocal` — AuditLogMiddleware opens its own session
       directly from the module-level `SessionLocal` (it runs outside the DI graph),
       which by default is bound to the real SQL Server engine; left un-patched, every
       mutating request in a test would try to open a real SQL Server connection.
    """
    import app.middleware.audit as audit_middleware
    from app.main import app

    session_local = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    def _override_get_db():
        session = session_local()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_db] = _override_get_db
    monkeypatch.setattr(audit_middleware, "SessionLocal", session_local)

    with TestClient(app) as test_client:
        yield test_client

    app.dependency_overrides.clear()


@pytest.fixture()
def make_user(db: Session):
    """Factory fixture: make_user(role="ADMIN", **overrides) -> (User, auth_headers).
    Password is always DEMO_PASSWORD (matches app/seed.py's convention) — tests log in
    through the real /api/auth/login flow rather than minting tokens by hand, so the
    integration tests actually exercise the login endpoint too."""
    counter = {"n": 0}
    DEMO_PASSWORD = "Demo1234!"

    def _make(role: str = "ADMIN", **overrides) -> models.User:
        counter["n"] += 1
        n = counter["n"]
        defaults = dict(
            user_id=n,
            full_name=f"משתמש בדיקה {n}",
            email=f"test-user-{n}@example.com",
            role=role,
            password_hash=hash_password(DEMO_PASSWORD),
            created_at=datetime(2024, 1, 1),
        )
        defaults.update(overrides)
        user = models.User(**defaults)
        db.add(user)
        db.commit()
        return user

    return _make


def auth_headers(user: models.User) -> dict[str, str]:
    """Bearer header for `user`, minted directly via create_access_token (not through
    /api/auth/login) — used by tests that only care about RBAC on a *different*
    endpoint and don't need to re-exercise the login flow each time."""
    token = create_access_token(user.user_id, user.role)
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture()
def make_property(db: Session):
    """Factory fixture: make_property(**overrides) -> Property, already added+flushed."""
    counter = {"n": 0}

    def _make(**overrides) -> models.Property:
        counter["n"] += 1
        n = counter["n"]
        defaults = dict(
            # SQLite only auto-increments a plain INTEGER PRIMARY KEY, not BigInteger —
            # assign ids explicitly so tests don't depend on that dialect quirk.
            property_id=n,
            property_code=f"PRP-{n:03d}",
            name=f"נכס בדיקה {n}",
            address="רחוב הבדיקה 1",
            region="מרכז",
            latitude=32.08 + n * 0.01,
            longitude=34.78 + n * 0.01,
            asset_type="OFFICE_BUILDING",
            replacement_value=10_000_000,
            book_value=8_000_000,
            is_active=True,
            created_at=datetime(2024, 1, 1),
            updated_at=datetime(2024, 1, 1),
        )
        defaults.update(overrides)
        prop = models.Property(**defaults)
        db.add(prop)
        db.commit()
        return prop

    return _make


@pytest.fixture()
def make_risk_profile(db: Session):
    counter = {"n": 0}

    def _make(property_id: int, **overrides) -> models.AssetRiskProfile:
        counter["n"] += 1
        defaults = dict(
            profile_id=counter["n"],
            property_id=property_id,
            survey_date=date(2024, 1, 1),
            flood_risk_score=2,
            fire_risk_score=2,
            earthquake_risk_score=2,
            mfl_amount=1_000_000,
            has_sprinklers=False,
        )
        defaults.update(overrides)
        profile = models.AssetRiskProfile(**defaults)
        db.add(profile)
        db.commit()
        return profile

    return _make


@pytest.fixture()
def make_policy(db: Session):
    counter = {"n": 0}

    def _make(**overrides) -> models.InsurancePolicy:
        counter["n"] += 1
        n = counter["n"]
        defaults = dict(
            policy_id=n,
            policy_number=f"POL-{n:03d}",
            insurer_name="מבטח בדיקה",
            start_date=date(2024, 1, 1),
            end_date=date(2025, 1, 1),
            total_limit=50_000_000,
            deductible_default=50_000,
            annual_premium=500_000,
            status="ACTIVE",
        )
        defaults.update(overrides)
        policy = models.InsurancePolicy(**defaults)
        db.add(policy)
        db.commit()
        return policy

    return _make


@pytest.fixture()
def make_incident(db: Session):
    counter = {"n": 0}

    def _make(property_id: int, **overrides) -> models.Incident:
        counter["n"] += 1
        n = counter["n"]
        defaults = dict(
            incident_id=n,
            incident_code=f"INC-TEST-{n:03d}",
            property_id=property_id,
            incident_timestamp=datetime(2024, 6, 1),
            hazard_type="FIRE",
            severity_level="MEDIUM",
            operational_impact="PARTIAL_SHUTDOWN",
            initial_estimated_loss=100_000,
            description="אירוע בדיקה",
            status="NEW",
            created_at=datetime(2024, 6, 1),
        )
        defaults.update(overrides)
        incident = models.Incident(**defaults)
        db.add(incident)
        db.commit()
        return incident

    return _make


@pytest.fixture()
def make_claim(db: Session):
    counter = {"n": 0}

    def _make(incident_id: int, policy_id: int, **overrides) -> models.Claim:
        counter["n"] += 1
        n = counter["n"]
        defaults = dict(
            claim_id=n,
            claim_number=f"CLM-TEST-{n:03d}",
            incident_id=incident_id,
            policy_id=policy_id,
            claimed_amount=100_000,
            deductible_applied=0,
            approved_amount=0,
            claim_status="SUBMITTED",
            created_at=datetime(2024, 6, 2),
        )
        defaults.update(overrides)
        claim = models.Claim(**defaults)
        db.add(claim)
        db.commit()
        return claim

    return _make


@pytest.fixture()
def make_mitigation_task(db: Session):
    counter = {"n": 0}

    def _make(property_id: int, **overrides) -> models.MitigationTask:
        counter["n"] += 1
        n = counter["n"]
        defaults = dict(
            task_id=n,
            property_id=property_id,
            title=f"משימת בדיקה {n}",
            cost_estimate=100_000,
            expected_annual_savings=20_000,
            due_date=date(2025, 1, 1),
            status="OPEN",
            created_at=datetime(2024, 1, 1),
        )
        defaults.update(overrides)
        task = models.MitigationTask(**defaults)
        db.add(task)
        db.commit()
        return task

    return _make
