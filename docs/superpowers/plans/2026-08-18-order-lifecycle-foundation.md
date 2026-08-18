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
- Create: `contracts/examples/error-order-state-changed.json`
- Create: `contracts/examples/error-payment-result-pending.json`
- Create: `contracts/examples/error-refund-in-progress.json`
- Create: `contracts/examples/error-payment-provider-unavailable.json`
- Create: `contracts/examples/error-wechat-notification-invalid.json`
- Modify: `contracts/examples/order-pending.json`
- Modify: `contracts/examples/order-expired.json`
- Modify: `contracts/examples/order-confirmed.json`
- Modify: `contracts/examples/order-payment-exception.json`
- Modify: `contracts/examples/payment-confirming.json`
- Modify: `contracts/examples/payment-already-confirmed.json`
- Modify: `contracts/examples/my-orders-ready.json`
- Modify: `artifacts/ui/fixtures/order-pending.json`
- Modify: `artifacts/ui/fixtures/order-expired.json`
- Modify: `artifacts/ui/fixtures/order-confirmed.json`
- Modify: `artifacts/ui/fixtures/order-payment-exception.json`
- Modify: `artifacts/ui/fixtures/order-payment-confirming.json`
- Modify: `scripts/validate-contract.mjs`
- Modify: `tests/contract.test.mjs`
- Modify: `backend/tests/test_openapi_conformance.py`
- Modify: `backend/app/modules/orders/dto.py`
- Modify: `backend/app/modules/orders/repository.py`
- Modify: `backend/app/modules/orders/service.py`
- Modify: `backend/app/modules/orders/router.py`
- Modify: `backend/tests/test_order_list.py`
- Modify: `backend/tests/test_order_detail.py`
- Modify: `backend/tests/test_order_creation.py`

- [ ] **Step 0: Stabilize the existing order-detail business clock**

Make only the adjacent test-harness fix needed before RED/GREEN work. In `backend/tests/test_order_detail.py`, define one fixed timezone-aware business `NOW`; derive seeded order and slot times from it, override `get_order_clock` for request tests, and inject `now=lambda: NOW` into direct `OrderService` tests. Keep auth session issuance/expiry on real `datetime.now(UTC)` so the bearer remains valid independently of the fixed business date. Do not change production clock code or relax the database same-local-day constraint.

Run:

```bash
TEST_DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test \
  uv run pytest backend/tests/test_order_detail.py -q
```

Expected: the pre-existing detail suite passes at every Shanghai wall-clock hour, including late night.

- [ ] **Step 1: Write static contract RED tests**

In `tests/contract.test.mjs` and `backend/tests/test_openapi_conformance.py`, freeze these exact boundaries:

- `POST /api/v1/orders` references a dedicated closed legacy `CreateOrderResponse`; `order-pending.json` remains its legacy example, has no `allowed_actions` or `funding_alerts`, and an idempotent replay is byte-for-byte the first stored business body rather than a recalculated projection;
- owner `GET /api/v1/orders` and `GET /api/v1/orders/{order_id}` use expanded projections with all 9 statuses, four required nullable lifecycle timestamps, required closed `allowed_actions`, and required closed `funding_alerts`; detail also retains nullable `expired_at`;
- `blocked_reason` has exactly `PAYMENT_RESULT_PENDING | CANCELLATION_WINDOW_CLOSED | CANCELLATION_REQUIRES_SUPPORT | CHECK_IN_TOO_EARLY | CHECK_IN_REQUIRED | SESSION_NOT_ENDED | ORDER_TERMINAL | REFUND_IN_PROGRESS`;
- each `funding_alerts` item is closed and contains only `code: DUPLICATE_CHARGE_REFUND` plus `status: REFUND_PENDING | REFUND_FAILED | REFUNDED`; the array permits multiple items and exposes no case/payment/provider/refund identifier;
- ordinary owner list stays closed and exposes no contact, address, coordinates, provider/refund/payment identifiers, or actor identifier;
- owner cancel is bearer-authenticated, has no body, requires a 16–128 character `Idempotency-Key`, and has only `200 | 202 | 401 | 404 | 409 | 503`;
- venue fulfillment list has only `200 | 401 | 404 | 422 | 503`; venue check-in and complete have only `200 | 401 | 404 | 409 | 503`; venue refund has only `200 | 202 | 401 | 404 | 409 | 422 | 503`; the three mutations require `Idempotency-Key`, while the venue projection exposes at most the masked phone needed for arrival;
- both WeChat notify operations declare `security: []`, require non-empty `Wechatpay-Timestamp | Wechatpay-Nonce | Wechatpay-Signature | Wechatpay-Serial`, declare `x-wechatpay-raw-body-verification: required-before-json-parse`, accept `application/json`, and use a closed notification envelope with only required `id | create_time | event_type | resource_type | summary | resource`; closed `resource` has only required `original_type | algorithm | ciphertext | associated_data | nonce`, with `algorithm` fixed to `AEAD_AES_256_GCM`;
- both notify response matrices are exactly bodyless `204`, `400 WECHAT_NOTIFICATION_INVALID`, and `503 SERVICE_UNAVAILABLE`; `204` also covers a valid duplicate;
- `/api/v1/orders/{order_id}/pay` keeps `PAYMENT_CREATE_FAILED` for an explicit upstream rejection and adds `PAYMENT_PROVIDER_UNAVAILABLE` for configuration or transport unavailability under its 503 response;
- static owner detail adds `422 INVALID_ARGUMENT`, and runtime OpenAPI matches it;
- all 7 new static paths—owner cancel, four venue fulfillment operations, and two notification operations—remain absent from runtime OpenAPI.

Extend—not replace—the validator's global error examples with the Task 4 operation set `AUTH_REQUIRED | INVALID_ARGUMENT | ORDER_NOT_FOUND | ORDER_STATE_CHANGED | IDEMPOTENCY_KEY_REUSED | PAYMENT_RESULT_PENDING | REFUND_IN_PROGRESS | PAYMENT_CREATE_FAILED | PAYMENT_PROVIDER_UNAVAILABLE | WECHAT_NOTIFICATION_INVALID | SERVICE_UNAVAILABLE`. Add canonical files for the five new codes and attach them to the corresponding responses: state-changed to lifecycle mutation 409s, payment-pending to owner-cancel 409, refund-in-progress to cancel/refund 409s, provider-unavailable only to `/pay` 503, and notification-invalid to both notify 400s. Reuse existing canonical examples for the remaining codes and attach `SERVICE_UNAVAILABLE` to every applicable new 503, including venue refund and both notifications.

- [ ] **Step 2: Prove both static suites RED independently**

Run each command even if the first fails:

```bash
node --test tests/contract.test.mjs
```

Expected: RED on the new static paths, schema split, exact enums, response matrices, examples, and artifact bytes.

```bash
uv run pytest backend/tests/test_openapi_conformance.py -q
```

Expected: RED because owner GET runtime projection and runtime OpenAPI do not yet conform, while the 7 new runtime routes are still correctly absent.

- [ ] **Step 3: Write owner runtime projection RED tests**

Add focused cases in this order:

1. `backend/tests/test_order_creation.py`: a fresh create and idempotent replay keep the exact legacy field set and omit dynamic actions/alerts; a fresh response uses “开场前至少 24 小时可自助取消并全额退款；不足 24 小时请联系客服。”, while an already persisted replay remains byte-identical to its stored historic body.
2. `backend/tests/test_order_list.py`: every row has the expanded status/timestamp/actions/alerts shape; privacy stays closed; result ordering and pagination stay unchanged.
3. `backend/tests/test_order_detail.py`: the applied `SUCCESS` payment is the only primary payment; a second successful but unapplied payment cannot replace `paid_at`; `payment_may_exist` is true only for `CREATING | PREPAY_CREATED | CONFIRMING | UNKNOWN | SUCCESS` and false for `CLOSED`; controlling purpose comes only from `ORDER_CANCELLATION | PAYMENT_INVENTORY_CONFLICT`; one or multiple `DUPLICATE_CHARGE` cases affect only stably ordered `funding_alerts`, selecting the highest `attempt_no` and mapping no/latest active attempt to pending, `FAILED` to failed, and `SUCCESS` to refunded. The shared owner-detail projection always emits the exact approved cancellation copy, which also governs existing payment/reconcile wrappers that embed this DTO.

Run each suite independently:

```bash
TEST_DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test \
  uv run pytest backend/tests/test_order_creation.py -q
```

```bash
TEST_DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test \
  uv run pytest backend/tests/test_order_list.py -q
```

```bash
TEST_DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test \
  uv run pytest backend/tests/test_order_detail.py -q
```

Expected: only the new assertions are RED; the fixed-clock pre-existing detail assertions remain GREEN.

- [ ] **Step 4: Implement the static contract and canonical examples**

In `contracts/openapi.yaml`, split the legacy `CreateOrderResponse` from expanded owner `OrderSummary`/`OrderDetail`; keep POST create on the former and GET routes on the latter. Remove `order-pending.json` from owner GET detail examples rather than making the legacy create example satisfy the dynamic GET schema. Add closed `OrderAllowedActions`, `FundingAlert`, venue projections, notification envelope/resource, exact headers, vendor extension, security, response matrices, owner-detail 422, and `/pay` 503 enum specified above. Define the 7 paths statically without registering runtime routes.

Update `scripts/validate-contract.mjs` and canonical examples together. Expand the affected owner GET or payment-wrapper examples (`order-expired.json`, `order-confirmed.json`, `order-payment-exception.json`, `payment-confirming.json`, `payment-already-confirmed.json`, `my-orders-ready.json`), while keeping `order-pending.json` on the legacy create schema. Apply the approved cancellation copy to every fresh create, owner detail, and payment/reconcile wrapper example; historical persisted create replays remain untouched at runtime. Add the six success examples and five error examples listed in this task and no speculative payload fields.

Normalize and copy exactly these five canonical sources to their checked-in artifacts so the existing byte-equality invariant remains true:

```text
contracts/examples/order-pending.json           -> artifacts/ui/fixtures/order-pending.json
contracts/examples/order-expired.json           -> artifacts/ui/fixtures/order-expired.json
contracts/examples/order-confirmed.json         -> artifacts/ui/fixtures/order-confirmed.json
contracts/examples/order-payment-exception.json -> artifacts/ui/fixtures/order-payment-exception.json
contracts/examples/payment-confirming.json      -> artifacts/ui/fixtures/order-payment-confirming.json
```

- [ ] **Step 5: Implement the compatibility split and existing owner runtime projection**

- In `dto.py`, add a dedicated legacy create response and the closed alert/action types; keep expanded `OrderDetailResponse` for owner GET and the existing payment/reconcile wrappers that already embed it.
- In `repository.py`, eager-load payments, refund cases, and attempts for list/detail in the original bounded queries; do not query from presenters.
- In `service.py`, derive primary payment only from `SUCCESS + applied_to_order_at`, derive `payment_may_exist` from the five allowed states, derive controlling refund only from the two controlling purposes, and map duplicate cases only to stable `funding_alerts`. Reuse the Task 2 pure policy for `allowed_actions`.
- Keep the create presenter separate and legacy-shaped. New create and shared detail bodies use the approved cancellation copy; persisted idempotent create responses are replayed unchanged and never gain time-dependent fields or rewritten historic copy.
- In `router.py`, change the create route's 201 response model and explicit 200 model to `CreateOrderResponse`, then align existing owner list/detail runtime response models and the detail 422 declaration. Do not register any of the 7 new static routes, parse notification JSON, or implement Provider behavior in this task. The Provider track owns the more precise runtime `/pay` 503 mapping.

- [ ] **Step 6: Make the static contract GREEN in exact order**

```bash
node --check scripts/validate-contract.mjs
```

Expected: exits 0.

```bash
npm run contract:validate
```

Expected: validator accepts every closed schema, example, operation matrix, and error mapping.

```bash
node --test tests/contract.test.mjs
```

Expected: all contract tests pass, including all five byte-equality pairs.

```bash
uv run pytest backend/tests/test_openapi_conformance.py -q
```

Expected: runtime owner GET/create operations conform and all 7 future operations remain absent.

- [ ] **Step 7: Make focused runtime tests GREEN and check the diff**

```bash
TEST_DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test \
  uv run pytest backend/tests/test_order_creation.py backend/tests/test_order_list.py \
  backend/tests/test_order_detail.py -q
```

Expected: all focused owner projection and legacy create compatibility tests pass.

```bash
uv run ruff check backend/app/modules/orders/dto.py backend/app/modules/orders/repository.py \
  backend/app/modules/orders/service.py backend/app/modules/orders/router.py \
  backend/tests/test_order_creation.py backend/tests/test_order_list.py \
  backend/tests/test_order_detail.py backend/tests/test_openapi_conformance.py
git diff --check
```

Expected: both commands exit 0. Do not expand this task into notification handlers, venue/owner mutations, Provider adapters, or new shared abstractions.

- [ ] **Step 8: Commit**

```bash
git add contracts/openapi.yaml contracts/examples/order-cancelled.json \
  contracts/examples/order-refund-pending.json \
  contracts/examples/venue-fulfillment-orders.json \
  contracts/examples/venue-order-checked-in.json \
  contracts/examples/venue-order-completed.json contracts/examples/refund-accepted.json \
  contracts/examples/error-order-state-changed.json \
  contracts/examples/error-payment-result-pending.json \
  contracts/examples/error-refund-in-progress.json \
  contracts/examples/error-payment-provider-unavailable.json \
  contracts/examples/error-wechat-notification-invalid.json \
  contracts/examples/order-pending.json contracts/examples/order-expired.json \
  contracts/examples/order-confirmed.json contracts/examples/order-payment-exception.json \
  contracts/examples/payment-confirming.json contracts/examples/payment-already-confirmed.json \
  contracts/examples/my-orders-ready.json artifacts/ui/fixtures/order-pending.json \
  artifacts/ui/fixtures/order-expired.json artifacts/ui/fixtures/order-confirmed.json \
  artifacts/ui/fixtures/order-payment-exception.json \
  artifacts/ui/fixtures/order-payment-confirming.json scripts/validate-contract.mjs \
  tests/contract.test.mjs backend/tests/test_openapi_conformance.py \
  backend/app/modules/orders/dto.py backend/app/modules/orders/repository.py \
  backend/app/modules/orders/service.py backend/app/modules/orders/router.py \
  backend/tests/test_order_creation.py backend/tests/test_order_list.py \
  backend/tests/test_order_detail.py
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
