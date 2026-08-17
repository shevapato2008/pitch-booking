from __future__ import annotations

import base64
import hashlib
import io
import uuid
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from threading import Barrier

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import Engine, func, select
from sqlalchemy.orm import Session

from backend.app.config import Settings
from backend.app.database import get_database
from backend.app.errors import AppError
from backend.app.main import create_app
from backend.app.models import (
    BookingMode,
    IdempotencyRecord,
    IdempotencyState,
    User,
    UserSession,
    Venue,
    VenueMembership,
    VenueOnboardingApplication,
    VenueOnboardingEvidence,
    VenueOnboardingEvidenceKind,
    VenueOnboardingEvidenceState,
    VenueOnboardingKind,
    VenueOnboardingStatus,
)
from backend.app.modules.venue_onboarding.dto import SubmitVenueCreate
from backend.app.modules.venue_onboarding.repository import VenueOnboardingRepository
from backend.app.modules.venue_onboarding.service import VenueOnboardingService
from backend.app.modules.venue_onboarding.storage import PrivateStorageUnavailableError
from backend.app.security.phone_vault import PhoneVault

pytestmark = pytest.mark.integration

KEY_BASE64 = base64.b64encode(bytes(range(32))).decode("ascii")
KEY_VERSION = 7
TOKEN = "venue-onboarding-user-token"
OTHER_TOKEN = "venue-onboarding-other-token"


@dataclass(frozen=True)
class _Policy:
    object_prefix: str
    url: str
    fields: dict[str, str]
    expires_at: datetime


@dataclass(frozen=True)
class _Object:
    object_key: str
    data: bytes


class FakePrivateOnboardingStore:
    def __init__(self) -> None:
        self.objects: dict[str, list[_Object]] = {}

    def create_upload_policy(
        self, user_id: uuid.UUID, evidence_id: uuid.UUID, maximum_bytes: int
    ) -> _Policy:
        prefix = f"venue-onboarding/{user_id}/{evidence_id}/"
        return _Policy(
            object_prefix=prefix,
            url="https://private-onboarding.example.test",
            fields={
                "key": f"{prefix}${{filename}}",
                "policy": "short-lived-policy",
                "signature": "test-signature",
                "x-oss-object-acl": "private",
                "x-oss-forbid-overwrite": "true",
                "maximum-bytes": str(maximum_bytes),
            },
            expires_at=datetime.now(UTC) + timedelta(minutes=5),
        )

    def read_private_object(
        self, object_prefix: str, maximum_bytes: int
    ) -> _Object:
        objects = self.objects.get(object_prefix, [])
        if len(objects) != 1:
            raise ValueError("private evidence prefix must contain exactly one object")
        item = objects[0]
        return _Object(item.object_key, item.data[: maximum_bytes + 1])

    def put(self, user_id: uuid.UUID, evidence_id: uuid.UUID, filename: str, data: bytes) -> None:
        prefix = f"venue-onboarding/{user_id}/{evidence_id}/"
        self.objects.setdefault(prefix, []).append(_Object(f"{prefix}{filename}", data))


class BrokenPrivateOnboardingStore(FakePrivateOnboardingStore):
    def create_upload_policy(
        self, user_id: uuid.UUID, evidence_id: uuid.UUID, maximum_bytes: int
    ) -> _Policy:
        raise PrivateStorageUnavailableError("private bucket unavailable")


@dataclass(frozen=True)
class Seeded:
    user_id: uuid.UUID
    other_user_id: uuid.UUID
    listed_venue_id: uuid.UUID
    unlisted_venue_id: uuid.UUID


def _venue(*, name: str, address: str, listed: bool = True, active: bool = True) -> Venue:
    return Venue(
        slug=f"onboarding-{uuid.uuid4().hex}",
        name=name,
        description="场馆",
        price_advantage_text=None,
        timezone=None,
        business_hours_text=None,
        address=address,
        district_code="120101",
        district_name="和平区",
        parking_text=None,
        phone=None,
        refund_policy_text=None,
        latitude=39.12,
        longitude=117.20,
        navigation_poi_name=name,
        navigation_latitude=39.12,
        navigation_longitude=117.20,
        public_pitch_types=[],
        booking_mode=BookingMode.DIRECTORY_ONLY,
        is_listed=listed,
        is_active=active,
    )


def _add_user(session: Session, token: str, *, verified: bool = True) -> User:
    now = datetime.now(UTC)
    user = User(
        wechat_app_id="wx-onboarding",
        wechat_openid=f"openid-{uuid.uuid4()}",
        last_contact_name="历史联系人",
    )
    session.add(user)
    session.flush()
    if verified:
        sealed = PhoneVault(key_base64=KEY_BASE64, key_version=KEY_VERSION).encrypt(
            "13800138000", record_type="user", record_id=user.id, field="phone"
        )
        user.phone_ciphertext = sealed.ciphertext_with_tag
        user.phone_nonce = sealed.nonce
        user.phone_key_version = sealed.key_version
        user.phone_verified_at = now
    session.add(
        UserSession(
            user_id=user.id,
            token_hash=hashlib.sha256(token.encode()).hexdigest(),
            issued_at=now,
            expires_at=now + timedelta(days=1),
        )
    )
    return user


@pytest.fixture
def seeded(pg_engine: Engine) -> Seeded:
    with Session(pg_engine) as session:
        user = _add_user(session, TOKEN)
        other = _add_user(session, OTHER_TOKEN)
        listed = _venue(name="Alpha 足球公园", address="天津市和平区测试路 1 号")
        unlisted = _venue(
            name="内部未公开足球场馆",
            address="天津市和平区隐私路 8 号",
            listed=False,
        )
        inactive = _venue(
            name="停用足球场",
            address="天津市和平区停用路 9 号",
            active=False,
        )
        session.add_all([listed, unlisted, inactive])
        session.commit()
        return Seeded(user.id, other.id, listed.id, unlisted.id)


@pytest.fixture
def store() -> FakePrivateOnboardingStore:
    return FakePrivateOnboardingStore()


def _client(engine: Engine, store: FakePrivateOnboardingStore) -> TestClient:
    app = create_app(
        settings=Settings(
            app_env="test",
            wechat_provider="development",
            phone_encryption_key_base64=KEY_BASE64,
            phone_encryption_key_version=KEY_VERSION,
        ),
        venue_onboarding_store=store,
    )

    def database_override() -> Iterator[Session]:
        with Session(engine) as session:
            yield session

    app.dependency_overrides[get_database] = database_override
    return TestClient(app, raise_server_exceptions=False)


def _headers(token: str = TOKEN, key: str | None = None) -> dict[str, str]:
    result = {"Authorization": f"Bearer {token}"}
    if key is not None:
        result["Idempotency-Key"] = key
    return result


def _image_bytes(image_format: str = "JPEG") -> bytes:
    output = io.BytesIO()
    Image.new("RGB", (20, 20), (30, 130, 230)).save(output, image_format)
    return output.getvalue()


def _completed_evidence(
    session: Session,
    owner_id: uuid.UUID,
    kinds: list[VenueOnboardingEvidenceKind],
) -> dict[str, str]:
    result: dict[str, str] = {}
    for kind in kinds:
        evidence = VenueOnboardingEvidence(
            owner_user_id=owner_id,
            kind=kind,
            state=VenueOnboardingEvidenceState.COMPLETED,
            object_key=f"venue-onboarding/{owner_id}/{uuid.uuid4()}/proof.jpg",
            content_type="image/jpeg",
            byte_size=128,
            content_sha256="a" * 64,
        )
        session.add(evidence)
        session.flush()
        result[kind.value] = str(evidence.id)
    session.commit()
    return result


def test_all_venue_onboarding_routes_require_authentication() -> None:
    client = TestClient(
        create_app(settings=Settings(app_env="test", wechat_provider="development")),
        raise_server_exceptions=False,
    )
    requests = [
        client.get("/api/v1/venue-onboarding/candidates", params={"q": "足球"}),
        client.post(
            "/api/v1/venue-onboarding/evidence/upload-intents",
            headers={"Idempotency-Key": "anonymous-intent-01"},
            json={"kind": "VENUE_EXTERIOR"},
        ),
        client.post(
            f"/api/v1/venue-onboarding/evidence/{uuid.uuid4()}/complete",
            headers={"Idempotency-Key": "anonymous-complete"},
        ),
        client.post(
            "/api/v1/venue-onboarding/claims",
            headers={"Idempotency-Key": "anonymous-claim-01"},
            json={},
        ),
        client.post(
            "/api/v1/venue-onboarding/venues",
            headers={"Idempotency-Key": "anonymous-create-1"},
            json={},
        ),
        client.get("/api/v1/venue-onboarding/applications"),
    ]
    assert [response.status_code for response in requests] == [401] * 6


def test_candidate_search_exposes_only_safe_active_listed_identity(
    pg_engine: Engine, seeded: Seeded, store: FakePrivateOnboardingStore
) -> None:
    client = _client(pg_engine, store)

    response = client.get(
        "/api/v1/venue-onboarding/candidates",
        headers=_headers(),
        params={"q": "足球", "limit": 20},
    )

    assert response.status_code == 200
    assert response.json() == {
        "items": [
            {
                "venue_id": str(seeded.listed_venue_id),
                "name": "Alpha 足球公园",
                "district_name": "和平区",
                "address": "天津市和平区测试路 1 号",
            }
        ],
        "next_cursor": None,
    }
    assert "内部未公开场馆" not in response.text
    assert "停用足球场" not in response.text


def test_candidate_search_and_cursor_share_nfkc_casefold_sort_key(
    pg_engine: Engine, seeded: Seeded, store: FakePrivateOnboardingStore
) -> None:
    with Session(pg_engine) as session:
        variant = _venue(
            name="ＡＬＰＨＡ　　足球馆",
            address="天津市和平区全角路 2 号",
        )
        session.add(variant)
        session.commit()
        variant_id = variant.id
    client = _client(pg_engine, store)

    first = client.get(
        "/api/v1/venue-onboarding/candidates",
        headers=_headers(),
        params={"q": "ＡＬＰＨＡ", "limit": 1},
    )
    second = client.get(
        "/api/v1/venue-onboarding/candidates",
        headers=_headers(),
        params={"q": "ＡＬＰＨＡ", "limit": 1, "cursor": first.json()["next_cursor"]},
    )

    assert first.status_code == second.status_code == 200
    assert [
        first.json()["items"][0]["venue_id"],
        second.json()["items"][0]["venue_id"],
    ] == [str(seeded.listed_venue_id), str(variant_id)]
    assert second.json()["next_cursor"] is None


def test_upload_intent_is_private_owner_scoped_and_idempotent(
    pg_engine: Engine, seeded: Seeded, store: FakePrivateOnboardingStore
) -> None:
    client = _client(pg_engine, store)
    key = "onboarding-intent-0001"

    first = client.post(
        "/api/v1/venue-onboarding/evidence/upload-intents",
        headers=_headers(key=key),
        json={"kind": "BUSINESS_LICENSE"},
    )
    replay = client.post(
        "/api/v1/venue-onboarding/evidence/upload-intents",
        headers=_headers(key=key),
        json={"kind": "BUSINESS_LICENSE"},
    )
    mismatch = client.post(
        "/api/v1/venue-onboarding/evidence/upload-intents",
        headers=_headers(key=key),
        json={"kind": "VENUE_EXTERIOR"},
    )

    assert (first.status_code, replay.status_code) == (201, 200)
    assert replay.json() == first.json()
    body = first.json()
    prefix = f"venue-onboarding/{seeded.user_id}/{body['evidence_id']}/"
    assert body["status"] == "PENDING_UPLOAD"
    assert body["post_policy"]["fields"]["key"] == f"{prefix}${{filename}}"
    assert body["post_policy"]["fields"]["x-oss-object-acl"] == "private"
    assert body["constraints"]["maximum_bytes"] == 10 * 1024 * 1024
    assert mismatch.status_code == 409
    assert mismatch.json()["error"]["code"] == "IDEMPOTENCY_KEY_REUSED"


def test_private_storage_outage_returns_contract_service_unavailable(
    pg_engine: Engine, seeded: Seeded
) -> None:
    client = _client(pg_engine, BrokenPrivateOnboardingStore())

    response = client.post(
        "/api/v1/venue-onboarding/evidence/upload-intents",
        headers=_headers(key="broken-storage-00001"),
        json={"kind": "VENUE_EXTERIOR"},
    )

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "SERVICE_UNAVAILABLE"


def test_complete_authoritatively_verifies_private_bytes_and_replays(
    pg_engine: Engine, seeded: Seeded, store: FakePrivateOnboardingStore
) -> None:
    client = _client(pg_engine, store)
    intent = client.post(
        "/api/v1/venue-onboarding/evidence/upload-intents",
        headers=_headers(key="complete-intent-0001"),
        json={"kind": "VENUE_EXTERIOR"},
    ).json()
    evidence_id = uuid.UUID(intent["evidence_id"])
    store.put(seeded.user_id, evidence_id, "outside.png", _image_bytes("PNG"))

    first = client.post(
        f"/api/v1/venue-onboarding/evidence/{evidence_id}/complete",
        headers=_headers(key="complete-evidence-001"),
    )
    replay = client.post(
        f"/api/v1/venue-onboarding/evidence/{evidence_id}/complete",
        headers=_headers(key="complete-evidence-001"),
    )

    assert first.status_code == replay.status_code == 200
    assert first.json() == {"evidence_id": str(evidence_id), "status": "COMPLETED"}
    assert replay.json() == first.json()
    second_intent = client.post(
        "/api/v1/venue-onboarding/evidence/upload-intents",
        headers=_headers(key="complete-intent-0002"),
        json={"kind": "VENUE_EXTERIOR"},
    ).json()
    second_id = uuid.UUID(second_intent["evidence_id"])
    store.put(seeded.user_id, second_id, "second.jpg", _image_bytes())
    mismatch = client.post(
        f"/api/v1/venue-onboarding/evidence/{second_id}/complete",
        headers=_headers(key="complete-evidence-001"),
    )
    assert mismatch.status_code == 409
    assert mismatch.json()["error"]["code"] == "IDEMPOTENCY_KEY_REUSED"
    with Session(pg_engine) as session:
        evidence = session.get_one(VenueOnboardingEvidence, evidence_id)
        assert evidence.byte_size == len(_image_bytes("PNG"))
        assert evidence.content_sha256 == hashlib.sha256(_image_bytes("PNG")).hexdigest()
        assert evidence.content_type == "image/png"


@pytest.mark.parametrize("object_count", [0, 2])
def test_complete_rejects_missing_or_ambiguous_private_object(
    pg_engine: Engine,
    seeded: Seeded,
    store: FakePrivateOnboardingStore,
    object_count: int,
) -> None:
    client = _client(pg_engine, store)
    intent = client.post(
        "/api/v1/venue-onboarding/evidence/upload-intents",
        headers=_headers(key=f"ambiguous-intent-{object_count}"),
        json={"kind": "VENUE_EXTERIOR"},
    ).json()
    evidence_id = uuid.UUID(intent["evidence_id"])
    for index in range(object_count):
        store.put(seeded.user_id, evidence_id, f"{index}.jpg", _image_bytes())

    response = client.post(
        f"/api/v1/venue-onboarding/evidence/{evidence_id}/complete",
        headers=_headers(key=f"ambiguous-complete-{object_count}"),
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "ONBOARDING_EVIDENCE_INVALID"


def test_claim_requires_exact_completed_owner_evidence_and_snapshots_phone(
    pg_engine: Engine, seeded: Seeded, store: FakePrivateOnboardingStore
) -> None:
    with Session(pg_engine) as session:
        evidence = _completed_evidence(
            session,
            seeded.user_id,
            [
                VenueOnboardingEvidenceKind.MANAGEMENT_AUTHORIZATION,
                VenueOnboardingEvidenceKind.VENUE_EXTERIOR,
            ],
        )
    client = _client(pg_engine, store)
    payload = {
        "venue_id": str(seeded.listed_venue_id),
        "contact_name": "  张 三  ",
        "evidence": evidence,
    }

    first = client.post(
        "/api/v1/venue-onboarding/claims",
        headers=_headers(key="claim-submit-000001"),
        json=payload,
    )
    replay = client.post(
        "/api/v1/venue-onboarding/claims",
        headers=_headers(key="claim-submit-000001"),
        json=payload,
    )

    assert (first.status_code, replay.status_code) == (201, 200)
    assert replay.json() == first.json()
    assert first.json()["kind"] == "CLAIM"
    assert first.json()["venue"]["venue_id"] == str(seeded.listed_venue_id)
    with Session(pg_engine) as session:
        application = session.get_one(
            VenueOnboardingApplication, uuid.UUID(first.json()["application_id"])
        )
        assert application.contact_name == "张 三"
        assert application.proposed_name is None
        assert application.target_venue_id == seeded.listed_venue_id
        assert all(item.application_id == application.id for item in session.scalars(
            select(VenueOnboardingEvidence).where(
                VenueOnboardingEvidence.id.in_(map(uuid.UUID, evidence.values()))
            )
        ))
        phone = PhoneVault(key_base64=KEY_BASE64, key_version=KEY_VERSION).decrypt(
            application_phone(application),
            record_type="venue_onboarding_application",
            record_id=application.id,
            field="contact_phone",
        )
        assert phone == "13800138000"
        assert session.scalar(select(func.count()).select_from(Venue)) == 3
        assert session.scalar(select(func.count()).select_from(VenueMembership)) == 0


def application_phone(application: VenueOnboardingApplication):
    from backend.app.security.phone_vault import SealedPhone

    return SealedPhone(
        application.contact_phone_ciphertext,
        application.contact_phone_nonce,
        application.contact_phone_key_version,
    )


def test_claim_rejects_required_evidence_duplicate_application_and_key_mismatch(
    pg_engine: Engine, seeded: Seeded, store: FakePrivateOnboardingStore
) -> None:
    with Session(pg_engine) as session:
        evidence = _completed_evidence(
            session,
            seeded.user_id,
            [
                VenueOnboardingEvidenceKind.MANAGEMENT_AUTHORIZATION,
                VenueOnboardingEvidenceKind.VENUE_EXTERIOR,
            ],
        )
    client = _client(pg_engine, store)
    payload = {
        "venue_id": str(seeded.listed_venue_id),
        "contact_name": "张三",
        "evidence": evidence,
    }
    missing = client.post(
        "/api/v1/venue-onboarding/claims",
        headers=_headers(key="claim-missing-00001"),
        json={
            **payload,
            "evidence": {
                **evidence,
                "VENUE_EXTERIOR": str(uuid.uuid4()),
            },
        },
    )
    first = client.post(
        "/api/v1/venue-onboarding/claims",
        headers=_headers(key="claim-conflicts-0001"),
        json=payload,
    )
    mismatch = client.post(
        "/api/v1/venue-onboarding/claims",
        headers=_headers(key="claim-conflicts-0001"),
        json={**payload, "contact_name": "李四"},
    )
    duplicate = client.post(
        "/api/v1/venue-onboarding/claims",
        headers=_headers(key="claim-conflicts-0002"),
        json=payload,
    )

    assert missing.status_code == 422
    assert missing.json()["error"]["code"] == "ONBOARDING_EVIDENCE_REQUIRED"
    assert first.status_code == 201
    assert mismatch.status_code == 409
    assert mismatch.json()["error"]["code"] == "IDEMPOTENCY_KEY_REUSED"
    assert duplicate.status_code == 409
    assert duplicate.json()["error"]["code"] == "ONBOARDING_APPLICATION_EXISTS"


def test_create_warns_for_normalized_public_and_private_duplicates(
    pg_engine: Engine, seeded: Seeded, store: FakePrivateOnboardingStore
) -> None:
    client = _client(pg_engine, store)

    def body(address: str) -> dict[str, object]:
        with Session(pg_engine) as session:
            evidence = _completed_evidence(
                session,
                seeded.user_id,
                list(VenueOnboardingEvidenceKind),
            )
        return {
            "name": "新球场",
            "address": address,
            "district_code": "120101",
            "district_name": "和平区",
            "latitude": 39.13,
            "longitude": 117.21,
            "contact_name": "张三",
            "evidence": evidence,
        }

    public = client.post(
        "/api/v1/venue-onboarding/venues",
        headers=_headers(key="create-public-dup-01"),
        json=body("天津市和平区测试路　1 号"),
    )
    private = client.post(
        "/api/v1/venue-onboarding/venues",
        headers=_headers(key="create-private-dup-1"),
        json=body("天津市和平区隐私路 8 号"),
    )
    nearby_body = body("天津市和平区另一条路 99 号")
    nearby_body["latitude"] = 39.1205
    nearby_body["longitude"] = 117.2005
    nearby = client.post(
        "/api/v1/venue-onboarding/venues",
        headers=_headers(key="create-nearby-dup-01"),
        json=nearby_body,
    )

    assert public.status_code == private.status_code == nearby.status_code == 409
    assert public.json()["error"]["code"] == "POSSIBLE_DUPLICATE_VENUE"
    assert public.json()["error"]["details"]["claim_candidate"]["venue_id"] == str(
        seeded.listed_venue_id
    )
    assert private.json()["error"]["code"] == "POSSIBLE_DUPLICATE_VENUE"
    assert private.json()["error"]["details"] == {}
    assert "内部未公开场馆" not in private.text
    assert nearby.json()["error"]["details"]["claim_candidate"]["venue_id"] == str(
        seeded.listed_venue_id
    )


def test_create_submits_real_fields_without_creating_venue_or_membership(
    pg_engine: Engine, seeded: Seeded, store: FakePrivateOnboardingStore
) -> None:
    with Session(pg_engine) as session:
        evidence = _completed_evidence(
            session, seeded.user_id, list(VenueOnboardingEvidenceKind)
        )
    client = _client(pg_engine, store)
    payload = {
        "name": "  新建 足球场  ",
        "address": " 天津市南开区新建路 2 号 ",
        "district_code": "120104",
        "district_name": "南开区",
        "latitude": 39.10,
        "longitude": 117.16,
        "contact_name": "张三",
        "evidence": evidence,
    }

    first = client.post(
        "/api/v1/venue-onboarding/venues",
        headers=_headers(key="create-submit-00001"),
        json=payload,
    )
    replay = client.post(
        "/api/v1/venue-onboarding/venues",
        headers=_headers(key="create-submit-00001"),
        json=payload,
    )

    assert (first.status_code, replay.status_code) == (201, 200)
    assert first.json() == replay.json()
    assert first.json()["kind"] == "CREATE"
    assert first.json()["venue"] == {
        "venue_id": None,
        "name": "新建 足球场",
        "address": "天津市南开区新建路 2 号",
    }
    with Session(pg_engine) as session:
        application = session.get_one(
            VenueOnboardingApplication, uuid.UUID(first.json()["application_id"])
        )
        assert application.target_venue_id is None
        assert application.proposed_district_code == "120104"
        assert application.proposed_district_name == "南开区"
        assert application.proposed_latitude == 39.10
        assert application.proposed_longitude == 117.16
        assert session.scalar(select(func.count()).select_from(Venue)) == 3
        assert session.scalar(select(func.count()).select_from(VenueMembership)) == 0


def test_concurrent_create_maps_partial_unique_conflict_and_rolls_back_loser(
    pg_engine: Engine,
    seeded: Seeded,
    store: FakePrivateOnboardingStore,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with Session(pg_engine) as session:
        evidence_sets = [
            _completed_evidence(
                session, seeded.user_id, list(VenueOnboardingEvidenceKind)
            )
            for _ in range(2)
        ]

    both_checked_for_duplicates = Barrier(2)
    original_find = VenueOnboardingRepository.find_submitted_create

    def synchronized_find(
        repository: VenueOnboardingRepository,
        *,
        applicant_user_id: uuid.UUID,
        normalized_name: str,
        normalized_address: str,
    ) -> VenueOnboardingApplication | None:
        application = original_find(
            repository,
            applicant_user_id=applicant_user_id,
            normalized_name=normalized_name,
            normalized_address=normalized_address,
        )
        both_checked_for_duplicates.wait(timeout=10)
        return application

    monkeypatch.setattr(
        VenueOnboardingRepository, "find_submitted_create", synchronized_find
    )

    def submit(index: int) -> tuple[int, str | None]:
        with Session(pg_engine) as session:
            service = VenueOnboardingService(
                repository=VenueOnboardingRepository(session),
                storage=store,
                phone_vault=PhoneVault(
                    key_base64=KEY_BASE64,
                    key_version=KEY_VERSION,
                ),
            )
            user = session.get_one(User, seeded.user_id)
            request = SubmitVenueCreate.model_validate(
                {
                    "name": "并发新建足球场",
                    "address": "天津市河东区并发路 88 号",
                    "district_code": "120102",
                    "district_name": "河东区",
                    "latitude": 30.0,
                    "longitude": 110.0,
                    "contact_name": "张三",
                    "evidence": evidence_sets[index],
                }
            )
            try:
                result = service.submit_create(
                    user=user,
                    idempotency_key=f"concurrent-create-{index}",
                    request=request,
                )
            except AppError as error:
                return error.status_code, error.code
            return result.status_code, None

    with ThreadPoolExecutor(max_workers=2) as executor:
        outcomes = sorted(executor.map(submit, range(2)))

    assert outcomes == [(201, None), (409, "ONBOARDING_APPLICATION_EXISTS")]

    all_evidence_ids = {
        uuid.UUID(evidence_id)
        for evidence_set in evidence_sets
        for evidence_id in evidence_set.values()
    }
    with Session(pg_engine) as session:
        applications = list(
            session.scalars(
                select(VenueOnboardingApplication).where(
                    VenueOnboardingApplication.applicant_user_id == seeded.user_id,
                    VenueOnboardingApplication.kind == VenueOnboardingKind.CREATE,
                    VenueOnboardingApplication.status
                    == VenueOnboardingStatus.SUBMITTED,
                    VenueOnboardingApplication.normalized_proposed_name
                    == "并发新建足球场",
                )
            )
        )
        records = list(
            session.scalars(
                select(IdempotencyRecord).where(
                    IdempotencyRecord.user_id == seeded.user_id,
                    IdempotencyRecord.operation
                    == "venue_onboarding_submit_create",
                    IdempotencyRecord.key.in_(
                        ["concurrent-create-0", "concurrent-create-1"]
                    ),
                )
            )
        )
        evidence = list(
            session.scalars(
                select(VenueOnboardingEvidence).where(
                    VenueOnboardingEvidence.id.in_(all_evidence_ids)
                )
            )
        )

    assert len(applications) == 1
    assert len(records) == 1
    assert records[0].state == IdempotencyState.COMPLETED
    attached_ids = {item.id for item in evidence if item.application_id is not None}
    unattached_ids = {item.id for item in evidence if item.application_id is None}
    expected_sets = [
        {uuid.UUID(evidence_id) for evidence_id in evidence_set.values()}
        for evidence_set in evidence_sets
    ]
    assert attached_ids in expected_sets
    assert unattached_ids in expected_sets
    assert attached_ids != unattached_ids


def test_application_list_is_newest_first_cursor_page_and_owner_isolated(
    pg_engine: Engine, seeded: Seeded, store: FakePrivateOnboardingStore
) -> None:
    client = _client(pg_engine, store)
    with Session(pg_engine) as session:
        own_evidence = _completed_evidence(
            session,
            seeded.user_id,
            [
                VenueOnboardingEvidenceKind.MANAGEMENT_AUTHORIZATION,
                VenueOnboardingEvidenceKind.VENUE_EXTERIOR,
            ],
        )
    claim = client.post(
        "/api/v1/venue-onboarding/claims",
        headers=_headers(key="listing-claim-00001"),
        json={
            "venue_id": str(seeded.listed_venue_id),
            "contact_name": "张三",
            "evidence": own_evidence,
        },
    )
    assert claim.status_code == 201
    with Session(pg_engine) as session:
        create_evidence = _completed_evidence(
            session,
            seeded.user_id,
            list(VenueOnboardingEvidenceKind),
        )
    created = client.post(
        "/api/v1/venue-onboarding/venues",
        headers=_headers(key="listing-create-0001"),
        json={
            "name": "分页新场馆",
            "address": "天津市河西区分页路 10 号",
            "district_code": "120103",
            "district_name": "河西区",
            "latitude": 38.5,
            "longitude": 116.5,
            "contact_name": "张三",
            "evidence": create_evidence,
        },
    )
    assert created.status_code == 201
    with Session(pg_engine) as session:
        other_evidence = _completed_evidence(
            session,
            seeded.other_user_id,
            [
                VenueOnboardingEvidenceKind.MANAGEMENT_AUTHORIZATION,
                VenueOnboardingEvidenceKind.VENUE_EXTERIOR,
            ],
        )
    other_claim = client.post(
        "/api/v1/venue-onboarding/claims",
        headers=_headers(token=OTHER_TOKEN, key="listing-other-00001"),
        json={
            "venue_id": str(seeded.listed_venue_id),
            "contact_name": "李四",
            "evidence": other_evidence,
        },
    )
    assert other_claim.status_code == 201

    page = client.get(
        "/api/v1/venue-onboarding/applications",
        headers=_headers(),
        params={"limit": 1},
    )

    assert page.status_code == 200
    assert [item["application_id"] for item in page.json()["items"]] == [
        created.json()["application_id"]
    ]
    assert page.json()["next_cursor"] is not None
    assert other_claim.json()["application_id"] not in page.text
    second_page = client.get(
        "/api/v1/venue-onboarding/applications",
        headers=_headers(),
        params={"limit": 1, "cursor": page.json()["next_cursor"]},
    )
    assert second_page.status_code == 200
    assert [item["application_id"] for item in second_page.json()["items"]] == [
        claim.json()["application_id"]
    ]
    assert other_claim.json()["application_id"] not in second_page.text
