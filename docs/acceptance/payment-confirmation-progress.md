# Payment confirmation and confirmed order progress

Status: `LOCAL_ACCEPTED_FINAL_DELIVERY_DEFERRED`

Final delivery: **DEFERRED — ICP/WeChat merchant prerequisites pending**

Real WeChat Pay live status: **NOT DEPLOYED**

## Checkpoint

The payment-confirmation slice has reached its local server-authority acceptance
boundary. The automated journey uses the real FastAPI HTTP routes and a disposable
PostgreSQL database. Only an explicitly enabled development
`MockPaymentProvider` supplies payment authority; a cashier callback never confirms
an order by itself.

This checkpoint does not claim that WeChat Pay is configured, reachable, or live.
No public deployment, legal-domain change, real merchant credential, real payment,
or customer charge was used.

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

Each item remains open because ICP filing, WeChat certification, or merchant payment
prerequisites are not yet available:

- [ ] Bind the Mini Program AppID to the merchant account and approve the operating
  category and payment capability.
- [ ] Configure the merchant private key, certificate serial number, API v3 key, and
  WeChat platform certificates.
- [ ] Implement and review the real `WeChatPaymentProvider`, raw request signing, and
  notification signature verification/decryption.
- [ ] Publish the HTTPS notification endpoint and configure WeChat legal domains on
  an ICP-approved `modelstella.com` host.
- [ ] Accept real-device `wx.requestPayment` behavior.
- [ ] Complete at least five small real-payment cases covering notification, active
  query, close, duplicate delivery, and recovery.
- [ ] Complete iOS and Android experience-build acceptance.
- [ ] Remove the runtime simulated payment binding and archive final, redacted
  production evidence.
- [ ] Deploy and obtain explicit final delivery acceptance.

Until every item above passes, this slice is locally accepted for continued
development but is not finally delivered and must not be described as live WeChat
Pay.
