import uuid
from collections.abc import Mapping
from datetime import UTC, datetime

import pytest

from backend.app.modules.payments.provider import AuthoritativePaymentFacts, QueryPaymentResult
from backend.app.modules.payments.reconciliation import PaymentNotificationService


class RejectingAdapter:
    def verify_and_decrypt(
        self, *, raw_body: bytes, headers: Mapping[str, str], now: datetime
    ) -> AuthoritativePaymentFacts:
        raise ValueError("invalid notification")


class RecordingConvergence:
    called = False

    def converge(
        self, *, payment_id: uuid.UUID, provider: str, result: QueryPaymentResult
    ) -> object:
        self.called = True
        raise AssertionError("unverified facts reached convergence")


def test_unverified_notification_cannot_reach_convergence(caplog: pytest.LogCaptureFixture) -> None:
    convergence = RecordingConvergence()
    service = PaymentNotificationService(
        adapter=RejectingAdapter(),
        convergence=convergence,
        locate_payment=lambda _provider, _merchant: None,
        provider="wechat",
    )
    with pytest.raises(ValueError, match="invalid notification"):
        service.handle(
            raw_body=b'{"transaction_id":"secret"}',
            headers={"Wechatpay-Signature": "raw-signature"},
            now=datetime.now(UTC),
        )
    assert not convergence.called
    assert "raw-signature" not in caplog.text
    assert "transaction_id" not in caplog.text


class VerifiedAdapter:
    def __init__(self, facts: AuthoritativePaymentFacts) -> None:
        self.facts = facts

    def verify_and_decrypt(
        self, *, raw_body: bytes, headers: Mapping[str, str], now: datetime
    ) -> AuthoritativePaymentFacts:
        return self.facts


class CapturingConvergence:
    def __init__(self) -> None:
        self.kwargs: dict[str, object] | None = None

    def converge(
        self, *, payment_id: uuid.UUID, provider: str, result: QueryPaymentResult
    ) -> object:
        self.kwargs = {"payment_id": payment_id, "provider": provider, "result": result}
        return "converged"


def test_only_verified_sanitized_facts_enter_convergence() -> None:
    payment_id = uuid.uuid4()
    facts = AuthoritativePaymentFacts(
        app_id="app",
        merchant_id="merchant",
        merchant_order_no="merchant-order",
        provider_transaction_no="transaction",
        amount_cents=32000,
        currency="CNY",
        paid_at=datetime.now(UTC),
    )
    convergence = CapturingConvergence()
    service = PaymentNotificationService(
        adapter=VerifiedAdapter(facts),
        convergence=convergence,
        locate_payment=lambda provider, merchant: (
            payment_id if (provider, merchant) == ("wechat", "merchant-order") else None
        ),
        provider="wechat",
    )

    assert (
        service.handle(
            raw_body=b"encrypted",
            headers={"Wechatpay-Signature": "raw"},
            now=datetime.now(UTC),
        )
        == "converged"
    )
    assert convergence.kwargs is not None
    assert convergence.kwargs["payment_id"] == payment_id
    assert convergence.kwargs["provider"] == "wechat"
    result = convergence.kwargs["result"]
    assert isinstance(result, QueryPaymentResult)
    assert result.facts is facts
