# 物理场地配置 · Artifact review

## Status

- Target viewport: 375 × 812.
- Reference Artifact visual approval: approved on 2026-08-11.
- Native Fixture visual approval: pending.
- Production disabled; the isolated Native Fixture route has no production route, contract, backend, migration, or real save.
- Fixture deletion condition: `delete after physical-pitch configuration and real inventory backend integration, device/user acceptance, and production package audit`.

## Capture record

- Reference runtime: local Python static server on `127.0.0.1:8099`, rendered in the Playwright CLI Chromium runtime on 2026-08-11. All 22 states were captured at 375 × 812 and returned no Artifact audit or console errors.
- Native runtime: WeChat DevTools Stable 2.01.2510290, base library 3.17.0, development Fixture route `dev/pages/venue-pitch-setup/index?state=<state>`.
- Device: iPhone X, iOS 10.0.1 profile, DPR 3, logical screen 375 × 812, logical window 375 × 724, 44px status bar, and safe area `(0, 44)–(375, 778)`.
- Native method: the existing official `miniprogram-automator` client connected to the DevTools automation endpoint and used `App.captureScreenshot` after a fresh `reLaunch` for each state. Every raw PNG was 750 × 1624 and was normalized only by a strict 50% resize to 375 × 812; there was no crop, padding, or recomposition.
- Capture boundary: the official full-screen output retains the native top and bottom safe-area allocation. The automation API does not paint the desktop simulator's `9:41`, capsule outline, or Home Indicator glyphs, so those Reference-only glyph differences remain visible in overlays and are not manually synthesized.
- Runtime reload: after the two focused visual fixes, DevTools was closed and reopened through its official CLI before all thirteen final captures, avoiding the stale compiler cache observed during the first recapture attempt.
- Larger safe-area smoke: not captured. The DevTools simulator window remained detached from Computer Use (`cgWindowNotFound`), and the official automator exposes no device-switch method; no substitute viewport or fabricated evidence was used.
- Scroll smoke: the six-pitch screenshot shows the final add action continuing below the fixed footer and the WXSS reserves 240–299rpx of list padding. Two official automator scroll attempts hung before returning evidence, so physical gesture reachability remains a device/user acceptance item rather than a claimed pass.
- Board: [open the local comparison board](reference-board.html).

## Design sources

- `docs/superpowers/specs/2026-08-10-venue-pitch-setup-and-inventory-revision-design.md` (confirmed specification, especially sections 3–6 and 11–13).
- `artifacts/ui/screen-manifest/venue-pitch-setup.yaml`.
- `artifacts/ui/flows/venue-pitch-setup.md`.
- `artifacts/ui/references/venue-operations-reference.css`.
- `miniprogram/styles/tokens.wxss`.
- `artifacts/ui/design-system/README.md`.
- `artifacts/ui/references/venue-inventory-workbench.html` (historical v1 status-material baseline only).

## Same-viewport evidence register

| State | Reference | Native implementation | Side by side | Overlay 50% | Difference | Observations |
| --- | --- | --- | --- | --- | --- | --- |
| `initial-loading` | [initial-loading-reference-375x812.png](initial-loading-reference-375x812.png) · [live](../../references/venue-pitch-setup.html?state=initial-loading) | Reference-only / not captured | not captured | not captured | not captured | deferred |
| `load-error` | [load-error-reference-375x812.png](load-error-reference-375x812.png) · [live](../../references/venue-pitch-setup.html?state=load-error) | Reference-only / not captured | not captured | not captured | not captured | deferred |
| `first-entry-empty` | [first-entry-empty-reference-375x812.png](first-entry-empty-reference-375x812.png) · [live](../../references/venue-pitch-setup.html?state=first-entry-empty) | [first-entry-empty-implementation-375x812.png](first-entry-empty-implementation-375x812.png) | [first-entry-empty-375x812-side-by-side.png](first-entry-empty-375x812-side-by-side.png) | [first-entry-empty-375x812-overlay-50.png](first-entry-empty-375x812-overlay-50.png) | [first-entry-empty-375x812-difference.png](first-entry-empty-375x812-difference.png) | captured; pending review |
| `inactive-only` | [inactive-only-reference-375x812.png](inactive-only-reference-375x812.png) · [live](../../references/venue-pitch-setup.html?state=inactive-only) | Reference-only / not captured | not captured | not captured | not captured | deferred |
| `add-first-open` | [add-first-open-reference-375x812.png](add-first-open-reference-375x812.png) · [live](../../references/venue-pitch-setup.html?state=add-first-open) | [add-first-open-implementation-375x812.png](add-first-open-implementation-375x812.png) | [add-first-open-375x812-side-by-side.png](add-first-open-375x812-side-by-side.png) | [add-first-open-375x812-overlay-50.png](add-first-open-375x812-overlay-50.png) | [add-first-open-375x812-difference.png](add-first-open-375x812-difference.png) | captured; pending review |
| `first-pitch-draft` | [first-pitch-draft-reference-375x812.png](first-pitch-draft-reference-375x812.png) · [live](../../references/venue-pitch-setup.html?state=first-pitch-draft) | [first-pitch-draft-implementation-375x812.png](first-pitch-draft-implementation-375x812.png) | [first-pitch-draft-375x812-side-by-side.png](first-pitch-draft-375x812-side-by-side.png) | [first-pitch-draft-375x812-overlay-50.png](first-pitch-draft-375x812-overlay-50.png) | [first-pitch-draft-375x812-difference.png](first-pitch-draft-375x812-difference.png) | captured; pending review |
| `unnamed-pitch-draft` | [unnamed-pitch-draft-reference-375x812.png](unnamed-pitch-draft-reference-375x812.png) · [live](../../references/venue-pitch-setup.html?state=unnamed-pitch-draft) | Reference-only / not captured | not captured | not captured | not captured | deferred |
| `first-save-success` | [first-save-success-reference-375x812.png](first-save-success-reference-375x812.png) · [live](../../references/venue-pitch-setup.html?state=first-save-success) | [first-save-success-implementation-375x812.png](first-save-success-implementation-375x812.png) | [first-save-success-375x812-side-by-side.png](first-save-success-375x812-side-by-side.png) | [first-save-success-375x812-overlay-50.png](first-save-success-375x812-overlay-50.png) | [first-save-success-375x812-difference.png](first-save-success-375x812-difference.png) | non-navigating Fixture representation; real handoff waits inventory-v2 native |
| `six-pitch-list` | [six-pitch-list-reference-375x812.png](six-pitch-list-reference-375x812.png) · [live](../../references/venue-pitch-setup.html?state=six-pitch-list) | [six-pitch-list-implementation-375x812.png](six-pitch-list-implementation-375x812.png) | [six-pitch-list-375x812-side-by-side.png](six-pitch-list-375x812-side-by-side.png) | [six-pitch-list-375x812-overlay-50.png](six-pitch-list-375x812-overlay-50.png) | [six-pitch-list-375x812-difference.png](six-pitch-list-375x812-difference.png) | captured; pending review |
| `edit-preset-open` | [edit-preset-open-reference-375x812.png](edit-preset-open-reference-375x812.png) · [live](../../references/venue-pitch-setup.html?state=edit-preset-open) | [edit-preset-open-implementation-375x812.png](edit-preset-open-implementation-375x812.png) | [edit-preset-open-375x812-side-by-side.png](edit-preset-open-375x812-side-by-side.png) | [edit-preset-open-375x812-overlay-50.png](edit-preset-open-375x812-overlay-50.png) | [edit-preset-open-375x812-difference.png](edit-preset-open-375x812-difference.png) | captured; pending review |
| `edit-custom-open` | [edit-custom-open-reference-375x812.png](edit-custom-open-reference-375x812.png) · [live](../../references/venue-pitch-setup.html?state=edit-custom-open) | [edit-custom-open-implementation-375x812.png](edit-custom-open-implementation-375x812.png) | [edit-custom-open-375x812-side-by-side.png](edit-custom-open-375x812-side-by-side.png) | [edit-custom-open-375x812-overlay-50.png](edit-custom-open-375x812-overlay-50.png) | [edit-custom-open-375x812-difference.png](edit-custom-open-375x812-difference.png) | captured; pending review |
| `field-validation` | [field-validation-reference-375x812.png](field-validation-reference-375x812.png) · [live](../../references/venue-pitch-setup.html?state=field-validation) | Reference-only / not captured | not captured | not captured | not captured | deferred |
| `deactivate-blocked` | [deactivate-blocked-reference-375x812.png](deactivate-blocked-reference-375x812.png) · [live](../../references/venue-pitch-setup.html?state=deactivate-blocked) | [deactivate-blocked-implementation-375x812.png](deactivate-blocked-implementation-375x812.png) | [deactivate-blocked-375x812-side-by-side.png](deactivate-blocked-375x812-side-by-side.png) | [deactivate-blocked-375x812-overlay-50.png](deactivate-blocked-375x812-overlay-50.png) | [deactivate-blocked-375x812-difference.png](deactivate-blocked-375x812-difference.png) | captured; pending review |
| `unused-delete-confirm` | [unused-delete-confirm-reference-375x812.png](unused-delete-confirm-reference-375x812.png) · [live](../../references/venue-pitch-setup.html?state=unused-delete-confirm) | Reference-only / not captured | not captured | not captured | not captured | deferred |
| `unused-deleted-draft` | [unused-deleted-draft-reference-375x812.png](unused-deleted-draft-reference-375x812.png) · [live](../../references/venue-pitch-setup.html?state=unused-deleted-draft) | [unused-deleted-draft-implementation-375x812.png](unused-deleted-draft-implementation-375x812.png) | [unused-deleted-draft-375x812-side-by-side.png](unused-deleted-draft-375x812-side-by-side.png) | [unused-deleted-draft-375x812-overlay-50.png](unused-deleted-draft-375x812-overlay-50.png) | [unused-deleted-draft-375x812-difference.png](unused-deleted-draft-375x812-difference.png) | captured; pending review |
| `deactivated-draft` | [deactivated-draft-reference-375x812.png](deactivated-draft-reference-375x812.png) · [live](../../references/venue-pitch-setup.html?state=deactivated-draft) | [deactivated-draft-implementation-375x812.png](deactivated-draft-implementation-375x812.png) | [deactivated-draft-375x812-side-by-side.png](deactivated-draft-375x812-side-by-side.png) | [deactivated-draft-375x812-overlay-50.png](deactivated-draft-375x812-overlay-50.png) | [deactivated-draft-375x812-difference.png](deactivated-draft-375x812-difference.png) | captured; pending review |
| `reactivated-draft` | [reactivated-draft-reference-375x812.png](reactivated-draft-reference-375x812.png) · [live](../../references/venue-pitch-setup.html?state=reactivated-draft) | [reactivated-draft-implementation-375x812.png](reactivated-draft-implementation-375x812.png) | [reactivated-draft-375x812-side-by-side.png](reactivated-draft-375x812-side-by-side.png) | [reactivated-draft-375x812-overlay-50.png](reactivated-draft-375x812-overlay-50.png) | [reactivated-draft-375x812-difference.png](reactivated-draft-375x812-difference.png) | captured; pending review |
| `save-in-progress` | [save-in-progress-reference-375x812.png](save-in-progress-reference-375x812.png) · [live](../../references/venue-pitch-setup.html?state=save-in-progress) | Reference-only / not captured | not captured | not captured | not captured | deferred |
| `save-failed` | [save-failed-reference-375x812.png](save-failed-reference-375x812.png) · [live](../../references/venue-pitch-setup.html?state=save-failed) | [save-failed-implementation-375x812.png](save-failed-implementation-375x812.png) | [save-failed-375x812-side-by-side.png](save-failed-375x812-side-by-side.png) | [save-failed-375x812-overlay-50.png](save-failed-375x812-overlay-50.png) | [save-failed-375x812-difference.png](save-failed-375x812-difference.png) | captured; pending review |
| `configuration-changed` | [configuration-changed-reference-375x812.png](configuration-changed-reference-375x812.png) · [live](../../references/venue-pitch-setup.html?state=configuration-changed) | Reference-only / not captured | not captured | not captured | not captured | deferred |
| `save-result-unknown` | [save-result-unknown-reference-375x812.png](save-result-unknown-reference-375x812.png) · [live](../../references/venue-pitch-setup.html?state=save-result-unknown) | [save-result-unknown-implementation-375x812.png](save-result-unknown-implementation-375x812.png) | [save-result-unknown-375x812-side-by-side.png](save-result-unknown-375x812-side-by-side.png) | [save-result-unknown-375x812-overlay-50.png](save-result-unknown-375x812-overlay-50.png) | [save-result-unknown-375x812-difference.png](save-result-unknown-375x812-difference.png) | captured; pending review |
| `unsaved-leave-confirm` | [unsaved-leave-confirm-reference-375x812.png](unsaved-leave-confirm-reference-375x812.png) · [live](../../references/venue-pitch-setup.html?state=unsaved-leave-confirm) | Reference-only / not captured | not captured | not captured | not captured | deferred |

## Reference observations (visual approval approved)

### Composition

The 22 captures keep a single 375 × 812 page composition: custom header, instructional banner, configured-count/status region, independently scrollable pitch list, and one fixed bottom action. Editor, confirmation, and unsaved-leave states use one scrim and one bottom sheet rather than stacked dialogs.

### Geometry / spacing

Primary and secondary button labels are centered, card chevrons remain contained, and list content can scroll above the fixed action. Taller validation and lifecycle sheets retain one scrollable surface; the screenshots record their initial top position without implying that below-fold controls were compared to a native implementation.

### Component hierarchy

Page title and venue identity lead the hierarchy, followed by contextual guidance, count/status feedback, pitch cards, and the page commit action. Sheets place the title and draft warning first, fields and format controls second, lifecycle/validation feedback next, and sheet actions last.

### Typography / color / material

System typography, navy text, slate secondary copy, white cards, light borders, blue interactive accents, pale disabled actions, and red blocking validation are consistent across the captured shells. Scrims clearly separate modal context while preserving readable page context underneath.

### Icon assets

All visible navigation, close, and chevron assets are local vector shapes with no emoji or remote resources. Back/close controls meet the surrounding touch geometry, and trailing chevrons stay within their cards and sheets.

### Copy

State copy distinguishes zero configuration, inactive-only recovery, local page drafts, authoritative first-save handoff, retained drafts, retry, configuration change, unknown save result, and unsaved leave. The unnamed draft explicitly avoids presenting its temporary label as server authority.

### State semantics

Loading and unknown-result states disable duplicate saves; load/save failures expose recovery without relabeling the state as empty; inactive-only exposes `恢复使用`; the custom player count appears inline in the same editor; delete/deactivate/reactivate outcomes remain page drafts; and native/production gates remain pending or disabled.

## Native comparison observations (approval pending)

### Composition

All thirteen native captures keep the approved journey order: custom header, instruction, configured count, state banner/list, and one fixed page action. Native intentionally adds the Fixture-only explanatory line and notice, making the upper content denser than the browser Reference; sheets retain one scrim and one bottom surface.

### Geometry / spacing

The native header, two-line callout, and denser cards shift list geometry downward relative to Reference. Fixed bottom CTA placement and safe-area padding are stable across all thirteen captures. The corrected ordinary editor actions now form the Reference-aligned `取消 / 完成` two-column row; blocker lifecycle remains above that row. Physical scroll reachability still awaits device/user acceptance because the official scroll probe hung.

### Component hierarchy

Interactive A场 cards remain buttons with a contained chevron; cards without a transition now render as non-interactive views and no longer inherit native disabled opacity. Editor lifecycle, delete confirmation, and save-state actions remain separate authoritative branches rather than being merged into the ordinary completion row.

### Typography / color / material

Native system font metrics are slightly heavier and more compact than Chromium Reference metrics. Navy, slate, blue, pale disabled, green success, orange draft, and red blocking materials remain semantically consistent. Native cards are no longer incorrectly greyed when they are merely non-interactive.

### Icon assets

Back, plus, info, chevron, spinner, and close icons remain local CSS shapes. The corrected close control is a complete contained X, chevrons stay within their padded bounds, and no emoji or remote image is introduced. The official capture API leaves native system-glyph regions unpainted; no system icon was manually added.

### Copy

All captured state banners and actions match the Fixture descriptors. Native-only explanatory copy explicitly says changes are page drafts and the footer says nothing is written. `first-save-success` is a non-navigating Fixture representation; the real handoff waits for inventory-v2 native implementation.

### State semantics

Empty/add/draft/success/list/edit/lifecycle/save-failure/unknown-result distinctions remain visible. Unknown result keeps duplicate save disabled, failure exposes retry, and delete/deactivate/reactivate remain drafts. Reference approval remains approved, Native Fixture visual approval remains pending, and Production remains disabled.
