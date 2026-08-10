# 物理场地配置 · Artifact review

## Status

- Target viewport: 375 × 812.
- Reference Artifact visual approval: approved on 2026-08-11.
- Native Fixture visual approval: pending.
- Production disabled; the isolated Native Fixture route has no production route, contract, backend, migration, or real save.
- Fixture deletion condition: `delete after physical-pitch configuration and real inventory backend integration, device/user acceptance, and production package audit`.

## Capture record

- Runtime: local Python static server on `127.0.0.1:8099`, rendered in the Playwright CLI Chromium runtime on 2026-08-11.
- URL: `http://127.0.0.1:8099/venue-pitch-setup.html?state=<state>`.
- Viewport: 375 × 812 CSS pixels; screenshots were written at CSS scale and verified as 375 × 812 PNG files.
- Method: one uninterrupted named session (`venue-setup-reference`), resized once, then `goto` → `window.__artifactAudit__()` → console error check → viewport screenshot for every state.
- Audit result: all 22 states returned `[]`; every state reported zero console errors.
- Board: [open the local Reference board](reference-board.html).

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
| `initial-loading` | [initial-loading-reference-375x812.png](initial-loading-reference-375x812.png) · [live](../../references/venue-pitch-setup.html?state=initial-loading) | not started | not started | not started | not started | pending |
| `load-error` | [load-error-reference-375x812.png](load-error-reference-375x812.png) · [live](../../references/venue-pitch-setup.html?state=load-error) | not started | not started | not started | not started | pending |
| `first-entry-empty` | [first-entry-empty-reference-375x812.png](first-entry-empty-reference-375x812.png) · [live](../../references/venue-pitch-setup.html?state=first-entry-empty) | not started | not started | not started | not started | pending |
| `inactive-only` | [inactive-only-reference-375x812.png](inactive-only-reference-375x812.png) · [live](../../references/venue-pitch-setup.html?state=inactive-only) | not started | not started | not started | not started | pending |
| `add-first-open` | [add-first-open-reference-375x812.png](add-first-open-reference-375x812.png) · [live](../../references/venue-pitch-setup.html?state=add-first-open) | not started | not started | not started | not started | pending |
| `first-pitch-draft` | [first-pitch-draft-reference-375x812.png](first-pitch-draft-reference-375x812.png) · [live](../../references/venue-pitch-setup.html?state=first-pitch-draft) | not started | not started | not started | not started | pending |
| `unnamed-pitch-draft` | [unnamed-pitch-draft-reference-375x812.png](unnamed-pitch-draft-reference-375x812.png) · [live](../../references/venue-pitch-setup.html?state=unnamed-pitch-draft) | not started | not started | not started | not started | pending |
| `first-save-success` | [first-save-success-reference-375x812.png](first-save-success-reference-375x812.png) · [live](../../references/venue-pitch-setup.html?state=first-save-success) | not started | not started | not started | not started | pending |
| `six-pitch-list` | [six-pitch-list-reference-375x812.png](six-pitch-list-reference-375x812.png) · [live](../../references/venue-pitch-setup.html?state=six-pitch-list) | not started | not started | not started | not started | pending |
| `edit-preset-open` | [edit-preset-open-reference-375x812.png](edit-preset-open-reference-375x812.png) · [live](../../references/venue-pitch-setup.html?state=edit-preset-open) | not started | not started | not started | not started | pending |
| `edit-custom-open` | [edit-custom-open-reference-375x812.png](edit-custom-open-reference-375x812.png) · [live](../../references/venue-pitch-setup.html?state=edit-custom-open) | not started | not started | not started | not started | pending |
| `field-validation` | [field-validation-reference-375x812.png](field-validation-reference-375x812.png) · [live](../../references/venue-pitch-setup.html?state=field-validation) | not started | not started | not started | not started | pending |
| `deactivate-blocked` | [deactivate-blocked-reference-375x812.png](deactivate-blocked-reference-375x812.png) · [live](../../references/venue-pitch-setup.html?state=deactivate-blocked) | not started | not started | not started | not started | pending |
| `unused-delete-confirm` | [unused-delete-confirm-reference-375x812.png](unused-delete-confirm-reference-375x812.png) · [live](../../references/venue-pitch-setup.html?state=unused-delete-confirm) | not started | not started | not started | not started | pending |
| `unused-deleted-draft` | [unused-deleted-draft-reference-375x812.png](unused-deleted-draft-reference-375x812.png) · [live](../../references/venue-pitch-setup.html?state=unused-deleted-draft) | not started | not started | not started | not started | pending |
| `deactivated-draft` | [deactivated-draft-reference-375x812.png](deactivated-draft-reference-375x812.png) · [live](../../references/venue-pitch-setup.html?state=deactivated-draft) | not started | not started | not started | not started | pending |
| `reactivated-draft` | [reactivated-draft-reference-375x812.png](reactivated-draft-reference-375x812.png) · [live](../../references/venue-pitch-setup.html?state=reactivated-draft) | not started | not started | not started | not started | pending |
| `save-in-progress` | [save-in-progress-reference-375x812.png](save-in-progress-reference-375x812.png) · [live](../../references/venue-pitch-setup.html?state=save-in-progress) | not started | not started | not started | not started | pending |
| `save-failed` | [save-failed-reference-375x812.png](save-failed-reference-375x812.png) · [live](../../references/venue-pitch-setup.html?state=save-failed) | not started | not started | not started | not started | pending |
| `configuration-changed` | [configuration-changed-reference-375x812.png](configuration-changed-reference-375x812.png) · [live](../../references/venue-pitch-setup.html?state=configuration-changed) | not started | not started | not started | not started | pending |
| `save-result-unknown` | [save-result-unknown-reference-375x812.png](save-result-unknown-reference-375x812.png) · [live](../../references/venue-pitch-setup.html?state=save-result-unknown) | not started | not started | not started | not started | pending |
| `unsaved-leave-confirm` | [unsaved-leave-confirm-reference-375x812.png](unsaved-leave-confirm-reference-375x812.png) · [live](../../references/venue-pitch-setup.html?state=unsaved-leave-confirm) | not started | not started | not started | not started | pending |

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

Reference screenshots are approved; no Native Fixture visual approval, side-by-side, overlay, or difference screenshots are claimed yet.
