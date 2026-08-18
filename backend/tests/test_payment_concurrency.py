import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from threading import Event, Lock, Thread

import pytest
from sqlalchemy import Engine, func, select
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from backend.app.errors import AppError
from backend.app.models import (
    IdempotencyRecord,
    IdempotencyState,
    Order,
    OrderStatus,
    Payment,
    PaymentState,
    Slot,
)
from backend.app.modules.payments.dto import CreatePaymentResult
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
from backend.app.modules.payments.service import _PhaseOne
from backend.tests.test_payment_creation import seed_order, service

pytestmark = pytest.mark.integration


class LockCheckingProvider(MockPaymentProvider):
    def __init__(self, engine: Engine, order_id: uuid.UUID) -> None:
        super().__init__()
        self.engine = engine
        self.order_id = order_id

    def _assert_no_business_row_locks(self, merchant_order_no: str) -> None:
        try:
            with Session(self.engine) as probe:
                order = probe.get_one(Order, self.order_id)
                payment_id = probe.scalar(
                    select(Payment.id).where(Payment.merchant_order_no == merchant_order_no)
                )
                probe.scalar(
                    select(Slot.id).where(Slot.id == order.slot_id).with_for_update(nowait=True)
                )
                probe.scalar(
                    select(Order.id).where(Order.id == order.id).with_for_update(nowait=True)
                )
                if payment_id is not None:
                    probe.scalar(
                        select(Payment.id)
                        .where(Payment.id == payment_id)
                        .with_for_update(nowait=True)
                    )
                probe.rollback()
        except OperationalError as error:
            raise AssertionError("provider observed a held business row lock") from error

    def query_payment(self, request: QueryPaymentRequest):  # type: ignore[no-untyped-def]
        self._assert_no_business_row_locks(request.merchant_order_no)
        return super().query_payment(request)

    def create_prepay(self, request: CreatePrepayRequest):  # type: ignore[no-untyped-def]
        self._assert_no_business_row_locks(request.merchant_order_no)
        return super().create_prepay(request)


class RejectionRaceProvider:
    name = "mock"
    app_id = "mock-app-id"
    merchant_id = "mock-merchant-id"

    def __init__(self, recovered_status: QueryPaymentStatus) -> None:
        self.recovered_status = recovered_status
        self.accepted = Event()
        self.rejected = Event()
        self.release_first = Event()
        self._lock = Lock()
        self._create_calls = 0
        self._request: CreatePrepayRequest | None = None
        self.created = Created(
            "race-prepay",
            PaymentLaunchParams(
                "1785146640", "race-nonce", "prepay_id=race-prepay", "RSA", "race-sign"
            ),
        )

    def create_prepay(self, request: CreatePrepayRequest) -> Created | Rejected:
        with self._lock:
            self._create_calls += 1
            call_number = self._create_calls
            if call_number == 1:
                self._request = request
                self.accepted.set()
            else:
                self.rejected.set()
        if call_number == 1:
            if not self.release_first.wait(timeout=5):
                raise RuntimeError("test did not release delayed provider response")
            return self.created
        return Rejected("DUPLICATE_MERCHANT_ORDER")

    def query_payment(self, request: QueryPaymentRequest) -> QueryPaymentResult:
        if not self.rejected.is_set():
            return QueryPaymentResult(QueryPaymentStatus.NOT_FOUND)
        if self.recovered_status is QueryPaymentStatus.NOT_PAID:
            return QueryPaymentResult(
                QueryPaymentStatus.NOT_PAID,
                provider_prepay_id=self.created.provider_prepay_id,
                launch_params=self.created.launch_params,
            )
        assert self.recovered_status is QueryPaymentStatus.SUCCESS
        original = self._request
        assert original is not None
        return QueryPaymentResult(
            QueryPaymentStatus.SUCCESS,
            facts=AuthoritativePaymentFacts(
                app_id="mock-app-id",
                merchant_id="mock-merchant-id",
                merchant_order_no=request.merchant_order_no,
                provider_transaction_no="race-transaction",
                amount_cents=original.amount_cents,
                currency="CNY",
                paid_at=datetime.now(UTC),
            ),
        )

    def close_payment(self, _request: ClosePaymentRequest) -> ClosePaymentResult:
        return ClosePaymentResult(ClosePaymentStatus.CLOSED)


def test_provider_calls_happen_without_business_row_locks(pg_engine: Engine) -> None:
    user_id, order_id = seed_order(pg_engine)

    result = service(pg_engine, LockCheckingProvider(pg_engine, order_id)).create_payment(
        user_id=user_id,
        order_id=order_id,
        idempotency_key="payment-lock-check-key",
        payer_openid="openid",
    )

    assert result.status_code == 201


def test_lock_probe_detects_a_deliberately_held_business_lock(pg_engine: Engine) -> None:
    _user_id, order_id = seed_order(pg_engine)
    provider = LockCheckingProvider(pg_engine, order_id)

    with Session(pg_engine) as locker:
        order = locker.get_one(Order, order_id)
        locker.scalar(select(Slot.id).where(Slot.id == order.slot_id).with_for_update())
        with pytest.raises(AssertionError, match="held business row lock"):
            provider._assert_no_business_row_locks("not-created")  # noqa: SLF001


@pytest.mark.parametrize(
    ("recovered_status", "second_status", "first_status", "payment_status"),
    [
        (QueryPaymentStatus.NOT_PAID, 200, 201, PaymentState.PREPAY_CREATED),
        (QueryPaymentStatus.SUCCESS, 202, 202, PaymentState.CONFIRMING),
    ],
)
def test_rejected_duplicate_is_requeried_before_local_close(
    pg_engine: Engine,
    recovered_status: QueryPaymentStatus,
    second_status: int,
    first_status: int,
    payment_status: PaymentState,
) -> None:
    user_id, order_id = seed_order(pg_engine)
    provider = RejectionRaceProvider(recovered_status)
    payments = service(pg_engine, provider)
    results: dict[str, CreatePaymentResult] = {}
    errors: dict[str, BaseException] = {}

    def create(label: str, key: str) -> None:
        try:
            results[label] = payments.create_payment(
                user_id=user_id,
                order_id=order_id,
                idempotency_key=key,
                payer_openid="openid",
            )
        except BaseException as error:  # pragma: no cover - asserted below
            errors[label] = error

    first = Thread(target=create, args=("first", "payment-race-first"))
    first.start()
    assert provider.accepted.wait(timeout=3)
    second = Thread(target=create, args=("second", "payment-race-second"))
    second.start()
    second.join(timeout=3)
    try:
        assert not second.is_alive(), "rejected caller did not finish its authority recheck"
        assert errors == {}
        assert results["second"].status_code == second_status
        with Session(pg_engine) as session:
            payment = session.scalar(select(Payment))
            assert payment is not None
            assert payment.status is not PaymentState.CLOSED
            merchant_order_no = payment.merchant_order_no
    finally:
        provider.release_first.set()
        first.join(timeout=3)

    assert not first.is_alive()
    assert errors == {}
    assert results["first"].status_code == first_status
    with Session(pg_engine) as session:
        assert session.scalar(select(func.count()).select_from(Payment)) == 1
        payment = session.scalar(select(Payment))
        assert payment is not None
        assert payment.merchant_order_no == merchant_order_no
        assert payment.status is payment_status


@pytest.mark.parametrize("same_key", [False, True])
def test_late_success_is_not_cut_off_by_stale_closed_result(
    pg_engine: Engine, same_key: bool
) -> None:
    user_id, order_id = seed_order(pg_engine)
    payments = service(pg_engine, MockPaymentProvider())
    late = payments._phase_one(  # noqa: SLF001 - deterministic phase interleaving
        user_id=user_id, order_id=order_id, idempotency_key="payment-late-success"
    )
    stale = payments._phase_one(  # noqa: SLF001 - deterministic phase interleaving
        user_id=user_id,
        order_id=order_id,
        idempotency_key=("payment-late-success" if same_key else "payment-stale-close"),
    )
    assert isinstance(late, _PhaseOne) and isinstance(stale, _PhaseOne)
    with pytest.raises(AppError, match="PAYMENT_CREATE_FAILED"):
        payments._phase_three(  # noqa: SLF001
            stale, Rejected("DEFINITIVELY_NOT_CREATED")
        )
    success = QueryPaymentResult(
        QueryPaymentStatus.SUCCESS,
        facts=AuthoritativePaymentFacts(
            app_id="mock-app-id",
            merchant_id="mock-merchant-id",
            merchant_order_no=late.merchant_order_no,
            provider_transaction_no="late-success-transaction",
            amount_cents=late.amount_cents,
            currency="CNY",
            paid_at=datetime.now(UTC),
        ),
    )

    result = payments._phase_three(late, success)  # noqa: SLF001

    assert result.status_code == 202
    with Session(pg_engine) as session:
        payment = session.get_one(Payment, late.payment_id)
        records = session.scalars(
            select(IdempotencyRecord).where(IdempotencyRecord.payment_id == late.payment_id)
        ).all()
        assert payment.status is PaymentState.CONFIRMING
        assert payment.next_reconcile_at is not None
        assert payment.last_error_code is None
        assert payment.last_error_at is None
        assert payment.paid_at is None
        assert payment.provider_transaction_no is None
        assert {record.state for record in records} == {IdempotencyState.PROCESSING}
        assert all(record.response_status is None for record in records)
        merchant_order_no = payment.merchant_order_no

    reused = payments.create_payment(
        user_id=user_id,
        order_id=order_id,
        idempotency_key="payment-after-late-success",
        payer_openid="openid",
    )
    assert reused.status_code == 202
    assert reused.body["payment_id"] == str(late.payment_id)
    with Session(pg_engine) as session:
        assert session.scalar(select(func.count()).select_from(Payment)) == 1
        payment = session.get_one(Payment, late.payment_id)
        assert payment.merchant_order_no == merchant_order_no
        assert payment.status is PaymentState.CONFIRMING


def test_late_success_collision_enters_order_exception_without_overwriting_attempts(
    pg_engine: Engine,
) -> None:
    user_id, order_id = seed_order(pg_engine)
    payments = service(pg_engine, MockPaymentProvider())
    late = payments._phase_one(  # noqa: SLF001 - deterministic phase interleaving
        user_id=user_id, order_id=order_id, idempotency_key="payment-old-success"
    )
    assert isinstance(late, _PhaseOne)
    with pytest.raises(AppError, match="PAYMENT_CREATE_FAILED"):
        payments._phase_three(  # noqa: SLF001
            late, Rejected("DEFINITIVELY_NOT_CREATED")
        )
    newer = payments._phase_one(  # noqa: SLF001 - creates the collision safely
        user_id=user_id, order_id=order_id, idempotency_key="payment-new-attempt"
    )
    assert isinstance(newer, _PhaseOne)
    success = QueryPaymentResult(
        QueryPaymentStatus.SUCCESS,
        facts=AuthoritativePaymentFacts(
            app_id="mock-app-id",
            merchant_id="mock-merchant-id",
            merchant_order_no=late.merchant_order_no,
            provider_transaction_no="late-collision-success",
            amount_cents=late.amount_cents,
            currency="CNY",
            paid_at=datetime.now(UTC),
        ),
    )

    result = payments._phase_three(late, success)  # noqa: SLF001

    assert result.status_code == 202
    assert result.body["payment_id"] == str(late.payment_id)
    with Session(pg_engine) as session:
        order = session.get_one(Order, order_id)
        attempts = session.scalars(select(Payment).order_by(Payment.created_at)).all()
        assert order.status is OrderStatus.PAYMENT_EXCEPTION
        assert [attempt.status for attempt in attempts] == [
            PaymentState.CLOSED,
            PaymentState.CREATING,
        ]
        assert attempts[0].provider_transaction_no is None
        assert attempts[0].last_error_code == "LATE_SUCCESS_ATTEMPT_COLLISION"
        assert attempts[1].merchant_order_no == newer.merchant_order_no
        assert session.get_one(Payment, late.payment_id).merchant_order_no == (
            late.merchant_order_no
        )

    with pytest.raises(AppError, match="PAYMENT_EXCEPTION"):
        payments.create_payment(
            user_id=user_id,
            order_id=order_id,
            idempotency_key="payment-third-attempt-blocked",
            payer_openid="openid",
        )
    with Session(pg_engine) as session:
        assert session.scalar(select(func.count()).select_from(Payment)) == 2


def test_crash_before_provider_retries_same_merchant_number(pg_engine: Engine) -> None:
    user_id, order_id = seed_order(pg_engine)
    provider = MockPaymentProvider()
    payments = service(pg_engine, provider)
    phase = payments._phase_one(  # noqa: SLF001 - intentional crash-window seam
        user_id=user_id, order_id=order_id, idempotency_key="payment-crash-before"
    )
    assert not hasattr(phase, "status_code")
    with Session(pg_engine) as session:
        merchant_order_no = session.scalar(select(Payment.merchant_order_no))

    recovered = payments.create_payment(
        user_id=user_id,
        order_id=order_id,
        idempotency_key="payment-crash-before",
        payer_openid="openid",
    )

    assert recovered.status_code == 200
    assert provider.calls[-1].merchant_order_no == merchant_order_no
    assert provider.provider_order_count == 1


def test_crash_after_provider_acceptance_recovers_by_query(pg_engine: Engine) -> None:
    user_id, order_id = seed_order(pg_engine)
    provider = MockPaymentProvider()
    payments = service(pg_engine, provider)
    payments._phase_one(  # noqa: SLF001 - intentional crash-window seam
        user_id=user_id, order_id=order_id, idempotency_key="payment-crash-after"
    )
    with Session(pg_engine) as session:
        payment = session.scalar(select(Payment))
        assert payment is not None
        merchant_order_no = payment.merchant_order_no
        amount = payment.amount_cents
        time_expire = payment.order.expires_at
    provider.create_prepay(
        CreatePrepayRequest(
            merchant_order_no,
            "预订场地",
            amount,
            "CNY",
            "openid",
            time_expire,
        )
    )

    recovered = payments.create_payment(
        user_id=user_id,
        order_id=order_id,
        idempotency_key="payment-crash-after",
        payer_openid="openid",
    )

    assert recovered.status_code == 200
    assert [call.method for call in provider.calls].count("create_prepay") == 1


def test_twenty_concurrent_keys_share_one_nonterminal_payment(pg_engine: Engine) -> None:
    user_id, order_id = seed_order(pg_engine)
    provider = MockPaymentProvider()

    def create(index: int) -> tuple[int, str]:
        result = service(pg_engine, provider).create_payment(
            user_id=user_id,
            order_id=order_id,
            idempotency_key=f"payment-concurrent-{index:04d}",
            payer_openid="openid",
        )
        return result.status_code, str(result.body["payment_id"])

    with ThreadPoolExecutor(max_workers=20) as pool:
        results = list(pool.map(create, range(20)))

    assert len({payment_id for _status, payment_id in results}) == 1
    assert sum(status == 201 for status, _payment_id in results) == 1
    with Session(pg_engine) as session:
        assert session.scalar(select(func.count()).select_from(Payment)) == 1
        payment = session.scalar(select(Payment))
        assert payment is not None and payment.status is PaymentState.PREPAY_CREATED
        assert session.scalar(select(func.count()).select_from(IdempotencyRecord)) == 20
        assert {record.payment_id for record in session.scalars(select(IdempotencyRecord))} == {
            payment.id
        }
    assert provider.provider_order_count == 1


def test_stale_unknown_for_same_key_replays_completed_prepay_without_regression(
    pg_engine: Engine,
) -> None:
    user_id, order_id = seed_order(pg_engine)
    provider = MockPaymentProvider(create_mode=MockCreateMode.UNKNOWN_AFTER_ACCEPTANCE)
    payments = service(pg_engine, provider)
    fast = payments._phase_one(  # noqa: SLF001 - deterministic phase interleaving
        user_id=user_id, order_id=order_id, idempotency_key="payment-same-key-race"
    )
    slow = payments._phase_one(  # noqa: SLF001 - deterministic phase interleaving
        user_id=user_id, order_id=order_id, idempotency_key="payment-same-key-race"
    )
    assert isinstance(fast, _PhaseOne) and isinstance(slow, _PhaseOne)
    unknown = provider.create_prepay(
        CreatePrepayRequest(
            fast.merchant_order_no,
            "预订场地",
            32000,
            "CNY",
            "openid",
            fast.time_expire,
        )
    )
    assert isinstance(unknown, Unknown)
    accepted = provider.query_payment(QueryPaymentRequest(fast.merchant_order_no))

    created = payments._phase_three(fast, accepted)  # noqa: SLF001
    replay = payments._phase_three(slow, unknown)  # noqa: SLF001

    assert created.status_code == 201
    assert replay.status_code == 200
    assert replay.body == created.body
    with Session(pg_engine) as session:
        payment = session.scalar(select(Payment))
        record = session.scalar(select(IdempotencyRecord))
        assert payment is not None and payment.status is PaymentState.PREPAY_CREATED
        assert record is not None and record.state is IdempotencyState.COMPLETED


def test_stale_unknown_for_different_key_keeps_current_monotonic_result(
    pg_engine: Engine,
) -> None:
    user_id, order_id = seed_order(pg_engine)
    provider = MockPaymentProvider(create_mode=MockCreateMode.UNKNOWN_AFTER_ACCEPTANCE)
    payments = service(pg_engine, provider)
    fast = payments._phase_one(  # noqa: SLF001 - deterministic phase interleaving
        user_id=user_id, order_id=order_id, idempotency_key="payment-fast-key-race"
    )
    slow = payments._phase_one(  # noqa: SLF001 - deterministic phase interleaving
        user_id=user_id, order_id=order_id, idempotency_key="payment-slow-key-race"
    )
    assert isinstance(fast, _PhaseOne) and isinstance(slow, _PhaseOne)
    unknown = provider.create_prepay(
        CreatePrepayRequest(
            fast.merchant_order_no,
            "预订场地",
            32000,
            "CNY",
            "openid",
            fast.time_expire,
        )
    )
    assert isinstance(unknown, Unknown)
    accepted = provider.query_payment(QueryPaymentRequest(fast.merchant_order_no))

    created = payments._phase_three(fast, accepted)  # noqa: SLF001
    unfinished = payments._phase_three(slow, unknown)  # noqa: SLF001

    assert created.status_code == 201
    assert unfinished.status_code == 202
    with Session(pg_engine) as session:
        payment = session.scalar(select(Payment))
        records = session.scalars(select(IdempotencyRecord).order_by(IdempotencyRecord.key)).all()
        assert payment is not None and payment.status is PaymentState.PREPAY_CREATED
        assert {record.payment_id for record in records} == {payment.id}
        assert {record.state for record in records} == {
            IdempotencyState.COMPLETED,
            IdempotencyState.PROCESSING,
        }

    recovered = payments.create_payment(
        user_id=user_id,
        order_id=order_id,
        idempotency_key="payment-slow-key-race",
        payer_openid="openid",
    )
    assert recovered.status_code == 200
    assert recovered.body["payment_id"] == created.body["payment_id"]
    with Session(pg_engine) as session:
        assert set(session.scalars(select(IdempotencyRecord.state))) == {IdempotencyState.COMPLETED}
        assert session.scalar(select(Payment.status)) is PaymentState.PREPAY_CREATED
