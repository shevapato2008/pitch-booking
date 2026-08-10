# Venue Inventory Native Fixture Preview Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an isolated WeChat Mini Program Fixture preview of the approved venue inventory workbench, capture all five states at 375 × 812, and stop for native visual approval before contract or backend work.

**Architecture:** Add one development-only page that the existing `dev/pages/**` route discovery includes automatically, one immutable visual Fixture module, and deterministic `state` query mapping for the approved states. Reuse the existing runtime capsule-safe header calculation and development build boundary; production continues excluding the entire `miniprogram/dev` tree. Treat the HTML Artifact as the frozen visual authority and keep all save behavior explicitly preview-only.

**Tech Stack:** TypeScript, WeChat Mini Program WXML/WXSS, Jest, Node test runner, repository build scripts, WeChat DevTools, Pillow visual-review script.

---

## Chunk 1: Gate, route, and production isolation

### Task 1: Record the approved Reference gate

**Files:**
- Modify: `tests/venue-inventory-artifact.test.mjs`
- Modify: `artifacts/ui/screen-manifest/venue-inventory-workbench.yaml`
- Modify: `artifacts/ui/reviews/venue-inventory-workbench/README.md`
- Modify: `docs/superpowers/specs/2026-08-10-intent-entry-and-venue-inventory-design.md`

- [ ] **Step 1: Change the Artifact test to require the two-stage gate**

Update the expected manifest gate to `reference-artifact-approved-native-fixture-pending`, then assert the review record contains `Reference Artifact visual approval: approved on 2026-08-10` and `Native Fixture visual approval: pending`.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `node --test tests/venue-inventory-artifact.test.mjs`

Expected: FAIL because the manifest and review record still describe Reference approval as pending.

- [ ] **Step 3: Update the manifest, review record, and parent spec**

Record the approved Reference state without claiming native approval. In the parent spec, replace “待独立 Artifact、Fixture Demo 和同 viewport 对比确认” with “Reference Artifact 已确认；待原生 Fixture Demo 和同 viewport 对比确认”.

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `node --test tests/venue-inventory-artifact.test.mjs`

Expected: PASS.

### Task 2: Add the isolated preview route contract

**Files:**
- Create: `tests/venue-inventory-native-preview.test.mjs`
- Modify: `tests/build-booking-preview.test.mjs`
- Create: `miniprogram/dev/pages/venue-inventory/index.ts`
- Create: `miniprogram/dev/pages/venue-inventory/index.json`
- Create: `miniprogram/dev/pages/venue-inventory/index.wxml`
- Create: `miniprogram/dev/pages/venue-inventory/index.wxss`

- [ ] **Step 1: Write the failing route and isolation tests**

Keep `miniprogram/dev/app-pages.json` restricted to its two booking preview routes. Require the automatically discovered `dev/pages/venue-inventory/index` in the built development route list, require the four built page artifacts, and require `dist/miniprogram-production/dev` to remain absent. The focused native-preview test must also assert that `miniprogram/app.json` does not contain the route or venue Fixture copy.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/build-booking-preview.test.mjs tests/venue-inventory-native-preview.test.mjs`

Expected: FAIL because the route and page files do not exist.

- [ ] **Step 3: Add the route and minimal page shell**

Add a custom-navigation page shell under `miniprogram/dev/pages/venue-inventory/` with `Page({ data: {}, onLoad() {} })` and syntactically valid WXML/WXSS/JSON so the existing development route discovery can find it. Do not modify the two-route booking preview manifest.

- [ ] **Step 4: Run the build tests to verify the route boundary passes**

Run: `node --test tests/build-booking-preview.test.mjs tests/venue-inventory-native-preview.test.mjs`

Expected: PASS for route discovery and production exclusion assertions; later visual-content assertions may still fail until Chunk 2.

- [ ] **Step 5: Commit Chunk 1**

Run: `git add tests/venue-inventory-artifact.test.mjs tests/venue-inventory-native-preview.test.mjs tests/build-booking-preview.test.mjs artifacts/ui/screen-manifest/venue-inventory-workbench.yaml artifacts/ui/reviews/venue-inventory-workbench/README.md docs/superpowers/specs/2026-08-10-intent-entry-and-venue-inventory-design.md miniprogram/dev/pages/venue-inventory && git commit -m "test: open venue inventory native preview gate"`

## Chunk 2: Deterministic native Fixture and interaction states

### Task 3: Freeze the development-only inventory Fixture

**Files:**
- Create: `miniprogram/dev/venue-inventory-fixture.ts`
- Create: `miniprogram/dev/venue-inventory-fixture.test.ts`

- [ ] **Step 1: Write failing Fixture tests**

Require these exported concepts:

```ts
type VenueInventoryVisualState =
  | "day-ready"
  | "create-slot-open"
  | "edit-slot-open"
  | "save-result-unknown"
  | "create-slot-overlap";

resolveVenueInventoryVisualState(input: unknown): VenueInventoryVisualState
VENUE_INVENTORY_VISUAL_FIXTURE
```

Assert invalid query values fall back to `day-ready`; the venue is exactly `渤海元丰足球场`; the seven dates, two pitches, and five slots match the approved Artifact; editable and read-only states are explicit; create values remain `09:30`, `11:00`, and `200`.

- [ ] **Step 2: Run the Fixture test to verify it fails**

Run: `npx jest miniprogram/dev/venue-inventory-fixture.test.ts --runInBand`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the minimal immutable Fixture**

Export the five-state resolver and `Object.freeze`-backed page data. Include development-only copy and the deletion condition `delete after real inventory backend integration`. Do not add a service, HTTP adapter, membership implementation, or simulated success result.

- [ ] **Step 4: Run the Fixture test to verify it passes**

Run: `npx jest miniprogram/dev/venue-inventory-fixture.test.ts --runInBand`

Expected: PASS.

### Task 4: Implement state mapping and lightweight preview interactions

**Files:**
- Create: `miniprogram/dev/pages/venue-inventory/index.test.ts`
- Modify: `miniprogram/dev/pages/venue-inventory/index.ts`
- Modify: `miniprogram/dev/pages/venue-inventory/index.wxml`
- Modify: `miniprogram/dev/pages/venue-inventory/index.wxss`
- Modify: `miniprogram/dev/pages/venue-inventory/index.json`
- Reuse: `miniprogram/dev/intent-header-layout.ts`

- [ ] **Step 1: Write failing page-state tests**

Load the page through the existing Jest `Page()` capture pattern. Assert `onLoad({ state })` reads capsule-safe header dimensions and selects each exact state. Assert invalid state falls back to `day-ready`; `onOpenCreate` selects `create-slot-open`; editable slot `slot-1600` selects `edit-slot-open`; read-only or unknown slots do nothing; close/cancel returns to `day-ready`; preview save selects `save-result-unknown`; a second save while pending does nothing.

- [ ] **Step 2: Write failing structural UI tests**

Read WXML/WXSS and assert visible labels and state copy, `disabled` on read-only and confirmation controls, modal semantics, 88rpx minimum touch targets, bottom safe-area padding, custom navigation, no emoji, no external assets, and no animation except the confirmation spinner. Require the approved tokens and all five state names.

- [ ] **Step 3: Run page tests to verify they fail**

Run: `npx jest miniprogram/dev/pages/venue-inventory/index.test.ts --runInBand`

Expected: FAIL because the shell has no state behavior or approved UI.

- [ ] **Step 4: Implement the page controller**

Use `readIntentHeaderLayout()` for status/capsule clearance. Bind the Fixture to page data, keep panel mode derived from `visualState`, and implement only deterministic preview transitions. Use `wx.showToast({ title: "仅视觉预览，未写入库存", icon: "none" })` for controls whose real behavior belongs to the contract/backend stage.

- [ ] **Step 5: Implement the approved WXML hierarchy**

Render the venue header, week strip, pitch tabs, summary, mixed slot rows, scrim, and one bottom sheet whose content branches by visual state. Preserve the approved wording, explicit text status, read-only time in edit mode, retained inputs in unknown/overlap modes, and true disabled controls during confirmation.

- [ ] **Step 6: Implement the approved WXSS**

Translate the 375px Artifact geometry to 750rpx where stable while leaving runtime header dimensions in px. Reuse the existing tokens and keep the 4/8 spacing rhythm, minimum 88rpx touch targets, light-mode material, 34% scrim, 44rpx top sheet radius, pressed feedback without layout shift, and bottom safe-area clearance.

- [ ] **Step 7: Run page, Fixture, and native-preview tests**

Run: `npx jest miniprogram/dev/venue-inventory-fixture.test.ts miniprogram/dev/pages/venue-inventory/index.test.ts --runInBand`

Run: `node --test tests/venue-inventory-native-preview.test.mjs`

Expected: PASS.

- [ ] **Step 8: Commit Chunk 2**

Run: `git add miniprogram/dev/venue-inventory-fixture.ts miniprogram/dev/venue-inventory-fixture.test.ts miniprogram/dev/pages/venue-inventory tests/venue-inventory-native-preview.test.mjs && git commit -m "feat: add venue inventory native fixture preview"`

## Chunk 3: Build verification and native visual evidence

### Task 5: Verify development behavior and production isolation

**Files:**
- Verify: `dist/miniprogram-development`
- Verify: `dist/miniprogram-production`

- [ ] **Step 1: Run focused and repository verification**

Run: `npm run typecheck`

Run: `npm run lint`

Run: `npm test`

Expected: all tests pass; only the known pre-existing ts-jest TS151001 warning may remain.

- [ ] **Step 2: Build both modes and audit production**

Run: `npm run build:miniprogram:development`

Run: `MINIPROGRAM_TENCENT_MAP_KEY=AAAAA-BBBBB-CCCCC-DDDDD-EEEEE-FFFFF npm run build:miniprogram:production`

Run: `npm run audit:miniprogram-package`

Expected: development includes the native route and Fixture; production contains no `dev` directory, venue-inventory route, preview copy, or Fixture data.

### Task 6: Capture the five native states at the approved viewport

**Files:**
- Create: `artifacts/ui/reviews/venue-inventory-workbench/day-ready-implementation-375x812.png`
- Create: `artifacts/ui/reviews/venue-inventory-workbench/create-slot-open-implementation-375x812.png`
- Create: `artifacts/ui/reviews/venue-inventory-workbench/edit-slot-open-implementation-375x812.png`
- Create: `artifacts/ui/reviews/venue-inventory-workbench/save-result-unknown-implementation-375x812.png`
- Create: `artifacts/ui/reviews/venue-inventory-workbench/create-slot-overlap-implementation-375x812.png`

- [ ] **Step 1: Open the development build in WeChat DevTools**

Use the repository environment check and the existing DevTools project configuration. Select iPhone X at 375 × 812 and navigate with the exact deep link `dev/pages/venue-inventory/index?state=<state>`.

- [ ] **Step 2: Capture each deterministic state**

Prefer the DevTools capture API. If the known API timeout recurs, use the previously documented simulator-window capture fallback and crop only the actual 375 × 812 simulator content. Record the runtime and method honestly in the review README.

- [ ] **Step 3: Smoke-check a large safe area**

Open the page once on iPhone 14 Pro and verify the title/button clear the status bar and capsule. This is a smoke check, not a replacement Artifact.

### Task 7: Create comparison evidence and run the visual audit

**Files:**
- Create: five `*-side-by-side-375x812.png`
- Create: five `*-overlay-50-375x812.png`
- Create: five `*-difference-375x812.png`
- Modify: `artifacts/ui/reviews/venue-inventory-workbench/README.md`

- [ ] **Step 1: Generate same-viewport comparisons**

For each state, run `scripts/create_visual_review.py` with the frozen reference and native implementation screenshot to create side-by-side, 50% overlay, and difference images.

- [ ] **Step 2: Inspect all four evidence forms**

Review reference, implementation, side-by-side, overlay, and difference at actual size. Record composition, geometry/spacing, component hierarchy, typography/color/material, icon assets, copy, and state semantics. Do not call automated layout checks “visual approval”.

- [ ] **Step 3: Complete lightweight UI smoke checks**

Confirm no horizontal overflow at 375px, all targets are at least 44px, modal and fixed content clear safe areas, disabled states are truthful, state is not color-only, console has no errors/warnings, and the spinner is the only continuous animation. Note out-of-scope dark mode, landscape, tablet, and largest Dynamic Type rather than broadening this approved light-mode mobile slice.

- [ ] **Step 4: Mark native visual approval pending**

Update the review README with filenames, capture method, visual observations, and `Native Fixture visual approval: pending`. Do not change the gate to approved.

- [ ] **Step 5: Run final verification and inspect the diff**

Run: `npm run typecheck`

Run: `npm run lint`

Run: `npm test`

Run: `git diff --check`

Run: `git status --short`

Expected: verification passes and status contains only intentional plan, native preview, docs, and visual evidence changes.

- [ ] **Step 6: Commit the evidence**

Run: `git add docs/superpowers/plans/2026-08-10-venue-inventory-native-preview.md artifacts/ui/reviews/venue-inventory-workbench artifacts/ui/screen-manifest/venue-inventory-workbench.yaml docs/superpowers/specs/2026-08-10-intent-entry-and-venue-inventory-design.md && git commit -m "test: add venue inventory native visual evidence"`

- [ ] **Step 7: Stop at the visual gate**

Present direct links to the five native screenshots and comparison evidence. Ask for explicit native Fixture visual approval. Do not create contracts, backend endpoints, membership data, production routes, or delete the Fixture in this plan.
