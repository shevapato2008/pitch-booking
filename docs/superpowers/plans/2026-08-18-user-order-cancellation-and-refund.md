# User Order Cancellation and Refund Implementation Plan

> **For agentic workers:** REQUIRED: Use `superpowers:subagent-driven-development` (if subagents are available) or `superpowers:executing-plans` to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让订单所有者从真实小程序安全取消订单，并在订单详情和“我的订单”中看到服务端权威的取消与退款状态。

**Architecture:** 本切片只实现 owner cancellation operation：消费共享 `orders/lifecycle.py` policy、现有详情/列表投影和共享 `RefundRepository`，在一个安全事务内完成无资金待支付取消，或创建/重试 durable `ORDER_CANCELLATION` case/attempt。它不实现退款 Provider 调用、退款终态收敛、自动重复扣款/库存冲突 case、worker 或共享投影；生产小程序只依据服务端 `status`、`allowed_actions` 和 `blocked_reason` 渲染状态与真实动作。

**Tech Stack:** FastAPI、SQLAlchemy 2、PostgreSQL、Pytest、微信小程序 TypeScript/WXML/WXSS、Jest、现有 production build/audit。

**Design:** `docs/superpowers/specs/2026-08-18-order-lifecycle-and-refund-design.md`；延续 `docs/superpowers/specs/2026-08-18-my-orders-design.md` 已确认的 375×812 视觉系统。

---

## Chunk 1：Owner cancellation operation and Mini Program integration

### Scope、串行前置与文件所有权

共享 lifecycle foundation 必须先合并，并独占以下边界；本计划只验证、消费，不修改：

- `backend/app/models.py` 中订单/退款状态、时间戳、`Payment.applied_to_order_at`、`RefundCase`、`RefundAttempt`；
- `backend/migrations/versions/0013_order_lifecycle.py`；
- `backend/app/modules/orders/lifecycle.py` 的纯 policy，包括 owner action、24 小时边界、状态—时间戳和共享 blocked reason；
- `backend/app/modules/orders/repository.py`、`backend/app/modules/orders/service.py`、`backend/app/modules/orders/dto.py` 的现有 list/detail runtime projection；
- `backend/app/modules/refunds/repository.py` 的共享锁顺序、case/attempt identity、purpose 与 inventory ownership predicates；
- `backend/app/modules/payments/convergence.py` 写入且保护 `Payment.applied_to_order_at`；
- `contracts/openapi.yaml`、`contracts/examples/*`、`scripts/validate-contract.mjs` 的共享 schema、operation 和错误码。

WeChat Provider 轨道独占以下边界；本计划不得创建、修改或测试其实现：

- `backend/app/modules/refunds/convergence.py` 和退款 create/query/recovery orchestration；
- refund worker、租约、通知、真实 WeChat adapter、证书/配置和 production composition；
- `DUPLICATE_CHARGE` / `PAYMENT_INVENTORY_CONFLICT` 自动 case；
- 权威 `SUCCESS / FAILED / UNKNOWN` 退款终态及退款成功后的 slot 修改；
- 支付—取消—退款全链路竞态和 Provider I/O 锁外证明。

本计划的 owner service 只做两类写入：

1. 待支付且不存在任何可能已付款记录时，本地写 `CANCELLED` 并只释放仍由该订单持有的 `LOCKED` slot；
2. 其他允许的 owner cancellation，写入取消请求并创建或重试 durable `ORDER_CANCELLATION` case/attempt，返回共享投影的 `REFUND_PENDING` 或支付结果待确认状态，等待 Provider 轨道继续处理。

真实 paid refund 不在本计划模拟。Provider 轨道未合并前，不把已支付取消标记为端到端完成，不向 production composition 注册 Mock，不主动制造一笔无法真实退回的设备支付。

Root 集成协调任务串行独占中央小程序注册、路由汇总、build/audit 规则与最终 Fixture 删除。本 slice 不修改 `miniprogram/dev/bootstrap.ts`、`miniprogram/dev/app-pages.json`、`miniprogram/app.json`、`miniprogram/dev/payment-source.ts`、`miniprogram/dev/my-orders-fixture.ts`、`scripts/build-miniprogram.mjs`、`scripts/audit-production-package.mjs` 或对应中央测试；只提交可合并的 slice-local route/token fragment。Root 必须先合并所有活动 slice，再添加式汇总中央注册；清理前必须验证不会移除其他 slice 的路由或 token。

### Exact file map

**Backend create:**

- `backend/app/modules/orders/cancellation.py`：owner cancel command service；只调用共享 lifecycle policy 和 `RefundRepository`。
- `backend/tests/test_order_cancellation.py`：owner 隔离、幂等、无资金取消、durable case/attempt 和 retry 的聚焦 PostgreSQL/API 测试。

**Backend modify:**

- `backend/app/modules/orders/router.py`：添加上游 OpenAPI 已冻结的 `POST /api/v1/orders/{order_id}/cancel` route；不添加 runtime schema patch。

**Backend verify only:**

- `backend/app/modules/orders/lifecycle.py`
- `backend/app/modules/orders/repository.py`
- `backend/app/modules/orders/service.py`
- `backend/app/modules/orders/dto.py`
- `backend/app/modules/refunds/repository.py`
- `backend/app/modules/payments/convergence.py`
- `backend/tests/test_order_lifecycle.py`
- `backend/tests/test_order_detail.py`
- `backend/tests/test_order_list.py`
- `backend/tests/test_refund_repository.py`
- `backend/tests/test_openapi_conformance.py`

**Mini Program create:**

- `miniprogram/dev/order-cancellation-fixture.ts`：临时、集中、development-only 的取消/退款视觉状态与真实本地 transitions。
- `miniprogram/dev/order-cancellation-fixture.test.ts`：Fixture isolation 和 transition 测试。
- `miniprogram/dev/order-cancellation-route-fragment.ts`：slice-local 的预览路由和 development-only token 声明，供 root 集成添加式汇总。
- `miniprogram/dev/order-cancellation-route-fragment.test.ts`：验证 fragment 只声明本 slice 所需页面/token，且无重复、绝对路径或越界注册。
- `artifacts/ui/reviews/order-cancellation/README.md`：两个代表性 375×812 预览的自审和授权确认记录。
- `docs/acceptance/user-order-cancellation-and-refund-progress.md`：自动化、设备验收和 Provider 外部 release gate。

**Mini Program modify:**

- `miniprogram/domain/booking.ts`
- `miniprogram/domain/decoders.ts`
- `miniprogram/domain/decoders.test.ts`
- `miniprogram/services/booking.ts`
- `miniprogram/services/http-booking.ts`
- `miniprogram/services/http-booking.test.ts`
- `miniprogram/presentation/order-detail.ts`
- `miniprogram/presentation/order-detail.test.ts`
- `miniprogram/presentation/my-orders.ts`
- `miniprogram/presentation/my-orders.test.ts`
- `miniprogram/pages/order-detail/index.ts`
- `miniprogram/pages/order-detail/index.wxml`
- `miniprogram/pages/order-detail/index.wxss`
- `miniprogram/pages/order-detail/index.test.ts`
- `miniprogram/pages/my-orders/index.ts`
- `miniprogram/pages/my-orders/index.wxml`
- `miniprogram/pages/my-orders/index.wxss`
- `miniprogram/pages/my-orders/index.test.ts`

**Root integration modify/delete only:**

- `miniprogram/dev/bootstrap.ts`
- `miniprogram/dev/app-pages.json`
- `miniprogram/app.json`
- `miniprogram/dev/payment-source.ts`
- `miniprogram/dev/payment-source.test.ts`
- `miniprogram/dev/my-orders-fixture.ts`
- `miniprogram/dev/pages/my-orders/index.test.ts`
- `scripts/build-miniprogram.mjs`
- `scripts/audit-production-package.mjs`
- `tests/build-miniprogram.test.mjs`
- `tests/audit-production-package.test.mjs`
- `tests/production-package-booking-audit.test.mjs`
- 所有活动 slice 的临时 Fixture 和 route fragment。

---

### Task 0：验证共享基础，不在 owner 轨道复制 policy/repository/projection

**Files:**

- Verify only: `backend/app/models.py`
- Verify only: `backend/migrations/versions/0013_order_lifecycle.py`
- Verify only: `backend/app/modules/orders/lifecycle.py`
- Verify only: `backend/app/modules/orders/repository.py`
- Verify only: `backend/app/modules/orders/service.py`
- Verify only: `backend/app/modules/orders/dto.py`
- Verify only: `backend/app/modules/refunds/repository.py`
- Verify only: `backend/app/modules/payments/convergence.py`
- Verify only: `contracts/openapi.yaml`

- [ ] **Step 1: Merge only the green shared-foundation commit**

Record the exact foundation SHA in the implementation handoff. Do not copy files from another worktree and do not begin owner work while the migration or shared contract is still changing.

- [ ] **Step 2: Assert the upstream symbols and ownership**

```bash
rg -n "CANCELLED|REFUND_PENDING|REFUND_FAILED|REFUNDED|COMPLETED|cancel_requested_at|applied_to_order_at|class RefundCase|class RefundAttempt" backend/app/models.py
rg -n "owner|24|allowed_actions|blocked_reason|cancell" backend/app/modules/orders/lifecycle.py
rg -n "class RefundRepository|ORDER_CANCELLATION|purpose|inventory|lock" backend/app/modules/refunds/repository.py
rg -n "applied_to_order_at" backend/app/modules/payments/convergence.py
rg -n "/api/v1/orders/\{order_id\}/cancel|allowed_actions|blocked_reason" contracts/openapi.yaml backend/app/modules/orders/dto.py
```

Expected: every shared responsibility has one upstream implementation. In particular, this branch must not need a new `orders/actions.py`, a second `RefundRepository`, a second runtime list/detail projector or an applied-marker write.

- [ ] **Step 3: Run the focused foundation checks**

```bash
npm run contract:validate
TEST_DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test \
  uv run pytest \
    backend/tests/test_order_lifecycle.py \
    backend/tests/test_refund_repository.py \
    backend/tests/test_order_detail.py \
    backend/tests/test_order_list.py \
    backend/tests/test_openapi_conformance.py -q
```

Expected: PASS before any owner-operation edit.

- [ ] **Step 4: Confirm the production copy is already truthful upstream**

The shared runtime projection must return:

```text
开场前至少 24 小时可自助取消并全额退款；不足 24 小时请联系客服。
```

If the upstream projection still promises a 50% refund, stop and report the shared-foundation prerequisite as blocked. Do not patch `orders/service.py`, fix the foundation from this branch or create a second frontend rule.

Do not commit at this gate.

---

### Task 1：用隔离 Fixture 完成生产页面状态/动作和最小视觉确认

**Files:**

- Create: `miniprogram/dev/order-cancellation-fixture.ts`
- Create: `miniprogram/dev/order-cancellation-fixture.test.ts`
- Create: `miniprogram/dev/order-cancellation-route-fragment.ts`
- Create: `miniprogram/dev/order-cancellation-route-fragment.test.ts`
- Modify: `miniprogram/domain/booking.ts`
- Modify: `miniprogram/services/booking.ts`
- Modify: `miniprogram/presentation/order-detail.ts`
- Modify: `miniprogram/presentation/order-detail.test.ts`
- Modify: `miniprogram/presentation/my-orders.ts`
- Modify: `miniprogram/presentation/my-orders.test.ts`
- Modify: `miniprogram/pages/order-detail/index.ts`
- Modify: `miniprogram/pages/order-detail/index.wxml`
- Modify: `miniprogram/pages/order-detail/index.wxss`
- Modify: `miniprogram/pages/order-detail/index.test.ts`
- Modify: `miniprogram/pages/my-orders/index.ts`
- Modify: `miniprogram/pages/my-orders/index.wxml`
- Modify: `miniprogram/pages/my-orders/index.wxss`
- Modify: `miniprogram/pages/my-orders/index.test.ts`
- Create: `artifacts/ui/reviews/order-cancellation/README.md`

- [ ] **Step 1: Write RED presentation/page tests**

Consume the upstream fields exactly:

```ts
export interface AllowedOrderActions {
  readonly canPay: boolean;
  readonly canCancel: boolean;
  readonly canCheckIn: boolean;
  readonly canComplete: boolean;
  readonly canRefund: boolean;
  readonly blockedReason: OrderActionBlockedReason | null;
}
```

Cover only the changed behavior:

1. `PENDING_PAYMENT + can_cancel` has a real secondary “取消订单” action; pay appears only when `can_pay=true`.
2. pending payment with a cancel request displays “正在确认取消”, renders no pay/cancel button and uses authoritative refresh/polling.
3. eligible `CONFIRMED + can_cancel` confirms “取消并发起全额退款”, never promises an immediate refund or slot release.
4. `REFUND_PENDING` has no destructive action; `REFUND_FAILED + can_cancel` shows “重试退款”; `CANCELLED / REFUNDED / COMPLETED` are terminal ordinary views.
5. duplicate taps issue one request; hide/unload invalidates a late result.
6. an unknown network result keeps the same idempotency key and offers “确认取消结果”; a definitive business conflict clears it.
7. list cards display `正在确认取消 / 已取消 / 退款处理中 / 退款失败 / 已退款 / 已完成`; the whole card remains the only list button and opens detail.

```bash
npx jest \
  miniprogram/presentation/order-detail.test.ts \
  miniprogram/presentation/my-orders.test.ts \
  miniprogram/pages/order-detail/index.test.ts \
  miniprogram/pages/my-orders/index.test.ts \
  --runInBand
```

Expected: RED because the expanded states and cancel data-source operation are absent.

- [ ] **Step 2: Implement only the fixture-driven page boundary**

`order-cancellation-fixture.ts` owns immutable development transitions:

```text
pending-cancellable → cancelling → cancelled
confirmed-cancellable → refund-pending
refund-failed → refund-pending
```

It may expose read-only terminal `refunded/completed` fixtures to prove presentation, but it must not simulate Provider behavior or import into production composition. Production page code depends only on `BookingDataSource`.

`order-cancellation-route-fragment.ts` declares only the existing `pages/order-detail/index` and `pages/my-orders/index` preview routes plus this fixture's development-only import/token. It is merge input, not a second app manifest: this slice must not edit central bootstrap, `app-pages.json`, build or audit files.

Confirmation copy:

```text
待支付：确认取消订单？ / 若尚未付款，取消成功后将释放当前场次。
已确认：确认取消并发起退款？ / 将提交一笔全额退款申请，结果以服务端为准。
退款失败：重试退款？ / 将继续处理同一笔全额退款，不会重复扣款。
```

Use the existing light system, 4/8px rhythm, 88rpx touch targets, explicit flex centering, text plus semantic color, existing icon style and safe-area padding. Do not add a new theme or full Artifact set.

- [ ] **Step 3: Run focused GREEN checks and commit the slice-local preview handoff**

```bash
npx jest \
  miniprogram/dev/order-cancellation-fixture.test.ts \
  miniprogram/dev/order-cancellation-route-fragment.test.ts \
  miniprogram/presentation/order-detail.test.ts \
  miniprogram/presentation/my-orders.test.ts \
  miniprogram/pages/order-detail/index.test.ts \
  miniprogram/pages/my-orders/index.test.ts \
  --runInBand
npm run typecheck
```

Expected: PASS; the fragment is valid and production sources import no development module. Do not patch central registration merely to make the slice preview boot.

```bash
git add \
  miniprogram/domain/booking.ts \
  miniprogram/services/booking.ts \
  miniprogram/presentation \
  miniprogram/pages/order-detail \
  miniprogram/pages/my-orders \
  miniprogram/dev/order-cancellation-fixture.ts \
  miniprogram/dev/order-cancellation-fixture.test.ts \
  miniprogram/dev/order-cancellation-route-fragment.ts \
  miniprogram/dev/order-cancellation-route-fragment.test.ts
git diff --cached --check
git commit -m "feat: preview user order cancellation"
```

- [ ] **Step 4: Perform the proportional visual pass**

Hand the committed fragment/fixture to the root integration coordinator. Only after every active slice's preview handoff commit is available, root merges those commits and additively composes the central development registration; at exactly 375×812 in WeChat DevTools, capture only:

- one eligible confirmed detail with the cancel action and safe footer;
- one mixed list with refund-pending, refunded and refund-failed cards.

Compare detail geometry with `artifacts/ui/reviews/payment-confirmation/reference-confirmed-375x812.png` and list geometry with `artifacts/ui/reviews/my-orders/ready-reference-375x812.png`. Generate one side-by-side, 50% overlay and difference image per page and record intentional changes in `artifacts/ui/reviews/order-cancellation/README.md`.

Manually check button text dual-axis centering, badge consistency, chevrons, clipping, fixed footer/safe area, exact copy and honest non-button states. Do one iPhone 14 Pro safe-area smoke check without adding another Artifact matrix.

Before recording approval, root compares the post-merge route/token inventory with the union of every active slice fragment and verifies no existing route/token disappeared.

- [ ] **Step 5: Record an authorized visual decision and commit**

Before Task 2, record either:

- the user's explicit confirmation; or
- during the user's previously authorized sleep period, an independent visual reviewer's approve/reject decision, reviewer identity, viewport and reviewed evidence paths.

An authorized independent approval satisfies this gate; do not block solely waiting for the sleeping user and do not falsely record it as direct user approval.

```bash
git add artifacts/ui/reviews/order-cancellation
git diff --cached --check
git commit -m "docs: approve owner cancellation preview"
```

---

### Task 2：实现无资金待支付取消和 owner-only 幂等 API

**Files:**

- Create: `backend/app/modules/orders/cancellation.py`
- Create: `backend/tests/test_order_cancellation.py`
- Modify: `backend/app/modules/orders/router.py`
- Consume only: `backend/app/modules/orders/lifecycle.py`
- Consume only: `backend/app/modules/orders/repository.py`
- Consume only: `backend/app/modules/refunds/repository.py`

- [ ] **Step 1: Write PostgreSQL/API RED tests**

Use the real isolated PostgreSQL fixture. Cover:

- no bearer, invalid bearer, missing order and another owner's order;
- pending order with no `CREATING | PREPAY_CREATED | CONFIRMING | UNKNOWN | SUCCESS` payment becomes `CANCELLED`, writes shared-policy-valid timestamps and releases only its own `LOCKED` slot;
- pending order with only `CLOSED` payments is safe to cancel locally;
- active/maybe-paid payment writes only `cancel_requested_at`, keeps order pending and slot locked, and returns the shared 202 projection;
- local cancellation never releases an `AVAILABLE`, `CLOSED`, `BOOKED`, another order's lock or a slot without the shared ownership proof;
- same idempotency key replays the first response; same key for another order is 409; a new key on already cancelled business returns the same terminal projection without a second transition;
- commit/database failure rolls back order, slot and idempotency record and returns 503.

```python
response = client.post(
    f"/api/v1/orders/{order_id}/cancel",
    headers={
        "Authorization": f"Bearer {token}",
        "Idempotency-Key": "cancel-order-0000000000000001",
    },
)
assert response.status_code == 200
assert response.json()["status"] == "CANCELLED"
assert response.json()["allowed_actions"]["can_cancel"] is False
```

```bash
TEST_DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test \
  uv run pytest backend/tests/test_order_cancellation.py -q
```

Expected: RED because the owner command service/route do not exist.

- [ ] **Step 2: Implement the smallest owner command service**

Recommended boundary:

```python
class OrderCancellationService:
    def __init__(
        self,
        *,
        order_repository: OrderRepository,
        refund_repository: RefundRepository,
        now: Callable[[], datetime],
    ) -> None: ...

    def cancel_owned_order(
        self,
        *,
        user_id: uuid.UUID,
        order_id: uuid.UUID,
        idempotency_key: str,
    ) -> CancellationResult: ...
```

The service must delegate policy decisions to `orders/lifecycle.py` and ordered locking/case predicates to `RefundRepository`. It must not reimplement the 24-hour rule, action truth table, purpose validation, inventory proof or list/detail projection.

Canonical idempotency digest:

```python
sha256(json.dumps(
    {"operation": "cancel_order", "order_id": str(order_id), "version": 1},
    sort_keys=True,
    separators=(",", ":"),
).encode()).hexdigest()
```

The no-money branch performs all changes in one transaction. The maybe-paid branch only records the shared cancellation intent and returns; it does not query/close payment, create automatic cases or call a Provider.

Use these two exact lock paths; do not improvise a third order:

- **No-money branch:** read only enough identifiers to locate the slot, then lock `Slot -> Order -> every Payment for the order in stable payment-id order`. Recheck owner, current lifecycle state, and slot ownership after all locks are held. Only then may the service write `CANCELLED` and release this order's own `LOCKED` slot.
- **Applied-payment branch:** read only the applied payment id, then call `RefundRepository.lock_refund_graph(payment_id)` and recheck owner plus lifecycle facts inside that shared graph before creating or retrying a case/attempt.

Never lock a payment first and then call `lock_refund_graph()`: that reverses the shared graph order and can deadlock with payment/refund convergence.

- [ ] **Step 3: Add the exact route without schema edits**

Add `POST /{order_id}/cancel` to `backend/app/modules/orders/router.py` with business bearer, `Idempotency-Key` length 16–128, no request body and the exact upstream 200/202/401/404/409/503 matrix. Serialize the existing shared response DTO; do not define a second cancel response schema or extend `align_order_list_openapi`.

- [ ] **Step 4: Run GREEN and focused shared regressions**

```bash
TEST_DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test \
  uv run pytest \
    backend/tests/test_order_cancellation.py \
    backend/tests/test_order_lifecycle.py \
    backend/tests/test_order_detail.py \
    backend/tests/test_order_list.py \
    backend/tests/test_refund_repository.py \
    backend/tests/test_openapi_conformance.py -q
uv run ruff check \
  backend/app/modules/orders/cancellation.py \
  backend/app/modules/orders/router.py \
  backend/tests/test_order_cancellation.py
uv run mypy backend/app/modules/orders/cancellation.py
```

Expected: PASS and no shared foundation file changes.

- [ ] **Step 5: Commit**

```bash
git add \
  backend/app/modules/orders/cancellation.py \
  backend/app/modules/orders/router.py \
  backend/tests/test_order_cancellation.py
git diff --cached --check
git commit -m "feat: cancel owned unpaid orders"
```

---

### Task 3：创建或重试 durable ORDER_CANCELLATION case/attempt

**Files:**

- Modify: `backend/app/modules/orders/cancellation.py`
- Modify: `backend/tests/test_order_cancellation.py`
- Consume only: `backend/app/modules/orders/lifecycle.py`
- Consume only: `backend/app/modules/refunds/repository.py`

- [ ] **Step 1: Add RED tests for durable enqueue and retry**

Cover only owner-operation persistence, not Provider behavior:

- eligible confirmed order uses the shared policy and the `SUCCESS` payment whose `applied_to_order_at` is non-null;
- the service creates/reuses one `ORDER_CANCELLATION + USER_CANCELLED` case with full payment amount/CNY and `requested_by_user_id=owner`;
- first attempt is durable `CREATING`, `attempt_no=1`, and uses a stable `merchant_refund_no` no longer than 32 characters;
- order becomes the shared `REFUND_PENDING` projection and slot remains `BOOKED`;
- same idempotency key and a new key while an active attempt exists do not create another case/attempt;
- a Provider-owned terminal `REFUND_FAILED` fixture can be retried by an allowed owner action, producing attempt 2 in the same case and returning to `REFUND_PENDING`;
- an `UNKNOWN/PROCESSING/CREATING` active attempt is never retried as a new attempt;
- inside-24h, checked-in, completed, non-owner, non-main payment and corrupted multiple-main-payment states are rejected by shared policy/repository predicates;
- any database error rolls back case, attempt, order timestamps/status and idempotency together.

Explicitly assert zero imports/calls of `RefundProvider` and zero changes to `RefundAttempt` terminal facts. This command only enqueues durable work.

```bash
TEST_DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test \
  uv run pytest backend/tests/test_order_cancellation.py -q
```

Expected: RED because confirmed cancellation/retry is not yet enqueued.

- [ ] **Step 2: Implement enqueue/retry through shared RefundRepository**

Inside the same ordered transaction used by Task 2:

```text
locate owner-hidden order
→ ask shared lifecycle policy for owner cancel/retry decision
→ use RefundRepository's applied-main-payment and purpose predicates
→ claim/replay cancel idempotency
→ create/reuse ORDER_CANCELLATION case
→ create attempt 1, or next attempt only after shared REFUND_FAILED retry decision
→ write shared-policy-valid cancel timestamps/status
→ commit case + attempt + order + idempotency together
```

Do not call `create_refund`/`query_refund`, set `SUCCESS/FAILED/UNKNOWN`, write Provider numbers/facts, release a `BOOKED` slot or create automatic purpose cases. Provider convergence/worker owns every step after the durable `CREATING` attempt exists.

- [ ] **Step 3: Run the focused owner suite**

```bash
TEST_DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test \
  uv run pytest \
    backend/tests/test_order_cancellation.py \
    backend/tests/test_order_lifecycle.py \
    backend/tests/test_refund_repository.py \
    backend/tests/test_order_detail.py \
    backend/tests/test_order_list.py -q
uv run ruff check backend/app/modules/orders/cancellation.py backend/tests/test_order_cancellation.py
uv run mypy backend/app/modules/orders/cancellation.py
```

Expected: PASS; `git diff --name-only` contains no shared lifecycle, refund convergence, payment convergence, migration or OpenAPI file.

- [ ] **Step 4: Commit**

```bash
git add backend/app/modules/orders/cancellation.py backend/tests/test_order_cancellation.py
git diff --cached --check
git commit -m "feat: enqueue owner cancellation refunds"
```

---

### Task 4：接通生产小程序 decoder、HTTP 和 owner action

**Files:**

- Modify: `miniprogram/domain/booking.ts`
- Modify: `miniprogram/domain/decoders.ts`
- Modify: `miniprogram/domain/decoders.test.ts`
- Modify: `miniprogram/services/booking.ts`
- Modify: `miniprogram/services/http-booking.ts`
- Modify: `miniprogram/services/http-booking.test.ts`
- Modify: `miniprogram/presentation/order-detail.ts`
- Modify: `miniprogram/presentation/order-detail.test.ts`
- Modify: `miniprogram/presentation/my-orders.ts`
- Modify: `miniprogram/presentation/my-orders.test.ts`
- Modify: `miniprogram/pages/order-detail/index.ts`
- Modify: `miniprogram/pages/order-detail/index.wxml`
- Modify: `miniprogram/pages/order-detail/index.wxss`
- Modify: `miniprogram/pages/order-detail/index.test.ts`
- Modify: `miniprogram/pages/my-orders/index.ts`
- Modify: `miniprogram/pages/my-orders/index.wxml`
- Modify: `miniprogram/pages/my-orders/index.wxss`
- Modify: `miniprogram/pages/my-orders/index.test.ts`

- [ ] **Step 1: Write RED decoder and HTTP tests**

Strictly consume the upstream closed status/action/timestamp matrix. Reject unknown fields/statuses/blocked reasons, contradictory `can_pay/can_cancel`, and private refund/provider identifiers.

HTTP boundary:

```ts
export interface CancelOrderAttempt {
  readonly orderId: string;
  readonly idempotencyKey: string;
}

cancelOrder(attempt: CancelOrderAttempt): Promise<OrderView>;
```

Transport contract:

```text
POST /api/v1/orders/{encoded-order-id}/cancel
body: undefined
headers: Authorization + Idempotency-Key
```

Allow the existing one-time 401 silent login. A decoded 409 is definitive. Network error, timeout, malformed 2xx or decoded 5xx becomes `CANCELLATION_RESULT_UNKNOWN`; the page first refreshes `GET /orders/{id}` and reuses the same key only when the action remains server-authorized.

```bash
npx jest \
  miniprogram/domain/decoders.test.ts \
  miniprogram/services/http-booking.test.ts \
  --runInBand
```

Expected: RED because expanded decoding and cancel transport are absent.

- [ ] **Step 2: Integrate the already-reviewed page boundary**

The detail page:

- generates one idempotency key per deliberate confirmation;
- serializes taps and invalidates late results on hide/unload;
- never locally sets `CANCELLED`, `REFUND_PENDING`, `REFUNDED` or slot-release copy;
- replaces its projection with cancel response or authoritative refresh;
- short-polls pending cancellation/refund states using the existing bounded polling pattern, then offers one real manual refresh;
- renders a retry refund action only when the shared owner projection returns `can_cancel=true` for `REFUND_FAILED`.

The list only displays server status and remains a detail-navigation list. It does not add inline destructive buttons or infer actions from local time.

- [ ] **Step 3: Run focused production Mini Program checks**

```bash
npx jest \
  miniprogram/domain/decoders.test.ts \
  miniprogram/services/http-booking.test.ts \
  miniprogram/presentation/order-detail.test.ts \
  miniprogram/presentation/my-orders.test.ts \
  miniprogram/pages/order-detail/index.test.ts \
  miniprogram/pages/my-orders/index.test.ts \
  --runInBand
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Prove slice-local production isolation and prepare the root handoff**

```bash
rg -n "order-cancellation-fixture|order-cancellation-route-fragment" \
  miniprogram --glob '!dev/**' && exit 1 || true
npx jest miniprogram/dev/order-cancellation-route-fragment.test.ts --runInBand
```

Expected: PASS; production code contains the real HTTP owner action and no cancellation Fixture/fragment import. Root integration, not this branch, adds central build/audit coverage for the declared route/token union.

- [ ] **Step 5: Commit**

```bash
git add \
  miniprogram/domain/booking.ts \
  miniprogram/domain/decoders.ts \
  miniprogram/domain/decoders.test.ts \
  miniprogram/services/booking.ts \
  miniprogram/services/http-booking.ts \
  miniprogram/services/http-booking.test.ts \
  miniprogram/presentation/order-detail.ts \
  miniprogram/presentation/order-detail.test.ts \
  miniprogram/presentation/my-orders.ts \
  miniprogram/presentation/my-orders.test.ts \
  miniprogram/pages/order-detail \
  miniprogram/pages/my-orders
git diff --cached --check
git commit -m "feat: cancel orders from mini program"
```

---

### Task 5：HTTP 集成、最小设备验收和 root 集成交接

**Files:**

- Create: `docs/acceptance/user-order-cancellation-and-refund-progress.md`
- Modify: `artifacts/ui/reviews/order-cancellation/README.md`
- Retain for root integration: `miniprogram/dev/order-cancellation-fixture.ts`
- Retain for root integration: `miniprogram/dev/order-cancellation-fixture.test.ts`
- Retain for root integration: `miniprogram/dev/order-cancellation-route-fragment.ts`
- Retain for root integration: `miniprogram/dev/order-cancellation-route-fragment.test.ts`

- [ ] **Step 1: Exercise the actual HTTP owner operation without a Provider**

Through development HTTP composition and disposable PostgreSQL:

1. cancel a pending never-paid order and observe `CANCELLED` plus only its owned slot becoming available;
2. seed an applied successful payment directly in the isolated test database, cancel the eligible confirmed order, observe one durable `ORDER_CANCELLATION` case/attempt and the page's `REFUND_PENDING` state;
3. seed a Provider-owned `REFUND_FAILED` attempt, tap real “重试退款”, and prove the API creates attempt 2 in the same case;
4. leave all `CREATING/PROCESSING/UNKNOWN/SUCCESS` Provider transitions untouched.

This integration does not instantiate a scripted/real refund Provider and does not claim terminal refund success.

- [ ] **Step 2: Run the focused cross-layer checks**

```bash
TEST_DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test \
  uv run pytest \
    backend/tests/test_order_cancellation.py \
    backend/tests/test_order_lifecycle.py \
    backend/tests/test_refund_repository.py \
    backend/tests/test_order_detail.py \
    backend/tests/test_order_list.py \
    backend/tests/test_openapi_conformance.py -q
npx jest \
  miniprogram/domain/decoders.test.ts \
  miniprogram/services/http-booking.test.ts \
  miniprogram/presentation/order-detail.test.ts \
  miniprogram/presentation/my-orders.test.ts \
  miniprogram/pages/order-detail/index.test.ts \
  miniprogram/pages/my-orders/index.test.ts \
  --runInBand
npm run typecheck
npm run contract:validate
git diff --check
```

Expected: focused slice checks PASS. Do not edit central build/audit files or run and repair unrelated full-suite artifact/route failures in this slice.

- [ ] **Step 3: Do one non-monetary iPhone acceptance journey**

After root has merged every active slice and additively composed their route fragments, against staging on a real iPhone:

1. create a pending order and never open/finalize WeChat payment;
2. leave detail, reopen from “我的订单”;
3. tap “取消订单”, inspect the truthful confirmation, confirm once;
4. verify `CANCELLED`, no pay/cancel button, refreshed list “已取消”, and the same slot available again;
5. exercise every visible button in this journey once.

At 375×812 perform one final HTTP-backed visual self-review of cancelled detail/list. Check centering, badges, chevrons, clipping, safe area, real order data and stale-state absence. This is the only final live preview; do not repeat a full state matrix.

- [ ] **Step 4: Record the Provider release gate honestly**

`docs/acceptance/user-order-cancellation-and-refund-progress.md` must separately record:

- owner cancel API/durable enqueue automated evidence;
- pending no-payment iPhone cancellation;
- paid refund terminal acceptance as `BLOCKED_BY_WECHAT_PROVIDER_INTEGRATION` until the Provider track merges and performs exactly one controlled small payment/refund.

Do not mark paid refund complete in this task and do not make a real payment merely to test an unenforced refund worker.

- [ ] **Step 5: Hand central registration and cleanup to the serialized root integration task**

The slice branch retains `order-cancellation-fixture.*` and `order-cancellation-route-fragment.*`; it must not edit or delete central registrations. Root integration must perform this order exactly:

1. merge every active slice branch before touching `bootstrap.ts`, `app-pages.json`, central build/audit manifests or tests;
2. inventory the current central routes/tokens and the union of every slice-local fragment;
3. additively register the union in `miniprogram/dev/bootstrap.ts` and `miniprogram/dev/app-pages.json`, preserving all existing and other-slice routes;
4. update `scripts/build-miniprogram.mjs`, `scripts/audit-production-package.mjs`, `tests/build-miniprogram.test.mjs`, `tests/audit-production-package.test.mjs` and `tests/production-package-booking-audit.test.mjs` once, in the root integration branch;
5. run the visual/device acceptance above; only after every active slice is on real HTTP, delete its temporary Fixture/fragment and central hooks in the same root-owned cleanup;
6. compare the post-cleanup route/token set with the pre-cleanup union and fail if any non-target route/token disappeared. Preserve the older my-orders Fixture until its own acceptance document authorizes removal.

- [ ] **Step 6: Let root perform central verification; commit only slice-local acceptance records here**

```bash
npx jest \
  miniprogram/dev/order-cancellation-fixture.test.ts \
  miniprogram/dev/order-cancellation-route-fragment.test.ts \
  miniprogram/pages/order-detail/index.test.ts \
  miniprogram/pages/my-orders/index.test.ts --runInBand
git diff --check
```

Expected on the slice branch: PASS, with Fixture/fragment intentionally retained and no central-file diff. Root integration separately runs development/production builds and central audits after registration, then repeats them after cleanup and proves the production package contains no slice Fixture/token.

```bash
git add \
  docs/acceptance/user-order-cancellation-and-refund-progress.md \
  artifacts/ui/reviews/order-cancellation/README.md
git diff --cached --check
git commit -m "docs: record owner cancellation acceptance"
```

### Completion criteria

This owner track is complete when:

- owner/non-owner, policy delegation, idempotency, no-money cancellation, durable case/attempt creation and retry pass against PostgreSQL;
- the diff contains no new policy/projector/repository/convergence/worker/migration/OpenAPI ownership;
- owner service never imports or calls a refund Provider and never writes refund authority terminal facts;
- detail/list render only shared server-authorized actions and every visible button performs a real operation;
- the slice handoff retains only its local Fixture/fragment and contains no central registration/build/audit diff;
- after all active slices merge, root integration preserves every unrelated route/token, removes this Fixture/fragment, and proves the production package contains no development Fixture or refund Mock;
- one representative 375×812 HTTP-backed review and one non-monetary iPhone cancellation pass;
- paid refund terminal acceptance remains explicitly gated to the Provider track.
