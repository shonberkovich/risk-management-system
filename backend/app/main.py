from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.responses import RedirectResponse

from app.config import settings
from app.middleware.audit import AuditLogMiddleware
from app.routers import (
    ai,
    analytics,
    auth,
    claims,
    compliance,
    documents,
    financials,
    incidents,
    integrations,
    media,
    mitigation,
    notifications,
    policies,
    properties,
    retention,
    simulation,
    users,
)

app = FastAPI(title="RMIS API", description="Risk Management Information System", version="0.1.0")

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


@app.get("/api/health")
def health():
    return {"status": "ok"}
