from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.models import PlatformSession


class PlatformAuthRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def add(self, platform_session: PlatformSession) -> None:
        self.session.add(platform_session)
        self.session.flush()

    def get_by_token_hash(self, token_hash: str) -> PlatformSession | None:
        return self.session.scalar(
            select(PlatformSession).where(PlatformSession.token_hash == token_hash)
        )

    def revoke(self, platform_session: PlatformSession, revoked_at: datetime) -> None:
        platform_session.revoked_at = revoked_at
        self.session.flush()

    def commit(self) -> None:
        self.session.commit()

    def rollback(self) -> None:
        self.session.rollback()
