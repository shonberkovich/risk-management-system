"""External economic-indices connector (inflation / construction-cost index).

`fetch_index_series`/`fetch_replacement_value_updates` now call the Central
Bureau of Statistics of Israel's (הלשכה המרכזית לסטטיסטיקה, CBS) real,
public, keyless price-index API (`https://api.cbs.gov.il/index/data/price`)
for real values — series 120010 ("מדד המחירים לצרכן - כללי", the general CPI)
and series 200010 ("מדד מחירי תשומה בבנייה למגורים - כללי", the residential
construction-input price index). This is exactly the series-level data
`economics.py`'s earlier BOI-based real connector (`fetch_boi_market_data`,
below) noted it couldn't get from BOI's public API ("BOI's public API does
not expose a raw CPI index level... unlike CBS's own API"). No key/account is
needed, same as the other four §12 connectors (home_front.py, seismology.py,
environmental.py, gis.py's reverse_geocode) — CBS's price API is open to
anonymous callers.

If the real CBS call fails or its response shape doesn't parse (unreachable
network, dataset restructured upstream), both functions fall back to the
original simulated construction-cost/CPI series — `_fetch_index_series_simulated`
below — same "never let an external dependency's downtime break the
replacement-value screen" spirit as the rest of app/integrations/, but here
the fallback is a full simulated result rather than an "unavailable" row,
because `EconomicIndexSeriesOut`/`ReplacementValueUpdateOut` (schemas.py)
don't model a partial/null reading for these fields — the caller has always
been able to assume a value comes back.

The course brief (see docs/README.md §8, "מחבר מדדים כלכליים") asks for an
inflation / construction-cost index used to keep a property's replacement
value current — real-estate replacement cost tracks construction-input
prices (concrete, steel, labor), not the general CPI, so this module reports
BOTH a construction-cost index and a general CPI, and uses the
construction-cost one for the actual replacement-value recommendation (CPI is
returned purely for context/comparison, the way a real index bulletin
reports several series side by side).

Design, contrasted with the other connectors:
- Like `gis.py` (and unlike `erp.py`), this module DOES compare its (real or
  simulated) external figure against RMIS's own data and flags a
  disagreement — here, "the construction-cost index has moved more than
  `_REVALUATION_THRESHOLD_PERCENT` since this property's `updated_at`, so its
  stored `replacement_value` is probably stale" is the actual point of an
  economic-index connector, just like a flood-zone mismatch is the point of
  the GIS one.
- The simulated fallback resembles `weather.py`'s (and unlike `gis.py`'s
  purely-spatial hash): the index value is time-varying, hashed per calendar
  month rather than per property, so every property shares the same
  simulated index value for the same month (matching how a real index
  publishes one national number per period, not one per address) —
  deterministic and stable within a month, but genuinely different a year
  later, same as a real CPI print. The real CBS path doesn't need this trick:
  CBS already publishes one real historical value per month.
- Like both `gis.py` and `erp.py`, this module is read-only: nothing here
  writes back to `Properties.replacement_value`. The suggested revaluation is
  a recommendation for whoever consumes this endpoint (e.g. a future "apply
  revaluation" action) to act on deliberately, not something silently applied
  on every request.
"""
import hashlib
import logging
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import models
from app.integrations._http import IntegrationFetchError, get_json

logger = logging.getLogger("rmis.integrations.economics")

# --- Real Bank of Israel (BOI) public API — TODO_SPEC.md §12 -----------------
# Everything above this line (fetch_index_series / fetch_replacement_value_updates)
# stays the pre-existing SIMULATED construction-cost index — see module docstring
# for why replacement-value revaluation deliberately uses a construction-input
# index rather than general CPI. What follows is new: a REAL call to the Bank of
# Israel's public "PublicApi" (https://boi.org.il/PublicApi/...), a genuinely free,
# keyless JSON API BOI publishes for exchange rates and the Consumer Price Index —
# unlike the other four connectors in this package, this one already had a
# simulated sibling in this same file, so it's added here rather than a new module,
# per TODO_SPEC.md §12's own file mapping ("backend/app/integrations/economics.py").
#
# GetExchangeRate returns the current representative rate for one ILS-quoted
# currency — confirmed working against a live call. BOI's own GetInflation
# endpoint, despite being documented, does NOT actually work: every call
# to it (verified live, not just in this sandbox) returns BOI's Radware
# bot-protection interstitial (HTTP 200, but an HTML "loader page", not
# JSON) rather than a real reading, so it can never produce anything but
# `status="unavailable"`. `cpi_yoy_percent` is sourced from CBS's price-index
# API instead (see the "Real CBS" section below) — CBS's per-month payload
# already publishes a `percentYear` field, which *is* the year-over-year CPI
# reading BOI's endpoint was supposed to provide, so no new HTTP call is
# needed beyond the one `fetch_index_series` already makes for the CPI index
# level (`_fetch_cbs_series_months(_CBS_CPI_SERIES_ID)`), just a different
# field off the same response.
#
# This is a live public endpoint reached from a sandboxed course-project dev
# environment that may not have outbound internet access at all — every call
# below is wrapped so a timeout/DNS failure/unexpected response shape degrades to
# a `status="unavailable"` row instead of ever letting an unreachable BOI service
# 500 this app (same convention as `app/integrations/_http.py`'s module docstring
# describes, and the same "AI features degrade gracefully without a key" spirit
# CLAUDE.md documents for routers/ai.py — the difference here is there's no key to
# check for; the endpoint itself is what might be unavailable).
_BOI_BASE_URL = "https://boi.org.il/PublicApi"

# BOI's currency parameter for GetExchangeRate — ISO 4217 codes, USD/EUR being the
# two a replacement-value review in Israel would actually care about (a shekel-
# denominated policy revalued against import-heavy construction costs).
_BOI_EXCHANGE_RATE_CURRENCIES = ("USD", "EUR")


def fetch_boi_market_data() -> dict:
    """Real call to the Bank of Israel's public API for the current USD/EUR
    representative exchange rates, plus the latest published y/y CPI
    (inflation) reading sourced from CBS instead of BOI's own (non-working)
    GetInflation endpoint — see the module-level comment above. Returns one
    row per series regardless of whether its own call actually succeeded;
    a failed series is reported with `status="unavailable"` and `value=None`
    rather than raising, so one flaky series never turns into a 500 for
    whoever calls this. The top-level `source_system` stays "BOI-PUBLIC-API"
    since BOI is still the source for two of the three series (USD/EUR); each
    row also carries its own `source_system` for exactly this kind of
    mixed-source case."""
    rows = []
    for currency in _BOI_EXCHANGE_RATE_CURRENCIES:
        rows.append(_fetch_boi_series(
            series_name=f"exchange_rate_{currency.lower()}",
            url=f"{_BOI_BASE_URL}/GetExchangeRate",
            params={"key": currency},
            value_keys=("currentExchangeRate", "rate", "exchangeRate", "value"),
            unit=f"ILS per {currency}",
        ))
    rows.append(_fetch_cbs_cpi_yoy_row())

    available = sum(1 for r in rows if r["status"] == "ok")
    logger.info(
        "[BOI PUBLIC API] fetched %d/%d series successfully",
        available, len(rows),
    )
    return {"as_of": date.today().isoformat(), "series": rows, "source_system": "BOI-PUBLIC-API"}


def _fetch_cbs_cpi_yoy_row() -> dict:
    """Real year-over-year CPI (inflation) reading from CBS's price-index API
    — the `cpi_yoy_percent` row `fetch_boi_market_data` reports, replacing
    BOI's non-working GetInflation endpoint (see module-level comment).
    Degrades to `status="unavailable"`/`value=None` if the CBS call fails or
    the current month's `percentYear` field is missing, same shape as every
    other series row here."""
    months = _fetch_cbs_series_months(_CBS_CPI_SERIES_ID)
    value = None
    if months:
        latest = _closest_cbs_row(months, date.today())
        value = latest.get("percent_year")
    return {
        "series": "cpi_yoy_percent",
        "value": value,
        "unit": "% year-over-year",
        "status": "ok" if value is not None else "unavailable",
        "source_system": "CBS-PUBLIC-API",
    }


def _fetch_boi_series(*, series_name: str, url: str, params: dict | None, value_keys: tuple[str, ...], unit: str) -> dict:
    """Fetches one BOI PublicApi series and normalizes it to a fixed row shape.
    BOI's response field name isn't pinned down in a formal schema this
    course project has a contract with, so `value_keys` is checked in order
    and the first present key wins — if the payload shape ever changes
    upstream, this degrades to `status="unavailable"` rather than raising."""
    try:
        payload = get_json(url, params=params)
        value = None
        for key in value_keys:
            if isinstance(payload, dict) and key in payload and payload[key] is not None:
                value = float(payload[key])
                break
        if value is None:
            raise IntegrationFetchError(f"none of {value_keys} present in BOI response for {series_name}")
        return {
            "series": series_name,
            "value": value,
            "unit": unit,
            "status": "ok",
            "source_system": "BOI-PUBLIC-API",
        }
    except (IntegrationFetchError, TypeError, ValueError) as exc:
        logger.warning("[BOI PUBLIC API] %s unavailable: %s", series_name, exc)
        return {
            "series": series_name,
            "value": None,
            "unit": unit,
            "status": "unavailable",
            "source_system": "BOI-PUBLIC-API",
        }

# --- Real CBS (הלשכה המרכזית לסטטיסטיקה) public price-index API ------------
# See module docstring for why this replaced the simulated series as the
# primary source. `https://api.cbs.gov.il/index/data/price?id=<series>` is a
# real, public, keyless JSON endpoint — no `backend/.env` key needed.
_CBS_BASE_URL = "https://api.cbs.gov.il/index/data/price"

# CBS series ids, confirmed against a live call to the endpoint above.
_CBS_CPI_SERIES_ID = 120010  # "מדד המחירים לצרכן - כללי" (general CPI)
_CBS_CONSTRUCTION_SERIES_ID = 200010  # "מדד מחירי תשומה בבנייה למגורים - כללי"

# CBS reports each month's Hebrew name (e.g. "יולי") in its base-period label
# ("2025 יולי") rather than a numeric month — used only to turn that label
# back into a real `date` for the `base_date` field below (itself informational,
# not used in any calculation).
_HEBREW_MONTH_NUMBERS = {
    "ינואר": 1, "פברואר": 2, "מרס": 3, "מרץ": 3, "אפריל": 4, "מאי": 5, "יוני": 6,
    "יולי": 7, "אוגוסט": 8, "ספטמבר": 9, "אוקטובר": 10, "נובמבר": 11, "דצמבר": 12,
}


def _parse_cbs_base_desc(base_desc: str | None) -> date | None:
    """Parses CBS's Hebrew base-period label (e.g. "2025 יולי") into a `date`
    (day fixed at 1st of month). Returns None if the label doesn't match the
    expected "<year> <hebrew month name>" shape — this only feeds an
    informational field, so an unparsable label degrades to None rather than
    raising."""
    if not base_desc:
        return None
    parts = base_desc.split()
    if len(parts) != 2 or not parts[0].isdigit():
        return None
    month = _HEBREW_MONTH_NUMBERS.get(parts[1])
    if month is None:
        return None
    return date(int(parts[0]), month, 1)


def _fetch_cbs_series_months(series_id: int) -> list[dict] | None:
    """Real call to CBS's public price-index API for one series id. Returns
    every published month as `{"year", "month", "value", "base_desc"}`
    (most-recent first, matching CBS's own order), or None if the call
    failed or the response shape didn't parse — callers treat None as
    "fall back to the simulated series" (see `fetch_index_series` below)."""
    try:
        payload = get_json(_CBS_BASE_URL, params={"id": series_id, "format": "json", "download": "false"})
    except IntegrationFetchError as exc:
        logger.warning("[CBS PUBLIC API] series %s fetch failed: %s", series_id, exc)
        return None

    # CBS wraps the series in a one-element "month" list containing the actual
    # per-month "date" array — see the module docstring's confirmed sample response.
    series_wrapper = ((payload or {}).get("month") or [{}])[0]
    date_rows = series_wrapper.get("date") if isinstance(series_wrapper, dict) else None

    rows = []
    for entry in date_rows or []:
        if not isinstance(entry, dict):
            continue
        curr_base = entry.get("currBase") or {}
        value = curr_base.get("value")
        year, month = entry.get("year"), entry.get("month")
        if value is None or year is None or month is None:
            continue
        percent_year = entry.get("percentYear")
        try:
            rows.append({
                "year": int(year),
                "month": int(month),
                "value": float(value),
                "base_desc": curr_base.get("baseDesc"),
                "percent_year": float(percent_year) if percent_year is not None else None,
            })
        except (TypeError, ValueError):
            continue

    if not rows:
        logger.warning("[CBS PUBLIC API] series %s returned no parsable monthly rows", series_id)
        return None
    return rows


def _closest_cbs_row(months: list[dict], as_of: date) -> dict:
    """Finds the CBS month row closest to `as_of` — at-or-before it when
    possible (CBS's most recent publication may lag the current calendar
    month by several weeks), otherwise the nearest one after it. `months`
    must be non-empty."""
    target_key = as_of.year * 12 + as_of.month
    best = months[0]
    best_score = None
    for row in months:
        key = row["year"] * 12 + row["month"]
        distance = abs(key - target_key)
        # Tie-break toward the at-or-before reading — a real replacement-value
        # review wants the latest *published* figure, not a future one.
        score = (distance, 0 if key <= target_key else 1)
        if best_score is None or score < best_score:
            best, best_score = row, score
    return best


# Base period the simulated index series is anchored to (index = 100.0 at
# this month). Arbitrary but fixed, so growth is always measured from the
# same origin regardless of when this module is called. Also used as the
# real-CBS-path fallback base_date when a series' baseDesc doesn't parse.
_BASE_DATE = date(2020, 1, 1)

# Simulated average monthly growth, expressed in basis points (1/100 of a
# percent) — construction-input prices (concrete, steel, labor) have
# historically outpaced general CPI, hence the higher rate here.
_CONSTRUCTION_INDEX_MONTHLY_RATE_BP = 35
_CPI_MONTHLY_RATE_BP = 20

# Deterministic month-to-month jitter added on top of the compounding trend,
# in basis points, so the simulated series isn't a perfectly smooth curve
# (a real index doesn't move by exactly the same amount every month).
_NOISE_RANGE_BP = 40

# How many percentage points the construction-cost index must have moved
# since a property's `updated_at` before its replacement_value is flagged as
# a candidate for revaluation.
_REVALUATION_THRESHOLD_PERCENT = 5.0


def _stable_hash(*parts: str) -> int:
    """Deterministic, process-independent hash (unlike Python's salted built-in
    `hash()`) so the same calendar month always yields the same simulated
    index value across calls/restarts — there's no real index bulletin to ask
    twice for a period that already published."""
    digest = hashlib.sha256("|".join(parts).encode("utf-8")).hexdigest()
    return int(digest[:8], 16)


def _months_between(start: date, end: date) -> int:
    return (end.year - start.year) * 12 + (end.month - start.month)


def _index_value(as_of: date, series_name: str, monthly_rate_bp: int) -> float:
    """Simulated compounding index value for `series_name` as of the month
    containing `as_of`, anchored to 100.0 at `_BASE_DATE`."""
    months = _months_between(_BASE_DATE, as_of)
    months = max(months, 0)  # never simulate a period before the base date
    trend = 100.0 * ((1 + monthly_rate_bp / 10_000) ** months)

    month_key = f"{as_of.year:04d}-{as_of.month:02d}"
    noise_bp = (_stable_hash(series_name, month_key) % (2 * _NOISE_RANGE_BP + 1)) - _NOISE_RANGE_BP
    return round(trend * (1 + noise_bp / 10_000), 4)


def fetch_index_series(as_of: date | None = None) -> dict:
    """Returns the construction-cost index and CPI for the month containing
    `as_of` (default: today), plus the base period they're anchored to. Tries
    the real CBS series first (see module docstring); falls back to the
    simulated series if either CBS call is unavailable. Both are reported the
    way a real index bulletin publishes several series side by side; only the
    construction-cost one drives the replacement-value recommendation below."""
    as_of = as_of or date.today()

    cpi_months = _fetch_cbs_series_months(_CBS_CPI_SERIES_ID)
    construction_months = _fetch_cbs_series_months(_CBS_CONSTRUCTION_SERIES_ID)
    if cpi_months and construction_months:
        cpi_row = _closest_cbs_row(cpi_months, as_of)
        construction_row = _closest_cbs_row(construction_months, as_of)
        base_date = _parse_cbs_base_desc(construction_row["base_desc"]) or _BASE_DATE
        logger.info(
            "[CBS PUBLIC API] index series as_of=%s: construction=%.4f (%04d-%02d) cpi=%.4f (%04d-%02d)",
            as_of.isoformat(), construction_row["value"], construction_row["year"], construction_row["month"],
            cpi_row["value"], cpi_row["year"], cpi_row["month"],
        )
        return {
            "as_of": as_of.isoformat(),
            "base_date": base_date.isoformat(),
            "construction_cost_index": construction_row["value"],
            "cpi_index": cpi_row["value"],
            "source_system": "CBS-PUBLIC-API",
        }

    logger.warning("[CBS PUBLIC API] index series unavailable — falling back to simulated series")
    return _fetch_index_series_simulated(as_of)


def _fetch_index_series_simulated(as_of: date) -> dict:
    """Simulated construction-cost index and CPI — see module docstring for
    why `fetch_index_series` falls back to this when the real CBS call
    doesn't succeed."""
    construction_index = _index_value(as_of, "construction", _CONSTRUCTION_INDEX_MONTHLY_RATE_BP)
    cpi_index = _index_value(as_of, "cpi", _CPI_MONTHLY_RATE_BP)

    logger.info(
        "[SIMULATED ECONOMICS PULL] index series as_of=%s: construction=%.4f cpi=%.4f",
        as_of.isoformat(), construction_index, cpi_index,
    )
    return {
        "as_of": as_of.isoformat(),
        "base_date": _BASE_DATE.isoformat(),
        "construction_cost_index": construction_index,
        "cpi_index": cpi_index,
        "source_system": "ECON-SIM",
    }


def fetch_replacement_value_updates(
    db: Session,
    property_ids: list[int] | None = None,
    as_of: date | None = None,
) -> list[dict]:
    """For each active property, compares the construction-cost index at the
    property's `updated_at` month against the index at `as_of`, and
    recommends a proportionally adjusted `replacement_value`. Flags
    `recommended_for_revaluation` when the drift exceeds
    `_REVALUATION_THRESHOLD_PERCENT`. Tries the real CBS construction-index
    series first (fetched once, not per property); falls back to the
    simulated series — for every property in the same call, never a mix of
    real and simulated rows in one response — if CBS is unavailable. Read-only
    — see module docstring for why nothing is written back to
    `Properties.replacement_value`."""
    as_of = as_of or date.today()

    stmt = select(models.Property).where(models.Property.is_active == True)  # noqa: E712
    if property_ids:
        stmt = stmt.where(models.Property.property_id.in_(property_ids))
    properties = db.scalars(stmt.order_by(models.Property.property_id)).all()

    construction_months = _fetch_cbs_series_months(_CBS_CONSTRUCTION_SERIES_ID)
    if construction_months:
        rows = _replacement_value_rows_real(properties, construction_months, as_of)
        source_label = "[CBS PUBLIC API]"
    else:
        logger.warning("[CBS PUBLIC API] replacement-value updates unavailable — falling back to simulated series")
        rows = _replacement_value_rows_simulated(properties, as_of)
        source_label = "[SIMULATED ECONOMICS PULL]"

    flagged = sum(1 for r in rows if r["recommended_for_revaluation"])
    logger.info(
        "%s evaluated replacement-value drift for %d properties (%d flagged for revaluation)",
        source_label, len(rows), flagged,
    )
    return rows


def _replacement_value_rows_real(properties, construction_months: list[dict], as_of: date) -> list[dict]:
    current_index = _closest_cbs_row(construction_months, as_of)["value"]
    rows = []
    for prop in properties:
        baseline_date = prop.updated_at.date() if prop.updated_at else _BASE_DATE
        baseline_index = _closest_cbs_row(construction_months, baseline_date)["value"]
        rows.append(_replacement_value_row(prop, baseline_date, baseline_index, current_index, as_of, "CBS-PUBLIC-API", "ok"))
    return rows


def _replacement_value_rows_simulated(properties, as_of: date) -> list[dict]:
    current_index = _index_value(as_of, "construction", _CONSTRUCTION_INDEX_MONTHLY_RATE_BP)
    rows = []
    for prop in properties:
        baseline_date = prop.updated_at.date() if prop.updated_at else _BASE_DATE
        baseline_index = _index_value(baseline_date, "construction", _CONSTRUCTION_INDEX_MONTHLY_RATE_BP)
        rows.append(_replacement_value_row(prop, baseline_date, baseline_index, current_index, as_of, "ECON-SIM", "simulated_index"))
    return rows


def _replacement_value_row(prop, baseline_date: date, baseline_index: float, current_index: float, as_of: date, source_system: str, status: str) -> dict:
    current_value = float(prop.replacement_value)
    growth_factor = current_index / baseline_index
    suggested_value = round(current_value * growth_factor, 2)
    drift_percent = round((suggested_value - current_value) / current_value * 100, 2) if current_value else 0.0
    return {
        "property_id": prop.property_id,
        "property_code": prop.property_code,
        "name": prop.name,
        "current_replacement_value": current_value,
        "suggested_replacement_value": suggested_value,
        "drift_percent": drift_percent,
        "baseline_date": baseline_date.isoformat(),
        "as_of": as_of.isoformat(),
        "recommended_for_revaluation": abs(drift_percent) > _REVALUATION_THRESHOLD_PERCENT,
        "source_system": source_system,
        "status": status,
    }
