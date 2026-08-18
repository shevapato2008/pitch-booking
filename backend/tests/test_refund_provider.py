from dataclasses import replace
from datetime import UTC, datetime

import pytest

from backend.app.modules.refunds.provider import (
    AuthoritativeRefundFacts,
    CreateRefundRequest,
    ExpectedRefundFacts,
    QueryRefundRequest,
    QueryRefundResult,
    QueryRefundStatus,
    RefundAccepted,
    RefundFactsMismatchCode,
    RefundProvider,
    authoritative_refund_facts_mismatch,
)


def _facts() -> AuthoritativeRefundFacts:
    return AuthoritativeRefundFacts(
        provider="wechat",
        merchant_id="merchant-1",
        merchant_refund_no="PBR123",
        provider_refund_no="5000001",
        merchant_order_no="PBP123",
        provider_transaction_no="4200001",
        amount_cents=32000,
        currency="CNY",
        refunded_at=datetime(2026, 8, 18, 8, tzinfo=UTC),
    )


def _expected() -> ExpectedRefundFacts:
    facts = _facts()
    return ExpectedRefundFacts(
        provider=facts.provider,
        merchant_id=facts.merchant_id,
        merchant_refund_no=facts.merchant_refund_no,
        merchant_order_no=facts.merchant_order_no,
        provider_transaction_no=facts.provider_transaction_no,
        amount_cents=facts.amount_cents,
        currency=facts.currency,
    )


@pytest.mark.parametrize("merchant_refund_no", ["", " ", "x" * 33])
def test_refund_requests_reject_invalid_merchant_refund_numbers(
    merchant_refund_no: str,
) -> None:
    with pytest.raises(ValueError, match="merchant_refund_no"):
        CreateRefundRequest(
            merchant_refund_no=merchant_refund_no,
            merchant_order_no="PBP123",
            provider_transaction_no="4200001",
            amount_cents=32000,
            currency="CNY",
        )
    with pytest.raises(ValueError, match="merchant_refund_no"):
        QueryRefundRequest(merchant_refund_no)


def test_refund_request_rejects_invalid_payment_identity_and_amount() -> None:
    valid = {
        "merchant_refund_no": "PBR123",
        "merchant_order_no": "PBP123",
        "provider_transaction_no": "4200001",
        "amount_cents": 32000,
        "currency": "CNY",
    }

    for field, value in (
        ("merchant_order_no", " "),
        ("merchant_order_no", "x" * 33),
        ("provider_transaction_no", " "),
        ("amount_cents", -1),
        ("currency", "USD"),
    ):
        with pytest.raises(ValueError, match=field):
            CreateRefundRequest(**(valid | {field: value}))  # type: ignore[arg-type]


@pytest.mark.parametrize("amount_cents", [True, 1.5])
def test_refund_amount_requires_an_actual_integer(amount_cents: object) -> None:
    with pytest.raises(ValueError, match="amount_cents"):
        CreateRefundRequest(
            merchant_refund_no="PBR123",
            merchant_order_no="PBP123",
            provider_transaction_no="4200001",
            amount_cents=amount_cents,  # type: ignore[arg-type]
            currency="CNY",
        )
    with pytest.raises(ValueError, match="amount_cents"):
        replace(_facts(), amount_cents=amount_cents)


def test_authoritative_refund_facts_are_complete_and_validated() -> None:
    facts = _facts()

    assert facts.provider == "wechat"
    assert facts.merchant_id == "merchant-1"
    assert facts.merchant_refund_no == "PBR123"
    assert facts.provider_refund_no == "5000001"
    assert facts.merchant_order_no == "PBP123"
    assert facts.provider_transaction_no == "4200001"
    assert facts.amount_cents == 32000
    assert facts.currency == "CNY"
    assert facts.refunded_at == datetime(2026, 8, 18, 8, tzinfo=UTC)

    for field, value in (
        ("provider", " "),
        ("merchant_id", " "),
        ("merchant_refund_no", "x" * 33),
        ("provider_refund_no", " "),
        ("merchant_order_no", "x" * 33),
        ("provider_transaction_no", " "),
        ("amount_cents", -1),
        ("currency", "USD"),
        ("refunded_at", datetime(2026, 8, 18, 8)),
    ):
        with pytest.raises(ValueError, match=field):
            replace(facts, **{field: value})


def test_only_success_query_result_can_contain_authoritative_facts() -> None:
    facts = _facts()

    assert QueryRefundResult(QueryRefundStatus.SUCCESS, facts=facts).facts == facts
    with pytest.raises(ValueError, match="SUCCESS requires facts"):
        QueryRefundResult(QueryRefundStatus.SUCCESS)
    with pytest.raises(ValueError, match="non-SUCCESS must not include facts"):
        QueryRefundResult(QueryRefundStatus.PROCESSING, facts=facts)
    with pytest.raises(ValueError, match="UNKNOWN requires safe_error_code"):
        QueryRefundResult(QueryRefundStatus.UNKNOWN)
    with pytest.raises(ValueError, match="FAILED requires safe_error_code"):
        QueryRefundResult(QueryRefundStatus.FAILED)


def test_query_refund_result_requires_closed_status_enum_at_runtime() -> None:
    with pytest.raises(ValueError, match="status"):
        QueryRefundResult("PROCESSING")  # type: ignore[arg-type]


@pytest.mark.parametrize(
    ("field", "value", "code"),
    [
        ("provider", "other", RefundFactsMismatchCode.PROVIDER),
        ("merchant_id", "other", RefundFactsMismatchCode.MERCHANT_ID),
        ("merchant_refund_no", "other", RefundFactsMismatchCode.MERCHANT_REFUND_NO),
        ("merchant_order_no", "other", RefundFactsMismatchCode.MERCHANT_ORDER_NO),
        (
            "provider_transaction_no",
            "other",
            RefundFactsMismatchCode.PROVIDER_TRANSACTION_NO,
        ),
        ("amount_cents", 1, RefundFactsMismatchCode.AMOUNT),
        ("currency", "USD", RefundFactsMismatchCode.CURRENCY),
    ],
)
def test_future_convergence_cannot_accept_mismatched_refund_facts(
    field: str, value: object, code: RefundFactsMismatchCode
) -> None:
    assert authoritative_refund_facts_mismatch(
        facts=_facts(), expected=replace(_expected(), **{field: value})
    ) is code


def test_refund_protocol_is_narrow_and_results_are_frozen() -> None:
    public_methods = {
        name
        for name, value in vars(RefundProvider).items()
        if not name.startswith("_") and callable(value)
    }
    accepted = RefundAccepted(provider_refund_no="5000001")

    assert public_methods == {"create_refund", "query_refund"}
    with pytest.raises((AttributeError, TypeError)):
        accepted.provider_refund_no = "different"  # type: ignore[misc]
