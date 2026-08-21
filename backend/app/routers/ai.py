"""AI endpoints (LLM-powered), backed by Anthropic Claude."""
import anthropic
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app import models
from app.config import settings
from app.database import get_db
from app.dependencies.permissions import get_current_user, require_roles
from app.services import llm
from app.services.agents import action_agent, data_agent  # noqa: F401 — register agents on import
from app.services.ai_orchestrator import AgentOrchestrator, AgentType
from app.services.rate_limit import enforce_ai_rate_limit

# require_roles() with no args = authenticated, any role — classify-incident is used by
# FIELD_WORKER while filing a report, ask/executive-summary by managers on the dashboard,
# so this isn't role-restricted, just login-gated (see dependencies/permissions.py
# docstring). Previously this router only had the IP-based rate limit and no auth
# dependency at all, contradicting docs/README.md §6 which already described it as
# "authenticated" — the frontend (api/client.ts) was already sending the bearer token on
# every call in anticipation of this; only the backend enforcement was missing.
router = APIRouter(
    prefix="/api/ai",
    tags=["ai"],
    dependencies=[Depends(enforce_ai_rate_limit), Depends(require_roles())],
)


class ClassifyRequest(BaseModel):
    description: str


class AskRequest(BaseModel):
    question: str


class AskResponse(BaseModel):
    answer: str


class AgentChatRequest(BaseModel):
    message: str
    session_id: str | None = None


class AgentChatResponse(BaseModel):
    session_id: str
    agent: AgentType
    reasoning: str
    answer: str


class ProposeMitigationTaskRequest(BaseModel):
    property_id: int
    session_id: str | None = None


class ActionProposalResponse(BaseModel):
    action_id: int
    status: str
    proposal: dict


class ActionStatusResponse(BaseModel):
    action_id: int
    status: str


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


@router.post("/agent-chat", response_model=AgentChatResponse)
def agent_chat(
    payload: AgentChatRequest,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    """Multi-turn chat routed through the AgentOrchestrator (TODO_SPEC.md §2):
    classifies intent and dispatches to the matching agent, persisting
    context onto the `Agent_Sessions` row so a follow-up call with the same
    `session_id` continues the same conversation."""
    _require_api_key()
    if not payload.message.strip():
        raise HTTPException(400, "Message is required")
    try:
        orchestrator = AgentOrchestrator(db, session_id=payload.session_id, user=user)
        result = orchestrator.handle(payload.message)
    except anthropic.APIStatusError as e:
        raise HTTPException(502, f"AI service error: {e.message}") from e
    except anthropic.APIConnectionError as e:
        raise HTTPException(502, "AI service unreachable") from e
    return AgentChatResponse(**result.model_dump())


@router.post("/actions/propose-mitigation-task", response_model=ActionProposalResponse | None)
def propose_mitigation_task(
    payload: ProposeMitigationTaskRequest,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    """Human-in-the-loop proposal (TODO_SPEC.md §5/§7): if the property is
    out of compliance, builds and logs (status="proposed") a candidate
    Mitigation_Task payload — nothing is written to Mitigation_Tasks itself
    until the frontend Action Card is confirmed and POSTs it to
    `/api/mitigation-tasks`. Returns null if the property is already
    compliant. Deliberately no _require_api_key() gate — this path is pure
    DB computation (compliance.py), not an LLM call."""
    orchestrator_session = AgentOrchestrator(db, session_id=payload.session_id, user=user)
    proposal = action_agent.build_mitigation_task_proposal(db, payload.property_id)
    if proposal is None:
        db.commit()
        return None
    log = action_agent.log_proposal(db, orchestrator_session.session.session_id, proposal)
    db.commit()
    return ActionProposalResponse(action_id=log.action_id, status=log.status, proposal=proposal)


@router.post("/actions/{action_id}/confirm", response_model=ActionStatusResponse)
def confirm_action(action_id: int, db: Session = Depends(get_db), _user: models.User = Depends(get_current_user)):
    log = action_agent.mark_action_status(db, action_id, "confirmed")
    if log is None:
        raise HTTPException(404, "Action not found")
    db.commit()
    return ActionStatusResponse(action_id=log.action_id, status=log.status)


@router.post("/actions/{action_id}/reject", response_model=ActionStatusResponse)
def reject_action(action_id: int, db: Session = Depends(get_db), _user: models.User = Depends(get_current_user)):
    log = action_agent.mark_action_status(db, action_id, "rejected")
    if log is None:
        raise HTTPException(404, "Action not found")
    db.commit()
    return ActionStatusResponse(action_id=log.action_id, status=log.status)
