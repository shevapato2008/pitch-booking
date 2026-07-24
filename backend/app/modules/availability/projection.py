from datetime import datetime
from typing import Literal

from backend.app.models import SlotStatus

ProjectedStatus = Literal["AVAILABLE", "TEMPORARILY_LOCKED", "BOOKED", "CLOSED", "EXPIRED"]
UnavailableReason = Literal[
    "HELD_FOR_PAYMENT", "ALREADY_BOOKED", "VENUE_CLOSED", "TIME_PASSED"
]


def project_status(
    status: SlotStatus, starts_at: datetime, now: datetime
) -> tuple[ProjectedStatus, UnavailableReason | None]:
    if now >= starts_at:
        return "EXPIRED", "TIME_PASSED"
    mapping: dict[SlotStatus, tuple[ProjectedStatus, UnavailableReason | None]] = {
        SlotStatus.AVAILABLE: ("AVAILABLE", None),
        SlotStatus.LOCKED: ("TEMPORARILY_LOCKED", "HELD_FOR_PAYMENT"),
        SlotStatus.BOOKED: ("BOOKED", "ALREADY_BOOKED"),
        SlotStatus.CLOSED: ("CLOSED", "VENUE_CLOSED"),
    }
    return mapping[status]
