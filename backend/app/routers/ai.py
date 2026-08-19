"""AI endpoints (LLM-powered), backed by Anthropic Claude."""
import anthropic
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.config import settings
from app.services import llm
from app.services.rate_limit import enforce_ai_rate_limit

router = APIRouter(prefix="/api/ai", tags=["ai"], dependencies=[Depends(enforce_ai_rate_limit)])


class ClassifyRequest(BaseModel):
    description: str


class AskRequest(BaseModel):
    question: str


class AskResponse(BaseModel):
    answer: str


def _require_api_key():
    if not settings.anthropic_api_key:
        raise HTTPException(
            503,
            "AI features are not configured — set ANTHROPIC_API_KEY in backend/.env",
        )


@router.post("/classify-incident", response_model=llm.IncidentClassification)
def classify_incident(payload: ClassifyRequest):
    _require_api_key()
    if not payload.description.strip():
        raise HTTPException(400, "Description is required")
    try:
        return llm.classify_incident(payload.description)
    except anthropic.APIStatusError as e:
        raise HTTPException(502, f"AI service error: {e.message}") from e
    except anthropic.APIConnectionError as e:
        raise HTTPException(502, "AI service unreachable") from e


@router.get("/executive-summary")
def executive_summary():
    """Streams a Hebrew executive-summary narrative as plain text chunks."""
    _require_api_key()

    def generate():
        try:
            yield from llm.stream_executive_summary()
        except anthropic.APIError as e:
            yield f"\n\n[שגיאה בשירות ה-AI: {e}]"

    return StreamingResponse(generate(), media_type="text/plain; charset=utf-8")


@router.post("/ask", response_model=AskResponse)
def ask(payload: AskRequest):
    _require_api_key()
    if not payload.question.strip():
        raise HTTPException(400, "Question is required")
    try:
        answer = llm.ask_question(payload.question)
    except anthropic.APIStatusError as e:
        raise HTTPException(502, f"AI service error: {e.message}") from e
    except anthropic.APIConnectionError as e:
        raise HTTPException(502, "AI service unreachable") from e
    return AskResponse(answer=answer)
