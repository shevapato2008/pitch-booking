# 场馆库存工作台 v2 · Artifact review

## Status

- Target viewport: 375 × 812.
- Reference Artifact visual approval: pending.
- Native Fixture visual approval: not started.
- Production disabled; this is a browser Reference only and has no production route, Fixture, contract, backend, migration, or real save.
- Fixture deletion condition: `delete after physical-pitch configuration and real inventory backend integration, device/user acceptance, and production package audit`.
- The old inventory Artifact is historical and superseded; it remains only as the cited slot-status material baseline.

## Capture record

- Runtime: local Python static server on `127.0.0.1:8099`, rendered in the Playwright CLI Chromium runtime on 2026-08-11.
- URL: `http://127.0.0.1:8099/venue-inventory-workbench-v2.html?state=<state>`.
- Viewport: 375 × 812 CSS pixels; screenshots were written at CSS scale and verified as 375 × 812 PNG files.
- Method: one uninterrupted named session (`venue-inventory-v2-reference`), resized once, then `goto` → `window.__artifactAudit__()` → console error check → viewport screenshot for every state.
- Audit result: all 19 states returned `[]`; every state reported zero console errors.
- Board: [open the local Reference board](reference-board.html).

## Design sources

- `docs/superpowers/specs/2026-08-10-venue-pitch-setup-and-inventory-revision-design.md` (confirmed specification, especially sections 7, 9–13).
- `artifacts/ui/screen-manifest/venue-inventory-workbench-v2.yaml`.
- `artifacts/ui/flows/venue-inventory-workbench-v2.md`.
- `artifacts/ui/references/venue-operations-reference.css`.
- `miniprogram/styles/tokens.wxss`.
- `artifacts/ui/design-system/README.md`.
- `artifacts/ui/references/venue-inventory-workbench.html` (historical and superseded v1 status-material baseline only).

## Same-viewport evidence register

| State | Reference | Native implementation | Side by side | Overlay 50% | Difference | Observations |
| --- | --- | --- | --- | --- | --- | --- |
| `initial-loading` | [initial-loading-reference-375x812.png](initial-loading-reference-375x812.png) · [live](../../references/venue-inventory-workbench-v2.html?state=initial-loading) | not started | not started | not started | not started | pending |
| `load-error` | [load-error-reference-375x812.png](load-error-reference-375x812.png) · [live](../../references/venue-inventory-workbench-v2.html?state=load-error) | not started | not started | not started | not started | pending |
| `day-empty` | [day-empty-reference-375x812.png](day-empty-reference-375x812.png) · [live](../../references/venue-inventory-workbench-v2.html?state=day-empty) | not started | not started | not started | not started | pending |
| `day-ready` | [day-ready-reference-375x812.png](day-ready-reference-375x812.png) · [live](../../references/venue-inventory-workbench-v2.html?state=day-ready) | not started | not started | not started | not started | pending |
| `pitch-picker-open` | [pitch-picker-open-reference-375x812.png](pitch-picker-open-reference-375x812.png) · [live](../../references/venue-inventory-workbench-v2.html?state=pitch-picker-open) | not started | not started | not started | not started | pending |
| `pitch-refreshing` | [pitch-refreshing-reference-375x812.png](pitch-refreshing-reference-375x812.png) · [live](../../references/venue-inventory-workbench-v2.html?state=pitch-refreshing) | not started | not started | not started | not started | pending |
| `pitch-load-error` | [pitch-load-error-reference-375x812.png](pitch-load-error-reference-375x812.png) · [live](../../references/venue-inventory-workbench-v2.html?state=pitch-load-error) | not started | not started | not started | not started | pending |
| `calendar-open` | [calendar-open-reference-375x812.png](calendar-open-reference-375x812.png) · [live](../../references/venue-inventory-workbench-v2.html?state=calendar-open) | not started | not started | not started | not started | pending |
| `date-refreshing` | [date-refreshing-reference-375x812.png](date-refreshing-reference-375x812.png) · [live](../../references/venue-inventory-workbench-v2.html?state=date-refreshing) | not started | not started | not started | not started | pending |
| `date-load-error` | [date-load-error-reference-375x812.png](date-load-error-reference-375x812.png) · [live](../../references/venue-inventory-workbench-v2.html?state=date-load-error) | not started | not started | not started | not started | pending |
| `cross-week-ready` | [cross-week-ready-reference-375x812.png](cross-week-ready-reference-375x812.png) · [live](../../references/venue-inventory-workbench-v2.html?state=cross-week-ready) | not started | not started | not started | not started | pending |
| `long-list-end` | [long-list-end-reference-375x812.png](long-list-end-reference-375x812.png) · [live](../../references/venue-inventory-workbench-v2.html?state=long-list-end) | not started | not started | not started | not started | pending |
| `create-slot-open` | [create-slot-open-reference-375x812.png](create-slot-open-reference-375x812.png) · [live](../../references/venue-inventory-workbench-v2.html?state=create-slot-open) | not started | not started | not started | not started | pending |
| `edit-slot-open` | [edit-slot-open-reference-375x812.png](edit-slot-open-reference-375x812.png) · [live](../../references/venue-inventory-workbench-v2.html?state=edit-slot-open) | not started | not started | not started | not started | pending |
| `save-in-progress` | [save-in-progress-reference-375x812.png](save-in-progress-reference-375x812.png) · [live](../../references/venue-inventory-workbench-v2.html?state=save-in-progress) | not started | not started | not started | not started | pending |
| `save-result-unknown` | [save-result-unknown-reference-375x812.png](save-result-unknown-reference-375x812.png) · [live](../../references/venue-inventory-workbench-v2.html?state=save-result-unknown) | not started | not started | not started | not started | pending |
| `create-slot-overlap` | [create-slot-overlap-reference-375x812.png](create-slot-overlap-reference-375x812.png) · [live](../../references/venue-inventory-workbench-v2.html?state=create-slot-overlap) | not started | not started | not started | not started | pending |
| `concurrent-change` | [concurrent-change-reference-375x812.png](concurrent-change-reference-375x812.png) · [live](../../references/venue-inventory-workbench-v2.html?state=concurrent-change) | not started | not started | not started | not started | pending |
| `permission-expired` | [permission-expired-reference-375x812.png](permission-expired-reference-375x812.png) · [live](../../references/venue-inventory-workbench-v2.html?state=permission-expired) | not started | not started | not started | not started | pending |

## Reference observations (visual approval pending)

### Composition

The 19 captures keep one 375 × 812 workbench composition: venue header, month/date controls, current-pitch selector, day summary, independently scrollable slot list, and fixed bottom action. Picker, calendar, create, edit, saving, unknown-result, overlap, and concurrent-change states each use a single bottom sheet.

### Geometry / spacing

Fixed actions and sheet buttons are centered; row chevrons remain inside their controls; the long-list capture exposes the final slot above the bottom CTA; and sheet fields align to the same insets. The edit sheet records its initial scroll position, while its single sheet remains vertically reachable rather than spawning another dialog.

### Component hierarchy

Venue identity and authorization context lead, followed by date selection, physical-pitch context, day/load status, slot cards, and the write action. Sheets elevate selection or draft context above controls, with inline error/authority messages adjacent to the affected draft.

### Typography / color / material

System typography and the shared navy/slate/white material remain consistent. Blue marks selection and writable actions; green, amber, gray, and indigo status pills distinguish availability, lock, closure, and sale; pale disabled controls truthfully communicate blocked or in-progress writes.

### Icon assets

Back, close, and trailing chevron assets are local vector shapes with no emoji or remote resources. Icon boundaries remain contained in headers, selectors, rows, and sheets, including dimmed permission-expired content.

### Copy

Copy names the selected date and physical pitch, keeps load failures distinct from empty inventory, identifies retained draft values, and distinguishes overlap, concurrent authority change, unknown result, and expired permission. The calendar labels its future-14-day boundary and selected 8月23日 周日.

### State semantics

Pitch and date refresh states retain the complementary selection; their errors retain the attempted selection and expose retry. Calendar dates outside 2026-08-10 through 2026-08-23 are visibly disabled, `cross-week-ready` shows Aug 17–23, error sheets retain draft inputs, and `permission-expired` keeps readable context while disabling write controls. Approval, native, and production gates remain pending or not started.

No screenshots, side-by-side composites, overlays, differences, implementation evidence, or visual approval are claimed in this task.
