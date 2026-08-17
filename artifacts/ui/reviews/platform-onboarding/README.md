# Platform onboarding review visual evidence

Status: manual self-review passed on 2026-08-17; user visual approval is still pending.

This is a development-only static Fixture. Every local decision is reset on reload, no request or browser persistence API is used, and nothing here submits or changes production data. Delete `platform-admin/dev` when the approved console is promoted to the real API-backed client in Task 11.

## Capture method

- Runtime: plain HTML/CSS/JavaScript served from a temporary `127.0.0.1` static server.
- Browser: real Chromium driven through Playwright CLI.
- Viewport: exactly `1440 × 900` CSS pixels for every source capture.
- Layout evidence: `browser-layout-1440x900.json` records live `getBoundingClientRect()` values for `#frame` and its rendered root in all six states, tied to the current reference source SHA-256. Both bounds are `1440 × 900` in every state.
- Browser console after the interaction audit: `0 errors, 0 warnings`.
- Reference: `artifacts/ui/reference/platform-onboarding/index.html?case=<state>`.
- Implementation: `platform-admin/dev/index.html?case=<state>`.
- Comparison artifacts: FFmpeg `hstack`, 50% `blend`, and pixel `difference`; these are one-off evidence files, not a regression system.

Each state has the same five files:

```text
<state>-reference-1440x900.png
<state>-implementation-1440x900.png
<state>-side-by-side-1440x900.png
<state>-overlay-50-1440x900.png
<state>-difference-1440x900.png
```

Captured states: `login`, `pending`, `approved`, `rejected`, `expired-evidence-link`, and `decision-error`.

The source and all comparison images were recaptured after explicitly sizing reference `#frame` to the full fixed viewport. The earlier captures with auto-height reference roots were overwritten and are not retained as valid comparison evidence.

## Button and control matrix

| Control | Real local behavior verified |
| --- | --- |
| Login submit | Empty token shows an inline error and focuses the token field; any non-empty preview token opens the queue. |
| Logout | Returns to the staff login frame and clears open evidence/feedback state. |
| Kind filter | `CREATE` reduces the queue to create applications and selects the first visible row. |
| Status filter | `SUBMITTED` combines with the kind filter and reduces the queue to the pending create application. |
| Queue rows | Clicking/filtered selection changes applicant, claim/create identity, evidence, and decision detail. |
| View evidence | Opens a labeled modal with file name, size, received time, close button, scrim close, and an explicit local-placeholder note. |
| Expired evidence | Shows a page-level warning and `链接已过期 · 重新获取`; refresh changes only Fixture state, then the same evidence opens normally. |
| Reject | Empty reason is blocked with `请填写驳回理由` beside and focused on the field; a nonblank reason updates the selected Fixture to `REJECTED`. |
| Approve | A nonblank reason updates the selected Fixture to `APPROVED`; the audit result names the local reviewer and remains visibly non-production. |
| Decision error | The decision stays `SUBMITTED`, the error explains the state-change risk, and `刷新详情` enables an explicit retry. |
| State switcher | All six frozen presentations can be opened directly without sharing mutable state between cases. |

## Same-viewport observations

- Composition: reference and implementation keep the same staff-login split screen and review-console hierarchy: header, queue/filter rail, identity/evidence content, and a dedicated decision column.
- Geometry: implementation uses a slightly denser `68px` header and `360px` queue versus the reference `72px`/`372px`; all content remains aligned and unclipped at `1440 × 900`.
- Hierarchy: implementation moves the development state switcher from the decision card to the header, keeping decision controls visually isolated and always reachable.
- Queue: implementation intentionally shows four rows instead of the reference's compact three so kind/status filtering, both application kinds, and both decided states can be exercised in one Fixture.
- State continuity: expired-link and decision-error implementations preserve the duplicate/distance warning beneath the transient warning/error. This adds one callout versus the reference while retaining the application risk context.
- Data semantics: after reference calibration, applicant, venue, kind, status, timestamps, claim target, and proposed create identity match each implementation state.
- Color/type/material: both use the existing `#F8FAFC` page, white surfaces, `#10243E` text, trust blue, and the existing green/amber/red semantic states; no generic palette from the design search was introduced.

The 50% overlay and pixel difference show the expected density and component-placement differences above; they do not reveal a missing control, swapped application kind, clipped surface, or hidden error state.

## Manual visual self-review

- Button labels are explicitly flex-centered horizontally and vertically; approve/reject pairs have equal height and aligned columns.
- Repeated queue rows, evidence rows, status badges, document marks, and decision cards align consistently.
- Native select arrows, status marks, modal scrim, and the close `×` remain complete and visible.
- No target-viewport clipping, horizontal scroll, hidden decision footer, or content-under-fixed-element issue was observed.
- The reference root and first rendered child reach the bottom of the `1440 × 900` viewport in every state; no blank lower-viewport region remains.
- Claim detail shows only the existing target venue; create detail shows only proposed identity, district, address, and coordinates.
- Login, pending, approved, rejected, expired evidence, and decision error copy is truthful and paired with visible recovery or audit information.
- Keyboard focus rings are visible, form labels are associated, the error is adjacent to its field, and reduced-motion styling is present.
- Known AA pairs retained from the existing product system: `#10243E`/white, `#64748B`/white, and white/`#0369A1`.

## Remaining gate

- User visual confirmation is still required before any production `platform-admin`, OpenAPI, backend, authentication, or decision route work begins.
- These screenshots contain Fixture identities only; they are not evidence of backend authorization, persistence, or real decisions.
