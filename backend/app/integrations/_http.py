"""Shared outbound-HTTP helper for the *real* external connectors added under
TODO_SPEC.md §12 (home_front.py, seismology.py, environmental.py, plus the
new calls added to economics.py and gis.py). This is a deliberate departure
from the rest of app/integrations/ (erp.py, weather.py, and the original
economics.py/gis.py content), which are documented "simulated" connectors
with no outbound network call — see those modules' docstrings for why. The
five endpoints TODO_SPEC.md §12 asks for (Home Front Command, GSI
seismology, data.gov.il hazmat sites, Bank of Israel CPI/exchange rates, OSM
Nominatim reverse geocoding) are all real, free, public, keyless APIs, so
this batch calls them for real instead of simulating.

Every caller in this package MUST go through `get_json`/`get_text` here
rather than opening its own `httpx.Client` — centralizing the request means:

1. One place sets a sane connect+read timeout (`_DEFAULT_TIMEOUT_SECONDS`)
   so a slow/unreachable public endpoint can't hang a request thread.
2. One place swallows every network-shaped failure (timeout, connection
   error, non-2xx status, malformed JSON) into a single `IntegrationFetchError`
   with the original exception preserved as `__cause__` for logging — callers
   catch that one type and degrade gracefully (return an empty/`unavailable`
   result) instead of letting a live public API's downtime 500 the app. This
   mirrors the "AI features degrade gracefully without a key" convention
   already documented in CLAUDE.md for routers/ai.py: a dependency outside
   this codebase being flaky is not this app's 500 to throw.
3. Tests can mock exactly one function (`app.integrations._http.get_json`)
   instead of reaching into `httpx` internals per-module, and the whole test
   suite never needs live internet access to pass.
"""
from __future__ import annotations

import logging

import httpx

logger = logging.getLogger("rmis.integrations.http")

# Generous enough for a public API on a slow connection, short enough that a
# hung endpoint doesn't stall a request thread indefinitely. Applies to both
# the connect and the read phase (httpx.Timeout with a single float covers both).
_DEFAULT_TIMEOUT_SECONDS = 6.0

# Nominatim's usage policy (https://operations.osmfoundation.org/policies/nominatim/)
# requires a descriptive User-Agent identifying the application — no real email/PII,
# since this header ships in every committed-source request and the course project
# has no dedicated support address. Reused for the other four connectors too: it's a
# harmless, honest thing to send to any public API and several (data.gov.il, GSI) also
# publish etiquette guidance asking for an identifiable client.
USER_AGENT = "RMIS-CourseProject/1.0 (+https://github.com; educational risk-management demo)"


class IntegrationFetchError(RuntimeError):
    """Raised by get_json/get_text for any network-shaped failure (timeout,
    connection error, non-2xx status, malformed response body). Callers in
    this package catch this specifically and degrade gracefully — never let
    it propagate into a router as an unhandled 500."""


def get_json(url: str, *, params: dict | None = None, headers: dict | None = None):
    """GET `url` and parse the response body as JSON. Raises
    IntegrationFetchError (chaining the original exception) on any timeout,
    connection failure, non-2xx status, or non-JSON body — never raises the
    underlying httpx/JSON exception directly, so every caller has exactly one
    exception type to catch."""
    merged_headers = {"User-Agent": USER_AGENT}
    if headers:
        merged_headers.update(headers)
    try:
        resp = httpx.get(url, params=params, headers=merged_headers, timeout=_DEFAULT_TIMEOUT_SECONDS)
        resp.raise_for_status()
        return resp.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise IntegrationFetchError(f"GET {url} failed: {exc}") from exc


def get_text(url: str, *, params: dict | None = None, headers: dict | None = None) -> str:
    """Same as get_json but returns the raw response body as text — for feeds
    that publish plain text/CSV rather than JSON (e.g. the GSI seismology
    bulletin)."""
    merged_headers = {"User-Agent": USER_AGENT}
    if headers:
        merged_headers.update(headers)
    try:
        resp = httpx.get(url, params=params, headers=merged_headers, timeout=_DEFAULT_TIMEOUT_SECONDS)
        resp.raise_for_status()
        return resp.text
    except httpx.HTTPError as exc:
        raise IntegrationFetchError(f"GET {url} failed: {exc}") from exc
