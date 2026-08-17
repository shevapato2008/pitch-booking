from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from urllib.parse import urlsplit

from fastapi import Request
from pydantic import SecretStr

from backend.app.config import Settings
from backend.app.errors import AppError
from backend.app.models import PlatformSession
from backend.app.modules.platform_auth.dto import (
    PlatformRole,
    PlatformSessionResponse,
)
from backend.app.modules.platform_auth.repository import PlatformAuthRepository

SESSION_TTL = timedelta(hours=8)
SESSION_COOKIE = "pitch_platform_session"
ALLOWED_ROLES = frozenset({"PLATFORM_ADMIN", "ONBOARDING_REVIEWER"})


@dataclass(frozen=True)
class PlatformPrincipal:
    principal_id: str
    display_name: str
    roles: tuple[PlatformRole, ...]


@dataclass(frozen=True)
class AuthenticatedPlatformSession:
    record: PlatformSession
    principal: PlatformPrincipal
    csrf_token: str

    def response(self) -> PlatformSessionResponse:
        return PlatformSessionResponse(
            principal_id=self.principal.principal_id,
            display_name=self.principal.display_name,
            roles=list(self.principal.roles),
            csrf_token=self.csrf_token,
            expires_at=self.record.expires_at,
        )


class PlatformAuthService:
    def __init__(
        self,
        *,
        repository: PlatformAuthRepository,
        settings: Settings,
    ) -> None:
        self.repository = repository
        self.settings = settings

    def exchange_access_token(
        self, access_token: SecretStr
    ) -> tuple[str, AuthenticatedPlatformSession]:
        configured = self._configured_principals(required=True)
        candidate_hash = hashlib.sha256(
            access_token.get_secret_value().encode("utf-8")
        ).hexdigest()
        matched: PlatformPrincipal | None = None
        for principal, token_hash, enabled in configured:
            is_match = hmac.compare_digest(candidate_hash, token_hash)
            if is_match and enabled:
                matched = principal
        if matched is None:
            raise AppError(
                401,
                "PLATFORM_AUTH_INVALID",
                "平台工作人员凭据无效。",
            )

        now = datetime.now(UTC)
        raw_session_token = secrets.token_urlsafe(32)
        session_hash = hashlib.sha256(raw_session_token.encode("ascii")).hexdigest()
        record = PlatformSession(
            id=uuid.uuid4(),
            token_hash=session_hash,
            principal_id=matched.principal_id,
            issued_at=now,
            expires_at=now + SESSION_TTL,
            revoked_at=None,
        )
        csrf_token = self._csrf_token(session_hash)
        try:
            self.repository.add(record)
            self.repository.commit()
        except Exception:
            self.repository.rollback()
            raise
        return raw_session_token, AuthenticatedPlatformSession(
            record=record,
            principal=matched,
            csrf_token=csrf_token,
        )

    def authenticate_session(
        self, raw_session_token: str | None
    ) -> AuthenticatedPlatformSession:
        if raw_session_token is None:
            raise _auth_required()
        session_hash = hashlib.sha256(raw_session_token.encode("utf-8")).hexdigest()
        record = self.repository.get_by_token_hash(session_hash)
        now = datetime.now(UTC)
        if (
            record is None
            or record.revoked_at is not None
            or record.expires_at <= now
        ):
            raise _auth_required()
        current = next(
            (
                principal
                for principal, _token_hash, enabled in self._configured_principals(
                    required=False
                )
                if enabled and principal.principal_id == record.principal_id
            ),
            None,
        )
        if current is None:
            raise _auth_required()
        return AuthenticatedPlatformSession(
            record=record,
            principal=current,
            csrf_token=self._csrf_token(record.token_hash),
        )

    def validate_mutation(
        self,
        request: Request,
        authenticated: AuthenticatedPlatformSession,
        *,
        origin: str | None,
        csrf_token: str | None,
    ) -> None:
        expected_origin = _expected_origin(request, self.settings)
        if (
            origin is None
            or not hmac.compare_digest(origin, expected_origin)
            or csrf_token is None
            or not hmac.compare_digest(csrf_token, authenticated.csrf_token)
        ):
            raise AppError(
                403,
                "PLATFORM_CSRF_INVALID",
                "平台操作来源或防伪令牌无效。",
            )

    def logout(self, authenticated: AuthenticatedPlatformSession) -> None:
        try:
            self.repository.revoke(authenticated.record, datetime.now(UTC))
            self.repository.commit()
        except Exception:
            self.repository.rollback()
            raise

    def _configured_principals(
        self, *, required: bool
    ) -> list[tuple[PlatformPrincipal, str, bool]]:
        secret = self.settings.platform_staff_principals_json
        if secret is None:
            if required:
                raise _unavailable()
            return []
        try:
            decoded = json.loads(secret.get_secret_value())
            return [
                (
                    PlatformPrincipal(
                        principal_id=item["principal_id"],
                        display_name=item["display_name"],
                        roles=tuple(item["roles"]),
                    ),
                    item["token_sha256"],
                    item["enabled"],
                )
                for item in decoded
                if set(item["roles"]) & ALLOWED_ROLES
            ]
        except (KeyError, TypeError, json.JSONDecodeError):
            raise _unavailable() from None

    def _csrf_token(self, session_hash: str) -> str:
        secret = self.settings.platform_csrf_secret
        if secret is None:
            raise _unavailable()
        try:
            key = base64.b64decode(secret.get_secret_value(), validate=True)
        except (ValueError, UnicodeEncodeError):
            raise _unavailable() from None
        return hmac.new(
            key,
            session_hash.encode("ascii"),
            hashlib.sha256,
        ).hexdigest()


def _expected_origin(request: Request, settings: Settings) -> str:
    configured = settings.public_api_base_url
    parsed = urlsplit(str(configured) if configured is not None else str(request.base_url))
    host = parsed.hostname
    if host is None:
        raise _unavailable()
    default_port = 443 if parsed.scheme == "https" else 80
    authority = host if parsed.port in {None, default_port} else f"{host}:{parsed.port}"
    return f"{parsed.scheme}://{authority}"


def _auth_required() -> AppError:
    return AppError(401, "PLATFORM_AUTH_REQUIRED", "需要平台工作人员登录。")


def _unavailable() -> AppError:
    return AppError(503, "SERVICE_UNAVAILABLE", "平台登录服务暂不可用。")
