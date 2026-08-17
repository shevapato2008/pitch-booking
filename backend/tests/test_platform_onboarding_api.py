from __future__ import annotations

import base64
import hashlib
import hmac
import json
import uuid
from collections.abc import Iterator
from datetime import UTC, datetime
from urllib.parse import parse_qs, urlencode, urlsplit, urlunsplit

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine
from sqlalchemy.orm import Session

from backend.app.config import Settings
from backend.app.database import get_database
from backend.app.main import create_app
from backend.app.models import (
    User,
    VenueOnboardingApplication,
    VenueOnboardingEvidence,
    VenueOnboardingEvidenceKind,
    VenueOnboardingEvidenceState,
    VenueOnboardingKind,
    VenueOnboardingStatus,
)
from backend.app.security.phone_vault import PhoneVault

pytestmark = pytest.mark.integration

RAW_TOKEN = "platform-onboarding-reviewer-token-000000001"
ORIGIN = "https://api.example.test"
KEY_BASE64 = base64.b64encode(bytes(range(32))).decode("ascii")
CSRF_SECRET = base64.b64encode(bytes(reversed(range(32)))).decode("ascii")


class ApiDownloadStore:
    def __init__(self) -> None:
        self.opened_keys: list[tuple[str, int]] = []

    def create_upload_policy(self, *_args: object) -> object:
        raise AssertionError("platform review must not create upload policies")

    def read_private_object(self, *_args: object) -> object:
        raise AssertionError("platform review must not stream public evidence")

    def create_download_url(
        self, object_key: str, expires_seconds: int, attachment_filename: str
    ) -> object:
        del object_key, expires_seconds, attachment_filename
        raise AssertionError("platform API must not expose a direct object-store URL")

    def open_private_object(
        self, object_key: str, expected_bytes: int
    ) -> Iterator[bytes]:
        assert object_key.startswith("venue-onboarding/")
        self.opened_keys.append((object_key, expected_bytes))
        yield b"%PDF" + b"x" * (expected_bytes - 4)


def _principals(role: str) -> str:
    return json.dumps(
        [
            {
                "principal_id": "ops-1",
                "display_name": "平台审核员",
                "token_sha256": hashlib.sha256(RAW_TOKEN.encode()).hexdigest(),
                "enabled": True,
                "roles": [role],
            }
        ],
        ensure_ascii=False,
    )


def _client(engine: Engine, *, role: str = "ONBOARDING_REVIEWER") -> TestClient:
    app = create_app(
        settings=Settings(
            app_env="test",
            wechat_provider="development",
            public_api_base_url=ORIGIN,
            platform_staff_principals_json=_principals(role),
            platform_csrf_secret=CSRF_SECRET,
            phone_encryption_key_base64=KEY_BASE64,
            phone_encryption_key_version=3,
        ),
        venue_onboarding_store=ApiDownloadStore(),
    )

    def database_override() -> Iterator[Session]:
        with Session(engine) as session:
            yield session

    app.dependency_overrides[get_database] = database_override
    return TestClient(app, base_url=ORIGIN, raise_server_exceptions=False)


def _login(client: TestClient) -> str:
    response = client.post(
        "/platform-admin/api/v1/auth/session",
        json={"access_token": RAW_TOKEN},
        headers={"Origin": ORIGIN},
    )
    assert response.status_code == 200
    return str(response.json()["csrf_token"])


def _download_signature(
    *, evidence_id: uuid.UUID, principal_id: str, expires_at: int
) -> str:
    key = base64.b64decode(CSRF_SECRET, validate=True)
    payload = (
        f"platform-onboarding-evidence-download:v1:{evidence_id}:"
        f"{principal_id}:{expires_at}"
    )
    return hmac.new(key, payload.encode("utf-8"), hashlib.sha256).hexdigest()


def _seed_application(engine: Engine) -> tuple[uuid.UUID, uuid.UUID, str]:
    with Session(engine) as session:
        user = User(
            wechat_app_id="wx-platform-api",
            wechat_openid=f"openid-{uuid.uuid4()}",
        )
        session.add(user)
        session.flush()
        application_id = uuid.uuid4()
        sealed = PhoneVault(key_base64=KEY_BASE64, key_version=3).encrypt(
            "13900139000",
            record_type="venue_onboarding_application",
            record_id=application_id,
            field="contact_phone",
        )
        application = VenueOnboardingApplication(
            id=application_id,
            applicant_user_id=user.id,
            kind=VenueOnboardingKind.CREATE,
            target_venue_id=None,
            proposed_name="API 新场馆",
            proposed_address="天津市和平区 API 路 1 号",
            proposed_district_code="120101",
            proposed_district_name="和平区",
            proposed_latitude=39.50,
            proposed_longitude=117.50,
            normalized_proposed_name="api 新场馆",
            normalized_proposed_address="天津市和平区 api 路 1 号",
            contact_phone_ciphertext=sealed.ciphertext_with_tag,
            contact_phone_nonce=sealed.nonce,
            contact_phone_key_version=sealed.key_version,
            contact_name="API 申请人",
            status=VenueOnboardingStatus.SUBMITTED,
            submitted_at=datetime.now(UTC),
        )
        session.add(application)
        session.flush()
        object_key = f"venue-onboarding/{user.id}/{uuid.uuid4()}/license.pdf"
        evidence = VenueOnboardingEvidence(
            owner_user_id=user.id,
            application_id=application.id,
            kind=VenueOnboardingEvidenceKind.BUSINESS_LICENSE,
            state=VenueOnboardingEvidenceState.COMPLETED,
            object_key=object_key,
            content_type="application/pdf",
            byte_size=300,
            content_sha256="d" * 64,
        )
        session.add(evidence)
        session.commit()
        return application.id, evidence.id, object_key


def test_platform_onboarding_routes_require_platform_session_and_role(
    pg_engine: Engine,
) -> None:
    application_id, evidence_id, _object_key = _seed_application(pg_engine)
    anonymous = _client(pg_engine)
    paths = [
        anonymous.get("/platform-admin/api/v1/onboarding/applications"),
        anonymous.get(f"/platform-admin/api/v1/onboarding/applications/{application_id}"),
        anonymous.get(f"/platform-admin/api/v1/onboarding/evidence/{evidence_id}/download"),
        anonymous.post(
            f"/platform-admin/api/v1/onboarding/applications/{application_id}/decisions",
            json={"outcome": "REJECTED", "reason": "材料不足"},
        ),
    ]
    assert [response.status_code for response in paths] == [401, 401, 401, 401]


@pytest.mark.parametrize("role", ["PLATFORM_ADMIN", "ONBOARDING_REVIEWER"])
def test_review_queue_detail_download_and_decision_end_to_end(
    pg_engine: Engine,
    role: str,
) -> None:
    application_id, evidence_id, object_key = _seed_application(pg_engine)
    client = _client(pg_engine, role=role)
    csrf = _login(client)

    queue = client.get(
        "/platform-admin/api/v1/onboarding/applications",
        params={"kind": "CREATE", "status": "SUBMITTED", "limit": 1},
    )
    assert queue.status_code == 200
    assert queue.json()["items"][0]["application_id"] == str(application_id)

    detail = client.get(
        f"/platform-admin/api/v1/onboarding/applications/{application_id}"
    )
    assert detail.status_code == 200
    assert detail.json()["applicant"]["masked_phone"] == "139****9000"
    assert "object_key" not in detail.text
    assert "content_sha256" not in detail.text

    download = client.get(
        f"/platform-admin/api/v1/onboarding/evidence/{evidence_id}/download"
    )
    assert download.status_code == 200
    assert set(download.json()) == {"download_url", "expires_at"}
    download_url = download.json()["download_url"]
    assert object_key not in download_url
    assert "venue-onboarding" not in download_url

    content = client.get(download_url)
    assert content.status_code == 200
    assert content.content == b"%PDF" + b"x" * 296
    assert content.headers["content-type"] == "application/pdf"
    assert content.headers["content-disposition"] == (
        'attachment; filename="business-license.pdf"'
    )
    assert content.headers["cache-control"] == "no-store"

    parsed = urlsplit(download_url)
    query = parse_qs(parsed.query)
    signature = query["signature"][0]
    query["signature"] = [f"{signature[:-1]}{'0' if signature[-1] != '0' else '1'}"]
    tampered_url = urlunsplit(
        (parsed.scheme, parsed.netloc, parsed.path, urlencode(query, doseq=True), "")
    )
    tampered = client.get(tampered_url)
    assert tampered.status_code == 403
    assert tampered.json()["error"]["code"] == "PLATFORM_CSRF_INVALID"

    different_evidence = client.get(
        parsed.path.replace(str(evidence_id), str(uuid.uuid4())),
        params={
            "expires": query["expires"][0],
            "signature": signature,
        },
    )
    assert different_evidence.status_code == 403
    assert different_evidence.json()["error"]["code"] == "PLATFORM_CSRF_INVALID"

    expired_at = int(datetime.now(UTC).timestamp()) - 1
    expired_signature = _download_signature(
        evidence_id=evidence_id,
        principal_id="ops-1",
        expires_at=expired_at,
    )
    expired = client.get(
        f"{ORIGIN}{parsed.path}",
        params={"expires": expired_at, "signature": expired_signature},
    )
    assert expired.status_code == 403
    assert expired.json()["error"]["code"] == "PLATFORM_CSRF_INVALID"

    anonymous_content = _client(pg_engine).get(download_url)
    assert anonymous_content.status_code == 401

    missing_csrf = client.post(
        f"/platform-admin/api/v1/onboarding/applications/{application_id}/decisions",
        json={"outcome": "REJECTED", "reason": "材料不足"},
    )
    assert missing_csrf.status_code == 403
    assert missing_csrf.json()["error"]["code"] == "PLATFORM_CSRF_INVALID"

    for outcome in ("APPROVED", "REJECTED"):
        blank = client.post(
            f"/platform-admin/api/v1/onboarding/applications/{application_id}/decisions",
            json={"outcome": outcome, "reason": "   "},
            headers={"Origin": ORIGIN, "X-CSRF-Token": csrf},
        )
        assert blank.status_code == 422
        assert blank.json()["error"]["code"] == "INVALID_ARGUMENT"

    decided = client.post(
        f"/platform-admin/api/v1/onboarding/applications/{application_id}/decisions",
        json={"outcome": "REJECTED", "reason": "  材料不足  "},
        headers={"Origin": ORIGIN, "X-CSRF-Token": csrf},
    )
    assert decided.status_code == 200
    assert decided.json()["reason"] == "材料不足"

    replay = client.post(
        f"/platform-admin/api/v1/onboarding/applications/{application_id}/decisions",
        json={"outcome": "REJECTED", "reason": "材料不足"},
        headers={"Origin": ORIGIN, "X-CSRF-Token": csrf},
    )
    assert replay.status_code == 200
    assert replay.json() == decided.json()

    changed = client.post(
        f"/platform-admin/api/v1/onboarding/applications/{application_id}/decisions",
        json={"outcome": "APPROVED", "reason": "材料不足"},
        headers={"Origin": ORIGIN, "X-CSRF-Token": csrf},
    )
    assert changed.status_code == 409
    assert changed.json()["error"]["code"] == "ONBOARDING_APPLICATION_STATE_CHANGED"


def test_invalid_queue_parameters_are_closed_422(pg_engine: Engine) -> None:
    client = _client(pg_engine)
    _login(client)
    for params in (
        {"limit": 0},
        {"limit": 51},
        {"kind": "UNKNOWN"},
        {"status": "UNKNOWN"},
        {"cursor": "broken"},
    ):
        response = client.get(
            "/platform-admin/api/v1/onboarding/applications", params=params
        )
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "INVALID_ARGUMENT"


def test_missing_application_and_cross_application_evidence_are_not_found(
    pg_engine: Engine,
) -> None:
    _application_id, evidence_id, _object_key = _seed_application(pg_engine)
    client = _client(pg_engine)
    _login(client)

    missing = client.get(
        f"/platform-admin/api/v1/onboarding/applications/{uuid.uuid4()}"
    )
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "ONBOARDING_APPLICATION_NOT_FOUND"

    with Session(pg_engine) as session:
        evidence = session.get_one(VenueOnboardingEvidence, evidence_id)
        evidence.application_id = None
        session.commit()
    detached = client.get(
        f"/platform-admin/api/v1/onboarding/evidence/{evidence_id}/download"
    )
    assert detached.status_code == 404
    assert detached.json()["error"]["code"] == "ONBOARDING_APPLICATION_NOT_FOUND"
