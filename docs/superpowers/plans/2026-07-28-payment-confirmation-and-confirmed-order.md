# Payment Confirmation and Confirmed Order Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a locally deployable payment-confirmation journey that uses a development-only payment provider to move an honest pending order through authoritative server confirmation to `CONFIRMED/BOOKED`, while deferring real WeChat Pay and production delivery.

**Architecture:** Extend the existing native WeChat Mini Program, FastAPI, and PostgreSQL vertical slice. First create three 375×812 visual states on an isolated Fixture frontend and stop for explicit visual approval. After that gate, freeze OpenAPI, add a durable payment-attempt state machine with one lock order (`slot → order → payment`), implement a development Provider and reconciliation worker, then replace the UI Fixture path with real local HTTP while keeping all mock payment bindings out of production builds.

**Tech Stack:** Native WeChat Mini Program WXML/WXSS/TypeScript, Jest, Node test runner, OpenAPI 3.1, FastAPI, Pydantic, SQLAlchemy 2, Alembic, PostgreSQL, pytest, Ruff, Mypy, Docker Compose.

**Specification:** `docs/superpowers/specs/2026-07-28-payment-confirmation-and-confirmed-order-design.md`

**Delivery constraint:** Do not deploy or claim real WeChat Pay delivery. ICP, merchant binding, API v3 credentials, public HTTPS notification, real signature/decryption integration, real-device payment, five small live transactions, iOS/Android acceptance, deletion of the runtime mock binding, and final production evidence remain the last deferred delivery step.

---

## File Structure

Visual phase, before the user gate:

```text
artifacts/ui/references/payment-pending.html             payable 375×812 reference
artifacts/ui/references/payment-confirming.html          confirming 375×812 reference
artifacts/ui/references/booking-confirmed.html            confirmed 375×812 reference
artifacts/ui/flows/payment-confirmation.md                state and authority flow
artifacts/ui/screen-manifest/booking-confirmation.yaml    extend existing order-detail states
artifacts/ui/reviews/payment-confirmation/README.md        comparison checklist and decision log
miniprogram/domain/payment.ts                             visual-phase payment view types
miniprogram/presentation/payment.ts                       pure payment UI state machine
miniprogram/presentation/payment.test.ts                  state-machine tests
miniprogram/services/payment.ts                           narrow payment data-source registry
miniprogram/dev/payment-scenarios.ts                      temporary deterministic visual states
miniprogram/dev/payment-source.ts                         development-only fixture source
miniprogram/dev/payment-capability.ts                     explicit simulated cashier
miniprogram/pages/order-detail/index.*                    three-state order detail rendering
```

Contract and persistence phase, only after visual approval:

```text
contracts/openapi.yaml
contracts/examples/payment-prepay-created.json
contracts/examples/payment-confirming.json
contracts/examples/order-confirmed.json
contracts/examples/order-payment-exception.json
contracts/examples/error-order-expired.json
contracts/examples/error-payment-create-failed.json
contracts/examples/error-payment-exception.json
backend/migrations/versions/0003_payment_confirmation.py
backend/app/models.py
backend/app/modules/payments/__init__.py
backend/app/modules/payments/dto.py
backend/app/modules/payments/provider.py
backend/app/modules/payments/mock_provider.py
backend/app/modules/payments/repository.py
backend/app/modules/payments/service.py
backend/app/modules/payments/convergence.py
backend/app/modules/payments/reconciliation.py
backend/app/modules/payments/router.py
backend/app/modules/payments/development_router.py
backend/app/modules/orders/locking.py
```

Integration and acceptance phase:

```text
miniprogram/domain/booking.ts
miniprogram/domain/decoders.ts
miniprogram/domain/decoders.test.ts
miniprogram/runtime/interfaces.ts
miniprogram/runtime/production.ts
miniprogram/runtime/production.test.ts
miniprogram/services/http-payment.ts
miniprogram/services/http-payment.test.ts
backend/app/config.py
backend/app/main.py
backend/app/modules/orders/{dto,repository,service,expiry}.py
backend/app/worker.py
deploy/.env.example
scripts/audit-production-package.mjs
scripts/build-miniprogram.mjs
docs/acceptance/payment-confirmation-progress.md
```

## Chunk 1: Artifact, Fixture Frontend, and Mandatory Visual Gate

### Task 0: Verify and Checkpoint the Accepted Booking Foundation

**Files:**
- Read: `docs/acceptance/booking-confirmation-progress.md`
- Read: `docs/superpowers/plans/2026-07-27-booking-confirmation-and-pending-order.md`
- Inspect: every path currently reported by `git status --short`

- [ ] **Step 1: Classify the dirty worktree before payment edits**

Map each modified/untracked path to the already accepted booking-confirmation plan and acceptance record. Do not stage any path that cannot be attributed to that completed slice or an earlier accepted foundation. If an overlapping path contains unrelated user changes that cannot be separated safely, stop and ask before staging it.

- [ ] **Step 2: Re-run the accepted foundation gates**

Run:

```bash
npm test
npm run lint
npm run typecheck
npm run contract:validate
npm run build:miniprogram:development
npm run build:miniprogram:production
npm run audit:miniprogram-package
.venv/bin/python -m pytest backend/tests -q
.venv/bin/ruff check backend
.venv/bin/mypy backend
```

Expected: the previously recorded local foundation remains green.

- [ ] **Step 3: Create a recoverable foundation checkpoint**

Stage only paths classified in Step 1, inspect `git diff --cached --name-status` and `git diff --cached --check`, then commit them separately from all payment work:

```bash
git commit -m "feat: checkpoint booking confirmation foundation"
```

Expected: payment implementation starts from a recoverable foundation. Any intentionally unrelated user changes remain unstaged and untouched.

### Task 1: Freeze the Three-State Payment Artifact

**Files:**
- Create: `artifacts/ui/references/payment-pending.html`
- Create: `artifacts/ui/references/payment-confirming.html`
- Create: `artifacts/ui/references/booking-confirmed.html`
- Create: `artifacts/ui/flows/payment-confirmation.md`
- Create: `artifacts/ui/reviews/payment-confirmation/README.md`
- Modify: `artifacts/ui/screen-manifest/booking-confirmation.yaml`
- Modify: `artifacts/ui/README.md`
- Modify: `tests/artifacts.test.mjs`
- Modify: `tests/structure.test.mjs`

- [ ] **Step 1: Write the failing artifact tests**

Require the three references, flow, existing manifest, and review file. Parse the manifest, locate its existing `order-detail` screen, and assert the payment-state extension without replacing prior expiry states:

```js
const orderDetail = manifest.screens.find(({ id }) => id === "order-detail");
assert.deepEqual(orderDetail.target_viewport, { width: 375, height: 812 });
assert.deepEqual(orderDetail.states, [
  "pending-payment", "closing-payment", "closing-error", "expired",
  "creating-prepay", "cashier-open", "payment-confirming",
  "payment-exception", "booking-confirmed",
]);
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `node --test tests/artifacts.test.mjs tests/structure.test.mjs`

Expected: FAIL because the payment manifest and reference do not exist.

- [ ] **Step 3: Build three lightweight 375×812 references**

Reuse the approved order-detail card hierarchy and existing design tokens. Each reference renders exactly one capture-ready state:

- `payment-pending`: “待支付”, countdown, amount, “立即支付”;
- `payment-confirming`: “正在确认支付”, authority warning, disabled “支付确认中…”;
- `booking-confirmed`: green vector check, “预订成功”, paid snapshot, “查看预订详情”.

Do not add an active order-cancel button, fake ball-game creation action, emoji icon, or real WeChat branding. Use a 44px minimum target, 4/8px spacing rhythm, safe bottom inset, and actual contrast checks documented in the review README.

- [ ] **Step 4: Write the authority flow and evidence contract**

Record:

```text
cashier_success != paid
cashier_success → payment-confirming
provider SUCCESS → CONFIRMED + BOOKED → booking-confirmed
cashier_cancelled → payment-pending
UNKNOWN → payment-confirming/payment-exception, never success or released inventory
```

The review README must reserve exact evidence paths for reference, implementation, side-by-side, overlay-50, difference, and a nine-category difference log.

- [ ] **Step 5: Run artifact checks and commit**

Run: `node --test tests/artifacts.test.mjs tests/structure.test.mjs`

Expected: PASS.

Commit:

```bash
git add artifacts/ui/references/payment-pending.html artifacts/ui/references/payment-confirming.html artifacts/ui/references/booking-confirmed.html artifacts/ui/flows/payment-confirmation.md artifacts/ui/screen-manifest/booking-confirmation.yaml artifacts/ui/reviews/payment-confirmation/README.md artifacts/ui/README.md tests/artifacts.test.mjs tests/structure.test.mjs
git commit -m "design: add payment confirmation artifact"
```

### Task 2: Add Deterministic Payment Fixtures and a Pure UI State Machine

**Files:**
- Create: `miniprogram/domain/payment.ts`
- Create: `miniprogram/presentation/payment.ts`
- Create: `miniprogram/presentation/payment.test.ts`
- Create: `miniprogram/dev/payment-scenarios.ts`
- Create: `miniprogram/dev/payment-source.ts`
- Create: `miniprogram/dev/payment-source.test.ts`
- Create: `miniprogram/dev/payment-capability.ts`
- Create: `miniprogram/dev/payment-capability.test.ts`

- [ ] **Step 1: Write failing fixture and presentation tests**

Cover the approved transitions:

```ts
expect(reducePayment(ready, { type: "PAY_STARTED", key: "pay-key-1" }).status)
  .toBe("creating-prepay");
expect(reducePayment(cashierOpen, { type: "CASHIER_CANCELLED" }).status)
  .toBe("payment-pending");
expect(reducePayment(cashierOpen, { type: "CASHIER_SUCCEEDED" }).status)
  .toBe("payment-confirming");
expect(reducePayment(confirming, { type: "ORDER_RECEIVED", order: confirmed }).status)
  .toBe("booking-confirmed");
```

Also prove that cashier success alone never manufactures a `CONFIRMED` `OrderView`; network/unknown retries of the same create operation retain the old idempotency key; after cashier cancel or a definitive failure, a new user click generates a new key; and the data source still accepts/reuses the server's current nonterminal `paymentId` instead of assuming a new payment attempt.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npx jest miniprogram/presentation/payment.test.ts miniprogram/dev/payment-source.test.ts miniprogram/dev/payment-capability.test.ts --runInBand`

Expected: FAIL on missing modules/fixtures.

- [ ] **Step 3: Implement the minimum discriminated state machine**

Define `PaymentLaunchResult`, `PaymentCapabilityResult`, `PaymentPageState`, and reducer events without HTTP or `wx.*` types. Keep `payment-confirming` distinct from `booking-confirmed`, and retain the last real `OrderView` during loading/error states to prevent layout shifts.

- [ ] **Step 4: Generate deterministic development scenarios**

Use the same order, venue, pitch, contact, price, and timestamps in all scenarios. Only authority/state fields may differ. These scenarios are temporary visual-phase data and must not enter contract generation or production imports.

- [ ] **Step 5: Run tests, typecheck, and commit**

Run:

```bash
npx jest miniprogram/presentation/payment.test.ts miniprogram/dev/payment-source.test.ts miniprogram/dev/payment-capability.test.ts --runInBand
npm run typecheck
```

Expected: PASS with zero TypeScript diagnostics.

Commit:

```bash
git add miniprogram/domain/payment.ts miniprogram/presentation/payment.ts miniprogram/presentation/payment.test.ts miniprogram/dev/payment-scenarios.ts miniprogram/dev/payment-source.ts miniprogram/dev/payment-source.test.ts miniprogram/dev/payment-capability.ts miniprogram/dev/payment-capability.test.ts
git commit -m "test: add payment visual fixtures"
```

### Task 3: Render the Three States in the Real Mini Program Runtime

**Files:**
- Create: `miniprogram/services/payment.ts`
- Create: `miniprogram/services/payment.test.ts`
- Modify: `miniprogram/dev/payment-source.ts`
- Modify: `miniprogram/dev/payment-capability.ts`
- Modify: `miniprogram/dev/bootstrap.ts`
- Modify: `miniprogram/dev/app-pages.json`
- Modify: `miniprogram/pages/order-detail/index.ts`
- Modify: `miniprogram/pages/order-detail/index.wxml`
- Modify: `miniprogram/pages/order-detail/index.wxss`
- Modify: `miniprogram/pages/order-detail/index.test.ts`
- Modify: `miniprogram/presentation/order-detail.ts`
- Modify: `miniprogram/presentation/order-detail.test.ts`
- Modify: `tests/development-http-build.test.mjs`

- [ ] **Step 1: Write failing page and development-binding tests**

Assert the page renders the exact approved titles/CTA semantics, disables duplicate pay actions, maps mock cashier cancel back to pending, maps mock success only to confirming, stops timers on hide/unload, and shows confirmed only after the data source returns a confirmed order.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
npx jest miniprogram/pages/order-detail/index.test.ts miniprogram/presentation/order-detail.test.ts --runInBand
node --test tests/development-http-build.test.mjs
```

Expected: FAIL because payment bindings/states are absent.

- [ ] **Step 3: Register development-only payment source and simulated cashier**

The source reads only the three development fixtures. The simulated cashier must display an explicit “模拟支付，不会扣款” marker and support success, user cancel, launch failure, and delayed authoritative confirmation. It must never be imported by `miniprogram/runtime/production.ts`.

- [ ] **Step 4: Extend the existing order-detail poller rather than adding a second timer owner**

Keep one scheduler responsible for countdown, closing, and payment-confirming polling. Poll every two seconds for the first 30 seconds; after that render “重新查询” and use a lower-frequency path. `onHide` and `onUnload` cancel every timer; `onShow` immediately refreshes the order.

- [ ] **Step 5: Build the development package and run checks**

Run:

```bash
npm run build:miniprogram:development
npx jest miniprogram/pages/order-detail/index.test.ts miniprogram/presentation/order-detail.test.ts --runInBand
npm run typecheck
```

Expected: PASS, and `dist/miniprogram-development/pages/order-detail/` contains the three-state UI.

- [ ] **Step 6: Commit the Fixture frontend checkpoint**

```bash
git add miniprogram/services/payment.ts miniprogram/services/payment.test.ts miniprogram/dev/bootstrap.ts miniprogram/dev/app-pages.json miniprogram/dev/payment-source.ts miniprogram/dev/payment-capability.ts miniprogram/pages/order-detail/index.ts miniprogram/pages/order-detail/index.wxml miniprogram/pages/order-detail/index.wxss miniprogram/pages/order-detail/index.test.ts miniprogram/presentation/order-detail.ts miniprogram/presentation/order-detail.test.ts tests/development-http-build.test.mjs
git commit -m "feat: preview payment confirmation states"
```

### Task 4: Produce Same-Viewport Evidence and Stop for User Approval

**Files:**
- Create: `artifacts/ui/reviews/payment-confirmation/reference-{pending,confirming,confirmed}-375x812.png`
- Create: `artifacts/ui/reviews/payment-confirmation/implementation-{pending,confirming,confirmed}-375x812.png`
- Create: `artifacts/ui/reviews/payment-confirmation/side-by-side-{pending,confirming,confirmed}.png`
- Create: `artifacts/ui/reviews/payment-confirmation/overlay-50-{pending,confirming,confirmed}.png`
- Create: `artifacts/ui/reviews/payment-confirmation/difference-{pending,confirming,confirmed}.png`
- Create: `artifacts/ui/reviews/payment-confirmation/review-board.html`
- Modify: `artifacts/ui/reviews/payment-confirmation/README.md`
- Modify: `tests/artifacts.test.mjs`
- Modify: `tests/structure.test.mjs`

- [ ] **Step 1: Write failing evidence completeness and PNG-dimension tests**

Require all 15 images plus `review-board.html`. Parse PNG IHDR headers and assert every reference and implementation input is exactly 375×812; assert the review board links all three state groups and their side-by-side/overlay/difference evidence.

- [ ] **Step 2: Run evidence tests and verify RED**

Run: `node --test tests/artifacts.test.mjs tests/structure.test.mjs`

Expected: FAIL because the 15 images and review board do not exist.

- [ ] **Step 3: Capture reference and WeChat DevTools at exactly 375×812**

Use Chrome for the reference and WeChat DevTools for the real WXML/WXSS implementation. Do not resize one screenshot after capture to imitate the target viewport.

- [ ] **Step 4: Generate comparison evidence and the browser board**

For every state, create a same-size side-by-side, 50% overlay, and absolute pixel difference image. Build `review-board.html` to show all comparisons at readable scale. Record composition, geometry/spacing, hierarchy, typography, colors/materials, vector assets, copy, and state semantics.

- [ ] **Step 5: Run visual evidence checks**

Run: `node --test tests/artifacts.test.mjs tests/structure.test.mjs`

Expected: PASS and all 15 evidence images have 375×812 inputs.

- [ ] **Step 6: Present the browser review board and request explicit confirmation**

**MANDATORY VISUAL GATE:** Stop here. Do not edit `contracts/openapi.yaml`, create migration `0003`, or implement any backend payment code until the user explicitly confirms the visual comparison.

- [ ] **Step 7: Record approval and commit visual evidence**

```bash
git add artifacts/ui/reviews/payment-confirmation/README.md artifacts/ui/reviews/payment-confirmation/review-board.html artifacts/ui/reviews/payment-confirmation/reference-pending-375x812.png artifacts/ui/reviews/payment-confirmation/reference-confirming-375x812.png artifacts/ui/reviews/payment-confirmation/reference-confirmed-375x812.png artifacts/ui/reviews/payment-confirmation/implementation-pending-375x812.png artifacts/ui/reviews/payment-confirmation/implementation-confirming-375x812.png artifacts/ui/reviews/payment-confirmation/implementation-confirmed-375x812.png artifacts/ui/reviews/payment-confirmation/side-by-side-pending.png artifacts/ui/reviews/payment-confirmation/side-by-side-confirming.png artifacts/ui/reviews/payment-confirmation/side-by-side-confirmed.png artifacts/ui/reviews/payment-confirmation/overlay-50-pending.png artifacts/ui/reviews/payment-confirmation/overlay-50-confirming.png artifacts/ui/reviews/payment-confirmation/overlay-50-confirmed.png artifacts/ui/reviews/payment-confirmation/difference-pending.png artifacts/ui/reviews/payment-confirmation/difference-confirming.png artifacts/ui/reviews/payment-confirmation/difference-confirmed.png tests/artifacts.test.mjs tests/structure.test.mjs
git commit -m "design: approve payment confirmation visuals"
```

## Chunk 2: Contract and Durable Payment Foundation

### Task 5: Freeze OpenAPI Payment and Order Projection Contracts

**Files:**
- Create: `contracts/examples/payment-prepay-created.json`
- Create: `contracts/examples/payment-confirming.json`
- Create: `contracts/examples/order-confirmed.json`
- Create: `contracts/examples/order-payment-exception.json`
- Create: `contracts/examples/error-order-expired.json`
- Create: `contracts/examples/error-payment-create-failed.json`
- Create: `contracts/examples/error-payment-exception.json`
- Create: `artifacts/ui/fixtures/order-payment-confirming.json`
- Create: `artifacts/ui/fixtures/order-confirmed.json`
- Create: `artifacts/ui/fixtures/order-payment-exception.json`
- Modify: `artifacts/ui/fixtures/order-pending.json`
- Modify: `contracts/openapi.yaml`
- Modify: `scripts/validate-contract.mjs`
- Modify: `scripts/generate-fixtures.mjs`
- Modify: `tests/contract.test.mjs`
- Modify: `tests/fixtures.test.mjs`
- Modify: `backend/tests/test_openapi_conformance.py`

- [ ] **Step 1: Write failing contract tests for the response matrix**

Require:

- `POST /api/v1/orders/{order_id}/pay`: 200/201/202/401/404/409/503;
- `POST /api/v1/orders/{order_id}/payments/{payment_id}/reconcile`: 200/202/401/404;
- development-only mock notification path absent from the production OpenAPI;
- closed `OrderDetail` schema with required nullable `payment_state`, required booleans `payment_confirming/closing_payment`, and required nullable `paid_at`.

- [ ] **Step 2: Run contract tests and verify RED**

Run each independently:

```bash
npm run contract:validate
node --test tests/contract.test.mjs tests/fixtures.test.mjs
.venv/bin/python -m pytest backend/tests/test_openapi_conformance.py -q
```

Expected: each new assertion reaches RED on its own missing payment operation/schema/example rather than being skipped by shell short-circuiting.

- [ ] **Step 3: Add exact discriminated responses and examples**

Encode the specification's HTTP matrix without ambiguous `200/409` alternatives. `GET /orders/{id}` always returns 200 for a visible order, including `PAYMENT_EXCEPTION`; create/reconcile endpoints use 202 only while authority is unresolved. Only now generate the canonical payment/order Fixture JSON; do not reuse the temporary TypeScript visual scenarios as contract authority.

- [ ] **Step 4: Validate and commit**

Run all three commands from Step 2 independently; expected PASS for each.

```bash
git add contracts/openapi.yaml contracts/examples/payment-prepay-created.json contracts/examples/payment-confirming.json contracts/examples/order-confirmed.json contracts/examples/order-payment-exception.json contracts/examples/error-order-expired.json contracts/examples/error-payment-create-failed.json contracts/examples/error-payment-exception.json artifacts/ui/fixtures/order-pending.json artifacts/ui/fixtures/order-payment-confirming.json artifacts/ui/fixtures/order-confirmed.json artifacts/ui/fixtures/order-payment-exception.json scripts/validate-contract.mjs scripts/generate-fixtures.mjs tests/contract.test.mjs tests/fixtures.test.mjs backend/tests/test_openapi_conformance.py
git commit -m "feat: define payment confirmation contract"
```

### Task 6: Add Migration 0003 and Database Invariants

**Files:**
- Create: `backend/migrations/versions/0003_payment_confirmation.py`
- Modify: `backend/app/models.py`
- Modify: `backend/tests/test_booking_migration_cycle.py`
- Modify: `backend/tests/test_booking_schema_constraints.py`
- Modify: `backend/tests/test_schema_constraints.py`

- [ ] **Step 1: Write failing migration/schema tests**

Assert:

- order statuses include `CONFIRMED` and `PAYMENT_EXCEPTION` with correct order `expired_at` checks; `orders` does not gain a second `paid_at` authority;
- payment states include `CREATING/PREPAY_CREATED/CONFIRMING/SUCCESS/CLOSED/UNKNOWN`;
- payment status/`paid_at` constraints make `payments` the only persisted payment-time authority, and OrderDetail derives `paid_at` from the selected `SUCCESS` payment;
- nullable `authority_unknown_since` exists and survives migration round-trips as the persisted 24-hour anchor; first-write-only behavior is tested in Tasks 7 and 9;
- partial unique index allows at most one nonterminal payment per order;
- `(provider, merchant_order_no)` and non-null `(provider, provider_transaction_no)` are independently unique;
- idempotency records can persist `PROCESSING` plus `payment_id` without a response;
- migration removes the old `wechat_prepay_id`-based partial index and makes `payments` the persisted authority; runtime candidate-query replacement is tested in Task 9;
- upgrade/downgrade/upgrade succeeds on PostgreSQL.

- [ ] **Step 2: Run focused PostgreSQL tests and verify RED**

Run:

```bash
.venv/bin/python -m pytest backend/tests/test_booking_migration_cycle.py backend/tests/test_booking_schema_constraints.py backend/tests/test_schema_constraints.py -q
```

Expected: FAIL because migration 0003 and payment models do not exist.

- [ ] **Step 3: Implement the migration and ORM model**

Create a focused `Payment` model and relationships. Make `payments` the sole safety authority for nonterminal attempts. Remove `wechat_prepay_id` or keep it only as a non-authoritative compatibility projection; no service or index may use it to decide safe release.

- [ ] **Step 4: Run focused tests, Ruff, and Mypy**

Run:

```bash
.venv/bin/python -m pytest backend/tests/test_booking_migration_cycle.py backend/tests/test_booking_schema_constraints.py backend/tests/test_schema_constraints.py -q
.venv/bin/ruff check backend/app/models.py backend/migrations/versions/0003_payment_confirmation.py
.venv/bin/mypy backend/app/models.py
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/models.py backend/migrations/versions/0003_payment_confirmation.py backend/tests/test_booking_migration_cycle.py backend/tests/test_booking_schema_constraints.py backend/tests/test_schema_constraints.py
git commit -m "feat: add durable payment attempts"
```

## Chunk 3: Backend Payment Authority and Recovery

### Task 7: Implement Provider Boundary and Three-Phase Prepay Creation

**Files:**
- Create: `backend/app/modules/payments/__init__.py`
- Create: `backend/app/modules/payments/provider.py`
- Create: `backend/app/modules/payments/mock_provider.py`
- Create: `backend/app/modules/payments/dto.py`
- Create: `backend/app/modules/payments/repository.py`
- Create: `backend/app/modules/payments/service.py`
- Create: `backend/app/modules/orders/locking.py`
- Create: `backend/tests/test_payment_provider.py`
- Create: `backend/tests/test_payment_creation.py`
- Create: `backend/tests/test_payment_concurrency.py`
- Modify: `backend/app/modules/orders/repository.py`
- Modify: `backend/app/config.py`
- Modify: `backend/tests/test_deploy_preflight.py`
- Modify: `deploy/.env.example`

- [ ] **Step 1: Write failing unit and PostgreSQL tests**

Cover new prepay 201, same-key replay 200, new-key reuse of the same nonterminal payment 200, already-confirmed 200, Provider-unknown 202, expired/exception 409, ownership-hiding 404, price sourced only from the order, and 20 concurrent requests yielding one merchant order number. On first uncertain acceptance assert `authority_unknown_since` is written; repeated creation recovery must not overwrite it. Also cover Provider definitive rejection: payment becomes `CLOSED`, the same idempotency key replays the original 502/503 error, and a new key may create a new attempt. Runtime configuration tests permit Mock registration only in `APP_ENV=development` with an explicit enable flag and reject it in test/staging/production; unit tests construct Mock directly through dependency injection.

Add crash-window cases:

```text
commit CREATING → crash before provider → query not found → retry create with same merchant no
provider accepted → crash before PREPAY_CREATED → query by merchant no → recover
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `.venv/bin/python -m pytest backend/tests/test_payment_provider.py backend/tests/test_payment_creation.py backend/tests/test_payment_concurrency.py backend/tests/test_deploy_preflight.py -q`

Expected: FAIL on missing payment module.

- [ ] **Step 3: Implement narrow Provider and development mock**

The Provider exposes `create_prepay`, `query_payment`, and `close_payment`. The mock supports success, delayed/duplicate notification, unknown, and close-failure recovery, but runtime registration is allowed only when development explicitly enables it. Tests construct it directly through dependency injection; test/staging/production settings cannot register the Mock router or Provider. Add these settings before any router wiring and never silently fall back.

- [ ] **Step 4: Implement three short phases**

1. No-lock ID lookup, then lock `slot → order → payment`, persist `CREATING` with an immediately/shortly due `next_reconcile_at`, link the idempotency record, commit so a crash is worker-visible.
2. Call Provider with no database row locks.
3. Lock in the same order and recheck: persist `PREPAY_CREATED` plus an initial `next_reconcile_at`; persist `UNKNOWN` plus first-write-only `authority_unknown_since` when acceptance is uncertain; or persist `CLOSED` and the replayable 502/503 result only when Provider definitively rejected and confirmed no order exists.

Every retry joins the current nonterminal payment. Never create a second merchant order number while the partial unique record exists.

- [ ] **Step 5: Run tests and static checks**

Run:

```bash
.venv/bin/python -m pytest backend/tests/test_payment_provider.py backend/tests/test_payment_creation.py backend/tests/test_payment_concurrency.py backend/tests/test_deploy_preflight.py -q
.venv/bin/ruff check backend/app/modules/payments backend/tests/test_payment_provider.py backend/tests/test_payment_creation.py
.venv/bin/mypy backend/app/modules/payments
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app/modules/payments/__init__.py backend/app/modules/payments/provider.py backend/app/modules/payments/mock_provider.py backend/app/modules/payments/dto.py backend/app/modules/payments/repository.py backend/app/modules/payments/service.py backend/app/modules/orders/locking.py backend/app/modules/orders/repository.py backend/app/config.py backend/tests/test_payment_provider.py backend/tests/test_payment_creation.py backend/tests/test_payment_concurrency.py backend/tests/test_deploy_preflight.py deploy/.env.example
git commit -m "feat: create idempotent payment attempts"
```

### Task 8: Implement Authoritative Settlement, Notification, and Immediate Reconcile

**Files:**
- Create: `backend/app/modules/payments/reconciliation.py`
- Create: `backend/app/modules/payments/convergence.py`
- Create: `backend/app/modules/payments/router.py`
- Create: `backend/app/modules/payments/development_router.py`
- Create: `backend/tests/test_payment_settlement.py`
- Create: `backend/tests/test_payment_notification.py`
- Create: `backend/tests/test_payment_reconcile.py`
- Create: `backend/tests/test_payment_security.py`
- Modify: `backend/app/modules/payments/service.py`
- Modify: `backend/app/modules/payments/repository.py`
- Modify: `backend/app/modules/orders/dto.py`
- Modify: `backend/app/modules/orders/service.py`
- Modify: `backend/app/main.py`

- [ ] **Step 1: Write failing authority tests**

Cover:

- client cashier callback alone cannot alter the order;
- verified success atomically writes `Payment.SUCCESS + Order.CONFIRMED + Slot.BOOKED`;
- duplicate success is a no-op;
- amount/currency/AppID/merchant/order mismatch cannot confirm, moves the order/payment into an explicit searchable audit condition, and persists a stable mismatch code without raw secrets;
- Provider transaction number uniqueness prevents double accounting;
- safe `AVAILABLE` recovery works only with no later valid order and a non-closed slot;
- collision with another order records payment `SUCCESS` but order `PAYMENT_EXCEPTION`;
- immediate reconcile returns 200 for terminal authority and 202 otherwise; repeated calls are idempotent, advance an unfinished payment to `CONFIRMING`, set `next_reconcile_at = now`, perform Provider query outside row locks, and preserve 404 hiding for order/payment ownership mismatch;
- OrderDetail with payment history projects `SUCCESS` first, otherwise the current nonterminal attempt, otherwise the latest terminal attempt; `paid_at` comes only from the selected `SUCCESS` record.
- logs and responses never expose merchant private keys, API v3 keys, raw signature material, bearer tokens, or full phone numbers, including mismatch/error paths.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
.venv/bin/python -m pytest backend/tests/test_payment_settlement.py backend/tests/test_payment_notification.py backend/tests/test_payment_reconcile.py backend/tests/test_payment_security.py -q
```

Expected: FAIL on missing settlement/reconcile behavior.

- [ ] **Step 3: Implement one lock coordinator**

All entry points locate IDs without locks, call one coordinator that locks `slot → order → payment`, and recheck every predicate. No Provider call occurs inside a row-lock transaction.

- [ ] **Step 4: Implement routes and closed response projection**

Register `/pay`, `/payments/{payment_id}/reconcile`, and a separately registered development-only mock authority router outside production OpenAPI. Keep a real WeChat notification adapter interface unbound until final delivery; staging/production must never register a bypass-verification route.

- [ ] **Step 5: Run tests and commit**

Run the focused suite plus:

```bash
.venv/bin/ruff check backend/app/modules/payments backend/app/modules/orders backend/app/main.py
.venv/bin/mypy backend/app/modules/payments backend/app/modules/orders
```

Expected: PASS.

```bash
git add backend/app/modules/payments/convergence.py backend/app/modules/payments/reconciliation.py backend/app/modules/payments/router.py backend/app/modules/payments/development_router.py backend/app/modules/payments/service.py backend/app/modules/payments/repository.py backend/app/modules/orders/dto.py backend/app/modules/orders/service.py backend/app/main.py backend/tests/test_payment_settlement.py backend/tests/test_payment_notification.py backend/tests/test_payment_reconcile.py backend/tests/test_payment_security.py
git commit -m "feat: confirm payments authoritatively"
```

### Task 9: Upgrade Expiry and Add Restart-Safe Reconciliation Worker

**Files:**
- Modify: `backend/app/modules/orders/expiry.py`
- Modify: `backend/app/modules/orders/repository.py`
- Modify: `backend/app/worker.py`
- Create: `backend/tests/test_payment_expiry.py`
- Create: `backend/tests/test_payment_reconciliation_worker.py`
- Modify: `backend/tests/test_order_expiry_core.py`
- Modify: `backend/tests/test_order_expiry_worker.py`

- [ ] **Step 1: Write failing expiry/recovery tests**

Prove:

- runtime expiry candidate selection uses payment terminality and never `orders.wechat_prepay_id`;
- any `CREATING/PREPAY_CREATED/CONFIRMING/UNKNOWN` payment blocks fast release;
- expiry queries first, confirms success if paid, closes if unpaid, releases only after `CLOSED`;
- Provider failure keeps `LOCKED`;
- worker scans every minute and persists 1/2/5/10/30-minute, then 30-minute backoff;
- after 24 hours the order becomes `PAYMENT_EXCEPTION` but remains queryable every six hours;
- exception + success follows settlement; exception + closed expires and releases only the original lock; unknown stays locked;
- a new worker instance resumes from `next_reconcile_at`, preserves the original `authority_unknown_since` across retries, and uses that original value for the 24-hour transition.
- `CREATING` crash window A (before Provider call): query by merchant number returns not found, then safely retry `create_prepay` with the same merchant number when the order is unexpired;
- `CREATING` crash window B (Provider accepted before local result write): query by the same merchant number finds the Provider order and converges without creating another merchant number.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
.venv/bin/python -m pytest backend/tests/test_payment_expiry.py backend/tests/test_payment_reconciliation_worker.py backend/tests/test_order_expiry_core.py backend/tests/test_order_expiry_worker.py -q
```

Expected: FAIL because the current expiry service skips any prepay forever.

- [ ] **Step 3: Replace the old fast-path predicate**

No expiry path may branch on `wechat_prepay_id`. Use payment terminality and the shared lock coordinator. Keep no-payment pending orders on the existing fast path.

- [ ] **Step 4: Add restart-safe worker scheduling**

Candidate scans are non-authoritative; each item re-locks and rechecks. Persist attempt count, next time, last error code, and last error time before commit.

- [ ] **Step 5: Run focused and full backend gates**

Run:

```bash
.venv/bin/python -m pytest backend/tests -q
.venv/bin/ruff check backend
.venv/bin/mypy backend
```

Expected: full suite PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app/modules/orders/expiry.py backend/app/modules/orders/repository.py backend/app/modules/payments/reconciliation.py backend/app/worker.py backend/tests/test_payment_expiry.py backend/tests/test_payment_reconciliation_worker.py backend/tests/test_order_expiry_core.py backend/tests/test_order_expiry_worker.py
git commit -m "feat: reconcile payment expiry safely"
```

## Chunk 4: Real Local HTTP Mini Program Integration and Acceptance

### Task 10: Implement Wire Decoders, HTTP Payment Source, and Platform Capability

**Files:**
- Modify: `miniprogram/domain/booking.ts`
- Modify: `miniprogram/domain/contracts.ts`
- Modify: `miniprogram/domain/decoders.ts`
- Modify: `miniprogram/domain/decoders.test.ts`
- Modify: `miniprogram/runtime/interfaces.ts`
- Modify: `miniprogram/runtime/production.ts`
- Modify: `miniprogram/runtime/production.test.ts`
- Create: `miniprogram/services/http-payment.ts`
- Create: `miniprogram/services/http-payment.test.ts`
- Modify: `miniprogram/services/payment.ts`

- [ ] **Step 1: Write failing decoder/source/capability tests**

Cover closed decoding for `CONFIRMED`, `PAYMENT_EXCEPTION`, all payment states, nullable `paid_at`, 201/200 launch params, 202 confirming, already-confirmed, auth retry, 404 hiding, and `wx.requestPayment` normalization into cashier success/user cancel/launch failure.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
npx jest miniprogram/domain/decoders.test.ts miniprogram/services/http-payment.test.ts miniprogram/runtime/production.test.ts --runInBand
```

Expected: FAIL on missing payment wire types.

- [ ] **Step 3: Implement strict decoders and discriminated HTTP results**

Do not let the HTTP source convert cashier success into a confirmed order. The source only returns server projections and typed launch/reconcile outcomes.

- [ ] **Step 4: Add the native capability without a production mock fallback**

Normalize exact WeChat cancellation errors separately from launch failures. Production binds only the native capability and HTTP source; missing backend payment configuration must remain an explicit server failure.

- [ ] **Step 5: Run tests and commit**

Run the focused command plus `npm run typecheck`; expected PASS.

```bash
git add miniprogram/domain/booking.ts miniprogram/domain/contracts.ts miniprogram/domain/decoders.ts miniprogram/domain/decoders.test.ts miniprogram/runtime/interfaces.ts miniprogram/runtime/production.ts miniprogram/runtime/production.test.ts miniprogram/services/payment.ts miniprogram/services/http-payment.ts miniprogram/services/http-payment.test.ts
git commit -m "feat: connect payment contract to mini program"
```

### Task 11: Replace the Fixture Page Path with Real Local HTTP

**Files:**
- Modify: `miniprogram/pages/order-detail/index.ts`
- Modify: `miniprogram/pages/order-detail/index.test.ts`
- Modify: `miniprogram/presentation/order-detail.ts`
- Modify: `miniprogram/presentation/order-detail.test.ts`
- Modify: `miniprogram/dev/bootstrap.ts`
- Modify: `miniprogram/dev/payment-source.ts`
- Modify: `miniprogram/dev/http-booking-source.ts`
- Modify: `miniprogram/dev/http-booking-source.test.ts`

- [ ] **Step 1: Write failing integrated page-controller tests**

Test the exact sequence:

```text
pending → create prepay → simulated cashier success → reconcile 202 → poll → HTTP CONFIRMED → success
```

Also test cashier cancel, launch failure, 30-second query affordance, hide/show timer lifecycle, expiry/closing, and payment exception.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
npx jest miniprogram/pages/order-detail/index.test.ts miniprogram/presentation/order-detail.test.ts miniprogram/dev/http-booking-source.test.ts --runInBand
```

Expected: FAIL until the page uses the real HTTP source.

- [ ] **Step 3: Bind development HTTP plus simulated cashier**

The development cashier remains only a platform-behavior simulator. All business state after the visual gate comes from FastAPI/PostgreSQL; delete the page's direct reads of the three payment fixtures.

- [ ] **Step 4: Run frontend gates and commit**

Run:

```bash
npm test
npm run lint
npm run typecheck
npm run build:miniprogram:development
```

Expected: PASS.

```bash
git add miniprogram/pages/order-detail/index.ts miniprogram/pages/order-detail/index.test.ts miniprogram/presentation/order-detail.ts miniprogram/presentation/order-detail.test.ts miniprogram/dev/bootstrap.ts miniprogram/dev/payment-source.ts miniprogram/dev/http-booking-source.ts miniprogram/dev/http-booking-source.test.ts
git commit -m "feat: run payment journey over local http"
```

### Task 12: Production Fail-Closed Audit and Local Vertical-Journey Acceptance

**Files:**
- Modify: `miniprogram/dev/bootstrap.ts`
- Modify: `miniprogram/dev/payment-source.ts`
- Modify: `miniprogram/pages/order-detail/index.ts`
- Modify: `miniprogram/pages/order-detail/index.test.ts`
- Modify: `miniprogram/presentation/order-detail.ts`
- Modify: `miniprogram/presentation/order-detail.test.ts`
- Modify: `scripts/audit-production-package.mjs`
- Modify: `scripts/build-miniprogram.mjs`
- Modify: `tests/audit-production-package.test.mjs`
- Modify: `tests/production-package-booking-audit.test.mjs`
- Create: `backend/tests/test_payment_local_journey.py`
- Create: `docs/acceptance/payment-confirmation-progress.md`

- [ ] **Step 1: Write failing fail-closed and local-journey tests**

Reassert the Task 7 staging/production Mock rejection, require the production package to contain no payment fixtures/mock scenario strings, and positively assert bootstrap wiring: production registers the HTTP `PaymentDataSource` plus native `PaymentCapability`; development-HTTP registers the same HTTP business source plus only the explicit simulated cashier. Require local HTTP/PostgreSQL to complete:

```text
PENDING_PAYMENT/LOCKED
→ PREPAY_CREATED
→ cashier callback leaves order pending
→ mock authority success
→ CONFIRMED/BOOKED exactly once
```

Also assert duplicate notification, duplicate payment click, mismatched amount/body, restart recovery, and expiry-before-close safety.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
.venv/bin/python -m pytest backend/tests/test_deploy_preflight.py backend/tests/test_payment_local_journey.py -q
node --test tests/audit-production-package.test.mjs tests/production-package-booking-audit.test.mjs
```

Expected: FAIL until configuration/audit/journey wiring exists.

- [ ] **Step 3: Implement fail-closed configuration and package audit**

Use explicit payment-provider configuration. Runtime Mock binding is allowed only in explicitly enabled development; tests use dependency injection and cannot enable the runtime Mock router. Staging/production require `real` and all required secrets, but because real Provider delivery is deferred, no production deployment is attempted. Audit compiled output, not only source imports.

- [ ] **Step 4: Run all automated gates**

Run:

```bash
npm test
npm run lint
npm run typecheck
npm run contract:validate
npm run build:miniprogram:development
npm run build:miniprogram:production
npm run audit:miniprogram-package
.venv/bin/python -m pytest backend/tests -q
.venv/bin/ruff check backend
.venv/bin/mypy backend
```

Expected: all commands PASS.

- [ ] **Step 5: Run local device acceptance**

In WeChat DevTools, open the real local pending order, invoke the explicit simulated cashier, observe “支付确认中”, trigger development authority success, and verify “预订成功”. Query PostgreSQL and record the exact payment/order/slot rows. Capture user-visible evidence without secrets or full phone numbers.

- [ ] **Step 6: Remove runtime business Fixture binding and re-audit**

Keep fixtures only under artifact/test tooling. The development cashier simulator may remain for local testing, but page business state must come from HTTP. Rebuild both packages and rerun the production audit.

- [ ] **Step 7: Record deferred delivery honestly**

Set `docs/acceptance/payment-confirmation-progress.md` to `LOCAL_ACCEPTED_FINAL_DELIVERY_DEFERRED`, list the real WeChat/ICP tasks from the specification, and do not deploy.

- [ ] **Step 8: Commit the local acceptance checkpoint**

```bash
git add backend/tests/test_payment_local_journey.py miniprogram/dev/bootstrap.ts miniprogram/dev/payment-source.ts miniprogram/pages/order-detail/index.ts miniprogram/pages/order-detail/index.test.ts miniprogram/presentation/order-detail.ts miniprogram/presentation/order-detail.test.ts scripts/audit-production-package.mjs scripts/build-miniprogram.mjs tests/audit-production-package.test.mjs tests/production-package-booking-audit.test.mjs docs/acceptance/payment-confirmation-progress.md
git commit -m "feat: accept local payment confirmation journey"
```

## Execution Rules

- Use a fresh implementation subagent per task and run both specification-compliance and code-quality review before accepting each task.
- Parallelize only tasks that do not share files or authority state. Inside Chunk 1, Artifact tests and pure reducer tests may run in parallel after Task 1 paths are fixed. Backend Tasks 7–9 remain sequential because they share payment/expiry invariants. Frontend HTTP decoder work may run parallel to backend unit work only after the OpenAPI contract is frozen.
- Preserve all existing user changes in the dirty worktree. Before every task, inspect `git status --short` and diff overlapping files; never reset or overwrite unrelated changes.
- Every external Provider call occurs outside database row locks. Every state mutation re-locks `slot → order → payment` and rechecks authority.
- Do not cross the visual gate without explicit user confirmation. Do not cross the final delivery gate until ICP and WeChat merchant prerequisites are available.
