# Order Lifecycle Foundation Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 冻结并实现取消、退款、核销、完成和 B2 资格共用的 PostgreSQL 模型、纯策略、Provider 协议和静态 OpenAPI 契约，让后续三个旅程可以安全并行。

**Architecture:** 单一串行任务独占 `models.py`、Alembic head、共享 domain policy、refund repository 和 OpenAPI 公共 schema。它不提供用户或场馆生产按钮，也不调用微信；后续任务只能实现已冻结接口，不再修改共享枚举、迁移和 schema。

**Tech Stack:** Python 3.13、FastAPI/Pydantic、SQLAlchemy 2、PostgreSQL/Alembic、OpenAPI 3.0、pytest、Node contract validator。

**Design:** `docs/superpowers/specs/2026-08-18-order-lifecycle-and-refund-design.md`

---

## Chunk 1: Storage and domain authority

### Task 1: Add lifecycle and refund storage

**Files:**

- Create: `backend/migrations/versions/0013_order_lifecycle.py`
- Modify: `backend/app/models.py`
- Create: `backend/tests/test_order_lifecycle_migration.py`
- Modify: `backend/tests/test_booking_migration_cycle.py`
- Modify: `backend/tests/test_platform_session_migration.py`
- Modify: `backend/app/modules/payments/convergence.py`
- Modify: `backend/tests/test_payment_settlement.py`

- [ ] **Step 1: Write the PostgreSQL migration RED tests**

Cover only the shared invariants:

- head is `0013`, upgrading from `0012` preserves existing orders/payments;
- `order_status` contains the five new values;
- order timestamp/operator constraints reject invalid pairs and allow `CONFIRMED + cancel_requested_at` without `cancelled_at`;
- one payment per order can have non-null immutable `applied_to_order_at`;
- a confirmed order with exactly one existing successful payment is backfilled as its applied payment; migration aborts rather than guessing when a confirmed order has zero or multiple successful payments;
- refund case is unique by `payment_id`, not by `order_id`;
- case/payment/order/amount/currency mismatch is rejected by the named database boundary;
- `VENUE_CANCELLED` requires a trimmed `reason_note` of 1–500 characters; every other reason requires null;
- one active attempt per case and `(case_id, attempt_no)` uniqueness;
- upgrade and downgrade work before rows use new enum values; downgrade refuses destructive coercion once new states exist.

Run:

```bash
TEST_DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test \
  uv run pytest backend/tests/test_order_lifecycle_migration.py \
  backend/tests/test_booking_migration_cycle.py \
  backend/tests/test_platform_session_migration.py -q
```

Expected: RED because revision `0013`, columns and tables are absent.

- [ ] **Step 2: Implement the minimal model and migration**

Add enums:

```python
class RefundCasePurpose(StrEnum):
    ORDER_CANCELLATION = "ORDER_CANCELLATION"
    DUPLICATE_CHARGE = "DUPLICATE_CHARGE"
    PAYMENT_INVENTORY_CONFLICT = "PAYMENT_INVENTORY_CONFLICT"

class RefundReason(StrEnum):
    USER_CANCELLED = "USER_CANCELLED"
    VENUE_CANCELLED = "VENUE_CANCELLED"
    AUTOMATIC_RECOVERY = "AUTOMATIC_RECOVERY"

class RefundAttemptStatus(StrEnum):
    CREATING = "CREATING"
    PROCESSING = "PROCESSING"
    SUCCESS = "SUCCESS"
    FAILED = "FAILED"
    UNKNOWN = "UNKNOWN"
```

Extend `OrderStatus` and add exactly the fields in the design. Add `Payment.applied_to_order_at`; add `RefundCase` and `RefundAttempt` relationships and named constraints. Use a partial unique index for one applied payment per order and one active attempt per case. Add narrow PostgreSQL triggers for immutable applied payment and case/payment/order/amount/currency matching; do not create a generic event framework.

In the existing payment convergence transaction, set `applied_to_order_at` only when that payment is the one that changes the order/slot to `CONFIRMED + BOOKED`. Never set it for a late success or inventory conflict. The Provider track will create automatic refund cases for those extra successful payments after this authority marker exists.

- [ ] **Step 3: Run GREEN migration tests**

Run the Step 1 command. Expected: all pass.

- [ ] **Step 4: Run model lint and commit**

```bash
uv run ruff check backend/app/models.py backend/migrations/versions/0013_order_lifecycle.py \
  backend/app/modules/payments/convergence.py backend/tests/test_order_lifecycle_migration.py \
  backend/tests/test_payment_settlement.py
git diff --check
git add backend/app/models.py backend/migrations/versions/0013_order_lifecycle.py \
  backend/app/modules/payments/convergence.py backend/tests/test_payment_settlement.py \
  backend/tests/test_order_lifecycle_migration.py \
  backend/tests/test_booking_migration_cycle.py backend/tests/test_platform_session_migration.py
git commit -m "feat: persist order lifecycle authority"
```

### Task 2: Freeze lifecycle and B2 eligibility policy

**Files:**

- Create: `backend/app/modules/orders/lifecycle.py`
- Create: `backend/tests/test_order_lifecycle_policy.py`
- Modify: `backend/app/modules/orders/dto.py`

- [ ] **Step 1: Write pure policy RED tests**

Table-drive exact boundaries:

- owner cancel: pending without payment, pending with possible payment, confirmed at `>=24h`, confirmed below 24h;
- venue refund allowed only for active manageable membership, confirmed and not checked in/completed;
- check-in allowed at exactly `starts_at - 2h`, denied one microsecond earlier;
- complete requires check-in and `now >= ends_at`;
- B2 creation requires `CONFIRMED`, no cancel request, no order-controlling refund case, and `starts_at > now + 2h` (exactly 2h denied);
- duplicate-charge case never blocks B2;
- every denied action has a closed safe `blocked_reason`.

Use immutable policy inputs rather than ORM sessions:

```python
@dataclass(frozen=True, slots=True)
class OrderLifecycleFacts:
    status: OrderStatus
    starts_at: datetime
    ends_at: datetime
    cancel_requested_at: datetime | None
    checked_in_at: datetime | None
    payment_may_exist: bool
    controlling_refund_purpose: RefundCasePurpose | None
```

Run:

```bash
uv run pytest backend/tests/test_order_lifecycle_policy.py -q
```

Expected: RED because the policy module does not exist.

- [ ] **Step 2: Implement closed action projection**

Add `OrderAllowedActionsResponse` to `dto.py` with required booleans and nullable closed `blocked_reason`. Keep role/authorization lookup outside the pure policy; the policy accepts an actor capability enum such as `OWNER | VENUE_MANAGER`.

Do not infer payment authority from client time. `payment_may_exist` is projected server-side from locked payment rows, never accepted from an API request. After cancellation is requested, a pending order whose payment may exist returns no pay/cancel action and `PAYMENT_RESULT_PENDING`; a confirmed order with an unresolved cancel inside 24h returns `CANCELLATION_REQUIRES_SUPPORT`.

- [ ] **Step 3: Run GREEN and adjacent order tests**

```bash
uv run pytest backend/tests/test_order_lifecycle_policy.py \
  backend/tests/test_order_detail.py backend/tests/test_order_list.py -q
uv run ruff check backend/app/modules/orders/lifecycle.py \
  backend/app/modules/orders/dto.py backend/tests/test_order_lifecycle_policy.py
```

- [ ] **Step 4: Commit**

```bash
git add backend/app/modules/orders/lifecycle.py backend/app/modules/orders/dto.py \
  backend/tests/test_order_lifecycle_policy.py
git diff --cached --check
git commit -m "feat: define order lifecycle actions"
```

### Task 3: Add shared refund repository and Provider protocols

**Files:**

- Create: `backend/app/modules/refunds/__init__.py`
- Create: `backend/app/modules/refunds/provider.py`
- Create: `backend/app/modules/refunds/repository.py`
- Create: `backend/tests/test_refund_provider.py`
- Create: `backend/tests/test_refund_repository.py`
- Modify: `backend/app/modules/payments/provider.py`
- Modify: `backend/app/modules/payments/service.py`
- Modify: `backend/app/modules/payments/reconciliation.py`
- Modify: existing payment provider test constructors under `backend/tests/test_payment_*.py`

- [ ] **Step 1: Write Provider and repository RED tests**

Provider tests freeze:

- `CreatePrepayRequest.time_expire` is required and timezone-aware;
- merchant payment/refund numbers are non-empty and at most 32 characters;
- `AuthoritativeRefundFacts` contains and validates every field from the design;
- only `SUCCESS` refund query results contain authoritative facts;
- refund facts with amount/currency/merchant/payment mismatch cannot be accepted by the future convergence boundary.

Repository tests use real PostgreSQL and cover:

- lock order `Slot → Order → Payment → RefundCase → RefundAttempt`;
- lookup/create by successful `payment_id`;
- purpose-specific creation under that lock: cancellation requires the applied payment, duplicate charge requires a different applied payment on the order, and inventory conflict requires no applied payment;
- inventory mutation is returned only when the locked slot belongs to the case order and no other `CONFIRMED | REFUND_PENDING | REFUND_FAILED | COMPLETED` order owns the booking; otherwise the helper returns no mutation authority;
- latest attempt and due-attempt lease claim;
- the same payment cannot create two cases under two sessions;
- an `UNKNOWN` active attempt prevents a second active attempt.

Run:

```bash
TEST_DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test \
  uv run pytest backend/tests/test_refund_provider.py backend/tests/test_refund_repository.py -q
```

Expected: RED because the refund module is absent and payment request has no expiry.

- [ ] **Step 2: Implement minimal protocols and repository primitives**

`RefundProvider` exposes only:

```python
def create_refund(self, request: CreateRefundRequest) -> CreateRefundResult: ...
def query_refund(self, request: QueryRefundRequest) -> QueryRefundResult: ...
```

The repository owns storage/locking/leases and the shared purpose/inventory authority predicates only; it must not decide owner time-window or venue membership policy and must not call a Provider. A caller may mutate a slot only through the locked ownership proof returned by the repository. Update payment creation/recovery to pass the order expiry and shorten the merchant payment number to a stable `PB{payment_id.hex[:30]}` or an equivalent collision-safe value of at most 32 characters. Do not add the HTTP WeChat adapter in this task.

- [ ] **Step 3: Run GREEN and payment regressions**

```bash
TEST_DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test \
  uv run pytest backend/tests/test_refund_provider.py backend/tests/test_refund_repository.py \
  backend/tests/test_payment_provider.py backend/tests/test_payment_creation.py \
  backend/tests/test_payment_reconcile.py backend/tests/test_payment_reconciliation_worker.py -q
uv run ruff check backend/app/modules/refunds backend/app/modules/payments \
  backend/tests/test_refund_provider.py backend/tests/test_refund_repository.py
```

- [ ] **Step 4: Commit**

```bash
git add backend/app/modules/refunds backend/app/modules/payments \
  backend/tests/test_refund_provider.py backend/tests/test_refund_repository.py \
  backend/tests/test_payment_*.py
git diff --cached --check
git commit -m "feat: freeze payment and refund protocols"
```

---

## Chunk 2: Static contract and parallel handoff

### Task 4: Freeze closed OpenAPI operations and existing order projections

**Files:**

- Modify: `contracts/openapi.yaml`
- Create: `contracts/examples/order-cancelled.json`
- Create: `contracts/examples/order-refund-pending.json`
- Create: `contracts/examples/venue-fulfillment-orders.json`
- Create: `contracts/examples/venue-order-checked-in.json`
- Create: `contracts/examples/venue-order-completed.json`
- Create: `contracts/examples/refund-accepted.json`
- Modify: `scripts/validate-contract.mjs`
- Modify: `tests/contract.test.mjs`
- Modify: `backend/tests/test_openapi_conformance.py`
- Modify: `backend/app/modules/orders/repository.py`
- Modify: `backend/app/modules/orders/service.py`
- Modify: `backend/app/modules/orders/router.py`
- Modify: `backend/tests/test_order_list.py`
- Modify: `backend/tests/test_order_detail.py`

- [ ] **Step 1: Write contract RED tests**

Freeze exact closed schemas and response matrices for:

- expanded order list/detail statuses, lifecycle timestamps, funding alert and `allowed_actions`;
- owner `POST /api/v1/orders/{order_id}/cancel` with required `Idempotency-Key`;
- venue fulfillment list/check-in/complete/refund operations with bearer auth and required idempotency headers for mutations;
- payment and refund notification endpoints with raw-body semantics and no business bearer auth;
- errors `AUTH_REQUIRED`, `ORDER_NOT_FOUND`, `ORDER_STATE_CHANGED`, `IDEMPOTENCY_KEY_REUSED`, `PAYMENT_RESULT_PENDING`, `REFUND_IN_PROGRESS`, `PAYMENT_PROVIDER_UNAVAILABLE`, `SERVICE_UNAVAILABLE`.
- the complete closed policy reasons `CANCELLATION_WINDOW_CLOSED`, `CHECK_IN_TOO_EARLY`, `CHECK_IN_REQUIRED`, `SESSION_NOT_ENDED`, `ORDER_TERMINAL`, `CANCELLATION_REQUIRES_SUPPORT`.

For the already existing owner list/detail routes, require runtime responses and runtime OpenAPI to match the expanded timestamps, funding alert and `allowed_actions`. New cancel/check-in/complete/refund routes remain static-only until their parallel tracks implement them.

Assert list privacy remains closed: ordinary order list still has no contact, address, coordinates, provider identifiers or refund identifiers. Venue fulfillment may expose only masked phone required for arrival coordination.

Run:

```bash
uv run pytest backend/tests/test_openapi_conformance.py -q
node --test tests/contract.test.mjs
```

Expected: RED on the new paths/status/schema assertions.

- [ ] **Step 2: Add static paths, schemas and examples**

Keep new mutation contracts honest but implementation-independent. Do not add their runtime FastAPI routes in this foundation task. Update only the existing owner list/detail queries and presenters to project server-authoritative lifecycle facts through the pure policy, including locked payment/refund facts; do not duplicate policy in the router. Use separate owner and venue projections instead of broadening public `OrderSummary` with contact data. Preserve existing `POST /api/v1/orders` request/response compatibility.

- [ ] **Step 3: Validate contract GREEN**

```bash
npm run contract:validate
node --test tests/contract.test.mjs
uv run pytest backend/tests/test_openapi_conformance.py -q
node --check scripts/validate-contract.mjs
TEST_DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test \
  uv run pytest backend/tests/test_order_list.py backend/tests/test_order_detail.py -q
```

- [ ] **Step 4: Commit**

```bash
git add contracts scripts/validate-contract.mjs tests/contract.test.mjs \
  backend/tests/test_openapi_conformance.py backend/app/modules/orders/repository.py \
  backend/app/modules/orders/service.py backend/app/modules/orders/router.py \
  backend/tests/test_order_list.py backend/tests/test_order_detail.py
git diff --cached --check
git commit -m "feat: contract order lifecycle actions"
```

### Task 5: Verify the serial foundation and open parallel tracks

**Files:**

- Modify: `docs/superpowers/plans/2026-08-16-overall-slice-roadmap.md`
- Create: `docs/acceptance/order-lifecycle-foundation-progress.md`

- [ ] **Step 1: Run the proportional shared regression**

```bash
TEST_DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test \
  uv run pytest backend/tests/test_order_lifecycle_migration.py \
  backend/tests/test_order_lifecycle_policy.py backend/tests/test_refund_provider.py \
  backend/tests/test_refund_repository.py backend/tests/test_order_list.py \
  backend/tests/test_order_detail.py backend/tests/test_payment_creation.py \
  backend/tests/test_payment_reconcile.py backend/tests/test_openapi_conformance.py -q
uv run ruff check backend/app/models.py backend/app/modules/orders \
  backend/app/modules/payments backend/app/modules/refunds backend/tests/test_order_lifecycle_*.py \
  backend/tests/test_refund_*.py
npm run contract:validate
node --test tests/contract.test.mjs
git diff --check
```

- [ ] **Step 2: Record the handoff truthfully**

Mark only the shared storage/protocol/contract foundation complete. Explicitly state:

- no cancel/check-in/complete/refund production route exists until the parallel plans finish;
- no real payment claim is allowed without merchant credentials;
- A3 CREATE and B1 iPhone list acceptance debts remain unchanged;
- parallel agents must not modify `models.py`, revision `0013`, shared Provider result enums or the frozen common OpenAPI schemas.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/plans/2026-08-16-overall-slice-roadmap.md \
  docs/acceptance/order-lifecycle-foundation-progress.md
git diff --cached --check
git commit -m "docs: open order lifecycle parallel tracks"
```
