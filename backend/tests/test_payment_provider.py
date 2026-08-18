from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from threading import Barrier

import pytest
from pydantic import ValidationError

from backend.app.config import Settings
from backend.app.errors import AppError
from backend.app.main import create_app
from backend.app.modules.payments import build_payment_provider
from backend.app.modules.payments.mock_provider import MockCreateMode, MockPaymentProvider
from backend.app.modules.payments.provider import (
    AuthoritativePaymentFacts,
    ClosePaymentRequest,
    ClosePaymentResult,
    ClosePaymentStatus,
    Created,
    CreatePrepayRequest,
    PaymentLaunchParams,
    QueryPaymentRequest,
    QueryPaymentResult,
    QueryPaymentStatus,
    Rejected,
    Unknown,
)
from backend.app.modules.payments.router import get_payment_provider


def request(merchant_order_no: str = "merchant-1") -> CreatePrepayRequest:
    return CreatePrepayRequest(
        merchant_order_no=merchant_order_no,
        description="预订场地",
        amount_cents=32000,
        currency="CNY",
        payer_openid="openid-secret",
        time_expire=datetime(2026, 8, 18, 9, tzinfo=UTC),
    )


def test_provider_dtos_are_frozen_and_do_not_repr_openid() -> None:
    value = request()

    assert "openid-secret" not in repr(value)
    with pytest.raises((AttributeError, TypeError)):
        value.amount_cents = 1  # type: ignore[misc]


def test_create_prepay_requires_aware_expiry_and_valid_merchant_number() -> None:
    with pytest.raises(TypeError, match="time_expire"):
        CreatePrepayRequest("order", "booking", 32000, "CNY", "openid")
    with pytest.raises(ValueError, match="time_expire"):
        CreatePrepayRequest(
            "order", "booking", 32000, "CNY", "openid", datetime(2026, 8, 18, 9)
        )

    for merchant_order_no in ("", " ", "x" * 33):
        with pytest.raises(ValueError, match="merchant_order_no"):
            CreatePrepayRequest(
                merchant_order_no,
                "booking",
                32000,
                "CNY",
                "openid",
                datetime(2026, 8, 18, 9, tzinfo=UTC),
            )


def test_query_and_close_accept_legacy_merchant_number_up_to_database_limit() -> None:
    legacy_merchant_order_no = f"PB-PAY-{'a' * 32}"

    assert len(legacy_merchant_order_no) == 39
    assert QueryPaymentRequest(legacy_merchant_order_no).merchant_order_no == (
        legacy_merchant_order_no
    )
    assert ClosePaymentRequest(legacy_merchant_order_no).merchant_order_no == (
        legacy_merchant_order_no
    )

    for merchant_order_no in ("", " ", "x" * 129):
        with pytest.raises(ValueError, match="merchant_order_no"):
            QueryPaymentRequest(merchant_order_no)
        with pytest.raises(ValueError, match="merchant_order_no"):
            ClosePaymentRequest(merchant_order_no)


def test_launch_params_use_the_exact_cashier_keys() -> None:
    params = PaymentLaunchParams(
        timeStamp="1785146640",
        nonceStr="nonce",
        package="prepay_id=prepay-1",
        signType="RSA",
        paySign="signature",
    )

    assert params.as_dict() == {
        "timeStamp": "1785146640",
        "nonceStr": "nonce",
        "package": "prepay_id=prepay-1",
        "signType": "RSA",
        "paySign": "signature",
    }


def test_mock_create_is_thread_safe_and_merchant_number_idempotent() -> None:
    provider = MockPaymentProvider()

    first = provider.create_prepay(request())
    second = provider.create_prepay(request())

    assert isinstance(first, Created)
    assert second == first
    assert provider.provider_order_count == 1
    assert [call.method for call in provider.calls] == ["create_prepay", "create_prepay"]
    assert "openid-secret" not in repr(provider.calls)
    assert "openid-secret" not in repr(provider.__dict__)


def test_mock_rejects_same_merchant_number_with_different_core_request() -> None:
    provider = MockPaymentProvider()
    assert isinstance(provider.create_prepay(request()), Created)

    mismatch = provider.create_prepay(
        CreatePrepayRequest(
            merchant_order_no="merchant-1",
            description="另一笔预订",
            amount_cents=32001,
            currency="CNY",
            payer_openid="different-openid",
            time_expire=datetime(2026, 8, 18, 9, tzinfo=UTC),
        )
    )

    assert mismatch == Rejected("MOCK_IDEMPOTENCY_MISMATCH")
    assert provider.provider_order_count == 1


def test_mock_is_idempotent_under_true_concurrency() -> None:
    provider = MockPaymentProvider()
    barrier = Barrier(8)

    def create() -> object:
        barrier.wait()
        return provider.create_prepay(request())

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda _index: create(), range(8)))

    assert all(result == results[0] for result in results)
    assert isinstance(results[0], Created)
    assert provider.provider_order_count == 1


def test_mock_supports_unknown_before_and_after_acceptance() -> None:
    before = MockPaymentProvider(create_mode=MockCreateMode.UNKNOWN_BEFORE_ACCEPTANCE)
    after = MockPaymentProvider(create_mode=MockCreateMode.UNKNOWN_AFTER_ACCEPTANCE)

    assert isinstance(before.create_prepay(request("before")), Unknown)
    assert (
        before.query_payment(QueryPaymentRequest("before")).status is QueryPaymentStatus.NOT_FOUND
    )
    assert isinstance(after.create_prepay(request("after")), Unknown)
    assert after.query_payment(QueryPaymentRequest("after")).status is QueryPaymentStatus.NOT_PAID


def test_mock_can_advance_query_and_close_states() -> None:
    provider = MockPaymentProvider()
    provider.create_prepay(request())
    paid_at = datetime.now(UTC)
    provider.mark_success("merchant-1", provider_transaction_no="tx-1", paid_at=paid_at)

    query = provider.query_payment(QueryPaymentRequest("merchant-1"))
    close = provider.close_payment(ClosePaymentRequest("merchant-1"))

    assert query.status is QueryPaymentStatus.SUCCESS
    assert query.facts is not None
    assert query.facts.app_id == "mock-app-id"
    assert query.facts.merchant_id == "mock-merchant-id"
    assert query.facts.amount_cents == 32000
    assert close.status is ClosePaymentStatus.SUCCESS


def test_provider_result_dtos_reject_impossible_state_combinations() -> None:
    facts = AuthoritativePaymentFacts(
        app_id="app",
        merchant_id="merchant",
        merchant_order_no="order",
        provider_transaction_no="tx",
        amount_cents=32000,
        currency="CNY",
        paid_at=datetime.now(UTC),
    )
    launch = PaymentLaunchParams("1", "nonce", "prepay_id=p", "RSA", "sign")

    with pytest.raises(ValueError, match="SUCCESS requires facts"):
        QueryPaymentResult(QueryPaymentStatus.SUCCESS)
    with pytest.raises(ValueError, match="non-SUCCESS must not include facts"):
        QueryPaymentResult(QueryPaymentStatus.NOT_PAID, facts=facts)
    with pytest.raises(ValueError, match="only NOT_PAID"):
        QueryPaymentResult(QueryPaymentStatus.NOT_FOUND, provider_prepay_id="p")
    with pytest.raises(ValueError, match="provider_prepay_id"):
        QueryPaymentResult(QueryPaymentStatus.NOT_PAID, launch_params=launch)
    with pytest.raises(ValueError, match="UNKNOWN requires safe_error_code"):
        QueryPaymentResult(QueryPaymentStatus.UNKNOWN)
    with pytest.raises(ValueError, match="SUCCESS requires facts"):
        ClosePaymentResult(ClosePaymentStatus.SUCCESS)
    with pytest.raises(ValueError, match="non-SUCCESS must not include facts"):
        ClosePaymentResult(ClosePaymentStatus.CLOSED, facts=facts)
    with pytest.raises(ValueError, match="UNKNOWN requires safe_error_code"):
        ClosePaymentResult(ClosePaymentStatus.UNKNOWN)


@pytest.mark.parametrize("app_env", ["test", "staging", "production"])
def test_mock_payment_configuration_is_rejected_outside_development(app_env: str) -> None:
    values: dict[str, object] = {
        "app_env": app_env,
        "payment_provider": "mock",
        "enable_mock_payment_provider": True,
    }
    if app_env in {"staging", "production"}:
        values.update(
            database_url="postgresql+psycopg://pitch:password@postgres:5432/pitch",
            public_api_base_url="https://api.example.test",
            public_image_hosts=("cdn.example.test",),
            oss_endpoint="https://oss-cn-beijing.aliyuncs.com",
            oss_bucket="pitch-media",
            oss_public_base_url="https://cdn.example.test/media",
            oss_access_key_id="access-key-id",
            oss_access_key_secret="access-key-secret",
            dashscope_api_key="dashscope-key",
            wechat_provider="real",
            wechat_app_id="wx-app",
            wechat_app_secret="secret",
            phone_encryption_key_base64="AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=",
            phone_encryption_key_version=1,
        )

    with pytest.raises(ValidationError, match="Mock payment provider"):
        Settings(**values)


def test_mock_payment_configuration_requires_all_three_development_switches() -> None:
    with pytest.raises(ValidationError, match="ENABLE_MOCK_PAYMENT_PROVIDER"):
        Settings(app_env="development", payment_provider="mock")
    with pytest.raises(ValidationError, match="Mock payment provider"):
        Settings(
            app_env="development", payment_provider="wechat", enable_mock_payment_provider=True
        )

    settings = Settings(
        app_env="development",
        payment_provider="mock",
        enable_mock_payment_provider=True,
    )
    assert settings.mock_payment_provider_enabled is True


def test_runtime_provider_factory_never_falls_back_to_mock() -> None:
    enabled = Settings(
        app_env="development",
        payment_provider="mock",
        enable_mock_payment_provider=True,
    )
    assert isinstance(build_payment_provider(enabled), MockPaymentProvider)

    with pytest.raises(RuntimeError, match="WeChat payment credentials are incomplete"):
        build_payment_provider(Settings(app_env="development", payment_provider="wechat"))


def test_disabled_payment_provider_starts_without_merchant_credentials() -> None:
    settings = Settings(
        app_env="staging",
        payment_provider="disabled",
        database_url="postgresql+psycopg://pitch:password@postgres:5432/pitch",
        public_api_base_url="https://api.example.test",
        public_image_hosts=("cdn.example.test",),
        oss_endpoint="https://oss-cn-beijing.aliyuncs.com",
        oss_bucket="pitch-media",
        oss_public_base_url="https://cdn.example.test/media",
        oss_access_key_id="access-key-id",
        oss_access_key_secret="access-key-secret",
        dashscope_api_key="dashscope-key",
        wechat_provider="real",
        wechat_app_id="wx-app",
        wechat_app_secret="secret",
        phone_encryption_key_base64=(
            "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8="
        ),
        phone_encryption_key_version=1,
        wechat_pay_merchant_id="",
        wechat_pay_merchant_cert_serial="",
        wechat_pay_merchant_private_key_pem_base64="",
        wechat_pay_public_key_id="",
        wechat_pay_public_key_pem_base64="",
        wechat_pay_api_v3_key="",
        wechat_pay_payment_notification_url="",
        wechat_pay_refund_notification_url="",
    )

    assert settings.payment_provider == "disabled"
    assert settings.wechat_payment_configured is False
    app = create_app(settings=Settings(app_env="test", payment_provider="disabled"))
    assert app.state.payment_provider is None


def test_missing_runtime_provider_returns_frozen_unavailable_error() -> None:
    state = type("StateStub", (), {"payment_provider": None})()
    app = type("AppStub", (), {"state": state})()
    request = type("RequestStub", (), {"app": app})()

    with pytest.raises(AppError) as caught:
        get_payment_provider(request)  # type: ignore[arg-type]

    assert caught.value.status_code == 503
    assert caught.value.code == "PAYMENT_PROVIDER_UNAVAILABLE"
