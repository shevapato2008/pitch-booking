# Owner cancellation preview review

Status: approved by the user on 2026-08-20.

The development-only `order-cancellation` booking source opens the existing production order detail and My Orders pages. The default detail scenario is `confirmed-cancellable`; the list uses authoritative fixture projections for refund pending, refunded, and refund failed.

Review against the existing visual references:

- `artifacts/ui/reviews/payment-confirmation/reference-confirmed-375x812.png`
- `artifacts/ui/reviews/my-orders/ready-reference-375x812.png`

Evidence captured from WeChat DevTools RC 2.02.2608031 with the iPhone X model set to
375×812:

- `implementation-confirmed-375x812.png`
- `confirmed-side-by-side.png`
- `confirmed-overlay-50.png`
- `confirmed-difference.png`
- `implementation-list-375x812.png`
- `list-side-by-side.png`
- `list-overlay-50.png`
- `list-difference.png`

The DevTools screenshot control did not produce a file, so the read-only DevTools window
capture was cropped to the simulator and normalized to 375×812. The running model,
page paths and visible accessibility tree were independently checked in DevTools before
capture. No QR code or local configuration is included.

Self-review result:

- the confirmed detail keeps the approved card geometry while replacing the old inert
  footer with a real, secondary `取消并发起全额退款` action;
- button text is horizontally and vertically centered, the fixed footer does not cover
  cancellation copy, and the iPhone 14 Pro Max representative safe-area smoke has clear
  bottom gesture spacing;
- refund-pending, refunded and refund-failed badges use consistent height/alignment,
  semantic color plus text, intact chevrons and whole-card navigation;
- all visible copy matches the fixture's authoritative lifecycle semantics; there is no
  immediate refund or slot-release promise.

Intentional comparison differences are the iPhone X system chrome, current fixture data,
the real cancellation action, and a three-card terminal list with no load-more cursor.

Decision: PASS — the user explicitly approved the owner cancellation/refund preview in
this session after reviewing the real-runtime detail and list evidence at the target
viewport.

This visual approval opens the backend phase only. It does not claim a production
cancellation backend, Provider refund completion, or slot release on refund acceptance.

## Post-approval implementation status

The owner cancel API, durable refund enqueue/retry, strict Mini Program decoder and real
HTTP adapter are now implemented through `d714cda`. A disposable-PostgreSQL, real-Uvicorn
network smoke verified unpaid cancellation, paid refund enqueue and failed-attempt retry
with `PAYMENT_PROVIDER=disabled`, zero Provider calls and zero terminal refund-success
writes.

## HTTP-backed device acceptance and preview retirement

On 2026-08-20, an experience member used version `0.1.2` against the real staging API and
completed the nine-step non-monetary iPhone journey. The order appeared as pending, exposed
the real cancel confirmation without a payment action, became cancelled after confirmation,
and remained cancelled after list refresh and detail reopen. The representative 375×812
review also passed button centering, badge/chevron integrity, clipping and bottom safe-area
checks.

The post-journey authoritative check found `CANCELLED`, the slot `AVAILABLE`, and zero
Payment, RefundCase or RefundAttempt rows. The controlled acceptance Order, Slot and
idempotency record were then removed without changing the user/membership/venue/pitch
identity graph.

The development-only cancellation Fixture, route fragment and temporary bootstrap/build
selector have now been retired. Production order detail/My Orders pages, real HTTP wiring,
backend route and audit deny rules remain. Online booking, payment and real refund stay
disabled, and paid terminal refund acceptance remains
`BLOCKED_BY_WECHAT_PROVIDER_INTEGRATION`; this review does not claim a successful paid
refund or Provider settlement.
