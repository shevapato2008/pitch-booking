from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend.app.models import User, UserSession
from backend.app.security.phone_vault import SealedPhone


class IdentityConflictError(Exception):
    """The supplied WeChat subject conflicts with an existing user binding."""


class AuthRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def get_or_create_user(self, *, openid: str, unionid: str | None) -> User:
        candidate_id = uuid4()
        try:
            inserted_id = self.session.scalar(
                insert(User)
                .values(
                    id=candidate_id,
                    wechat_openid=openid,
                    wechat_unionid=None,
                )
                .on_conflict_do_nothing(constraint="uq_users_wechat_openid")
                .returning(User.id)
            )
        except IntegrityError:
            self.session.rollback()
            raise IdentityConflictError("WeChat identity conflict") from None
        user = (
            self.session.get(User, inserted_id)
            if inserted_id is not None
            else self.session.scalar(
                select(User).where(User.wechat_openid == openid)
            )
        )
        if user is None:
            self.session.rollback()
            raise IdentityConflictError("WeChat identity conflict")
        if unionid is None:
            return user
        if user.wechat_unionid is not None:
            if user.wechat_unionid != unionid:
                raise IdentityConflictError("WeChat identity conflict")
            return user
        try:
            updated_id = self.session.scalar(
                update(User)
                .where(User.id == user.id, User.wechat_unionid.is_(None))
                .values(wechat_unionid=unionid)
                .returning(User.id)
                .execution_options(synchronize_session=False)
            )
        except IntegrityError:
            self.session.rollback()
            raise IdentityConflictError("WeChat identity conflict") from None
        self.session.expire(user, ["wechat_unionid"])
        if updated_id is None and user.wechat_unionid != unionid:
            raise IdentityConflictError("WeChat identity conflict")
        return user

    def create_session(
        self,
        *,
        user: User,
        token_hash: str,
        issued_at: datetime,
        expires_at: datetime,
    ) -> UserSession:
        business_session = UserSession(
            user=user,
            token_hash=token_hash,
            issued_at=issued_at,
            expires_at=expires_at,
        )
        self.session.add(business_session)
        return business_session

    def resolve_user(self, *, token_hash: str, now: datetime) -> User | None:
        statement = (
            select(User)
            .join(UserSession)
            .where(
                UserSession.token_hash == token_hash,
                UserSession.expires_at > now,
                UserSession.revoked_at.is_(None),
            )
        )
        return self.session.scalar(statement)

    def get_user(self, user_id: UUID) -> User | None:
        return self.session.get(User, user_id)

    def set_verified_phone(
        self,
        *,
        user: User,
        sealed: SealedPhone,
        verified_at: datetime,
    ) -> None:
        user.phone_ciphertext = sealed.ciphertext_with_tag
        user.phone_nonce = sealed.nonce
        user.phone_key_version = sealed.key_version
        user.phone_verified_at = verified_at

    def commit(self) -> None:
        self.session.commit()

    def rollback(self) -> None:
        self.session.rollback()
