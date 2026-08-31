from __future__ import annotations

import json
import os
import subprocess
import uuid
from datetime import UTC, datetime
from functools import partial
from pathlib import Path

import pytest
from pydantic import ValidationError
from sqlalchemy import Engine, func, select
from sqlalchemy.orm import Session

from backend.app.errors import AppError
from backend.app.models import (
    OpenGameAttendanceCorrection,
    OpenGameAttendanceStatus,
    OpenGameRegistration,
    OpenGameRegistrationStatus,
    Order,
    OrderStatus,
)
from backend.app.modules.platform_attendance_corrections.dto import (
    PlatformAttendanceAllowedCorrection,
    PlatformAttendanceCorrectionEvent,
    PlatformAttendanceCorrectionRequest,
)
from backend.app.modules.platform_attendance_corrections.repository import (
    PlatformAttendanceCorrectionRepository,
)
from backend.app.modules.platform_attendance_corrections.service import (
    PlatformAttendanceCorrectionService,
    _allowed_correction,
    _correction_request_digest,
)
from backend.tests.test_open_game_attendance_service import (
    ATTENDANCE_NOW,
    AttendanceCase,
    _seed_completed_attendance_game,
)

pytestmark = pytest.mark.integration

CORRECTION_NOW = datetime(2026, 9, 1, 8, 30, tzinfo=UTC)
CORRECTION_KEY = "platform-attendance-correction-key-0001"
REPOSITORY_ROOT = Path(__file__).resolve().parents[2]


def _assert_static_contract_accepts_detail(payload: dict[str, object]) -> None:
    script = """
import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import YAML from "yaml";

const contract = YAML.parse(readFileSync(process.env.CONTRACT_PATH, "utf8"));
const payload = JSON.parse(readFileSync(0, "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  components: contract.components,
  $ref: "#/components/schemas/PlatformAttendanceRegistrationDetail",
});
if (!validate(payload)) {
  console.error(ajv.errorsText(validate.errors, { separator: "; " }));
  process.exit(1);
}
"""
    result = subprocess.run(
        ["node", "--input-type=module", "--eval", script],
        cwd=REPOSITORY_ROOT,
        env={
            **os.environ,
            "CONTRACT_PATH": str(REPOSITORY_ROOT / "contracts" / "openapi.yaml"),
        },
        input=json.dumps(payload),
        text=True,
        capture_output=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr


def _seed_correctable_registration(
    engine: Engine,
    *,
    attendance_status: OpenGameAttendanceStatus = OpenGameAttendanceStatus.NO_SHOW,
) -> AttendanceCase:
    case = _seed_completed_attendance_game(engine)
    with Session(engine) as session:
        row = session.get_one(OpenGameRegistration, case.joined_ids[0])
        row.attendance_status = attendance_status
        row.attendance_recorded_at = ATTENDANCE_NOW
        row.attendance_recorded_by_user_id = case.owner_id
        row.version = 3
        session.commit()
    return case


def _service(session: Session) -> PlatformAttendanceCorrectionService:
    return PlatformAttendanceCorrectionService(
        repository=PlatformAttendanceCorrectionRepository(session),
        now=lambda: CORRECTION_NOW,
    )


def _request(
    *,
    attendance_status: OpenGameAttendanceStatus = OpenGameAttendanceStatus.PRESENT,
    expected_version: int = 3,
    reason: str = "已核对现场签到记录，原到场结果录入错误。",
) -> PlatformAttendanceCorrectionRequest:
    return PlatformAttendanceCorrectionRequest(
        attendance_status=attendance_status,
        expected_version=expected_version,
        reason=reason,
    )


def _assert_error(
    operation: object,
    *,
    status: int,
    code: str,
) -> None:
    assert callable(operation)
    with pytest.raises(AppError) as captured:
        operation()
    assert (captured.value.status_code, captured.value.code) == (status, code)


def test_exact_lookup_projects_minimal_authoritative_detail_and_history(
    pg_engine: Engine,
) -> None:
    case = _seed_correctable_registration(pg_engine)
    registration_id = case.joined_ids[0]

    with Session(pg_engine) as session:
        detail = _service(session).get_registration(registration_id)
        dumped = detail.model_dump(mode="json")

    assert dumped == {
        "registration_id": str(registration_id),
        "registration_status": "JOINED",
        "player_display_name": "到场球员1",
        "intended_position": "FORWARD",
        "game_name": "历史球局",
        "game_status": "COMPLETED",
        "venue_name": "浦东星跃足球公园",
        "pitch_name": "五人制 A 场",
        "starts_at": case.game.booking.starts_at.isoformat().replace("+00:00", "Z"),
        "ends_at": case.game.booking.ends_at.isoformat().replace("+00:00", "Z"),
        "time_zone": "Asia/Shanghai",
        "original_attendance_status": "NO_SHOW",
        "attendance_recorded_at": ATTENDANCE_NOW.isoformat().replace("+00:00", "Z"),
        "attendance_status": "NO_SHOW",
        "version": 3,
        "corrections": [],
        "allowed_correction": {
            "target_status": "PRESENT",
            "blocked_reason": None,
        },
    }
    serialized = str(dumped).lower()
    for forbidden in (
        "phone",
        "openid",
        "user_id",
        "note",
        "adult",
        "risk",
        "payment",
        "refund",
    ):
        assert forbidden not in serialized


def test_correction_appends_event_updates_effective_status_and_preserves_original_audit(
    pg_engine: Engine,
) -> None:
    case = _seed_correctable_registration(pg_engine)
    registration_id = case.joined_ids[0]

    with Session(pg_engine) as session:
        result = _service(session).correct(
            registration_id=registration_id,
            principal_id=" platform-admin-yangfan ",
            idempotency_key=CORRECTION_KEY,
            request=_request(reason="\t 已核对现场签到记录。\n"),
        )
        assert result.model_dump(mode="json") == {
            "id": str(result.id),
            "registration_id": str(registration_id),
            "from_status": "NO_SHOW",
            "to_status": "PRESENT",
            "reason": "已核对现场签到记录。",
            "corrected_by_principal_id": "platform-admin-yangfan",
            "corrected_at": CORRECTION_NOW.isoformat().replace("+00:00", "Z"),
            "registration_version_before": 3,
            "registration_version_after": 4,
        }
        row = session.get_one(OpenGameRegistration, registration_id)
        assert row.attendance_status is OpenGameAttendanceStatus.PRESENT
        assert row.version == 4
        assert row.attendance_recorded_at == ATTENDANCE_NOW
        assert row.attendance_recorded_by_user_id == case.owner_id

        detail = _service(session).get_registration(registration_id)
        assert detail.original_attendance_status is OpenGameAttendanceStatus.NO_SHOW
        assert detail.attendance_status is OpenGameAttendanceStatus.PRESENT
        assert detail.corrections == (result,)
        assert detail.allowed_correction.target_status is OpenGameAttendanceStatus.NO_SHOW

    with Session(pg_engine) as session:
        assert session.scalar(select(func.count()).select_from(OpenGameAttendanceCorrection)) == 1


def test_same_key_same_digest_replays_before_current_version_validation(
    pg_engine: Engine,
) -> None:
    case = _seed_correctable_registration(pg_engine)
    registration_id = case.joined_ids[0]
    request = _request()

    with Session(pg_engine) as session:
        service = _service(session)
        first = service.correct(
            registration_id=registration_id,
            principal_id="platform-admin-yangfan",
            idempotency_key=CORRECTION_KEY,
            request=request,
        )
        replay = service.correct(
            registration_id=registration_id,
            principal_id="platform-admin-yangfan",
            idempotency_key=CORRECTION_KEY,
            request=request,
        )
        assert replay == first
        assert session.scalar(select(func.count()).select_from(OpenGameAttendanceCorrection)) == 1

        for changed in (
            _request(attendance_status=OpenGameAttendanceStatus.NO_SHOW),
            _request(expected_version=4),
            _request(reason="不同理由"),
        ):
            _assert_error(
                partial(
                    service.correct,
                    registration_id=registration_id,
                    principal_id="platform-admin-yangfan",
                    idempotency_key=CORRECTION_KEY,
                    request=changed,
                ),
                status=409,
                code="IDEMPOTENCY_KEY_REUSED",
            )


@pytest.mark.parametrize(
    "mutation",
    ["game", "unmarked", "same-target", "version"],
)
def test_correction_rejects_every_changed_authority(
    pg_engine: Engine,
    mutation: str,
) -> None:
    case = _seed_correctable_registration(pg_engine)
    registration_id = case.joined_ids[0]
    request = _request()
    with Session(pg_engine) as session:
        row = session.get_one(OpenGameRegistration, registration_id)
        if mutation == "game":
            order = session.get_one(Order, case.game.booking.order_id)
            order.status = OrderStatus.CONFIRMED
            order.checked_in_at = None
            order.checked_in_by_user_id = None
            order.completed_at = None
            order.completed_by_user_id = None
        elif mutation == "unmarked":
            row.attendance_status = OpenGameAttendanceStatus.UNMARKED
            row.attendance_recorded_at = None
            row.attendance_recorded_by_user_id = None
        elif mutation == "same-target":
            request = _request(attendance_status=OpenGameAttendanceStatus.NO_SHOW)
        elif mutation == "version":
            request = _request(expected_version=4)
        else:
            raise AssertionError(mutation)
        session.commit()

        _assert_error(
            partial(
                _service(session).correct,
                registration_id=registration_id,
                principal_id="platform-admin-yangfan",
                idempotency_key=CORRECTION_KEY,
                request=request,
            ),
            status=409,
            code="ATTENDANCE_STATE_CHANGED",
        )


def test_allowed_correction_defensively_blocks_incomplete_original_audit() -> None:
    allowed = _allowed_correction(
        game_completed=True,
        registration_status=OpenGameRegistrationStatus.JOINED,
        attendance_status=OpenGameAttendanceStatus.NO_SHOW,
        attendance_recorded_at=None,
        attendance_recorded_by_user_id=uuid.uuid4(),
    )
    assert allowed.model_dump(mode="json") == {
        "target_status": None,
        "blocked_reason": "ATTENDANCE_AUDIT_INCOMPLETE",
    }
    not_joined = _allowed_correction(
        game_completed=True,
        registration_status=OpenGameRegistrationStatus.REJECTED,
        attendance_status=OpenGameAttendanceStatus.NO_SHOW,
        attendance_recorded_at=ATTENDANCE_NOW,
        attendance_recorded_by_user_id=uuid.uuid4(),
    )
    assert not_joined.model_dump(mode="json") == {
        "target_status": None,
        "blocked_reason": "REGISTRATION_NOT_JOINED",
    }


def test_lookup_returns_closed_blocked_reasons_and_not_found(
    pg_engine: Engine,
) -> None:
    case = _seed_correctable_registration(pg_engine)
    registration_id = case.joined_ids[0]
    with Session(pg_engine) as session:
        row = session.get_one(OpenGameRegistration, registration_id)
        row.attendance_status = OpenGameAttendanceStatus.UNMARKED
        row.attendance_recorded_at = None
        row.attendance_recorded_by_user_id = None
        session.commit()
        detail = _service(session).get_registration(registration_id)
        assert detail.allowed_correction.model_dump(mode="json") == {
            "target_status": None,
            "blocked_reason": "ATTENDANCE_UNMARKED",
        }
        _assert_error(
            partial(_service(session).get_registration, uuid.uuid4()),
            status=404,
            code="ATTENDANCE_REGISTRATION_NOT_FOUND",
        )


def test_reason_normalization_uses_unicode_length_after_stripping_all_whitespace() -> None:
    normalized = _request(reason="\t\n　核对完成　\r\n")
    assert normalized.reason == "核对完成"
    assert _request(reason="足" * 1000).reason == "足" * 1000
    for invalid in ("\t\n　", "足" * 1001):
        with pytest.raises(ValidationError):
            _request(reason=invalid)


def test_correction_dtos_reject_contradictory_state_and_non_incrementing_events() -> None:
    for payload in (
        {"target_status": "PRESENT", "blocked_reason": "ATTENDANCE_UNMARKED"},
        {"target_status": None, "blocked_reason": None},
    ):
        with pytest.raises(ValidationError):
            PlatformAttendanceAllowedCorrection.model_validate(payload)

    baseline = {
        "id": uuid.uuid4(),
        "registration_id": uuid.uuid4(),
        "from_status": "NO_SHOW",
        "to_status": "PRESENT",
        "reason": "现场复核完成",
        "corrected_by_principal_id": "platform-admin-yangfan",
        "corrected_at": CORRECTION_NOW,
        "registration_version_before": 3,
        "registration_version_after": 4,
    }
    for changed in (
        {"to_status": "NO_SHOW"},
        {"registration_version_after": 5},
    ):
        with pytest.raises(ValidationError):
            PlatformAttendanceCorrectionEvent.model_validate({**baseline, **changed})


@pytest.mark.parametrize(
    "history_fault",
    ["status_chain", "version_chain", "tail_status", "tail_version"],
)
def test_lookup_blocks_correction_when_history_is_not_a_complete_chain(
    pg_engine: Engine,
    history_fault: str,
) -> None:
    case = _seed_correctable_registration(pg_engine)
    registration_id = case.joined_ids[0]
    first = OpenGameAttendanceCorrection(
        id=uuid.uuid4(),
        registration_id=registration_id,
        from_status=OpenGameAttendanceStatus.NO_SHOW,
        to_status=OpenGameAttendanceStatus.PRESENT,
        reason="首次平台纠正",
        corrected_by_principal_id="platform-admin-first",
        corrected_at=CORRECTION_NOW,
        registration_version_before=3,
        registration_version_after=4,
        idempotency_key=f"history-first-{history_fault}",
        request_sha256="a" * 64,
    )
    with Session(pg_engine) as session:
        registration = session.get_one(OpenGameRegistration, registration_id)
        session.add(first)
        if history_fault in {"status_chain", "version_chain"}:
            second = OpenGameAttendanceCorrection(
                id=uuid.uuid4(),
                registration_id=registration_id,
                from_status=(
                    OpenGameAttendanceStatus.NO_SHOW
                    if history_fault == "status_chain"
                    else OpenGameAttendanceStatus.PRESENT
                ),
                to_status=(
                    OpenGameAttendanceStatus.PRESENT
                    if history_fault == "status_chain"
                    else OpenGameAttendanceStatus.NO_SHOW
                ),
                reason="第二次平台纠正",
                corrected_by_principal_id="platform-admin-second",
                corrected_at=CORRECTION_NOW,
                registration_version_before=(4 if history_fault == "status_chain" else 5),
                registration_version_after=(5 if history_fault == "status_chain" else 6),
                idempotency_key=f"history-second-{history_fault}",
                request_sha256="b" * 64,
            )
            session.add(second)
            registration.attendance_status = second.to_status
            registration.version = second.registration_version_after
        elif history_fault == "tail_status":
            registration.attendance_status = OpenGameAttendanceStatus.NO_SHOW
            registration.version = 4
        elif history_fault == "tail_version":
            registration.attendance_status = OpenGameAttendanceStatus.PRESENT
            registration.version = 5
        session.commit()

        detail = _service(session).get_registration(registration_id)

    assert detail.allowed_correction.model_dump(mode="json") == {
        "target_status": None,
        "blocked_reason": "ATTENDANCE_AUDIT_INCOMPLETE",
    }
    _assert_static_contract_accepts_detail(detail.model_dump(mode="json"))


def test_correction_digest_covers_normalized_command_and_locked_game() -> None:
    registration_id = uuid.uuid4()
    game_id = uuid.uuid4()
    baseline = _correction_request_digest(
        registration_id=registration_id,
        game_id=game_id,
        request=_request(),
    )
    variants = (
        (uuid.uuid4(), game_id, _request()),
        (registration_id, uuid.uuid4(), _request()),
        (registration_id, game_id, _request(expected_version=4)),
        (
            registration_id,
            game_id,
            _request(attendance_status=OpenGameAttendanceStatus.NO_SHOW),
        ),
        (registration_id, game_id, _request(reason="不同理由")),
    )
    assert all(
        _correction_request_digest(
            registration_id=variant_registration_id,
            game_id=variant_game_id,
            request=variant_request,
        )
        != baseline
        for variant_registration_id, variant_game_id, variant_request in variants
    )
