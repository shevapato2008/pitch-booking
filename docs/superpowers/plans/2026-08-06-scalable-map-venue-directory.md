# Scalable Map Venue Directory Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the five-venue horizontal map carousel with a fixed-height, vertically browsable 50+ venue directory that supports city browsing, explicit user-location sorting, and Tencent POI-centered sorting without importing third-party venues.

**Architecture:** Keep the platform venue directory as the only business authority. Model city, user-location, and POI search centers as a small pure presentation state machine; render one native map plus a vertically scrolling bottom sheet; isolate Tencent suggestion search behind a registered capability. Deliver the real Mini Program UI and obtain same-viewport visual approval before changing the public venue contract or integrating Tencent POI traffic.

**Tech Stack:** WeChat Mini Program TypeScript/WXML/WXSS, Jest, Node test runner, FastAPI/Pydantic/SQLAlchemy/Alembic/PostgreSQL, OpenAPI, Tencent Location Services WebService API.

---

## Execution precondition and file map

The repository currently has unrelated uncommitted map/bootstrap work. Before executing this plan, invoke `@superpowers:using-git-worktrees`, identify the intended base commit, and create a dedicated feature worktree. Do not discard, reset, or silently omit the existing dirty changes; either commit them as the agreed base or port the relevant patch into the worktree with the owner’s approval.

The implementation is intentionally split by responsibility:

- `artifacts/ui/references/venue-map-scalable-*.html`: frozen visual references for the three approved search-center states and longest-content state.
- `artifacts/ui/screen-manifest/map-venue-discovery.yaml`: target viewport/state capture matrix.
- `artifacts/ui/reviews/map-venue-discovery-scalable/`: same-size reference, implementation, side-by-side, overlay, difference, and observations.
- `miniprogram/presentation/venue-map-search.ts`: pure search-center, sidecar district filtering, sorting, title, distance, and selection-validity rules.
- `miniprogram/presentation/venue-map.ts`: marker/card projection and viewport calculation only.
- `miniprogram/components/venue-map-search/*`: search bar and grouped suggestion surface.
- `miniprogram/components/venue-map-card/*`: one fixed-height vertical venue row.
- `miniprogram/components/venue-map-sheet/*`: sheet snapping and vertical list ownership.
- `miniprogram/pages/venue-map/*`: orchestration of directory, location, POI, filter, map, and component events.
- `miniprogram/dev/venue-map-preview-fixture.ts`: temporary 100-venue visual/performance fixture; delete after real integration.
- `miniprogram/dev/poi-search-preview.ts`: temporary deterministic 天津站 POI suggestions for visual capture; delete after real integration.
- `miniprogram/services/venue-map-preview.ts`: temporary metadata registry that exposes only the visual fixture district sidecar; delete after the real district contract is integrated.
- `miniprogram/services/poi-search.ts`: capability interface and registry.
- `miniprogram/services/tencent-poi-search.ts`: strict Tencent response decoder and request adapter.
- `miniprogram/config/runtime.ts`: source placeholders for API URL and a restricted Mini Program Tencent key; never store the real key in source.
- `contracts/openapi.yaml`, `contracts/examples/*.json`: structured district public contract.
- `backend/migrations/versions/0007_venue_district.py`: district columns and deterministic five-venue backfill.
- `backend/app/models.py`, `backend/app/modules/venues/{dto,service,loader}.py`: district persistence and response projection.
- `deploy/venue-directory.{json,schema.json}`: authoritative district values and validation.
- `scripts/miniprogram-runtime-config.mjs`: pure validation/rendering of generated runtime configuration.
- `scripts/build-miniprogram.mjs`: calls the runtime-config helper and includes the development preview fixture only in fixture builds.
- `scripts/audit-production-package.mjs`: production fixture/key-placeholder audit.
- `scripts/create_visual_review.py`: deterministic same-size side-by-side, overlay, and difference generation.

## Chunk 1: Artifact and real Mini Program visual slice

### Task 1: Freeze the four visual reference states

**Files:**
- Create: `artifacts/ui/references/venue-map-scalable-city.html`
- Create: `artifacts/ui/references/venue-map-scalable-nearby.html`
- Create: `artifacts/ui/references/venue-map-scalable-poi.html`
- Create: `artifacts/ui/references/venue-map-scalable-long-content.html`
- Modify: `artifacts/ui/flows/map-venue-discovery.md`
- Modify: `artifacts/ui/screen-manifest/map-venue-discovery.yaml`
- Modify: `tests/structure.test.mjs`
- Modify: `pyproject.toml`
- Modify: `uv.lock`

- [ ] **Step 1: Write the failing manifest/state test**

Add the four new state IDs and both paired target viewports to `tests/structure.test.mjs`:

```js
assert.deepEqual(manifest.capture.viewports, [
  { width: 375, height: 812 },
  { width: 390, height: 844 },
]);
assert.deepEqual(manifest.sheet_snap_states, ["collapsed", "half", "expanded"]);
assert.deepEqual(
  manifest.states.slice(-4).map(({ id }) => id),
  ["scalable-city", "scalable-nearby", "scalable-poi", "scalable-long-content"],
);
for (const state of manifest.states.slice(-4)) {
  assert.equal(existsSync(state.reference), true, state.reference);
}
```

- [ ] **Step 2: Run the structure test and verify it fails**

Run: `node --test tests/structure.test.mjs`

Expected: FAIL because `capture.viewports` and the four references do not exist.

- [ ] **Step 3: Add the capture states and paired viewport dimensions to the manifest and flow**

Keep the current historical states. Replace the single capture dimensions with explicit pairs and add the four new states:

```yaml
capture:
  viewports:
    - width: 375
      height: 812
    - width: 390
      height: 844
  evidence_phase: scalable-map-visual-gate
sheet_snap_states:
  - collapsed
  - half
  - expanded
```

Use these state definitions:

```yaml
  - id: scalable-city
    reference: artifacts/ui/references/venue-map-scalable-city.html
    meaning: default full-city vertical directory without a location request
  - id: scalable-nearby
    reference: artifacts/ui/references/venue-map-scalable-nearby.html
    meaning: explicit user location with nearest-first platform venues
  - id: scalable-poi
    reference: artifacts/ui/references/venue-map-scalable-poi.html
    meaning: selected Tencent POI as center with platform-only distance ordering
  - id: scalable-long-content
    reference: artifacts/ui/references/venue-map-scalable-long-content.html
    meaning: fixed-height extreme content and both booking modes
```

Update `artifacts/ui/flows/map-venue-discovery.md` so horizontal cards are historical behavior and the new authority is the vertical list defined by the approved spec.

- [ ] **Step 4: Create the city and nearby reference documents**

Use the approved prototype as the composition source, but create self-contained deterministic HTML references with no network requests. `city` and `nearby` must show:

- 48×48 px search-aligned crosshair control;
- fixed 116 px rows with a permanently reserved 44×44 px arrow slot;
- no selected-row scale or height change;
- `CITY`, `USER_LOCATION`, or `POI` copy matching the spec;
- direct status text “可在线预订” or “仅提供场馆信息”;

Do not add a permanent map legend. Use an inline SVG magnifier/crosshair rather than emoji or text glyphs.

- [ ] **Step 5: Create the POI and long-content reference documents**

The POI reference uses 天津站 as the selected map place and labels distances “距天津站 …”。The long-content reference uses “天津奥林匹克中心五人制足球场”, the longest checked-in address, both booking modes, and the permanent arrow slot without overlapping text.

- [ ] **Step 6: Run the structure test**

Run: `node --test tests/structure.test.mjs`

Expected: PASS.

- [ ] **Step 7: Add the managed image dependency before capture**

Run: `uv add --dev pillow==11.3.0`

Expected: `pyproject.toml` and `uv.lock` record Pillow 11.3.0 without changing runtime dependencies.

- [ ] **Step 8: Capture and inspect all eight reference images**

For each HTML file, run Chrome headless at both viewports, for example:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --hide-scrollbars \
  --window-size=390,844 \
  --screenshot=/tmp/map-reference-scalable-city-390x844.png \
  "file://$PWD/artifacts/ui/references/venue-map-scalable-city.html"
```

Repeat for `375,812` and all four states. Verify with:

```bash
uv run python - <<'PY'
from PIL import Image
from pathlib import Path
expected = {"375x812": (375, 812), "390x844": (390, 844)}
for path in Path("/tmp").glob("map-reference-scalable-*.png"):
    key = next(key for key in expected if key in path.name)
    assert Image.open(path).size == expected[key], (path, Image.open(path).size)
PY
```

Expected: eight images with exact dimensions. Inspect all eight; the sheet shows two complete rows in half state, selected styling does not move neighbors, and the location button remains square.

- [ ] **Step 9: Commit the reference slice**

```bash
git add artifacts/ui/references/venue-map-scalable-*.html \
  artifacts/ui/flows/map-venue-discovery.md \
  artifacts/ui/screen-manifest/map-venue-discovery.yaml \
  tests/structure.test.mjs pyproject.toml uv.lock
git commit -m "design: freeze scalable map directory states"
```

### Task 2: Add the pure search-center presentation foundation

**Files:**
- Create: `miniprogram/presentation/venue-map-search.ts`
- Create: `miniprogram/presentation/venue-map-search.test.ts`
- Modify: `miniprogram/presentation/venue-map.ts`
- Modify: `miniprogram/presentation/venue-map.test.ts`

- [ ] **Step 1: Write failing state and sorting tests**

Define tests around these public types and functions:

```ts
export type SearchCenter =
  | { readonly kind: "CITY" }
  | { readonly kind: "USER_LOCATION"; readonly coordinate: Gcj02Coordinate }
  | { readonly kind: "POI"; readonly poi: SearchCenterPoi };

export interface VenueMapFilters {
  readonly onlineOnly: boolean;
  readonly districtCode: string | null;
}

export interface VenueDistrictSidecar {
  readonly [venueId: string]: { readonly code: string; readonly name: string };
}

export interface VenueSearchInput {
  readonly venues: readonly VenueMapEntry[];
  readonly center: SearchCenter;
  readonly filters: VenueMapFilters;
  readonly selectedVenueId: string | null;
  readonly districtByVenueId: VenueDistrictSidecar;
  readonly nearbyThresholdMeters?: number;
}

export function presentVenueSearch(input: VenueSearchInput): VenueSearchPresentation;
```

Define the POI-shaped presentation type locally in this module for Chunk 1:

```ts
export interface SearchCenterPoi {
  readonly id: string;
  readonly name: string;
  readonly address: string;
  readonly city: string;
  readonly district: string;
  readonly adcode: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly coordinateSystem: "GCJ02";
}
```

Chunk 2’s `PoiSearchResult` must structurally satisfy `SearchCenterPoi`; the presentation module must never import a network adapter.

`SearchCenterPoi` intentionally has the same flat shape as the approved Chunk 2 `PoiSearchResult`. Derive a `Gcj02Coordinate` locally only where distance or viewport helpers require one.

Cover:

- `CITY` preserves the incoming API array order exactly and emits no distance; it does not alphabetically re-sort decoded entries that omit `sortOrder`;
- user and POI modes sort ascending by distance with ID as final tie-breaker;
- 20 km zero-nearby copy uses “离你最近的已收录球场” or “离天津站最近的已收录球场”;
- `onlineOnly` and `districtCode` use only the supplied sidecar and never infer district from `address`;
- filtering out the selected venue returns `selectedVenueId: null` instead of selecting the first row.

- [ ] **Step 2: Run the focused tests and verify they fail**

Run: `npx jest miniprogram/presentation/venue-map-search.test.ts --runInBand`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the minimal pure module**

Keep the module independent of `wx`, timers, and data-source registries. Use the existing haversine distance helper from `venue-map.ts` or move that helper into `venue-map-search.ts` and re-export it to avoid duplicate distance logic.

The returned presentation must include:

```ts
interface VenueSearchPresentation {
  readonly visibleVenues: readonly VenueMapEntry[];
  readonly distanceMetersByVenueId: Readonly<Record<string, number>>;
  readonly distanceLabelBasis:
    | null
    | { readonly kind: "USER" }
    | { readonly kind: "POI"; readonly label: string };
  readonly searchCenterMarker: null | {
    readonly latitude: number;
    readonly longitude: number;
    readonly iconPath: "/assets/map-search-center.png";
    readonly joinCluster: false;
  };
  readonly selectedVenueId: string | null;
  readonly title: string;
  readonly subtitle: string;
  readonly sortLabel: "综合排序" | "距离最近";
  readonly hasNearbyVenue: boolean;
}
```

Also expose a pure sheet-aware viewport function:

```ts
export function calculateSearchCenterViewport(
  center: SearchCenter,
  snap: "collapsed" | "half" | "expanded",
): VenueMapViewport | null;
```

For `USER_LOCATION`/`POI`, the returned viewport uses neighborhood scale and shifts the geometric map center south by a tested snap-specific latitude offset so the actual independent center marker remains in the sheet-uncovered region. Tests assert the marker coordinate is exact, `joinCluster` is false, and the viewport latitude is south of the marker for `half`/`expanded`. `CITY` returns `null` so the caller uses the all-venue viewport.

- [ ] **Step 4: Make map projection consume explicit distance data**

Change `toVenueMapPresentation` so it receives the already ordered visible venues, distance map, and `distanceLabelBasis`. Remove its `stableVenues` re-sort entirely: cards, markers, and all-venue viewport points must preserve the supplied array order. Add a deliberately non-alphabetical input assertion to `miniprogram/presentation/venue-map.test.ts` covering all three projections. `USER` formats “距你 …”; `POI` formats “距<label> …”; `null` renders no computed-distance line. Keep marker and card business actions unchanged. The page appends `searchCenterMarker` to runtime markers with a reserved stable marker ID and `joinCluster:false`; it must never enter the venue marker-ID lookup table.

- [ ] **Step 5: Run presentation tests**

Run: `npx jest miniprogram/presentation/venue-map-search.test.ts miniprogram/presentation/venue-map.test.ts --runInBand`

Expected: PASS.

- [ ] **Step 6: Commit the presentation foundation**

```bash
git add miniprogram/presentation/venue-map-search.ts \
  miniprogram/presentation/venue-map-search.test.ts \
  miniprogram/presentation/venue-map.ts \
  miniprogram/presentation/venue-map.test.ts
git commit -m "feat: model map directory search centers"
```

### Task 3: Build the fixed-height vertical directory with an isolated preview fixture

**Files:**
- Create: `miniprogram/dev/venue-map-preview-fixture.ts`
- Create: `miniprogram/dev/poi-search-preview.ts`
- Create: `miniprogram/services/poi-search.ts`
- Create: `miniprogram/services/venue-map-preview.ts`
- Create: `miniprogram/assets/map-search-center.png`
- Create: `miniprogram/components/venue-map-card/index.test.ts`
- Create: `miniprogram/components/venue-map-sheet/index.test.ts`
- Create: `miniprogram/components/venue-map-search/index.json`
- Create: `miniprogram/components/venue-map-search/index.ts`
- Create: `miniprogram/components/venue-map-search/index.wxml`
- Create: `miniprogram/components/venue-map-search/index.wxss`
- Create: `miniprogram/components/venue-map-search/index.test.ts`
- Modify: `miniprogram/dev/venue-directory-source.ts`
- Modify: `miniprogram/dev/bootstrap.ts`
- Modify: `miniprogram/components/venue-map-card/index.{ts,wxml,wxss}`
- Modify: `miniprogram/components/venue-map-sheet/index.{ts,wxml,wxss}`
- Modify: `miniprogram/pages/venue-map/index.{ts,wxml,wxss}`
- Modify: `miniprogram/pages/venue-map/index.test.ts`
- Modify: `miniprogram/presentation/venue-map.ts`
- Modify: `miniprogram/presentation/venue-map.test.ts`
- Modify: `tests/fixtures.test.mjs`
- Modify: `tests/build-miniprogram.test.mjs`

- [ ] **Step 1: Write the failing fixed-row component tests**

Add assertions proving:

```ts
expect(cardTemplate).not.toContain("wx:if=\"{{card.selected}}\"");
expect(cardTemplate).toContain('class="venue-row-action"');
expect(sheetTemplate).toContain("scroll-y");
expect(sheetTemplate).not.toContain("scroll-x");
expect(pageTemplate).toContain('aria-label="定位到我"');
expect(pageTemplate).not.toMatch(/>附近<\/button>/);
```

In `miniprogram/components/venue-map-card/index.test.ts`, assert `.venue-row` has `height:232rpx`, `.venue-row-action` has both `width:88rpx` and `height:88rpx`, and selected styling contains neither a different height nor `transform:scale`. Render both booking modes and the longest-content model; assert the name/address classes are single-line ellipsis slots and the action slot is always present.

- [ ] **Step 2: Write the failing vertical-sheet behavior tests**

In `miniprogram/components/venue-map-sheet/index.test.ts`, assert `scroll-y` exists, `scroll-x` does not, and snapping preserves the component’s stored `listScrollTop`. Assert only handle/title events emit snap changes; list scroll events only update `listScrollTop`.

The sheet property/event union, WXML modifier classes, tests, and page data must all use exactly `"collapsed" | "half" | "expanded"`; remove the historical runtime name `default` rather than aliasing it.

- [ ] **Step 3: Run the focused tests and verify they fail**

Run:

```bash
npx jest miniprogram/components/venue-map-card/index.test.ts \
  miniprogram/components/venue-map-sheet/index.test.ts \
  miniprogram/pages/venue-map/index.test.ts --runInBand
```

Expected: FAIL because the current sheet is horizontal and the action is conditionally rendered.

- [ ] **Step 4: Write failing preview-fixture and production-isolation tests**

In `tests/fixtures.test.mjs`, specify exactly 100 entries, unique UUID-shaped IDs, sidecar coverage for every ID, the exact extreme name/address, both booking modes, deterministic repeat output, and the future deletion gate. In `tests/build-miniprogram.test.mjs`, specify that production output contains neither preview filename nor either `DEV_ONLY_*` token, while development output can load the preview composition.

Add a Node test asserting `/assets/map-search-center.png` exists and survives the development build. Runtime marker plumbing is tested later with the page state integration.

- [ ] **Step 5: Run preview/isolation tests and verify they fail**

Run:

```bash
node --test tests/fixtures.test.mjs tests/build-miniprogram.test.mjs
```

Expected: FAIL because the preview sources and center-marker asset do not exist.

- [ ] **Step 6: Implement the temporary 100-venue preview source, district sidecar, center-marker asset, and POI preview**

Export `{ venues, districtByVenueId }` from `createVenueMapPreviewFixture(count = 100)`. Derive entries deterministically from canonical decoded entries and assign unique UUID-shaped IDs, names, `sortOrder`, and nearby GCJ-02 coordinates. Entry 100 must use the exact name “天津奥林匹克中心五人制足球场” and the longest checked-in address; the collection must contain at least one `ONLINE` and one `DIRECTORY_ONLY` entry. Put `districtCode` and `districtName` only in the sidecar; do not add or cast these fields onto production `VenueMapEntry` before contract approval. Mark the module with the literal `DEV_ONLY_VENUE_MAP_PREVIEW_FIXTURE` so production-package tests can forbid it.

Register the venues only from the development fixture branch of `miniprogram/dev/venue-directory-source.ts`. Add a temporary `VenueMapPreviewMetadata` registry in `miniprogram/services/venue-map-preview.ts`, register the sidecar from `miniprogram/dev/bootstrap.ts`, and let the page read only that registry. Its default is an empty frozen sidecar, so HTTP and production paths never fabricate district values. Do not import the development fixture module from any production page, presentation, or runtime module.

Create `/miniprogram/assets/map-search-center.png` as a small optimized center-pin asset visually distinct from venue markers.

Create the deterministic preview POI capability:

Define the capability and registry in `miniprogram/services/poi-search.ts`:

```ts
export interface PoiSearchResult extends SearchCenterPoi {}
export interface PoiSearchCapability {
  suggest(query: string): Promise<readonly PoiSearchResult[]>;
}
export function registerPoiSearchCapability(capability: PoiSearchCapability): void;
export function getPoiSearchCapability(): PoiSearchCapability;
```

`miniprogram/dev/poi-search-preview.ts` returns a fixed 天津站 result only when the normalized query contains “天津站”; it is registered only in development fixture bootstrap. This makes the POI visual state reachable through the actual search UI without Tencent traffic.

- [ ] **Step 7: Run preview/isolation tests and verify they pass**

Run:

```bash
node --test tests/fixtures.test.mjs tests/build-miniprogram.test.mjs
```

Expected: PASS. The fixture test also records this exact deletion gate: immediately after real HTTP directory responses include decoded district fields and the production Tencent POI adapter passes loading/empty/error/retry integration, remove both development source files, the temporary metadata registry, all bootstrap registrations, and all tests that require those files to exist.

- [ ] **Step 8: Implement the fixed row**

Render status, one-line name, one-line address, one-line distance/summary, and an always-present 88 rpx square arrow action. The body emits `select`; the arrow uses `catchtap` and emits `action`. Both selected and unselected rows remain exactly 232 rpx tall.

Use these stable actions:

- `VIEW_AVAILABILITY`: arrow accessible label “查看可订时段”；
- `VIEW_DETAIL`: arrow accessible label “查看场馆详情”。

Change status copy in `miniprogram/presentation/venue-map.ts` to exactly “可在线预订” and “仅提供场馆信息”.

Update `miniprogram/presentation/venue-map.test.ts` to assert both exact strings and to prove `DIRECTORY_ONLY` still never receives `VIEW_AVAILABILITY`.

- [ ] **Step 9: Convert the sheet to vertical scrolling**

Replace `scroll-x` and the flex track with `scroll-y`. Only the handle/title region emits snap gestures; the list owns vertical scrolling. Preserve `scrollTop` when toggling `collapsed/half/expanded`. Keep the clickable handle and “展开列表/收起地图” action as the non-drag alternative.

- [ ] **Step 10: Write the failing grouped-search component tests**

Write tests proving `venue-map-search` owns only `draftQuery`, local platform matches, preview/Tencent suggestion rows, loading/empty/error copy, clear, cancel, and selection events. Input alone does not emit a committed center; platform and “地图地点” groups remain distinct; keyboard submit without a selected suggestion emits no commit; cancel emits the pre-edit restore intent.

- [ ] **Step 11: Run grouped-search tests and verify they fail**

Run: `npx jest miniprogram/components/venue-map-search/index.test.ts --runInBand`

Expected: FAIL because the component has not been implemented.

- [ ] **Step 12: Implement the grouped-search component**

Implement only the tested input/suggestion presentation and events; keep committed center, map sorting, and location ownership in the page.

- [ ] **Step 13: Run grouped-search tests and verify they pass**

Run: `npx jest miniprogram/components/venue-map-search/index.test.ts --runInBand`

Expected: PASS.

- [ ] **Step 14: Write failing page tests for all three committed centers**

Add page tests before implementation:

- ordinary `onLoad` commits `CITY`, uses platform order, title “全部球场”, and no distance prefix;
- successful `onLocateTap` commits `USER_LOCATION`, clears draft/POI marker, sets location active, uses the user-centered viewport, and projects `distancePrefix: "距你"`;
- selecting the preview 天津站 POI commits `POI`, clears draft/location active, preserves user location only as a non-sorting reference, uses the POI-centered viewport, and projects `distancePrefix: "距天津站"`;
- selecting a platform suggestion only changes selection/focus and preserves the committed center;
- applying `onlineOnly` or a sidecar district filter calls `presentVenueSearch`; if the selected venue disappears, page selection becomes `null` and no first-item auto-selection occurs;
- location failure restores the complete pre-request center, filters, selection, and viewport snapshot.
- POI mode appends exactly one independent runtime marker using `/assets/map-search-center.png`, `joinCluster:false`, and a reserved ID that cannot resolve to a venue in `onMarkerTap`.

- [ ] **Step 15: Run the page tests and verify the new cases fail**

Run: `npx jest miniprogram/pages/venue-map/index.test.ts --runInBand`

Expected: FAIL on the new center-transition, distance-label, sidecar-filter, and restoration assertions.

- [ ] **Step 16: Implement page integration through one presentation method**

Implement one page method `applySearchPresentation(center, filters, selectedVenueId)` that always calls `presentVenueSearch`, then calls `toVenueMapPresentation` with its ordered venues, explicit distance map, and `distanceLabelBasis`. It applies `calculateSearchCenterViewport(center, sheetSnap)` when non-null, appends the independent `searchCenterMarker`, and otherwise uses the all-venue/selected-venue viewport. Page event handlers update committed state and delegate to this method; they must not duplicate sorting, distance, title, viewport offset, marker, or selection-validity logic.

- [ ] **Step 17: Run page and presentation tests and verify they pass**

Run:

```bash
npx jest miniprogram/pages/venue-map/index.test.ts \
  miniprogram/presentation/venue-map-search.test.ts \
  miniprogram/presentation/venue-map.test.ts --runInBand
```

Expected: PASS.

- [ ] **Step 18: Replace the location text control and permanent legend**

In the page WXML/WXSS:

- render an inline/image crosshair icon in a 96 rpx square rounded control;
- keep `loading`, active, and error states at identical outer dimensions;
- remove the permanent map legend;
- render the city title/subtitle and filter placeholders in the sheet;
- connect the search UI to the registered preview POI capability, while an unregistered capability yields the isolated “地图地点暂时无法搜索” state without breaking the local venue search.

Use the real location button plus the DevTools simulated GCJ-02 location for the nearby capture. Use the real search UI and query “天津站” for the POI capture. Use the 100-entry development source and its longest entry for the long-content capture. No hidden route-only state switch is permitted.

- [ ] **Step 19: Run the focused tests and Mini Program builds**

Run:

```bash
npx jest miniprogram/pages/venue-map/index.test.ts \
  miniprogram/components/venue-map-card/index.test.ts \
  miniprogram/components/venue-map-sheet/index.test.ts \
  miniprogram/components/venue-map-search/index.test.ts \
  miniprogram/presentation/venue-map-search.test.ts \
  miniprogram/presentation/venue-map.test.ts --runInBand
npm run typecheck
npm run build:miniprogram:development
npm run build:miniprogram:production
npm run audit:miniprogram-package
node --test tests/fixtures.test.mjs tests/build-miniprogram.test.mjs
```

Expected: all commands PASS; the production audit finds no preview fixture token.

- [ ] **Step 20: Commit the real-runtime visual slice**

```bash
git add miniprogram/dev/venue-map-preview-fixture.ts \
  miniprogram/dev/poi-search-preview.ts \
  miniprogram/dev/venue-directory-source.ts \
  miniprogram/dev/bootstrap.ts \
  miniprogram/services/poi-search.ts \
  miniprogram/services/venue-map-preview.ts \
  miniprogram/assets/map-search-center.png \
  miniprogram/components/venue-map-card \
  miniprogram/components/venue-map-sheet \
  miniprogram/components/venue-map-search \
  miniprogram/pages/venue-map \
  miniprogram/presentation/venue-map.ts \
  miniprogram/presentation/venue-map.test.ts \
  tests/fixtures.test.mjs tests/build-miniprogram.test.mjs
git commit -m "feat: render scalable vertical venue directory"
```

### Task 4: Capture the visual gate and obtain explicit user approval

**Files:**
- Create: `artifacts/ui/reviews/map-venue-discovery-scalable/README.md`
- Create: `scripts/create_visual_review.py`
- Create: `scripts/create_visual_review_test.py`
- Create: `artifacts/ui/reviews/map-venue-discovery-scalable/<state>-<viewport>-reference.png` (8 files)
- Create: `artifacts/ui/reviews/map-venue-discovery-scalable/<state>-<viewport>-implementation.png` (8 files)
- Create: `artifacts/ui/reviews/map-venue-discovery-scalable/<state>-<viewport>-side-by-side.png` (8 files)
- Create: `artifacts/ui/reviews/map-venue-discovery-scalable/<state>-<viewport>-overlay-50.png` (8 files)
- Create: `artifacts/ui/reviews/map-venue-discovery-scalable/<state>-<viewport>-difference.png` (8 files)
- Modify: `docs/acceptance/map-venue-discovery-progress.md`

- [ ] **Step 1: Write a failing image-comparison utility test**

Create a Pillow test with two 10×10 input images. Assert the tool writes a 20×10 side-by-side, 10×10 50% overlay, and 10×10 absolute difference image; reject mismatched dimensions.

- [ ] **Step 2: Run the utility test and verify it fails**

Run: `uv run python -m unittest scripts/create_visual_review_test.py`

Expected: FAIL because `scripts/create_visual_review.py` does not exist.

- [ ] **Step 3: Implement and verify the image-comparison utility**

Implement `scripts/create_visual_review.py REFERENCE IMPLEMENTATION OUTPUT_PREFIX` using Pillow `Image.blend`, `ImageChops.difference`, and a new RGB canvas for side-by-side. It must fail before writing if dimensions differ.

Run: `uv run python -m unittest scripts/create_visual_review_test.py`

Expected: PASS.

- [ ] **Step 4: Capture the eight references at exact target viewports**

Use the Chrome command from Task 1 Step 8 and write the eight files directly under `artifacts/ui/reviews/map-venue-discovery-scalable/`, for example `city-390x844-reference.png`. Do not resize after capture. Run the Pillow dimension check from Task 1 and expect all eight exact dimensions.

- [ ] **Step 5: Capture the eight actual WeChat runtime images**

Build the development fixture composition, open it in the pinned WeChat DevTools/base library, and use the DevTools screenshot action for the same four states at both logical dimensions. Name them `<state>-<viewport>-implementation.png`; do not crop or resize. Record DevTools version, base library, operating system, DPR, route, fixture mode, and generating commit.

Validate both input sets with a parameterized check that cannot pass on zero files:

```bash
uv run python - <<'PY'
from pathlib import Path
from PIL import Image
root = Path("artifacts/ui/reviews/map-venue-discovery-scalable")
expected = {"375x812": (375, 812), "390x844": (390, 844)}
for kind in ("reference", "implementation"):
    paths = sorted(root.glob(f"*-{kind}.png"))
    assert len(paths) == 8, (kind, len(paths))
    for path in paths:
        key = next((key for key in expected if key in path.name), None)
        assert key is not None, path
        assert Image.open(path).size == expected[key], (path, Image.open(path).size)
PY
```

Expected: exactly eight references and eight implementations, all with their encoded dimensions.

- [ ] **Step 6: Generate all 24 comparison images**

For every state/viewport pair, run:

```bash
uv run python scripts/create_visual_review.py \
  artifacts/ui/reviews/map-venue-discovery-scalable/city-390x844-reference.png \
  artifacts/ui/reviews/map-venue-discovery-scalable/city-390x844-implementation.png \
  artifacts/ui/reviews/map-venue-discovery-scalable/city-390x844
```

Repeat for all eight pairs. Expected: exactly 40 PNGs total (8 references, 8 implementations, 24 comparisons). In `README.md`, record SHA-256 for each input pair and differences in composition, geometry/spacing, hierarchy, typography/color/material, icons, copy, and state semantics. Automated layout tests are not visual approval.

Validate every prefix and output dimension:

```bash
uv run python - <<'PY'
from pathlib import Path
from PIL import Image
root = Path("artifacts/ui/reviews/map-venue-discovery-scalable")
states = ("city", "nearby", "poi", "long-content")
viewports = {"375x812": (375, 812), "390x844": (390, 844)}
for state in states:
    for viewport, size in viewports.items():
        prefix = root / f"{state}-{viewport}"
        expected = {
            "reference": size,
            "implementation": size,
            "overlay-50": size,
            "difference": size,
            "side-by-side": (size[0] * 2, size[1]),
        }
        for suffix, expected_size in expected.items():
            path = Path(f"{prefix}-{suffix}.png")
            assert path.exists(), path
            assert Image.open(path).size == expected_size, (path, Image.open(path).size)
assert len(list(root.glob("*.png"))) == 40
PY
```

Expected: PASS with exactly 40 files.

- [ ] **Step 7: Run the visual-slice regression suite**

Run:

```bash
npm run lint
npm run typecheck
npm test
npm run build:miniprogram:development
npm run build:miniprogram:production
npm run audit:miniprogram-package
```

Expected: all commands PASS.

- [ ] **Step 8: Stop and request explicit user approval for both viewport sets**

Present reference, implementation, side-by-side, overlay, and difference for all four states at both 375×812 and 390×844. Do not begin Chunk 2 until the user explicitly approves both viewport sets from the real Mini Program runtime.

- [ ] **Step 9: Record and commit the visual decision**

After approval, update `README.md` and `docs/acceptance/map-venue-discovery-progress.md` with the exact accepted commit and image identities.

```bash
git add artifacts/ui/reviews/map-venue-discovery-scalable \
  docs/acceptance/map-venue-discovery-progress.md \
  scripts/create_visual_review.py scripts/create_visual_review_test.py
git commit -m "docs: record scalable map visual approval"
```

## Chunk 2: Contract, Tencent POI, real integration, and fixture removal

Chunk 2 starts only after Task 4 records explicit user approval of both 375×812 and 390×844 real-runtime visuals. At that checkpoint, re-read the approved images and freeze the provisional `PoiSearchCapability`, district fields, and search-center state names before changing the contract.

### Task 5: Add structured district authority to the map contract

**Files:**
- Modify: `contracts/openapi.yaml`
- Modify: `contracts/examples/venue-map.json`
- Modify: `tests/contract.test.mjs`
- Modify: `scripts/validate-contract.mjs`
- Modify: `deploy/venue-directory.schema.json`
- Modify: `deploy/venue-directory.json`
- Modify: `tests/venue-directory-content.test.mjs`
- Create: `backend/migrations/versions/0007_venue_district.py`
- Modify: `backend/tests/test_venue_directory_migration.py`
- Modify: `backend/app/models.py`
- Modify: `backend/app/modules/venues/dto.py`
- Modify: `backend/app/modules/venues/service.py`
- Modify: `backend/app/modules/venues/loader.py`
- Modify: `backend/tests/test_venue_directory_schema.py`
- Modify: `backend/tests/test_venue_directory_api.py`
- Modify: `backend/tests/test_venue_directory_loader.py`
- Modify: `backend/tests/test_openapi_conformance.py`
- Modify: `scripts/seed_demo.py`
- Modify: `backend/tests/test_seed_demo.py`
- Modify: `backend/tests/test_schema_constraints.py`
- Modify: `miniprogram/domain/venue-directory.ts`
- Modify: `miniprogram/domain/decoders.ts`
- Modify: `miniprogram/domain/decoders.test.ts`

- [ ] **Step 1: Write failing OpenAPI and content tests**

Require `district_code` and `district_name` on `VenueMapItem` only. Do not change `OnlineVenueDetail`, `DirectoryVenueDetail`, or `/venues/primary`.

```js
assert.deepEqual(new Set(summary.required), new Set([
  "id", "name", "address", "district_code", "district_name",
  "latitude", "longitude", "booking_mode", "pitch_types",
  "cover_image", "nearest_transit", "content_verified_at",
]));
assert.deepEqual(summary.properties.district_code, {
  type: "string",
  pattern: "^[0-9]{6}$",
});
```

In `tests/venue-directory-content.test.mjs`, assert the five authoritative pairs:

```js
const districts = new Map([
  ["7e68d7d8-4b7e-4f04-a5c5-3fe263e69c6f", ["120111", "西青区"]],
  ["e03d801d-1254-5c62-9a16-9a8800280162", ["120104", "南开区"]],
  ["2a9640a5-f625-5ad8-9cb9-3440acb70967", ["120105", "河北区"]],
  ["80532433-8038-5ee5-9963-3e6282aa4abd", ["120101", "和平区"]],
  ["c0372328-6fa4-585a-b951-3324925763d6", ["120110", "东丽区"]],
]);
```

Retain the current production lower bound and deliberately expand only its scalability ceiling from `minItems: 5, maxItems: 5` to `minItems: 5, maxItems: 500`. This is the real production directory capacity, not a test bypass. Add a schema test proving deterministic valid manifests with 50 and 100 entries are accepted while 501 is rejected; semantic validation must still require exactly one canonical `ONLINE` venue and allow all additional identities only as `DIRECTORY_ONLY`.

- [ ] **Step 2: Run contract/content tests and verify they fail**

Run:

```bash
node --test tests/contract.test.mjs tests/venue-directory-content.test.mjs
npm run contract:validate
```

Expected: FAIL because district fields are absent.

- [ ] **Step 3: Add district fields to OpenAPI, example, manifest schema, and manifest**

The deploy schema requires six-digit `district_code` and non-empty `district_name` for every venue, accepts 5–500 records, and keeps the one-canonical-online semantic rule. `validate-contract.mjs` rejects missing, malformed, or unstable map examples. Do not parse district from `address` anywhere.

Keep `/api/v1/venues/map` array order authoritative. Do not add `sort_order` to the public contract: the backend already orders by persisted `sort_order`, `name`, and `id`, and the Mini Program must preserve the received array order in `CITY` mode.

- [ ] **Step 4: Run contract/content tests and verify they pass**

Run:

```bash
node --test tests/contract.test.mjs tests/venue-directory-content.test.mjs
npm run contract:validate
```

Expected: PASS.

- [ ] **Step 5: Write failing PostgreSQL migration tests**

Extend `backend/tests/test_venue_directory_migration.py` with a 0006→0007 upgrade case. Seed all five known venue UUIDs at revision 0006, upgrade to 0007, and assert the exact district pairs, both columns are non-nullable, and Alembic head is `0007`. Add separate cases proving an unknown pre-existing venue aborts the upgrade atomically at `0006`, and downgrade to `0006` removes only the two district columns without changing venue identities or booking data.

- [ ] **Step 6: Run the migration tests and verify they fail**

Run:

```bash
.venv/bin/pytest -q backend/tests/test_venue_directory_migration.py
```

Expected: FAIL because revision `0007` does not exist.

- [ ] **Step 7: Implement the staged migration**

`0007_venue_district.py` adds nullable fields, backfills by immutable UUID, rejects unknown existing venue identities before final constraints, then makes both fields non-null. Downgrade removes only the two columns. Keep migration-only constants inside the migration; do not import deploy JSON at migration runtime.

- [ ] **Step 8: Run the migration tests and verify they pass**

Run the Step 6 command.

Expected: PASS with the database at revision `0007` after the upgrade case.

- [ ] **Step 9: Write failing backend schema/API/loader tests**

Add tests proving:

- ORM/schema metadata exposes required `district_code` and `district_name`;
- `scripts/seed_demo.py` supplies the canonical venue's exact district values, its test remains idempotent, and direct `Venue(...)` factories in `backend/tests/test_schema_constraints.py` and `backend/tests/test_venue_directory_api.py` satisfy the new non-null invariant;
- loader reads the structured fields transactionally and rejects missing/malformed district values before database access;
- `/api/v1/venues/map` returns the two fields in stable order;
- the API response array follows the backend `sort_order`, `name`, `id` query order and the client retains that order;
- detail and primary responses remain byte/schema compatible and do not gain district fields.

- [ ] **Step 10: Run focused backend tests and verify they fail**

Run:

```bash
.venv/bin/pytest -q \
  backend/tests/test_venue_directory_schema.py \
  backend/tests/test_venue_directory_api.py \
  backend/tests/test_venue_directory_loader.py \
  backend/tests/test_openapi_conformance.py \
  backend/tests/test_seed_demo.py \
  backend/tests/test_schema_constraints.py
```

Expected: FAIL on the new district assertions.

- [ ] **Step 11: Implement persistence and loader parsing**

Add non-null ORM fields and make the loader validate/copy structured district values transactionally. It must reject invalid manifest content before opening its database transaction. Update `scripts/seed_demo.py` with the canonical `120111`/`西青区` pair and update every direct `Venue(...)` test factory named in this task so no post-0007 insert omits required district values.

- [ ] **Step 12: Implement DTO and map-only service projection**

Add the two fields only to the map DTO and `_map_item`; `_common_detail` stays unchanged. Preserve the service query order without a second application-level sort.

- [ ] **Step 13: Run backend tests and verify they pass**

Run the Step 10 command.

Expected: PASS.

- [ ] **Step 14: Write failing Mini Program decoder/order tests**

Refactor client domain types so map entries contain `districtCode`/`districtName`, while venue detail types remain independent and unchanged. Tests must reject extra/missing/malformed map fields, decode the exact pair, prove details still decode without district fields, and prove `CITY` presentation preserves a deliberately non-alphabetical decoded API array.

- [ ] **Step 15: Run decoder/presentation tests and verify they fail**

Run:

```bash
npx jest miniprogram/domain/decoders.test.ts \
  miniprogram/presentation/venue-map-search.test.ts --runInBand
```

Expected: FAIL on map district decoding.

- [ ] **Step 16: Implement the map-only domain and decoder refactor**

Split the reusable decoder into a detail core and a map-entry wrapper. Do not make district optional and do not add it to detail exact-key lists. Retain and verify Chunk 1’s no-re-sort projection behavior; distance modes may use venue ID only as the final tie-breaker after distance.

- [ ] **Step 17: Run the full contract boundary tests**

Run:

```bash
npx jest miniprogram/domain/decoders.test.ts --runInBand
npm run contract:validate
node --test tests/contract.test.mjs tests/venue-directory-content.test.mjs
.venv/bin/pytest -q backend/tests/test_openapi_conformance.py backend/tests/test_venue_directory_api.py
.venv/bin/pytest -q backend/tests/test_venue_directory_migration.py
```

Expected: PASS.

- [ ] **Step 18: Commit the district contract slice**

```bash
git add contracts/openapi.yaml contracts/examples/venue-map.json \
  tests/contract.test.mjs scripts/validate-contract.mjs \
  deploy/venue-directory.schema.json deploy/venue-directory.json \
  tests/venue-directory-content.test.mjs \
  backend/migrations/versions/0007_venue_district.py \
  backend/app/models.py backend/app/modules/venues \
  backend/tests/test_venue_directory_schema.py \
  backend/tests/test_venue_directory_migration.py \
  backend/tests/test_venue_directory_api.py \
  backend/tests/test_venue_directory_loader.py \
  backend/tests/test_openapi_conformance.py \
  scripts/seed_demo.py backend/tests/test_seed_demo.py \
  backend/tests/test_schema_constraints.py \
  miniprogram/domain/venue-directory.ts \
  miniprogram/domain/decoders.ts miniprogram/domain/decoders.test.ts
git commit -m "feat: expose structured venue districts"
```

### Task 6: Implement the Tencent POI capability with build-time restricted-key configuration

**Files:**
- Modify: `miniprogram/config/runtime.ts`
- Create: `miniprogram/services/tencent-poi-search.ts`
- Create: `miniprogram/services/tencent-poi-search.test.ts`
- Create: `scripts/miniprogram-runtime-config.mjs`
- Create: `tests/miniprogram-runtime-config.test.mjs`
- Modify: `miniprogram/services/poi-search.ts`
- Modify: `miniprogram/runtime/production.ts`
- Modify: `miniprogram/runtime/production.test.ts`
- Modify: `miniprogram/dev/bootstrap.ts`
- Modify: `scripts/build-miniprogram.mjs`
- Modify: `tests/build-miniprogram.test.mjs`
- Modify: `tests/development-http-build.test.mjs`
- Modify: `scripts/audit-production-package.mjs`
- Modify: `docs/llm-wiki/wechat-miniprogram/network-auth-payment.md`
- Create: `docs/acceptance/evidence/tencent-poi-privacy-disclosure.png`

- [ ] **Step 1: Freeze the capability after visual approval**

Confirm the approved fields exactly match:

```ts
export interface PoiSearchResult {
  readonly id: string;
  readonly name: string;
  readonly address: string;
  readonly city: string;
  readonly district: string;
  readonly adcode: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly coordinateSystem: "GCJ02";
}

export interface PoiSearchCapability {
  suggest(query: string): Promise<readonly PoiSearchResult[]>;
}
```

If the visual gate changed any field or copy, update the approved spec and repeat review before continuing.

- [ ] **Step 2: Write failing strict-decoder/request tests**

Mock `wx.request` and cover:

- request endpoint `https://apis.map.qq.com/ws/place/v1/suggestion`;
- trimmed query with at least two non-empty characters;
- the request query contains only the allowlisted parameters `keyword`, `key`, and `output: "json"`; omit `region` so Tencent performs its documented nationwide suggestion search, and never send latitude/longitude/location;
- decoding Tencent suggestion fields `id`, `title`, `address`, direct `city`, direct `district`, direct `adcode`, and `location.lat/lng` into the flat approved result with `coordinateSystem: "GCJ02"`;
- invalid status, missing fields, invalid coordinates, timeout, and empty result;
- no request for one-character/blank input.

Also inject spies for storage, logging, and the platform HTTP transport and assert none receives the query text, POI object, or any user coordinate. Only the constructor-injected Tencent request receives the allowlisted suggestion request.

- [ ] **Step 3: Run POI tests and verify they fail**

Run: `npx jest miniprogram/services/tencent-poi-search.test.ts --runInBand`

Expected: FAIL because the adapter does not exist.

- [ ] **Step 4: Implement the strict Tencent adapter**

Use a constructor-injected request function and key so tests do not mutate global `wx`. Decode only needed fields; discard invalid items without accepting a malformed response as a whole success. Never pass user coordinates. Map third-party failures to `POI_SEARCH_UNAVAILABLE` without logging query text.

- [ ] **Step 5: Run POI tests and verify they pass**

Run: `npx jest miniprogram/services/tencent-poi-search.test.ts --runInBand`

Expected: PASS.

- [ ] **Step 6: Write failing runtime-config helper tests**

Create `tests/miniprogram-runtime-config.test.mjs` around pure exports from `scripts/miniprogram-runtime-config.mjs`. Require `MINIPROGRAM_TENCENT_MAP_KEY` for production and development HTTP builds; accept Tencent client-key format such as `OB4BZ-D4W3U-B7VVO-4PJWW-6TKDJ-WPB77` using case-insensitive `^[A-Z0-9]{5}(?:-[A-Z0-9]{5}){5}$`. Development fixture builds require no key. Assert invalid/missing-key errors never echo the submitted value and rendered JavaScript exports both `API_BASE_URL` and `TENCENT_MAP_KEY`.

- [ ] **Step 7: Run runtime-config tests and verify they fail**

Run: `node --test tests/miniprogram-runtime-config.test.mjs`

Expected: FAIL because the helper does not exist.

- [ ] **Step 8: Implement the runtime-config helper and source placeholders**

Make `miniprogram/config/runtime.ts` the single source-owned config boundary:

```ts
export const API_BASE_URL = "https://staging-api.pitch-booking.example";
export const TENCENT_MAP_KEY = "__TENCENT_MAP_KEY__";
```

Implement pure validation and config rendering in `scripts/miniprogram-runtime-config.mjs`. The real key is supplied only through the environment and written only to generated `dist/miniprogram-{production|development}/config/runtime.js`; it is never written back into source.

- [ ] **Step 9: Run runtime-config tests and verify they pass**

Run the Step 7 command.

Expected: PASS.

- [ ] **Step 10: Write failing build/bootstrap tests**

Assert:

- source `miniprogram/config/runtime.ts` contains only the Tencent placeholder, not a real key;
- generated runtime config contains the supplied restricted key;
- production bootstrap registers `createTencentPoiSearch` before `App({})`;
- the raw placeholder and all `DEV_ONLY_*` tokens are absent from production output;
- error messages never echo the rejected key.

- [ ] **Step 11: Run build tests and verify they fail**

Run:

```bash
node --test tests/build-miniprogram.test.mjs tests/development-http-build.test.mjs
npx jest miniprogram/runtime/production.test.ts --runInBand
```

Expected: FAIL because key resolution and production registration do not exist.

- [ ] **Step 12: Connect the build script to generated runtime config**

Have `scripts/build-miniprogram.mjs` call the tested helper. Production and development HTTP outputs receive generated runtime config with API URL and key; fixture output retains the deterministic preview capability and does not require or emit a real key.

- [ ] **Step 13: Register the adapter in production and HTTP-development composition**

Import generated `TENCENT_MAP_KEY`, construct/register `createTencentPoiSearch` before `App({})`, and pass the key into development HTTP bootstrap. Fixture composition continues registering the preview adapter. The key is intentionally present in the client bundle and therefore must be a Tencent client key bound to this Mini Program AppID and service scope, never a reusable server secret.

- [ ] **Step 14: Run build/runtime tests and verify they pass**

Run the Step 11 command.

Expected: PASS.

- [ ] **Step 15: Complete the Tencent console and WeChat domain prerequisite**

In Tencent Location Services, create/reuse a dedicated key restricted to the Mini Program AppID and enable only the required place-suggestion/WebService scope. In WeChat Public Platform, add `https://apis.map.qq.com` to request legal domains. Record key ID (not key value), restriction screenshot, enabled service, quota, and domain screenshot in `docs/llm-wiki/wechat-miniprogram/network-auth-payment.md`.

Do not commit the real key or paste it into issue/acceptance logs. If console access is unavailable, mark device POI verification blocked without weakening build validation.

- [ ] **Step 16: Record the real privacy disclosure prerequisite**

In WeChat Public Platform, open **设置 → 用户隐私保护指引** and disclose Tencent Location Services as a third-party processor, the purpose “搜索地图地点并以所选地点为中心排列平台已收录球场”, the search-text and location/POI data types, sharing rules, retention/deletion policy, and the explicit boundary that user coordinates are never sent with POI suggestion requests. Save the published/under-review confirmation screenshot as `docs/acceptance/evidence/tencent-poi-privacy-disclosure.png`; do not put query samples, coordinates, or keys in the evidence.

- [ ] **Step 17: Commit the production POI boundary**

```bash
git add miniprogram/config/runtime.ts \
  miniprogram/services/poi-search.ts \
  miniprogram/services/tencent-poi-search.ts \
  miniprogram/services/tencent-poi-search.test.ts \
  miniprogram/runtime/production.ts miniprogram/runtime/production.test.ts \
  miniprogram/dev/bootstrap.ts scripts/build-miniprogram.mjs \
  scripts/miniprogram-runtime-config.mjs tests/miniprogram-runtime-config.test.mjs \
  tests/build-miniprogram.test.mjs tests/development-http-build.test.mjs \
  scripts/audit-production-package.mjs \
  docs/llm-wiki/wechat-miniprogram/network-auth-payment.md \
  docs/acceptance/evidence/tencent-poi-privacy-disclosure.png
git commit -m "feat: add restricted Tencent POI search"
```

### Task 7: Integrate real suggestions, committed search-state transitions, and filters

**Files:**
- Modify: `miniprogram/components/venue-map-search/index.{ts,wxml,wxss}`
- Modify: `miniprogram/components/venue-map-search/index.test.ts`
- Modify: `miniprogram/components/venue-map-sheet/index.{ts,wxml,wxss}`
- Modify: `miniprogram/pages/venue-map/index.{ts,wxml,wxss}`
- Modify: `miniprogram/pages/venue-map/index.test.ts`
- Create: `miniprogram/presentation/venue-map-state.ts`
- Create: `miniprogram/presentation/venue-map-state.test.ts`
- Modify: `miniprogram/presentation/venue-map-search.ts`
- Modify: `miniprogram/presentation/venue-map-search.test.ts`

- [ ] **Step 1: Write failing pure request-state tests**

In `miniprogram/presentation/venue-map-state.test.ts`, specify pure edit snapshots, request generations, and commit/cancel/clear transitions:

- typing changes only `draftQuery` and suggestions;
- a generation guard drops an older result after a newer query, cancel, clear, or unload;
- choosing platform venue clears draft and preserves center/distance basis;
- choosing POI clears draft, disables location active, removes old POI marker, and commits the new POI;
- successful location clears POI name/marker and commits user center;
- keyboard search without selection keeps suggestions and displays “请选择具体球场或地图地点”；
- clearing committed POI returns to `CITY`, while clearing an uncommitted draft preserves the prior center;
- cancel restores the exact pre-edit center, filters, selection, viewport, and sheet snapshot.

- [ ] **Step 2: Run the pure state test and verify it fails**

Run: `npx jest miniprogram/presentation/venue-map-state.test.ts --runInBand`

Expected: FAIL because the state module does not exist.

- [ ] **Step 3: Implement the minimal pure request-state module**

Move edit-snapshot creation/restoration, monotonically increasing request-generation decisions, and committed center transitions into `venue-map-state.ts`. Keep it independent of `wx`, timers, components, and data-source registries.

- [ ] **Step 4: Run the pure state test and verify it passes**

Run the Step 2 command.

Expected: PASS.

- [ ] **Step 5: Write failing component/page orchestration tests**

Cover:

- a 250 ms debounce issues one request after two characters;
- the component emits draft/selection intents but never owns committed center;
- the page delegates snapshots, request generations, and center transitions to `venue-map-state.ts`;
- Tencent loading/empty/error does not hide local platform matches or directory rows;
- decoded directory order is preserved in `CITY`, while user/POI centers are distance sorted;
- no storage/logger/platform transport receives query text, POI payloads, or user coordinates during any transition.

- [ ] **Step 6: Run page/search tests and verify they fail**

Run:

```bash
npx jest miniprogram/components/venue-map-search/index.test.ts \
  miniprogram/pages/venue-map/index.test.ts \
  miniprogram/presentation/venue-map-state.test.ts \
  miniprogram/presentation/venue-map-search.test.ts --runInBand
```

Expected: FAIL on real capability and transition assertions.

- [ ] **Step 7: Implement debounced suggestion orchestration**

Keep draft state and the 250 ms timer in the search component. The page calls the registered capability and applies generation decisions from the pure state module; unload, cancel, clear, and newer queries invalidate older responses.

- [ ] **Step 8: Implement committed transitions in the page**

Keep the committed center in the page, but derive transition results and snapshot restoration through `venue-map-state.ts`. `presentVenueSearch` remains the only filter/sort/title/distance authority. Platform selection changes focus only; POI selection and successful location replace the committed center exactly as specified.

- [ ] **Step 9: Add the real district and online filters**

Build district options from decoded `districtCode/districtName`, sorted by code. Use the approved vertical sheet controls; never parse `address`. If the selected venue is filtered out, clear it and recompute collection viewport without auto-selecting the first row. Zero results preserve center/filter state and expose “清除筛选”。

- [ ] **Step 10: Run page/search tests and verify they pass**

Run the Step 6 command.

Expected: PASS.

- [ ] **Step 11: Commit real state integration**

```bash
git add miniprogram/components/venue-map-search \
  miniprogram/components/venue-map-sheet \
  miniprogram/pages/venue-map \
  miniprogram/presentation/venue-map-state.ts \
  miniprogram/presentation/venue-map-state.test.ts \
  miniprogram/presentation/venue-map-search.ts \
  miniprogram/presentation/venue-map-search.test.ts
git commit -m "feat: integrate venue map search states"
```

### Task 8: Make 50+ markers and online actions operational

**Files:**
- Modify: `miniprogram/presentation/venue-map.ts`
- Modify: `miniprogram/presentation/venue-map.test.ts`
- Modify: `miniprogram/pages/venue-map/index.ts`
- Modify: `miniprogram/pages/venue-map/index.test.ts`
- Modify: `miniprogram/pages/availability/index.ts`
- Modify: `miniprogram/pages/availability/index.test.ts`
- Modify: `miniprogram/pages/order-detail/index.test.ts`
- Modify: `miniprogram/presentation/venue.ts`
- Modify: `miniprogram/presentation/venue.test.ts`
- Create: `scripts/generate_venue_density_manifest.py`
- Create: `backend/tests/test_generate_venue_density_manifest.py`
- Create: `docs/acceptance/map-venue-density-benchmark.md`
- Create: `docs/acceptance/evidence/map-density-50-ios.md`
- Create: `docs/acceptance/evidence/map-density-100-ios.md`

- [ ] **Step 1: Write failing stable-marker and clustering tests**

Require stable marker IDs independent of list index, `joinCluster:true` only for venue markers, and `joinCluster:false` for user/POI center markers. At 30 or more visible venues, page initialization must call:

```ts
mapContext.initMarkerCluster({
  enableDefaultStyle: true,
  zoomOnClick: true,
  gridSize: 60,
});
```

Marker taps resolve through an explicit `markerVenueIdByRuntimeId` map; cluster/user/POI marker IDs never select a venue.

- [ ] **Step 2: Run marker tests and verify they fail**

Run: `npx jest miniprogram/pages/venue-map/index.test.ts miniprogram/presentation/venue-map.test.ts --runInBand`

Expected: FAIL because markers currently use array indexes and no density policy.

- [ ] **Step 3: Implement stable IDs and the density policy**

Initialize clustering after the map context exists, not from `bindupdated` health inference. Recompute venue markers without changing stable IDs when filters/selection change. Cluster labels express counts only; online status remains visible after cluster expansion and in list rows.

- [ ] **Step 4: Run marker tests and verify they pass**

Run the Step 2 command.

Expected: PASS.

- [ ] **Step 5: Write failing multi-online availability entry tests**

Map online arrows must open `/pages/availability/index?venueId=<id>`. When `query.venueId` exists, availability load must fetch the selected online venue detail through `VenueDirectoryDataSource`, derive its first pitch type and availability start date, then request availability for that same venue. Directory IDs remain rejected. When `query.venueId` is absent, preserve the current primary-venue fallback through `getPageDataSource().getVenue()` so the existing order-detail “重新选场次” route remains valid.

Extend `miniprogram/pages/order-detail/index.test.ts` to keep asserting that `onReselectSlot` navigates to `/pages/availability/index` and that this no-query path loads the primary venue successfully.

Add/export a client-owned `venuePitchTypeLabel` mapping in `miniprogram/presentation/venue.ts` with the exact total mapping `FIVE_A_SIDE → 五人制`, `SEVEN_A_SIDE → 七人制`, and `ELEVEN_A_SIDE → 十一人制`; reuse it instead of duplicating nested conditionals. For the explicit venue-directory path, assert decoded enum values become labeled filter options through this mapping, the first supported booking type is initially selected, and switching pitch type reloads availability for the same queried venue ID rather than the primary venue. Because the current availability contract supports only `FIVE_A_SIDE | SEVEN_A_SIDE`, an `ONLINE` detail exposing only `ELEVEN_A_SIDE` must fail as `VENUE_HAS_NO_BOOKABLE_PITCH_TYPES` rather than issue an invalid availability request.

- [ ] **Step 6: Run availability tests and verify they fail**

Run:

```bash
npx jest miniprogram/pages/availability/index.test.ts \
  miniprogram/pages/order-detail/index.test.ts \
  miniprogram/presentation/venue.test.ts \
  miniprogram/pages/venue-map/index.test.ts --runInBand
```

Expected: FAIL because availability currently defaults through the primary venue data source and map actions open detail for both modes.

- [ ] **Step 7: Implement venue-specific availability navigation**

Do not duplicate venue-detail decoding. For the explicit map query, reuse `getVenueDirectoryDataSource().getVenueDetail(venueId)` and require `bookingMode === "ONLINE"` before loading slots. For an absent venue query, retain `getPageDataSource().getVenue()` exactly as the primary fallback. Keep directory action routed to venue detail.

- [ ] **Step 8: Run availability tests and verify they pass**

Run the Step 6 command.

Expected: PASS.

- [ ] **Step 9: Write a failing density-manifest generator test**

Create a test-only generator that reads `deploy/venue-directory.json` and writes a valid local manifest with exactly 50 or 100 unique UUIDs, deterministic GCJ-02 coordinates around Tianjin, preserved structured districts, both booking modes, and no production-source mutation. Reject counts other than 50 or 100 and refuse non-`/tmp` output by default.

Run:

```bash
.venv/bin/pytest -q backend/tests/test_generate_venue_density_manifest.py
```

Expected: FAIL because the script does not exist.

- [ ] **Step 10: Implement and verify the density-manifest generator**

Implement `scripts/generate_venue_density_manifest.py --count {50,100} --output /tmp/<name>.json`. Reuse loader/schema validation functions where possible and emit a manifest that passes the existing production schema unchanged. Its `/tmp` location and command provenance identify it as acceptance-only; do not add test-only fields to the contract.

Run the Step 9 command.

Expected: PASS and byte-identical output on two runs with the same count.

- [ ] **Step 11: Start the isolated local acceptance stack**

Run:

```bash
docker compose -f deploy/compose.test.yaml up -d --wait
DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test \
  .venv/bin/alembic upgrade head
APP_ENV=development DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test \
  .venv/bin/python -m scripts.seed_demo --anchor-date today --days 31
.venv/bin/python scripts/generate_venue_density_manifest.py \
  --count 50 --output /tmp/pitch-booking-density-50.json
.venv/bin/python scripts/generate_venue_density_manifest.py \
  --count 100 --output /tmp/pitch-booking-density-100.json
```

Start FastAPI in the same shell before loading either density manifest, retaining its task-specific PID for cleanup:

```bash
export PITCH_DENSITY_DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test
APP_ENV=development WECHAT_PROVIDER=development \
DATABASE_URL="$PITCH_DENSITY_DATABASE_URL" \
PHONE_ENCRYPTION_KEY_BASE64=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= \
PHONE_ENCRYPTION_KEY_VERSION=1 \
  .venv/bin/uvicorn backend.app.main:app --host 127.0.0.1 --port 8000 \
  >/tmp/pitch-booking-density-api.log 2>&1 &
PITCH_DENSITY_API_PID=$!
```

Load the 50-entry manifest into the isolated `pitch_test` database:

```bash
DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test \
  .venv/bin/python scripts/load_venue_directory.py \
  --manifest /tmp/pitch-booking-density-50.json --environment development
```

Build with:

```bash
MINIPROGRAM_DEV_BOOKING_SOURCE=http \
MINIPROGRAM_API_BASE_URL=http://127.0.0.1:8000 \
MINIPROGRAM_TENCENT_MAP_KEY="$PITCH_TENCENT_MAP_KEY" \
  npm run build:miniprogram:development
```

Verify the 50-entry API count before capture:

```bash
curl --fail --silent --show-error http://127.0.0.1:8000/api/v1/venues/map | \
  .venv/bin/python -c 'import json,sys; p=json.load(sys.stdin); assert len(p["venues"]) == 50; assert len({v["id"] for v in p["venues"]}) == 50'
```

Expected: the count/uniqueness assertion passes for exactly 50 entries, in manifest-authoritative API order.

- [ ] **Step 12: Execute the 50/100 venue density benchmark**

Using the generated manifest (not a runtime Fixture file), capture the 50-entry DevTools and iOS physical-device run first. Perform one full list scroll, 20 marker/list mutual selections, and all three sheet transitions, recording raw results in `docs/acceptance/evidence/map-density-50-ios.md`.

Then load and verify 100 without restarting the API:

```bash
DATABASE_URL="$PITCH_DENSITY_DATABASE_URL" \
  .venv/bin/python scripts/load_venue_directory.py \
  --manifest /tmp/pitch-booking-density-100.json --environment development
curl --fail --silent --show-error http://127.0.0.1:8000/api/v1/venues/map | \
  .venv/bin/python -c 'import json,sys; p=json.load(sys.stdin); assert len(p["venues"]) == 100; assert len({v["id"] for v in p["venues"]}) == 100'
```

Capture the identical DevTools/iOS matrix for 100 entries in `docs/acceptance/evidence/map-density-100-ios.md`. Summarize device, OS, WeChat, base library, DevTools, build commit, API row count, visible marker count, clustering behavior, wrong-selection count, errors, and every measured input response over 200 ms in `docs/acceptance/map-venue-density-benchmark.md`.

Expected in both evidence files: API/list counts exactly match 50 or 100, 20/20 marker↔row selections resolve to the same venue ID, all three snap transitions complete, zero errors, and no attributable input response exceeds 200 ms. If the threshold fails, adjust `gridSize`/density policy and repeat this step; do not waive the gate.

After both evidence runs, stop the managed density API before leaving this task:

```bash
kill "$PITCH_DENSITY_API_PID"
wait "$PITCH_DENSITY_API_PID" || true
```

Expected: port 8000 is free, so Task 9 can start the canonical-data API without collision.

- [ ] **Step 13: Commit marker/action scalability**

```bash
git add miniprogram/presentation/venue-map.ts \
  miniprogram/presentation/venue-map.test.ts \
  miniprogram/pages/venue-map/index.ts \
  miniprogram/pages/venue-map/index.test.ts \
  miniprogram/pages/availability/index.ts \
  miniprogram/pages/availability/index.test.ts \
  miniprogram/pages/order-detail/index.test.ts \
  miniprogram/presentation/venue.ts \
  miniprogram/presentation/venue.test.ts \
  scripts/generate_venue_density_manifest.py \
  backend/tests/test_generate_venue_density_manifest.py \
  docs/acceptance/map-venue-density-benchmark.md \
  docs/acceptance/evidence/map-density-50-ios.md \
  docs/acceptance/evidence/map-density-100-ios.md
git commit -m "feat: scale map markers and venue actions"
```

### Task 9: Remove preview sources and prove real HTTP/POI integration

**Files:**
- Delete: `miniprogram/dev/venue-map-preview-fixture.ts`
- Delete: `miniprogram/dev/poi-search-preview.ts`
- Delete: `miniprogram/services/venue-map-preview.ts`
- Modify: `miniprogram/dev/venue-directory-source.ts`
- Modify: `miniprogram/dev/bootstrap.ts`
- Modify: `miniprogram/pages/venue-map/index.ts`
- Modify: `miniprogram/pages/venue-map/index.test.ts`
- Modify: `tests/fixtures.test.mjs`
- Modify: `tests/build-miniprogram.test.mjs`
- Modify: `tests/development-http-build.test.mjs`
- Modify: `scripts/audit-production-package.mjs`
- Modify: `docs/acceptance/map-venue-discovery-progress.md`

- [ ] **Step 1: Write failing fixture-removal and HTTP-composition tests**

Invert the visual-phase existence assertions. Require all three temporary files, both `DEV_ONLY_*` tokens, preview registrations, and preview district sidecar access to be absent. Development HTTP composition must register real HTTP directory plus Tencent POI; fixture composition may keep the existing five canonical contract examples but cannot generate 100 venues or a fake 天津站 suggestion.

- [ ] **Step 2: Run removal/composition tests and verify they fail**

Run:

```bash
node --test tests/fixtures.test.mjs tests/build-miniprogram.test.mjs tests/development-http-build.test.mjs
npm run audit:miniprogram-package
```

Expected: FAIL while preview sources still exist.

- [ ] **Step 3: Delete preview sources and registrations**

Delete the three exact files, remove imports/registrations, and make the page consume district fields from decoded real map entries. Keep test-local factories inside test files; no executable mock business directory remains in production or development source.

- [ ] **Step 4: Run removal/composition tests and verify they pass**

Run the Step 2 command.

Expected: PASS.

- [ ] **Step 5: Start and verify the real local backend**

Run:

```bash
docker compose -f deploy/compose.test.yaml up -d --wait
DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test \
  .venv/bin/alembic upgrade head
APP_ENV=development DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test \
  .venv/bin/python -m scripts.seed_demo --anchor-date today --days 31
DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test \
  .venv/bin/python scripts/load_venue_directory.py \
  --manifest deploy/venue-directory.json --environment development
APP_ENV=development WECHAT_PROVIDER=development \
DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test \
PHONE_ENCRYPTION_KEY_BASE64=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= \
PHONE_ENCRYPTION_KEY_VERSION=1 \
  .venv/bin/uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```

Keep uvicorn in a managed terminal session. In another shell run `curl --fail --silent --show-error http://127.0.0.1:8000/api/v1/health` and assert `/api/v1/venues/map` returns the checked-in venue count with structured districts.

- [ ] **Step 6: Build the real HTTP Mini Program composition**

Run:

```bash
MINIPROGRAM_DEV_BOOKING_SOURCE=http \
MINIPROGRAM_API_BASE_URL=http://127.0.0.1:8000 \
MINIPROGRAM_TENCENT_MAP_KEY="$PITCH_TENCENT_MAP_KEY" \
npm run build:miniprogram:development
```

Expected: the build succeeds; generated config contains neither unresolved placeholders nor preview tokens. Import `dist/miniprogram-development` into DevTools.

- [ ] **Step 7: Verify directory/location/filter/actions against real HTTP**

In DevTools verify platform search, location success/denial/retry, district/online filters, sheet restoration, online availability, and directory detail. Record exact state results and screenshot names in `docs/acceptance/map-venue-discovery-progress.md`.

- [ ] **Step 8: Verify Tencent POI states and privacy boundaries**

Exercise Tencent loading/ready/empty/error and select 天津站. In DevTools Network, verify Tencent requests contain only `keyword`, `key`, and `output`, contain no location parameter, and platform API requests contain no search query or POI/location payload. Inspect storage and logs after clear/unload and record that neither retains query text or POI data.

- [ ] **Step 9: Refresh same-size real-runtime visual evidence**

Repeat Chunk 1 Task 4 for `CITY`, `USER_LOCATION`, `POI`, and longest real content at 375×812 and 390×844. Compare against the user-approved references and record any intentional integration-only difference. If layout changes materially, stop for renewed user visual approval.

- [ ] **Step 10: Run the complete automated verification suite**

Run:

```bash
npm run lint
npm run typecheck
npm test
npm run contract:validate
npm run build:miniprogram:development
MINIPROGRAM_API_BASE_URL=https://pitch-api.modelstella.com \
MINIPROGRAM_TENCENT_MAP_KEY="$PITCH_TENCENT_MAP_KEY" \
npm run build:miniprogram:production
npm run audit:miniprogram-package
.venv/bin/ruff check backend scripts
.venv/bin/mypy backend scripts
.venv/bin/pytest -q
```

Expected: all commands PASS; production package contains no preview source/token, unresolved key placeholder, search history, or simulated venue business data.

- [ ] **Step 11: Commit fixture removal and integrated evidence**

```bash
git add -A miniprogram/dev/venue-map-preview-fixture.ts \
  miniprogram/dev/poi-search-preview.ts \
  miniprogram/services/venue-map-preview.ts \
  miniprogram/dev/venue-directory-source.ts miniprogram/dev/bootstrap.ts \
  miniprogram/pages/venue-map \
  tests/fixtures.test.mjs tests/build-miniprogram.test.mjs \
  tests/development-http-build.test.mjs scripts/audit-production-package.mjs \
  artifacts/ui/reviews/map-venue-discovery-scalable \
  docs/acceptance/map-venue-discovery-progress.md
git commit -m "test: complete real scalable map integration"
```

### Task 10: Complete device/privacy acceptance and handoff

**Files:**
- Modify: `docs/acceptance/map-venue-discovery-progress.md`
- Modify: `docs/llm-wiki/wechat-miniprogram/network-auth-payment.md`
- Create: `docs/acceptance/evidence/map-device-ios.md`
- Create: `docs/acceptance/evidence/map-device-android.md`
- Verify: `docs/acceptance/evidence/tencent-poi-privacy-disclosure.png`

- [ ] **Step 1: Verify iOS physical-device behavior**

Record device/OS/WeChat/base-library/build commit in `docs/acceptance/evidence/map-device-ios.md`. Verify keyboard suggestion selection, location allow/deny/retry, current-position distances, 天津站 POI distances, 50+ vertical list, sheet/list gesture ownership, marker clustering, availability/detail actions, back-state restoration, and map fallback behavior. Each row records pass/fail and its screenshot or recording filename.

- [ ] **Step 2: Verify Android physical-device behavior**

Repeat the exact iOS matrix on Android in `docs/acceptance/evidence/map-device-android.md` and record the same metadata. Do not substitute the simulator for either device.

- [ ] **Step 3: Verify privacy and network boundaries**

Open **微信公众平台 → 设置 → 用户隐私保护指引** and confirm the live published/under-review disclosure matches Task 6 Step 16. Verify `docs/acceptance/evidence/tencent-poi-privacy-disclosure.png` shows the status without sensitive data. Inspect network traffic proving POI queries contain no user coordinate, platform APIs receive no query/POI/location data, and clearing/unloading leaves no search history in storage or logs.

- [ ] **Step 4: Record final acceptance or exact blockers**

Update the progress document with pass/fail per device, screenshots/recording identities, Tencent key restriction/domain evidence, density benchmark link, visual approval commit, and any external blocker. Do not claim release-ready if WeChat domain configuration, Tencent quota, privacy disclosure, or either device matrix is incomplete.

- [ ] **Step 5: Run final verification and commit the handoff**

Run:

```bash
npm run lint && npm run typecheck && npm test
npm run contract:validate
.venv/bin/ruff check backend scripts
.venv/bin/mypy backend scripts
.venv/bin/pytest -q
```

Expected: PASS.

```bash
git add docs/acceptance/map-venue-discovery-progress.md \
  docs/llm-wiki/wechat-miniprogram/network-auth-payment.md \
  docs/acceptance/evidence/map-device-ios.md \
  docs/acceptance/evidence/map-device-android.md \
  docs/acceptance/evidence/tencent-poi-privacy-disclosure.png
git commit -m "docs: record scalable map device acceptance"
```
