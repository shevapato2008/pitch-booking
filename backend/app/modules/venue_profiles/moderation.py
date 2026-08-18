from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Protocol

from backend.app.models import (
    ModerationDecisionOutcome,
    ModerationItemType,
    ModerationReasonCode,
)

POLICY_VERSION = "venue-profile-v1"


@dataclass(frozen=True)
class ModerationRequest:
    item_type: ModerationItemType
    text: str | None = None
    image_url: str | None = None


@dataclass(frozen=True)
class ModerationResult:
    outcome: ModerationDecisionOutcome
    reason_code: ModerationReasonCode | None = None
    confidence: float | None = None
    request_id: str | None = None
    raw_response_sha256: str | None = None
    provider_failure: bool = False


class ContentModerationProvider(Protocol):
    @property
    def provider_name(self) -> str: ...

    @property
    def model_name(self) -> str: ...

    def moderate(self, request: ModerationRequest) -> ModerationResult: ...


def uncertain_failure() -> ModerationResult:
    return ModerationResult(
        outcome=ModerationDecisionOutcome.UNCERTAIN,
        provider_failure=True,
    )


def decode_result(content: object) -> ModerationResult:
    """Decode only the closed provider result vocabulary; discard all free text."""
    try:
        payload = json.loads(content) if isinstance(content, str) else content
        if not isinstance(payload, dict):
            return uncertain_failure()
        allowed = {"decision", "reason_code", "confidence"}
        if not set(payload).issubset(allowed):
            return uncertain_failure()
        decision = payload.get("decision")
        reason_value = payload.get("reason_code")
        confidence_value = payload.get("confidence")
        confidence: float | None = None
        if confidence_value is not None:
            if type(confidence_value) not in {int, float}:
                return uncertain_failure()
            confidence = float(confidence_value)
            if not 0 <= confidence <= 1:
                return uncertain_failure()
        if decision == ModerationDecisionOutcome.PASS.value:
            if reason_value is not None:
                return uncertain_failure()
            return ModerationResult(ModerationDecisionOutcome.PASS, confidence=confidence)
        if decision == ModerationDecisionOutcome.UNCERTAIN.value:
            if reason_value is not None:
                return uncertain_failure()
            return ModerationResult(ModerationDecisionOutcome.UNCERTAIN, confidence=confidence)
        if decision == ModerationDecisionOutcome.REJECT.value:
            if not isinstance(reason_value, str):
                return uncertain_failure()
            try:
                reason = ModerationReasonCode(reason_value)
            except ValueError:
                return uncertain_failure()
            return ModerationResult(
                ModerationDecisionOutcome.REJECT,
                reason_code=reason,
                confidence=confidence,
            )
    except (TypeError, ValueError, json.JSONDecodeError):
        pass
    return uncertain_failure()
