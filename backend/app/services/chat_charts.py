"""Charts inside the AI assistant chat: the display-only `show_chart` tool the
orchestrator offers every role, and the server-side sanitizing of whatever the
model passes it.

The model fills a chart only from data it already has in the turn (the prompt
snapshots and the role-gated data tools' results), so this exposes nothing new
— it just changes how an answer is shown. Model input is untrusted: every
chart is re-built through `sanitize_chart` (bounded sizes, numeric values only)
before it reaches the client or the session history.
"""
from __future__ import annotations

import math
import re
from typing import Literal

from anthropic import beta_tool
from pydantic import BaseModel

CHART_TOOL_NAME = "show_chart"
CHART_TYPES = ("bar", "line", "pie")

MAX_POINTS = 50
MAX_SERIES = 4
MAX_CHARTS_PER_TURN = 3
_MAX_TITLE = 80
_MAX_AXIS_LABEL = 40
_MAX_POINT_LABEL = 40
_MAX_SERIES_NAME = 30
_MAX_UNIT = 8
_MAX_ABS_VALUE = 1e15

# What show_chart answers when the tool runner does execute it (replayed
# history included) — the chart itself never needs a round trip.
CHART_SHOWN = "הגרף הוצג למשתמש."

CHART_PROMPT = (
    "כשהמשתמש מבקש גרף/תרשים/המחשה, או כשהשוואה בין כמה ערכים ברורה יותר כגרף, כתוב קודם תשובה קצרה "
    "(משפט אחד, בלי לפרט שוב את כל הערכים) ואז קרא ל-show_chart עם הנתונים מתמונת המצב או מתוצאות הכלים בלבד. "
    "אחרת אל תשתמש בו."
)


class ChatChartPoint(BaseModel):
    label: str
    values: list[float | None]


class ChatChart(BaseModel):
    chart_type: Literal["bar", "line", "pie"]
    title: str
    x_label: str = ""
    y_label: str = ""
    unit: str = ""
    series: list[str]
    points: list[ChatChartPoint]


_INPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "chart_type": {
            "type": "string",
            "enum": list(CHART_TYPES),
            "description": "bar להשוואה בין קטגוריות, line למגמה לאורך זמן, pie לחלוקה של שלם",
        },
        "title": {"type": "string", "description": "כותרת קצרה בעברית"},
        "x_label": {"type": "string", "description": "כותרת ציר X (אופציונלי)"},
        "y_label": {"type": "string", "description": "כותרת ציר Y (אופציונלי)"},
        "unit": {"type": "string", "description": "יחידת הערכים, למשל ₪ או % (אופציונלי)"},
        "series": {
            "type": "array",
            "items": {"type": "string"},
            "description": f"שמות הסדרות כשיש יותר מאחת (עד {MAX_SERIES}); השמט לסדרה אחת",
        },
        "points": {
            "type": "array",
            "description": f"עד {MAX_POINTS} נקודות, בסדר התצוגה",
            "items": {
                "type": "object",
                "properties": {
                    "label": {"type": "string"},
                    "value": {"type": "number", "description": "הערך ביחידות התצוגה (35 עבור 35%)"},
                    "values": {
                        "type": "array",
                        "items": {"type": "number"},
                        "description": "ערך לכל סדרה, בסדר של series — במקום value כשיש כמה סדרות",
                    },
                },
                "required": ["label"],
            },
        },
    },
    "required": ["chart_type", "title", "points"],
}


@beta_tool(
    name=CHART_TOOL_NAME,
    description="מציג למשתמש גרף אינטראקטיבי (עמודות/קו/עוגה) בתוך חלון השיחה. לתצוגה בלבד - אינו מחזיר נתונים.",
    input_schema=_INPUT_SCHEMA,
)
def show_chart(**_chart) -> str:
    # The chart itself is taken from the tool_use block as soon as the model
    # finishes writing it (see ai_orchestrator); this only acknowledges it on
    # the rare turn where the model still needs another round to write text.
    return CHART_SHOWN


_CONTROL_CHARS = re.compile(r"[\x00-\x1f\x7f-\x9f‎‏‪-‮⁦-⁩]")


def _text(value: object, limit: int) -> str:
    if not isinstance(value, str):
        return ""
    text = " ".join(_CONTROL_CHARS.sub(" ", value).split())
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def _number(value: object) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, str):
        try:
            value = float(value.replace(",", "").replace("₪", "").replace("%", "").strip())
        except ValueError:
            return None
    if not isinstance(value, (int, float)) or not math.isfinite(value) or abs(value) > _MAX_ABS_VALUE:
        return None
    return float(value)


def sanitize_chart(raw: object) -> dict | None:
    """The model's show_chart input → a bounded, display-safe chart dict
    (`ChatChart` shape: every point carries one value per series), or None
    when nothing in it is plottable."""
    if not isinstance(raw, dict) or not isinstance(raw.get("points"), list):
        return None
    chart_type = raw.get("chart_type") if raw.get("chart_type") in CHART_TYPES else "bar"
    title = _text(raw.get("title"), _MAX_TITLE)
    y_label = _text(raw.get("y_label"), _MAX_AXIS_LABEL)

    raw_series = raw.get("series") if isinstance(raw.get("series"), list) else []
    series = [name for s in raw_series if (name := _text(s, _MAX_SERIES_NAME))][:MAX_SERIES]
    if chart_type == "pie" or not series:
        series = series[:1] or [y_label or title or "ערך"]

    points = []
    for point in raw["points"][:MAX_POINTS]:
        if not isinstance(point, dict) or not (label := _text(point.get("label"), _MAX_POINT_LABEL)):
            continue
        raw_values = point.get("values") if isinstance(point.get("values"), list) else [point.get("value")]
        values = [_number(v) for v in raw_values[: len(series)]]
        values += [None] * (len(series) - len(values))
        if chart_type == "pie" and not (values[0] and values[0] > 0):
            continue  # a pie slice needs a positive size
        if any(v is not None for v in values):
            points.append({"label": label, "values": values})
    if not points:
        return None

    return {
        "chart_type": chart_type,
        "title": title,
        "x_label": _text(raw.get("x_label"), _MAX_AXIS_LABEL),
        "y_label": y_label,
        "unit": _text(raw.get("unit"), _MAX_UNIT),
        "series": series,
        "points": points,
    }


def add_chart(charts: list[dict], raw: object) -> dict | None:
    """Sanitizes `raw` and appends it to this turn's `charts` unless it's
    unusable, a duplicate, or over the per-turn cap. Returns the added chart."""
    if len(charts) >= MAX_CHARTS_PER_TURN or (chart := sanitize_chart(raw)) is None or chart in charts:
        return None
    charts.append(chart)
    return chart
