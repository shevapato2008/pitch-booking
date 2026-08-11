# 场馆资料工作台 · Native visual review

## Gate status

- Target viewport: 375 × 812.
- Reference Artifact: approved local design source.
- Same-size evidence: 10 approved states × 5 PNGs = 50 PNGs.
- Native Fixture user visual approval: approved by the user on 2026-08-11.
- Approval scope: all 10 approved states (`ready`, `uploading`, `image-reviewing`, `image-rejected`, `description-reviewing`, `description-rejected`, `pending-manual`, `load-error`, `save-unknown`, and `public-published`).
- Production disabled; no contract, backend, service, database, or production route work was started.
- Fixture deletion condition: remove after visual approval and real service integration replace the development Fixture.

## Capture provenance

- Reference runtime: repository-local HTML Artifact in Playwright Chromium, explicitly resized to 375 × 812 before every screenshot.
- Native runtime: visible WeChat DevTools Stable 2.01.2510290, base library 3.17.0, development Mini Program build, iPhone X profile at 97% simulator zoom.
- Native routes: `dev/pages/venue-profile/index?state=<state>` and `dev/pages/venue-profile-public/index`.
- Computer Use method: `node_repl` + `@oai/sky` operated the visible DevTools compile modes and read the simulator/accessibility state. Browser screenshots were never used as implementation evidence.
- Native source screenshot: 1290 × 768 visible IDE JPEG. The exact simulator surface was cropped at `x=997, y=67, width=284, height=615`, then proportionally resampled to 375 × 812 PNG. The crop retains the real status bar, notch, WeChat capsule, rounded device boundary, fixed footer, safe area, and Home Indicator. No padding, reconstruction, or synthesized pixels were added.
- Reference and implementation were paired only after both measured 375 × 812. Side-by-side is 750 × 812; overlay and difference remain 375 × 812.
- A contact-sheet review caught four premature blank compile captures and four cursor-over-simulator captures; those files were replaced after defining state copy rendered and the cursor moved outside the simulator.
- larger iPhone safe-area/scroll smoke: not completed. The available visible session remained on iPhone X; this non-blocking smoke was stopped instead of extending the review.

## Evidence matrix

| State | Reference | Native implementation | Side by side | Overlay 50% | Difference |
| --- | --- | --- | --- | --- | --- |
| `ready` | `ready-reference.png` | `ready-implementation.png` | `ready-side-by-side.png` | `ready-overlay-50.png` | `ready-difference.png` |
| `uploading` | `uploading-reference.png` | `uploading-implementation.png` | `uploading-side-by-side.png` | `uploading-overlay-50.png` | `uploading-difference.png` |
| `image-reviewing` | `image-reviewing-reference.png` | `image-reviewing-implementation.png` | `image-reviewing-side-by-side.png` | `image-reviewing-overlay-50.png` | `image-reviewing-difference.png` |
| `image-rejected` | `image-rejected-reference.png` | `image-rejected-implementation.png` | `image-rejected-side-by-side.png` | `image-rejected-overlay-50.png` | `image-rejected-difference.png` |
| `description-reviewing` | `description-reviewing-reference.png` | `description-reviewing-implementation.png` | `description-reviewing-side-by-side.png` | `description-reviewing-overlay-50.png` | `description-reviewing-difference.png` |
| `description-rejected` | `description-rejected-reference.png` | `description-rejected-implementation.png` | `description-rejected-side-by-side.png` | `description-rejected-overlay-50.png` | `description-rejected-difference.png` |
| `pending-manual` | `pending-manual-reference.png` | `pending-manual-implementation.png` | `pending-manual-side-by-side.png` | `pending-manual-overlay-50.png` | `pending-manual-difference.png` |
| `load-error` | `load-error-reference.png` | `load-error-implementation.png` | `load-error-side-by-side.png` | `load-error-overlay-50.png` | `load-error-difference.png` |
| `save-unknown` | `save-unknown-reference.png` | `save-unknown-implementation.png` | `save-unknown-side-by-side.png` | `save-unknown-overlay-50.png` | `save-unknown-difference.png` |
| `public-published` | `public-published-reference.png` | `public-published-implementation.png` | `public-published-side-by-side.png` | `public-published-overlay-50.png` | `public-published-difference.png` |

## Seven-category visual observations

- **composition:** All ten native states preserve the approved one-direction journey: capsule-safe header, venue identity, status, content cards, audit note, and fixed action. Public view uses gallery → introduction → facilities → price. Rejected states initially hid the reason below the image/description sections; a focused RED test exposed the WXML order, the existing reason card moved directly after status, and only those two states were rebuilt and recaptured.
- **geometry/spacing:** The iPhone X capture has no horizontal overflow. Image tiles align in a stable two-column grid, repeated status cards have equal geometry, and the fixed footer remains above the Home Indicator. A real three-page scroll reached all facility groups, audit note, and Artifact note without the footer hiding the final content.
- **hierarchy:** Status remains first, rejection reason is now immediately visible when present, and images/description/facilities retain their approved order. Disabled review/save actions remain visibly subordinate and use native disabled semantics.
- **typography/colors/materials:** Native system type rasterizes slightly darker and smaller than Chromium, while the approved light surface, navy copy, blue primary actions, cyan information, amber uncertainty, red rejection/error, and green public materials remain legible. Button labels are horizontally and vertically centered through explicit flex alignment.
- **icons/assets:** Back chevrons, status marks, plus mark, spinner, warning mark, capsule, and Home Indicator remain complete and within bounds. Field/gallery scenes use local CSS geometry; no emoji, remote image, phone, chat, QR, or contact asset appears.
- **copy:** Venue name, all nine admin state messages, fixed rejection copy, disabled footer labels, public price, and `查看可订时段` match the frozen manifest. The native audit explicitly says Fixture/Production disabled.
- **state semantics:** Upload/review/manual/unknown/rejected/load-error states use both text and color. Public view displays only the last approved projection. No state claims fake publication or a completed backend write.

## Completed visible-runtime checks

- Native image controls: `设为封面`, `移除`, and an enabled `前移` were clicked; each kept `ready` and emitted the matching local-draft audit.
- All 17 facility chips were clicked once. Selection changed from 11 to 6, chip wrapping stayed within the card, and the page remained scrollable with the fixed footer visible.
- `保存场馆资料` visibly transitioned `ready` to `save-unknown`.
- `刷新上传状态` visibly transitioned `uploading` to `image-reviewing`.
- All disabled footers were inspected as native disabled controls and did not expose an enabled action.
- Source/Jest coverage separately exercises all handlers, 300-Unicode-code-point truncation, public gallery selection, availability navigation, and production isolation.

<!-- exercised:ready:SET_COVER=>ready -->
<!-- exercised:ready:REMOVE_IMAGE=>ready -->
<!-- exercised:ready:REORDER_IMAGE=>ready -->
<!-- exercised:ready:SAVE_PROFILE=>save-unknown -->
<!-- exercised:ready:TOGGLE_FACILITY=>ready -->
<!-- exercised:uploading:GET_IMAGE_UPLOAD=>image-reviewing -->
<!-- exercised:uploading:SAVE_PROFILE=>disabled:uploading -->
<!-- exercised:image-reviewing:SAVE_PROFILE=>disabled:image-reviewing -->
<!-- exercised:image-rejected:SAVE_PROFILE=>disabled:image-rejected -->
<!-- exercised:description-reviewing:SAVE_PROFILE=>disabled:description-reviewing -->
<!-- exercised:pending-manual:SAVE_PROFILE=>disabled:pending-manual -->
<!-- exercised:load-error:SAVE_PROFILE=>disabled:load-error -->
<!-- exercised:save-unknown:SAVE_PROFILE=>disabled:save-unknown -->

## Visible interaction coverage still pending

The remaining visible clicks were not completed before the UI pass was stopped. They are recorded explicitly rather than represented as passed. The focused Jest/controller tests cover their deterministic handler results, but automated coverage does not substitute for a visible WeChat click.

<!-- pending:ready:UPLOAD_IMAGE=>uploading -->
<!-- pending:ready:NATIVE_BACK=>navigate-back -->
<!-- pending:uploading:CANCEL_IMAGE_UPLOAD=>ready -->
<!-- pending:image-reviewing:GET_IMAGE_REVIEW=>image-reviewing -->
<!-- pending:image-reviewing:RESTORE_LOCAL_DRAFT=>ready -->
<!-- pending:image-rejected:RETRY_IMAGE=>uploading -->
<!-- pending:description-reviewing:VIEW_PUBLIC_PROFILE=>public-published -->
<!-- pending:description-reviewing:RESTORE_LOCAL_DRAFT=>ready -->
<!-- pending:description-rejected:RESTORE_LOCAL_DRAFT=>ready -->
<!-- pending:description-rejected:SAVE_PROFILE=>save-unknown -->
<!-- pending:pending-manual:GET_PROFILE_REVIEW=>pending-manual -->
<!-- pending:pending-manual:VIEW_PUBLIC_PROFILE=>public-published -->
<!-- pending:load-error:RELOAD_PROFILE=>ready -->
<!-- pending:save-unknown:CHECK_SAVE_RESULT=>description-reviewing -->
<!-- pending:public-published:VIEW_AVAILABILITY=>public-published -->
<!-- pending:public-published:SELECT_GALLERY=>public-published -->
<!-- pending:public-published:NATIVE_BACK=>navigate-back -->

## Tool limitations and approval record

- The in-app automation socket could not be enabled in the sandbox (`EPERM`). Visible Computer Use remained sufficient for real simulator capture and the completed clicks above.
- Sky did not reliably route non-ASCII keyboard input to the Mini Program textarea; attempts either preserved the old value, passed only ASCII, or focused the IDE editor. The accidental editor buffer input was immediately undone. The existing focused Jest test verifies `Array.from(value).slice(0, 300)` with a non-BMP character, but a visible 300-code-point textarea run remains pending.
- No contact button/action was present in the public accessibility tree or source contract.
- Automated layout/source tests did not grant visual approval; the user explicitly approved the board and all 10 approved states on 2026-08-11.
