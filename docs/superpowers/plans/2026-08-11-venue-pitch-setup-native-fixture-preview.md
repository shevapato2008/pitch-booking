# Venue Pitch Setup Native Fixture Preview Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an isolated WeChat Mini Program Fixture preview of the approved physical-pitch setup Reference, capture same-viewport comparison evidence for the thirteen key journey states, and stop for explicit native visual approval.

**Architecture:** Add one development-only native page discovered by the existing `miniprogram/dev/pages/**` build convention and one immutable setup Fixture module that derives all twenty-two approved states from shared base pitch data. The page reuses the existing capsule-safe header calculation and keeps one page controller, one WXML hierarchy, and one WXSS file; production continues excluding the entire `miniprogram/dev` tree. The browser Reference remains the visual authority, while this plan deliberately leaves the inventory-v2 native rewrite, contracts, backend, and real saves for later slices.

**Tech Stack:** TypeScript, WeChat Mini Program WXML/WXSS, Jest, Node test runner, repository Mini Program build/audit scripts, WeChat DevTools, Pillow comparison script, `@ui-ux-pro-max`.

---

## Chunk 1: Native setup Fixture and visual gate

### Task 1: Record Reference approval and open an isolated native route

**Files:**
- Modify: `docs/superpowers/specs/2026-08-10-venue-pitch-setup-and-inventory-revision-design.md`
- Modify: `artifacts/ui/screen-manifest/venue-pitch-setup.yaml`
- Modify: `artifacts/ui/screen-manifest/venue-inventory-workbench-v2.yaml`
- Modify: `artifacts/ui/reviews/venue-pitch-setup/README.md`
- Modify: `artifacts/ui/reviews/venue-inventory-workbench-v2/README.md`
- Modify: `tests/venue-pitch-setup-and-inventory-reference-artifacts.test.mjs`
- Create: `tests/venue-pitch-setup-native-preview.test.mjs`
- Modify: `tests/build-booking-preview.test.mjs`
- Create: `miniprogram/dev/pages/venue-pitch-setup/index.ts`
- Create: `miniprogram/dev/pages/venue-pitch-setup/index.json`
- Create: `miniprogram/dev/pages/venue-pitch-setup/index.wxml`
- Create: `miniprogram/dev/pages/venue-pitch-setup/index.wxss`

- [ ] **Step 1: Write the failing approval-gate assertions**

Change the focused Artifact test to require both manifests to use:

```yaml
reference_gate: reference-approved-native-pending
```

Require both review READMEs to say `Reference Artifact visual approval: approved on 2026-08-11`. Require setup to say `Native Fixture visual approval: pending`, inventory v2 to say `Native Fixture visual approval: not started`, and both to remain `Production disabled`.

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```bash
node --test tests/venue-pitch-setup-and-inventory-reference-artifacts.test.mjs
```

Expected: FAIL because the manifests and review records still show Reference approval pending.

- [ ] **Step 3: Record the approved gate without claiming native approval**

Update both manifests and review records exactly as Step 1 requires. Change the spec status to `Reference Artifacts 已由用户确认；物理场地配置原生 Fixture 待实现`. Do not alter Reference screenshots, state data, or the inventory v1/v2 layouts.

- [ ] **Step 4: Run the focused Artifact test**

Run:

```bash
node --test tests/venue-pitch-setup-and-inventory-reference-artifacts.test.mjs
```

Expected: PASS with 32 tests and both native gates still unapproved.

- [ ] **Step 5: Write failing route and production-isolation tests**

Create `tests/venue-pitch-setup-native-preview.test.mjs` to require all four source page files and exact page config `{ "navigationStyle": "custom" }`. Extend `tests/build-booking-preview.test.mjs` so development routes include, in deterministic discovery order:

```text
dev/pages/intent-entry/index
dev/pages/intent-home/index
dev/pages/venue-inventory/index
dev/pages/venue-pitch-setup/index
```

Require all four compiled page artifacts in development. Require production to keep its existing five routes, contain no `dev` directory, and contain neither `venue-pitch-setup` nor the copy `配置场地`.

- [ ] **Step 6: Run route tests to verify they fail**

Run:

```bash
node --test tests/venue-pitch-setup-native-preview.test.mjs tests/build-booking-preview.test.mjs
```

Expected: FAIL because the new native route does not exist.

- [ ] **Step 7: Add the minimal custom-navigation page shell**

Create a valid shell with `Page({ data: {}, onLoad() {} })`, one root view, empty page-specific styling, and `navigationStyle: custom`. Do not modify `miniprogram/dev/app-pages.json`; automatic development route discovery owns this page.

- [ ] **Step 8: Run route and build-boundary tests**

Run:

```bash
node --test tests/venue-pitch-setup-native-preview.test.mjs tests/build-booking-preview.test.mjs
```

Expected: PASS for source route, compiled development route, deterministic route order, and production exclusion.

- [ ] **Step 9: Commit the gate and route checkpoint**

Run:

```bash
git add docs/superpowers/specs/2026-08-10-venue-pitch-setup-and-inventory-revision-design.md \
  artifacts/ui/screen-manifest/venue-pitch-setup.yaml \
  artifacts/ui/screen-manifest/venue-inventory-workbench-v2.yaml \
  artifacts/ui/reviews/venue-pitch-setup/README.md \
  artifacts/ui/reviews/venue-inventory-workbench-v2/README.md \
  tests/venue-pitch-setup-and-inventory-reference-artifacts.test.mjs \
  tests/venue-pitch-setup-native-preview.test.mjs \
  tests/build-booking-preview.test.mjs \
  miniprogram/dev/pages/venue-pitch-setup
git commit -m "test: open physical pitch setup native gate"
```

### Task 2: Implement the deterministic Fixture and native page

**Files:**
- Create: `miniprogram/dev/venue-pitch-setup-fixture.ts`
- Create: `miniprogram/dev/venue-pitch-setup-fixture.test.ts`
- Create: `miniprogram/dev/pages/venue-pitch-setup/index.test.ts`
- Modify: `miniprogram/dev/pages/venue-pitch-setup/index.ts`
- Modify: `miniprogram/dev/pages/venue-pitch-setup/index.wxml`
- Modify: `miniprogram/dev/pages/venue-pitch-setup/index.wxss`
- Modify: `miniprogram/dev/pages/venue-pitch-setup/index.json`
- Reuse: `miniprogram/dev/intent-header-layout.ts`

- [ ] **Step 1: Write failing Fixture tests**

Require these exports:

```ts
type VenuePitchSetupVisualState =
  | "initial-loading"
  | "load-error"
  | "first-entry-empty"
  | "inactive-only"
  | "add-first-open"
  | "first-pitch-draft"
  | "unnamed-pitch-draft"
  | "first-save-success"
  | "six-pitch-list"
  | "edit-preset-open"
  | "edit-custom-open"
  | "field-validation"
  | "deactivate-blocked"
  | "unused-delete-confirm"
  | "unused-deleted-draft"
  | "deactivated-draft"
  | "reactivated-draft"
  | "save-in-progress"
  | "save-failed"
  | "configuration-changed"
  | "save-result-unknown"
  | "unsaved-leave-confirm";

resolveVenuePitchSetupVisualState(input: unknown): VenuePitchSetupVisualState;
buildVenuePitchSetupView(state: VenuePitchSetupVisualState): VenuePitchSetupView;
VENUE_PITCH_SETUP_FIXTURE;
```

Assert invalid input falls back to `six-pitch-list`. Assert the venue, canonical six pitches, capability snapshots, `draft-pitch-1 → pitch-7-001 / A场` handoff, custom `6` players input, blocker counts, and deletion condition match the approved manifest. Require deep-frozen base Fixture data; derived views may be new immutable objects.

- [ ] **Step 2: Run Fixture tests to verify they fail**

Run:

```bash
npx jest miniprogram/dev/venue-pitch-setup-fixture.test.ts --runInBand
```

Expected: FAIL because the Fixture module does not exist.

- [ ] **Step 3: Implement the smallest reusable Fixture model**

Keep one frozen base pitch/capability collection and one state descriptor map. `buildVenuePitchSetupView()` derives visible pitches, count, editor mode, page action, banners, disabled states, and local transition targets without duplicating twenty-two full page objects. Include `fixtureNotice: "仅视觉预览，未写入场地配置"` and the full deletion condition. Do not add services, HTTP adapters, idempotency implementations, membership data, or simulated production success.

- [ ] **Step 4: Run Fixture tests**

Run:

```bash
npx jest miniprogram/dev/venue-pitch-setup-fixture.test.ts --runInBand
```

Expected: PASS.

- [ ] **Step 5: Write failing page-controller tests**

Use the existing captured-`Page()` Jest pattern. Assert:

- `onLoad({ state })` reads `readIntentHeaderLayout()` and maps every valid query state;
- invalid/missing state uses `six-pitch-list`;
- add opens `add-first-open`, A场 opens `edit-preset-open`, custom format opens inline `edit-custom-open`;
- numeric input accepts a preview value but clamps visual validity to integer `1–99`;
- editor complete writes only the page-draft visual state;
- delete/deactivate/reactivate use the existing approved draft states;
- close/cancel restores the underlying page state;
- duplicate save is disabled in progress/unknown states;
- first-save handoff does not navigate to the still-unimplemented inventory-v2 native page and instead shows the explicit preview-only toast.

- [ ] **Step 6: Write failing WXML/WXSS structure tests**

Require visible copy and semantics for all twenty-two states, one sheet/dialog hierarchy, `scroll-view` for the pitch list, a fixed page action above `env(safe-area-inset-bottom, 0px)`, 88rpx targets, true numeric input for custom players, disabled/read-only format controls, text status plus color, and local CSS/SVG-style icons with no emoji or remote assets.

Require the button reset to appear before component material, every primary/secondary button to use flex centering, the close icon to be a contained X rather than a chevron, and all card/field chevrons to live inside a padded clipped icon box. Require no gradient and no continuous animation except an optional save spinner.

- [ ] **Step 7: Run page tests to verify they fail**

Run:

```bash
npx jest miniprogram/dev/pages/venue-pitch-setup/index.test.ts --runInBand
node --test tests/venue-pitch-setup-native-preview.test.mjs
```

Expected: FAIL because the shell has no approved behavior or visual hierarchy.

- [ ] **Step 8: Implement the page controller**

Use `buildVenuePitchSetupView()` for initial and transition state. Keep only lightweight input draft fields in page data. Use `wx.showToast({ title: "仅视觉预览，未写入场地配置", icon: "none" })` for the visual-only first-save handoff. Never call a real service and never route into the old inventory v1 native page.

- [ ] **Step 9: Implement the WXML hierarchy**

Render the capsule-safe header, instructional callout, count/status, independently scrolling pitch cards, dashed add action, fixed bottom page action, one scrim, and one bottom sheet. The sheet branches within one hierarchy for preset/custom/validation/lifecycle/save/leave states; clicking “其他” expands the number field in that sheet and cannot open a second panel.

- [ ] **Step 10: Implement Reference-aligned WXSS**

Translate the approved `375px` Reference at `2rpx = 1px`, reuse existing native colors/type/spacing, and preserve actual system/capsule safe areas. Lock native button defaults before component styles. Ensure centred labels, full X/chevrons inside their bounds, a scrollable list whose last action is reachable above the fixed CTA, and sheet actions above the Home Indicator.

- [ ] **Step 11: Run focused native tests and line budgets**

Run:

```bash
npx jest miniprogram/dev/venue-pitch-setup-fixture.test.ts miniprogram/dev/pages/venue-pitch-setup/index.test.ts --runInBand
node --test tests/venue-pitch-setup-native-preview.test.mjs tests/build-booking-preview.test.mjs
wc -l miniprogram/dev/venue-pitch-setup-fixture.ts \
  miniprogram/dev/pages/venue-pitch-setup/index.ts \
  miniprogram/dev/pages/venue-pitch-setup/index.wxml \
  miniprogram/dev/pages/venue-pitch-setup/index.wxss
```

Expected: all focused tests PASS; Fixture under 500 lines, controller under 300, WXML under 350, and WXSS under 750. Exceeding a budget blocks the checkpoint; simplify repeated state data or markup rather than creating a component library.

- [ ] **Step 12: Commit the native Fixture page**

Run:

```bash
git add miniprogram/dev/venue-pitch-setup-fixture.ts \
  miniprogram/dev/venue-pitch-setup-fixture.test.ts \
  miniprogram/dev/pages/venue-pitch-setup \
  tests/venue-pitch-setup-native-preview.test.mjs \
  tests/build-booking-preview.test.mjs
git commit -m "feat: add physical pitch setup native fixture"
```

### Task 3: Verify builds and capture native comparison evidence

**Files:**
- Create: thirteen `artifacts/ui/reviews/venue-pitch-setup/<state>-implementation-375x812.png`
- Create: thirteen `artifacts/ui/reviews/venue-pitch-setup/<state>-375x812-side-by-side.png`
- Create: thirteen `artifacts/ui/reviews/venue-pitch-setup/<state>-375x812-overlay-50.png`
- Create: thirteen `artifacts/ui/reviews/venue-pitch-setup/<state>-375x812-difference.png`
- Modify: `artifacts/ui/reviews/venue-pitch-setup/README.md`
- Modify: `artifacts/ui/reviews/venue-pitch-setup/reference-board.html`
- Modify: `tests/venue-pitch-setup-native-preview.test.mjs`

The exact native review states are:

```text
first-entry-empty
add-first-open
first-pitch-draft
first-save-success
six-pitch-list
edit-preset-open
edit-custom-open
deactivate-blocked
unused-deleted-draft
deactivated-draft
reactivated-draft
save-failed
save-result-unknown
```

- [ ] **Step 1: Run focused and repository verification**

Run:

```bash
npm run typecheck
npm run lint
node --test tests/venue-pitch-setup-native-preview.test.mjs tests/build-booking-preview.test.mjs
npx jest miniprogram/dev/venue-pitch-setup-fixture.test.ts miniprogram/dev/pages/venue-pitch-setup/index.test.ts --runInBand
```

Expected: PASS.

- [ ] **Step 2: Build both modes and audit production**

Run:

```bash
npm run build:miniprogram:development
MINIPROGRAM_TENCENT_MAP_KEY=AAAAA-BBBBB-CCCCC-DDDDD-EEEEE-FFFFF npm run build:miniprogram:production
npm run audit:miniprogram-package
```

Expected: development contains `dev/pages/venue-pitch-setup/index` and the Fixture; production contains no `dev` directory, setup route, setup Fixture, preview copy, or Reference data.

- [ ] **Step 3: Add failing native-evidence assertions**

For the thirteen states, require implementation/reference/overlay/difference PNGs at `375 × 812`, side-by-side PNGs at `750 × 812`, exact README filenames, and board links. Require `Native Fixture visual approval: pending` and forbid approval claims.

- [ ] **Step 4: Run evidence tests to verify they fail**

Run:

```bash
node --test tests/venue-pitch-setup-native-preview.test.mjs
```

Expected: FAIL because native screenshots and comparisons do not exist.

- [ ] **Step 5: Capture thirteen native states in WeChat DevTools**

Run `npm run env:wechat:check`, open `dist/miniprogram-development`, select iPhone X at logical `375 × 812`, and deep-link to:

```text
dev/pages/venue-pitch-setup/index?state=<state>
```

Capture each exact state from the simulator surface. Keep the real status bar, WeChat capsule, and Home Indicator in the implementation boundary. Record DevTools version, base library, device, capture method, and any simulator crop/normalization honestly. Smoke-check one larger safe-area device after the thirteen target captures.

- [ ] **Step 6: Generate the three comparison forms**

For every state, run:

```bash
python3 scripts/create_visual_review.py \
  artifacts/ui/reviews/venue-pitch-setup/<state>-reference-375x812.png \
  artifacts/ui/reviews/venue-pitch-setup/<state>-implementation-375x812.png \
  artifacts/ui/reviews/venue-pitch-setup/<state>-375x812
```

Expected: side-by-side `750 × 812`, overlay `375 × 812`, and difference `375 × 812`.

- [ ] **Step 7: Inspect and record the visual comparison**

Inspect Reference, native implementation, side-by-side, overlay, and difference for all thirteen states. Record composition, geometry/spacing, hierarchy, typography/color/material, icon assets/bounds, copy, and state semantics. Check the original reported defects explicitly: button centering, complete arrows/X icons, fixed bottom CTA/safe area, scroll reachability, and Reference alignment. Fix only concrete visible defects, recapture affected states, and re-run comparisons.

- [ ] **Step 8: Update the review board and keep the gate pending**

Populate all five evidence forms for the thirteen states; leave the other nine setup states marked as Reference-only/not captured in this proportional native review. Label `first-save-success` explicitly as a non-navigating Fixture representation whose real handoff waits for the inventory-v2 native slice. Set `Native Fixture visual approval: pending`, keep `Production disabled`, and do not mark approval before the user responds.

- [ ] **Step 9: Run final verification**

Run:

```bash
npm run typecheck
npm run lint
node --test tests/venue-pitch-setup-native-preview.test.mjs tests/build-booking-preview.test.mjs
npx jest miniprogram/dev/venue-pitch-setup-fixture.test.ts miniprogram/dev/pages/venue-pitch-setup/index.test.ts --runInBand
git diff --check
git status --short
```

Expected: PASS; only planned setup native Fixture, route tests, approval docs, and evidence files changed. Production remains free of development data.

- [ ] **Step 10: Commit native evidence**

Run:

```bash
git add artifacts/ui/reviews/venue-pitch-setup \
  tests/venue-pitch-setup-native-preview.test.mjs
git commit -m "test: add physical pitch setup native evidence"
```

- [ ] **Step 11: Present the native visual gate and stop**

Present direct links to the setup review board, thirteen implementation screenshots, and representative side-by-side/overlay/difference files. Ask for explicit native Fixture visual approval. Do not implement inventory v2 native UI, contracts, backend, database changes, real saves, or delete the Fixture in this plan.
