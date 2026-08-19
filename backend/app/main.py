from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routers import ai, analytics, claims, incidents, media, mitigation, policies, properties, simulation

app = FastAPI(title="RMIS API", description="Risk Management Information System", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(properties.router)
app.include_router(incidents.router)
app.include_router(policies.router)
app.include_router(claims.router)
app.include_router(mitigation.router)
app.include_router(media.router)
app.include_router(analytics.router)
app.include_router(simulation.router)
app.include_router(ai.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}
