# C1c-1 “我的报名” Development Preview Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a production-disabled WeChat Mini Program preview of “找球局 → 我的报名 → 报名详情 → 返回保留状态”, ready for the user’s next visual review.

**Architecture:** A C1c-only immutable fixture owns four self-registration cards, stable two-page projection, error injection, selected detail, and saved scroll positions. Four development-only pages expose the scenario launcher, the C1b-shaped entry preview, the “我的报名” list, and an exact fixture detail. The production build excludes all C1c fixture code; no backend, contract, migration, production page, deployment, or current C1 candidate is changed.

**Tech Stack:** HTML/CSS/ES modules, native WeChat Mini Program TypeScript/WXML/WXSS, Jest/ts-jest, Node test runner, existing build/audit scripts, WeChat DevTools.

**Design:** `docs/superpowers/specs/2026-08-29-my-game-registrations-preview-design.md`

**Base:** `113d603d34e5d4f49956aeea333a6f4b3356d7b6`; branch `feature/c1c-my-registrations-preview`.

**Hard boundary:** This plan may add C1c-specific docs, Artifact files, review evidence, `miniprogram/dev/c1c-*`, `miniprogram/dev/pages/c1c-*`, and focused tests. It must not modify production pages, `miniprogram/app.json`, backend, OpenAPI, migrations, deploy files, B2/C1a/C1b fixtures, or acceptance records.

---

## Chunk 1: Same-viewport Artifact

### Task 1: Freeze the C1c reference and interactions

**Files:**

- Create: `tests/my-game-registrations-artifact.test.mjs`
- Create: `artifacts/ui/references/my-game-registrations.html`
- Create: `artifacts/ui/references/my-game-registrations.css`
- Create: `artifacts/ui/references/my-game-registrations-data.js`
- Create: `artifacts/ui/flows/my-game-registrations.md`
- Create: `artifacts/ui/screen-manifest/my-game-registrations.yaml`
- Create: `artifacts/ui/reviews/my-game-registrations/README.md`
- Create: `artifacts/ui/reviews/my-game-registrations/review-board.html`
- Create: `artifacts/ui/reviews/my-game-registrations/ready-list-reference-375x812.png`

- [ ] **Step 1: Write the RED Artifact test**

Assert the source set exists, manifest is `production_enabled: false`, viewport is exactly `375×812`, and only `ready-list` is a representative capture. Import the data module and assert:

```js
assert.deepEqual(items.map(({ effectiveStatus }) => effectiveStatus), [
  "APPLIED", "JOINED", "REJECTED", "CANCELLED",
]);
assert.deepEqual(new Set(items.map(({ visibility }) => visibility)), new Set(["PUBLIC", "LINK_ONLY"]));
assert.deepEqual(firstPage.items.map(({ registrationId }) => registrationId), ["reg-applied", "reg-joined"]);
assert.equal(firstPage.nextCursor, "c1c-page-2");
```

Directly exercise the exported Artifact state/actions and assert:

- date/format/availability filters change the visible directory result and clear restores it;
- entry filters and `scrollTop` survive “open 我的报名 → return entry”;
- refresh preserves stable keys without duplication;
- load more appends exactly page two once;
- a whole-card action opens the exact registration ID, unknown ID returns not-found, and detail/header back restores the previous list state.

Also assert every visible control has a bound behavior, the whole card is the only detail target, touch controls are at least 44px and flex-centered, and the review gate remains `PENDING`. Across HTML plus data/render source, forbid applicant display name, note, decider, other applicants, contact details, order/payment fields, and member roster. Limit card rendering to status, game name, date/time, venue, physical pitch, and format.

Run:

```bash
node --test tests/my-game-registrations-artifact.test.mjs
```

Expected: FAIL because the Artifact does not exist.

- [ ] **Step 2: Implement the minimal interactive Artifact**

Use the existing light system (`#F8FAFC`, `#FFFFFF`, `#10243E`, `#526479`, `#DBE5EC`, `#0369A1`, `#047857`) and system font. Support query states `entry`, `ready-list`, `empty`, and `load-error`. Implement real in-memory actions for entry navigation, retry, refresh, load more, whole-card detail, detail back, and header back. `entry` must demonstrate a functional date filter, format filter, availability toggle, card navigation, and saved scroll value instead of rendering inert C1b controls.

- [ ] **Step 3: Capture and inspect the 375×812 reference**

Open `?state=ready-list` at exactly 375×812. Check title/back geometry, status badge alignment, complete chevrons, button text centering, card clipping, list scrolling, safe-area padding, key copy, and absence of private fields. Capture `ready-list-reference-375x812.png`.

- [ ] **Step 4: Run GREEN and commit**

```bash
node --test tests/my-game-registrations-artifact.test.mjs
git diff --check
git add artifacts/ui tests/my-game-registrations-artifact.test.mjs
git commit -m "design(c1c): preview my registrations"
```

## Chunk 2: Isolated fixture and native pages

### Task 2: Model the C1c fixture with stable pagination

**Files:**

- Create: `miniprogram/dev/c1c-my-game-registrations-fixture.ts`
- Create: `miniprogram/dev/c1c-my-game-registrations-fixture.test.ts`

- [ ] **Step 1: Write fixture RED tests**

Freeze these interfaces in the test:

```ts
type C1cEffectiveStatus = "APPLIED" | "JOINED" | "REJECTED" | "CANCELLED";
type C1cScenario = "READY" | "EMPTY" | "LOAD_ERROR";

interface C1cPage {
  readonly items: readonly C1cRegistration[];
  readonly nextCursor: string | null;
}
```

Test four statuses, PUBLIC + LINK_ONLY, future + history, stable `(appliedAt DESC, registrationId DESC)` order, page size two with no duplicates, initial error → retry, refresh error preserving items, load-more error preserving items, exact detail selection, unknown detail returning null, deep-frozen snapshots, and independent saved `entryScrollTop` / `listScrollTop`.

Run:

```bash
npx jest miniprogram/dev/c1c-my-game-registrations-fixture.test.ts --runInBand
```

Expected: FAIL because the fixture does not exist.

- [ ] **Step 2: Implement the minimal immutable fixture**

Export `C1C_MY_GAME_REGISTRATIONS_FIXTURE`, `createC1cMyGameRegistrationsStore()`, and a singleton. The store owns only presentation data and deterministic state transitions; it must not expose a fake HTTP API, user identity, mutation success, or production path.

- [ ] **Step 3: Run GREEN and commit**

```bash
npx jest miniprogram/dev/c1c-my-game-registrations-fixture.test.ts --runInBand
npm run typecheck
git diff --check
git add miniprogram/dev/c1c-my-game-registrations-fixture.*
git commit -m "feat(c1c): model my registrations preview"
```

### Task 3: Build four development-only native pages

**Files:**

- Create: `miniprogram/dev/c1c-my-game-registrations-pages.json`
- Create: `miniprogram/dev/pages/c1c-scenario/index.{ts,wxml,wxss,json,test.ts}`
- Create: `miniprogram/dev/pages/c1c-discovery-entry/index.{ts,wxml,wxss,json,test.ts}`
- Create: `miniprogram/dev/pages/c1c-my-registrations/index.{ts,wxml,wxss,json,test.ts}`
- Create: `miniprogram/dev/pages/c1c-registration-detail/index.{ts,wxml,wxss,json,test.ts}`
- Create: `tests/my-game-registrations-native-preview.test.mjs`

- [ ] **Step 1: Write page RED tests**

Cover:

- launcher resets `ENTRY | READY | EMPTY | LOAD_ERROR` and navigates to the right C1c route;
- entry page reuses the existing C1b fixture through public methods, implements date/format/availability/clear/retry/card actions, saves scroll, and opens “我的报名” with `navigateTo`;
- returning to entry restores filters, list, and exact `scrollTop`;
- list page renders all four statuses across two pages, retries first load, refreshes, preserves cards on refresh/load-more errors, saves its scroll, and whole-card navigates to the exact C1c detail;
- after loading page two and scrolling, list → exact detail → `navigateBack` must preserve cards, `nextCursor`, and exact `listScrollTop` without resetting or reloading;
- detail reads the exact registration ID, never falls back to the first item, and returns to list or discovery on a deep link;
- all visible buttons bind real handlers; there are no nested card buttons or private fields.

Run:

```bash
npx jest miniprogram/dev/pages/c1c-scenario/index.test.ts \
  miniprogram/dev/pages/c1c-discovery-entry/index.test.ts \
  miniprogram/dev/pages/c1c-my-registrations/index.test.ts \
  miniprogram/dev/pages/c1c-registration-detail/index.test.ts --runInBand
node --test tests/my-game-registrations-native-preview.test.mjs
```

Expected: FAIL because the pages do not exist.

- [ ] **Step 2: Implement the launcher and entry preview**

Use `readIntentHeaderLayout()` for custom navigation. The entry page may import and operate the existing `c1bGameDiscoveryStore`, but must not edit that fixture or any production file. Render every visible C1b-shaped control as functional. Save `scrollTop` via `bindscroll`; restore it through `scroll-top` on show.

- [ ] **Step 3: Implement the list and exact detail**

Use a `100vh` flex shell and vertical `scroll-view` with `flex: 1; height: 0; min-height: 0`. Cards use status badges and a complete CSS chevron. Refresh and load-more errors are inline and preserve cards. Bind list scrolling to the fixture's `listScrollTop` and restore it through `scroll-top`; `onShow` must re-project the existing page/cursor instead of resetting after detail return. Buttons are at least 88rpx and explicitly flex-centered. Deep-link fallback uses the C1c entry preview; no control uses Toast as success.

- [ ] **Step 4: Prove development/production isolation**

The Node test must assert the route inventory owns exactly four custom-navigation pages, source files exist, production manifest contains no C1c route, and fresh production output contains neither `C1C_MY_GAME_REGISTRATIONS_FIXTURE` nor C1c synthetic names.

Run:

```bash
npx jest miniprogram/dev/c1c-my-game-registrations-fixture.test.ts \
  miniprogram/dev/pages/c1c-scenario/index.test.ts \
  miniprogram/dev/pages/c1c-discovery-entry/index.test.ts \
  miniprogram/dev/pages/c1c-my-registrations/index.test.ts \
  miniprogram/dev/pages/c1c-registration-detail/index.test.ts --runInBand
npm run typecheck
npm run build:miniprogram:development
MINIPROGRAM_TENCENT_MAP_KEY=AAAAA-BBBBB-CCCCC-DDDDD-EEEEE-FFFFF \
  MINIPROGRAM_PAYMENT_PROVIDER=disabled npm run build:miniprogram:production
node --test tests/my-game-registrations-native-preview.test.mjs
npm run audit:miniprogram-package
```

- [ ] **Step 5: Commit native preview**

```bash
git diff --check
git add miniprogram/dev/c1c-* miniprogram/dev/pages/c1c-* \
  tests/my-game-registrations-native-preview.test.mjs
git commit -m "feat(c1c): preview my registrations journey"
```

## Chunk 3: One representative native review

### Task 4: Verify in WeChat DevTools and prepare user review

**Files:**

- Modify: `artifacts/ui/reviews/my-game-registrations/README.md`
- Modify: `artifacts/ui/reviews/my-game-registrations/review-board.html`
- Create: `artifacts/ui/reviews/my-game-registrations/ready-list-implementation-375x812.png`
- Create: `artifacts/ui/reviews/my-game-registrations/ready-list-side-by-side.png`
- Create: `artifacts/ui/reviews/my-game-registrations/ready-list-overlay-50.png`
- Create: `artifacts/ui/reviews/my-game-registrations/ready-list-difference.png`

- [ ] **Step 1: Build and open the development runtime**

Open the new worktree’s `dist/miniprogram-development` in official WeChat DevTools and select the C1c scenario launcher. Use an iPhone X logical 375×812 viewport.

- [ ] **Step 2: Exercise every visible representative action once**

On the entry preview, change a filter, scroll, open “我的报名”, and return; verify the filter and scroll position restore. On the list, refresh, load more, open one card, return, and verify list position. Click empty-state and first-error recovery from the launcher. Page unit tests cover injected refresh/load-more errors without expanding native screenshots.

- [ ] **Step 3: Capture and compare one representative frame**

Capture `ready-list-implementation-375x812.png`. Generate same-size evidence:

```bash
python3 scripts/create_visual_review.py \
  artifacts/ui/reviews/my-game-registrations/ready-list-reference-375x812.png \
  artifacts/ui/reviews/my-game-registrations/ready-list-implementation-375x812.png \
  artifacts/ui/reviews/my-game-registrations/ready-list
```

Inspect reference, implementation, side-by-side, overlay, and difference. Check button text horizontal/vertical centering, repeated badge/card alignment, complete arrows, clipping, scrolling, safe area, and key status copy. Make only the minimum correction for visible problems and recheck the affected frame.

If any implementation or focused-test file changes during this review, first rerun the affected focused tests and a fresh `npm run build:miniprogram:development`; wait for DevTools to compile that fresh output, then recapture the same 375×812 implementation frame and regenerate all comparison files. Do not retain evidence from the pre-fix build.

- [ ] **Step 4: Run the final focused gate**

```bash
node --test tests/my-game-registrations-artifact.test.mjs \
  tests/my-game-registrations-native-preview.test.mjs
npx jest miniprogram/dev/c1c-my-game-registrations-fixture.test.ts \
  miniprogram/dev/pages/c1c-scenario/index.test.ts \
  miniprogram/dev/pages/c1c-discovery-entry/index.test.ts \
  miniprogram/dev/pages/c1c-my-registrations/index.test.ts \
  miniprogram/dev/pages/c1c-registration-detail/index.test.ts \
  miniprogram/presentation/public-game-directory.android-compat.test.ts \
  miniprogram/pages/game-discovery/index.test.ts --runInBand
npm run typecheck
npm run build:miniprogram:development
MINIPROGRAM_TENCENT_MAP_KEY=AAAAA-BBBBB-CCCCC-DDDDD-EEEEE-FFFFF \
  MINIPROGRAM_PAYMENT_PROVIDER=disabled npm run build:miniprogram:production
npm run audit:miniprogram-package
git diff --check
```

- [ ] **Step 5: Record honest status, commit, and push**

Write `Implementation self-review: PASS` only after the native review passes; retain `User visual gate: PENDING`. If Step 3 produced a source or test fix, stage only its explicit allowed paths and make a narrow `fix(c1c): ...` commit before the evidence commit. Never use `git add .`. Then:

```bash
git add artifacts/ui/reviews/my-game-registrations
git commit -m "test(c1c): record my registrations preview review"
git status --short --branch
test -z "$(git status --porcelain)"
git push -u origin feature/c1c-my-registrations-preview
```

Stop at the user visual-review handoff. Do not merge `main`, deploy, upload an experience version, or begin C1c production integration before the current C1 joint acceptance and the user’s C1c visual confirmation.
