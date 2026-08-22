import asyncio
import contextlib
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.responses import RedirectResponse

from app.config import settings
from app.middleware.audit import AuditLogMiddleware
from app.routers import (
    ai,
    analytics,
    audit,
    auth,
    claims,
    compliance,
    documents,
    email_rules,
    email_templates,
    emails,
    financials,
    incidents,
    integrations,
    labels,
    media,
    mitigation,
    notifications,
    policies,
    properties,
    retention,
    risk_profiles,
    role_permissions,
    simulation,
    sse,
    users,
)
from app.services.scheduler import start_scheduled_email_poller


@asynccontextmanager
async def lifespan(app: FastAPI):
    # TODO_SPEC.md "משימה 13" step 4 — starts the scheduled-email poller (see
    # app/services/scheduler.py for why this beats a per-email asyncio.sleep,
    # and why it's skipped entirely under pytest). `poller_task` is None under
    # pytest, in which case there's nothing to cancel on shutdown either.
    poller_task = start_scheduled_email_poller()
    try:
        yield
    finally:
        if poller_task is not None:
            poller_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await poller_task


app = FastAPI(
    title="RMIS API", description="Risk Management Information System", version="0.1.0", lifespan=lifespan
)

# Restricted to known frontend origins (settings.cors_origins) — never "*" with
# allow_credentials=True, which browsers reject anyway and which would defeat the point
# of restricting origins at all.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_middleware(AuditLogMiddleware)


@app.middleware("http")
async def https_redirect(request: Request, call_next):
    # Off by default (see config.py) — local `uvicorn --reload` has no TLS cert. Turn on
    # behind a reverse proxy that terminates TLS and forwards X-Forwarded-Proto.
    if settings.force_https and request.url.scheme == "http":
        forwarded_proto = request.headers.get("x-forwarded-proto", request.url.scheme)
        if forwarded_proto != "https":
            return RedirectResponse(url=str(request.url.replace(scheme="https")), status_code=308)
    return await call_next(request)


app.include_router(auth.router)
app.include_router(properties.router)
app.include_router(risk_profiles.router)
app.include_router(role_permissions.router)
app.include_router(incidents.router)
app.include_router(policies.router)
app.include_router(claims.router)
app.include_router(mitigation.router)
app.include_router(media.router)
app.include_router(analytics.router)
app.include_router(simulation.router)
app.include_router(retention.router)
app.include_router(documents.router)
app.include_router(users.router)
app.include_router(ai.router)
app.include_router(integrations.router)
app.include_router(notifications.router)
app.include_router(compliance.router)
app.include_router(financials.router)
app.include_router(audit.router)
app.include_router(sse.router)
app.include_router(emails.router)
app.include_router(email_templates.router)
app.include_router(labels.router)
app.include_router(email_rules.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}
