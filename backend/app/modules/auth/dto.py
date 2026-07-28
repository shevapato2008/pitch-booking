import re
from dataclasses import dataclass, field
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

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
