# Venue Order Fulfillment Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give an authorized venue inventory manager a production WeChat Mini Program workbench for listing a venue's Shanghai-local-day orders, checking guests in, completing ended sessions, and requesting a venue-reason full refund.

**Architecture:** Treat revision `0013_order_lifecycle.py`, the models, shared lifecycle policy/action projector, `RefundRepository` purpose/inventory predicates, existing owner projection, refund provider protocol, and static OpenAPI contract as already-integrated read-only authorities. Add a bounded `venue_fulfillment` FastAPI module that consumes those authorities, performs only venue-owned writes under the shared lock order, creates/retries durable venue-cancellation cases and attempts, calls an injected refund provider outside database transactions, and hands its result to the shared convergence service owned by the WeChat Provider track. Add one closed Mini Program domain/service port whose production composition uses authenticated HTTP and whose temporary development composition uses an isolated Fixture. Follow one visual-first vertical slice: one representative 375×812 Reference/native comparison and approval by the user or a user-authorized independent visual reviewer, then backend and production integration, then delete the Fixture.

**Tech Stack:** FastAPI, SQLAlchemy 2, PostgreSQL, Pydantic, pytest, WeChat Mini Program TypeScript/WXML/WXSS, Jest, Node test runner, existing production build/audit scripts, WeChat DevTools, Pillow visual comparison.

**Design:** `docs/superpowers/specs/2026-08-18-order-lifecycle-and-refund-design.md`

---

## Scope and immutable boundaries

This plan owns only:

- authorized venue fulfillment reads for one venue and service date;
- check-in and completion mutations;
- a venue-reason, full-amount `ORDER_CANCELLATION` refund orchestration;
- the production Mini Program venue fulfillment page, entry, HTTP composition, focused tests, and temporary visual Fixture;
- honest handling of an unavailable or uncertain refund provider.

It does **not** own user cancellation, partial refunds, automatic completion, no-show/evaluation/reporting features, customer-service tooling, platform-reviewer access, or a real WeChat payment/refund adapter.

The foundation owns the shared lifecycle policy/action projection, the `RefundRepository` purpose-specific creation and inventory-ownership predicates, and the existing owner list/detail projection. This venue track calls those APIs; it must not copy their decisions into local policy branches, repository predicates, or owner presenters.

The WeChat Provider track exclusively owns `backend/app/modules/refunds/convergence.py`, the refund worker, and authoritative `SUCCESS | FAILED | UNKNOWN` validation and terminal convergence. This venue track may create or retry a durable `ORDER_CANCELLATION` case/attempt through the shared repository, invoke an injected `RefundProvider` after commit, and pass the exact provider result to shared convergence. It must not implement a second authoritative-facts validator, refund worker, or terminal state machine.

The implementation branch must not edit these shared or externally owned authorities:

- `backend/app/models.py`
- `backend/migrations/versions/0013_order_lifecycle.py`
- `backend/app/modules/orders/locking.py`, `backend/app/modules/orders/lifecycle.py`, and the shared lifecycle DTOs
- `backend/app/modules/orders/repository.py`, `backend/app/modules/orders/service.py`, and `backend/app/modules/orders/router.py` existing owner projection
- the shared refund repository predicates, provider protocol, authoritative-facts types, and `backend/app/modules/refunds/convergence.py`
- `contracts/openapi.yaml` or its lifecycle/refund examples
- any real WeChat adapter, signer, callback, or worker module

If the foundation lacks a required enum, column (including the non-empty venue reason note), lock helper, action projector, response schema, error code, or provider protocol, stop and return the missing prerequisite to the integration coordinator. Do not create a local shadow enum/schema or modify a shared file from this slice.

## Planned file map

### Visual preview and review

- `artifacts/ui/references/venue-order-fulfillment.html`: one reference renderer with the representative `refund-confirm` state.
- `artifacts/ui/references/venue-order-fulfillment.css`: existing light native token translation and 375×812 geometry.
- `artifacts/ui/references/venue-order-fulfillment-data.js`: deterministic masked operational data only.
- `artifacts/ui/flows/venue-order-fulfillment.md`: list/check-in/complete/refund/error transitions and authority boundaries.
- `artifacts/ui/screen-manifest/venue-order-fulfillment.yaml`: route, viewport, state, Fixture, and approval gate.
- `artifacts/ui/reviews/venue-order-fulfillment/README.md`: capture hashes, manual visual review, and approval state.
- `artifacts/ui/reviews/venue-order-fulfillment/review-board.html`: reference/native/comparison board.
- `tests/venue-order-fulfillment-artifact.test.mjs`: focused Artifact and evidence structure checks.
- `tests/venue-order-fulfillment-native-preview.test.mjs`: development-only route and production-exclusion checks.

### Backend

- `backend/app/modules/venue_fulfillment/__init__.py`: package marker only.
- `backend/app/modules/venue_fulfillment/dto.py`: Pydantic request/result types matching the already-frozen OpenAPI schemas.
- `backend/app/modules/venue_fulfillment/repository.py`: authorization, day query, stable cursor rows, idempotency, and adapters that call shared order/refund repository authorities without duplicating their predicates.
- `backend/app/modules/venue_fulfillment/service.py`: list projection, check-in, and completion orchestration through the shared lifecycle policy/action projector.
- `backend/app/modules/venue_fulfillment/refund.py`: venue refund request orchestration that creates/retries a durable attempt, calls the injected `RefundProvider`, and delegates its result to shared convergence.
- `backend/app/modules/venue_fulfillment/router.py`: four authenticated HTTP operations and dependency injection.
- `backend/app/main.py`: include the new router only; inject the integrated Provider-track provider and shared convergence dependencies without constructing either in the venue module.
- `backend/tests/test_venue_fulfillment.py`: real PostgreSQL authorization/list/check-in/complete coverage.
- `backend/tests/test_venue_fulfillment_refund.py`: real PostgreSQL refund, idempotency, lock, and fake-provider coverage.

### Mini Program

- `miniprogram/domain/venue-fulfillment.ts`: closed domain types and decoders for the frozen schema.
- `miniprogram/domain/venue-fulfillment.test.ts`: strict decode and invariant tests.
- `miniprogram/services/venue-fulfillment.ts`: one data-source port and mutation-attempt union.
- `miniprogram/services/http-venue-fulfillment.ts`: bearer login/retry, query encoding, and idempotent mutations.
- `miniprogram/services/http-venue-fulfillment.test.ts`: transport/auth/error/unknown-result tests.
- `miniprogram/services/venue-fulfillment-attempt-store.ts`: persistent original-key recovery for uncertain writes.
- `miniprogram/services/venue-fulfillment-attempt-store.test.ts`: storage validation and corruption cleanup.
- `miniprogram/presentation/venue-fulfillment.ts`: pure labels, blocked-reason copy, date shifts, and card view models.
- `miniprogram/presentation/venue-fulfillment.test.ts`: status/action/copy/date tests.
- `miniprogram/pages/venue-fulfillment/index.{ts,wxml,wxss,json}`: production workbench.
- `miniprogram/pages/venue-fulfillment/index.test.ts`: page controller, bindings, stale-response, and action-authority tests.
- `miniprogram/dev/venue-fulfillment-fixture.ts`: temporary development-only data source.
- `miniprogram/dev/pages/venue-fulfillment/index.{ts,wxml,wxss,json}`: temporary deterministic visual page.
- `miniprogram/dev/pages/venue-fulfillment/index.test.ts`: representative Fixture behavior.
- `miniprogram/app.json`: register the production route.
- `miniprogram/dev/app-pages.json`: register the temporary preview route until cleanup.
- `miniprogram/dev/bootstrap.ts`: register the HTTP source in HTTP mode and Fixture source only in Fixture mode.
- `miniprogram/pages/venue-profile/index.{ts,wxml,wxss}` and test: add a real “今日订单” workbench entry without shrinking touch targets.
- `scripts/build-miniprogram.mjs`: register the production HTTP source and attempt store.
- `scripts/audit-production-package.mjs`: require the production route and reject fulfillment Fixture tokens.
- `tests/build-miniprogram.test.mjs` and `tests/audit-production-package.test.mjs`: route/composition/isolation assertions.

## Chunk 1: Foundation gate and proportional visual-first preview

### Task 1: Verify the shared lifecycle foundation without changing it

**Files:**

- Verify: `docs/superpowers/specs/2026-08-18-order-lifecycle-and-refund-design.md`
- Verify: `backend/migrations/versions/0013_order_lifecycle.py`
- Verify: `backend/app/models.py`
- Verify: `backend/app/modules/orders/locking.py`
- Verify: `backend/app/modules/orders/lifecycle.py` and the existing owner repository/service/router projection
- Verify: shared `RefundRepository` and refund-provider protocol files from the integrated foundation
- Verify: `contracts/openapi.yaml`

- [ ] **Step 1: Rebase or branch from the integration commit that contains the shared implementation**

The implementation worker must not start from the design-only commit. Confirm that the working branch contains `0013_order_lifecycle.py` and the lifecycle models/policy, shared refund repository/protocols, existing owner projection, and static OpenAPI implementation promised by this plan. Shared convergence is a separate Provider-track integration prerequisite checked immediately before Task 6 calls it; it does not block the visual, list, check-in, or completion tasks.

- [ ] **Step 2: Verify the exact shared symbols**

Run:

```bash
rg -n "CANCELLED|REFUND_PENDING|REFUND_FAILED|REFUNDED|COMPLETED|checked_in_at|completed_at|class RefundCase|class RefundAttempt" backend/app/models.py
rg -n "can_check_in|can_complete|can_refund|blocked_reason" backend/app contracts/openapi.yaml
rg -n "class RefundProvider|AuthoritativeRefundFacts|CreateRefund|class RefundRepository" backend/app/modules
rg -n "/api/v1/venues/\{venue_id\}/fulfillment/orders" contracts/openapi.yaml
```

Expected: every shared model, action field, provider type, and all four venue operations exist exactly once.

- [ ] **Step 3: Verify the non-empty venue reason has persisted authority**

Confirm the shared migration/model and refund request schema provide a bounded persisted reason-note field in addition to `RefundReason.VENUE_CANCELLED`. If the text would be accepted by HTTP but discarded from the refund case/audit record, stop; that is a shared-foundation blocker.

- [ ] **Step 4: Run the existing foundation checks**

Run:

```bash
npm run contract:validate
TEST_DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test \
  uv run pytest backend/tests/test_openapi_conformance.py backend/tests/test_booking_migration_cycle.py backend/tests/test_booking_schema_constraints.py -q
```

Expected: PASS. These are prerequisite checks, not an invitation to repair shared files in this branch.

### Task 2: Freeze one representative 375×812 fulfillment Artifact

**Files:**

- Create: `artifacts/ui/references/venue-order-fulfillment.html`
- Create: `artifacts/ui/references/venue-order-fulfillment.css`
- Create: `artifacts/ui/references/venue-order-fulfillment-data.js`
- Create: `artifacts/ui/flows/venue-order-fulfillment.md`
- Create: `artifacts/ui/screen-manifest/venue-order-fulfillment.yaml`
- Create: `artifacts/ui/reviews/venue-order-fulfillment/README.md`
- Create: `artifacts/ui/reviews/venue-order-fulfillment/review-board.html`
- Create: `tests/venue-order-fulfillment-artifact.test.mjs`
- Modify: `artifacts/ui/README.md`

- [ ] **Step 1: Write the failing Artifact structure test**

Require a single `375 × 812` screen, route `pages/venue-fulfillment/index`, representative state `refund-confirm`, development Fixture path, and a pending native gate. Require the flow to name `allowed_actions` as the only button authority and to forbid reporting/search/partial-refund states.

Run: `node --test tests/venue-order-fulfillment-artifact.test.mjs`

Expected: FAIL because the Artifact does not exist.

- [ ] **Step 2: Implement the minimal reference state**

Use `miniprogram/styles/tokens.wxss` and `artifacts/ui/design-system/tokens.json`, not a new palette. The one frame should show the real operational hierarchy behind an open refund sheet:

- capsule-safe custom header with venue name and “今日订单 · 仅授权工作人员”;
- yesterday/today/tomorrow selector with today selected;
- three aligned cards demonstrating check-in, checked-in/complete, and refundable states;
- masked phone only, explicit text status, order number, pitch, and time;
- a bottom confirmation sheet for the refundable card with a visible required reason label, text area, cancel, and “确认全额退款”;
- minimum 88rpx controls, explicit flex centering, safe-area clearance, no emoji or decorative motion.

Do not design dashboards, search, reports, bulk actions, QR scanning, or a second navigation system.

- [ ] **Step 3: Capture and self-review the reference**

Capture `refund-confirm-reference-375x812.png` at exactly 375×812 and record its hash. Inspect composition, geometry/spacing, hierarchy, type/color/material, icon completeness, copy, status meaning, button centering, and bottom safe area.

- [ ] **Step 4: Run the focused check and commit**

```bash
node --test tests/venue-order-fulfillment-artifact.test.mjs
git add artifacts/ui tests/venue-order-fulfillment-artifact.test.mjs
git diff --cached --check
git commit -m "design: define venue fulfillment workbench"
```

Expected: PASS, with `Native Fixture visual approval: pending` still recorded.

### Task 3: Build the isolated native Fixture preview and stop at the visual gate

**Files:**

- Create: `miniprogram/dev/venue-fulfillment-fixture.ts`
- Create: `miniprogram/dev/pages/venue-fulfillment/index.ts`
- Create: `miniprogram/dev/pages/venue-fulfillment/index.wxml`
- Create: `miniprogram/dev/pages/venue-fulfillment/index.wxss`
- Create: `miniprogram/dev/pages/venue-fulfillment/index.json`
- Create: `miniprogram/dev/pages/venue-fulfillment/index.test.ts`
- Create: `tests/venue-order-fulfillment-native-preview.test.mjs`
- Modify: `miniprogram/dev/app-pages.json`
- Modify: `tests/build-miniprogram.test.mjs`
- Modify: `artifacts/ui/reviews/venue-order-fulfillment/README.md`

- [ ] **Step 1: Write failing Fixture/page/isolation tests**

Cover only the representative `refund-confirm` view plus deterministic transitions for check-in, complete, refund reason editing, confirmation, cancel, empty, and read error. Each visible enabled Fixture button must change Fixture state; no button may display a fake production success Toast. Require the route in development and absence from production.

Run:

```bash
npx jest miniprogram/dev/pages/venue-fulfillment/index.test.ts --runInBand
node --test tests/venue-order-fulfillment-native-preview.test.mjs
```

Expected: FAIL because the preview files are absent.

- [ ] **Step 2: Implement one immutable development Fixture and native page**

The Fixture may simulate UI state only and must export an unmistakable `VENUE_FULFILLMENT_FIXTURE` token for the production audit. Keep it under `miniprogram/dev`; production pages and services must never import it. Reuse `readInventoryHeaderLayout()` for the capsule-safe header and translate only the approved reference hierarchy.

- [ ] **Step 3: Run focused preview checks**

```bash
npx jest miniprogram/dev/pages/venue-fulfillment/index.test.ts --runInBand
npm run typecheck
npm run build:miniprogram:development
node --test tests/venue-order-fulfillment-native-preview.test.mjs tests/build-miniprogram.test.mjs
```

Expected: PASS for focused tests and development build.

- [ ] **Step 4: Capture one real native comparison**

In WeChat DevTools, open `dev/pages/venue-fulfillment/index?state=refund-confirm` on iPhone X at 375×812. Capture `refund-confirm-implementation-375x812.png`, verify the dimensions without manufacturing a crop, then run:

```bash
uv run python scripts/create_visual_review.py \
  artifacts/ui/reviews/venue-order-fulfillment/refund-confirm-reference-375x812.png \
  artifacts/ui/reviews/venue-order-fulfillment/refund-confirm-implementation-375x812.png \
  artifacts/ui/reviews/venue-order-fulfillment/refund-confirm-375x812
```

Inspect reference, implementation, side-by-side, 50% overlay, and difference at actual size. Perform one manual real-runtime self-review; fix only visible product issues. If DevTools automation fails once, use the documented manual DevTools capture path instead of expanding this task into toolchain repair.

- [ ] **Step 5: Get explicit visual confirmation and commit**

Do not start backend work until either the user approves the native preview or an independent visual reviewer whom the user has already authorized approves it. Record the reviewer, the user's authorization basis when applicable, the reviewed evidence paths/hashes, and the decision in the review README. The implementation worker may not self-approve, but user unavailability alone must not block progress when an authorized independent reviewer has recorded approval. Then run:

```bash
git add miniprogram/dev miniprogram/dev/app-pages.json tests/build-miniprogram.test.mjs \
  tests/venue-order-fulfillment-native-preview.test.mjs artifacts/ui/reviews/venue-order-fulfillment
git diff --cached --check
git commit -m "feat: preview venue fulfillment workbench"
```

## Chunk 2: Authorized list, check-in, and completion backend

### Task 4: Implement the authorized Shanghai-day order list

**Files:**

- Create: `backend/app/modules/venue_fulfillment/__init__.py`
- Create: `backend/app/modules/venue_fulfillment/dto.py`
- Create: `backend/app/modules/venue_fulfillment/repository.py`
- Create: `backend/app/modules/venue_fulfillment/service.py`
- Create: `backend/app/modules/venue_fulfillment/router.py`
- Create: `backend/tests/test_venue_fulfillment.py`
- Modify: `backend/app/main.py`

- [ ] **Step 1: Write failing PostgreSQL list and authorization tests**

Cover:

- active venue + active membership + `can_manage_inventory=true` succeeds;
- missing venue, inactive venue, absent/inactive membership, and `can_manage_inventory=false` all return the same safe 404 with no membership or order disclosure;
- a platform reviewer session is not accepted as a WeChat business session;
- default date is the server's current Shanghai date, and an explicit `service_date` is converted to the exact Shanghai midnight UTC half-open interval;
- only orders whose slot pitch belongs to the requested venue are returned;
- rows are ordered by `(starts_at, id)` ascending, paginated with a versioned opaque cursor bound to venue and service date, and never duplicated;
- only order number, pitch, local time, masked contact, lifecycle status/timestamps, and shared `allowed_actions` are projected;
- ciphertext, nonce, full phone, user ID, payment internals, provider fields, and refund internals never appear;
- a database failure rolls back and returns 503.

Run:

```bash
TEST_DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test \
  uv run pytest backend/tests/test_venue_fulfillment.py -q
```

Expected: FAIL because the module and route are absent.

- [ ] **Step 2: Add DTOs that mirror, but do not redefine, the frozen contract**

Import the shared order status, timestamp, allowed-action, and blocked-reason types. The list result should expose the contract's venue identity, `service_date`, `generated_at`, ordered `orders`, and nullable `next_cursor`. Do not add response fields for UI convenience.

- [ ] **Step 3: Implement the authorization and day query**

Use one repository predicate that joins `VenueMembership` to active `Venue` and requires the current user plus `can_manage_inventory=true`. The day query should join `Order -> Slot -> Pitch`, eagerly load only projection dependencies, and use:

```python
local_start = datetime.combine(service_date, time.min, ZoneInfo("Asia/Shanghai"))
utc_start = local_start.astimezone(UTC)
utc_end = (local_start + timedelta(days=1)).astimezone(UTC)
```

Mask the decrypted phone with `PhoneVault.mask`; never return the decrypted value. Call the shared server action projector for every row with the current authorized venue actor and injected UTC clock.

- [ ] **Step 4: Expose the GET route and include the router**

Use the exact frozen path and query names. `service_date` remains optional so the service can default it from the injected server clock; keep `limit`/`cursor` bounds exactly aligned with OpenAPI. Include the router from `backend/app/main.py`; do not synthesize or patch OpenAPI at runtime.

- [ ] **Step 5: Run focused GREEN and commit**

```bash
TEST_DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test \
  uv run pytest backend/tests/test_venue_fulfillment.py backend/tests/test_venue_access_api.py backend/tests/test_order_list.py -q
uv run ruff check backend/app/modules/venue_fulfillment backend/tests/test_venue_fulfillment.py
git add backend/app/modules/venue_fulfillment backend/app/main.py backend/tests/test_venue_fulfillment.py
git diff --cached --check
git commit -m "feat: list venue fulfillment orders"
```

### Task 5: Add idempotent check-in and completion mutations

**Files:**

- Modify: `backend/app/modules/venue_fulfillment/dto.py`
- Modify: `backend/app/modules/venue_fulfillment/repository.py`
- Modify: `backend/app/modules/venue_fulfillment/service.py`
- Modify: `backend/app/modules/venue_fulfillment/router.py`
- Modify: `backend/tests/test_venue_fulfillment.py`

- [ ] **Step 1: Write failing boundary and idempotency tests**

Check-in cases:

- `CONFIRMED` becomes checked in exactly at `starts_at - 2h` and remains forbidden one microsecond earlier;
- the actor ID and UTC time are written as a pair, and slot remains `BOOKED`;
- same-key replay returns the first serialized result;
- a different key after successful check-in returns the same business result without changing time/actor;
- wrong venue, revoked permission, and unknown order share the safe 404;
- non-confirmed terminal/conflict states use the frozen 409 code.

Completion cases:

- requires `CONFIRMED`, the checked-in pair, and `now >= ends_at`;
- exact end time succeeds, one microsecond early returns `SESSION_NOT_ENDED`;
- missing check-in returns `CHECK_IN_REQUIRED`;
- writes `COMPLETED` and actor/time once, keeps slot `BOOKED`, and is business-idempotent with a different key;
- same key with a different order/body returns `IDEMPOTENCY_KEY_REUSED`.

- [ ] **Step 2: Run RED tests**

```bash
TEST_DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test \
  uv run pytest backend/tests/test_venue_fulfillment.py -q
```

Expected: FAIL on the missing mutation methods/routes.

- [ ] **Step 3: Implement the transaction template once**

For both operations:

1. resolve the authorized venue/order scope without leaking existence;
2. claim/lock the generic idempotency record using actor + operation + key and a canonical digest containing `venue_id`, `order_id`, and body;
3. acquire the business graph strictly through shared helpers in `Slot -> Order` order;
4. revalidate venue scope and membership under the transaction, then call the shared lifecycle policy for the locked facts and server time; do not restate its status/time matrix locally;
5. write only the named timestamp/actor fields (plus `Order.status=COMPLETED` for complete);
6. build the frozen response with the shared action projector;
7. complete idempotency and commit atomically; roll back any exception.

Use distinct operations such as `VENUE_CHECK_IN` and `VENUE_COMPLETE`; never treat a client clock or a previously rendered button as authorization.

- [ ] **Step 4: Add the exact POST routes**

Require `Idempotency-Key` with the frozen length constraints. Return the response/status already defined by static OpenAPI. Keep 404 for nonexistent-or-unauthorized and the closed 409 error codes for business conflicts.

- [ ] **Step 5: Run focused GREEN and commit**

```bash
TEST_DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test \
  uv run pytest backend/tests/test_venue_fulfillment.py backend/tests/test_booking_schema_constraints.py -q
uv run ruff check backend/app/modules/venue_fulfillment backend/tests/test_venue_fulfillment.py
git add backend/app/modules/venue_fulfillment backend/tests/test_venue_fulfillment.py
git diff --cached --check
git commit -m "feat: check in and complete venue orders"
```

## Chunk 3: Venue-reason full refund request orchestration

### Task 6: Request a venue refund and delegate authoritative convergence

**Files:**

- Create: `backend/app/modules/venue_fulfillment/refund.py`
- Modify: `backend/app/modules/venue_fulfillment/dto.py`
- Modify: `backend/app/modules/venue_fulfillment/repository.py`
- Modify: `backend/app/modules/venue_fulfillment/router.py`
- Create: `backend/tests/test_venue_fulfillment_refund.py`

- [ ] **Step 1: Write failing refund eligibility and audit tests**

Cover:

- an active authorized inventory manager may refund a `CONFIRMED`, not-checked-in order even inside 24 hours;
- reason whitespace is rejected, bounded normalized text is persisted, and the case records `ORDER_CANCELLATION`, `VENUE_CANCELLED`, requester, full amount, and `CNY`;
- only the successful payment with non-null `applied_to_order_at` can back the case;
- checked-in, completed, already refunded, wrong-venue, and missing-primary-payment orders cannot start a new refund;
- an existing active/success case is reused and never creates a duplicate case or active attempt;
- an existing `FAILED` case may create the next sequential attempt with a new stable <=32-character merchant refund number;
- case/attempt creation and retry call the foundation `RefundRepository` purpose predicate rather than reproducing the applied-payment decision locally;
- same-key replay returns the original business response; same key/different normalized reason or resource returns 409.

- [ ] **Step 2: Write failing ownership/provider/delegation boundary tests**

Use a fake implementation of the shared `RefundProvider` and a spy/stub for the Provider-track shared convergence service, never a mock production adapter or a venue-local convergence implementation. Cover:

- request preparation commits `REFUND_PENDING` and the attempt before provider I/O;
- the fake provider can inspect PostgreSQL and prove no business row lock/transaction remains during `create_refund`;
- venue cancellation closes the owned slot at acceptance only when the foundation `RefundRepository` returns inventory-mutation authority, and never makes it `AVAILABLE`;
- absent shared ownership proof leaves the slot unchanged; the venue repository contains no parallel inventory predicate;
- each provider protocol result is passed unchanged, with the durable attempt identity, to the injected shared convergence service exactly once;
- the venue module does not inspect authoritative success fields or directly write `REFUNDED`, `REFUND_FAILED`, terminal attempt facts, or any `SUCCESS | FAILED | UNKNOWN` convergence outcome;
- returned order/actions come from the shared convergence result plus shared action projector, not a venue-local terminal-state matrix;
- a provider protocol `UNKNOWN`/transport-uncertain result is delegated unchanged, and an endpoint retry reuses the same attempt and merchant refund number rather than creating another external refund;
- an unavailable injected provider returns the frozen 503 before creating a case/attempt;
- database failures roll back and expose no provider or private error text.

- [ ] **Step 3: Run RED tests**

```bash
TEST_DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test \
  uv run pytest backend/tests/test_venue_fulfillment_refund.py -q
```

Expected: FAIL because `refund.py` and the route are absent.

- [ ] **Step 4: Prepare the durable request through shared repository authority**

Normalize/hash the body, claim idempotency, then use the foundation helpers to lock:

```text
Slot -> Order -> applied Payment -> RefundCase -> latest RefundAttempt
```

Recheck venue authorization inside the transaction, then ask the shared lifecycle policy and `RefundRepository` purpose predicate to decide eligibility and the applied payment. Reuse or create the one payment-bound `ORDER_CANCELLATION` case; create a new attempt only when the shared repository permits retry after an explicitly `FAILED` latest attempt. Set only the non-terminal request/cancellation state, and close the slot only from the shared repository's locked ownership proof. Commit before returning the provider request descriptor. Do not recreate any purpose or inventory predicate in `venue_fulfillment/repository.py`.

- [ ] **Step 5: Integrate the Provider-track convergence authority**

Before implementing the call boundary, merge the Provider-track integration commit that owns `backend/app/modules/refunds/convergence.py`, its tests, and the refund worker, keeping that external SHA as an ancestor, and record it as `<provider-convergence-sha>` in the acceptance document. Confirm that it exposes the shared entry point for converging a provider result by durable attempt identity. If that entry point is absent or requires the venue module to validate authoritative facts or choose terminal states, stop and return an integration prerequisite; do not add a local protocol or convergence helper.

- [ ] **Step 6: Call the provider outside the transaction and delegate the result**

`VenueRefundService` receives an injected shared `RefundProvider` and the Provider-track convergence service. After the durable request transaction commits, call `create_refund()`/`query_refund()` and pass the exact returned protocol result plus durable attempt identity to shared convergence. Use its returned durable order/attempt outcome to finish the endpoint's idempotency record and project the response. Do not import or instantiate a WeChat HTTP adapter, signer, credential loader, callback handler, or worker; do not reopen the graph to validate facts or write terminal refund state in this module.

- [ ] **Step 7: Expose the refund route and run GREEN**

The route accepts only the frozen non-empty reason body and `Idempotency-Key`, injects the existing provider and shared convergence service from application state, and serializes the service's frozen response/status. Its tests may spy on convergence delegation but must rely on `backend/app/modules/refunds/convergence.py` tests for authoritative fact matching, `SUCCESS | FAILED | UNKNOWN` terminal rules, worker recovery, and non-regression.

```bash
TEST_DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test \
  uv run pytest backend/tests/test_venue_fulfillment_refund.py backend/tests/test_venue_fulfillment.py \
  backend/tests/test_refund_convergence.py backend/tests/test_payment_concurrency.py -q
uv run ruff check backend/app/modules/venue_fulfillment backend/tests/test_venue_fulfillment_refund.py
git add backend/app/modules/venue_fulfillment backend/tests/test_venue_fulfillment_refund.py
git diff --cached --check
git commit -m "feat: request venue order refunds"
```

## Chunk 4: Production Mini Program data path

### Task 7: Add closed decoders, authenticated HTTP, and uncertain-write recovery

**Files:**

- Create: `miniprogram/domain/venue-fulfillment.ts`
- Create: `miniprogram/domain/venue-fulfillment.test.ts`
- Create: `miniprogram/services/venue-fulfillment.ts`
- Create: `miniprogram/services/http-venue-fulfillment.ts`
- Create: `miniprogram/services/http-venue-fulfillment.test.ts`
- Create: `miniprogram/services/venue-fulfillment-attempt-store.ts`
- Create: `miniprogram/services/venue-fulfillment-attempt-store.test.ts`
- Create: `miniprogram/presentation/venue-fulfillment.ts`
- Create: `miniprogram/presentation/venue-fulfillment.test.ts`

- [ ] **Step 1: Write failing closed-decoder tests**

Test the frozen list/order/contact/action/timestamp variants, pagination, and mutation results. Reject missing/extra/private fields, unknown status/action/blocked-reason values, full unmasked phone values, invalid action combinations, and contradictory completion/check-in timestamps.

- [ ] **Step 2: Write failing HTTP/auth tests**

Cover:

- bearer GET with optional `service_date`, `limit`, and encoded cursor;
- check-in/complete POST with `{}` and refund POST with `{ reason }`;
- original `Idempotency-Key` on every mutation and replay;
- one 401 re-login using the shared session store, then a single retry;
- 404 privacy error, closed 409 error mapping, and 503 display error;
- network timeout/5xx/malformed success after a write becomes `FULFILLMENT_RESULT_UNKNOWN`, never success or ordinary failure;
- a read failure remains retryable and is never relabeled as empty.

- [ ] **Step 3: Write failing attempt-store tests**

Persist a closed union containing operation, venue/order IDs, normalized refund body when applicable, and original key. Validate on read; clear corrupted/version-mismatched data. Do not persist contact data, response bodies, or bearer tokens.

- [ ] **Step 4: Implement the minimal domain, service, and presentation boundaries**

The page-facing port should be equivalent to:

```ts
interface VenueFulfillmentDataSource {
  login(): Promise<void>;
  listOrders(venueId: string, serviceDate?: string, cursor?: string): Promise<VenueFulfillmentPage>;
  checkIn(attempt: CheckInAttempt): Promise<VenueFulfillmentOrder>;
  complete(attempt: CompleteAttempt): Promise<VenueFulfillmentOrder>;
  refund(attempt: RefundAttempt): Promise<VenueFulfillmentOrder>;
}
```

Presentation maps only closed server values to Chinese copy. It may shift the server-returned `serviceDate` by one day for adjacent-date navigation; it must not calculate eligibility or render an action from local time/role/status heuristics.

- [ ] **Step 5: Run focused GREEN and commit**

```bash
npx jest \
  miniprogram/domain/venue-fulfillment.test.ts \
  miniprogram/services/http-venue-fulfillment.test.ts \
  miniprogram/services/venue-fulfillment-attempt-store.test.ts \
  miniprogram/presentation/venue-fulfillment.test.ts \
  --runInBand
npm run typecheck
git add miniprogram/domain miniprogram/services miniprogram/presentation
git diff --cached --check
git commit -m "feat: add venue fulfillment client port"
```

### Task 8: Build the production venue fulfillment page and real workbench entry

**Files:**

- Create: `miniprogram/pages/venue-fulfillment/index.ts`
- Create: `miniprogram/pages/venue-fulfillment/index.wxml`
- Create: `miniprogram/pages/venue-fulfillment/index.wxss`
- Create: `miniprogram/pages/venue-fulfillment/index.json`
- Create: `miniprogram/pages/venue-fulfillment/index.test.ts`
- Modify: `miniprogram/pages/venue-profile/index.ts`
- Modify: `miniprogram/pages/venue-profile/index.wxml`
- Modify: `miniprogram/pages/venue-profile/index.wxss`
- Modify: `miniprogram/pages/venue-profile/index.test.ts`
- Modify: `miniprogram/app.json`
- Modify: `miniprogram/dev/bootstrap.ts`
- Modify: `scripts/build-miniprogram.mjs`
- Modify: `scripts/audit-production-package.mjs`
- Modify: `tests/build-miniprogram.test.mjs`
- Modify: `tests/audit-production-package.test.mjs`

- [ ] **Step 1: Write failing page-controller tests**

Cover initial login/load, default server date, previous/today/next navigation from the response date, stale request suppression, retry, pull refresh, pagination, unload cancellation, and distinct loading/error/empty/ready/load-more-error states.

For actions, assert:

- WXML creates a button only when the matching `allowedActions.can*` is true; blocked actions render ordinary explanatory views, not empty/disabled click handlers;
- check-in and complete require an explicit confirmation, then store/send one attempt and replace the card from the server response;
- refund opens one labelled sheet, trims and requires the reason, preserves it during an uncertain result, and uses the original key on retry;
- a mutation disables only its active controls with centered progress copy and prevents duplicate taps;
- an uncertain result refreshes authority first; if the returned timestamps/status prove application, clear the attempt, otherwise offer replay with the same key;
- every visible enabled button has a real handler and every handler reaches the data-source port or navigation.

- [ ] **Step 2: Write failing entry/composition/isolation tests**

Require a fourth “今日订单” workbench entry that navigates to `/pages/venue-fulfillment/index?venue_id=<id>`. Change the profile workbench grid to two columns/two rows so every entry remains at least 88rpx and readable; do not squeeze four labels into the current three-column geometry.

Require the production app/build/audit to include the four native page artifacts, register `createHttpVenueFulfillmentDataSource` and the attempt store before `App({})`, and reject `VENUE_FULFILLMENT_FIXTURE`, `dev/pages/venue-fulfillment`, or development fallback data from production.

- [ ] **Step 3: Implement the production page**

Reuse the approved preview hierarchy and existing header/tokens. Keep one scrollable order list and one modal refund sheet. Cards show only contract fields. Use text plus color for status; make pressed states stable; explicitly center all button labels; reserve bottom safe area. Do not add a local search box, QR scanner, report summary, bulk action, or client-side eligibility logic.

- [ ] **Step 4: Wire both runtime compositions**

Production and development HTTP mode register the real HTTP data source using the existing production transport, identity, and session store. Fixture mode alone registers `VENUE_FULFILLMENT_FIXTURE`. Production stores uncertain attempts in `productionSessionStorage`; it never imports a development module.

- [ ] **Step 5: Run focused GREEN and package isolation**

```bash
npx jest \
  miniprogram/pages/venue-fulfillment/index.test.ts \
  miniprogram/pages/venue-profile/index.test.ts \
  miniprogram/domain/venue-fulfillment.test.ts \
  miniprogram/services/http-venue-fulfillment.test.ts \
  --runInBand
npm run typecheck
npm run build:miniprogram:development
MINIPROGRAM_TENCENT_MAP_KEY=AAAAA-BBBBB-CCCCC-DDDDD-EEEEE-FFFFF \
  npm run build:miniprogram:production
npm run audit:miniprogram-package
node --test tests/build-miniprogram.test.mjs tests/audit-production-package.test.mjs \
  tests/venue-order-fulfillment-native-preview.test.mjs
```

Expected: PASS; production includes the real route/data source and no Fixture route/token/data.

- [ ] **Step 6: Commit**

```bash
git add miniprogram scripts/build-miniprogram.mjs scripts/audit-production-package.mjs \
  tests/build-miniprogram.test.mjs tests/audit-production-package.test.mjs
git diff --cached --check
git commit -m "feat: operate venue fulfillment orders"
```

## Chunk 5: Focused integration, native smoke check, and Fixture deletion

### Task 9: Verify the real HTTP journey in proportion to risk

**Files:**

- Modify: `backend/tests/test_venue_fulfillment.py`
- Modify: `backend/tests/test_venue_fulfillment_refund.py`
- Modify: `miniprogram/services/http-venue-fulfillment.test.ts`
- Create: `docs/acceptance/venue-order-fulfillment-progress.md`

- [ ] **Step 1: Run the focused PostgreSQL and client suites**

```bash
TEST_DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test \
  uv run pytest \
    backend/tests/test_venue_fulfillment.py \
    backend/tests/test_venue_fulfillment_refund.py \
    backend/tests/test_refund_convergence.py \
    backend/tests/test_order_list.py \
    backend/tests/test_payment_concurrency.py \
    -q
npx jest \
  miniprogram/domain/venue-fulfillment.test.ts \
  miniprogram/services/http-venue-fulfillment.test.ts \
  miniprogram/services/venue-fulfillment-attempt-store.test.ts \
  miniprogram/presentation/venue-fulfillment.test.ts \
  miniprogram/pages/venue-fulfillment/index.test.ts \
  miniprogram/pages/venue-profile/index.test.ts \
  --runInBand
```

Expected: PASS. Do not broaden to fuzzing or unrelated full-state visual capture.

- [ ] **Step 2: Exercise one local/staging authorized journey**

With an authorized venue user and prepared orders, verify:

1. the production page loads only the selected venue/date and masks contact phone;
2. too-early check-in is rejected by the server without a false success;
3. an eligible order checks in once, then completes once after an injected/test end time;
4. venue refund reason reaches the server, creates exactly one full-amount case/attempt with the slot `CLOSED` when owned, and delegates the fake provider result once to shared convergence;
5. missing refund-provider configuration returns the frozen 503 without mutation.

Use a fake provider only in local/integration tests. Do not make a real WeChat funds call in this slice.

- [ ] **Step 3: Record the external adapter completion gate honestly**

Record `<provider-convergence-sha>` separately from real adapter availability; shared convergence is required for Task 6 even when the real adapter remains unavailable. The venue refund business flow is not production-complete until the separate real-WeChat-adapter work is integrated and configured. Record one of:

- `real adapter pending`: page/API and shared convergence are production code, check-in/complete work, refund returns honest unavailable behavior; or
- `real adapter integrated by <adapter SHA>`: one controlled adapter-owned full-refund acceptance is referenced.

Never claim real refund acceptance from the fake provider.

- [ ] **Step 4: Perform one production-page native smoke check**

At 375×812, open the HTTP-backed production route and compare it to the approved Fixture screenshot. Check actual venue/order copy, button centering, aligned status chips/actions, icon completeness, clipping, scroll behavior, refund sheet, and bottom safe area. This is one representative real-runtime check, not a second full visual campaign.

### Task 10: Delete the Fixture and run final focused verification

**Files:**

- Delete: `miniprogram/dev/venue-fulfillment-fixture.ts`
- Delete: `miniprogram/dev/pages/venue-fulfillment/index.ts`
- Delete: `miniprogram/dev/pages/venue-fulfillment/index.wxml`
- Delete: `miniprogram/dev/pages/venue-fulfillment/index.wxss`
- Delete: `miniprogram/dev/pages/venue-fulfillment/index.json`
- Delete: `miniprogram/dev/pages/venue-fulfillment/index.test.ts`
- Modify: `miniprogram/dev/app-pages.json`
- Modify: `miniprogram/dev/bootstrap.ts`
- Modify: `tests/venue-order-fulfillment-native-preview.test.mjs`
- Modify: `tests/build-miniprogram.test.mjs`
- Modify: `artifacts/ui/reviews/venue-order-fulfillment/README.md`
- Modify: `docs/acceptance/venue-order-fulfillment-progress.md`
- Modify: `docs/superpowers/plans/2026-08-16-overall-slice-roadmap.md`

- [ ] **Step 1: Change the isolation test to require Fixture deletion**

The focused Node test should now require the production route and reject every former dev file/route/token from both source composition and production output.

- [ ] **Step 2: Remove only the temporary Fixture assets**

Keep the reference, approved native screenshot, comparison evidence, production page, production HTTP source, and tests. Remove the temporary development data/page/route and Fixture-mode registration.

- [ ] **Step 3: Run final checks**

```bash
npm run contract:validate
npm run typecheck
npx jest \
  miniprogram/domain/venue-fulfillment.test.ts \
  miniprogram/services/http-venue-fulfillment.test.ts \
  miniprogram/services/venue-fulfillment-attempt-store.test.ts \
  miniprogram/presentation/venue-fulfillment.test.ts \
  miniprogram/pages/venue-fulfillment/index.test.ts \
  miniprogram/pages/venue-profile/index.test.ts \
  --runInBand
TEST_DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test \
  uv run pytest backend/tests/test_venue_fulfillment.py backend/tests/test_venue_fulfillment_refund.py \
  backend/tests/test_refund_convergence.py -q
MINIPROGRAM_TENCENT_MAP_KEY=AAAAA-BBBBB-CCCCC-DDDDD-EEEEE-FFFFF \
  npm run build:miniprogram:production
npm run audit:miniprogram-package
node --test tests/venue-order-fulfillment-native-preview.test.mjs \
  tests/build-miniprogram.test.mjs tests/audit-production-package.test.mjs
uv run ruff check backend/app/modules/venue_fulfillment \
  backend/tests/test_venue_fulfillment.py backend/tests/test_venue_fulfillment_refund.py
git diff --check
```

Expected: PASS. Verify the final diff still has no changes to shared enums/models/migration/OpenAPI, lifecycle/refund authorities, Provider convergence/worker, or real adapter:

Use the Provider convergence commit as the comparison tree so externally owned Provider files do not appear merely because that track was integrated:

```bash
git diff --name-only <provider-convergence-sha>...HEAD -- \
  backend/app/models.py backend/migrations/versions/0013_order_lifecycle.py contracts/openapi.yaml \
  backend/app/modules/orders/locking.py backend/app/modules/orders/lifecycle.py \
  backend/app/modules/orders/dto.py backend/app/modules/orders/repository.py \
  backend/app/modules/orders/service.py backend/app/modules/orders/router.py \
  backend/app/modules/refunds
```

Expected: no output from the `<provider-convergence-sha>` command. Record both the foundation and Provider convergence SHAs in the acceptance document; `<provider-convergence-sha>` must be the external Provider-track ancestor integrated in Task 6, not a commit created by this venue track.

- [ ] **Step 4: Commit the cleanup and acceptance record**

```bash
git add -A miniprogram/dev miniprogram/dev/app-pages.json \
  tests/venue-order-fulfillment-native-preview.test.mjs tests/build-miniprogram.test.mjs \
  artifacts/ui/reviews/venue-order-fulfillment \
  docs/acceptance/venue-order-fulfillment-progress.md \
  docs/superpowers/plans/2026-08-16-overall-slice-roadmap.md
git diff --cached --check
git commit -m "test: close venue fulfillment slice"
```

## Completion definition

The slice is complete only when:

- the active venue/membership/capability predicate protects every read and write with safe 404 privacy;
- list date, pagination, contact masking, and action buttons are server-authoritative;
- check-in and completion satisfy exact time/state rules, are idempotent, and keep historical slots `BOOKED`;
- venue refund stores a non-empty reason, uses the main full payment selected by the shared repository, follows the shared lock order, performs provider I/O outside transactions, delegates the exact result to Provider-owned shared convergence, and never releases a venue-cancelled slot;
- the production Mini Program has no inert button, local action guess, development fallback, or Fixture data;
- the one representative native visual is approved by the user or a user-authorized independent reviewer, and the temporary Fixture is deleted;
- real provider availability is reported honestly; a fake provider is never cited as real-WeChat refund acceptance;
- shared lifecycle policy/projection, refund repository predicates, `0013_order_lifecycle.py`, protocols, OpenAPI schemas, Provider convergence/worker, and real WeChat adapter remain untouched by this slice.
