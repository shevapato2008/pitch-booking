from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, SecretStr

PlatformRole = Literal["PLATFORM_ADMIN", "ONBOARDING_REVIEWER"]


class PlatformSessionExchange(BaseModel):
    model_config = ConfigDict(extra="forbid")

    access_token: SecretStr = Field(min_length=32, max_length=256)


class PlatformSessionResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    principal_id: str
    display_name: str
    roles: list[PlatformRole]
    csrf_token: str
    expires_at: datetime
