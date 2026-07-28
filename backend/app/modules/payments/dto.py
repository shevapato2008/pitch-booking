from dataclasses import dataclass
from typing import Literal


@dataclass(frozen=True, slots=True)
class CreatePaymentResult:
    status_code: Literal[200, 201, 202]
    body: dict[str, object]
