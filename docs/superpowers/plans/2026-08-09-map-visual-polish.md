# Map Visual Polish Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved option A markers, full-width search/locate geometry, and fixed three-line venue cards without changing map behavior or backend contracts.

**Architecture:** Keep the existing presentation and component boundaries. Replace only checked-in local marker assets and presentation geometry; express card/status compaction in the existing component template and styles. Verify with structural Jest tests first, then the full project checks and target viewport screenshots.

**Tech Stack:** WeChat Mini Program WXML/WXSS/TypeScript, Jest, local PNG assets generated from project-owned SVG sources.

---

## Chunk 1: Approved visual delta

### Task 1: Marker semantics and selected geometry

**Files:**
- Create: `artifacts/ui/sources/map-markers/map-marker-online.svg`
- Create: `artifacts/ui/sources/map-markers/map-marker-online-selected.svg`
- Create: `artifacts/ui/sources/map-markers/map-marker-directory.svg`
- Create: `artifacts/ui/sources/map-markers/map-marker-directory-selected.svg`
- Modify: `miniprogram/assets/map-marker-online.png`
- Modify: `miniprogram/assets/map-marker-online-selected.png`
- Modify: `miniprogram/assets/map-marker-directory.png`
- Modify: `miniprogram/assets/map-marker-directory-selected.png`
- Create: `scripts/render-map-markers.swift`
- Modify: `package.json`
- Modify: `miniprogram/presentation/venue-map.test.ts`
- Modify: `miniprogram/pages/venue-map/index.test.ts`
- Modify: `miniprogram/pages/venue-map/index.ts`

- [ ] **Step 1: Write failing owned-asset and runtime-size tests**

First assert that all four project-owned SVG sources exist, contain the approved online filled/directory outlined variant identifiers, and correspond to `64×80` normal or `72×88` selected PNG IHDR dimensions. Also assert that normal venue markers render at `32×40` and selected venue markers render at `36×44` while preserving the four existing semantic asset paths.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- --runInBand miniprogram/pages/venue-map/index.test.ts`

Expected: FAIL because the owned SVG sources do not exist and selected markers still render at `32×40`.

- [ ] **Step 3: Implement the minimal runtime geometry**

Project marker size from `marker.selected`:

```ts
return { ...marker, id, width: marker.selected ? 36 : 32, height: marker.selected ? 44 : 40 };
```

- [ ] **Step 4: Create and rasterize the four owned marker variants**

Use one water-drop silhouette with restrained highlight/shadow. Online is filled blue; directory-only is white with blue outline; selected variants add a fixed halo. Rasterize the four checked-in SVG authorities directly into transparent RGBA bitmaps with the repository-owned AppKit renderer:

```bash
npm run assets:map-markers
```

The renderer reads only `artifacts/ui/sources/map-markers/*.svg`, clears each destination canvas to transparent, and writes normal variants at `64×80` and selected variants at `72×88`. Expected: transparent PNG assets with exact canvases and transparent corners; no temporary Quick Look thumbnail is involved.

- [ ] **Step 5: Run focused presentation/page tests and verify GREEN**

Run: `npm test -- --runInBand miniprogram/presentation/venue-map.test.ts miniprogram/pages/venue-map/index.test.ts`

Expected: PASS.

### Task 2: Full-width search and polished locate control

**Files:**
- Modify: `miniprogram/pages/venue-map/index.test.ts`
- Modify: `miniprogram/pages/venue-map/index.wxss`
- Modify: `miniprogram/components/venue-map-search/index.test.ts`
- Modify: `miniprogram/components/venue-map-search/index.wxss`

- [ ] **Step 1: Write failing geometry/style assertions**

Assert that `.map-tools` uses a two-column grid (`minmax(0,1fr) 96rpx`), both controls are `96rpx` high, the search surface retains the approved `32rpx` radius, and the locate button keeps a stable `96rpx` square.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm test -- --runInBand miniprogram/pages/venue-map/index.test.ts miniprogram/components/venue-map-search/index.test.ts`

Expected: FAIL because `.map-tools` still uses flex.

- [ ] **Step 3: Implement the approved two-column geometry**

Use the existing markup and CSS-drawn icons. Change only the two-column geometry and make the existing search/locate strokes consistent; retain the current `32rpx` radii, surfaces, shadows, search behavior and location behavior.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npm test -- --runInBand miniprogram/pages/venue-map/index.test.ts miniprogram/components/venue-map-search/index.test.ts`

Expected: PASS.

### Task 3: Fixed three-line venue card

**Files:**
- Modify: `miniprogram/components/venue-map-card/index.test.ts`
- Modify: `miniprogram/components/venue-map-card/index.wxml`
- Modify: `miniprogram/components/venue-map-card/index.wxss`

- [ ] **Step 1: Write failing three-line structure assertions**

Require exactly three text rows: name, address, and one summary row containing `distanceText || transitText`, a separator, and `statusText`. Preserve the fixed `232rpx` card height and the `88rpx` action target.

- [ ] **Step 2: Run the component test and verify RED**

Run: `npm test -- --runInBand miniprogram/components/venue-map-card/index.test.ts`

Expected: FAIL because status is currently a separate fourth row.

- [ ] **Step 3: Implement the minimal template/style change**

```xml
<text class="venue-row-name">{{card.name}}</text>
<text class="venue-row-address">{{card.address}}</text>
<view class="venue-row-meta">
  <text class="venue-row-summary">{{card.distanceText || card.transitText}}</text>
  <text class="venue-row-separator">·</text>
  <text class="venue-row-status venue-row-status--{{card.action}}">{{card.statusText}}</text>
</view>
```

Keep every row single-line with ellipsis and no selected-state scaling.

- [ ] **Step 4: Run the component test and verify GREEN**

Run: `npm test -- --runInBand miniprogram/components/venue-map-card/index.test.ts`

Expected: PASS.

### Task 4: Regression and visual evidence

**Files:**
- Create: `artifacts/ui/references/venue-map-polish-city.html`
- Create: `artifacts/ui/references/venue-map-polish-online-selected.html`
- Create: `artifacts/ui/references/venue-map-polish-directory-selected.html`
- Create: `artifacts/ui/references/venue-map-polish-long-content.html`
- Modify: option A reference PNGs under `artifacts/ui/reviews/map-venue-discovery-scalable/`
- Modify: `artifacts/ui/reviews/map-venue-discovery-scalable/README.md`
- Modify: implementation/comparison images under `artifacts/ui/reviews/map-venue-discovery-scalable/`

- [ ] **Step 1: Run complete automated verification**

Run: `npm test && npm run typecheck && npm run lint && npm run build:miniprogram:development`

Expected: all commands PASS with no new warnings.

- [ ] **Step 2: Create the approved option A reference sources**

Promote the approved option A into four standalone responsive HTML sources: city/default, selected online marker, selected directory marker, and long card content. Each source must use the exact approved marker shapes, `96rpx`-equivalent search/locate geometry, `32rpx` radii and fixed three-line/`232rpx`-equivalent cards; source files are the reviewable Artifact authority, not implementation screenshots.

- [ ] **Step 3: Capture reference PNGs reproducibly**

In terminal A run from the worktree:

```bash
python3 -m http.server 8099 --bind 127.0.0.1
```

In terminal B use the bundled Playwright CLI session. For each source and viewport:

```bash
/Users/fan/.codex/skills/playwright/scripts/playwright_cli.sh --session map-polish-ref open http://127.0.0.1:8099/artifacts/ui/references/venue-map-polish-city.html
/Users/fan/.codex/skills/playwright/scripts/playwright_cli.sh --session map-polish-ref resize 375 812
/Users/fan/.codex/skills/playwright/scripts/playwright_cli.sh --session map-polish-ref screenshot --filename artifacts/ui/reviews/map-venue-discovery-scalable/city-375x812-reference.png
```

Repeat for all four sources at `375×812` and `390×844`, producing eight reference PNGs. Do not use `--hires`; expected PNG dimensions must equal the logical viewport.

- [ ] **Step 4: Capture matching target runtime screenshots**

Capture WeChat DevTools implementation screenshots at 375×812 and 390×844 for the same four required states. Normalize the DevTools DPR-2 export to the exact logical viewport without cropping, following the existing review metadata.

- [ ] **Step 5: Generate visual review composites**

Use the existing visual-review script to generate implementation, side-by-side, overlay and difference images for all four states at both viewports. Record remaining composition, geometry, typography, icon, copy and state-semantic differences in the review README.

- [ ] **Step 6: Stop at the visual approval gate**

Present the target viewport evidence to the user. Do not begin backend work and do not claim the slice complete before explicit visual approval.
