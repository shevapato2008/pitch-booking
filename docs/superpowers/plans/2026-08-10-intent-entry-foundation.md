# Intent Entry Visual Foundation Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce and visually confirm a development-only native WeChat Mini Program preview for the approved three equal intent entries and the returning comprehensive home, without changing production routes or starting venue inventory work.

**Architecture:** Two permanent 375×812 HTML reference Artifacts define the first-entry and returning-home states. Two native pages live entirely under `miniprogram/dev/`, consume one explicit visual Fixture, and are discovered only by the existing development route scanner; production `app.json` remains unchanged and production copying excludes the whole `dev/` tree. Visual acceptance uses same-size reference and WeChat DevTools screenshots plus the repository's existing side-by-side, 50% overlay, and absolute-difference generator.

**Tech Stack:** Native WeChat Mini Program WXML/WXSS/TypeScript, Node test runner, Jest/ts-jest, YAML Artifacts, Playwright CLI for HTML reference capture, WeChat DevTools for native screenshots, Pillow via `scripts/create_visual_review.py`.

**Confirmed scope:** This plan ends at the shared-entry visual gate. It does not create venue workbench pages, memberships, APIs, database migrations, inventory contracts, production navigation, public games, or production home activation.

**Spec:** `docs/superpowers/specs/2026-08-10-intent-entry-and-venue-inventory-design.md`

---

## File map

| File | Responsibility |
| --- | --- |
| `artifacts/ui/references/intent-entry-first.html` | Pixel reference for the first-launch three-card choice at 375×812. |
| `artifacts/ui/references/intent-home-returning.html` | Pixel reference for the returning comprehensive home at 375×812. |
| `artifacts/ui/screen-manifest/intent-entry-foundation.yaml` | Closed state, route, viewport, Fixture, and evidence inventory for the two visual states. |
| `artifacts/ui/flows/intent-entry-foundation.md` | Exact navigation semantics and unavailable-production boundary. |
| `artifacts/ui/reviews/intent-entry-foundation/README.md` | Capture environment, evidence matrix, observation log, user-approval status, and Fixture deletion condition. |
| `artifacts/ui/reviews/intent-entry-foundation/review-board.html` | Local review surface for reference, implementation, comparison images, and observations. |
| `tests/intent-entry-foundation.test.mjs` | Focused Artifact contract and final evidence-dimension checks. |
| `miniprogram/dev/intent-entry-fixture.ts` | The only development visual data for the two pages; explicit copy and recent-task example. |
| `miniprogram/dev/pages/intent-entry/index.*` | Native first-entry page; records the selected preview intent and directly opens the real rent-field destination or an honest unavailable notice. |
| `miniprogram/dev/pages/intent-home/index.*` | Native returning home; existing rent-field path is active and unavailable intents stay visibly preview-only. |
| `tests/build-booking-preview.test.mjs` | Proves development gains exactly two dev routes while production remains the existing five-route app. |

No production file under `miniprogram/pages/`, no backend file, no contract file, and no production `miniprogram/app.json` entry is added in this plan.

## Chunk 1: Reference Artifact and native Fixture pages

### Task 1: Freeze the two-state Artifact contract

**Files:**
- Create: `tests/intent-entry-foundation.test.mjs`
- Create: `artifacts/ui/screen-manifest/intent-entry-foundation.yaml`
- Create: `artifacts/ui/flows/intent-entry-foundation.md`
- Create: `artifacts/ui/references/intent-entry-first.html`
- Create: `artifacts/ui/references/intent-home-returning.html`
- Create: `artifacts/ui/reviews/intent-entry-foundation/README.md`
- Create: `artifacts/ui/reviews/intent-entry-foundation/review-board.html`

- [ ] **Step 1: Write the failing Artifact test**

Create `tests/intent-entry-foundation.test.mjs` with focused assertions:

```js
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "yaml";

const manifestPath = "artifacts/ui/screen-manifest/intent-entry-foundation.yaml";
const states = {
  "first-entry": "artifacts/ui/references/intent-entry-first.html",
  "returning-home": "artifacts/ui/references/intent-home-returning.html",
};

test("intent entry foundation freezes exactly two 375 by 812 visual states", () => {
  const manifest = parse(readFileSync(manifestPath, "utf8"));
  assert.deepEqual(manifest, {
    id: "intent-entry-foundation",
    target_viewport: { width: 375, height: 812 },
    production_enabled: false,
    states: [
      { id: "first-entry", route: "dev/pages/intent-entry/index", reference: states["first-entry"] },
      { id: "returning-home", route: "dev/pages/intent-home/index", reference: states["returning-home"] },
    ],
    review_slots: ["reference", "implementation", "side-by-side", "overlay-50", "difference", "observations"],
    fixture: "miniprogram/dev/intent-entry-fixture.ts",
    deletion_condition: "delete before production intent home integration",
  });
});

test("intent references preserve equal intent weight and honest readiness", () => {
  for (const [state, path] of Object.entries(states)) {
    assert.equal(existsSync(path), true, path);
    const html = readFileSync(path, "utf8");
    assert.match(html, /^<!doctype html>/i);
    assert.match(html, new RegExp(`<main class="artifact" data-state="${state}"`));
    assert.match(html, /\.artifact\s*\{[^}]*width:\s*375px;[^}]*height:\s*812px/s);
    assert.doesNotMatch(html, /https?:\/\/|<link\b|<script\b[^>]*\bsrc=/i);
    for (const copy of ["出租场地", "租赁场地", "找球踢"]) assert.match(html, new RegExp(copy));
    assert.match(html, /min-(?:width|height):\s*44px/);
  }
  const first = readFileSync(states["first-entry"], "utf8");
  assert.equal((first.match(/class="intent-card"/g) ?? []).length, 3);
  assert.match(first, /申请合作，或进入已授权的场馆工作台/);
  assert.match(first, /没有球队，也能加入已锁定场地的开放球局/);
});

test("review board reserves six evidence slots for both states", () => {
  const board = readFileSync("artifacts/ui/reviews/intent-entry-foundation/review-board.html", "utf8");
  for (const state of Object.keys(states)) {
    for (const slot of ["reference", "implementation", "side-by-side", "overlay-50", "difference", "observations"]) {
      assert.match(board, new RegExp(`data-state="${state}"[^>]*data-slot="${slot}"`));
    }
  }
});
```

- [ ] **Step 2: Run the test and confirm the missing Artifact failure**

Run:

```bash
node --test tests/intent-entry-foundation.test.mjs
```

Expected: FAIL because `artifacts/ui/screen-manifest/intent-entry-foundation.yaml` does not yet exist.

- [ ] **Step 3: Create the closed manifest and flow**

Use exactly this manifest:

```yaml
id: intent-entry-foundation
target_viewport:
  width: 375
  height: 812
production_enabled: false
states:
  - id: first-entry
    route: dev/pages/intent-entry/index
    reference: artifacts/ui/references/intent-entry-first.html
  - id: returning-home
    route: dev/pages/intent-home/index
    reference: artifacts/ui/references/intent-home-returning.html
review_slots:
  - reference
  - implementation
  - side-by-side
  - overlay-50
  - difference
  - observations
fixture: miniprogram/dev/intent-entry-fixture.ts
deletion_condition: delete before production intent home integration
```

Write `artifacts/ui/flows/intent-entry-foundation.md` with only these semantics:

```text
# 目的入口视觉基础

first-entry --tap 租赁场地--> existing venue-map
first-entry --tap 出租场地--> preview-only notice
first-entry --tap 找球踢--> preview-only notice
returning-home --tap 租赁场地--> existing venue-map
returning-home --tap 出租场地--> preview-only notice
returning-home --tap 找球踢--> preview-only notice

The returning-home state is an independent next-launch preview, never an intermediate page after first choice.
Production note: both intent pages remain development-only until every clickable production entry has a real destination.
```

- [ ] **Step 4: Create the first-entry reference at exactly 375×812**

Create one self-contained HTML document. Required geometry and copy:

```html
<main class="artifact" data-state="first-entry">
  <header class="custom-header"><span class="brand">天津足球</span><span class="capsule-safe" aria-hidden="true"></span></header>
  <section class="intro">
    <h1>你今天想做什么？</h1>
    <p>选择一个目的开始，之后可以随时切换。</p>
  </section>
  <section class="intent-list">
    <button class="intent-card" type="button">…我要出租场地…申请合作，或进入已授权的场馆工作台…</button>
    <button class="intent-card" type="button">…我要租赁场地…为球队查找时间、价格和可订整场…</button>
    <button class="intent-card" type="button">…我要找球踢…没有球队，也能加入已锁定场地的开放球局…</button>
  </section>
  <p class="identity-note">这里选择的是当下目的，不是永久身份。</p>
</main>
```

Use only the existing system values: `#F8FAFC`, `#FFFFFF`, `#10243E`, `#64748B`, `#DBE5EC`, and `#0284C7`; system font; 4px spacing grid; three identical `intent-card` boxes; SVG line icons; minimum 44×44 CSS-pixel controls; no external assets, emoji icons, gradients, or animation. The custom header must reserve the same status-bar/menu-capsule zone as the native preview: a 44px top row at this fixed reference viewport and a 100px unobstructed area on the right. The capsule reserve is layout space, not an extra product control.

- [ ] **Step 5: Create the returning-home reference at exactly 375×812**

Required composition:

```html
<main class="artifact" data-state="returning-home">
  <header class="custom-header"><span>天津足球</span><button aria-label="我的">…SVG…</button><span class="capsule-safe" aria-hidden="true"></span></header>
  <section><h1>早上好</h1><p>今天想从哪里开始？</p></section>
  <nav class="intent-grid" aria-label="目的入口">
    <button>出租场地</button><button>租赁场地</button><button>找球踢</button>
  </nav>
  <section class="continue-card">
    <span>租赁场地</span><strong>渤海元丰足球场</strong><span>查看未来 14 天可订时段</span>
  </section>
  <section class="progress-card"><strong>1 个待支付订单</strong><span>请在剩余时间内完成支付</span></section>
</main>
```

Keep all three intent buttons equal. Reserve the same 44px status-bar row and 100px right-side menu-capsule zone as the first-entry reference. The recent venue and pending-order content are labeled visual Fixture data in the HTML source and are never imported by production code.

- [ ] **Step 6: Create the initial review board and README**

Reserve six slots per state. Until screenshots exist, each image slot contains “等待视觉取证”; observations list the required comparison categories: composition, geometry/spacing, component hierarchy, typography/color/material, icon assets, copy, and state semantics. README records:

- target `375 × 812`;
- product/IA approved, native visual not yet approved;
- production disabled;
- reference and implementation must use the same logical viewport;
- Fixture deletion condition;
- no inventory/backend work authorized by this phase.

- [ ] **Step 7: Run the focused Artifact test**

Run:

```bash
node --test tests/intent-entry-foundation.test.mjs
```

Expected: 3 tests PASS.

- [ ] **Step 8: Commit the reference Artifact**

```bash
git add tests/intent-entry-foundation.test.mjs artifacts/ui/screen-manifest/intent-entry-foundation.yaml artifacts/ui/flows/intent-entry-foundation.md artifacts/ui/references/intent-entry-first.html artifacts/ui/references/intent-home-returning.html artifacts/ui/reviews/intent-entry-foundation
git commit -m "design: freeze intent entry visual foundation"
```

### Task 2: Add the isolated Fixture and first-entry native page

**Files:**
- Create: `miniprogram/dev/intent-entry-fixture.ts`
- Create: `miniprogram/dev/pages/intent-entry/index.ts`
- Create: `miniprogram/dev/pages/intent-entry/index.json`
- Create: `miniprogram/dev/pages/intent-entry/index.wxml`
- Create: `miniprogram/dev/pages/intent-entry/index.wxss`
- Create: `miniprogram/dev/pages/intent-entry/index.test.ts`

- [ ] **Step 1: Write the failing page behavior test**

Use the existing Page harness pattern. Assert that the definition exposes three equal intents in the approved order. A valid choice records only the dev key, then immediately opens its real destination when available or shows an honest preview notice; it never routes through the returning-home preview:

```ts
expect(target.data.intents.map(({ id }: { id: string }) => id)).toEqual(["HOST", "BOOK", "PLAY"]);
target.onChooseIntent({ currentTarget: { dataset: { intent: "BOOK" } } });
expect(wx.setStorageSync).toHaveBeenCalledWith("DEV_ONLY_LAST_INTENT", "BOOK");
expect(wx.reLaunch).toHaveBeenCalledWith({ url: "/pages/venue-map/index" });
target.onChooseIntent({ currentTarget: { dataset: { intent: "PLAY" } } });
expect(wx.showToast).toHaveBeenCalledWith({ title: "仅视觉预览，当前未开放", icon: "none" });
```

- [ ] **Step 2: Run the targeted test and confirm it fails**

```bash
npx jest miniprogram/dev/pages/intent-entry/index.test.ts --runInBand
```

Expected: FAIL because the page module does not exist.

- [ ] **Step 3: Create the explicit visual Fixture**

Keep a small immutable data object:

```ts
export type IntentId = "HOST" | "BOOK" | "PLAY";
export const DEV_LAST_INTENT_KEY = "DEV_ONLY_LAST_INTENT";
export const INTENT_ENTRY_VISUAL_FIXTURE = Object.freeze({
  intents: Object.freeze([
    Object.freeze({ id: "HOST" as const, title: "我要出租场地", subtitle: "申请合作，或进入已授权的场馆工作台", icon: "venue" }),
    Object.freeze({ id: "BOOK" as const, title: "我要租赁场地", subtitle: "为球队查找时间、价格和可订整场", icon: "calendar" }),
    Object.freeze({ id: "PLAY" as const, title: "我要找球踢", subtitle: "没有球队，也能加入已锁定场地的开放球局", icon: "football" }),
  ]),
  note: "这里选择的是当下目的，不是永久身份。",
});
export const RETURNING_HOME_VISUAL_FIXTURE = Object.freeze({
  recentVenueName: "渤海元丰足球场",
  recentSummary: "查看未来 14 天可订时段",
  pendingOrderSummary: "1 个待支付订单",
  pendingOrderDetail: "请在剩余时间内完成支付",
});
```

Do not add this object to `artifacts/ui/fixtures`; that inventory remains canonical-contract-only.

- [ ] **Step 4: Implement the first-entry page**

Set `index.json` to `{ "navigationStyle": "custom" }`; do not allow a native navigation title to duplicate the page header. The TypeScript page has only `intents`, `note`, and `onChooseIntent`. Validate the dataset against `HOST/BOOK/PLAY`; invalid IDs do nothing. For `BOOK`, persist the development-only selection and `wx.reLaunch` to `/pages/venue-map/index`. For `HOST` and `PLAY`, persist the selection and show `仅视觉预览，当前未开放`. The template renders a custom header and three identical buttons with title, subtitle, inline native view icons, and chevrons. The returning-home page is not part of this tap flow. The WXSS imports `../../../styles/tokens.wxss`, uses the existing color/spacing/radius vocabulary, applies `env(safe-area-inset-top)` plus a fixed 96rpx header row, leaves 200rpx free at the right for the WeChat menu capsule, and keeps every intent button at least `144rpx` high. The HTML reference uses the corresponding fixed 44px/100px reserves at 375×812.

- [ ] **Step 5: Run the page test, typecheck, and lint**

```bash
npx jest miniprogram/dev/pages/intent-entry/index.test.ts --runInBand
npm run typecheck
npm run lint
```

Expected: targeted Jest PASS; typecheck and lint PASS.

- [ ] **Step 6: Commit the first-entry page**

```bash
git add miniprogram/dev/intent-entry-fixture.ts miniprogram/dev/pages/intent-entry
git commit -m "feat: add development intent entry preview"
```

### Task 3: Add the returning-home native page

**Files:**
- Create: `miniprogram/dev/pages/intent-home/index.ts`
- Create: `miniprogram/dev/pages/intent-home/index.json`
- Create: `miniprogram/dev/pages/intent-home/index.wxml`
- Create: `miniprogram/dev/pages/intent-home/index.wxss`
- Create: `miniprogram/dev/pages/intent-home/index.test.ts`

- [ ] **Step 1: Write the failing behavior test**

Assert only the already-real rent-field intent navigates into production behavior; unavailable intents are explicit preview notices:

```ts
target.onOpenIntent({ currentTarget: { dataset: { intent: "BOOK" } } });
expect(wx.reLaunch).toHaveBeenCalledWith({ url: "/pages/venue-map/index" });
target.onOpenIntent({ currentTarget: { dataset: { intent: "PLAY" } } });
expect(wx.showToast).toHaveBeenCalledWith({ title: "仅视觉预览，当前未开放", icon: "none" });
```

Also assert `onLoad({ intent: "PLAY" })` highlights `PLAY`, while an invalid query falls back to the stored valid ID and then `BOOK`.

- [ ] **Step 2: Run the test and confirm it fails**

```bash
npx jest miniprogram/dev/pages/intent-home/index.test.ts --runInBand
```

Expected: FAIL because the page module does not exist.

- [ ] **Step 3: Implement the returning-home page**

Set `index.json` to `{ "navigationStyle": "custom" }`, and use the same native status-bar/menu-capsule reserves as the first-entry page. This page is a standalone next-launch visual state, not a navigation destination from first-entry. Render:

- a top “我的” icon button that shows the same preview-only notice;
- three equal intent shortcut buttons;
- one “继续上次” card for the canonical online venue name;
- one visual-Fixture pending-order summary;
- no network calls, permission claims, game list, or inventory data.

`BOOK` and “继续上次” call `wx.reLaunch({ url: "/pages/venue-map/index" })`. `HOST`, `PLAY`, and “我的” call the preview-only toast. Do not create disabled-looking controls that silently accept taps.

- [ ] **Step 4: Run both page tests**

```bash
npx jest miniprogram/dev/pages/intent-entry/index.test.ts miniprogram/dev/pages/intent-home/index.test.ts --runInBand
```

Expected: both suites PASS.

- [ ] **Step 5: Commit the returning-home page**

```bash
git add miniprogram/dev/pages/intent-home
git commit -m "feat: add development returning intent home"
```

## Chunk 2: Build isolation, visual evidence, and user gate

### Task 4: Prove development-only packaging

**Files:**
- Modify: `tests/build-booking-preview.test.mjs`

- [ ] **Step 1: Confirm the existing production build boundary**

Run the focused test before editing it:

```bash
node --test tests/build-booking-preview.test.mjs
```

Expected: PASS with the unchanged five production routes.

- [ ] **Step 2: Add the development-only route expectations**

Keep the existing production route array unchanged. Change the build test to expect:

```js
const productionRoutes = [
  "pages/venue-map/index",
  "pages/venue/index",
  "pages/availability/index",
  "pages/booking-confirmation/index",
  "pages/order-detail/index",
];
const developmentRoutes = [
  ...productionRoutes,
  "dev/pages/intent-entry/index",
  "dev/pages/intent-home/index",
];
assert.deepEqual(development.pages, developmentRoutes);
assert.deepEqual(production.pages, productionRoutes);
```

Assert all four native artifacts exist for both dev routes in `dist/miniprogram-development`, neither route exists in production `app.json`, and `dist/miniprogram-production/dev` does not exist.

- [ ] **Step 3: Run the targeted build test**

```bash
node --test tests/build-booking-preview.test.mjs
```

Expected: PASS because Tasks 2–3 created complete development-only page folders and the existing build discovers them without changing production routes.

- [ ] **Step 4: Build both packages and audit production**

```bash
npm run build:miniprogram:development
MINIPROGRAM_TENCENT_MAP_KEY=AAAAA-BBBBB-CCCCC-DDDDD-EEEEE-FFFFF npm run build:miniprogram:production
npm run audit:miniprogram-package
```

Expected: both builds PASS; production audit reports zero forbidden paths/tokens; production remains five routes.

- [ ] **Step 5: Run the proportional code checks**

```bash
npm run typecheck
npm run lint
node --test tests/intent-entry-foundation.test.mjs tests/build-booking-preview.test.mjs
npx jest miniprogram/dev/pages/intent-entry/index.test.ts miniprogram/dev/pages/intent-home/index.test.ts --runInBand
```

Expected: all commands PASS. Do not add backend, fuzz, auth, or broad security tests in this visual-only phase.

- [ ] **Step 6: Commit the packaging boundary**

```bash
git add tests/build-booking-preview.test.mjs
git commit -m "test: isolate intent preview from production"
```

### Task 5: Capture same-viewport evidence and stop at user approval

**Files:**
- Create: `artifacts/ui/reviews/intent-entry-foundation/first-entry-reference-375x812.png`
- Create: `artifacts/ui/reviews/intent-entry-foundation/first-entry-implementation-375x812.png`
- Create: `artifacts/ui/reviews/intent-entry-foundation/first-entry-side-by-side.png`
- Create: `artifacts/ui/reviews/intent-entry-foundation/first-entry-overlay-50.png`
- Create: `artifacts/ui/reviews/intent-entry-foundation/first-entry-difference.png`
- Create: `artifacts/ui/reviews/intent-entry-foundation/returning-home-reference-375x812.png`
- Create: `artifacts/ui/reviews/intent-entry-foundation/returning-home-implementation-375x812.png`
- Create: `artifacts/ui/reviews/intent-entry-foundation/returning-home-side-by-side.png`
- Create: `artifacts/ui/reviews/intent-entry-foundation/returning-home-overlay-50.png`
- Create: `artifacts/ui/reviews/intent-entry-foundation/returning-home-difference.png`
- Modify: `tests/intent-entry-foundation.test.mjs`
- Modify: `artifacts/ui/reviews/intent-entry-foundation/README.md`
- Modify: `artifacts/ui/reviews/intent-entry-foundation/review-board.html`

- [ ] **Step 1: Capture both HTML references at 375×812 with Playwright CLI**

Use the `playwright` skill and the bundled wrapper. `npx` has already been verified at `/opt/homebrew/bin/npx`.

```bash
PWCLI=/Users/fan/.codex/skills/playwright/scripts/playwright_cli.sh
"$PWCLI" --session intent-reference open "file://$PWD/artifacts/ui/references/intent-entry-first.html"
"$PWCLI" --session intent-reference resize 375 812
"$PWCLI" --session intent-reference screenshot --filename artifacts/ui/reviews/intent-entry-foundation/first-entry-reference-375x812.png
"$PWCLI" --session intent-reference open "file://$PWD/artifacts/ui/references/intent-home-returning.html"
"$PWCLI" --session intent-reference resize 375 812
"$PWCLI" --session intent-reference screenshot --filename artifacts/ui/reviews/intent-entry-foundation/returning-home-reference-375x812.png
"$PWCLI" --session intent-reference close
```

Expected: two PNG files, each exactly 375×812 CSS pixels. Do not use `--hires`.

- [ ] **Step 2: Capture both native pages in WeChat DevTools**

Build development, then use the `computer-use` skill and the installed/logged-in WeChat DevTools. Open the worktree project root whose tracked `project.config.json` points to `dist/miniprogram-development/`. Select an iPhone X logical viewport of 375×812 and use the DevTools simulator's built-in screenshot export, not a desktop-window crop. Export the two raw simulator images temporarily outside the repository:

- `dev/pages/intent-entry/index` → `/private/tmp/intent-entry-first-native.png`;
- `dev/pages/intent-home/index?intent=BOOK` → `/private/tmp/intent-home-returning-native.png`.

Inspect both raw dimensions with `sips -g pixelWidth -g pixelHeight`. If each is exactly 375×812, use it unchanged as the corresponding `implementation-375x812.png`. If each is exactly 750×1624, use `sips -z 812 375 ... --out ...` for a strict 50% resize. Do not crop, pad, recompose, or otherwise alter the simulator image. Any other raw dimension is a capture blocker to record, not a reason to manufacture a matching image. The temporary raw images do not need to be retained after the evidence source is documented.

Verify before capture: no WXML, WXSS, TypeScript, or Console error; no inventory screen exists; unavailable intents show a preview-only toast; the rent-field intent opens the existing map. In the review README, record separately for both states: actual WeChat DevTools version, base-library version, iPhone X profile and DPR, development Fixture mode, exact route/query, raw exported dimensions, and whether the comparison input was unchanged or strictly resized by 50%. Do not claim native evidence if DevTools capture fails; record the concrete blocker instead.

- [ ] **Step 3: Generate comparison images with the existing script**

```bash
uv run python scripts/create_visual_review.py \
  artifacts/ui/reviews/intent-entry-foundation/first-entry-reference-375x812.png \
  artifacts/ui/reviews/intent-entry-foundation/first-entry-implementation-375x812.png \
  artifacts/ui/reviews/intent-entry-foundation/first-entry
uv run python scripts/create_visual_review.py \
  artifacts/ui/reviews/intent-entry-foundation/returning-home-reference-375x812.png \
  artifacts/ui/reviews/intent-entry-foundation/returning-home-implementation-375x812.png \
  artifacts/ui/reviews/intent-entry-foundation/returning-home
uv run python -m unittest scripts.create_visual_review_test
```

Expected: side-by-side images are 750×812; overlay and difference images are 375×812; script tests PASS.

- [ ] **Step 4: Extend the Artifact test to require final evidence**

Add a minimal PNG header reader, then assert for both states:

- reference and implementation: 375×812;
- side-by-side: 750×812;
- overlay and difference: 375×812;
- the review board links every image.

Run:

```bash
node --test tests/intent-entry-foundation.test.mjs
```

Expected: all focused Artifact tests PASS.

- [ ] **Step 5: Record the seven-category visual comparison**

Update README and board observations separately for each state:

1. composition;
2. geometry and spacing;
3. component hierarchy;
4. typography, color, and material;
5. icon assets;
6. copy;
7. state semantics.

Record every intentional difference. Automated layout/tests do not mark the visual gate approved.

- [ ] **Step 6: Run final proportional verification**

```bash
npm run typecheck
npm run lint
npm test
MINIPROGRAM_TENCENT_MAP_KEY=AAAAA-BBBBB-CCCCC-DDDDD-EEEEE-FFFFF npm run build:miniprogram:production
npm run audit:miniprogram-package
git diff --check
```

Expected: typecheck/lint PASS; the existing baseline suites plus the new focused tests PASS; production build/audit PASS; no diff errors.

- [ ] **Step 7: Commit evidence and request explicit user visual approval**

```bash
git add artifacts/ui/reviews/intent-entry-foundation tests/intent-entry-foundation.test.mjs
git commit -m "test: add intent entry visual evidence"
```

Present the reference, implementation, side-by-side, overlay, difference, and observation record to the user. Stop. Do not create venue inventory Artifact, contract, backend, or integration work until the user explicitly approves this same-viewport visual gate.
