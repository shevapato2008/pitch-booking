# Payment confirmation and confirmed order progress

Status: `STAGING_CONTROLLED_REAL_PAYMENT_ACCEPTED_FINAL_DELIVERY_DEFERRED`

Final delivery: **DEFERRED — broader recovery, duplicate-delivery, Android, and release gates pending**

Real WeChat Pay live status: **CONTROLLED EXPERIENCE BUILD ONLY — not formally reviewed or publicly released**

## Controlled real-Provider checkpoint

On 2026-08-22, experience version `0.1.3` completed one real CNY 0.01 JSAPI payment on an
iPhone. The authenticated payment notification converged exactly one applied `Payment.SUCCESS`,
`Order.CONFIRMED`, and `Slot.BOOKED`; payment recovery was not needed. The same owner then
requested one full refund, which converged to `Order.REFUNDED / Slot.AVAILABLE`, and the user
confirmed the full amount returned to the original WeChat balance account. Exactly one payment,
one refund case, and one successful refund attempt remain in the real ledger; the dedicated test
slot was subsequently closed.

This is one controlled staging case, not general availability. No original callback body was
retained or manually redelivered, forced recovery was not run, Android was not tested, and the
venue refund route remains disabled.

## Checkpoint

The payment-confirmation slice has reached its local server-authority acceptance
boundary. The automated journey uses the real FastAPI HTTP routes and a disposable
PostgreSQL database. Only an explicitly enabled development
`MockPaymentProvider` supplies payment authority; a cashier callback never confirms
an order by itself.

At that historical checkpoint, no public deployment, legal-domain change, real merchant
credential, real payment, or customer charge was used. The controlled real-Provider checkpoint
above supersedes only those historical availability statements; the local Mock evidence below
remains valid regression coverage.

## Local journey accepted

The focused integration test proves this state transition:

```text
Order PENDING_PAYMENT / Slot LOCKED
→ POST /pay returns PREPAY_CREATED
→ simulated client cashier success leaves the server order pending
→ verified development authority reports SUCCESS
→ Payment SUCCESS / Order CONFIRMED / Slot BOOKED
```

It also verifies:

- same-key replay and a duplicate click with a new key reuse one payment attempt
  and one Provider order;
- the order remains `PENDING_PAYMENT` after the client-only cashier callback;
- an authority body containing an unexpected amount is rejected with `422` and
  cannot confirm the order;
- duplicate success authority and a later stale `CLOSED` result cannot regress a
  successful payment;
- the final slot lock owner and lock deadline are cleared;
- runtime Mock configuration is rejected in test, staging, and production.

Amount, currency, AppID, merchant ID, merchant order number, transaction collision,
restart recovery, and expiry-before-close safety remain covered by the focused
payment settlement, recovery-worker, and payment-expiry regression suites. They are
not reimplemented in the local journey test.

## Automated evidence

- `backend/tests/test_payment_local_journey.py`: local HTTP/PostgreSQL authority
  journey and runtime Mock isolation
- `backend/tests/test_deploy_preflight.py`: deployment configuration rejects Mock
- `backend/tests/test_payment_settlement.py`: authoritative fact mismatch and
  duplicate/out-of-order convergence
- `backend/tests/test_payment_reconciliation_worker.py`: persisted restart recovery
  and multi-worker claims
- `backend/tests/test_payment_expiry.py`: unresolved payment blocks inventory release

The disposable integration database verifies exact row semantics without retaining
customer data, full phone numbers, merchant order numbers, signatures, or secrets in
this document.

## Mini Program local acceptance

The importable development-HTTP build must use:

```text
MINIPROGRAM_DEV_BOOKING_SOURCE=http
MINIPROGRAM_API_BASE_URL=http://127.0.0.1:<local-port>
```

The local API must be started only with the explicit development Mock switches:

```text
APP_ENV=development
WECHAT_PROVIDER=development
PAYMENT_PROVIDER=mock
ENABLE_MOCK_PAYMENT_PROVIDER=true
```

The WeChat Developer Tools simulator journey was executed locally on 2026-07-29
against the development HTTP build and a real local PostgreSQL order. The visible
sequence was:

```text
待支付 / 立即支付
→ 开发态模拟收银台 / 模拟支付，不会扣款
→ 正在确认支付 / 支付确认中
→ development authority SUCCESS
→ 预订成功 / 已支付
```

The final redacted database check recorded exactly one payment for the order,
`Payment.SUCCESS`, `Order.CONFIRMED`, `Slot.BOOKED`, a present `paid_at`, and cleared
slot lock fields. No bearer token, full phone number, merchant order number, signing
material, or Provider secret is retained here.

The journey also exposed a legacy Alembic history-drift case in the reused local
database. Corrective migration `0005` repaired the missing identity AppID column and
unique constraint in place; the database was not dropped or reset before the journey
was rerun successfully.

The production package contains neither the development authority driver nor the
simulated cashier binding.

Developer Tools local-domain relaxation is a local debugging aid only. It is not
evidence of an approved WeChat request domain, public HTTPS, or iOS/Android delivery.

## Deferred final-delivery gates

The remaining items define broader delivery beyond the single controlled staging case:

- [x] Bind the Mini Program AppID to the merchant account and approve the operating
  category and payment capability.
- [x] Configure the merchant private key, certificate serial number, API v3 key, and
  WeChat payment public key.
- [x] Implement and review the real `WeChatPaymentProvider`, raw request signing, and
  notification signature verification/decryption.
- [x] Publish the HTTPS notification endpoint and configure WeChat legal domains on
  an ICP-approved `modelstella.com` host.
- [x] Accept one real-device iPhone `wx.requestPayment` and full-refund behavior.
- [ ] Complete at least five small real-payment cases covering notification, active
  query, close, duplicate delivery, and recovery.
- [ ] Complete iOS and Android experience-build acceptance.
- [x] Keep the runtime simulated payment binding excluded from the production package.
- [ ] Archive final, redacted production evidence after the broader acceptance matrix.
- [ ] Promote beyond the controlled experience build and obtain explicit final delivery
  acceptance.

Until every remaining item above passes, this slice has a controlled real-Provider staging
acceptance but is not finally delivered or generally available WeChat Pay.
