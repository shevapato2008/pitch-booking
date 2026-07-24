# Venue Browsing Native Preview Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the confirmed A「可信运动感」venue and availability preview as native WeChat Mini Program pages, backed only by development Fixture data and ready for 375px/390px DevTools review.

**Architecture:** Production page/components depend on a small `PageDataSource` interface and presentation adapters, never on Fixture modules. The development build injects Fixture registration into generated `app.js`, so every compile condition can open either real page directly; the production build keeps the ordinary app bootstrap and excludes the dev implementation and sample cover asset. Page controllers own navigation and selection state, while native components remain input/output-only.

**Tech Stack:** WeChat Mini Program WXML/WXSS/TypeScript, existing contract decoders and development Fixture packaging, Jest/Node test runner, WeChat DevTools CLI.

**Design spec:** `docs/superpowers/specs/2026-07-24-venue-browsing-native-preview-design.md`

---

## File structure

- `miniprogram/presentation/venue.ts`: convert decoded `Venue` into display-ready text, sorted tags, and cover state.
- `miniprogram/presentation/availability.ts`: derive dates, time/price labels, status labels/classes, filtered pitch groups, and single-selection transitions.
- `miniprogram/services/page-data.ts`: production-safe registration boundary used by both real pages.
- `miniprogram/dev/page-data.ts`: development-only Fixture implementation using existing loaders and decoders; unmatched date/type combinations return an explicit typed empty preview response.
- `miniprogram/dev/assets/venue-cover.png`: local preview-only cover so rendering never depends on network domains.
- `miniprogram/components/{venue-card,date-strip,pitch-filter,slot-grid}/`: reusable native, input/output-only components.
- `miniprogram/pages/venue/index.*`: compose venue content and navigate to availability.
- `miniprogram/pages/availability/index.*`: compose filters and slots; own date, pitch type, and `selectedSlotId`.
- `miniprogram/styles/tokens.wxss`: shared visual tokens represented as reusable utility classes/comments because WXSS has no portable custom-property guarantee.
- `scripts/build-miniprogram.mjs`: inject data-source registration into development `app.js` only.
- `tests/native-preview.test.mjs`: inexpensive structural checks for native routes, components, labels, and token usage.
- `scripts/validate-golden-candidate.mjs`: verify candidate path, metadata schema, commit binding, and PNG hash after capture.
- `artifacts/ui/golden/candidates/<commit>/<screen-id>/`: immutable DevTools screenshot candidates and metadata produced at acceptance time.

## Chunk 1: Data and presentation boundary

### Task 1: Add tested presentation adapters

**Files:**
- Create: `miniprogram/presentation/venue.ts`
- Create: `miniprogram/presentation/venue.test.ts`
- Create: `miniprogram/presentation/availability.ts`
- Create: `miniprogram/presentation/availability.test.ts`

- [ ] **Step 1: Write failing unit tests for venue presentation**

Cover sorting, price text preservation, facility/pitch labels, and `image-fallback` must be deterministic. Inject `coverSource` so production presentation code never imports a dev asset.

- [ ] **Step 2: Write failing unit tests for availability presentation**

Cover `EXPIRED`, `AVAILABLE`, `TEMPORARILY_LOCKED`, `BOOKED`, and `CLOSED`; cents-to-yuan formatting; time ranges; pitch-type filtering; and these transitions:

```ts
toggleSelectedSlot(null, "slot-a", "AVAILABLE") === "slot-a"
toggleSelectedSlot("slot-a", "slot-a", "AVAILABLE") === null
toggleSelectedSlot("slot-a", "slot-b", "AVAILABLE") === "slot-b"
toggleSelectedSlot("slot-a", "slot-c", "BOOKED") === "slot-a"
```

- [ ] **Step 3: Run tests and verify the new suites fail**

Run: `npm run test:unit -- --runTestsByPath miniprogram/presentation/venue.test.ts miniprogram/presentation/availability.test.ts`

Expected: FAIL because the presentation modules do not exist.

- [ ] **Step 4: Implement the minimal pure adapters**

Return plain serializable view models suitable for `Page.setData` and component properties. Keep the exact Fixture enums; map them to Chinese labels and semantic class names without mutating decoded domain objects.

- [ ] **Step 5: Run focused tests**

Run: `npm run test:unit -- --runTestsByPath miniprogram/presentation/venue.test.ts miniprogram/presentation/availability.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add miniprogram/presentation
git commit -m "feat: add venue preview presentation models"
```

### Task 2: Register a development-only Fixture data source

**Files:**
- Create: `miniprogram/services/page-data.ts`
- Create: `miniprogram/services/page-data.test.ts`
- Create: `miniprogram/dev/page-data.ts`
- Modify: `scripts/build-miniprogram.mjs`
- Modify: `tests/build-miniprogram.test.mjs`

- [ ] **Step 1: Write failing tests for registration and development route ordering**

The registry accepts one `PageDataSource`, exposes it to real pages, and returns an explicit `PAGE_DATA_SOURCE_NOT_CONFIGURED` error before registration. Every development compile condition gets registration from generated `app.js`; production `app.js` remains free of `dev/` imports and Fixture tokens.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npm run test:unit -- --runTestsByPath miniprogram/services/page-data.test.ts && node --test tests/build-miniprogram.test.mjs`

Expected: FAIL because the registry and bootstrap ordering do not exist.

- [ ] **Step 3: Implement the production-safe boundary**

`PageDataSource` exposes only:

```ts
interface PageDataSource {
  getVenue(): Promise<Venue>;
  getAvailability(venueId: string, pitchType: PitchType, date: string): Promise<Availability>;
  coverSource(venue: Venue): string;
}
```

The dev implementation loads and decodes the existing Fixture set and returns `/dev/assets/venue-cover.png` for the cover. It returns `slots-ready` only for its exact `2026-07-22/FIVE_A_SIDE` match and `slots-empty` for its exact `2026-07-23/FIVE_A_SIDE` match. For the other dates in the 14-day window or `SEVEN_A_SIDE`, it returns an explicit empty `Availability` cloned from the decoded empty Fixture with `date` and `pitchType` replaced by the requested values; it never returns mismatched ready slots. Tests cover all three branches. No file under `pages/`, `components/`, `presentation/`, or `services/` imports `dev/`.

- [ ] **Step 4: Inject the development app bootstrap**

After compiling source files, the development builder writes an `app.js` that imports `dev/page-data`, registers it through `services/page-data`, then calls `App({})`. This runs before whichever page DevTools opens, including `pages/venue/index?scenario=image-fallback` and direct availability compile conditions. Production `app.js` remains the compilation of `miniprogram/app.ts` and contains no `dev/` reference. Build tests inspect both outputs.

- [ ] **Step 5: Run focused tests and both builds**

Run:

```bash
npm run test:unit -- --runTestsByPath miniprogram/services/page-data.test.ts
node --test tests/build-miniprogram.test.mjs
npm run build:miniprogram:development
npm run build:miniprogram:production
npm run audit:miniprogram-package
```

Expected: all PASS; development output contains the generated app registration, dev data source, Fixture data, and local cover but no `dev/preview/index`; production output contains none of those development resources or references.

- [ ] **Step 6: Commit**

```bash
git add miniprogram/services/page-data.ts miniprogram/services/page-data.test.ts miniprogram/dev/page-data.ts scripts/build-miniprogram.mjs tests/build-miniprogram.test.mjs
git commit -m "feat: bootstrap native preview from dev fixtures"
```

## Chunk 2: Native UI and real-page interaction

### Task 3: Build shared native components and the venue page

**Files:**
- Create: `miniprogram/styles/tokens.wxss`
- Create: `miniprogram/components/venue-card/index.ts`
- Create: `miniprogram/components/venue-card/index.json`
- Create: `miniprogram/components/venue-card/index.wxml`
- Create: `miniprogram/components/venue-card/index.wxss`
- Create: `miniprogram/dev/assets/venue-cover.png`
- Modify: `miniprogram/app.wxss`
- Modify: `miniprogram/pages/venue/index.ts`
- Modify: `miniprogram/pages/venue/index.json`
- Modify: `miniprogram/pages/venue/index.wxml`
- Modify: `miniprogram/pages/venue/index.wxss`
- Create: `tests/native-preview.test.mjs`

- [ ] **Step 1: Write failing structural checks**

Assert the system navigation title is “球场预订”, the page registers `venue-card`, the primary CTA says “查看可订时段”, no production page imports a `dev/` path, and shared token values match the approved spec.

- [ ] **Step 2: Run the structural test and verify failure**

Run: `node --test tests/native-preview.test.mjs`

Expected: FAIL against the placeholder page.

- [ ] **Step 3: Add the local preview cover**

Create a lightweight 3:2 football-pitch illustration/photo asset under `miniprogram/dev/assets/`. Keep it under roughly 200 KB; it is preview-only and excluded from production builds.

- [ ] **Step 4: Implement shared styles and `venue-card`**

Match the A direction: white surfaces, `#F8FAFC` background, `#10243E` text, trusted blue CTA, green price highlight, three label chips, and the required fallback gradient/field-line decoration. The component receives its whole view model as properties and emits no navigation itself.

- [ ] **Step 5: Implement the real venue page controller**

Load from `getPageDataSource()`, use `scenario=image-fallback` to suppress the cover, and navigate to availability with `venueId`, initial pitch type, and initial date. Address and phone remain readable information only in this preview.

- [ ] **Step 6: Run focused verification**

Run: `node --test tests/native-preview.test.mjs && npm run typecheck && npm run build:miniprogram:development`

Expected: PASS and a compilable native venue page.

- [ ] **Step 7: Commit**

```bash
git add miniprogram/app.wxss miniprogram/styles miniprogram/components/venue-card miniprogram/pages/venue miniprogram/dev/assets tests/native-preview.test.mjs
git commit -m "feat: build native venue preview page"
```

### Task 4: Build availability controls and interactions

**Files:**
- Create: `miniprogram/components/date-strip/index.{ts,json,wxml,wxss}`
- Create: `miniprogram/components/pitch-filter/index.{ts,json,wxml,wxss}`
- Create: `miniprogram/components/slot-grid/index.{ts,json,wxml,wxss}`
- Modify: `miniprogram/pages/availability/index.ts`
- Modify: `miniprogram/pages/availability/index.json`
- Modify: `miniprogram/pages/availability/index.wxml`
- Modify: `miniprogram/pages/availability/index.wxss`
- Modify: `tests/native-preview.test.mjs`

- [ ] **Step 1: Extend failing structural checks**

Assert the three components are registered, all five Fixture status labels are present in the presentation/UI boundary, and the page title is “选择可订时段”.

- [ ] **Step 2: Run the test and verify failure**

Run: `node --test tests/native-preview.test.mjs`

Expected: FAIL against the placeholder availability page.

- [ ] **Step 3: Implement input/output-only controls**

`date-strip` emits a date string; `pitch-filter` emits a `PitchType`; `slot-grid` emits a slot id only for `AVAILABLE`. Give all interactive items at least `88rpx` height/width where applicable and visible text labels for state.

- [ ] **Step 4: Implement the availability page state**

Load parameter-matched Fixture availability for the selected date/type, render the two-column grid or an explicit empty state, keep only one `selectedSlotId`, replace/cancel selection as specified, and clear selection on date/type changes. `SELECTED` remains local styling over a domain slot whose status is still `AVAILABLE`, so the same slot continues emitting taps and can be cancelled.

- [ ] **Step 5: Run unit, structural, type, and build checks**

Run:

```bash
npm run test:unit -- --runTestsByPath miniprogram/presentation/availability.test.ts miniprogram/services/page-data.test.ts
node --test tests/native-preview.test.mjs
npm run typecheck
npm run build:miniprogram:development
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add miniprogram/components/date-strip miniprogram/components/pitch-filter miniprogram/components/slot-grid miniprogram/pages/availability tests/native-preview.test.mjs
git commit -m "feat: add native availability preview interactions"
```

## Chunk 3: DevTools artifact acceptance

### Task 5: Verify in the real WeChat runtime and capture Artifacts

**Files:**
- Modify: `artifacts/ui/screen-manifest/venue-browsing.yaml`
- Modify: `artifacts/ui/golden/README.md`
- Modify: `tests/artifacts.test.mjs`
- Create: `scripts/validate-golden-candidate.mjs`
- Create: `scripts/validate-golden-candidate.test.mjs`
- Create: `artifacts/ui/golden/candidates/<commit>/venue-home/{devtools-375-ready,devtools-390-ready,devtools-375-image-fallback}.{png,metadata.json}`
- Create: `artifacts/ui/golden/candidates/<commit>/availability/{devtools-375-ready,devtools-390-empty}.{png,metadata.json}`

- [ ] **Step 1: Extend the closed capture authority for fallback**

Add `devtools-375-image-fallback` to the `venue-home` manifest goldens and to the closed matrix with route `pages/venue/index`, scenario `venue-image-failure`, WeChat Developer Tools, and width 375. The matrix must also record that the concrete DevTools compile-condition URL is `pages/venue/index?scenario=image-fallback`; the metadata keeps the approved scenario id `venue-image-failure`. The existing metadata schema already permits that id; do not add a second scenario name. Update the Artifact protocol tests and verify them with `node --test tests/artifacts.test.mjs`.

- [ ] **Step 2: Add a focused candidate validator**

Accept one candidate metadata path. Require a regular non-symlink PNG/metadata pair under the exact commit-qualified candidate namespace, validate metadata with `metadata.schema.json`, recompute PNG SHA-256, require it to match `metadata.sha256`, and require metadata commit to match the namespace. Add tests for a valid pair, bad hash, wrong commit, invalid schema, and wrong path.

Run: `node --test scripts/validate-golden-candidate.test.mjs`

Expected: PASS.

- [ ] **Step 3: Run repository verification and create a clean generating commit**

Run:

```bash
npm test
npm run typecheck
npm run lint
npm run build:miniprogram:development
npm run build:miniprogram:production
npm run audit:miniprogram-package
```

Expected: all commands exit 0.

- [ ] **Step 4: Commit the verified implementation before capture**

```bash
git add artifacts/ui/screen-manifest/venue-browsing.yaml artifacts/ui/golden/README.md tests/artifacts.test.mjs scripts/validate-golden-candidate.mjs scripts/validate-golden-candidate.test.mjs
git commit -m "test: define native preview capture candidates"
```

Record the resulting full 40-character commit as `<commit>`; it becomes the immutable candidate namespace and metadata commit. Because the feature worktree contains unrelated preflight changes that this UI slice must preserve, create a separate clean detached capture worktree at exactly `<commit>` under a new `mktemp -d` path. In that worktree run `npm ci --offline` from the lockfile, then prove `npm run build:miniprogram:development` succeeds before opening DevTools. `node_modules/` is ignored and belongs only to that worktree, so it does not change the generating tree. Run all following build, DevTools, and capture steps there. If a machine-local ignored `project.private.config.json` is required, recreate it there without committing it. Verify `git status --porcelain --untracked-files=all` is empty immediately before capture; ignored machine-local dependencies/configuration are not part of the generating tree.

- [ ] **Step 5: Run the existing DevTools preflight**

Run: `npm run env:wechat:check -- --port <enabled-service-port>`

Expected: development build succeeds and the project opens through the installed, logged-in WeChat DevTools CLI. Do not modify the unrelated uncommitted preflight hardening files during this UI slice.

- [ ] **Step 6: Inspect 375px and 390px native rendering**

Confirm both pages compile with no WXML/WXSS/Console error; no page-level horizontal overflow; system navigation is correct; CTA navigation works; date/type changes and slot single-selection work; all five status meanings remain visible without color alone.

- [ ] **Step 7: Capture the closed matrix candidates**

Capture all five identities listed above from the clean capture worktree. For the fallback identity, open the concrete compile-condition URL `pages/venue/index?scenario=image-fallback` while recording metadata scenario `venue-image-failure`. Each `.metadata.json` contains the final PNG hash, exact route/scenario, logical width, active DPR, OS/device profile, WeChat/base-library/DevTools versions, and the clean generating commit. Write only beneath `artifacts/ui/golden/candidates/<commit>/`; do not create canonical files.

- [ ] **Step 8: Validate every captured pair**

Run the candidate validator once for each of the five `.metadata.json` paths, then run `node --test tests/artifacts.test.mjs scripts/validate-golden-candidate.test.mjs`.

Expected: every pair passes schema, namespace, commit, and SHA-256 validation; the capture matrix remains closed.

- [ ] **Step 9: Stop for user acceptance**

Show the five native candidate screenshots and the running DevTools preview from the clean capture worktree. Ask the user to accept or reject the exact candidate identities, commit, and hashes. Do not promote them to canonical and do not begin API/backend work yet.

- [ ] **Step 10: Commit candidate files after capture**

```bash
git switch -c capture/venue-preview-<short-commit>
git add artifacts/ui/golden/candidates/<commit>
git commit -m "docs: capture native venue preview candidates"
```

Cherry-pick this capture-only commit onto `feature/venue-browsing`; this preserves the unrelated dirty files in the original worktree. Promotion to `canonical/` is a later, explicit operation after the user names the accepted candidate commit and hashes.
