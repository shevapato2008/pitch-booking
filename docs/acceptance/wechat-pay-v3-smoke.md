# WeChat Pay API v3 bounded smoke

Status: `STAGING_PROVIDER_DEPLOYED_PENDING_CONTROLLED_SMOKE`

The Provider, notification verification/decryption, durable payment/refund convergence, worker
recovery, deploy generation, and preflight are verified offline. The real Provider-backed API and
worker are deployed to staging at revision `bd4c9b3dc4f259a2a6cf630fc90da19720d64006` on
`ucloud-v100`. An authenticated query for a guaranteed-nonexistent merchant order returned
`NOT_FOUND`, and both public notification routes rejected an invalid signature with the closed
`WECHAT_NOTIFICATION_INVALID` response. No real charge or refund has been run, so no
payment/refund availability claim is made.

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
- Venue refund route: remains disabled (`404`) until the paid smoke succeeds
- Payment identifier: not run
- Refund identifier: not run
- Database authority check: not run
- Duplicate-delivery check: not run
- Final status: `STAGING_PROVIDER_DEPLOYED_PENDING_CONTROLLED_SMOKE`
