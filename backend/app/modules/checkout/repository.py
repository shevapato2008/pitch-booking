import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from backend.app.models import Pitch, Slot


class CheckoutRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def get_slot(self, slot_id: uuid.UUID, *, populate_existing: bool = False) -> Slot | None:
        statement = (
            select(Slot)
            .where(Slot.id == slot_id)
            .options(joinedload(Slot.pitch).joinedload(Pitch.venue))
            .execution_options(populate_existing=populate_existing)
        )
        return self.session.scalar(statement)

    def flush(self) -> None:
        self.session.flush()

    def commit(self) -> None:
        self.session.commit()

    def rollback(self) -> None:
        self.session.rollback()
