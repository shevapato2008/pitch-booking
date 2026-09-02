import hashlib
import io
import threading
import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import Engine, select
from sqlalchemy.orm import Session

from backend.app.config import Settings
from backend.app.database import get_database
from backend.app.errors import AppError
from backend.app.main import create_app
from backend.app.models import (
    IdempotencyRecord,
    OpenGame,
    OpenGameRegistration,
    OpenGameRegistrationPosition,
    OpenGameRegistrationStatus,
    User,
    UserSession,
)
from backend.app.modules.auth.repository import AuthRepository
from backend.app.modules.open_game_registrations.dto import (
    CreateRegistrationRequest,
    WithdrawalRequest,
)
from backend.app.modules.open_game_registrations.lifecycle import WithdrawalAction
from backend.app.modules.open_game_registrations.repository import (
    OpenGameRegistrationRepository,
)
from backend.app.modules.open_game_registrations.router import (
    get_open_game_registration_clock,
)
from backend.app.modules.venue_profiles.local_storage import LocalMediaStorage
from backend.tests.test_open_game_registration_api import (
    APPLICANT_TOKEN,
    OWNER_TOKEN,
)
from backend.tests.test_open_game_registration_service import (
    _add_registration,
    _new_user,
    _request,
    _seed_published_game,
    _service,
)
from backend.tests.test_open_game_service import NOW

pytestmark = pytest.mark.integration


def _set_public_profile(
    user: User,
    *,
    nickname: str,
    avatar_key: str | None = None,
) -> None:
    user.public_nickname = nickname
    user.public_avatar_object_key = avatar_key or (
        f"published/avatars/{uuid.uuid4()}.png"
    )
    user.public_profile_updated_at = NOW
    user.public_profile_version = 1


def _attach_session(
    session: Session,
    *,
    user: User,
    token: str,
) -> None:
    session.add(
        UserSession(
            user=user,
            token_hash=hashlib.sha256(token.encode()).hexdigest(),
            issued_at=datetime.now(UTC) - timedelta(minutes=1),
            expires_at=datetime.now(UTC) + timedelta(days=1),
        )
    )


def _client(engine: Engine, storage: LocalMediaStorage) -> TestClient:
    app = create_app(
        settings=Settings(app_env="test", wechat_provider="development"),
        venue_media_store=storage,
    )

    def database_override() -> Iterator[Session]:
        with Session(engine) as session:
            yield session

    app.dependency_overrides[get_database] = database_override
    app.dependency_overrides[get_open_game_registration_clock] = lambda: lambda: NOW
    return TestClient(app, raise_server_exceptions=False)


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _idempotent(token: str, key: str) -> dict[str, str]:
    return {**_auth(token), "Idempotency-Key": key}


def _png_bytes() -> bytes:
    output = io.BytesIO()
    Image.new("RGB", (32, 32), (34, 139, 94)).save(output, "PNG")
    return output.getvalue()


def test_legacy_registration_resources_stay_decodable_beside_new_signup_resources(
    pg_engine: Engine,
) -> None:
    case = _seed_published_game(pg_engine)
    with Session(pg_engine) as session:
        applicant = session.get_one(User, case.booking.stranger_id)
        _attach_session(session, user=applicant, token=APPLICANT_TOKEN)
        session.commit()

    with _client(pg_engine, LocalMediaStorage()) as client:
        legacy_context = client.get(
            f"/api/v1/shared-games/{case.share_token}/registration-context",
            headers=_auth(APPLICANT_TOKEN),
        )
        assert legacy_context.status_code == 200, legacy_context.text
        assert set(legacy_context.json()) == {
            "game",
            "remaining_spots",
            "viewer_authenticated",
            "viewer_registration",
            "allowed_actions",
        }

        legacy_application = client.post(
            f"/api/v1/shared-games/{case.share_token}/applications",
            headers=_idempotent(APPLICANT_TOKEN, "legacy-application-key-000001"),
            json={
                "display_name": "旧包球友",
                "position": "ANY",
                "note": None,
                "adult_confirmed": True,
                "risk_confirmed": True,
            },
        )
        assert legacy_application.status_code == 201, legacy_application.text
        assert set(legacy_application.json()) == set(legacy_context.json())
        assert legacy_application.json()["viewer_registration"][
            "persisted_status"
        ] == "APPLIED"

        legacy_withdrawal = client.post(
            "/api/v1/open-game-applications/"
            f"{legacy_application.json()['viewer_registration']['id']}/withdraw",
            headers=_idempotent(APPLICANT_TOKEN, "legacy-withdrawal-key-0000001"),
            json={"action": "WITHDRAW_APPLICATION", "expected_version": 1},
        )
        assert legacy_withdrawal.status_code == 200, legacy_withdrawal.text
        assert set(legacy_withdrawal.json()) == set(legacy_context.json())
        assert legacy_withdrawal.json()["viewer_registration"][
            "persisted_status"
        ] == "WITHDRAWN"

        signup_context = client.get(
            f"/api/v1/shared-games/{case.share_token}/signup-context",
            headers=_auth(APPLICANT_TOKEN),
        )
        assert signup_context.status_code == 200, signup_context.text
        assert {
            "joined_count",
            "waitlist_count",
            "joined_members",
            "waitlisted_members",
            "blocked_members",
        } <= set(signup_context.json())


def test_registration_context_hides_rosters_anonymously_and_projects_only_public_profile(
    pg_engine: Engine,
) -> None:
    case = _seed_published_game(pg_engine)
    with Session(pg_engine) as session:
        owner = session.get_one(User, case.booking.owner_id)
        viewer = session.get_one(User, case.booking.stranger_id)
        _set_public_profile(owner, nickname="队长")
        _set_public_profile(viewer, nickname="看球的人")

        joined_user = _new_user(session, "shared-roster-joined")
        _set_public_profile(joined_user, nickname="正式小翼")
        joined = _add_registration(
            session,
            game_id=case.game_id,
            applicant_user_id=joined_user.id,
            status=OpenGameRegistrationStatus.JOINED,
            decided_by_user_id=joined_user.id,
            display_name="不应作为公开昵称",
            position=OpenGameRegistrationPosition.DEFENDER,
            note="不得公开的正式成员备注",
        )

        legacy_user = User(
            wechat_app_id="wx-open-game-registration-test",
            wechat_openid=f"unconfirmed-legacy-{uuid.uuid4()}",
        )
        session.add(legacy_user)
        session.flush()
        legacy_joined = _add_registration(
            session,
            game_id=case.game_id,
            applicant_user_id=legacy_user.id,
            status=OpenGameRegistrationStatus.JOINED,
            decided_by_user_id=legacy_user.id,
            display_name="只给旧队长看的称呼",
            applied_at=NOW - timedelta(minutes=9),
        )

        waitlisted_user = _new_user(session, "shared-roster-waitlisted")
        _set_public_profile(waitlisted_user, nickname="候补小翼")
        waitlisted = _add_registration(
            session,
            game_id=case.game_id,
            applicant_user_id=waitlisted_user.id,
            status=OpenGameRegistrationStatus.WAITLISTED,
            decided_by_user_id=waitlisted_user.id,
            display_name="候补旧称呼",
            position=OpenGameRegistrationPosition.GOALKEEPER,
            note="不得公开的候补备注",
            waitlist_seq=7,
            waitlisted_at=NOW - timedelta(minutes=5),
        )

        blocked_user = _new_user(session, "shared-roster-blocked")
        _set_public_profile(blocked_user, nickname="被移除小翼")
        blocked = _add_registration(
            session,
            game_id=case.game_id,
            applicant_user_id=blocked_user.id,
            status=OpenGameRegistrationStatus.JOINED,
            decided_by_user_id=blocked_user.id,
            display_name="被移除旧称呼",
        )
        blocked.status = OpenGameRegistrationStatus.REMOVED
        blocked.version += 1
        blocked.removed_at = NOW
        blocked.removed_by_user_id = owner.id
        blocked.reapply_blocked = True
        session.commit()

        service = _service(session)
        anonymous = service.get_signup_context(
            share_token=case.share_token,
            viewer_user_id=None,
        ).model_dump(mode="json")
        regular = service.get_signup_context(
            share_token=case.share_token,
            viewer_user_id=viewer.id,
        ).model_dump(mode="json")
        captain = service.get_signup_context(
            share_token=case.share_token,
            viewer_user_id=owner.id,
        ).model_dump(mode="json")

        assert anonymous["joined_count"] == 2
        assert anonymous["waitlist_count"] == 1
        assert anonymous["joined_members"] is None
        assert anonymous["waitlisted_members"] is None
        assert anonymous["blocked_members"] is None
        serialized_anonymous = str(anonymous)
        assert "正式小翼" not in serialized_anonymous
        assert "候补小翼" not in serialized_anonymous

        assert regular["joined_members"] == [
            {"nickname": "正式小翼", "avatar_url": None},
            {"nickname": "资料待补充", "avatar_url": None},
        ]
        assert regular["waitlisted_members"] == [
            {
                "nickname": "候补小翼",
                "avatar_url": None,
                "waitlist_position": 1,
            }
        ]
        assert regular["blocked_members"] is None
        assert "management_game_id" not in regular
        serialized_regular = str(regular)
        for private_value in (
            str(joined.id),
            str(waitlisted.id),
            str(joined_user.id),
            str(legacy_joined.id),
            str(legacy_user.id),
            "不应作为公开昵称",
            "只给旧队长看的称呼",
            "候补旧称呼",
            "DEFENDER",
            "GOALKEEPER",
            "不得公开的正式成员备注",
            "不得公开的候补备注",
        ):
            assert private_value not in serialized_regular

        assert captain["management_game_id"] == str(case.game_id)
        assert captain["joined_members"][0]["management"] == {
            "registration_id": str(joined.id),
            "version": joined.version,
            "can_remove": True,
            "can_allow_reapply": False,
        }
        assert captain["waitlisted_members"][0]["management"] == {
            "registration_id": str(waitlisted.id),
            "version": waitlisted.version,
            "can_remove": True,
            "can_allow_reapply": False,
        }
        assert captain["blocked_members"] == [
            {
                "nickname": "被移除小翼",
                "avatar_url": None,
                "management": {
                    "registration_id": str(blocked.id),
                    "version": blocked.version,
                    "can_remove": False,
                    "can_allow_reapply": True,
                },
            }
        ]


def test_signup_context_holds_the_order_lock_across_counts_and_roster_projection(
    pg_engine: Engine,
) -> None:
    case = _seed_published_game(pg_engine)
    with Session(pg_engine) as session:
        applicant = session.get_one(User, case.booking.stranger_id)
        _set_public_profile(applicant, nickname="并发报名球友")
        session.commit()

    joined_count_read = threading.Event()
    release_context = threading.Event()
    signup_finished = threading.Event()
    reader_results: list[object] = []
    signup_results: list[object] = []

    class PausingRepository(OpenGameRegistrationRepository):
        def count_joined(self, *, game_id: uuid.UUID) -> int:
            result = super().count_joined(game_id=game_id)
            joined_count_read.set()
            assert release_context.wait(timeout=3)
            return result

    def read_context() -> None:
        with Session(pg_engine) as session:
            try:
                reader_results.append(
                    _service(
                        session,
                        registration_repository=PausingRepository(session),
                    ).get_signup_context(
                        share_token=case.share_token,
                        viewer_user_id=case.booking.owner_id,
                    )
                )
            except BaseException as error:
                reader_results.append(error)

    def signup() -> None:
        assert joined_count_read.wait(timeout=3)
        with Session(pg_engine) as session:
            try:
                signup_results.append(
                    _service(session).signup(
                        share_token=case.share_token,
                            applicant_user_id=case.booking.stranger_id,
                            idempotency_key="interleaved-signup-key-0000001",
                            request=CreateRegistrationRequest.model_validate(
                                _request(display_name="并发报名球友").model_dump()
                            ),
                    )
                )
            except BaseException as error:
                signup_results.append(error)
            finally:
                signup_finished.set()

    reader = threading.Thread(target=read_context)
    writer = threading.Thread(target=signup)
    reader.start()
    assert joined_count_read.wait(timeout=3)
    writer.start()
    signup_completed_while_context_was_paused = signup_finished.wait(timeout=0.4)
    release_context.set()
    reader.join(timeout=3)
    writer.join(timeout=3)

    assert signup_completed_while_context_was_paused is False
    assert len(reader_results) == 1
    assert not isinstance(reader_results[0], BaseException)
    assert reader_results[0].joined_count == 0
    assert reader_results[0].joined_members == ()
    assert len(signup_results) == 1
    assert not isinstance(signup_results[0], BaseException)
    assert signup_results[0].viewer_registration.persisted_status == "JOINED"


def test_direct_signup_locks_public_profile_through_commit(
    pg_engine: Engine,
) -> None:
    case = _seed_published_game(pg_engine)
    with Session(pg_engine) as session:
        applicant = session.get_one(User, case.booking.stranger_id)
        _set_public_profile(applicant, nickname="提交昵称")
        session.commit()

    applicant_locked = threading.Event()
    release_signup = threading.Event()
    profile_update_finished = threading.Event()
    signup_results: list[object] = []
    profile_results: list[object] = []

    class PausingRepository(OpenGameRegistrationRepository):
        def lock_applicant(self, *, user_id: uuid.UUID) -> User | None:
            result = super().lock_applicant(user_id=user_id)
            applicant_locked.set()
            assert release_signup.wait(timeout=3)
            return result

    def signup() -> None:
        with Session(pg_engine) as session:
            try:
                signup_results.append(
                    _service(
                        session,
                        registration_repository=PausingRepository(session),
                    ).signup(
                        share_token=case.share_token,
                        applicant_user_id=case.booking.stranger_id,
                        idempotency_key="profile-lock-signup-key-000001",
                        request=CreateRegistrationRequest.model_validate(
                            _request(display_name="提交昵称").model_dump()
                        ),
                    )
                )
            except BaseException as error:
                signup_results.append(error)

    def update_profile() -> None:
        assert applicant_locked.wait(timeout=3)
        with Session(pg_engine) as session:
            try:
                user = AuthRepository(session).lock_user(case.booking.stranger_id)
                assert user is not None
                user.public_nickname = "跨设备新昵称"
                user.public_profile_version += 1
                session.commit()
                profile_results.append(user.public_nickname)
            except BaseException as error:
                profile_results.append(error)
            finally:
                profile_update_finished.set()

    signup_thread = threading.Thread(target=signup)
    profile_thread = threading.Thread(target=update_profile)
    signup_thread.start()
    assert applicant_locked.wait(timeout=3)
    profile_thread.start()
    profile_finished_before_signup_commit = profile_update_finished.wait(timeout=0.4)
    release_signup.set()
    signup_thread.join(timeout=3)
    profile_thread.join(timeout=3)

    assert profile_finished_before_signup_commit is False
    assert len(signup_results) == 1
    assert not isinstance(signup_results[0], BaseException)
    assert signup_results[0].viewer_registration.display_name == "提交昵称"
    assert profile_results == ["跨设备新昵称"]


def test_direct_signup_refreshes_a_preloaded_profile_before_comparing_nickname(
    pg_engine: Engine,
) -> None:
    case = _seed_published_game(pg_engine)
    with Session(pg_engine) as seed_session:
        applicant = seed_session.get_one(User, case.booking.stranger_id)
        _set_public_profile(applicant, nickname="旧昵称")
        seed_session.commit()

    with Session(pg_engine) as signup_session:
        preloaded = signup_session.get_one(User, case.booking.stranger_id)
        assert preloaded.public_nickname == "旧昵称"
        with Session(pg_engine) as profile_session:
            updated = profile_session.get_one(User, case.booking.stranger_id)
            updated.public_nickname = "最新昵称"
            updated.public_profile_version += 1
            profile_session.commit()

        with pytest.raises(AppError) as raised:
            _service(signup_session).signup(
                share_token=case.share_token,
                applicant_user_id=case.booking.stranger_id,
                idempotency_key="stale-identity-map-signup-00001",
                request=CreateRegistrationRequest.model_validate(
                    _request(display_name="旧昵称").model_dump()
                ),
            )

    assert raised.value.status_code == 409
    assert raised.value.code == "PUBLIC_PROFILE_CHANGED"


def test_direct_signup_withdrawal_promotion_and_reapply_use_live_open_spots_and_fifo(
    pg_engine: Engine,
) -> None:
    case = _seed_published_game(pg_engine)
    with Session(pg_engine) as session:
        game = session.get_one(OpenGame, case.game_id)
        game.open_spots = 1
        first_user = session.get_one(User, case.booking.stranger_id)
        second_user = _new_user(session, "direct-signup-second")
        _set_public_profile(first_user, nickname="翼")
        _set_public_profile(second_user, nickname="第二位")
        session.commit()

        service = _service(session)
        first = service.signup(
            share_token=case.share_token,
            applicant_user_id=first_user.id,
            idempotency_key="direct-signup-first-key-000001",
            request=CreateRegistrationRequest.model_validate(
                _request(display_name="球友").model_dump()
                | {"display_name": "翼"}
            ),
        )
        second = service.signup(
            share_token=case.share_token,
            applicant_user_id=second_user.id,
            idempotency_key="direct-signup-second-key-00001",
            request=_request(display_name="第二位"),
        )

        assert first.viewer_registration is not None
        assert first.viewer_registration.persisted_status.value == "JOINED"
        assert first.viewer_registration.display_name == "翼"
        persisted_first = session.get_one(
            OpenGameRegistration,
            first.viewer_registration.id,
        )
        assert persisted_first.display_name == "翼"
        assert first.joined_count == 1
        assert second.viewer_registration is not None
        assert second.viewer_registration.persisted_status.value == "WAITLISTED"
        assert second.viewer_registration.waitlist_position == 1
        assert second.waitlist_count == 1

        withdrawn = service.withdraw_registration(
            application_id=first.viewer_registration.id,
            applicant_user_id=first_user.id,
            idempotency_key="direct-signup-withdraw-key-00001",
            request=WithdrawalRequest(
                action=WithdrawalAction.LEAVE_GAME,
                expected_version=first.viewer_registration.version,
            ),
        )
        promoted = session.get_one(
            OpenGameRegistration,
            second.viewer_registration.id,
        )

        assert withdrawn.viewer_registration is not None
        assert withdrawn.viewer_registration.persisted_status.value == "WITHDRAWN"
        assert withdrawn.allowed_actions.can_apply is True
        assert promoted.status is OpenGameRegistrationStatus.JOINED
        assert promoted.promoted_at == NOW
        new_withdrawal_record = session.scalar(
            select(IdempotencyRecord).where(
                IdempotencyRecord.key == "direct-signup-withdraw-key-00001"
            )
        )
        assert new_withdrawal_record is not None
        assert new_withdrawal_record.operation == "withdraw_open_game_registration"

        _set_public_profile(first_user, nickname="龙")
        reapplied = service.signup(
            share_token=case.share_token,
            applicant_user_id=first_user.id,
            idempotency_key="direct-signup-reapply-key-00001",
            request=CreateRegistrationRequest.model_validate(
                _request(display_name="第一位再次报名").model_dump()
                | {"display_name": "龙"}
            ),
        )

        assert reapplied.viewer_registration is not None
        assert reapplied.viewer_registration.id == first.viewer_registration.id
        assert reapplied.viewer_registration.persisted_status.value == "WAITLISTED"
        assert reapplied.viewer_registration.display_name == "龙"
        assert reapplied.viewer_registration.waitlist_position == 1
        persisted = session.get_one(OpenGameRegistration, first.viewer_registration.id)
        assert persisted.waitlist_seq == 2
        assert persisted.display_name == "龙"


def test_direct_signup_does_not_skip_an_older_legacy_applied_registration(
    pg_engine: Engine,
) -> None:
    case = _seed_published_game(pg_engine)
    with Session(pg_engine) as session:
        game = session.get_one(OpenGame, case.game_id)
        game.open_spots = 1
        legacy_user = session.get_one(User, case.booking.stranger_id)
        legacy = _add_registration(
            session,
            game_id=game.id,
            applicant_user_id=legacy_user.id,
            status=OpenGameRegistrationStatus.APPLIED,
            applied_at=NOW - timedelta(minutes=5),
        )
        legacy_version = legacy.version
        newcomer = _new_user(session, "legacy-fairness-newcomer")
        _set_public_profile(newcomer, nickname="新报名")
        session.commit()

        context = _service(session).signup(
            share_token=case.share_token,
            applicant_user_id=newcomer.id,
            idempotency_key="legacy-fairness-signup-key-0001",
            request=CreateRegistrationRequest.model_validate(
                _request(display_name="新报名").model_dump()
            ),
        )

        persisted_legacy = session.get_one(OpenGameRegistration, legacy.id)
        assert persisted_legacy.status is OpenGameRegistrationStatus.JOINED
        assert persisted_legacy.version == legacy_version + 1
        assert persisted_legacy.decided_at == NOW
        assert persisted_legacy.decided_by_user_id == legacy_user.id
        assert context.viewer_registration is not None
        assert context.viewer_registration.persisted_status == "WAITLISTED"
        assert context.viewer_registration.waitlist_position == 1


def test_captain_can_remove_waitlist_then_unblock_before_the_player_reapplies(
    pg_engine: Engine,
) -> None:
    case = _seed_published_game(pg_engine)
    with Session(pg_engine) as session:
        owner = session.get_one(User, case.booking.owner_id)
        applicant = session.get_one(User, case.booking.stranger_id)
        _set_public_profile(applicant, nickname="解除后重报")
        _attach_session(session, user=owner, token=OWNER_TOKEN)
        _attach_session(session, user=applicant, token=APPLICANT_TOKEN)
        target = _add_registration(
            session,
            game_id=case.game_id,
            applicant_user_id=applicant.id,
            status=OpenGameRegistrationStatus.WAITLISTED,
            decided_by_user_id=applicant.id,
            waitlist_seq=1,
            waitlisted_at=NOW - timedelta(minutes=5),
        )
        session.commit()
        target_id = target.id
        target_version = target.version

    storage = LocalMediaStorage()
    with _client(pg_engine, storage) as client:
        removed = client.post(
            f"/api/v1/games/{case.game_id}/members/{target_id}/remove",
            headers=_idempotent(OWNER_TOKEN, "remove-waitlist-member-key-0001"),
            json={"expected_version": target_version, "reason": "候补名单调整"},
        )
        assert removed.status_code == 200, removed.text

        blocked = client.post(
            f"/api/v1/shared-games/{case.share_token}/registrations",
            headers=_idempotent(APPLICANT_TOKEN, "blocked-reapply-key-000000001"),
            json={
                "display_name": "解除后重报",
                "position": "ANY",
                "note": None,
                "adult_confirmed": True,
                "risk_confirmed": True,
            },
        )
        assert blocked.status_code == 409, blocked.text
        assert blocked.json()["error"]["details"]["apply_blocked_reason"] == ("REMOVED_BY_CAPTAIN")

        version = removed.json()["version"]
        unblocked = client.post(
            f"/api/v1/games/{case.game_id}/members/{target_id}/unblock",
            headers=_idempotent(OWNER_TOKEN, "unblock-member-key-0000000001"),
            json={"expected_version": version},
        )
        assert unblocked.status_code == 200, unblocked.text
        assert unblocked.json() == {
            "registration_id": str(target_id),
            "status": "REMOVED",
            "version": version + 1,
            "reapply_blocked": False,
        }

        reapplied = client.post(
            f"/api/v1/shared-games/{case.share_token}/registrations",
            headers=_idempotent(APPLICANT_TOKEN, "allowed-reapply-key-000000001"),
            json={
                "display_name": "解除后重报",
                "position": "ANY",
                "note": None,
                "adult_confirmed": True,
                "risk_confirmed": True,
            },
        )
        assert reapplied.status_code == 201, reapplied.text
        assert reapplied.json()["viewer_registration"]["persisted_status"] == "JOINED"


def test_public_profile_uses_a_controlled_user_avatar_upload_and_supports_nickname_only_update(
    pg_engine: Engine,
) -> None:
    case = _seed_published_game(pg_engine)
    with Session(pg_engine) as session:
        applicant = session.get_one(User, case.booking.stranger_id)
        _attach_session(session, user=applicant, token=APPLICANT_TOKEN)
        session.commit()

    storage = LocalMediaStorage()
    with _client(pg_engine, storage) as client:
        missing = client.get(
            "/api/v1/auth/wechat/profile",
            headers=_auth(APPLICANT_TOKEN),
        )
        assert missing.status_code == 200, missing.text
        assert missing.json() == {
            "nickname": None,
            "avatar_url": None,
            "profile_version": 0,
            "confirmed_at": None,
        }

        incomplete_signup = client.post(
            f"/api/v1/shared-games/{case.share_token}/registrations",
            headers=_idempotent(
                APPLICANT_TOKEN,
                "profile-required-signup-key-0001",
            ),
            json={
                "display_name": "尚未确认资料",
                "position": "ANY",
                "note": None,
                "adult_confirmed": True,
                "risk_confirmed": True,
            },
        )
        assert incomplete_signup.status_code == 409, incomplete_signup.text
        assert incomplete_signup.json()["error"]["code"] == "PUBLIC_PROFILE_REQUIRED"
        assert incomplete_signup.json()["error"]["message"] == "请先确认公开昵称，再报名。"

        payload = _png_bytes()
        intent = client.post(
            "/api/v1/auth/wechat/profile/avatar/upload-intents",
            headers=_auth(APPLICANT_TOKEN),
            json={"mime_type": "image/png", "byte_size": len(payload)},
        )
        assert intent.status_code == 201, intent.text
        upload = intent.json()
        assert upload["object_key"].startswith(f"private/users/{case.booking.stranger_id}/avatars/")
        storage.accept_upload(upload["object_key"], payload, upload["required_headers"])

        confirmed = client.put(
            "/api/v1/auth/wechat/profile",
            headers=_auth(APPLICANT_TOKEN),
            json={
                "nickname": "公开小翼",
                "avatar_object_key": upload["object_key"],
            },
        )
        assert confirmed.status_code == 200, confirmed.text
        assert confirmed.json()["nickname"] == "公开小翼"
        assert confirmed.json()["profile_version"] == 1
        assert confirmed.json()["avatar_url"].startswith("https://local.invalid/media/")
        assert "private/" not in confirmed.json()["avatar_url"]

        renamed = client.put(
            "/api/v1/auth/wechat/profile",
            headers=_auth(APPLICANT_TOKEN),
            json={"nickname": "改名小翼", "avatar_object_key": None},
        )
        assert renamed.status_code == 200, renamed.text
        assert renamed.json()["nickname"] == "改名小翼"
        assert renamed.json()["avatar_url"] == confirmed.json()["avatar_url"]
        assert renamed.json()["profile_version"] == 2

        arbitrary_url = client.put(
            "/api/v1/auth/wechat/profile",
            headers=_auth(APPLICANT_TOKEN),
            json={
                "nickname": "远端头像",
                "avatar_object_key": "https://attacker.invalid/avatar.png",
            },
        )
        assert arbitrary_url.status_code == 422

        stale_profile = client.post(
            f"/api/v1/shared-games/{case.share_token}/registrations",
            headers=_idempotent(APPLICANT_TOKEN, "stale-profile-signup-key-00001"),
            json={
                "display_name": "公开小翼",
                "position": "ANY",
                "note": None,
                "adult_confirmed": True,
                "risk_confirmed": True,
            },
        )
        assert stale_profile.status_code == 409, stale_profile.text
        assert stale_profile.json()["error"]["code"] == "PUBLIC_PROFILE_CHANGED"

        joined = client.post(
            f"/api/v1/shared-games/{case.share_token}/registrations",
            headers=_idempotent(APPLICANT_TOKEN, "profile-backed-signup-key-00001"),
            json={
                "display_name": "改名小翼",
                "position": "ANY",
                "note": None,
                "adult_confirmed": True,
                "risk_confirmed": True,
            },
        )
        assert joined.status_code == 201, joined.text
        assert joined.headers["cache-control"] == "private, no-store"
        assert joined.headers["vary"] == "Authorization"
        assert joined.json()["joined_members"] == [
            {
                "nickname": "改名小翼",
                "avatar_url": confirmed.json()["avatar_url"],
            }
        ]
        assert str(case.booking.stranger_id) not in joined.json()["joined_members"][0][
            "avatar_url"
        ]

        anonymous = client.get(
            f"/api/v1/shared-games/{case.share_token}/signup-context"
        )
        assert anonymous.status_code == 200, anonymous.text
        assert anonymous.headers["cache-control"] == "private, no-store"
        assert anonymous.headers["vary"] == "Authorization"
        assert anonymous.json()["joined_members"] is None

    with Session(pg_engine) as session:
        user = session.get_one(User, case.booking.stranger_id)
        assert user.public_nickname == "改名小翼"
        assert user.public_avatar_object_key.startswith("published/avatars/")
        assert str(user.id) not in user.public_avatar_object_key
        assert user.public_profile_version == 2
        assert user.public_profile_updated_at is not None


def test_first_public_profile_confirmation_and_direct_signup_allow_no_avatar(
    pg_engine: Engine,
) -> None:
    case = _seed_published_game(pg_engine)
    with Session(pg_engine) as session:
        applicant = session.get_one(User, case.booking.stranger_id)
        _attach_session(session, user=applicant, token=APPLICANT_TOKEN)
        session.commit()

    with _client(pg_engine, LocalMediaStorage()) as client:
        confirmed = client.put(
            "/api/v1/auth/wechat/profile",
            headers=_auth(APPLICANT_TOKEN),
            json={"nickname": "微信用户", "avatar_object_key": None},
        )
        assert confirmed.status_code == 200, confirmed.text
        assert confirmed.json()["nickname"] == "微信用户"
        assert confirmed.json()["avatar_url"] is None
        assert confirmed.json()["profile_version"] == 1
        assert confirmed.json()["confirmed_at"] is not None

        joined = client.post(
            f"/api/v1/shared-games/{case.share_token}/registrations",
            headers=_idempotent(APPLICANT_TOKEN, "avatarless-signup-key-00000001"),
            json={
                "display_name": "微信用户",
                "position": "ANY",
                "note": None,
                "adult_confirmed": True,
                "risk_confirmed": True,
            },
        )
        assert joined.status_code == 201, joined.text
        assert joined.json()["viewer_registration"]["persisted_status"] == "JOINED"
        assert joined.json()["joined_members"] == [
            {"nickname": "微信用户", "avatar_url": None}
        ]

    with Session(pg_engine) as session:
        user = session.get_one(User, case.booking.stranger_id)
        assert user.public_nickname == "微信用户"
        assert user.public_avatar_object_key is None
        assert user.public_profile_version == 1
        assert user.public_profile_updated_at is not None
