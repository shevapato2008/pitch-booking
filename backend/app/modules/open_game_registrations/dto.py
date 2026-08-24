"""Closed DTOs and approved text validation for open-game registrations."""

import re
import unicodedata
import uuid
from datetime import datetime
from enum import StrEnum
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from backend.app.models import (
    OpenGameRegistrationPosition,
    OpenGameRegistrationStatus,
)
from backend.app.modules.open_game_registrations.lifecycle import (
    EffectiveRegistrationStatus,
    ReviewActions,
)

OPEN_GAME_REGISTRATION_CONSENT_VERSION = "c1a-2026-08-24"


_MAINLAND_MOBILE_RE = re.compile(
    r"(?:^|[^0-9])(?:\+?86[\s-]?)?1[3-9](?:[\s-]?[0-9]){9}(?:$|[^0-9])"
)
_WECHAT_RE = re.compile(
    r"微信(?:号)?|微\s*信|(?:^|[\s,:：])(?:vx|wx|wechat)(?:[\s,:：]|$)",
    re.IGNORECASE,
)
_URL_RE = re.compile(
    r"https?://|www\.|(?:^|\s)[a-z0-9-]+\.(?:com|cn|net|org)(?:/|\s|$)",
    re.IGNORECASE,
)
_MAINLAND_ID_RE = re.compile(
    r"(?:^|[^0-9])(?:[0-9]{17}[0-9Xx]|[0-9]{15})(?:$|[^0-9])"
)


class _ClosedModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class _FrozenClosedModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class ApplicationDecision(StrEnum):
    ACCEPT = "ACCEPT"
    REJECT = "REJECT"


class DecisionResultStatus(StrEnum):
    JOINED = "JOINED"
    REJECTED = "REJECTED"


class CreateApplicationRequest(_ClosedModel):
    display_name: Annotated[str, Field(strict=True, min_length=2, max_length=24)]
    position: OpenGameRegistrationPosition
    note: Annotated[str, Field(strict=True, max_length=120)] | None
    adult_confirmed: Literal[True]
    risk_confirmed: Literal[True]

    @field_validator("adult_confirmed", "risk_confirmed", mode="before")
    @classmethod
    def require_strict_true(cls, value: object) -> object:
        if value is not True:
            raise ValueError("confirmation must be the boolean true")
        return value

    @field_validator("display_name", mode="before")
    @classmethod
    def trim_display_name(cls, value: object) -> object:
        if not isinstance(value, str):
            raise ValueError("display_name must be a string")
        return value.strip()

    @field_validator("note", mode="before")
    @classmethod
    def trim_note(cls, value: object) -> object:
        if value is None:
            return None
        if not isinstance(value, str):
            raise ValueError("note must be a string or null")
        return value.strip() or None

    @field_validator("display_name", "note")
    @classmethod
    def reject_private_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return validate_registration_visible_text(value)


class ViewerRegistration(_FrozenClosedModel):
    display_name: Annotated[str, Field(strict=True, min_length=2, max_length=24)]
    position: OpenGameRegistrationPosition
    note: Annotated[str, Field(strict=True, max_length=120)] | None
    persisted_status: OpenGameRegistrationStatus
    effective_status: EffectiveRegistrationStatus
    applied_at: datetime
    decided_at: datetime | None


class CaptainApplication(_FrozenClosedModel):
    id: uuid.UUID
    display_name: Annotated[str, Field(strict=True, min_length=2, max_length=24)]
    position: OpenGameRegistrationPosition
    note: Annotated[str, Field(strict=True, max_length=120)] | None
    applied_at: datetime
    version: Annotated[int, Field(strict=True, ge=1)]
    allowed_actions: ReviewActions


class Queue(_FrozenClosedModel):
    remaining_spots: Annotated[int, Field(strict=True, ge=0)]
    pending_count: Annotated[int, Field(strict=True, ge=0)]
    applications: tuple[CaptainApplication, ...]


class DecisionRequest(_ClosedModel):
    decision: ApplicationDecision
    expected_version: Annotated[int, Field(strict=True, ge=1)]


class DecisionResult(_FrozenClosedModel):
    application_id: uuid.UUID
    status: DecisionResultStatus
    version: Annotated[int, Field(strict=True, ge=1)]
    decided_at: datetime | None
    remaining_spots: Annotated[int, Field(strict=True, ge=0)]
    allowed_actions: ReviewActions


def validate_registration_visible_text(value: str) -> str:
    """Reject the approved C1a contact, URL, and mainland-ID patterns."""
    detection_value = unicodedata.normalize("NFKC", value)
    if _MAINLAND_MOBILE_RE.search(detection_value):
        raise ValueError("must not include a mainland mobile number")
    if _WECHAT_RE.search(detection_value):
        raise ValueError("must not include an explicit WeChat identifier")
    if _URL_RE.search(detection_value):
        raise ValueError("must not include a URL")
    if _MAINLAND_ID_RE.search(detection_value):
        raise ValueError("must not include a mainland identity number")
    return value
