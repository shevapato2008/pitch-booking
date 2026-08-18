# Venue Pitch Setup and Inventory Reference Artifacts Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Freeze browser-openable `375 × 812` Reference Artifacts for the approved physical-pitch setup journey and revised single-pitch inventory workbench, then stop for explicit user visual approval.

**Architecture:** Preserve the existing inventory Artifact and native Fixture as a historical v1 baseline. Add a setup Artifact and an inventory `v2` Artifact, each split into a small semantic HTML shell, page-specific CSS, and an immutable state/render controller; both import one local shared reference stylesheet for tokens, button/icon containment, sheets, and safe-area behavior. YAML manifests, flow documents, a focused Node structure test, runtime browser audits, screenshots, and review boards make the gate reviewable without creating Mini Program pages, Fixtures, contracts, production routes, HTTP adapters, backend endpoints, or migrations.

**Tech Stack:** Semantic HTML, CSS, inline SVG/CSS icons, small local vanilla JavaScript modules, YAML, Node test runner, `@ui-ux-pro-max`, `@playwright`, existing Mini Program token documentation.

---

## Chunk 1: Reference contracts and browser Artifacts

### Task 1: Freeze complete state, identity, and flow contracts

**Files:**
- Create: `tests/venue-pitch-setup-and-inventory-reference-artifacts.test.mjs`
- Create: `artifacts/ui/screen-manifest/venue-pitch-setup.yaml`
- Create: `artifacts/ui/screen-manifest/venue-inventory-workbench-v2.yaml`
- Create: `artifacts/ui/flows/venue-pitch-setup.md`
- Create: `artifacts/ui/flows/venue-inventory-workbench-v2.md`
- Modify: `artifacts/ui/README.md`

- [ ] **Step 1: Write the failing manifest and flow test**

Create one focused Node test. Its canonical state inventories must be exactly:

```js
const setupStates = [
  "initial-loading",
  "load-error",
  "first-entry-empty",
  "inactive-only",
  "add-first-open",
  "first-pitch-draft",
  "unnamed-pitch-draft",
  "first-save-success",
  "six-pitch-list",
  "edit-preset-open",
  "edit-custom-open",
  "field-validation",
  "deactivate-blocked",
  "unused-delete-confirm",
  "unused-deleted-draft",
  "deactivated-draft",
  "reactivated-draft",
  "save-in-progress",
  "save-failed",
  "configuration-changed",
  "save-result-unknown",
  "unsaved-leave-confirm",
];

const inventoryStates = [
  "initial-loading",
  "load-error",
  "day-empty",
  "day-ready",
  "pitch-picker-open",
  "pitch-refreshing",
  "pitch-load-error",
  "calendar-open",
  "date-refreshing",
  "date-load-error",
  "cross-week-ready",
  "long-list-end",
  "create-slot-open",
  "edit-slot-open",
  "save-in-progress",
  "save-result-unknown",
  "create-slot-overlap",
  "concurrent-change",
  "permission-expired",
];
```

Parse both YAML files with `parseDocument(..., { uniqueKeys: true })` and require zero parse errors. Assert these shared fields exactly:

```js
{
  target_viewport: { width: 375, height: 812 },
  production_enabled: false,
  entry: "authorized-deep-link-only",
  reference_gate: "pending-user-visual-approval",
  review_slots: ["reference", "implementation", "side-by-side", "overlay-50", "difference", "observations"]
}
```

Require `venue-pitch-setup.yaml` to use `id: venue-pitch-setup` and `venue-inventory-workbench-v2.yaml` to use `id: venue-inventory-workbench-v2`. Deep-compare this shared scope in both files:

```yaml
venue_scope:
  venue_id: venue-bohai-yuanfeng
  name: 渤海元丰足球场
  booking_mode: ONLINE
  permission: VenueMembership.can_manage_inventory
```

Require setup state references to use `artifacts/ui/references/venue-pitch-setup.html?state=<id>` and inventory state references to use `artifacts/ui/references/venue-inventory-workbench-v2.html?state=<id>`. Require future Fixture paths `miniprogram/dev/venue-pitch-setup-fixture.ts` and `miniprogram/dev/venue-inventory-fixture.ts`, but do not create or change either Fixture in this plan.

Require the shared deletion condition exactly: `delete after physical-pitch configuration and real inventory backend integration, device/user acceptance, and production package audit`. Do not modify or weaken `tests/venue-inventory-artifact.test.mjs`; it continues protecting historical v1 evidence.

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
node --test tests/venue-pitch-setup-and-inventory-reference-artifacts.test.mjs
```

Expected: FAIL because the new manifests and flows do not exist.

- [ ] **Step 3: Add exact shared pitch identity and canonical data**

Both manifests must contain this first-save mapping, and the test must deep-compare it across files:

```yaml
first_save_handoff:
  client_ref: draft-pitch-1
  pitch_id: pitch-7-001
  custom_name: A场
  system_name: 7人场 · 1号场
  display_name: A场
  players_per_side: 7
  sequence: 1
  status: ACTIVE
```

The setup manifest must freeze these six records in the only canonical order (`players_per_side`, `sequence`, `id`):

```yaml
pitches:
  - {id: pitch-5-001, custom_name: 滨河场, system_name: 5人场 · 1号场, display_name: 滨河场, players_per_side: 5, sequence: 1, status: ACTIVE}
  - {id: pitch-5-002, custom_name: null, system_name: 5人场 · 2号场, display_name: 5人场 · 2号场, players_per_side: 5, sequence: 2, status: ACTIVE}
  - {id: pitch-7-001, custom_name: A场, system_name: 7人场 · 1号场, display_name: A场, players_per_side: 7, sequence: 1, status: ACTIVE}
  - {id: pitch-7-002, custom_name: null, system_name: 7人场 · 2号场, display_name: 7人场 · 2号场, players_per_side: 7, sequence: 2, status: ACTIVE}
  - {id: pitch-7-003, custom_name: null, system_name: 7人场 · 3号场, display_name: 7人场 · 3号场, players_per_side: 7, sequence: 3, status: ACTIVE}
  - {id: pitch-7-004, custom_name: 训练场, system_name: 7人场 · 4号场, display_name: 训练场, players_per_side: 7, sequence: 4, status: INACTIVE}
```

Add and deep-compare this complete capability map keyed by `pitch_id`, never by name:

```yaml
capabilities:
  pitch-5-001:
    edit_format: {allowed: false, reason: BUSINESS_HISTORY}
    delete: {allowed: false, reason: BUSINESS_HISTORY}
    deactivate: {allowed: true, reason: null}
    reactivate: {allowed: false, reason: ALREADY_ACTIVE}
    future_blockers: {AVAILABLE: 0, LOCKED: 0, BOOKED: 0}
  pitch-5-002:
    edit_format: {allowed: true, reason: null}
    delete: {allowed: true, reason: null}
    deactivate: {allowed: true, reason: null}
    reactivate: {allowed: false, reason: ALREADY_ACTIVE}
    future_blockers: {AVAILABLE: 0, LOCKED: 0, BOOKED: 0}
  pitch-7-001:
    edit_format: {allowed: false, reason: BUSINESS_HISTORY}
    delete: {allowed: false, reason: BUSINESS_HISTORY}
    deactivate: {allowed: true, reason: null}
    reactivate: {allowed: false, reason: ALREADY_ACTIVE}
    future_blockers: {AVAILABLE: 0, LOCKED: 0, BOOKED: 0}
  pitch-7-002:
    edit_format: {allowed: false, reason: BUSINESS_HISTORY}
    delete: {allowed: false, reason: BUSINESS_HISTORY}
    deactivate: {allowed: false, reason: FUTURE_INVENTORY_BLOCKS}
    reactivate: {allowed: false, reason: ALREADY_ACTIVE}
    future_blockers: {AVAILABLE: 2, LOCKED: 1, BOOKED: 1}
  pitch-7-003:
    edit_format: {allowed: false, reason: BUSINESS_HISTORY}
    delete: {allowed: false, reason: BUSINESS_HISTORY}
    deactivate: {allowed: true, reason: null}
    reactivate: {allowed: false, reason: ALREADY_ACTIVE}
    future_blockers: {AVAILABLE: 0, LOCKED: 0, BOOKED: 0}
  pitch-7-004:
    edit_format: {allowed: false, reason: BUSINESS_HISTORY}
    delete: {allowed: false, reason: BUSINESS_HISTORY}
    deactivate: {allowed: false, reason: ALREADY_INACTIVE}
    reactivate: {allowed: true, reason: null}
    future_blockers: {AVAILABLE: 0, LOCKED: 0, BOOKED: 0}
```

The inventory manifest uses `pitch-7-001`, `2026-08-11`, and request sequence `1` as its default selection. Its date window is `2026-08-10` through `2026-08-23` inclusive. Its picker contains only the five `ACTIVE` records above, grouped by 5 then 7, in canonical order.

- [ ] **Step 4: Add authority and flow documents without conflating empty conditions**

The setup manifest authority must be exact:

```yaml
authority:
  identity: immutable pitch_id
  display_name: custom_name ?? system_name
  format: players_per_side integer 1..99
  ordering: players_per_side, sequence, id
  editor_commit: page draft only
  page_commit: atomic future server save
```

`venue-pitch-setup.md` must include these distinct transitions:

```text
authorized worker + zero configured pitches → first-entry-empty
authorized worker + configured pitches but zero ACTIVE pitches → inactive-only
first-entry-empty → add-first-open → first-pitch-draft
first-pitch-draft uses client_ref draft-pitch-1 and custom name A场
unnamed-pitch-draft uses a separate client_ref and temporary local label only
editor 完成 → page draft only
edit-custom-open → inline players_per_side input; no nested sheet
unused pitch delete confirmation → unused-deleted-draft
ACTIVE pitch with future blockers → deactivate-blocked
eligible ACTIVE pitch → deactivated-draft
INACTIVE pitch → reactivated-draft
save-in-progress → first-save-success or save-failed or save-result-unknown
first-save-success maps draft-pitch-1 → pitch-7-001 and then opens inventory v2 day-ready
configuration-changed → draft retained for manual reconciliation
unsaved page exit → unsaved-leave-confirm
production home → disabled
```

The inventory manifest authority must be exact:

```yaml
authority:
  query_key: venue_id + pitch_id + local_date
  selected_pitch: preserved while date changes
  selected_date: preserved while pitch changes
  response_policy: latest request_sequence only
  date_window: 2026-08-10 through 2026-08-23 inclusive
```

`venue-inventory-workbench-v2.md` must include:

```text
day-ready → pitch-picker-open → pitch-refreshing → same date + new pitch_id
pitch-refreshing → pitch-load-error keeps the new selection and exposes retry
day-ready → calendar-open → date-refreshing → confirmed date in same page
date-refreshing → date-load-error keeps the new date and current pitch and exposes retry
calendar confirm 2026-08-23 → cross-week-ready showing 2026-08-17..2026-08-23
week-strip managed date → immediate same-page refresh
day-empty → create-slot-open
day-ready → edit-slot-open for editable slot
create-slot-open → save-in-progress → save-result-unknown or create-slot-overlap
concurrent-change → authoritative day retained and draft retained for review
permission-expired → write controls disabled
long-list-end → final slot visible above fixed bottom action
production home → disabled
```

- [ ] **Step 5: Update the Artifact index**

Add a “Venue pitch setup and inventory revision” section to `artifacts/ui/README.md`. Cite the exact current design sources:

- `docs/superpowers/specs/2026-08-10-venue-pitch-setup-and-inventory-revision-design.md` sections 11–13;
- `miniprogram/styles/tokens.wxss` for semantic native colors, type, radii, spacing, and 88rpx targets;
- `artifacts/ui/design-system/README.md` for contrast guidance;
- `artifacts/ui/references/venue-inventory-workbench.html` only as the v1 slot-status material baseline, not as v2 layout authority.

Mark v1 as historical, list both new manifests/flows/references, and state `pending-user-visual-approval`. Do not claim native or production readiness.

- [ ] **Step 6: Run the test and isolate the next failure**

Run:

```bash
node --test tests/venue-pitch-setup-and-inventory-reference-artifacts.test.mjs
```

Expected: manifest identity, data, authority, and flow assertions PASS; the test remains FAIL only because the HTML/CSS/JS and review files from Tasks 2–4 do not exist.

### Task 2: Add a focused shared Reference foundation

**Files:**
- Create: `artifacts/ui/references/venue-operations-reference.css`
- Modify: `tests/venue-pitch-setup-and-inventory-reference-artifacts.test.mjs`

- [ ] **Step 1: Add failing shared-style assertions**

Require local semantic variables for `#F8FAFC`, `#FFFFFF`, `#10243E`, `#64748B`, `#DBE5EC`, `#0284C7`, `#0369A1`, `#059669`, `#B45309`, and `#DC2626`. Require a system font stack, `box-sizing: border-box`, a fixed `.artifact` of `375px × 812px`, `.touch-target` of at least `44px`, visible `:focus-visible`, a `.fixed-action` with `env(safe-area-inset-bottom, 0px)`, flex-centred `.primary-action` and `.secondary-action`, and an `.icon-box` with padding/overflow containment.

Require the shared sheet material: one fixed scrim, a sheet within the canvas, 22px top radii, a visible handle, fixed-safe-area padding, and a 44px close target. Disallow gradients, remote URLs, and generic rules that can override button colors/spacing after component rules.

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```bash
node --test tests/venue-pitch-setup-and-inventory-reference-artifacts.test.mjs
```

Expected: FAIL because `venue-operations-reference.css` does not exist.

- [ ] **Step 3: Implement only shared visual primitives**

Translate `miniprogram/styles/tokens.wxss` from rpx to the `375px` browser canvas at `2rpx = 1px`. Shared CSS owns reset, tokens, canvas, system safe-area simulation, surfaces, typography helpers, 44px targets, centred buttons, icon boxes, scrim/sheet, status callouts, disabled/focus/pressed material, and reduced-motion behavior. It must not contain pitch-card, calendar, week-strip, or slot-row layout.

- [ ] **Step 4: Run the shared-style assertions**

Run:

```bash
node --test tests/venue-pitch-setup-and-inventory-reference-artifacts.test.mjs
```

Expected: shared-style assertions PASS; missing setup/inventory page files remain the only failures.

### Task 3: Build the physical-pitch setup Reference

**Files:**
- Create: `artifacts/ui/references/venue-pitch-setup.html`
- Create: `artifacts/ui/references/venue-pitch-setup.css`
- Create: `artifacts/ui/references/venue-pitch-setup-data.js`
- Create: `artifacts/ui/references/venue-pitch-setup.js`
- Create: `artifacts/ui/reviews/venue-pitch-setup/README.md`
- Modify: `tests/venue-pitch-setup-and-inventory-reference-artifacts.test.mjs`

- [ ] **Step 1: Add failing shell and data assertions**

Require the HTML to load only local `venue-operations-reference.css`, `venue-pitch-setup.css`, `venue-pitch-setup-data.js`, and `venue-pitch-setup.js`; use `<main class="artifact" data-production-enabled="false">`; contain one semantic app root; and make no network request. Require the data module to define every setup state and embed the exact six manifest records/capabilities. Require the controller to reject invalid state IDs to `six-pitch-list` and expose `window.__artifactAudit__` for browser verification.

Require exact visible concepts across the renderer:

```text
配置物理场地
渤海元丰足球场
每块可独立预订的场地都需要单独配置
添加一块场地
保存并设置时段
保存更改
场地名称（可选）
5人制
7人制
8人制
11人制
其他
每队人数
预览：6人制
完成
新建的 7 人制场地 1
保存后生成正式名称
未来库存尚未处理，暂不能停用
正在确认保存结果
场地配置已变化，请重新核对
离开后，本次修改不会保存
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```bash
node --test tests/venue-pitch-setup-and-inventory-reference-artifacts.test.mjs
```

Expected: FAIL because the setup shell, styles, controller, and review record do not exist.

- [ ] **Step 3: Implement the fixed shell and the four read states**

The page-specific CSS may only own setup header/callout/count, pitch cards, dashed add action, draft banners, and setup-specific empty/loading/error regions. The hierarchy is:

```text
custom-navigation safe area
→ title + venue identity
→ compact explanatory callout
→ configured-count summary
→ independently scrolling pitch-card list
→ dashed add action
→ fixed bottom action + safe area
→ optional one scrim and one sheet
```

Implement `initial-loading`, `load-error`, `first-entry-empty` (zero configured pitches), and `inactive-only` (configured INACTIVE pitch remains visible with recovery). List cards display source and status text, use canonical order, ellipsize only the card title, and put all chevrons inside `.icon-box`.

- [ ] **Step 4: Run the read-state assertions**

Run:

```bash
node --test tests/venue-pitch-setup-and-inventory-reference-artifacts.test.mjs
```

Expected: the four read-state assertions PASS; missing draft/editor/lifecycle states remain explicit failures.

- [ ] **Step 5: Add the four draft and handoff states**

Implement `first-pitch-draft` (`draft-pitch-1`, custom name `A场`), `unnamed-pitch-draft` (separate client ref and local temporary label), `first-save-success` (authoritative mapping to `pitch-7-001` and explicit inventory handoff), and `six-pitch-list`.

- [ ] **Step 6: Run the draft and handoff assertions**

Run:

```bash
node --test tests/venue-pitch-setup-and-inventory-reference-artifacts.test.mjs
```

Expected: draft identity, temporary-label, canonical-list, and success-handoff assertions PASS; editor/lifecycle/save states remain explicit failures.

- [ ] **Step 7: Implement one reusable editor and four field states**

Render one sheet component from state data, not one duplicated sheet per state. Add `add-first-open`, `edit-preset-open`, `edit-custom-open`, and `field-validation`. `edit-custom-open` alone contains a labelled `<input inputmode="numeric" min="1" max="99" value="6">`, adjacent `人制`, and `预览：6人制`. The renderer may create at most one `[role="dialog"]`; “其他” expands inline and never creates another sheet. `完成` only mutates the page-draft visual state.

- [ ] **Step 8: Run editor-state assertions**

Run:

```bash
node --test tests/venue-pitch-setup-and-inventory-reference-artifacts.test.mjs
```

Expected: all editor and custom-number assertions PASS; lifecycle/save/exit states remain explicit failures.

- [ ] **Step 9: Implement the five lifecycle states**

Add `deactivate-blocked`, `unused-delete-confirm`, `unused-deleted-draft`, `deactivated-draft`, and `reactivated-draft`. The blocker state shows `AVAILABLE 2 / LOCKED 1 / BOOKED 1`; delete confirmation stays inside the existing sheet; draft states say `待保存`.

- [ ] **Step 10: Run lifecycle-state assertions**

Run:

```bash
node --test tests/venue-pitch-setup-and-inventory-reference-artifacts.test.mjs
```

Expected: lifecycle capability, blocker, delete, deactivate, and reactivate assertions PASS; save/exit states remain explicit failures.

- [ ] **Step 11: Implement save and exit states**

Add `save-in-progress`, `save-failed`, `configuration-changed`, `save-result-unknown`, and `unsaved-leave-confirm`. Failures preserve the six-record draft; unknown/in-progress states disable duplicate submission; leave confirmation is the only dialog when no editor is open.

- [ ] **Step 12: Run save and exit assertions**

Run:

```bash
node --test tests/venue-pitch-setup-and-inventory-reference-artifacts.test.mjs
```

Expected: every setup state and transition assertion PASS.

- [ ] **Step 13: Implement the runtime audit contract**

`window.__artifactAudit__()` returns an array of violation strings and must measure live DOM, not source text. It checks canvas `375 × 812`, document/canvas horizontal overflow, every visible interactive target at least `44 × 44`, fixed action inside the canvas, primary label centre within 1px of its button centre, every visible chevron/icon box contained by its nearest control, no more than one visible dialog, visible sheet inside the canvas, list bottom padding at least fixed-action height, and state-scoped rules (custom input only for `edit-custom-open`; inactive pitch visible in `inactive-only`; duplicate actions disabled in save states).

- [ ] **Step 14: Add the Reference-only review record**

Create one row per setup state with Reference and future implementation/side-by-side/overlay/difference columns. Mark implementation columns `not started`, `Reference Artifact visual approval: pending`, `Native Fixture visual approval: not started`, `Production disabled`, target viewport, exact design source paths, and the full Fixture deletion condition. Reserve observation headings for composition, geometry/spacing, component hierarchy, typography/color/material, icon assets, copy, and state semantics.

- [ ] **Step 15: Run setup structure assertions**

Run:

```bash
node --test tests/venue-pitch-setup-and-inventory-reference-artifacts.test.mjs
```

Expected: setup manifest/flow/shell/data/style assertions PASS; remaining failures identify only inventory-v2 files.

### Task 4: Build the revised inventory Reference

**Files:**
- Create: `artifacts/ui/references/venue-inventory-workbench-v2.html`
- Create: `artifacts/ui/references/venue-inventory-workbench-v2.css`
- Create: `artifacts/ui/references/venue-inventory-workbench-v2-data.js`
- Create: `artifacts/ui/references/venue-inventory-workbench-v2.js`
- Create: `artifacts/ui/reviews/venue-inventory-workbench-v2/README.md`
- Modify: `tests/venue-pitch-setup-and-inventory-reference-artifacts.test.mjs`

- [ ] **Step 1: Add failing shell and state-data assertions**

Require the HTML to load the shared local CSS plus only its own local CSS/data/controller and contain no header `新增时段` control. Require the data module to define all inventory states, the shared `pitch-7-001` identity, the five ACTIVE picker records in canonical order, 2026-08-10..2026-08-23 inclusive, `request_sequence`, and immutable slot data. Require the controller to use `day-ready` fallback and expose `window.__artifactAudit__`.

Require visible concepts across the renderer:

```text
渤海元丰足球场
库存工作台 · 仅授权工作人员
更多日期
当前场地
A场 · 7人制
选择物理场地
未来 14 天
确认日期
8月23日 周日
新增时段
正在确认保存结果
与已有时段冲突，请调整时间
库存已发生变化，请重新核对
权限已失效，请重新进入
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```bash
node --test tests/venue-pitch-setup-and-inventory-reference-artifacts.test.mjs
```

Expected: FAIL because inventory-v2 files do not exist.

- [ ] **Step 3: Implement the fixed shell and four initial list states**

The page-specific CSS owns month/week/pitch selector, summary, list, slot cards, fixed inventory action, picker groups, and calendar grid. Preserve only the v1 status material mapping from `artifacts/ui/references/venue-inventory-workbench.html`: `AVAILABLE → #059669`, `LOCKED → #B45309`, `CLOSED → muted slate`, `BOOKED → indigo`, always with text.

The hierarchy is:

```text
custom-navigation safe area + venue identity (no header CTA)
→ month / 更多日期
→ natural-week strip
→ compact current-pitch selector
→ date and slot-count summary
→ independently scrolling slot list
→ fixed bottom 新增时段 + safe area
→ optional one scrim and one sheet
```

Implement `initial-loading`, `load-error`, `day-empty`, and `day-ready`. Loading/error replaces only summary/list when identity context exists, and failure never masquerades as zero slots.

- [ ] **Step 4: Run initial-state assertions**

Run:

```bash
node --test tests/venue-pitch-setup-and-inventory-reference-artifacts.test.mjs
```

Expected: initial loading/error/empty/ready assertions PASS; switch/sheet/editor states remain explicit failures.

- [ ] **Step 5: Implement five switch-progress states**

Add `pitch-refreshing`, `pitch-load-error`, `date-refreshing`, `date-load-error`, and `cross-week-ready`. Each failure preserves the new dimension selection and the other dimension. `cross-week-ready` displays 17–23, selects 23, and retains `pitch-7-001`.

- [ ] **Step 6: Run switch-state assertions**

Run:

```bash
node --test tests/venue-pitch-setup-and-inventory-reference-artifacts.test.mjs
```

Expected: pitch/date loading, retry, preservation, and cross-week assertions PASS.

- [ ] **Step 7: Implement and verify the long-list state**

Add `long-list-end`; initialize the independent list at its maximum scroll position and show its final slot fully above the fixed action. Run the focused Node test and expect the long-list data/markup assertion to PASS; browser geometry is verified later by the live audit.

- [ ] **Step 8: Implement the physical-pitch picker and calendar sheet**

Use one reusable sheet container. `pitch-picker-open` groups 5-person pitches before 7-person pitches and selects `pitch-7-001`; labels combine full display name and numeric format. `calendar-open` shows the complete August grid for natural-week context, disables dates outside August 10–23 with text/a11y semantics, marks one pending date, and uses a fixed `确认日期` action. Calendar confirm updates the same page; it does not link to another page.

- [ ] **Step 9: Run picker and calendar assertions**

Run:

```bash
node --test tests/venue-pitch-setup-and-inventory-reference-artifacts.test.mjs
```

Expected: grouped picker, canonical ordering, date window, disabled-date, and same-page calendar assertions PASS.

- [ ] **Step 10: Implement three slot editor states**

Add `create-slot-open`, `edit-slot-open`, and `create-slot-overlap`. Create context chips contain date, full `A场`, `7人制`, and `09:30–11:00`. Edit time is read-only. Overlap preserves input and shows conflicting `10:30–12:00`.

- [ ] **Step 11: Run slot editor assertions**

Run:

```bash
node --test tests/venue-pitch-setup-and-inventory-reference-artifacts.test.mjs
```

Expected: create/edit/overlap state assertions PASS; save/concurrency/permission states remain explicit failures.

- [ ] **Step 12: Implement save, concurrency, and permission states**

Add `save-in-progress`, `save-result-unknown`, `concurrent-change`, and `permission-expired`. In-progress/unknown retain inputs and disable close/duplicate submission. Concurrent change retains both authoritative day context and draft review copy. Permission loss disables every write control while keeping context readable.

- [ ] **Step 13: Run save/concurrency/permission assertions**

Run:

```bash
node --test tests/venue-pitch-setup-and-inventory-reference-artifacts.test.mjs
```

Expected: every inventory state and transition assertion PASS.

- [ ] **Step 14: Implement the inventory runtime audit**

Return live-DOM violations for all shared setup audit rules plus inventory rules: no header CTA; one selected pitch; disabled calendar dates cannot be focused/clicked; selected date is within the 14-day window; picker order matches manifest; current pitch/date persist in cross-dimension states; list has independent overflow; fixed CTA is visible and centred; final long-list row bottom is at or above the fixed-action top; no visible sheet or icon extends beyond the canvas.

- [ ] **Step 15: Add the Reference-only review record**

Create one row per inventory state with all six evidence slots, mark old `venue-inventory-workbench` evidence as historical/superseded for this revision without deleting it, and record the same pending gates, source paths, observation headings, and Fixture deletion condition as setup.

- [ ] **Step 16: Run focused and regression tests**

Run:

```bash
node --test tests/venue-pitch-setup-and-inventory-reference-artifacts.test.mjs tests/venue-inventory-artifact.test.mjs tests/intent-entry-foundation.test.mjs
```

Expected: PASS. Both new Artifact contracts pass while v1 inventory evidence remains intact.

- [ ] **Step 17: Check the required file-size budgets**

Run:

```bash
wc -l artifacts/ui/references/venue-operations-reference.css \
  artifacts/ui/references/venue-pitch-setup.html \
  artifacts/ui/references/venue-pitch-setup.css \
  artifacts/ui/references/venue-pitch-setup-data.js \
  artifacts/ui/references/venue-pitch-setup.js \
  artifacts/ui/references/venue-inventory-workbench-v2.html \
  artifacts/ui/references/venue-inventory-workbench-v2.css \
  artifacts/ui/references/venue-inventory-workbench-v2-data.js \
  artifacts/ui/references/venue-inventory-workbench-v2.js
```

Expected: each HTML under 120 lines, shared CSS under 300 lines, each page CSS under 500 lines, each immutable data module under 450 lines, and each render/audit controller under 500 lines. A budget failure blocks the checkpoint; split the over-budget responsibility into another explicitly named local module, update the plan file map/test/commit paths in the same commit, and re-run this check before proceeding.

- [ ] **Step 18: Commit the browser Artifact checkpoint**

Run:

```bash
git add docs/superpowers/specs/2026-08-10-venue-pitch-setup-and-inventory-revision-design.md \
  docs/superpowers/plans/2026-08-10-venue-pitch-setup-and-inventory-reference-artifacts.md \
  tests/venue-pitch-setup-and-inventory-reference-artifacts.test.mjs \
  artifacts/ui/README.md \
  artifacts/ui/screen-manifest/venue-pitch-setup.yaml \
  artifacts/ui/screen-manifest/venue-inventory-workbench-v2.yaml \
  artifacts/ui/flows/venue-pitch-setup.md \
  artifacts/ui/flows/venue-inventory-workbench-v2.md \
  artifacts/ui/references/venue-operations-reference.css \
  artifacts/ui/references/venue-pitch-setup.html \
  artifacts/ui/references/venue-pitch-setup.css \
  artifacts/ui/references/venue-pitch-setup-data.js \
  artifacts/ui/references/venue-pitch-setup.js \
  artifacts/ui/references/venue-inventory-workbench-v2.html \
  artifacts/ui/references/venue-inventory-workbench-v2.css \
  artifacts/ui/references/venue-inventory-workbench-v2-data.js \
  artifacts/ui/references/venue-inventory-workbench-v2.js \
  artifacts/ui/reviews/venue-pitch-setup/README.md \
  artifacts/ui/reviews/venue-inventory-workbench-v2/README.md
git commit -m "design: add venue pitch setup and inventory v2 artifacts"
```

Expected: one reviewable commit containing only the confirmed spec status, plan, browser references, their contracts, and focused tests.

### Task 5: Execute live browser audits and create Reference evidence

**Files:**
- Create: `artifacts/ui/reviews/venue-pitch-setup/reference-board.html`
- Create: one `artifacts/ui/reviews/venue-pitch-setup/<setup-state>-reference-375x812.png` for every exact `setupStates` entry from Task 1
- Create: `artifacts/ui/reviews/venue-inventory-workbench-v2/reference-board.html`
- Create: one `artifacts/ui/reviews/venue-inventory-workbench-v2/<inventory-state>-reference-375x812.png` for every exact `inventoryStates` entry from Task 1
- Modify: `artifacts/ui/reviews/venue-pitch-setup/README.md`
- Modify: `artifacts/ui/reviews/venue-inventory-workbench-v2/README.md`
- Modify: `tests/venue-pitch-setup-and-inventory-reference-artifacts.test.mjs`

- [ ] **Step 1: Add failing Reference-evidence assertions**

Add a `pngDimensions()` helper to the focused Node test. For every setup and inventory state, require its exact `*-reference-375x812.png`, assert PNG dimensions `{width: 375, height: 812}`, assert the matching README names it, and assert the matching `reference-board.html` contains an image/link and all six future evidence-slot labels. Require both review records to contain non-empty sections named `composition`, `geometry/spacing`, `component hierarchy`, `typography/color/material`, `icon assets`, `copy`, and `state semantics`, while leaving `Reference Artifact visual approval: pending` unchanged.

- [ ] **Step 2: Run the evidence test to verify it fails**

Run:

```bash
node --test tests/venue-pitch-setup-and-inventory-reference-artifacts.test.mjs
```

Expected: FAIL only because Reference PNGs, boards, and populated observations do not yet exist.

- [ ] **Step 3: Verify browser tooling and start the local server**

Run:

```bash
command -v npx
```

Expected: an absolute `npx` path.

In a dedicated terminal/session, run from the worktree:

```bash
python3 -m http.server 8099
```

Expected: `Serving HTTP on ... port 8099`; keep this terminal running only through Task 5.

- [ ] **Step 4: Audit and capture every setup state at the target viewport**

Create a temporary capture directory under the repository-standard Playwright output root:

```bash
mkdir -p output/playwright/venue-pitch-setup-reference
```

Open one uninterrupted session and resize it once:

```bash
/Users/fan/.codex/skills/playwright/scripts/playwright_cli.sh --session venue-setup-reference open about:blank
/Users/fan/.codex/skills/playwright/scripts/playwright_cli.sh --session venue-setup-reference resize 375 812
```

For each exact setup state below, run the same four commands, substituting only `<state>`:

```text
initial-loading
load-error
first-entry-empty
inactive-only
add-first-open
first-pitch-draft
unnamed-pitch-draft
first-save-success
six-pitch-list
edit-preset-open
edit-custom-open
field-validation
deactivate-blocked
unused-delete-confirm
unused-deleted-draft
deactivated-draft
reactivated-draft
save-in-progress
save-failed
configuration-changed
save-result-unknown
unsaved-leave-confirm
```

Commands:

```bash
/Users/fan/.codex/skills/playwright/scripts/playwright_cli.sh --session venue-setup-reference goto "http://127.0.0.1:8099/artifacts/ui/references/venue-pitch-setup.html?state=<state>"
/Users/fan/.codex/skills/playwright/scripts/playwright_cli.sh --session venue-setup-reference eval "window.__artifactAudit__()"
/Users/fan/.codex/skills/playwright/scripts/playwright_cli.sh --session venue-setup-reference console error
/Users/fan/.codex/skills/playwright/scripts/playwright_cli.sh --session venue-setup-reference screenshot --filename="output/playwright/venue-pitch-setup-reference/<state>-reference-375x812.png"
```

Expected for every state: evaluation result `[]`, no console errors, and screenshot saved at exactly `375 × 812`. A non-empty audit or console error blocks capture; fix the responsible page file, re-run focused tests, then re-audit every affected state without recreating the session.

- [ ] **Step 5: Audit and capture every inventory state at the target viewport**

Create:

```bash
mkdir -p output/playwright/venue-inventory-v2-reference
```

Open one uninterrupted `venue-inventory-v2-reference` session at `about:blank`, resize it once to `375 812`, then repeat the `goto`, audit, `console error`, and screenshot commands from Step 4 with page `venue-inventory-workbench-v2.html`, output directory `output/playwright/venue-inventory-v2-reference`, and each exact state:

```text
initial-loading
load-error
day-empty
day-ready
pitch-picker-open
pitch-refreshing
pitch-load-error
calendar-open
date-refreshing
date-load-error
cross-week-ready
long-list-end
create-slot-open
edit-slot-open
save-in-progress
save-result-unknown
create-slot-overlap
concurrent-change
permission-expired
```

Expected for every state: `window.__artifactAudit__()` returns `[]`, `console error` reports no errors for the uninterrupted session, and the screenshot is `375 × 812`.

- [ ] **Step 6: Inspect the Reference images before promoting them**

Open each PNG from `output/playwright/**` at original resolution. Check all forty-one states, grouping repeated shell states while still viewing each file. Record and resolve differences from the confirmed spec in these categories: composition, geometry/spacing, component hierarchy, typography/color/material, icon assets, copy, and state semantics. Specifically verify centred button labels, icon/chevron containment, a single sheet/dialog, list reachability above the fixed action, inactive-only recovery, inline custom players input, calendar disabled dates, cross-week 17–23, retained draft/error states, and truthful loading/permission states.

- [ ] **Step 7: Promote approved captures and build Reference boards**

After inspection, move each setup PNG into `artifacts/ui/reviews/venue-pitch-setup/` and each inventory PNG into `artifacts/ui/reviews/venue-inventory-workbench-v2/`, preserving the exact filenames asserted in Step 1. Create one local `reference-board.html` per directory that shows all state images at logical width 375, links to each full PNG, identifies the exact state, and labels implementation/side-by-side/overlay/difference as `not started`. Boards must not fetch remote scripts, fonts, images, or styles.

Run the exact promotion commands only after inspection:

```bash
mv output/playwright/venue-pitch-setup-reference/*-reference-375x812.png artifacts/ui/reviews/venue-pitch-setup/
mv output/playwright/venue-inventory-v2-reference/*-reference-375x812.png artifacts/ui/reviews/venue-inventory-workbench-v2/
```

Expected: 22 setup PNGs and 19 inventory PNGs move into their tracked review directories without changing filenames.

After every asserted PNG is present in its review directory, close both named Playwright sessions, remove only the now-empty temporary capture directories with `rmdir`, and stop the dedicated HTTP server with `Ctrl-C`:

```bash
/Users/fan/.codex/skills/playwright/scripts/playwright_cli.sh --session venue-setup-reference close
/Users/fan/.codex/skills/playwright/scripts/playwright_cli.sh --session venue-inventory-v2-reference close
rmdir output/playwright/venue-pitch-setup-reference
rmdir output/playwright/venue-inventory-v2-reference
```

Expected: both sessions close; both exact temporary directories are empty and removed; other `output/playwright` data is untouched; the HTTP server exits normally.

- [ ] **Step 8: Populate the visual observation records truthfully**

Under every required observation heading, record the inspected shared findings and any state-specific deviations. Name the browser runtime, exact URL pattern, viewport, capture method, and screenshot files. Keep both gates as:

```text
Reference Artifact visual approval: pending
Native Fixture visual approval: not started
```

Do not add implementation screenshots, side-by-side images, overlays, differences, or claims of user approval in this Reference-only plan.

- [ ] **Step 9: Run complete Reference verification**

Run:

```bash
node --test tests/venue-pitch-setup-and-inventory-reference-artifacts.test.mjs tests/venue-inventory-artifact.test.mjs tests/intent-entry-foundation.test.mjs
npm run typecheck
npm run lint
git diff --check
git status --short
```

Expected: all tests/typecheck/lint PASS; `git diff --check` is empty; status contains only the intentional spec/plan, two new Artifact families, focused tests, Reference review boards, and forty-one Reference PNGs. The two temporary capture directories no longer exist. No `miniprogram/dev`, production manifest, contract, backend, or migration file is changed.

- [ ] **Step 10: Commit the Reference evidence checkpoint**

Run:

```bash
git add tests/venue-pitch-setup-and-inventory-reference-artifacts.test.mjs \
  artifacts/ui/reviews/venue-pitch-setup \
  artifacts/ui/reviews/venue-inventory-workbench-v2
git commit -m "test: add venue operations reference evidence"
```

Expected: a second focused commit containing the browser-verified Reference evidence and review records.

- [ ] **Step 11: Present the visual gate and stop**

Present direct clickable links to both review READMEs, both Reference boards, and the key `six-pitch-list`, `edit-custom-open`, `deactivate-blocked`, `day-ready`, `pitch-picker-open`, `calendar-open`, `cross-week-ready`, and `long-list-end` PNGs. Ask the user for explicit Reference Artifact visual approval.

Stop here while `Reference Artifact visual approval: pending`. Do not create or modify a native Mini Program page, development Fixture, contract, production route, backend endpoint, database model/migration, or HTTP adapter. After explicit approval, write a separate implementation plan for only the physical-pitch setup native Fixture and its same-viewport Reference/implementation/side-by-side/overlay/difference evidence.
