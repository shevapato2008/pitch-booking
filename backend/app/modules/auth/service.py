import hashlib
import secrets
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from uuid import UUID

from backend.app.errors import AppError
from backend.app.models import User
from backend.app.modules.auth.dto import (
    PhoneVerificationResponse,
    SessionUserResponse,
    WeChatSessionResponse,
)
from backend.app.modules.auth.provider import (
    IdentityProvider,
    IdentityProviderError,
    PhoneCapabilityUnavailableError,
    PhoneProvider,
    PhoneProviderError,
)
from backend.app.modules.auth.repository import AuthRepository, IdentityConflictError
from backend.app.security.phone_vault import PhoneVault, SealedPhone


class AuthService:
    def __init__(
        self,
        *,
        repository: AuthRepository,
        identity_provider: IdentityProvider,
        phone_provider: PhoneProvider,
        phone_vault: PhoneVault | None,
        session_ttl: timedelta,
        now: Callable[[], datetime] | None = None,
    ) -> None:
        self._repository = repository
        self._identity_provider = identity_provider
        self._phone_provider = phone_provider
        self._phone_vault = phone_vault
        self._session_ttl = session_ttl
        self._now = now or (lambda: datetime.now(UTC))

    def create_session(self, code: str) -> WeChatSessionResponse:
        try:
            identity = self._identity_provider.exchange(code)
        except IdentityProviderError:
            raise AppError(502, "WECHAT_LOGIN_FAILED", "微信登录失败，请重试。") from None
        openid = identity.openid
        unionid = identity.unionid
        del identity
        try:
            user = self._repository.get_or_create_user(openid=openid, unionid=unionid)
        except IdentityConflictError:
            self._repository.rollback()
            raise AppError(502, "WECHAT_LOGIN_FAILED", "微信登录失败，请重试。") from None
        issued_at = self._now()
        expires_at = issued_at + self._session_ttl
        session_user = self._session_user(user)
        raw_token = secrets.token_urlsafe(32)
        self._repository.create_session(
            user=user,
            token_hash=_token_hash(raw_token),
            issued_at=issued_at,
            expires_at=expires_at,
        )
        response = WeChatSessionResponse(
            session_token=raw_token,
            expires_at=expires_at,
            user=session_user,
        )
        try:
            self._repository.commit()
        except Exception:
            self._repository.rollback()
            raise
        return response

    def verify_phone(self, user_id: UUID, code: str) -> PhoneVerificationResponse:
        if self._phone_vault is None:
            raise AppError(
                503,
                "PHONE_AUTH_UNAVAILABLE",
                "当前无法获取微信手机号，请稍后重试。",
            )
        try:
            verified = self._phone_provider.exchange(code)
        except PhoneCapabilityUnavailableError:
            raise AppError(
                503,
                "PHONE_AUTH_UNAVAILABLE",
                "当前无法获取微信手机号，请稍后重试。",
            ) from None
        except PhoneProviderError:
            raise AppError(
                502,
                "PHONE_AUTH_FAILED",
                "手机号授权失败，请重新授权。",
            ) from None
        user = self._repository.get_user(user_id)
        if user is None:
            raise _auth_required()
        verified_at = self._now()
        sealed = self._phone_vault.encrypt(
            verified.phone,
            record_type="user",
            record_id=user.id,
            field="phone",
        )
        self._repository.set_verified_phone(
            user=user,
            sealed=sealed,
            verified_at=verified_at,
        )
        self._repository.commit()
        return PhoneVerificationResponse(
            masked_phone=PhoneVault.mask(verified.phone),
            verified_at=verified_at,
        )

    def _session_user(self, user: User) -> SessionUserResponse:
        masked_phone = None
        if (
            user.phone_ciphertext is not None
            and user.phone_nonce is not None
            and user.phone_key_version is not None
        ):
            if self._phone_vault is None:
                raise AppError(500, "INTERNAL_ERROR", "服务内部错误")
            phone = self._phone_vault.decrypt(
                SealedPhone(
                    user.phone_ciphertext,
                    user.phone_nonce,
                    user.phone_key_version,
                ),
                record_type="user",
                record_id=user.id,
                field="phone",
            )
            masked_phone = PhoneVault.mask(phone)
        return SessionUserResponse(
            id=user.id,
            masked_phone=masked_phone,
            last_contact_name=user.last_contact_name,
        )


def resolve_authenticated_user(
    repository: AuthRepository,
    raw_token: str | None,
    *,
    now: datetime | None = None,
) -> User:
    if raw_token is None:
        raise _auth_required()
    user = repository.resolve_user(
        token_hash=_token_hash(raw_token),
        now=now or datetime.now(UTC),
    )
    if user is None:
        raise _auth_required()
    return user


def _token_hash(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def _auth_required() -> AppError:
    return AppError(401, "AUTH_REQUIRED", "登录状态已失效，请重新登录。")
