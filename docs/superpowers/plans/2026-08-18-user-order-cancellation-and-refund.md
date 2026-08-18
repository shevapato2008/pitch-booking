# User Order Cancellation and Refund Implementation Plan

> **For agentic workers:** REQUIRED: Use `superpowers:subagent-driven-development` (if subagents are available) or `superpowers:executing-plans` to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让订单所有者在服务端规则允许时从真实小程序订单详情取消订单，并在“我的订单”和详情页看到权威的取消、退款中、退款失败与已退款状态。

**Architecture:** 本切片在共享生命周期基础合并后开始，不再修改共享枚举、迁移、退款 Provider 协议或 OpenAPI schema。后端以 `Slot → Order → Payment/RefundCase → RefundAttempt` 的固定锁顺序完成 owner-only 取消，所有 Provider I/O 都在事务和行锁之外；前端只根据服务端 `status`、`allowed_actions` 和 `blocked_reason` 渲染状态与按钮，不使用本地时间猜测取消资格。

**Tech Stack:** FastAPI、SQLAlchemy 2、PostgreSQL、Pytest、微信小程序 TypeScript/WXML/WXSS、Jest、现有 production build/audit。

**Design:** `docs/superpowers/specs/2026-08-18-order-lifecycle-and-refund-design.md`；延续 `docs/superpowers/specs/2026-08-18-my-orders-design.md` 已确认的 375×812 视觉系统。

---

## Chunk 1：Owner cancellation/refund vertical slice

### Scope、上游假设与文件所有权

本计划只拥有：

- owner 用户 `POST /api/v1/orders/{order_id}/cancel` 的服务、repository、路由和幂等语义；
- `ORDER_CANCELLATION` 退款 case/attempt 的创建、重试和权威结果收敛；
- 用户取消与支付并发时的安全收敛；
- owner 订单详情/列表的动作投影，以及生产小程序详情/列表的状态和真实动作；
- development-only 视觉 Fixture、聚焦自动化、最小设备验收和 Fixture 删除。

上游共享生命周期任务必须先提供，且本计划只验证、不修改：

- `backend/app/models.py` 中新增订单状态、取消/履约时间戳、`Payment.applied_to_order_at`、`RefundCase`、`RefundAttempt` 及相关闭合枚举；
- `backend/migrations/versions/0013_order_lifecycle_and_refunds.py`（若上游最终采用不同文件名，以 Alembic `head` 的实际文件为准）；
- `backend/app/modules/refunds/provider.py` 中 `RefundProvider`、create/query request/result 和 `AuthoritativeRefundFacts`；
- `backend/app/modules/orders/dto.py` 中共享 `AllowedActionsResponse`、扩展后的 `OrderDetailResponse` / `OrderSummaryResponse`；
- `contracts/openapi.yaml` 及 `contracts/examples/` 中取消 endpoint、扩展订单投影、错误信封和状态矩阵。

本计划不得修改：

- `backend/app/models.py`、任何 `backend/migrations/versions/*.py`；
- `contracts/openapi.yaml`、`contracts/examples/*`、`scripts/validate-contract.mjs`；
- `backend/app/modules/refunds/provider.py`；
- 真实微信支付/退款 HTTP adapter、证书、配置、通知验签解密或 worker composition；
- 场馆履约/场馆退款 API。

真实 WeChat adapter 由并行 Provider 切片实现。本切片只消费注入的协议；测试使用 test-local scripted provider。不得向 production composition 注册 Mock，也不得在 Provider 缺失时伪造成功。已支付订单退款的真实小额真机验收属于 Provider 集成发布门槛；本计划自己的无资金真机验收只取消一个从未发起支付的待支付订单。

上游 schema 若没有冻结本计划所需的 200/202/409/503 响应或错误码，停止实施并回到共享基础任务；不要在本分支补改 OpenAPI。下文的测试应直接导入/断言上游已有常量，而不是在业务代码再建第二份字符串集合。

### File map

**Backend create:**

- `backend/app/modules/orders/actions.py`：owner 视角的纯动作投影，唯一使用服务端 `now` 判断 24 小时边界。
- `backend/app/modules/orders/cancellation.py`：用户取消三阶段 orchestration 与支付竞态后的 finalize hook。
- `backend/app/modules/orders/cancellation_repository.py`：owner 隐藏式定位、固定顺序加锁、取消幂等记录和 slot 归属证明。
- `backend/app/modules/refunds/repository.py`：case/attempt 定位、顺序 attempt、恢复租约和退款成功时的归属查询。
- `backend/app/modules/refunds/service.py`：退款 create/query 的事务外 Provider I/O 和 restart-safe recovery。
- `backend/app/modules/refunds/convergence.py`：校验权威退款事实并原子更新 attempt/order/slot。
- `backend/tests/test_order_actions.py`：owner 动作真值表纯测试。
- `backend/tests/test_order_cancellation.py`：owner API、幂等、权限和待支付取消 PostgreSQL 测试。
- `backend/tests/test_order_refund.py`：全额退款、失败/UNKNOWN/重试、权威校验和锁外 I/O PostgreSQL 测试。
- `backend/tests/test_order_cancellation_concurrency.py`：支付—取消—退款真实 PostgreSQL 竞态测试。

**Backend modify:**

- `backend/app/modules/orders/service.py`：详情/列表复用 owner 动作投影并返回上游冻结字段；替换不可执行的 50% 退款承诺。
- `backend/app/modules/orders/router.py`：只添加上游已冻结的 owner cancel operation；不在本切片新增或扩展 runtime schema patch。
- `backend/app/modules/orders/repository.py`：详情/列表预加载动作投影所需的退款关系；不复制取消写路径。
- `backend/app/modules/payments/service.py`：`cancel_requested_at` 后禁止再次创建/重放新的支付动作。
- `backend/app/modules/payments/convergence.py`：成功主付款写 `applied_to_order_at`，并把取消竞态交给 cancellation finalize hook。
- `backend/app/modules/payments/reconciliation.py`：取消请求使现有 payment 立即到期查单/关单；结果收敛后触发取消 finalize。
- `backend/tests/test_order_detail.py`、`backend/tests/test_order_list.py`、`backend/tests/test_payment_settlement.py`、`backend/tests/test_payment_concurrency.py`：相邻行为回归。

**Mini Program create:**

- `miniprogram/dev/order-cancellation-fixture.ts`、`miniprogram/dev/order-cancellation-fixture.test.ts`：临时、集中、development-only 的详情/列表状态与真实 Fixture transitions。
- `artifacts/ui/reviews/order-cancellation/README.md`：两张代表性 375×812 预览的自审和用户确认记录。
- `docs/acceptance/user-order-cancellation-and-refund-progress.md`：自动化、设备、Provider 外部依赖和 Fixture 删除状态。

**Mini Program modify:**

- `miniprogram/domain/booking.ts`：消费上游订单状态、动作和取消/退款投影。
- `miniprogram/domain/decoders.ts`、`miniprogram/domain/decoders.test.ts`：严格解码共享闭合响应。
- `miniprogram/services/booking.ts`：增加 owner cancel data-source operation。
- `miniprogram/services/http-booking.ts`、`miniprogram/services/http-booking.test.ts`：Bearer、`Idempotency-Key`、一次 401 恢复和 unknown-result 语义。
- `miniprogram/presentation/order-detail.ts`、`miniprogram/presentation/order-detail.test.ts`：新增取消/退款状态与轮询状态机。
- `miniprogram/presentation/my-orders.ts`、`miniprogram/presentation/my-orders.test.ts`：列表状态优先级与文案。
- `miniprogram/pages/order-detail/index.ts`、`index.wxml`、`index.wxss`、`index.test.ts`：确认弹层、取消/重试退款、禁重、unknown-result 与权威刷新。
- `miniprogram/pages/my-orders/index.ts`、`index.wxml`、`index.wxss`、`index.test.ts`：新状态展示；卡片仍是进入详情的唯一列表动作。
- `miniprogram/dev/payment-source.ts`、`miniprogram/dev/payment-source.test.ts`、`miniprogram/dev/bootstrap.ts`：临时挂接代表性详情 Fixture。
- `miniprogram/dev/my-orders-fixture.ts`、`miniprogram/dev/pages/my-orders/index.test.ts`：临时增加取消/退款卡片状态。
- `tests/build-miniprogram.test.mjs`、`tests/audit-production-package.test.mjs`、`tests/production-package-booking-audit.test.mjs`：证明 Fixture 和 preview token 不进入 production。

---

### Task 0：验证共享生命周期基础并冻结并行边界

**Files:**

- Verify only: `backend/app/models.py`
- Verify only: `backend/migrations/versions/0013_order_lifecycle_and_refunds.py`
- Verify only: `backend/app/modules/refunds/provider.py`
- Verify only: `backend/app/modules/orders/dto.py`
- Verify only: `contracts/openapi.yaml`
- Verify only: `contracts/examples/`
- Verify only: `docs/superpowers/specs/2026-08-18-order-lifecycle-and-refund-design.md`

- [ ] **Step 1: Rebase/merge only after the foundation branch is green**

Confirm the implementation branch contains the shared lifecycle commit. Record its SHA in the implementation handoff. Do not copy shared files from another worktree.

- [ ] **Step 2: Assert the exact upstream surface**

Run:

```bash
rg -n "CANCELLED|REFUND_PENDING|REFUND_FAILED|REFUNDED|COMPLETED|cancel_requested_at|applied_to_order_at|class RefundCase|class RefundAttempt" backend/app/models.py
rg -n "class RefundProvider|create_refund|query_refund|AuthoritativeRefundFacts" backend/app/modules/refunds/provider.py
rg -n "allowed_actions|blocked_reason|/api/v1/orders/\{order_id\}/cancel" contracts/openapi.yaml backend/app/modules/orders/dto.py
```

Expected: every shared symbol exists once; no implementation-local enum or duplicate schema is needed.

- [ ] **Step 3: Run only the foundation contract/migration checks**

```bash
npm run contract:validate
TEST_DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test \
  uv run pytest \
    backend/tests/test_order_lifecycle_foundation.py \
    backend/tests/test_openapi_conformance.py -q
```

Expected: PASS. If an upstream test file was renamed, use the actual lifecycle-foundation test selected by `rg --files backend/tests | rg 'lifecycle|refund.*schema'`; do not replace it with a new test in this branch.

- [ ] **Step 4: Record the implementation invariants**

In the working notes for Task 1, copy the actual upstream response status matrix and error-code names. The behavioral invariants are fixed even if names differ:

```text
200 = immediate terminal CANCELLED/REFUNDED or exact idempotent replay
202 = payment cancellation or refund authority still pending
404 = missing and non-owner are indistinguishable
409 = current authoritative state/window disallows the action, or key reuse differs
503 = database/provider unavailable without fake success
```

Do not commit at this gate.

---

### Task 1：先用隔离 Fixture 完成详情/列表动作与最小视觉确认

**Files:**

- Create: `miniprogram/dev/order-cancellation-fixture.ts`
- Create: `miniprogram/dev/order-cancellation-fixture.test.ts`
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
- Modify: `miniprogram/dev/payment-source.ts`
- Modify: `miniprogram/dev/payment-source.test.ts`
- Modify: `miniprogram/dev/bootstrap.ts`
- Modify: `miniprogram/dev/my-orders-fixture.ts`
- Modify: `miniprogram/dev/pages/my-orders/index.test.ts`
- Modify: `tests/build-miniprogram.test.mjs`
- Create: `artifacts/ui/reviews/order-cancellation/README.md`

- [ ] **Step 1: Write RED presentation and page tests**

Add one closed owner action type; use the upstream field names exactly:

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

Cover only these representative behaviors:

1. `PENDING_PAYMENT + can_cancel` shows a real secondary “取消订单” action while keeping “立即支付” only when `can_pay=true`.
2. `cancel_requested_at != null` with pending payment shows “正在确认取消”, renders no pay/cancel button, and polls the server.
3. eligible `CONFIRMED + can_cancel` shows “取消订单”; confirmation copy promises only a full refund, never 50%.
4. `REFUND_PENDING` shows “退款处理中” and no button; `REFUND_FAILED + can_cancel` shows real “重试退款”; `REFUNDED` and `CANCELLED` are terminal ordinary views.
5. a late cancel result after hide/unload cannot mutate the page; duplicate taps issue one request.
6. an unknown network result keeps the same idempotency key and offers “确认取消结果”; a definitive 409 clears that attempt.
7. list cards show `正在确认取消 / 已取消 / 退款处理中 / 退款失败 / 已退款 / 已完成` with text plus semantic color; list cards still navigate to detail and do not add nested destructive buttons.

Run:

```bash
npx jest \
  miniprogram/presentation/order-detail.test.ts \
  miniprogram/presentation/my-orders.test.ts \
  miniprogram/pages/order-detail/index.test.ts \
  miniprogram/pages/my-orders/index.test.ts \
  --runInBand
```

Expected: RED because the new statuses/actions and `cancelOrder` boundary are absent.

- [ ] **Step 2: Implement the minimal fixture-driven UI**

`order-cancellation-fixture.ts` owns immutable `pending-cancellable → cancelling → cancelled` and `confirmed-cancellable → refund-pending → refund-failed/refunded` transitions. It may implement `cancelOrder` for development composition only. Production page code must depend solely on `BookingDataSource`, never import this fixture.

Use the existing visual system: `#F8FAFC` background, `#FFFFFF` surfaces, `#10243E` primary text, existing trust blue/success/error tokens, 4/8px rhythm, 88rpx touch targets, explicit flex centering and safe-area padding. Use text plus existing CSS/vector forms; no emoji or new icon family.

The detail page must confirm before the destructive request:

```text
待支付：确认取消订单？ / 取消后将释放当前场次。
已确认：确认取消并退款？ / 将发起全额原路退款，退款成功后释放场次。
退款失败：重试退款？ / 将继续处理同一笔全额退款，不会重复扣款。
```

“释放场次”只能出现在无付款的立即取消或退款已成功的权威结果中；退款处理中不得声称已释放。

- [ ] **Step 3: Run focused frontend GREEN checks**

```bash
npx jest \
  miniprogram/dev/order-cancellation-fixture.test.ts \
  miniprogram/dev/payment-source.test.ts \
  miniprogram/dev/pages/my-orders/index.test.ts \
  miniprogram/presentation/order-detail.test.ts \
  miniprogram/presentation/my-orders.test.ts \
  miniprogram/pages/order-detail/index.test.ts \
  miniprogram/pages/my-orders/index.test.ts \
  --runInBand
npm run typecheck
npm run build:miniprogram:development
node --test tests/build-miniprogram.test.mjs
```

Expected: PASS; development build contains the temporary scenario and production route sources import no `miniprogram/dev` module.

- [ ] **Step 4: Perform one proportional visual pass per changed page**

At exactly 375×812 in WeChat DevTools, capture only:

- one eligible confirmed detail with the real cancel action and safe-area footer;
- one mixed list containing refund-pending, refunded and refund-failed cards.

Compare the detail geometry with `artifacts/ui/reviews/payment-confirmation/reference-confirmed-375x812.png` and the list geometry with `artifacts/ui/reviews/my-orders/ready-reference-375x812.png`. Generate one side-by-side, 50% overlay and difference image for each changed page; record intentional status/action differences in `artifacts/ui/reviews/order-cancellation/README.md`.

Manually check button text horizontal/vertical centering, equal status badge heights, full chevrons, no clipping, no fixed-footer overlap, safe-area clearance, exact copy and honest disabled/non-button states. Do one iPhone 14 Pro safe-area smoke check without creating an extra Artifact matrix. Fix only visible blockers.

- [ ] **Step 5: Obtain the visual gate and commit**

Do not start backend Task 2 until the user confirms these two representative previews. This is an extension of previously approved screens, so no full-state screenshot matrix or new design-system exploration is required.

```bash
git add \
  miniprogram/domain/booking.ts \
  miniprogram/services/booking.ts \
  miniprogram/presentation \
  miniprogram/pages/order-detail \
  miniprogram/pages/my-orders \
  miniprogram/dev/order-cancellation-fixture.ts \
  miniprogram/dev/order-cancellation-fixture.test.ts \
  miniprogram/dev/payment-source.ts \
  miniprogram/dev/payment-source.test.ts \
  miniprogram/dev/bootstrap.ts \
  miniprogram/dev/my-orders-fixture.ts \
  miniprogram/dev/pages/my-orders/index.test.ts \
  tests/build-miniprogram.test.mjs \
  artifacts/ui/reviews/order-cancellation
git diff --cached --check
git commit -m "feat: preview user order cancellation"
```

---

### Task 2：实现 owner 权威动作和详情/列表投影

**Files:**

- Create: `backend/app/modules/orders/actions.py`
- Create: `backend/tests/test_order_actions.py`
- Modify: `backend/app/modules/orders/repository.py`
- Modify: `backend/app/modules/orders/service.py`
- Modify: `backend/tests/test_order_detail.py`
- Modify: `backend/tests/test_order_list.py`
- Verify only: `backend/app/modules/orders/dto.py`
- Verify only: `contracts/openapi.yaml`

- [ ] **Step 1: Write the pure RED action matrix**

Use a timezone-aware server `now`; never pass the Mini Program clock. Freeze this owner projection:

| Authoritative state | Owner action |
| --- | --- |
| `PENDING_PAYMENT`, no cancel request, not expired | `can_cancel=true`; `can_pay` follows existing payment authority |
| pending payment with unresolved cancel | no action; `PAYMENT_RESULT_PENDING` |
| `CONFIRMED`, not checked in, `starts_at - now >= 24h`, no cancellation case | `can_cancel=true` |
| `CONFIRMED` inside 24h | no cancel; `CANCELLATION_WINDOW_CLOSED` |
| payment won a prior cancel race inside 24h | no cancel; `CANCELLATION_REQUIRES_SUPPORT` |
| `REFUND_PENDING` | no action; `REFUND_IN_PROGRESS` |
| `REFUND_FAILED` for owner cancellation | `can_cancel=true`, used as “重试退款” |
| `CANCELLED / REFUNDED / COMPLETED / EXPIRED` | no action; `ORDER_TERMINAL` |

For an owner projection, `can_check_in`, `can_complete` and `can_refund` remain false; those belong to venue fulfillment. Assert the exact upstream blocked-reason enum values rather than raw duplicated strings.

Run:

```bash
uv run pytest backend/tests/test_order_actions.py -q
```

Expected: RED because `project_owner_actions` does not exist.

- [ ] **Step 2: Implement the pure projector and closed read projection**

Recommended signature:

```python
def project_owner_actions(
    *,
    order: Order,
    slot: Slot,
    payments: Sequence[Payment],
    refund_cases: Sequence[RefundCase],
    now: datetime,
) -> AllowedActionsResponse:
    ...
```

`OrderService._order_response` and `_order_summary` call the same function. Preload only the relationships required for the closed projection; do not query per order in the list. Keep `created_at DESC, id DESC` pagination unchanged.

Replace the order-detail promise “不足 24 小时收取 50%” with the actual server rule:

```text
开场前至少 24 小时可自助取消并全额退款；不足 24 小时请联系客服。
```

Do not infer venue exception handling or partial refund support.

- [ ] **Step 3: Add focused PostgreSQL read tests**

Extend the existing detail/list tests to cover:

- owner-only timestamps/actions and unchanged hidden-404 behavior;
- exact 24h inclusive boundary and one microsecond inside the closed window;
- pending cancel, cancellation-requires-support, refund pending/failed/refunded and completed list/detail projections;
- repository eager-loads the refund data needed by the list without changing pagination order or response privacy;
- no contact/private/refund-provider identifiers in `OrderSummaryResponse`.

Run:

```bash
TEST_DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test \
  uv run pytest \
    backend/tests/test_order_actions.py \
    backend/tests/test_order_detail.py \
    backend/tests/test_order_list.py -q
uv run ruff check \
  backend/app/modules/orders/actions.py \
  backend/app/modules/orders/repository.py \
  backend/app/modules/orders/service.py \
  backend/tests/test_order_actions.py
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add \
  backend/app/modules/orders/actions.py \
  backend/app/modules/orders/repository.py \
  backend/app/modules/orders/service.py \
  backend/tests/test_order_actions.py \
  backend/tests/test_order_detail.py \
  backend/tests/test_order_list.py
git diff --cached --check
git commit -m "feat: project owner cancellation actions"
```

---

### Task 3：实现待支付订单取消 API、幂等和 owner 隔离

**Files:**

- Create: `backend/app/modules/orders/cancellation_repository.py`
- Create: `backend/app/modules/orders/cancellation.py`
- Create: `backend/tests/test_order_cancellation.py`
- Modify: `backend/app/modules/orders/router.py`
- Modify: `backend/app/modules/payments/service.py`
- Verify only: `backend/app/modules/orders/dto.py`
- Verify only: `contracts/openapi.yaml`

- [ ] **Step 1: Write API RED tests for immediate and pending cancellation**

Use the real isolated PostgreSQL fixture and the upstream response/error schemas. Cover:

- no bearer, invalid bearer, other owner and missing order;
- pending order with no `CREATING | PREPAY_CREATED | CONFIRMING | UNKNOWN | SUCCESS` payment becomes `CANCELLED`, writes `cancel_requested_at == cancelled_at`, and releases only its own `LOCKED` slot to `AVAILABLE`;
- a pending order with only `CLOSED` attempts is also safe to cancel immediately;
- an active/maybe-paid attempt only writes `cancel_requested_at`, keeps order pending and slot locked, sets recovery due now, returns 202 and disables pay;
- repeated same key returns byte-equivalent first result; same key for a different order returns upstream `IDEMPOTENCY_KEY_REUSED` 409; a new key on already cancelled business returns the same terminal projection without a second slot change;
- database/commit failure rolls back order, slot, payment scheduling and idempotency record, returning 503.

Example core assertion:

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

Run:

```bash
TEST_DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test \
  uv run pytest backend/tests/test_order_cancellation.py -q
```

Expected: RED with 404/405 because the cancel route and service do not exist.

- [ ] **Step 2: Implement fixed-order locks and generic idempotency**

`CancellationRepository` must first perform an unlocked owner-hidden lookup only to discover `slot_id`, then acquire `Slot → Order → all relevant Payment rows` with `FOR UPDATE` and re-check owner/state. It may consume the upstream generic idempotency helper/model, but must not alter its schema.

Canonical digest:

```python
sha256(json.dumps(
    {"operation": "cancel_order", "order_id": str(order_id), "version": 1},
    sort_keys=True,
    separators=(",", ":"),
).encode()).hexdigest()
```

Immediate cancellation changes only the order and its currently owned lock. Never release `AVAILABLE`, `CLOSED`, `BOOKED`, another order's lock, or any slot when ownership proof fails.

- [ ] **Step 3: Add the exact route without patching OpenAPI**

Add `POST /{order_id}/cancel` to the existing orders router with:

- business bearer dependency;
- `Idempotency-Key` length 16–128;
- no request body;
- upstream response model and exact 200/202/401/404/409/503 matrix;
- a session factory created from the request database binding, matching the current payment router's short-transaction pattern.

`PaymentCreationService._phase_one` must reject any order with `cancel_requested_at is not None` before creating or reusing a payment launch. Use the upstream-frozen conflict code and complete the payment idempotency result consistently; do not return a cashier token after cancellation starts.

- [ ] **Step 4: Run GREEN and adjacent payment checks**

```bash
TEST_DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test \
  uv run pytest \
    backend/tests/test_order_cancellation.py \
    backend/tests/test_order_detail.py \
    backend/tests/test_payment_creation.py -q
uv run ruff check \
  backend/app/modules/orders/cancellation.py \
  backend/app/modules/orders/cancellation_repository.py \
  backend/app/modules/orders/router.py \
  backend/app/modules/payments/service.py \
  backend/tests/test_order_cancellation.py
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add \
  backend/app/modules/orders/cancellation.py \
  backend/app/modules/orders/cancellation_repository.py \
  backend/app/modules/orders/router.py \
  backend/app/modules/payments/service.py \
  backend/tests/test_order_cancellation.py
git diff --cached --check
git commit -m "feat: cancel owned pending orders"
```

---

### Task 4：实现已确认订单全额退款、重试和权威收敛

**Files:**

- Create: `backend/app/modules/refunds/repository.py`
- Create: `backend/app/modules/refunds/service.py`
- Create: `backend/app/modules/refunds/convergence.py`
- Create: `backend/tests/test_order_refund.py`
- Modify: `backend/app/modules/orders/cancellation.py`
- Modify: `backend/app/modules/orders/cancellation_repository.py`
- Modify: `backend/app/modules/orders/router.py`

- [ ] **Step 1: Write RED tests using a test-local scripted provider**

The fake stays inside `backend/tests/test_order_refund.py`; production code imports only the upstream `RefundProvider` protocol. Cover:

- owner confirmed order at exactly 24h creates/reuses one `ORDER_CANCELLATION + USER_CANCELLED` case for the `SUCCESS` payment whose `applied_to_order_at` is non-null;
- amount/currency equal the full authoritative payment; no partial amount parameter exists;
- first attempt uses `attempt_no=1`, stable `merchant_refund_no` ≤32 characters and Provider I/O observes no business row lock;
- processing/unknown returns 202 and keeps order `REFUND_PENDING` plus slot `BOOKED`;
- authoritative success validates provider, merchant, merchant refund/order number, provider refund/transaction number, full amount and CNY before setting `REFUNDED`;
- success releases to `AVAILABLE` only when the same order still proves exclusive booking ownership;
- fact mismatch, DB failure or missing ownership proof never releases inventory;
- explicit provider failure yields `REFUND_FAILED`; a new user action creates attempt 2 in the same case, while `UNKNOWN` queries the same merchant refund number and never creates attempt 2;
- checked-in, completed, inside-24h, non-main payment, non-owner and duplicate main-payment corruption are rejected safely;
- Provider unavailable returns the upstream 503 without creating a fake success. Follow the upstream contract on whether a durable case may already exist; assert the exact frozen behavior.

Run:

```bash
TEST_DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test \
  uv run pytest backend/tests/test_order_refund.py -q
```

Expected: RED because refund repository/service/convergence are absent.

- [ ] **Step 2: Implement three-phase refund orchestration**

Use these explicit phases:

```text
Phase 1, short DB transaction:
  lock Slot → Order → main Payment → RefundCase → latest RefundAttempt
  validate owner/window/check-in/state/full amount
  create or reuse case; create attempt only after FAILED
  persist REFUND_PENDING and commit

Phase 2, no Session and no row locks:
  RefundProvider.create_refund(...) for CREATING
  RefundProvider.query_refund(...) for PROCESSING/UNKNOWN recovery

Phase 3, short DB transaction:
  reacquire the same ordered graph
  verify phase identity and sanitized authoritative facts
  atomically converge attempt/order/slot; commit or roll back all
```

`RefundService.recover(refund_attempt_id, claim_token=None)` must be callable by the separate Provider/worker integration task after a crash. This plan does not edit `backend/app/worker.py` or production composition.

The route dependency reads the separately composed Provider defensively, for example `getattr(request.app.state, "refund_provider", None)`. Tests assign their scripted provider directly to app state; this slice does not add production settings or instantiate an adapter. A missing provider follows the upstream 503 contract.

- [ ] **Step 3: Preserve case/attempt monotonicity**

Rules to encode once in service/repository, not in the router:

- one case per successful payment;
- `ORDER_CANCELLATION` only for the applied main payment;
- at most one active `CREATING | PROCESSING | UNKNOWN` attempt;
- `SUCCESS` and provider identity facts never regress;
- `FAILED` may produce the next `attempt_no`; `UNKNOWN` may only re-query the same number;
- duplicate user keys replay the first business result; new keys still converge the same case.

- [ ] **Step 4: Run GREEN plus schema constraints**

```bash
TEST_DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test \
  uv run pytest \
    backend/tests/test_order_refund.py \
    backend/tests/test_order_cancellation.py \
    backend/tests/test_booking_schema_constraints.py -q
uv run ruff check backend/app/modules/refunds backend/app/modules/orders/cancellation.py backend/tests/test_order_refund.py
uv run mypy backend/app/modules/refunds backend/app/modules/orders/cancellation.py
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add \
  backend/app/modules/refunds/repository.py \
  backend/app/modules/refunds/service.py \
  backend/app/modules/refunds/convergence.py \
  backend/app/modules/orders/cancellation.py \
  backend/app/modules/orders/cancellation_repository.py \
  backend/app/modules/orders/router.py \
  backend/tests/test_order_refund.py
git diff --cached --check
git commit -m "feat: refund cancelled owner orders"
```

---

### Task 5：收敛支付—取消—退款竞态

**Files:**

- Create: `backend/tests/test_order_cancellation_concurrency.py`
- Modify: `backend/app/modules/payments/convergence.py`
- Modify: `backend/app/modules/payments/reconciliation.py`
- Modify: `backend/app/modules/orders/cancellation.py`
- Modify: `backend/app/modules/orders/cancellation_repository.py`
- Modify: `backend/tests/test_payment_settlement.py`
- Modify: `backend/tests/test_payment_concurrency.py`

- [ ] **Step 1: Write deterministic PostgreSQL RED races**

Use barriers/events and independent Sessions. Do not use SQLite. Freeze these outcomes:

1. **Cancel wins before payment exists:** order becomes `CANCELLED`, slot available, later payment creation is rejected.
2. **Maybe-paid payment exists:** cancel writes only `cancel_requested_at`; concurrent reader never sees the slot released.
3. **Provider closes unpaid payment:** existing attempt becomes closed, cancellation finalize writes `CANCELLED` and releases only the owned lock.
4. **Payment success wins, start ≥24h:** payment first becomes authoritative success and the applied main payment; cancellation creates one `ORDER_CANCELLATION` case and enters `REFUND_PENDING`; slot remains booked until refund success.
5. **Payment success wins, start <24h:** order remains `CONFIRMED`, `cancel_requested_at` remains audit-only, `cancelled_at` stays null, no refund case is created and owner sees `CANCELLATION_REQUIRES_SUPPORT`.
6. **Success cannot fulfil inventory during an existing user cancel request:** payment remains authoritative `SUCCESS`, is not applied to another booking, this cancellation-race hook creates one `PAYMENT_INVENTORY_CONFLICT + AUTOMATIC_RECOVERY` case with nullable requester and never modifies the slot. Generic inventory-conflict recovery without a user cancel request remains owned by the Provider/recovery slice.
7. Twenty concurrent cancel keys produce one case, one active attempt and one slot transition.

Run:

```bash
TEST_DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test \
  uv run pytest backend/tests/test_order_cancellation_concurrency.py -q
```

Expected: RED on cancellation-aware reconciliation and `applied_to_order_at` assignment.

- [ ] **Step 2: Make payment reconciliation cancellation-aware**

When `cancel_requested_at` is present, existing `CREATING | PREPAY_CREATED | CONFIRMING | UNKNOWN` payments are due immediately. Query using the original `merchant_order_no`; when authority says `NOT_PAID`, close the same provider order even before order expiry. Provider I/O remains outside locks.

After payment convergence:

- closed/unpaid calls cancellation finalize under the standard lock order;
- success writes `applied_to_order_at` only if that payment actually books the slot;
- success then calls the cancellation finalize hook, which applies the ≥24h decision and creates/reuses the correct refund business;
- unknown/payment exception leaves order/slot untouched except durable scheduling and safe error state.

Do not call `RefundProvider` while payment rows are locked. A finalize hook may create/schedule the refund attempt in one transaction; `RefundService` performs external I/O afterward.

- [ ] **Step 3: Prove monotonic adjacent payment behavior**

Extend existing tests so old close/unknown results cannot regress a success, `applied_to_order_at` is immutable, duplicate charge processing does not overwrite the normal confirmed order, and cancel requests never make expiry release an unsafe slot.

- [ ] **Step 4: Run focused race suite**

```bash
TEST_DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test \
  uv run pytest \
    backend/tests/test_order_cancellation_concurrency.py \
    backend/tests/test_order_cancellation.py \
    backend/tests/test_order_refund.py \
    backend/tests/test_payment_settlement.py \
    backend/tests/test_payment_concurrency.py \
    backend/tests/test_order_expiry_core.py -q
uv run ruff check \
  backend/app/modules/payments/convergence.py \
  backend/app/modules/payments/reconciliation.py \
  backend/app/modules/orders/cancellation.py \
  backend/tests/test_order_cancellation_concurrency.py
```

Expected: PASS; lock-probe tests prove zero Provider calls under business row locks.

- [ ] **Step 5: Commit**

```bash
git add \
  backend/app/modules/payments/convergence.py \
  backend/app/modules/payments/reconciliation.py \
  backend/app/modules/orders/cancellation.py \
  backend/app/modules/orders/cancellation_repository.py \
  backend/tests/test_order_cancellation_concurrency.py \
  backend/tests/test_payment_settlement.py \
  backend/tests/test_payment_concurrency.py
git diff --cached --check
git commit -m "fix: converge payment cancellation races"
```

---

### Task 6：接通生产小程序 decoder、HTTP 和真实页面动作

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
- Modify: `tests/build-miniprogram.test.mjs`
- Modify: `tests/audit-production-package.test.mjs`
- Modify: `tests/production-package-booking-audit.test.mjs`

- [ ] **Step 1: Write RED decoder and HTTP tests against the frozen contract**

Strictly reject:

- unknown order status/action/blocked reason;
- contradictory timestamp/status matrices already frozen upstream;
- `can_pay=true` after a cancel request;
- `can_cancel=true` on refund-pending/terminal orders;
- unknown/private refund provider fields in owner list/detail.

HTTP behavior:

```ts
cancelOrder(orderId, idempotencyKey) =>
  POST /api/v1/orders/{encoded-id}/cancel
  body: undefined
  headers: Authorization + Idempotency-Key
```

Allow one existing 401 silent re-login. A decoded business 409 is definitive and displayed from the closed code mapping. Network errors, timeout, malformed 2xx or decoded 5xx become `CANCELLATION_RESULT_UNKNOWN`; the page retains the same key and refreshes `GET /orders/{id}` before offering an exact replay.

Run:

```bash
npx jest \
  miniprogram/domain/decoders.test.ts \
  miniprogram/services/http-booking.test.ts \
  --runInBand
```

Expected: RED because the expanded closed decoder and cancel transport are absent.

- [ ] **Step 2: Implement the production adapter and page integration**

Extend the existing booking source; do not create a second auth/session stack. Recommended boundary:

```ts
export interface CancelOrderAttempt {
  readonly orderId: string;
  readonly idempotencyKey: string;
}

cancelOrder(attempt: CancelOrderAttempt): Promise<OrderView>;
```

The detail page generates one key per deliberate user action, keeps it for unknown-result replay, serializes taps, cancels stale operations on hide/unload, and replaces the entire local projection with the response/refresh. It must not locally set `REFUND_PENDING`, `REFUNDED` or release copy before decoding server authority.

The poller handles `cancel_requested_at` without `cancelled_at` and `REFUND_PENDING` using the existing 2-second short polling window, then shows one real manual “刷新状态” action. It does not poll terminal states. The list gains status copy only; destructive cancellation remains in detail to avoid nested buttons and accidental taps.

- [ ] **Step 3: Run focused production page tests**

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

- [ ] **Step 4: Prove production isolation**

```bash
MINIPROGRAM_TENCENT_MAP_KEY=AAAAA-BBBBB-CCCCC-DDDDD-EEEEE-FFFFF \
  npm run build:miniprogram:production
npm run audit:miniprogram-package
node --test \
  tests/build-miniprogram.test.mjs \
  tests/audit-production-package.test.mjs \
  tests/production-package-booking-audit.test.mjs
```

Expected: PASS; production contains the real detail/list routes and HTTP adapter, but no cancellation Fixture, scripted provider, mock refund success, development route or 50% promise.

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
  miniprogram/pages/my-orders \
  tests/build-miniprogram.test.mjs \
  tests/audit-production-package.test.mjs \
  tests/production-package-booking-audit.test.mjs
git diff --cached --check
git commit -m "feat: cancel orders from mini program"
```

---

### Task 7：前后端集成、最小设备验收、Fixture 删除和诚实收口

**Files:**

- Create: `docs/acceptance/user-order-cancellation-and-refund-progress.md`
- Modify: `docs/superpowers/plans/2026-08-16-overall-slice-roadmap.md`
- Modify: `artifacts/ui/reviews/order-cancellation/README.md`
- Delete: `miniprogram/dev/order-cancellation-fixture.ts`
- Delete: `miniprogram/dev/order-cancellation-fixture.test.ts`
- Modify: `miniprogram/dev/payment-source.ts`
- Modify: `miniprogram/dev/payment-source.test.ts`
- Modify: `miniprogram/dev/bootstrap.ts`
- Modify: `miniprogram/dev/my-orders-fixture.ts`
- Modify: `miniprogram/dev/pages/my-orders/index.test.ts`
- Modify: `tests/build-miniprogram.test.mjs`

- [ ] **Step 1: Run one real local HTTP vertical slice with scripted providers**

Start the disposable PostgreSQL/API environment through the repository's existing test/staging instructions. Scripted payment/refund providers may be injected only in this local/test process. Verify through the actual Mini Program development HTTP composition:

1. cancel a pending never-paid order and observe `CANCELLED` plus available slot;
2. cancel an eligible confirmed order, observe `REFUND_PENDING`, converge scripted authoritative success, refresh to `REFUNDED`, then observe slot available;
3. force one refund failure, keep slot booked, tap real “重试退款”, and converge attempt 2;
4. force one unknown result, confirm same merchant refund number/key is queried and the page never claims success.

Do not add a production fallback to make this test pass.

- [ ] **Step 2: Run focused end-to-end automation**

```bash
TEST_DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test \
  uv run pytest \
    backend/tests/test_order_actions.py \
    backend/tests/test_order_cancellation.py \
    backend/tests/test_order_refund.py \
    backend/tests/test_order_cancellation_concurrency.py \
    backend/tests/test_order_detail.py \
    backend/tests/test_order_list.py \
    backend/tests/test_payment_settlement.py \
    backend/tests/test_payment_concurrency.py \
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
npm run build:miniprogram:development
MINIPROGRAM_TENCENT_MAP_KEY=AAAAA-BBBBB-CCCCC-DDDDD-EEEEE-FFFFF \
  npm run build:miniprogram:production
npm run audit:miniprogram-package
git diff --check
```

Expected: all focused checks PASS. Do not run or repair unrelated full-suite artifact/route failures as part of this slice.

- [ ] **Step 3: Do one non-monetary iPhone acceptance journey**

On a real iPhone against staging:

1. create a pending order but never open/finalize WeChat payment;
2. leave detail, reopen it from “我的订单”;
3. tap “取消订单”, inspect the confirmation copy, confirm once;
4. verify the response becomes `CANCELLED`, no pay/cancel button remains, pull the list to refresh and see “已取消”;
5. verify the same slot is available again and every visible button used in this journey has real behavior.

At 375×812 perform one final visual self-review of the actual HTTP-backed cancelled detail/list. Check centering, badge alignment, chevrons, clipping, footer safe area, correct order data and no stale success copy. This single real preview replaces the temporary Fixture captures; do not repeat a full visual matrix.

- [ ] **Step 4: Record the paid-refund external gate honestly**

`docs/acceptance/user-order-cancellation-and-refund-progress.md` must distinguish:

- automated PostgreSQL/scripted-provider refund evidence: complete;
- pending no-payment iPhone cancellation: complete or exact blocker;
- real paid WeChat refund: `BLOCKED_BY_WECHAT_PROVIDER_INTEGRATION` until the separate adapter/config task merges.

Do not mark B1 paid refund complete and do not make a real payment in this task. After Provider integration, the release coordinator performs exactly one controlled small payment and one full refund; that later evidence may clear the gate without changing this slice's business logic.

- [ ] **Step 5: Remove only this slice's temporary Fixture additions**

After the real HTTP pages and scripted-provider vertical slice pass, delete `order-cancellation-fixture.*` and revert the temporary scenario hooks from `payment-source.ts`, `bootstrap.ts` and `my-orders-fixture.ts`. Preserve the older my-orders Fixture that is still governed by `docs/acceptance/my-orders-progress.md`; do not delete another slice's evidence or routes.

Update build tests to assert the cancellation Fixture token/path is absent from both packages while the production owner cancel endpoint remains reachable through HTTP.

- [ ] **Step 6: Final focused verification and commit**

```bash
npx jest \
  miniprogram/dev/payment-source.test.ts \
  miniprogram/dev/pages/my-orders/index.test.ts \
  miniprogram/pages/order-detail/index.test.ts \
  miniprogram/pages/my-orders/index.test.ts \
  --runInBand
npm run typecheck
npm run build:miniprogram:development
MINIPROGRAM_TENCENT_MAP_KEY=AAAAA-BBBBB-CCCCC-DDDDD-EEEEE-FFFFF \
  npm run build:miniprogram:production
npm run audit:miniprogram-package
node --test tests/build-miniprogram.test.mjs
git diff --check
```

Expected: PASS and `rg -n "order-cancellation-fixture|SCRIPTED_REFUND_SUCCESS" dist/miniprogram-*` returns no matches.

```bash
git add -A \
  miniprogram/dev/order-cancellation-fixture.ts \
  miniprogram/dev/order-cancellation-fixture.test.ts \
  miniprogram/dev/payment-source.ts \
  miniprogram/dev/payment-source.test.ts \
  miniprogram/dev/bootstrap.ts \
  miniprogram/dev/my-orders-fixture.ts \
  miniprogram/dev/pages/my-orders/index.test.ts \
  tests/build-miniprogram.test.mjs \
  docs/acceptance/user-order-cancellation-and-refund-progress.md \
  docs/superpowers/plans/2026-08-16-overall-slice-roadmap.md \
  artifacts/ui/reviews/order-cancellation/README.md
git diff --cached --check
git commit -m "docs: record owner cancellation acceptance"
```

### Completion criteria

This plan is complete only when:

- owner and non-owner boundaries, 24h boundary, idempotency and every listed race pass against real PostgreSQL;
- no Provider call occurs in a transaction/row lock;
- pending no-payment cancellation and full-refund state convergence are honest and monotonic;
- order detail/list render only server-authorized actions and every visible button performs a real operation;
- production package contains no development Fixture or refund Mock;
- one representative 375×812 HTTP-backed preview and one non-monetary iPhone cancellation journey pass;
- real paid WeChat refund remains explicitly gated until the separate Provider integration evidence exists.
