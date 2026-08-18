# WeChat Pay API v3 bounded smoke

Status: `BLOCKED_EXTERNAL_CREDENTIALS`

The Provider, notification verification/decryption, durable payment/refund convergence, worker
recovery, deploy generation, and preflight are verified offline. No request has been sent to a real
WeChat Pay merchant API and no payment/refund availability claim is made.

## Preconditions

- A merchant operator supplies the real merchant ID, certificate serial/private key, platform
  public-key ID/PEM, and 32-byte API v3 key through ignored deploy config or a secret manager.
- Both public HTTPS callback URLs pass `scripts.preflight_deploy` and are reachable by WeChat Pay.
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

- Payment identifier: not run
- Refund identifier: not run
- Database authority check: not run
- Duplicate-delivery check: not run
- Final status: `BLOCKED_EXTERNAL_CREDENTIALS`
