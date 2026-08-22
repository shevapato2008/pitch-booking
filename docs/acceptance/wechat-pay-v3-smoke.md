# WeChat Pay API v3 bounded smoke

Status: `STAGING_CONTROLLED_OWNER_AND_VENUE_REFUNDS_ACCEPTED_MANUAL_REPLAY_NOT_RUN`

The Provider, notification verification/decryption, durable payment/refund convergence, worker
recovery, deploy generation, and preflight are verified offline. The real Provider-backed API and
worker were deployed for the bounded payment/refund run at revision
`bd4c9b3dc4f259a2a6cf630fc90da19720d64006` on
`ucloud-v100`. An authenticated query for a guaranteed-nonexistent merchant order returned
`NOT_FOUND`, and both public notification routes rejected an invalid signature with the closed
`WECHAT_NOTIFICATION_INVALID` response.

On 2026-08-22, experience version `0.1.3` completed one controlled CNY 0.01 JSAPI payment and its
one owner-requested full refund on a real iPhone. The real payment notification converged the
server authority, the refund reached its terminal authority, and the user confirmed that the full
amount returned to the original WeChat balance account. This closes the normal-path bounded
payment/refund terminal acceptance only; forced recovery and manual callback redelivery were not
run. After this bounded run, staging revision `87da5d50cfdb70e954ec067dfb93c64a36718e5e`
activated the already-implemented venue refund route behind the real Provider configuration gate;
experience version `0.1.3` then completed a second, separate CNY 0.01 payment and one venue-requested
full refund. The second refund reached the original WeChat balance account and converged to
`Order.REFUNDED / Slot.CLOSED` with exactly one payment, one refund case, and one successful refund
attempt. No callback body was retained or manually replayed.

## Preconditions

- The real merchant ID, certificate serial/private key, platform public-key ID/PEM, and API v3 key
  are supplied through ignored mode-`0600` deploy configuration. Both RSA keys are verified as
  2048-bit, and the API v3 key passed the deployment preflight without being logged or committed.
- Both callback URLs use the `PUBLIC_API_BASE_URL` public HTTPS origin, pass
  `scripts.preflight_deploy`, are not on its static IANA/RFC special-use denylist, and are reachable
  by WeChat Pay.
- A real iPhone/OpenID is available and the operator authorizes two separate smallest practical
  charges, each followed by exactly one full refund: first by the owner path, then by the venue path.

## Two bounded normal-path runs

1. Complete one JSAPI payment on the real iPhone, confirm its payment/order/slot authority, then
   request and verify one owner full refund.
2. After the venue refund route is activated, complete a second independent JSAPI payment, confirm
   its payment/order/slot authority, then request and verify one venue full refund.
3. For each run, verify the user funds, terminal order state, slot semantics, and uniqueness of the
   payment/refund graph before starting another funds operation.
4. Manual callback redelivery and forced active-query/worker recovery remain separate resilience
   exercises and were not run during these two normal-path acceptances.

Record only redacted identifiers and timestamps below. Never store keys, authorization headers,
notification ciphertext, OpenID, phone details, or full provider response bodies.

## Result

- Staging revision: `bd4c9b3dc4f259a2a6cf630fc90da19720d64006`
- Provider composition: API/worker healthy; authenticated nonexistent-order query `NOT_FOUND`
- Callback composition: payment/refund invalid-signature probes both returned `400`
- Pre-smoke authority check: zero active or claimed payment/refund recovery records
- Experience version: `0.1.3`, controlled staging only; not submitted for formal review or public
  release
- Payment result: one CNY 0.01 JSAPI payment reached `Payment.SUCCESS / Order.CONFIRMED /
  Slot.BOOKED`, with one applied payment and no payment recovery claim
- Payment convergence: the authenticated real notification path converged directly;
  `reconcile_attempts=0`, so the recovery worker was not needed for this payment
- Refund result: one full refund reached `Order.REFUNDED / Slot.AVAILABLE`; exactly one refund case
  and one successful attempt exist, with no active or claimed refund work
- User-funds check: the CNY 0.01 refund was confirmed received in the original WeChat balance
  account
- Inventory cleanup: after refund released the slot, the operator changed the dedicated test slot
  to `CLOSED`; it is unlocked and the real payment/refund ledger remains intact
- Forced active-query/worker recovery: not run in this bounded smoke
- Manual duplicate-delivery check: not run; no callback body was retained or replayed, so real
  Provider duplicate-redelivery acceptance is not claimed
- Venue refund route: activated later at staging revision `87da5d50cfdb70e954ec067dfb93c64a36718e5e`;
  unauthenticated requests return `401`
- Venue refund result: a second, separate CNY 0.01 JSAPI payment reached
  `Payment.SUCCESS / Order.CONFIRMED / Slot.BOOKED`; the authorized venue then submitted exactly one
  full `VENUE_CANCELLED` refund, which reached `Order.REFUNDED / Slot.CLOSED`
- Venue refund authority: exactly one applied successful payment, one full-amount CNY refund case,
  and one successful attempt exist; no active, failed, duplicate, or claimed payment/refund work
  remains
- Venue refund user-funds check: the second CNY 0.01 refund was confirmed received in the original
  WeChat balance account
- Venue refund device check: the venue list, renter detail, and inventory refreshed to “已退款 / 订单已结束”,
  “退款已完成”, and “已关闭” respectively
- Final status: `STAGING_CONTROLLED_OWNER_AND_VENUE_REFUNDS_ACCEPTED_MANUAL_REPLAY_NOT_RUN`
