# 我的订单 · Artifact visual review

## Status

- Target viewport: 375 × 812.
- Reference Artifact self-review: complete on 2026-08-18; final visual approval is not claimed.
- Representative captures: `map-entry`, `ready`, `empty`, and `error` only.
- Additional interactive previews: `loading` and `load-more-error` remain available through the reference query and `?controls=1` control panel.
- Production remains disabled; no native Fixture, production route, contract, backend, or migration is part of this checkpoint.
- User explicitly deferred the A3 CREATE real-device acceptance gate for B1 MVP progress on 2026-08-18.

## Reference sources

- [Live map entry](../../references/my-orders.html?state=map-entry)
- [Live ready list](../../references/my-orders.html?state=ready)
- [Live empty list](../../references/my-orders.html?state=empty)
- [Live first-load error](../../references/my-orders.html?state=error)
- [Live loading](../../references/my-orders.html?state=loading)
- [Live load-more error](../../references/my-orders.html?state=load-more-error)
- [All preview controls](../../references/my-orders.html?state=map-entry&controls=1)

## 375 × 812 reference evidence

| State | Reference | Native implementation | Side by side | Overlay 50% | Difference |
| --- | --- | --- | --- | --- | --- |
| `map-entry` | [map-entry-reference-375x812.png](map-entry-reference-375x812.png) | not started | not started | not started | not started |
| `ready` | [ready-reference-375x812.png](ready-reference-375x812.png) | not started | not started | not started | not started |
| `empty` | [empty-reference-375x812.png](empty-reference-375x812.png) | not started | not started | not started | not started |
| `error` | [error-reference-375x812.png](error-reference-375x812.png) | not started | not started | not started | not started |

## Self-review record

One uninterrupted headed Playwright CLI session used real Chromium 151 against a local static
server at `http://127.0.0.1:8127/my-orders.html?state=<state>`. The browser viewport was
`375 × 812` CSS pixels at device pixel ratio 1; every PNG was independently verified as
`375 × 812` pixels. The embedded layout audit returned `[]` for all six states, and the browser
reported zero console errors or warnings.

The live interaction pass verified `map-entry → ready`, order-card route selection,
`ready → load-more-error`, `error → loading`, and `empty → map-entry`. The ready scroller
reported `734px` client height and `752px` content height, and reached an 18px bottom scroll
offset without horizontal overflow.

### Composition and hierarchy

- The map entry is a separate full-map composition. Its second row preserves the existing
  search-center explanation on the left and a fixed-width “我的订单” pill on the right without
  disturbing the location control, sheet title, filters, or venue rows.
- The ready frame exposes pending, closing, confirmed, expired, and payment-exception cards in
  newest-first order. Empty and first-load error retain the same native-navigation and authority
  context rather than looking like unrelated pages.

### Geometry, alignment, and touch targets

- Button labels use explicit flex/grid two-axis centering. The initial audit found the map sheet
  handle at 36px and the “我的订单” label shifted by its icon; the handle is now 44px and the
  icon is independently positioned so the text itself remains horizontally and vertically
  centered.
- Every visible button and icon control measured at least 44 × 44 CSS pixels. Amount right edges,
  status-line starts, and trailing chevrons align consistently across all five order cards.

### Typography, status contrast, and long labels

- System typography, repository navy/slate neutrals, trustworthy blue, success green, and error
  red preserve the existing Mini Program language. Every status combines text with color, and
  computed status-label and explanation contrast passed the 4.5:1 audit threshold.
- The deliberately long search-center value truncates with a visible ellipsis inside the left
  column; it never overlaps or compresses the 124px order-entry target. Long venue names remain
  contained inside their card columns.

### Icons, chevrons, scrolling, and safe area

- Search, location, order, back, state, marker, and chevron assets are local inline vectors with
  a consistent outline style; there are no emoji or remote assets. All five ready cards retain a
  complete trailing chevron inside a 44px-tall alignment region.
- The order list and map directory scroll vertically with hidden browser scrollbars, no horizontal
  overflow, and no fixed bottom action obscuring content. The list keeps 24px bottom padding and
  the map sheet includes `env(safe-area-inset-bottom)`.

### Visible concern carried to native preview

- The ready reference is intentionally dense so one 375 × 812 frame proves all five status
  projections. The real Mini Program preview must still confirm platform-native chrome, largest
  text behavior, and the same scrolling rhythm; this Artifact self-review is not final visual
  approval.

## Capture hashes

- `map-entry-reference-375x812.png`: `e726543b885f5462e391c519bb387360b8526cec4fb733efcb2455ceaff6fb9c`
- `ready-reference-375x812.png`: `84c965456fb0ac4b238aad3bb727c9f1f9ee06011765aa8efa4355e1fec4cfc6`
- `empty-reference-375x812.png`: `6dbafded81fb62e72e83f7658efcc427f37a4f3f5d841a89c419113025c35fbd`
- `error-reference-375x812.png`: `51700c34fbf3b5463001518b0b5d62d04028ca83f7239603ab9731041f09d686`

## Visual gate

The reference board is ready for a visual decision. Task 2 must not start until the user
explicitly confirms the visual or an authorized delegated decision is recorded.
