# 散客申请与队长审核 · Artifact visual review

## Status

- Target viewport: `375 × 812` CSS pixels.
- Reference Artifact: development-only; `production_enabled: false`.
- Official runtime: WeChat DevTools RC `2.02.2608031`, iPhone X simulator, logical `375 × 812`, DPR `3`, simulator zoom `97%`.
- Reference self-review: `PASS`.
- Native implementation self-review: `PASS`.
- User visual gate: `APPROVED` (confirmed by the user on 2026-08-24).
- Review board: [review-board.html](review-board.html).

## Native capture and normalization

The six implementation frames were captured with the official simulator screenshot action. Each raw image was `728 × 1576`; the repository keeps a single proportional resize at exactly `375 × 812`, with no crop or padding. Each reference/implementation pair then generated:

- a `750 × 812` side-by-side frame;
- a `375 × 812` 50% overlay;
- a `375 × 812` difference frame.

The DevTools project used the checked-in `project.config.json`, whose `miniprogramRoot` points to `dist/miniprogram-development/`, and the `C1a 场景预览` compile condition. The final compile showed zero errors.

## Evidence matrix

| State | Reference | Implementation | Side by side | Overlay 50% | Difference | Result |
| --- | --- | --- | --- | --- | --- | --- |
| `anonymous-detail` | [reference](anonymous-detail-reference-375x812.png) | [implementation](anonymous-detail-implementation-375x812.png) | [side by side](anonymous-detail-side-by-side.png) | [overlay](anonymous-detail-overlay-50.png) | [difference](anonymous-detail-difference.png) | `PASS` |
| `application-ready` | [reference](application-ready-reference-375x812.png) | [implementation](application-ready-implementation-375x812.png) | [side by side](application-ready-side-by-side.png) | [overlay](application-ready-overlay-50.png) | [difference](application-ready-difference.png) | `PASS` |
| `applied-detail` | [reference](applied-detail-reference-375x812.png) | [implementation](applied-detail-implementation-375x812.png) | [side by side](applied-detail-side-by-side.png) | [overlay](applied-detail-overlay-50.png) | [difference](applied-detail-difference.png) | `PASS` |
| `captain-pending` | [reference](captain-pending-reference-375x812.png) | [implementation](captain-pending-implementation-375x812.png) | [side by side](captain-pending-side-by-side.png) | [overlay](captain-pending-overlay-50.png) | [difference](captain-pending-difference.png) | `PASS` |
| `joined-detail` | [reference](joined-detail-reference-375x812.png) | [implementation](joined-detail-implementation-375x812.png) | [side by side](joined-detail-side-by-side.png) | [overlay](joined-detail-overlay-50.png) | [difference](joined-detail-difference.png) | `PASS` |
| `rejected-detail` | [reference](rejected-detail-reference-375x812.png) | [implementation](rejected-detail-implementation-375x812.png) | [side by side](rejected-detail-side-by-side.png) | [overlay](rejected-detail-overlay-50.png) | [difference](rejected-detail-difference.png) | `PASS` |

## Native interaction review

The official runtime completed both journeys against the same isolated Fixture:

1. Anonymous detail → login → open application → cancel once and verify return to `NONE`.
2. Reopen the application, enter the Artifact-aligned display name/note, select forward, check both confirmations, and submit to `APPLIED`.
3. Refresh the pending result and verify it remains `APPLIED`.
4. Enter the captain view, open the accept confirmation sheet, verify both the close mark and `返回审核` preserve `APPLIED`, then confirm acceptance.
5. Use the empty-state applicant switch, read `JOINED` on the same detail, and verify terminal refresh is stable.
6. Reset the rejection branch, resubmit, confirm decline, read `REJECTED` on the same detail, and verify terminal refresh is stable.

The confirmation sheet is not one of the six frozen matrix states, but it was inspected in the official runtime. Its scrim, title, complete X mark, `返回审核` action, confirm action, fixed bottom placement, and safe-area spacing were all visible and unclipped.

## Visual self-review

All six reference, implementation, side-by-side, overlay, and difference images were manually inspected. The implementation preserves the approved information hierarchy and column geometry: five position choices stay on one row, the two unchecked consent controls are visible without premature validation errors, the detail uses the confirmed-booking/game/metrics/status/detail composition, and the captain view keeps one compact applicant card with fixed `婉拒` / `接受加入` actions.

Buttons use explicit flex centering on both axes. Repeated controls and badges align, back/check/X marks are complete, card and text boundaries are not clipped, and fixed footers reserve content space plus the device safe area.

Accepted runtime-only differences:

- the native status bar, notch, WeChat capsule, home indicator, scroll indicator, and font rasterization differ from the browser Artifact;
- the native safe area raises footer controls above the home indicator;
- `joined-detail` honestly shows `剩余 3 个名额`, while the frozen static reference shows `4`, because accepting this application consumes one place.

No remaining product-layout blocker was found in self-review. The user approved the visual gate on 2026-08-24, so C1a may proceed to contract and backend integration.

## Interaction boundary

This slice still uses the isolated development Fixture for `NONE → APPLIED → JOINED|REJECTED`; it does not write production registration data. Production source and production build output exclude every C1a route and Fixture marker. The visual gate therefore validates the native frontend journey only, not the future backend contract or production end-to-end capability.
