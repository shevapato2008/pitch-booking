# WeChat Pay v3 Provider Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用微信支付 API v3 替换 staging/production 中尚未实现的支付 Provider，并让支付与全额退款通知、查单和 worker 收敛到共享生命周期的权威状态。

**Architecture:** 该轨道只实现外部 Provider、通知验签解密、worker 接线和部署配置。它依赖共享基础已经冻结的 `PaymentProvider`、`RefundProvider`、退款模型和静态 OpenAPI；不得修改 revision `0013`、共享状态枚举或用户/场馆策略。所有外部调用发生在数据库事务之外，Provider 只返回已脱敏的闭合结果，订单、库存和退款状态仍由 convergence service 在锁内写入。

**Tech Stack:** Python 3.13、httpx、cryptography、FastAPI、pytest、微信支付 API v3、Docker Compose。

**Prerequisite:** `2026-08-18-order-lifecycle-foundation.md` 的 Tasks 1–4 已合并并通过；没有商户凭据时可以完成全部离线实现和验证，但不得声称真实支付可用。

**Design:** `docs/superpowers/specs/2026-08-18-order-lifecycle-and-refund-design.md`

---

## Chunk 1: Cryptographic transport and Provider adapters

### Task 1: Implement the narrow WeChat Pay v3 transport

**Files:**

- Create: `backend/app/modules/wechat_pay/__init__.py`
- Create: `backend/app/modules/wechat_pay/transport.py`
- Create: `backend/app/modules/wechat_pay/crypto.py`
- Create: `backend/tests/test_wechat_pay_transport.py`
- Create: `backend/tests/test_wechat_pay_crypto.py`

- [ ] **Step 1: Write offline RED tests with generated temporary RSA keys**

Cover only the production security boundary:

- canonical authorization message is `method + path_with_query + timestamp + nonce + body`;
- merchant request signatures and `Authorization: WECHATPAY2-SHA256-RSA2048` fields are exact;
- response signatures bind timestamp, nonce and raw response bytes and reject altered bytes, wrong key id and stale timestamps;
- notification signatures are verified before AES-256-GCM decryption;
- the 32-byte API v3 key, PEM keys, key IDs and merchant certificate serial fail closed without exposing values;
- httpx timeout never exceeds the shared Provider maximum and transport failures produce a typed unavailable result, not raw exceptions or response bodies.

Run:

```bash
uv run pytest backend/tests/test_wechat_pay_transport.py \
  backend/tests/test_wechat_pay_crypto.py -q
```

Expected: RED because the package does not exist.

- [ ] **Step 2: Implement the minimal injected transport**

Use the existing `httpx` and `cryptography` dependencies; do not add a community SDK. Inject the HTTP client, clock and nonce factory so tests never call the network. Accept WeChat Pay public-key mode as the production verification source; do not silently fall back to an unverified response. Redact authorization, private keys, API v3 key, notification ciphertext and personal data from exceptions/logging.

- [ ] **Step 3: Run GREEN and lint**

```bash
uv run pytest backend/tests/test_wechat_pay_transport.py \
  backend/tests/test_wechat_pay_crypto.py -q
uv run ruff check backend/app/modules/wechat_pay \
  backend/tests/test_wechat_pay_transport.py backend/tests/test_wechat_pay_crypto.py
```

- [ ] **Step 4: Commit**

```bash
git add backend/app/modules/wechat_pay backend/tests/test_wechat_pay_*.py
git diff --cached --check
git commit -m "feat: authenticate wechat pay v3 traffic"
```

### Task 2: Implement payment and refund Providers

**Files:**

- Create: `backend/app/modules/wechat_pay/provider.py`
- Create: `backend/tests/test_wechat_pay_provider.py`
- Create: `backend/tests/test_wechat_pay_composition.py`
- Modify: `backend/app/config.py`
- Modify: `backend/app/main.py`
- Modify: `backend/app/modules/payments/__init__.py`

- [ ] **Step 1: Write Provider RED tests**

Freeze the mapping for:

- JSAPI prepay create, query by merchant order number and close;
- `time_expire` serialized from the shared timezone-aware request;
- launch parameters signed for `wx.requestPayment` using the Mini Program AppID and merchant key;
- create/query full refund and query by merchant refund number;
- successful payment/refund facts include every authoritative identity, amount, currency and timestamp required by convergence;
- `NOTPAY/CLOSED/SUCCESS/PROCESSING/ABNORMAL` and HTTP/business errors map to the existing closed Provider results without inventing success;
- malformed or mismatched provider JSON maps to `UNKNOWN` or is rejected before convergence.

Run:

```bash
uv run pytest backend/tests/test_wechat_pay_provider.py -q
```

Expected: RED because the adapter and settings do not exist.

- [ ] **Step 2: Implement the adapter and production composition**

Add only the required secret settings:

- `WECHAT_PAY_MERCHANT_ID`
- `WECHAT_PAY_MERCHANT_CERT_SERIAL`
- `WECHAT_PAY_MERCHANT_PRIVATE_KEY_PEM_BASE64`
- `WECHAT_PAY_PUBLIC_KEY_ID`
- `WECHAT_PAY_PUBLIC_KEY_PEM_BASE64`
- `WECHAT_PAY_API_V3_KEY`
- absolute HTTPS payment/refund notification URLs without query strings.

Decode and validate the Base64 PEM values without logging them. Build one provider instance for both payment and refund protocols when `PAYMENT_PROVIDER=wechat`. Replace the current raising branch in `payments.build_payment_provider`; use this same production factory from both API and worker composition. Keep the existing mock provider development-only. Missing or malformed production credentials must fail preflight/startup clearly; never fall back to mock.

- [ ] **Step 3: Run GREEN and adjacent Provider tests**

```bash
uv run pytest backend/tests/test_wechat_pay_provider.py \
  backend/tests/test_wechat_pay_composition.py \
  backend/tests/test_payment_provider.py backend/tests/test_refund_provider.py \
  backend/tests/test_payment_creation.py backend/tests/test_payment_reconcile.py -q
uv run ruff check backend/app/modules/wechat_pay backend/app/config.py backend/app/main.py \
  backend/tests/test_wechat_pay_provider.py
```

- [ ] **Step 4: Commit**

```bash
git add backend/app/modules/wechat_pay/provider.py backend/app/config.py backend/app/main.py \
  backend/app/modules/payments/__init__.py backend/tests/test_wechat_pay_provider.py \
  backend/tests/test_wechat_pay_composition.py
git diff --cached --check
git commit -m "feat: call wechat payment and refund APIs"
```

---

## Chunk 2: Notifications, recovery, and live configuration

### Task 3: Verify notifications and converge durable state

**Files:**

- Create: `backend/app/modules/wechat_pay/router.py`
- Create: `backend/app/modules/wechat_pay/notifications.py`
- Create: `backend/app/modules/refunds/convergence.py`
- Create: `backend/app/modules/refunds/worker.py`
- Create: `backend/tests/test_wechat_pay_notifications.py`
- Create: `backend/tests/test_wechat_pay_notification_api.py`
- Create: `backend/tests/test_refund_convergence.py`
- Create: `backend/tests/test_refund_reconciliation_worker.py`
- Modify: `backend/app/main.py`
- Modify: `backend/app/worker.py`
- Modify: `backend/app/modules/payments/convergence.py`
- Modify: `backend/tests/test_payment_settlement.py`
- Modify: `backend/tests/test_order_expiry_worker.py`

- [ ] **Step 1: Write raw-body and replay RED tests**

Cover:

- payment and refund routes consume the exact raw body and required WeChat signature headers, with no user bearer auth;
- signature verification precedes decryption and database lookup;
- invalid/stale/tampered payloads never reach convergence;
- valid duplicate deliveries are allowed into idempotent convergence and are acknowledged after confirming the earlier durable result; no in-memory replay blacklist is used;
- notification success is acknowledged only after durable convergence commits;
- database/provider unavailability returns the contract's retryable failure response;
- payment success invokes existing payment convergence; refund success/failed/processing invokes the shared refund convergence without releasing inventory outside its policy;
- worker queries unresolved payments/refunds after missing or unknown notification, preserving existing leases and merchant numbers.
- refund convergence validates app/merchant/order/payment/refund/amount/currency identities before moving the case/order/inventory; duplicate-charge and payment-inventory-conflict refunds never mutate the slot.
- when a successful payment can fulfil the booking, atomically mark it as the one applied payment; any other success creates exactly one automatic `DUPLICATE_CHARGE` case, while a success that cannot own inventory creates exactly one `PAYMENT_INVENTORY_CONFLICT` case. Concurrent successes result in one applied payment and one refund case, and extra payments never mutate inventory.

Run:

```bash
TEST_DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test \
  uv run pytest backend/tests/test_wechat_pay_notifications.py \
  backend/tests/test_wechat_pay_notification_api.py -q
```

Expected: RED because no verified production notification route exists.

- [ ] **Step 2: Implement minimal notification and worker wiring**

The router must not deserialize JSON before verification. The notification adapter returns the same sanitized authoritative facts as query APIs; it does not write ORM state directly. Preserve the repository lock order and existing leases. Do not add an operations dashboard or notification archive in this slice.

Implement the refund convergence/worker here because it is the only track that owns Provider authority. User and venue services may create a durable refund case/attempt, but they must not declare provider success or release inventory themselves. Extend payment convergence here to create automatic cases for late/extra successes after the shared foundation has established `applied_to_order_at`.

`worker.main()` must construct the same real Provider through the shared factory when no dependency is injected, then construct payment and refund reconciliation services with restart-safe database leases. Add a focused process-restart test that builds a fresh worker from Settings and resumes persisted due work. The worker must never choose the mock outside the existing explicit development gate.

- [ ] **Step 3: Run GREEN plus payment/refund worker regressions**

```bash
TEST_DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test \
  uv run pytest backend/tests/test_wechat_pay_notifications.py \
  backend/tests/test_wechat_pay_notification_api.py \
  backend/tests/test_refund_convergence.py \
  backend/tests/test_payment_notification.py \
  backend/tests/test_payment_settlement.py \
  backend/tests/test_order_expiry_worker.py \
  backend/tests/test_payment_reconciliation_worker.py \
  backend/tests/test_refund_reconciliation_worker.py -q
uv run ruff check backend/app/modules/wechat_pay backend/app/worker.py \
  backend/tests/test_wechat_pay_notifications.py backend/tests/test_wechat_pay_notification_api.py
```

- [ ] **Step 4: Commit**

```bash
git add backend/app/modules/wechat_pay backend/app/modules/payments/convergence.py \
  backend/app/main.py backend/app/worker.py backend/tests/test_payment_settlement.py \
  backend/tests/test_order_expiry_worker.py backend/tests/test_wechat_pay_notifications.py \
  backend/tests/test_wechat_pay_notification_api.py backend/tests/test_refund_convergence.py \
  backend/tests/test_refund_reconciliation_worker.py
git diff --cached --check
git commit -m "feat: converge verified wechat pay notifications"
```

### Task 4: Prepare secrets, deploy, and one bounded real smoke

**Files:**

- Modify: `deploy/.env.example`
- Modify: `deploy/compose.yaml`
- Modify: `deploy/README.md`
- Modify: `scripts/prepare_live_deploy.py`
- Modify: `scripts/deploy_preflight.py`
- Modify: `backend/tests/test_prepare_live_deploy.py`
- Modify: `backend/tests/test_deploy_preflight.py`
- Create: `docs/acceptance/wechat-pay-v3-smoke.md`

- [ ] **Step 1: Write deploy/preflight RED tests**

Require all credentials and the two public HTTPS callback URLs only when the real Provider is selected. Validate lengths/formats without printing secret contents. PEM material is represented as single-line Base64 in the ignored live env, decoded and parsed during preflight; do not place raw multiline PEM in Compose environment syntax. The ignored live env remains mode `0600`; reruns preserve existing valid values. No secret is committed or written to logs.

- [ ] **Step 2: Implement ignored configuration generation and preflight**

Prompt securely or read from the operator environment. Keep private PEMs and API v3 key only in ignored deploy config/secret manager. Document that no Mini Program legal request domain is needed for `api.mch.weixin.qq.com`; the Mini Program talks to our API and uses native `wx.requestPayment`.

- [ ] **Step 3: Run proportional offline verification**

```bash
uv run pytest backend/tests/test_wechat_pay_*.py backend/tests/test_payment_*.py \
  backend/tests/test_refund_*.py backend/tests/test_prepare_live_deploy.py \
  backend/tests/test_deploy_preflight.py -q
uv run ruff check backend/app/modules/wechat_pay scripts/prepare_live_deploy.py \
  scripts/deploy_preflight.py backend/tests/test_wechat_pay_*.py
npm run contract:validate
git diff --check
```

- [ ] **Step 4: Gate the external smoke on real merchant credentials**

If credentials are unavailable, stop after Step 3 and record `BLOCKED_EXTERNAL_CREDENTIALS`; do not use fabricated values or call the real API. If available, deploy once and perform exactly:

1. one smallest practical JSAPI payment from a real iPhone/OpenID;
2. one full refund against that payment;
3. verify DB payment/order/refund facts match WeChat authority and inventory follows the frozen matrix;
4. verify duplicate callbacks and repeated client requests do not duplicate settlement/refund.

Never perform repeated charge/refund loops. Record identifiers only in redacted form.

- [ ] **Step 5: Commit deployment preparation and acceptance record**

```bash
git add deploy scripts/prepare_live_deploy.py scripts/deploy_preflight.py \
  backend/tests/test_prepare_live_deploy.py backend/tests/test_deploy_preflight.py \
  docs/acceptance/wechat-pay-v3-smoke.md
git diff --cached --check
git commit -m "chore: prepare wechat pay v3 deployment"
```
