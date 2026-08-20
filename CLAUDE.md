# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

RMIS (Risk Management Information System) — a full-stack demo built for a graduate Risk Management course. Connects physical asset/hazard/incident data to financial insurance/claims data, with a Claude-powered AI layer (incident classification, streaming executive summaries, natural-language data Q&A). Full architecture and design rationale: [docs/README.md](docs/README.md). ERD: [docs/erd.md](docs/erd.md).

## Commands

**Backend** (from `backend/`, after `venv\Scripts\activate`):
```bash
uvicorn app.main:app --reload          # dev server → http://localhost:8000 (Swagger at /docs)
python -m app.seed                     # reset + reload demo data (see "Hebrew text" gotcha below)
sqlcmd -S "(localdb)\MSSQLLocalDB" -C -i sql\schema.sql   # (re)create schema on a FRESH DB — run before seeding
python -m pytest -q                    # backend/tests/ — in-memory SQLite, no real DB needed, ~50 tests
alembic revision --autogenerate -m "..."  # generate a migration for a *schema change* to an EXISTING DB
alembic upgrade head                      # apply pending migrations
```
`sql/schema.sql` is still how a fresh DB gets its schema (see `backend/alembic/versions/*_baseline_*.py`'s docstring for why); Alembic (`backend/alembic/`) is for incremental changes to an already-provisioned DB going forward — after editing `models.py`, also update `sql/schema.sql` to match (fresh installs) *and* add an Alembic revision (existing installs), same as this repo has always kept `models.py`/`schema.sql` in sync by hand. `alembic revision --autogenerate` reliably flags real model changes but also always re-flags a fixed set of cosmetic diffs (DATETIME2 vs DateTime rendering, a few indexes schema.sql created that aren't mirrored as `Index(...)` in models.py) — review the generated migration by hand before trusting it, don't apply it blindly.

**Frontend** (from `frontend/`):
```bash
npm run dev       # dev server → http://localhost:5173, proxies /api → :8000 (see vite.config.ts)
npm run build     # tsc -b && vite build
```

Both dev servers are also defined in `.claude/launch.json` for the `preview_start` tool (`backend`, `frontend` configs).

## Architecture

**Request flow:** React (RTL, Hebrew UI) → axios (`frontend/src/api/client.ts`, typed to mirror `backend/app/schemas.py`) → FastAPI routers (`backend/app/routers/*.py`) → SQLAlchemy ORM (`backend/app/models.py`) → SQL Server LocalDB (`RiskDB`) via pyodbc. AI endpoints (`routers/ai.py`) call `backend/app/services/llm.py`, which uses `client.messages.parse()` (structured outputs), `client.messages.stream()`, and `client.beta.messages.tool_runner()` against `claude-opus-5`.

**Value chain the whole schema is organized around:** `Properties → Asset_Risk_Profiles → Incidents → Claims → Claim_Payments`, with `Insurance_Policies ↔ Properties` as a many-to-many via `Policy_Assets`, and `Mitigation_Tasks` as a separate branch off `Properties`. Most cross-cutting features (KPIs, the risk matrix, the map) join across several of these tables — see `backend/app/services/kpi.py` for the aggregate calculations (TIV, MFL via geographic clustering, Loss Ratio, per-property risk score, mitigation ROI) before modifying any single table's shape.

**AI tool-use Q&A is deliberately constrained:** `POST /api/ai/ask` never lets the model generate SQL. `llm.py` defines five fixed, parameterized query tools (`get_kpis`, `query_properties`, `query_claims`, `query_incidents`, `query_mitigation_tasks`); Claude only picks a tool + params. Keep new data-access tools in that same shape if extending the Q&A feature.

**AI features degrade gracefully without a key:** every `/api/ai/*` endpoint checks `ANTHROPIC_API_KEY` (from `backend/.env`, gitignored) up front and returns a clean 503 rather than crashing.

## Non-obvious gotchas (see docs/README.md §9 for full writeups)

- **SQL Server text columns must use SQLAlchemy `Unicode`/`UnicodeText`, not generic `String`/`Text`** — the generic types make pyodbc bind params as narrow ANSI, silently corrupting Hebrew to `?` on INSERT even though the DB column is `NVARCHAR`. Already applied throughout `models.py`; keep it for any new text column.
- **Never load seed/demo data via `sqlcmd -i` on a `.sql` file containing Hebrew literals** — encoding mismatches corrupt the text at load time. `app/seed.py` loads data via parameterized pyodbc calls instead; extend that script, not `sql/seed.sql`, if you need to change demo data.
- **Reseeding IDs:** `DBCC CHECKIDENT (..., RESEED, 0)` behaves differently on a table that has *never* had a row inserted (next ID becomes `0`) vs. one that has (next ID becomes `1`). `schema.sql` always drops and recreates all tables (in FK-safe order) before `app/seed.py` runs, so don't reseed without also rerunning `schema.sql` first.
- **`uvicorn --reload` can wedge** after rapid successive edits on Windows (symptom: `RuntimeWarning: coroutine 'Server.serve' was never awaited`, stale code still serving). If behavior doesn't match a recent edit, stop and restart the server process rather than trusting the reloader.


