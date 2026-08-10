# Intent Entry Safe Area and City Layer Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct the custom-header safe area on notched/Dynamic Island devices and add the approved development-only “天津⌄” city layer to the intent-entry visual foundation.

**Architecture:** A small pure layout helper converts `wx.getWindowInfo()` and `wx.getMenuButtonBoundingClientRect()` into header top, row height, and right-capsule inset values shared by both development pages. The existing isolated visual Fixture gains only single-city display data; both pages render the same lightweight city sheet without adding production routes, location permission, city APIs, or backend state. The Artifact contract grows from two to three visual states, then stops again at the same-viewport user approval gate.

**Tech Stack:** Native WeChat Mini Program WXML/WXSS/TypeScript, Jest/ts-jest, Node test runner, self-contained HTML Artifacts, Playwright CLI, WeChat DevTools, Pillow visual comparison script.

**Spec:** `docs/superpowers/specs/2026-08-10-intent-entry-and-venue-inventory-design.md`

---

## File map

| File | Responsibility |
| --- | --- |
| `miniprogram/dev/intent-header-layout.ts` | Pure runtime safe-area calculation plus the two WeChat API reads; no page or business state. |
| `miniprogram/dev/intent-header-layout.test.ts` | Focused regression for iPhone X and iPhone 14 Pro header geometry. |
| `miniprogram/dev/intent-entry-fixture.ts` | Existing visual Fixture plus the only supported-city copy and availability labels. |
| `miniprogram/dev/pages/intent-entry/index.*` | First-entry city trigger, safe custom header, and deterministic open-sheet preview query. |
| `miniprogram/dev/pages/intent-home/index.*` | Returning-home city trigger and the same safe custom-header behavior. |
| `artifacts/ui/references/intent-entry-first.html` | Revised first-entry reference with “天津⌄”. |
| `artifacts/ui/references/intent-entry-city-open.html` | New 375×812 city-sheet-open reference. |
| `artifacts/ui/references/intent-home-returning.html` | Revised returning-home reference with “天津⌄”. |
| `artifacts/ui/screen-manifest/intent-entry-foundation.yaml` | Closed three-state visual inventory; production remains disabled. |
| `artifacts/ui/flows/intent-entry-foundation.md` | City-layer open/close semantics and unchanged intent destinations. |
| `tests/intent-entry-foundation.test.mjs` | Three-state Artifact, copy, review-slot, and final image-dimension contract. |
| `artifacts/ui/reviews/intent-entry-foundation/*` | Three-state evidence board, provenance, observations, and comparison images. |

No production page, production route, backend file, API contract, city data model, location permission, or inventory file changes in this plan.

## Chunk 1: Artifact revision, native correction, and visual gate

### Task 1: Revise the Artifact contract to three states

**Files:**
- Modify: `tests/intent-entry-foundation.test.mjs`
- Modify: `artifacts/ui/screen-manifest/intent-entry-foundation.yaml`
- Modify: `artifacts/ui/flows/intent-entry-foundation.md`
- Modify: `artifacts/ui/references/intent-entry-first.html`
- Create: `artifacts/ui/references/intent-entry-city-open.html`
- Modify: `artifacts/ui/references/intent-home-returning.html`
- Modify: `artifacts/ui/reviews/intent-entry-foundation/README.md`
- Modify: `artifacts/ui/reviews/intent-entry-foundation/review-board.html`

- [ ] **Step 1: Update the focused Artifact test first**

Change the manifest expectation to these three states and add the third reference constant:

```js
const cityOpenReferencePath = "artifacts/ui/references/intent-entry-city-open.html";

states: [
  {
    id: "first-entry",
    route: "dev/pages/intent-entry/index",
    reference: "artifacts/ui/references/intent-entry-first.html",
  },
  {
    id: "city-picker-open",
    route: "dev/pages/intent-entry/index?cityPicker=open",
    reference: cityOpenReferencePath,
  },
  {
    id: "returning-home",
    route: "dev/pages/intent-home/index",
    reference: "artifacts/ui/references/intent-home-returning.html",
  },
]
```

Require all three references to be self-contained 375×812 documents containing `天津`, a visible city affordance, capsule-safe layout, no external assets/emoji/gradient/animation, and controls of at least 44px. Require the open state to contain `data-state="city-picker-open"`, `选择城市`, `天津`, `已开放`, `其他城市`, and `敬请期待`. Replace every two-state review assertion with the exact state list `first-entry`, `city-picker-open`, `returning-home`.

- [ ] **Step 2: Run the test and verify the expected red state**

```bash
node --test tests/intent-entry-foundation.test.mjs
```

Expected: FAIL because the manifest and review board still contain two states and the city-open reference does not exist.

- [ ] **Step 3: Update the closed manifest and flow**

Add the exact `city-picker-open` state above. Keep `production_enabled: false`, the existing Fixture path, deletion condition, target viewport, and six review slots unchanged.

Add only these city semantics to the flow:

```text
first-entry/returning-home 点击 天津⌄ → city-picker-open
city-picker-open 点击关闭或天津 → 返回来源页
天津 → 当前且已开放
其他城市 → 敬请期待，不导航、不请求定位
```

Keep all existing HOST/BOOK/PLAY mappings unchanged.

- [ ] **Step 4: Revise the two closed references**

Replace the product text `天津足球` with a 44×44-or-larger city button whose visible label is `天津⌄`. Use a 44px fixed reference header row so it matches the runtime helper in Task 2. Preserve the existing approved hierarchy, cards, fixture copy, colors, and 100px fixed reference capsule reserve. Do not insert a standalone city-selection page or location prompt.

- [ ] **Step 5: Create the city-sheet-open reference**

Start from the revised first-entry reference and keep its underlying composition fixed. Add:

```html
<div class="city-scrim" aria-hidden="true"></div>
<section class="city-sheet" aria-label="选择城市">
  <div class="city-sheet__head">
    <h2>选择城市</h2>
    <button type="button" aria-label="关闭城市选择">…SVG close…</button>
  </div>
  <button class="city-row city-row--current" type="button">
    <span>天津</span><strong>当前 · 已开放</strong>
  </button>
  <button class="city-row" type="button" disabled>
    <span>其他城市</span><strong>敬请期待</strong>
  </button>
</section>
```

Use a bottom sheet with the existing surface, border, radius, typography, and touch sizes. A scrim may use transparent `#10243E`; do not introduce a new accent color. The disabled row must remain visibly legible and explicitly say `敬请期待`.

- [ ] **Step 6: Expand the initial review board and README**

Add a third six-slot section and observation column for `city-picker-open`. Record that the user-supplied full-window DevTools screenshot is diagnostic evidence of the safe-area bug only, not a same-viewport implementation screenshot. Keep the native visual status unapproved and the inventory/backend boundary unchanged.

- [ ] **Step 7: Run and commit the Artifact revision**

```bash
node --test tests/intent-entry-foundation.test.mjs
git diff --check
```

Expected: focused Artifact tests PASS; no whitespace errors.

```bash
git add tests/intent-entry-foundation.test.mjs artifacts/ui/screen-manifest/intent-entry-foundation.yaml artifacts/ui/flows/intent-entry-foundation.md artifacts/ui/references/intent-entry-first.html artifacts/ui/references/intent-entry-city-open.html artifacts/ui/references/intent-home-returning.html artifacts/ui/reviews/intent-entry-foundation/README.md artifacts/ui/reviews/intent-entry-foundation/review-board.html
git commit -m "design: add safe city entry states"
```

Do not stage the two stale untracked reference PNGs left by the earlier blocked capture; Task 4 overwrites and stages all final evidence together.

### Task 2: Add the shared runtime header geometry

**Files:**
- Create: `miniprogram/dev/intent-header-layout.ts`
- Create: `miniprogram/dev/intent-header-layout.test.ts`

- [ ] **Step 1: Write the failing pure layout tests**

Test two representative inputs:

```ts
expect(resolveIntentHeaderLayout(
  { windowWidth: 375, statusBarHeight: 44 },
  { top: 48, bottom: 80, left: 278, right: 365, width: 87, height: 32 },
)).toEqual({ topPx: 44, rowHeightPx: 44, rightInsetPx: 105 });

expect(resolveIntentHeaderLayout(
  { windowWidth: 393, statusBarHeight: 59 },
  { top: 63, bottom: 95, left: 295, right: 382, width: 87, height: 32 },
)).toEqual({ topPx: 59, rowHeightPx: 44, rightInsetPx: 106 });
```

Also assert negative/missing numeric values are clamped to non-negative values and never produce `NaN`.

- [ ] **Step 2: Run the test and verify it fails because the module is missing**

```bash
npx jest miniprogram/dev/intent-header-layout.test.ts --runInBand
```

- [ ] **Step 3: Implement the minimal helper**

Use small structural interfaces instead of page-specific types:

```ts
export function resolveIntentHeaderLayout(windowInfo, menuButton) {
  const topPx = Math.max(0, finite(windowInfo.statusBarHeight));
  const windowWidth = Math.max(0, finite(windowInfo.windowWidth));
  const menuTop = Math.max(topPx, finite(menuButton.top));
  const menuHeight = Math.max(0, finite(menuButton.height));
  const verticalGap = Math.max(0, menuTop - topPx);
  const rowHeightPx = Math.max(44, menuHeight + verticalGap * 2);
  const rightInsetPx = Math.max(0, windowWidth - finite(menuButton.left) + 8);
  return { topPx, rowHeightPx, rightInsetPx };
}

export function readIntentHeaderLayout() {
  return resolveIntentHeaderLayout(
    wx.getWindowInfo(),
    wx.getMenuButtonBoundingClientRect(),
  );
}
```

`finite` is a local helper that returns zero for non-finite/non-number values. Do not add device-name checks, hard-coded notch models, listeners, or production fallback infrastructure.

- [ ] **Step 4: Run focused verification and commit**

```bash
npx jest miniprogram/dev/intent-header-layout.test.ts --runInBand
npm run typecheck
npm run lint
git diff --check
```

Expected: all PASS.

```bash
git add miniprogram/dev/intent-header-layout.ts miniprogram/dev/intent-header-layout.test.ts
git commit -m "fix: calculate intent header safe area"
```

### Task 3: Apply the safe header and city sheet to both development pages

**Files:**
- Modify: `miniprogram/dev/intent-entry-fixture.ts`
- Modify: `miniprogram/dev/pages/intent-entry/index.ts`
- Modify: `miniprogram/dev/pages/intent-entry/index.wxml`
- Modify: `miniprogram/dev/pages/intent-entry/index.wxss`
- Modify: `miniprogram/dev/pages/intent-entry/index.test.ts`
- Modify: `miniprogram/dev/pages/intent-home/index.ts`
- Modify: `miniprogram/dev/pages/intent-home/index.wxml`
- Modify: `miniprogram/dev/pages/intent-home/index.wxss`
- Modify: `miniprogram/dev/pages/intent-home/index.test.ts`

- [ ] **Step 1: Extend the two page tests first**

Mock `wx.getWindowInfo()` and `wx.getMenuButtonBoundingClientRect()` with the iPhone 14 Pro values from Task 2. For both pages, assert `onLoad` stores `headerTopPx: 59`, `headerRowHeightPx: 44`, and `headerRightInsetPx: 106` in page data.

For both pages, add focused behavior assertions:

```ts
page.onOpenCityPicker();
expect(page.data.isCityPickerOpen).toBe(true);
page.onCloseCityPicker();
expect(page.data.isCityPickerOpen).toBe(false);
page.onSelectCurrentCity();
expect(page.data.isCityPickerOpen).toBe(false);
```

For first-entry only, assert `onLoad({ cityPicker: "open" })` deterministically opens the sheet for visual capture. Preserve every existing intent and returning-home behavior assertion.

- [ ] **Step 2: Run both suites and verify the new assertions fail**

```bash
npx jest miniprogram/dev/pages/intent-entry/index.test.ts miniprogram/dev/pages/intent-home/index.test.ts --runInBand
```

- [ ] **Step 3: Add the single-city visual Fixture**

Append one immutable object:

```ts
export const CITY_ENTRY_VISUAL_FIXTURE = Object.freeze({
  currentCityName: "天津",
  currentStatus: "当前 · 已开放",
  otherCityName: "其他城市",
  otherStatus: "敬请期待",
});
```

Do not add IDs intended for APIs, coordinates, location state, remote loading, or city arrays.

- [ ] **Step 4: Apply runtime geometry and city behavior**

Both pages import `readIntentHeaderLayout` and the city Fixture. Their `onLoad` handlers call the layout reader and set only the three numeric layout fields. Keep the returning-home intent fallback logic intact. Add only `isCityPickerOpen`, the four display strings, and three handlers: open, close, select current. The first page accepts `{ cityPicker?: unknown }` and opens only for the exact development query `open`.

Do not request location, navigate to a city page, persist a city, or change intent destinations.

- [ ] **Step 5: Render the corrected headers**

Bind runtime values directly:

```xml
<view class="intent-entry__header" style="padding-top: {{headerTopPx}}px;">
  <view class="intent-entry__header-row" style="height: {{headerRowHeightPx}}px; padding-right: {{headerRightInsetPx}}px;">
    <button class="intent-city-button" bindtap="onOpenCityPicker" aria-label="当前城市天津，点击切换">
      <text>{{currentCityName}}</text><view class="intent-city-chevron"></view>
    </button>
  </view>
</view>
```

Use the same city button on returning-home, with “我的” remaining left of the reserved capsule inset. Remove `env(safe-area-inset-top)`, the fixed `96rpx` row height, the fixed `200rpx` right padding, and every `天津足球` string from both pages.

- [ ] **Step 6: Render the same lightweight city sheet on both pages**

Use `wx:if="{{isCityPickerOpen}}"`, a tappable scrim, a bottom sheet, an explicit close button, a current-city button bound to `onSelectCurrentCity`, and a disabled other-city row that visibly says `敬请期待`. Keep all controls at least `88rpx`; use existing colors/tokens and no animation/gradient. Because this is a short-lived development Fixture with a defined deletion condition, do not create a component library or city service abstraction.

- [ ] **Step 7: Run proportional verification and commit**

```bash
npx jest miniprogram/dev/intent-header-layout.test.ts miniprogram/dev/pages/intent-entry/index.test.ts miniprogram/dev/pages/intent-home/index.test.ts --runInBand
npm run typecheck
npm run lint
node --test tests/build-booking-preview.test.mjs
git diff --check
```

Expected: all focused checks PASS; development still has seven routes and production still has five.

```bash
git add miniprogram/dev/intent-entry-fixture.ts miniprogram/dev/pages/intent-entry miniprogram/dev/pages/intent-home
git commit -m "feat: add safe development city entry"
```

### Task 4: Rebuild three-state visual evidence and stop at approval

**Files:**
- Modify/Create: `artifacts/ui/reviews/intent-entry-foundation/*.png`
- Modify: `tests/intent-entry-foundation.test.mjs`
- Modify: `artifacts/ui/reviews/intent-entry-foundation/README.md`
- Modify: `artifacts/ui/reviews/intent-entry-foundation/review-board.html`

- [ ] **Step 1: Capture all three HTML references at 375×812**

Use the `playwright` skill and bundled wrapper. Start a temporary local server from the worktree in its own terminal/session:

```bash
python3 -m http.server 8099 --bind 127.0.0.1
```

Then run exactly:

```bash
PWCLI=/Users/fan/.codex/skills/playwright/scripts/playwright_cli.sh
"$PWCLI" --session intent-safe-city open http://127.0.0.1:8099/artifacts/ui/references/intent-entry-first.html
"$PWCLI" --session intent-safe-city resize 375 812
"$PWCLI" --session intent-safe-city screenshot --filename artifacts/ui/reviews/intent-entry-foundation/first-entry-reference-375x812.png
"$PWCLI" --session intent-safe-city open http://127.0.0.1:8099/artifacts/ui/references/intent-entry-city-open.html
"$PWCLI" --session intent-safe-city resize 375 812
"$PWCLI" --session intent-safe-city screenshot --filename artifacts/ui/reviews/intent-entry-foundation/city-picker-open-reference-375x812.png
"$PWCLI" --session intent-safe-city open http://127.0.0.1:8099/artifacts/ui/references/intent-home-returning.html
"$PWCLI" --session intent-safe-city resize 375 812
"$PWCLI" --session intent-safe-city screenshot --filename artifacts/ui/reviews/intent-entry-foundation/returning-home-reference-375x812.png
"$PWCLI" --session intent-safe-city close
```

Do not use `--hires`. These commands intentionally overwrite the two stale untracked reference PNGs from the previous attempt. Stop the temporary HTTP server, then verify:

```bash
sips -g pixelWidth -g pixelHeight artifacts/ui/reviews/intent-entry-foundation/first-entry-reference-375x812.png
sips -g pixelWidth -g pixelHeight artifacts/ui/reviews/intent-entry-foundation/city-picker-open-reference-375x812.png
sips -g pixelWidth -g pixelHeight artifacts/ui/reviews/intent-entry-foundation/returning-home-reference-375x812.png
```

Expected: each reference is exactly 375×812.

- [ ] **Step 2: Capture three honest native implementation states**

Build development and open the exact worktree in WeChat DevTools. Use iPhone X 375×812 for the comparison inputs and these routes:

```text
dev/pages/intent-entry/index
dev/pages/intent-entry/index?cityPicker=open
dev/pages/intent-home/index?intent=BOOK
```

Use a DevTools-native simulator export or its official automation screenshot API. Do not use a full-window screenshot, browser HTML, desktop crop, padding, or recomposition as implementation evidence. Accept 375×812 unchanged, 750×1624 with a strict 50% resize, or 1125×2436 with a strict one-third resize matching the iPhone X DPR 3 profile; any other size or an export that cannot be written is a blocker. If the known DevTools export problem repeats, stop and request the three raw simulator PNGs from the user instead of retrying more than once.

Export to these exact raw paths:

```text
/private/tmp/intent-entry-first-native.png
/private/tmp/intent-entry-city-open-native.png
/private/tmp/intent-home-returning-native.png
```

Inspect every raw file before conversion:

```bash
sips -g pixelWidth -g pixelHeight /private/tmp/intent-entry-first-native.png
sips -g pixelWidth -g pixelHeight /private/tmp/intent-entry-city-open-native.png
sips -g pixelWidth -g pixelHeight /private/tmp/intent-home-returning-native.png
```

If all three are 375×812, copy them unchanged:

```bash
cp /private/tmp/intent-entry-first-native.png artifacts/ui/reviews/intent-entry-foundation/first-entry-implementation-375x812.png
cp /private/tmp/intent-entry-city-open-native.png artifacts/ui/reviews/intent-entry-foundation/city-picker-open-implementation-375x812.png
cp /private/tmp/intent-home-returning-native.png artifacts/ui/reviews/intent-entry-foundation/returning-home-implementation-375x812.png
```

If all three are either 750×1624 or 1125×2436, use the same exact target-size operation; the inspected input dimensions establish whether this was a strict 50% or one-third resize:

```bash
sips -z 812 375 /private/tmp/intent-entry-first-native.png --out artifacts/ui/reviews/intent-entry-foundation/first-entry-implementation-375x812.png
sips -z 812 375 /private/tmp/intent-entry-city-open-native.png --out artifacts/ui/reviews/intent-entry-foundation/city-picker-open-implementation-375x812.png
sips -z 812 375 /private/tmp/intent-home-returning-native.png --out artifacts/ui/reviews/intent-entry-foundation/returning-home-implementation-375x812.png
```

Finally inspect the three repository implementation inputs and require each to be exactly 375×812 before Step 5. Do not mix raw scale factors within one capture session; an inconsistent set is a blocker to recapture.

- [ ] **Step 3: Run the device-safe-area smoke check**

Switch only the simulator profile to iPhone 14 Pro. Verify the city label is fully below the status area and left of the WeChat capsule on first-entry and returning-home. Record this as a smoke observation; do not create a second Artifact/evidence matrix.

- [ ] **Step 4: Verify the visible interactions**

On native runtime, confirm: `天津⌄` opens the sheet; close and current-city selection close it; `其他城市` visibly says `敬请期待`; HOST/PLAY still show the preview-only notice; BOOK still opens the existing venue map. Record any blocker honestly.

- [ ] **Step 5: Generate the comparison sets**

Run exactly:

```bash
uv run python scripts/create_visual_review.py \
  artifacts/ui/reviews/intent-entry-foundation/first-entry-reference-375x812.png \
  artifacts/ui/reviews/intent-entry-foundation/first-entry-implementation-375x812.png \
  artifacts/ui/reviews/intent-entry-foundation/first-entry
uv run python scripts/create_visual_review.py \
  artifacts/ui/reviews/intent-entry-foundation/city-picker-open-reference-375x812.png \
  artifacts/ui/reviews/intent-entry-foundation/city-picker-open-implementation-375x812.png \
  artifacts/ui/reviews/intent-entry-foundation/city-picker-open
uv run python scripts/create_visual_review.py \
  artifacts/ui/reviews/intent-entry-foundation/returning-home-reference-375x812.png \
  artifacts/ui/reviews/intent-entry-foundation/returning-home-implementation-375x812.png \
  artifacts/ui/reviews/intent-entry-foundation/returning-home
```

The complete evidence matrix must be:

| State | Reference | Implementation | Side-by-side | Overlay | Difference |
| --- | --- | --- | --- | --- | --- |
| first-entry | `first-entry-reference-375x812.png` 375×812 | `first-entry-implementation-375x812.png` 375×812 | `first-entry-side-by-side.png` 750×812 | `first-entry-overlay-50.png` 375×812 | `first-entry-difference.png` 375×812 |
| city-picker-open | `city-picker-open-reference-375x812.png` 375×812 | `city-picker-open-implementation-375x812.png` 375×812 | `city-picker-open-side-by-side.png` 750×812 | `city-picker-open-overlay-50.png` 375×812 | `city-picker-open-difference.png` 375×812 |
| returning-home | `returning-home-reference-375x812.png` 375×812 | `returning-home-implementation-375x812.png` 375×812 | `returning-home-side-by-side.png` 750×812 | `returning-home-overlay-50.png` 375×812 | `returning-home-difference.png` 375×812 |

Then run:

```bash
uv run python -m unittest scripts.create_visual_review_test
```

Expected: all three generators succeed; the matrix dimensions above are exact; script tests PASS.

- [ ] **Step 6: Finish the evidence contract and observation log**

Extend the PNG header reader/assertions to all three states. Record DevTools version, base library, profile/DPR, exact route, raw dimensions, resize rule, and the seven required visual categories separately for each state. Keep user approval explicitly pending.

- [ ] **Step 7: Run final proportional verification**

```bash
npm run typecheck
npm run lint
node --test tests/intent-entry-foundation.test.mjs tests/build-booking-preview.test.mjs
npx jest miniprogram/dev/intent-header-layout.test.ts miniprogram/dev/pages/intent-entry/index.test.ts miniprogram/dev/pages/intent-home/index.test.ts --runInBand
MINIPROGRAM_TENCENT_MAP_KEY=AAAAA-BBBBB-CCCCC-DDDDD-EEEEE-FFFFF npm run build:miniprogram:production
npm run audit:miniprogram-package
git diff --check
```

Expected: all commands PASS; production remains five routes with no `dev/` tree.

- [ ] **Step 8: Commit evidence and request explicit user approval**

```bash
git add artifacts/ui/reviews/intent-entry-foundation tests/intent-entry-foundation.test.mjs
git commit -m "test: add safe city entry visual evidence"
```

Present reference, implementation, side-by-side, overlay, difference, and observations for all three states. Stop. Do not begin venue inventory Artifact, contract, backend, or production entry integration until the user explicitly approves the visual gate.
