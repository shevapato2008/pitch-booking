import hashlib
import re
import secrets
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from uuid import UUID

from backend.app.errors import AppError
from backend.app.models import User
from backend.app.modules.auth.dto import (
    CreateUserAvatarUploadIntentRequest,
    PhoneVerificationResponse,
    SessionUserResponse,
    UpdateUserPublicProfileRequest,
    UserAvatarUploadIntentResponse,
    UserPublicProfileResponse,
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
from backend.app.modules.venue_profiles.storage import (
    SUPPORTED_IMAGE_TYPES,
    InvalidMediaError,
    StorageBoundaryError,
    StorageVerificationError,
    VenueMediaStore,
)
from backend.app.security.phone_vault import PhoneVault, SealedPhone

_USER_AVATAR_UPLOAD_KEY = re.compile(
    r"^private/users/(?P<user_id>[0-9a-f-]{36})/avatars/"
    r"(?P<avatar_id>[0-9a-f-]{36})/original\.(?:jpg|png|webp)$",
    re.ASCII,
)

class AuthService:
    def __init__(
        self,
        *,
        repository: AuthRepository,
        identity_provider: IdentityProvider,
        phone_provider: PhoneProvider,
        phone_vault: PhoneVault | None,
        session_ttl: timedelta,
        media_store: VenueMediaStore | None = None,
        now: Callable[[], datetime] | None = None,
    ) -> None:
        self._repository = repository
        self._identity_provider = identity_provider
        self._phone_provider = phone_provider
        self._phone_vault = phone_vault
        self._session_ttl = session_ttl
        self._media_store = media_store
        self._now = now or (lambda: datetime.now(UTC))

    def create_session(self, code: str) -> WeChatSessionResponse:
        try:
            identity = self._identity_provider.exchange(code)
        except IdentityProviderError:
            raise AppError(502, "WECHAT_LOGIN_FAILED", "微信登录失败，请重试。") from None
        openid = identity.openid
        unionid = identity.unionid
        app_id = identity.app_id
        del identity
        try:
            user = self._repository.get_or_create_user(
                app_id=app_id, openid=openid, unionid=unionid
            )
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

    def _require_media_store(self) -> VenueMediaStore:
        if self._media_store is None:
            raise AppError(503, "SERVICE_UNAVAILABLE", "服务暂时不可用，请稍后重试。")
        return self._media_store

    def _public_profile(self, user: User) -> UserPublicProfileResponse:
        avatar_url = None
        if user.public_avatar_object_key is not None:
            avatar_url = self._require_media_store().user_avatar_url(
                user.id,
                user.public_avatar_object_key,
            )
        return UserPublicProfileResponse(
            nickname=user.public_nickname,
            avatar_url=avatar_url,
            profile_version=user.public_profile_version,
            confirmed_at=user.public_profile_updated_at,
        )

    def update_public_profile(
        self,
        *,
        user_id: UUID,
        request: UpdateUserPublicProfileRequest,
    ) -> UserPublicProfileResponse:
        try:
            user = self._repository.lock_user(user_id)
            if user is None:
                raise _auth_required()
            published_key = user.public_avatar_object_key
            if request.avatar_object_key is not None:
                storage = self._require_media_store()
                avatar_id = _parse_avatar_upload_key(
                    request.avatar_object_key,
                    expected_user_id=user.id,
                )
                published = storage.promote_user_avatar(
                    user.id,
                    avatar_id,
                    request.avatar_object_key,
                )
                published_key = published.object_key
            user.public_nickname = request.nickname
            user.public_avatar_object_key = published_key
            user.public_profile_updated_at = self._now()
            user.public_profile_version += 1
            self._repository.commit()
            return self._public_profile(user)
        except AppError:
            self._repository.rollback()
            raise
        except (
            InvalidMediaError,
            KeyError,
            StorageBoundaryError,
            StorageVerificationError,
            ValueError,
        ):
            self._repository.rollback()
            raise _invalid_public_profile() from None

    def create_avatar_upload_intent(
        self,
        *,
        user_id: UUID,
        request: CreateUserAvatarUploadIntentRequest,
    ) -> UserAvatarUploadIntentResponse:
        storage = self._require_media_store()
        avatar_id = UUID(bytes=secrets.token_bytes(16), version=4)
        try:
            intent = storage.create_user_avatar_upload_intent(
                user_id,
                avatar_id,
                request.mime_type,
                request.byte_size,
            )
        except (InvalidMediaError, StorageBoundaryError, ValueError):
            raise _invalid_public_profile() from None
        return UserAvatarUploadIntentResponse(
            avatar_id=avatar_id,
            object_key=intent.object_key,
            signed_put_url=intent.url,
            required_headers=dict(intent.required_headers),
            maximum_bytes=intent.max_bytes,
            accepted_mime_types=SUPPORTED_IMAGE_TYPES,
        )

    def get_public_profile(self, user_id: UUID) -> UserPublicProfileResponse:
        user = self._repository.get_user(user_id)
        if user is None:
            raise _auth_required()
        return self._public_profile(user)

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


def _parse_avatar_upload_key(object_key: str, *, expected_user_id: UUID) -> UUID:
    matched = _USER_AVATAR_UPLOAD_KEY.fullmatch(object_key)
    if matched is None:
        raise ValueError("avatar object key is outside the controlled upload boundary")
    user_id = UUID(matched.group("user_id"))
    avatar_id = UUID(matched.group("avatar_id"))
    if user_id != expected_user_id:
        raise ValueError("avatar object key belongs to another user")
    return avatar_id


def _invalid_public_profile() -> AppError:
    return AppError(422, "INVALID_ARGUMENT", "公开资料或头像无效，请重新选择。")
