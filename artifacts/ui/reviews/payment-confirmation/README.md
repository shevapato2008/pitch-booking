# Payment confirmation visual review

## Status

- Artifact state: frozen for implementation
- Implementation visual status: awaiting same-viewport capture and user confirmation
- Target viewport: 375 × 812
- No evidence images have been captured in Task 1.
- Active order cancellation belongs to the next slice.
- Real WeChat integration and final production delivery remain deferred.

## Frozen references

| State | Reference source |
| --- | --- |
| Pending | `../../references/payment-pending.html` |
| Confirming | `../../references/payment-confirming.html` |
| Confirmed | `../../references/booking-confirmed.html` |

- Frozen payment-pending reference SHA-256: `9b41258e0d32f6e08379eb1bfce29fc6db1d32b381fadfa229631819f4c7170b`
- Frozen payment-confirming reference SHA-256: `72e650b4fc034fee6166f7b0a901234c631bedeaef939320eb67054167e8815a`
- Frozen booking-confirmed reference SHA-256: `cd48f116370f653d61f5ba57f75f9f6ef20b3b892ea5a872a51437f57e64f159`

The references preserve the approved order-detail hierarchy: stable status region, order
snapshot, contact, arrival/service information, rules, and a safe-area-aware bottom action.
Each file renders exactly one state and is fixed at 375 × 812 for deterministic capture.

## Reserved evidence paths

The following paths are reserved now and will be populated only after the real Mini Program
implementation is ready for the visual gate.

| State | Reference | Implementation | Side-by-side | Overlay 50% | Difference |
| --- | --- | --- | --- | --- | --- |
| Pending | `reference-pending-375x812.png` | `implementation-pending-375x812.png` | `side-by-side-pending.png` | `overlay-50-pending.png` | `difference-pending.png` |
| Confirming | `reference-confirming-375x812.png` | `implementation-confirming-375x812.png` | `side-by-side-confirming.png` | `overlay-50-confirming.png` | `difference-confirming.png` |
| Confirmed | `reference-confirmed-375x812.png` | `implementation-confirmed-375x812.png` | `side-by-side-confirmed.png` | `overlay-50-confirmed.png` | `difference-confirmed.png` |

## Accessibility and token validation

- System font and repository color roles are used throughout.
- Every button has a minimum height of 44px; the fixed footer includes the bottom safe-area inset.
- Layout spacing follows the repository's 4/8px rhythm.
- Normal text contrast must remain >= 4.5:1. Verified pairs: `#10243E` on `#FFFFFF` is 15.63:1; `#10243E` on `#F8FAFC` is 14.93:1; `#64748B` on `#FFFFFF` is 4.76:1; `#FFFFFF` on `#0369A1` is 5.93:1; and disabled `#10243E` on `#DBE5EC` is 12.23:1.
- The success check is an accessible inline vector with an `aria-label`, not an emoji. Green `#059669` on white is reserved for the large non-text icon (3.77:1); success copy remains dark text.
- Confirmation uses a truly disabled native button and explicitly states that the server is authoritative, preventing duplicate-payment semantics.
- No unofficial payment-provider or WeChat brand asset is used.

## Nine-category difference log

Complete every row for pending, confirming, and confirmed before requesting visual approval.

| Category | Pending | Confirming | Confirmed |
| --- | --- | --- | --- |
| Composition | Pending capture | Pending capture | Pending capture |
| Geometry / spacing | Pending capture | Pending capture | Pending capture |
| Hierarchy | Pending capture | Pending capture | Pending capture |
| Typography | Pending capture | Pending capture | Pending capture |
| Colors / materials | Pending capture | Pending capture | Pending capture |
| Vector assets | Pending capture | Pending capture | Pending capture |
| Copy | Pending capture | Pending capture | Pending capture |
| Interaction / state semantics | Pending capture | Pending capture | Pending capture |
| Accessibility | Pending capture | Pending capture | Pending capture |

Automated layout checks do not constitute visual approval. Compare the reference,
implementation, side-by-side, 50% overlay, and difference images at the same target viewport;
record all nine categories above and obtain explicit user confirmation before backend work.
