import re
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, field_validator

from backend.app.modules.open_game_registrations.dto import (
    validate_registration_visible_text,
)
from backend.app.modules.venue_profiles.storage import (
    MAX_IMAGE_BYTES,
    SUPPORTED_IMAGE_TYPES,
)

_MAINLAND_CHINA_PHONE = re.compile(r"1[3-9][0-9]{9}", re.ASCII)


@dataclass(frozen=True)
class WeChatIdentity:
    openid: str
    unionid: str | None
    session_key: str = field(repr=False)
    app_id: str


@dataclass(frozen=True)
class VerifiedPhone:
    phone: str = field(repr=False)

    def __post_init__(self) -> None:
        if type(self.phone) is not str or _MAINLAND_CHINA_PHONE.fullmatch(self.phone) is None:
            raise ValueError("verified phone is invalid")


class WeChatCodeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str = Field(min_length=1, max_length=256)


class SessionUserResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: UUID
    masked_phone: str | None
    last_contact_name: str | None


class WeChatSessionResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    session_token: str
    expires_at: datetime
    user: SessionUserResponse


class PhoneVerificationResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    masked_phone: str
    verified_at: datetime
class UserAvatarUploadIntentResponse(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    avatar_id: uuid.UUID
    object_key: str = Field(
        pattern=(
            r"^private/users/[0-9a-f-]{36}/avatars/"
            r"[0-9a-f-]{36}/original\.(jpg|png|webp)$"
        )
    )
    signed_put_url: str = Field(min_length=1)
    required_headers: dict[str, str]
    maximum_bytes: int = Field(ge=1)
    accepted_mime_types: tuple[str, ...]

class CreateUserAvatarUploadIntentRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mime_type: str
    byte_size: int = Field(strict=True, ge=1, le=MAX_IMAGE_BYTES)

    @field_validator("mime_type")
    @classmethod
    def require_supported_mime_type(cls, value: str) -> str:
        if value not in SUPPORTED_IMAGE_TYPES:
            raise ValueError("unsupported avatar MIME type")
        return value

class UpdateUserPublicProfileRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    nickname: str = Field(min_length=1, max_length=24)
    avatar_object_key: str | None = Field(max_length=256)

    @field_validator("nickname", mode="before")
    @classmethod
    def trim_nickname(cls, value: object) -> object:
        if not isinstance(value, str):
            raise ValueError("nickname must be a string")
        return value.strip()

    @field_validator("nickname")
    @classmethod
    def reject_private_nickname(cls, value: str) -> str:
        return validate_registration_visible_text(value)

class UserPublicProfileResponse(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    nickname: str | None = Field(min_length=1, max_length=24)
    avatar_url: str | None = Field(pattern=r"^https://")
    profile_version: int = Field(ge=0)
    confirmed_at: AwareDatetime | None
