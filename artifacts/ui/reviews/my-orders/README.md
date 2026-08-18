# 我的订单 · Artifact visual review

## Status

- Target viewport: 375 × 812.
- Task 1 reference Artifact: independently approved at commit `2b438acd`.
- Task 2 development-only native preview: implemented and source/build checks are GREEN.
- Representative captures: `map-entry`, `ready`, `empty`, and `error` only.
- Additional interactive previews: `loading` and `load-more-error` remain available through the reference query and `?controls=1` control panel.
- Production remains disabled; the native Fixture and both preview routes are excluded from the production manifest/package. No production page, service, composition, contract, backend, or migration is part of this checkpoint.
- User explicitly deferred the A3 CREATE real-device acceptance gate for B1 MVP progress on 2026-08-18.
- Native capture is blocked. The one proportional WeChat DevTools attempt returned `WECHAT_PORT_MISMATCH` because the running IDE automation server is listening on another port. No implementation PNG, comparison image, manual native visual review, or independent visual decision is claimed.

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
| `map-entry` | [map-entry-reference-375x812.png](map-entry-reference-375x812.png) | blocked; not produced | blocked; not produced | blocked; not produced | blocked; not produced |
| `ready` | [ready-reference-375x812.png](ready-reference-375x812.png) | blocked; not produced | blocked; not produced | blocked; not produced | blocked; not produced |
| `empty` | [empty-reference-375x812.png](empty-reference-375x812.png) | blocked; not produced | blocked; not produced | blocked; not produced | blocked; not produced |
| `error` | [error-reference-375x812.png](error-reference-375x812.png) | blocked; not produced | blocked; not produced | blocked; not produced | blocked; not produced |

## Task 2 source and build verification

The required TDD RED was observed before adding the Fixture or either native page:

```text
npx jest miniprogram/dev/pages/my-orders-map/index.test.ts miniprogram/dev/pages/my-orders/index.test.ts --runInBand
2 suites failed, 9 tests failed — the two page modules and central Fixture did not exist.
```

After the smallest implementation, the focused and packaging checks passed:

```text
npx jest miniprogram/dev/pages/my-orders-map/index.test.ts miniprogram/dev/pages/my-orders/index.test.ts --runInBand
2 suites passed, 9 tests passed

npm run typecheck
passed

npm run build:miniprogram:development
Built development mini program at dist/miniprogram-development

node --test tests/build-miniprogram.test.mjs
12 named subtests passed
```

Covered behavior includes per-card detail navigation, the map shell's fixed right column and long-label truncation, real map-to-list navigation, back/relaunch empty exit, immutable retry/refresh/pagination transitions, closing-over-confirming precedence, handler coverage for every template button, and development-only route/Fixture packaging.

## Native capture blocker

The installed WeChat DevTools CLI and repository-level ignored AppID config were made available to the worktree, then one attempt used the documented port:

```text
WECHAT_DEVTOOLS_CLI=/Applications/wechatwebdevtools.app/Contents/MacOS/cli \
  npm run env:wechat:check -- --port 40842
{"ok":false,"code":"WECHAT_PORT_MISMATCH","message":"quit Developer Tools, then rerun with one port"}
```

Per the proportional Task 2 instruction, no second tooling attempt was made. Because no fresh native pixels were available, the requested button centering, 44pt targets, long label, status alignment/contrast, chevrons, scrolling, and safe-area review could not be performed in the real runtime. Independent visual approval remains unrecorded.

## Reference self-review record

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

The approved reference board and tested native preview source are ready, but the Task 2 native
visual gate remains blocked by `WECHAT_PORT_MISMATCH`. A fresh 375 × 812 native capture and manual
review are still required before recording an independent native visual decision or entering Task 3.
