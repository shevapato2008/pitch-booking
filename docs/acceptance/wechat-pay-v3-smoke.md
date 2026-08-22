# WeChat Pay API v3 bounded smoke

Status: `STAGING_CONTROLLED_PAYMENT_REFUND_ACCEPTED_MANUAL_REPLAY_NOT_RUN`

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
only its unauthenticated `401` boundary was probed, and no venue refund acceptance is claimed here.

## Preconditions

- The real merchant ID, certificate serial/private key, platform public-key ID/PEM, and API v3 key
  are supplied through ignored mode-`0600` deploy configuration. Both RSA keys are verified as
  2048-bit, and the API v3 key passed the deployment preflight without being logged or committed.
- Both callback URLs use the `PUBLIC_API_BASE_URL` public HTTPS origin, pass
  `scripts.preflight_deploy`, are not on its static IANA/RFC special-use denylist, and are reachable
  by WeChat Pay.
- A real iPhone/OpenID is available and the operator authorizes one smallest practical charge plus
  its one full refund.

## One bounded run

1. Create one JSAPI payment on the real iPhone and complete it once.
2. Confirm the payment notification or recovery query converges the payment/order/slot authority.
3. Request one full refund against that payment.
4. Confirm the refund notification or recovery query converges the refund/order/slot authority.
5. Redeliver the recorded callbacks once and repeat the client reconcile request once; confirm no
   duplicate settlement, refund case, attempt, or inventory mutation.

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
  unauthenticated requests return `401`, but no authenticated venue refund was sent or accepted
- Final status: `STAGING_CONTROLLED_PAYMENT_REFUND_ACCEPTED_MANUAL_REPLAY_NOT_RUN`
