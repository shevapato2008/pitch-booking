# Map Venue Discovery Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents are available) or superpowers:executing-plans to implement this plan. Track every checkbox and stop at the mandatory user visual gate.

**Goal:** Make a real five-venue Tianjin map the Mini Program homepage, preserve the existing bookable venue journey, and truthfully expose four directory-only venues with verified location and nearby transit data.

**Architecture:** Extend the existing native WeChat Mini Program, FastAPI, and PostgreSQL vertical slice. Build and visually approve a 375×812 fixture-backed map experience first; then freeze the discriminated API contract, migrate and load verified directory content, enforce `ONLINE` at every booking boundary, replace the fixture with HTTP, and complete local PostgreSQL/FastAPI/WeChat DevTools acceptance. Location remains opt-in and device-only.

**Tech Stack:** Native WeChat Mini Program WXML/WXSS/TypeScript, Tencent `<map>`, Jest, Node test runner, OpenAPI 3.1, FastAPI, Pydantic, SQLAlchemy 2, Alembic, PostgreSQL, pytest, Ruff, Mypy, Docker Compose.

**Specification:** `docs/superpowers/specs/2026-07-30-map-venue-discovery-design.md`

**Delivery constraint:** Complete the locally deployable vertical slice, but leave Alibaba Cloud publication, public HTTPS, WeChat production privacy submission, iOS/Android real-device positioning evidence, and final release as the last deferred step until `modelstella.com` ICP is complete.

---

## Agent and dependency boundaries

- One agent owns a task's files through commit; no two agents edit `contracts/openapi.yaml`, `backend/app/models.py`, `miniprogram/app.json`, or the same page concurrently.
- Tasks 1–4 are sequential and end at the user visual gate. Do not begin contract or backend implementation before explicit visual approval.
- After the gate, Task 5 owns the contract. Tasks 6 and 10 may begin only after Task 5 commits; backend Tasks 6–9 remain sequential because they share models and services.
- Pure frontend Task 10 may run beside backend Tasks 6–9 after the contract freezes. Task 11 follows Task 10. Tasks 12–13 require all earlier tasks.
- Each worker runs focused tests before committing. The integrating agent runs the full gates only at the end of each chunk.

## Planned file structure

```text
artifacts/ui/references/venue-map-{ready,online,directory,focused,location-denied,error}.html
artifacts/ui/references/venue-detail-map-button.html
artifacts/ui/flows/map-venue-discovery.md
artifacts/ui/screen-manifest/map-venue-discovery.yaml
artifacts/ui/reviews/map-venue-discovery/README.md
artifacts/ui/reviews/map-venue-discovery/review-board.html
deploy/venue-directory.json
deploy/venue-directory.schema.json
scripts/load_venue_directory.py
docs/acceptance/map-venue-discovery-progress.md

miniprogram/domain/venue-directory.ts
miniprogram/presentation/venue-map.ts
miniprogram/presentation/venue-map.test.ts
miniprogram/services/venue-directory.ts
miniprogram/services/http-venue-directory.ts
miniprogram/services/http-venue-directory.test.ts
miniprogram/dev/venue-directory-source.ts
miniprogram/dev/venue-directory-scenarios.ts
miniprogram/pages/venue-map/index.{json,ts,wxml,wxss}
miniprogram/pages/venue-map/index.test.ts
miniprogram/components/venue-map-sheet/index.{json,ts,wxml,wxss}
miniprogram/components/venue-map-card/index.{json,ts,wxml,wxss}

contracts/examples/venue-map.json
contracts/examples/venue-online-detail.json
contracts/examples/venue-directory-detail.json
backend/migrations/versions/0006_map_venue_directory.py
backend/app/modules/venues/{dto,repository,service,router}.py
backend/tests/test_venue_directory_{migration,schema,loader,api}.py
backend/tests/test_venue_booking_mode_guards.py
```

## Chunk 1: Verified content, Artifact, Fixture frontend, and visual gate

### Task 1: Freeze the verified five-venue content manifest

**Files:**
- Create: `deploy/venue-directory.json`
- Create: `deploy/venue-directory.schema.json`
- Create: `docs/acceptance/map-venue-discovery-progress.md`
- Test: `tests/venue-directory-content.test.mjs`

- [ ] **Step 1: Write the failing manifest validation test**

Assert exactly five immutable UUID/slug identities, exactly one `ONLINE` venue, four `DIRECTORY_ONLY` venues, `GCJ02` on every venue/stop coordinate, Tianjin bounding-box coordinates, unique stop identities, evidence metadata, sorted/deduplicated lines, and no price, phone, inventory, or booking promise on directory venues.

Run:

```bash
node --test tests/venue-directory-content.test.mjs
```

Expected: FAIL because the versioned manifest and schema do not exist.

- [ ] **Step 2: Verify and record content**

For each venue, record the public name/address source, map marker center, navigation entrance POI, nearest verified subway station if present, and no more than three verified bus stops. Store source URL or internal evidence reference, verifier, and timestamp. Do not invent unavailable transit, hours, photos, prices, phones, or facilities; use empty arrays/null only where the accepted schema permits it.

- [ ] **Step 3: Create the schema and manifest**

Keep the partner identity stable as `渤海元丰足球场`, bind it to the existing canonical primary UUID `7e68d7d8-4b7e-4f04-a5c5-3fe263e69c6f`, and preserve the user-confirmed navigation POI `天津市渤海元丰科技有限公司-南门`. Freeze its post-migration slug and record the one-time mapping from legacy slug `test-xingyue-football-park`; do not create a second online venue. Mark the other four venues directory-only. Make the schema reject unknown properties and non-GCJ-02 entries.

- [ ] **Step 4: Run the content gate and commit**

```bash
node --test tests/venue-directory-content.test.mjs
git add deploy/venue-directory.json deploy/venue-directory.schema.json tests/venue-directory-content.test.mjs docs/acceptance/map-venue-discovery-progress.md
git commit -m "data: freeze verified Tianjin venue directory"
```

Expected: content validation PASS; the acceptance document names every evidence gap explicitly rather than filling it with mock data.

### Task 2: Produce the lightweight 375×812 map Artifact

**Files:**
- Create: `artifacts/ui/references/venue-map-ready.html`
- Create: `artifacts/ui/references/venue-map-online.html`
- Create: `artifacts/ui/references/venue-map-directory.html`
- Create: `artifacts/ui/references/venue-detail-map-button.html`
- Create: `artifacts/ui/references/venue-map-focused.html`
- Create: `artifacts/ui/references/venue-map-location-denied.html`
- Create: `artifacts/ui/references/venue-map-error.html`
- Create: `artifacts/ui/flows/map-venue-discovery.md`
- Create: `artifacts/ui/screen-manifest/map-venue-discovery.yaml`
- Create: `artifacts/ui/reviews/map-venue-discovery/README.md`
- Create: `artifacts/ui/reviews/map-venue-discovery/review-board.html`
- Modify: `artifacts/ui/README.md`
- Modify: `tests/artifacts.test.mjs`
- Modify: `tests/structure.test.mjs`

- [ ] **Step 1: Write failing artifact structure tests**

Require seven capture-ready references, a journey flow, a 375×812 screen manifest, and a browser-openable review board with named evidence slots for reference, implementation, side-by-side, overlay-50, difference, and observations for every required state.

```bash
node --test tests/artifacts.test.mjs tests/structure.test.mjs
```

Expected: FAIL because the map assets do not exist.

- [ ] **Step 2: Build the accepted Layout A references**

Use the existing design tokens and the accepted full-map + draggable bottom-sheet composition. Render distinct icon shape/label semantics for online vs directory markers, three sheet snap states, 44×44 minimum targets, safe-area padding, and these truthful states: default five-venue view, online selected, directory selected, venue-detail map button, focused deep-link, location denial, and pure-list map fallback. Inline display content must be generated from `deploy/venue-directory.json` by a small test/helper or compared field-for-field in `tests/artifacts.test.mjs`; do not introduce a new canonical contract fixture before Task 5.

- [ ] **Step 3: Document the interaction and authority flow**

Record marker/card selection, deep-link focus, explicit user-location request, refusal recovery, first-`bindupdated` 10-second watchdog, retry remount, and `DIRECTORY_ONLY` never exposing booking actions.

- [ ] **Step 4: Validate and commit**

```bash
node --test tests/artifacts.test.mjs tests/structure.test.mjs
git add artifacts/ui tests/artifacts.test.mjs tests/structure.test.mjs
git commit -m "design: add map venue discovery artifact"
```

Expected: artifact checks PASS.

### Task 3: Build pure presentation, viewport, and temporary data boundaries

**Files:**
- Create: `miniprogram/domain/venue-directory.ts`
- Create: `miniprogram/presentation/venue-map.ts`
- Create: `miniprogram/presentation/venue-map.test.ts`
- Create: `miniprogram/services/venue-directory.ts`
- Create: `miniprogram/dev/venue-directory-source.ts`
- Create: `miniprogram/dev/venue-directory-source.test.ts`
- Create: `miniprogram/dev/venue-directory-scenarios.ts`
- Create: `miniprogram/assets/map-marker-online.png`
- Create: `miniprogram/assets/map-marker-online-selected.png`
- Create: `miniprogram/assets/map-marker-directory.png`
- Create: `miniprogram/assets/map-marker-directory-selected.png`
- Modify: `miniprogram/runtime/interfaces.ts`
- Modify: `tests/fixtures.test.mjs`

- [ ] **Step 1: Write failing pure-unit tests**

Cover stable marker ordering, online/directory labels, selected marker/card synchronization, all-venue and focused viewports, invalid deep-link fallback, Haversine formatting, no-location behavior, empty transit text, and late-response generation rejection.

```bash
npx jest miniprogram/presentation/venue-map.test.ts miniprogram/dev/venue-directory-source.test.ts --runInBand
```

Expected: FAIL because the types, reducer/presentation functions, and development source are absent.

- [ ] **Step 2: Implement the minimum pure model**

Use a closed TypeScript union keyed by `bookingMode`. Keep distance calculation pure and local. Define `LocationCapability.getLocation()` and `openSetting()` in the existing runtime interface without putting coordinates into transport or storage contracts. Add four checked-in PNG marker assets with different silhouettes/labels for booking mode and selected state; presentation tests assert their local `iconPath` values and package existence.

- [ ] **Step 3: Add an isolated visual fixture source**

Define a temporary `VENUE_DIRECTORY_VISUAL_FIXTURE` inside the development-only source and compare its venue identities, names, modes, coordinates, and transit field-by-field with `deploy/venue-directory.json` in its unit test. Do not add it to `artifacts/ui/fixtures`: the existing closed fixture inventory remains canonical-contract-only until Task 5. Provide only deterministic ready, load-error, map-render-failure, location-success, privacy-denied, permission-denied, services-disabled, and timeout scenarios. Name every symbol with `fixture` or `simulated` so production audit can prove removal. Extend `tests/fixtures.test.mjs` to prove the pre-contract map visual data is not silently added to the canonical fixture inventory.

- [ ] **Step 4: Run focused gates and commit**

```bash
npx jest miniprogram/presentation/venue-map.test.ts miniprogram/dev/venue-directory-source.test.ts --runInBand
node --test tests/fixtures.test.mjs
npm run typecheck
git add miniprogram/domain/venue-directory.ts miniprogram/presentation/venue-map.ts miniprogram/presentation/venue-map.test.ts miniprogram/services/venue-directory.ts miniprogram/dev/venue-directory-source.ts miniprogram/dev/venue-directory-source.test.ts miniprogram/dev/venue-directory-scenarios.ts miniprogram/assets/map-marker-online.png miniprogram/assets/map-marker-online-selected.png miniprogram/assets/map-marker-directory.png miniprogram/assets/map-marker-directory-selected.png miniprogram/runtime/interfaces.ts tests/fixtures.test.mjs
git commit -m "feat: add map venue presentation model"
```

### Task 4: Render the fixture-backed Mini Program and stop for visual approval

**Files:**
- Create: `miniprogram/pages/venue-map/index.json`
- Create: `miniprogram/pages/venue-map/index.ts`
- Create: `miniprogram/pages/venue-map/index.wxml`
- Create: `miniprogram/pages/venue-map/index.wxss`
- Create: `miniprogram/pages/venue-map/index.test.ts`
- Create: `miniprogram/components/venue-map-sheet/index.{json,ts,wxml,wxss}`
- Create: `miniprogram/components/venue-map-card/index.{json,ts,wxml,wxss}`
- Modify: `miniprogram/pages/venue/index.{ts,wxml,wxss}`
- Create: `miniprogram/pages/venue/index.test.ts`
- Modify: `miniprogram/presentation/venue.ts`
- Modify: `miniprogram/presentation/venue.test.ts`
- Modify: `miniprogram/components/venue-card/index.{ts,wxml,wxss}`
- Modify: `miniprogram/services/page-data.ts`
- Modify: `miniprogram/services/page-data.test.ts`
- Modify: `miniprogram/app.json`
- Modify: `miniprogram/dev/app-pages.json`
- Modify: `miniprogram/dev/bootstrap.ts`
- Modify: `scripts/build-miniprogram.mjs`
- Modify: `project.config.json`
- Modify: `tests/build-miniprogram.test.mjs`
- Modify: `tests/build-booking-preview.test.mjs`
- Modify: `tests/structure.test.mjs`
- Modify: `tests/artifacts.test.mjs`
- Modify: `artifacts/ui/reviews/map-venue-discovery/README.md`
- Create: `artifacts/ui/reviews/map-venue-discovery/{default,online-selected,directory-selected,venue-detail-map-button,focused-deep-link,location-denied,map-fallback}/{reference,implementation,side-by-side,overlay-50,difference}.png`

- [ ] **Step 1: Write failing page behavior tests**

Cover first page registration without deleting existing routes, fixture directory load, marker/card selection, sheet snaps, directory CTA absence, online CTA route, arbitrary `venueId` detail loading, legacy no-ID partner fallback, discriminated online/directory detail presentation, detail-to-map deep-link, invalid ID fallback, no location call on `onLoad/onShow`, explicit location call, denial variants, 10-second first-update timeout, one timer per remount, and dead-page response rejection. Update focused build/preview/structure tests that currently freeze page ordering or preview-route inventories.

```bash
npx jest miniprogram/pages/venue-map/index.test.ts --runInBand
```

Expected: FAIL because the page and components do not exist.

- [ ] **Step 2: Implement the visible runtime Demo**

Make `pages/venue-map/index` the first page. Use `<map>` with local PNG marker assets, normal-view overlays, three sheet snap positions, horizontal venue cards, distinct marker semantics, and pure-list fallback. Register the temporary `VenueDirectoryDataSource` only in development fixture bootstrap. Change the venue page to call `getVenueDetail(venueId)` (or the partner fallback with no ID); extend `presentation/venue.ts` and `venue-card` to a closed online/directory view union so directory fields and CTAs cannot be rendered accidentally. Add “在地图中查看” to both variants and preserve back-state in page memory. Keep the existing page-data source for availability and existing booking routes. Declare `permission.scope.userLocation.desc` and `requiredPrivateInfos: ["getLocation"]`; pin `libVersion` to `3.17.0`.

- [ ] **Step 3: Build and inspect in WeChat DevTools**

```bash
npm run build:miniprogram:development
npm run typecheck
npx jest miniprogram/pages/venue-map/index.test.ts --runInBand
```

Expected: development build loads the map homepage in DevTools Stable `2.01.2510290`; opening the page does not request location.

- [ ] **Step 4: Capture mandatory same-size evidence**

At 375×812 capture exactly the seven states below. Reference capture is a manual Chrome viewport screenshot of the named local file; implementation capture is a manual WeChat DevTools simulator screenshot after loading the exact route/action. Save only the page viewport, not browser/tool chrome.

| State directory | Chrome reference | WeChat DevTools route/action |
| --- | --- | --- |
| `default` | `venue-map-ready.html` | `/pages/venue-map/index?scenario=ready` |
| `online-selected` | `venue-map-online.html` | `/pages/venue-map/index?scenario=ready&venueId=<ONLINE_UUID_FROM_MANIFEST>` |
| `directory-selected` | `venue-map-directory.html` | `/pages/venue-map/index?scenario=ready&venueId=<FIRST_DIRECTORY_UUID_FROM_MANIFEST>` |
| `venue-detail-map-button` | `venue-detail-map-button.html` | `/pages/venue/index?scenario=ready&venueId=<FIRST_DIRECTORY_UUID_FROM_MANIFEST>` |
| `focused-deep-link` | `venue-map-focused.html` | From the preceding detail page, tap “在地图中查看” |
| `location-denied` | `venue-map-location-denied.html` | `/pages/venue-map/index?scenario=permission-denied`, then tap “定位到我” |
| `map-fallback` | `venue-map-error.html` | `/pages/venue-map/index?scenario=map-render-failure`, wait 10 seconds |

The two UUID placeholders are not arbitrary input: copy the fixed identities created in Task 1 from `deploy/venue-directory.json` and record their literal values in the review README before capture. For every directory, save the Chrome screenshot as `reference.png` and DevTools screenshot as `implementation.png`, then verify both inputs:

```bash
sips -g pixelWidth -g pixelHeight artifacts/ui/reviews/map-venue-discovery/{STATE}/reference.png artifacts/ui/reviews/map-venue-discovery/{STATE}/implementation.png
```

Expected for every input: `pixelWidth: 375`, `pixelHeight: 812`. Run the following from each `{STATE}` directory using the already required local `/opt/homebrew/bin/ffmpeg`; do not add an image-processing package or resize either input:

```bash
/opt/homebrew/bin/ffmpeg -y -i reference.png -i implementation.png -filter_complex "hstack=inputs=2" side-by-side.png
/opt/homebrew/bin/ffmpeg -y -i reference.png -i implementation.png -filter_complex "blend=all_expr='0.5*A+0.5*B'" overlay-50.png
/opt/homebrew/bin/ffmpeg -y -i reference.png -i implementation.png -filter_complex "blend=all_mode=difference" difference.png
```

Expected: `side-by-side.png` is 750×812; overlay and difference are 375×812. Extend `tests/artifacts.test.mjs` to parse PNG IHDR dimensions for all 35 evidence files and verify `review-board.html` links all views. The board must display all five views per state without resizing and link the observation log. Record composition, geometry/spacing, hierarchy, type/color/material, icons, copy, state semantics, exact versions, literal routes, and interaction findings. Open the review board in Chrome for the user gate.

- [ ] **Step 5: Run the chunk gate and commit**

```bash
npm test
npm run lint
npm run typecheck
npm run build:miniprogram:development
node --test tests/artifacts.test.mjs tests/structure.test.mjs
git add miniprogram scripts/build-miniprogram.mjs project.config.json tests/build-miniprogram.test.mjs tests/build-booking-preview.test.mjs tests/structure.test.mjs tests/artifacts.test.mjs artifacts/ui/reviews/map-venue-discovery
git commit -m "feat: add fixture-backed map venue experience"
```

Expected: tests/build PASS and evidence is complete.

**MANDATORY USER GATE:** Stop. Present the reference, implementation, side-by-side, overlay, and difference views in the browser. Do not begin Task 5 until the user explicitly confirms the implemented frontend visual result.

## Chunk 2: Contract, PostgreSQL directory, and backend authority

### Task 5: Freeze the map and discriminated venue-detail contract

**Files:**
- Modify: `contracts/openapi.yaml`
- Create: `contracts/examples/venue-map.json`
- Create: `contracts/examples/venue-online-detail.json`
- Create: `contracts/examples/venue-directory-detail.json`
- Modify: `tests/contract.test.mjs`
- Modify: `backend/tests/test_openapi_conformance.py`

- [ ] **Step 1: Add failing contract tests**

Assert `/venues/primary` remains golden-compatible, `/venues/map` is strict and stably ordered, and `/venues/{venue_id}` is a closed `oneOf` discriminated by `booking_mode`. Require the exact online fields and required-nullable/required-array directory fields from the spec; reject directory price, inventory, phone, refunds, and availability. Freeze `404 VENUE_NOT_FOUND` on availability, slot checkout, `POST /orders`, and `POST /orders/{order_id}/pay`; distinguish it from the existing unknown-order/payment 404 descriptions without exposing inventory state. Order detail remains readable from its historical snapshot and does not gain a booking-mode rejection.

```bash
npm run contract:validate
node --test tests/contract.test.mjs
.venv/bin/python -m pytest backend/tests/test_openapi_conformance.py -q
```

Expected: FAIL for missing map/detail paths and examples.

- [ ] **Step 2: Add paths, schemas, examples, and errors**

Register literal `/primary` and `/map` semantics before UUID detail. Define `404 VENUE_NOT_FOUND` and `500 VENUE_DIRECTORY_MISCONFIGURED`, and update the four existing booking operation response matrices/examples named above before their implementation changes. The API accepts no user coordinates.

- [ ] **Step 3: Validate and commit**

```bash
npm run contract:validate
node --test tests/contract.test.mjs
.venv/bin/python -m pytest backend/tests/test_openapi_conformance.py -q
git add contracts tests/contract.test.mjs backend/tests/test_openapi_conformance.py
git commit -m "contract: add map venue directory API"
```

### Task 6: Migrate venue identity and transit persistence safely

**Files:**
- Create: `backend/migrations/versions/0006_map_venue_directory.py`
- Modify: `backend/app/models.py`
- Modify: `scripts/seed_demo.py`
- Create: `backend/tests/test_venue_directory_migration.py`
- Create: `backend/tests/test_venue_directory_schema.py`
- Modify: `backend/tests/test_seed_demo.py`

- [ ] **Step 1: Write failing PostgreSQL migration/schema tests**

Cover legacy primary with pitch/slot/order/payment, mapped inactive legacy venue, unmapped legacy venue atomic failure, conditional online columns, `is_primary => ONLINE`, transit uniqueness/ranges, directory-loaded downgrade refusal before DDL, explicit unload then downgrade, and upgrade again. Assert that the manifest's sole online partner is the existing canonical primary UUID `7e68d7d8-4b7e-4f04-a5c5-3fe263e69c6f`; migration recognizes the exact legacy `(UUID, slug)` pair including `test-xingyue-football-park`, maps it once to the manifest's frozen partner slug, and never creates a second online/primary venue or rewrites inventory/order foreign keys.

```bash
.venv/bin/python -m pytest backend/tests/test_venue_directory_migration.py backend/tests/test_venue_directory_schema.py backend/tests/test_seed_demo.py -q
```

Expected: FAIL because revision `0006` and new columns/tables do not exist.

- [ ] **Step 2: Implement staged migration and explicit seed fields**

Add nullable columns and migration-only defaults, backfill by fixed UUID/slug mapping, validate history, then add final checks and remove defaults. Add `venue_transit_stops`. Refuse unsafe downgrade before schema mutation. The downgrade error must name the guarded unload command from Task 7; it may proceed only when no directory-only rows remain and all online rows satisfy the old schema.

- [ ] **Step 3: Run focused backend gates and commit**

```bash
.venv/bin/python -m pytest backend/tests/test_venue_directory_migration.py backend/tests/test_venue_directory_schema.py backend/tests/test_seed_demo.py -q
.venv/bin/ruff check backend
.venv/bin/mypy backend
git add backend/migrations/versions/0006_map_venue_directory.py backend/app/models.py scripts/seed_demo.py backend/tests/test_venue_directory_migration.py backend/tests/test_venue_directory_schema.py backend/tests/test_seed_demo.py
git commit -m "feat: persist map venue directory"
```

### Task 7: Add transactional, idempotent content loading

**Files:**
- Create: `scripts/load_venue_directory.py`
- Create: `backend/app/modules/venues/loader.py`
- Create: `backend/tests/test_venue_directory_loader.py`
- Create: `deploy/venue-directory.approval.example.json`
- Modify: `pyproject.toml`
- Modify: `uv.lock`
- Modify: `docs/acceptance/map-venue-discovery-progress.md`

- [ ] **Step 1: Write failing loader tests**

Cover dry-run, first load, identical reload, update, missing-entry unlisting, restoration with stable identity, UUID/slug collision, schema/evidence/coordinate failure, forbidden online-to-directory transition with history, canonical online UUID/legacy-slug binding, second-online rejection, directory pitch rejection, and all-or-nothing rollback. Add guarded `--unload-directory` tests: dry-run, deletion of transit plus history-free directory rows only, refusal when any pitch/slot/order/payment relation exists, preservation of the canonical online venue, and transaction rollback on any refusal. For production approval, test missing, malformed, wrong-environment, wrong-manifest-digest, wrong-app-revision, not-yet-valid, expired, and valid approvals; every invalid case performs zero writes.

```bash
.venv/bin/python -m pytest backend/tests/test_venue_directory_loader.py -q
```

Expected: FAIL because the loader is absent.

- [ ] **Step 2: Implement one-transaction validation and diff application**

Add `jsonschema` as a pinned project dependency through `pyproject.toml`/`uv.lock` and validate the complete `deploy/venue-directory.schema.json` before semantic checks or database access. Validate the entire manifest and business graph before writes. Normal load may create/update content and set `is_listed=false`; it may not delete or rewrite business identity, inventory, orders, or payments. The separate `--unload-directory` mode may delete only `DIRECTORY_ONLY` rows with no business history, with transit removed by cascade; it never deletes/unlists the canonical online partner.

Production invocation is explicit:

```bash
.venv/bin/python scripts/load_venue_directory.py --manifest deploy/venue-directory.json --environment production --app-revision <REVISION> --approval-file <PATH>
```

The approval JSON binds the SHA-256 of the exact manifest bytes, literal environment `production`, exact app revision, `approved_at`, and `expires_at`; the validity window may not exceed 24 hours and the injected UTC clock must be inside it. Development uses `--environment development` without approval. No generic environment default may silently select production.

- [ ] **Step 3: Test a real local load and commit**

```bash
.venv/bin/python -m pytest backend/tests/test_venue_directory_loader.py -q
.venv/bin/python scripts/load_venue_directory.py --manifest deploy/venue-directory.json --dry-run
git add scripts/load_venue_directory.py backend/app/modules/venues/loader.py backend/tests/test_venue_directory_loader.py deploy/venue-directory.approval.example.json pyproject.toml uv.lock docs/acceptance/map-venue-discovery-progress.md
git commit -m "feat: load verified venue directory"
```

### Task 8: Implement map directory and venue detail APIs

**Files:**
- Modify: `backend/app/modules/venues/dto.py`
- Modify: `backend/app/modules/venues/repository.py`
- Modify: `backend/app/modules/venues/service.py`
- Modify: `backend/app/modules/venues/router.py`
- Create: `backend/tests/test_venue_directory_api.py`
- Modify: `backend/tests/test_primary_venue.py`

- [ ] **Step 1: Write failing service/router tests**

Cover stable public ordering, inactive/unlisted exclusion, online and directory detail shapes, unknown UUID, empty directory misconfiguration, invalid primary mode, `/primary` golden compatibility, and literal route precedence.

```bash
.venv/bin/python -m pytest backend/tests/test_venue_directory_api.py backend/tests/test_primary_venue.py -q
```

Expected: FAIL because the map/detail behavior is absent.

- [ ] **Step 2: Implement strict DTOs and public predicate**

Use `is_active AND is_listed` for map/detail, retain original active-primary lookup plus `ONLINE` for `/primary`, return no internal source metadata, and calculate no user-relative values server-side.

- [ ] **Step 3: Run contract/API gates and commit**

```bash
.venv/bin/python -m pytest backend/tests/test_venue_directory_api.py backend/tests/test_primary_venue.py backend/tests/test_openapi_conformance.py -q
npm run contract:validate
git add backend/app/modules/venues backend/tests/test_venue_directory_api.py backend/tests/test_primary_venue.py
git commit -m "feat: serve map venue directory"
```

### Task 9: Enforce `ONLINE` through every booking boundary

**Files:**
- Modify: `backend/app/modules/availability/{repository,service}.py`
- Modify: `backend/app/modules/checkout/{repository,service}.py`
- Modify: `backend/app/modules/orders/{repository,service}.py`
- Modify: `backend/app/modules/payments/{repository,service}.py`
- Create: `backend/tests/test_venue_booking_mode_guards.py`

- [ ] **Step 1: Write failing defense-in-depth tests**

Test direct directory venue availability plus deliberately inconsistent `DIRECTORY_ONLY venue → pitch → slot → order → payment` graphs in isolated rollback transactions. Availability, checkout, create-order, and create-payment must return non-disclosing `404 VENUE_NOT_FOUND`; existing online journeys remain green. For checkout/order/payment, snapshot rows and mock provider calls before the request, then assert no idempotency claim is created/advanced, no slot hold/expiry/state is changed, no order/payment row is created or changed, no commit-visible mutation occurs, and the payment provider is never invoked. Existing order detail and already-created historical order reconciliation remain readable/operable according to snapshot semantics.

```bash
.venv/bin/python -m pytest backend/tests/test_venue_booking_mode_guards.py backend/tests/test_booking_local_journey.py backend/tests/test_payment_local_journey.py -q
```

Expected: at least one downstream entry point lacks the mode guard.

- [ ] **Step 2: Add the smallest service/repository guards**

Check the related venue mode before any idempotency claim, expiry processing, slot/order mutation, commit, or provider call when returning availability, issuing checkout, creating an order, or creating a payment. Do not add the mode guard to order-detail reads or historical reconciliation, and do not alter confirmed order snapshot semantics.

- [ ] **Step 3: Run Chunk 2 gates and commit**

```bash
.venv/bin/python -m pytest backend/tests -q
.venv/bin/ruff check backend
.venv/bin/mypy backend
npm run contract:validate
git add backend/app/modules backend/tests/test_venue_booking_mode_guards.py
git commit -m "fix: enforce online venue booking boundary"
```

## Chunk 3: HTTP integration, privacy behavior, Fixture removal, and local acceptance

### Task 10: Add strict frontend decoders and HTTP venue source

**Files:**
- Modify: `miniprogram/domain/decoders.ts`
- Modify: `miniprogram/domain/decoders.test.ts`
- Create: `miniprogram/services/http-venue-directory.ts`
- Create: `miniprogram/services/http-venue-directory.test.ts`
- Modify: `miniprogram/runtime/production.ts`
- Modify: `miniprogram/runtime/production.test.ts`
- Modify: `miniprogram/dev/http-booking-source.ts`
- Modify: `miniprogram/dev/http-booking-source.test.ts`
- Modify: `miniprogram/dev/bootstrap.ts`
- Modify: `scripts/build-miniprogram.mjs`
- Modify: `tests/development-http-build.test.mjs`
- Modify: `tests/audit-production-package.test.mjs`

- [ ] **Step 1: Write failing contract decoder/source tests**

Use the contract examples to cover both discriminated detail variants, null cover, empty transit, strict unknown-field/type rejection, map error mapping, detail 404, stable endpoint paths, and the generated composition roots. Assert production `app.js` and development-HTTP `app.js` register `createHttpVenueDirectoryDataSource`; the default development booking-fixture build must not import/register that HTTP source and remains isolated for old preview routes.

```bash
npx jest miniprogram/domain/decoders.test.ts miniprogram/services/http-venue-directory.test.ts miniprogram/runtime/production.test.ts --runInBand
```

Expected: FAIL because the map/detail decoders and source do not exist.

- [ ] **Step 2: Implement strict decoding and HTTP composition**

Do not coerce invalid coordinates, modes, arrays, or nullable fields. Keep user location out of URLs, headers, request bodies, caches, and logs. Extend `createDevelopmentHttpSources()` and `bootstrapDevelopment({source: "http"})` with the venue source; extend `writeProductionAppBootstrap()` with the same source. Do not register the temporary visual source outside development fixture composition.

- [ ] **Step 3: Run focused gates and commit**

```bash
npx jest miniprogram/domain/decoders.test.ts miniprogram/services/http-venue-directory.test.ts miniprogram/runtime/production.test.ts --runInBand
npm run typecheck
git add miniprogram/domain/decoders.ts miniprogram/domain/decoders.test.ts miniprogram/services/http-venue-directory.ts miniprogram/services/http-venue-directory.test.ts miniprogram/runtime/production.ts miniprogram/runtime/production.test.ts miniprogram/dev/http-booking-source.ts miniprogram/dev/http-booking-source.test.ts miniprogram/dev/bootstrap.ts scripts/build-miniprogram.mjs tests/development-http-build.test.mjs tests/audit-production-package.test.mjs
git commit -m "feat: integrate venue directory HTTP source"
```

### Task 11: Complete location, map recovery, and deep-link runtime behavior

**Files:**
- Modify: `miniprogram/runtime/interfaces.ts`
- Modify: `miniprogram/runtime/production.ts`
- Create: `miniprogram/services/location.ts`
- Create: `miniprogram/services/location.test.ts`
- Modify: `miniprogram/pages/venue-map/index.{ts,wxml,wxss}`
- Modify: `miniprogram/pages/venue-map/index.test.ts`
- Modify: `miniprogram/pages/venue/index.{ts,wxml,wxss}`
- Modify: `miniprogram/app.json`
- Modify: `miniprogram/dev/bootstrap.ts`
- Modify: `scripts/build-miniprogram.mjs`
- Modify: `tests/development-http-build.test.mjs`
- Modify: `tests/audit-production-package.test.mjs`

- [ ] **Step 1: Extend failing page/runtime tests**

Distinguish privacy refusal, scope refusal, system services off, timeout, and other error. Assert only scope refusal exposes `openSetting`; returning from settings never auto-locates. Assert success alone enables `show-location`; retry remount increments the map key and owns exactly one watchdog. Use transport, storage, logger, and lifecycle spies to prove successful coordinates are used only by page distance/viewport calculation and never enter request URL/body/header, session/local storage, log calls, cached module state, or a newly mounted page. Repeat the zero-leak assertions after failure, unload, and return from settings. Parse `app.json` and assert the exact purpose text `在地图中显示你的位置并估算你与球场的距离` plus `requiredPrivateInfos: ["getLocation"]`. Generated-graph tests must prove production and development-HTTP `app.js` call `registerLocationCapability(productionLocation)`, while the fixture graph registers only the explicit simulation and production never imports it.

- [ ] **Step 2: Implement native capability mapping and page lifecycle guards**

Create a narrow registered `LocationCapability`; production wraps `wx.getLocation({type: "gcj02"})` and `wx.openSetting`. Wire `registerLocationCapability(productionLocation)` into `writeProductionAppBootstrap()` and the development-HTTP branch of `bootstrapDevelopment`; wire the simulation only into the fixture branch. Call location only from the explicit button. Clear coordinates on failure/unload, drop responses after unload/request-generation change, and restore only map selection/sheet position—not user coordinates—when returning from detail.

- [ ] **Step 3: Verify and commit**

```bash
npx jest miniprogram/pages/venue-map/index.test.ts miniprogram/runtime/production.test.ts miniprogram/services/location.test.ts --runInBand
npm run typecheck
git add miniprogram/runtime miniprogram/services/location.ts miniprogram/services/location.test.ts miniprogram/pages/venue-map miniprogram/pages/venue miniprogram/app.json miniprogram/dev/bootstrap.ts scripts/build-miniprogram.mjs tests/development-http-build.test.mjs tests/audit-production-package.test.mjs
git commit -m "feat: complete venue map runtime behavior"
```

### Task 12: Remove map business Fixtures and prove clean dependency graphs

**Files:**
- Delete: `miniprogram/dev/venue-directory-source.ts`
- Delete: `miniprogram/dev/venue-directory-source.test.ts`
- Delete: `miniprogram/dev/venue-directory-scenarios.ts`
- Modify: `miniprogram/dev/bootstrap.ts`
- Modify: `scripts/build-miniprogram.mjs`
- Modify: `scripts/audit-production-package.mjs`
- Modify: `tests/build-miniprogram.test.mjs`
- Modify: `tests/development-http-build.test.mjs`
- Modify: `tests/audit-production-package.test.mjs`
- Modify: `tests/production-package-booking-audit.test.mjs`

- [ ] **Step 1: Write failing development-HTTP and production audit tests**

Scan both compiled dependency graphs for map fixture imports, known fixture UUIDs, test coordinates, fixture bootstrap symbols, simulated-location symbols, and development map-failure bindings. The already captured artifact-only `map-render-failure` evidence may remain under `artifacts/ui`; its scenario/controller must be absent from both compiled runtime graphs.

```bash
node --test tests/build-miniprogram.test.mjs tests/development-http-build.test.mjs tests/audit-production-package.test.mjs tests/production-package-booking-audit.test.mjs
```

Expected: FAIL while runtime fixture registrations remain.

- [ ] **Step 2: Remove map fixtures while preserving isolated legacy previews**

Register the venue HTTP source in production and development-HTTP only. Preserve unrelated booking/payment test fixtures and their default development composition. Remove only the map fixture registration; when the default fixture build opens the new map homepage it must show the honest configured-source/load error rather than fake venues. The accepted map visual scenarios remain only as static Artifact references/evidence, never executable code in either build. Do not delete Artifact inputs or captured visual evidence.

- [ ] **Step 3: Build, audit, and commit**

```bash
npm run build:miniprogram:development
npm run build:miniprogram:production
npm run audit:miniprogram-package
node --test tests/build-miniprogram.test.mjs tests/development-http-build.test.mjs tests/audit-production-package.test.mjs tests/production-package-booking-audit.test.mjs
git add -A miniprogram/dev scripts tests
git commit -m "chore: remove map venue runtime fixtures"
```

### Task 13: Run the real local journey and record the deferred boundary

**Files:**
- Modify: `docs/acceptance/map-venue-discovery-progress.md`
- Modify: `artifacts/ui/reviews/map-venue-discovery/README.md`
- Modify: `deploy/README.md`
- Modify: `backend/Dockerfile`
- Modify: `backend/tests/test_deploy_preflight.py`
- Test: existing project suites

- [ ] **Step 1: Start the real local stack and load five venues**

Package only `deploy/venue-directory.json` and `deploy/venue-directory.schema.json` into `/app/deploy/` in the API image; do not copy `.env` or approval files. Extend the deploy-image/preflight test to assert both files are copied explicitly and match the checked-in hashes. For the real local journey use the test PostgreSQL port and a host FastAPI process so DevTools can reach it:

```bash
docker compose -f deploy/compose.test.yaml up -d --wait
DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test \
  .venv/bin/alembic upgrade head
APP_ENV=development DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test \
  .venv/bin/python -m scripts.seed_demo --anchor-date today --days 31
DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test \
  .venv/bin/python scripts/load_venue_directory.py --manifest deploy/venue-directory.json --environment development
APP_ENV=development WECHAT_PROVIDER=development \
DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test \
PHONE_ENCRYPTION_KEY_BASE64=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= \
PHONE_ENCRYPTION_KEY_VERSION=1 \
  .venv/bin/uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```

Run uvicorn in a managed terminal session. In another shell verify and build the actual HTTP composition:

```bash
curl --fail --silent --show-error http://127.0.0.1:8000/api/v1/health
MINIPROGRAM_DEV_BOOKING_SOURCE=http MINIPROGRAM_API_BASE_URL=http://127.0.0.1:8000 \
  npm run build:miniprogram:development
```

Record only non-secret commands, versions, row counts, and results.

- [ ] **Step 2: Exercise the real HTTP/PostgreSQL journey in DevTools**

Import `dist/miniprogram-development` and verify five markers/cards, both booking modes, all five details, detail-to-map focus, partner availability route, no directory booking CTA, explicit location success/failures, and state restoration. Verify map fallback/remount through the deterministic unit/lifecycle test after fixture removal; do not reintroduce a runtime failure hook. Query PostgreSQL to prove directory venues have zero pitches, slots, orders, and payments:

```bash
docker compose -f deploy/compose.test.yaml exec -T postgres psql -U pitch -d pitch_test -c \
  "SELECT v.id, count(DISTINCT p.id) pitches, count(DISTINCT s.id) slots, count(DISTINCT o.id) orders, count(DISTINCT pay.id) payments FROM venues v LEFT JOIN pitches p ON p.venue_id=v.id LEFT JOIN slots s ON s.pitch_id=p.id LEFT JOIN orders o ON o.slot_id=s.id LEFT JOIN payments pay ON pay.order_id=o.id WHERE v.booking_mode='DIRECTORY_ONLY' GROUP BY v.id ORDER BY v.id;"
```

- [ ] **Step 3: Refresh same-size evidence against the integrated build**

At 375×812 replace implementation evidence with real HTTP-backed screenshots and regenerate side-by-side, overlay-50, and difference images for the six naturally reachable states: default, online selected, directory selected, detail map button, focused deep-link, and location denial. Preserve the approved `map-fallback` visual capture from the artifact-only fixture phase, label it `capture-only before fixture removal`, and link the passing watchdog/remount lifecycle tests as final runtime evidence. Record DevTools `2.01.2510290`, base library `3.17.0`, WebView, and remaining visual differences.

- [ ] **Step 4: Run final local verification**

```bash
npm test
npm run lint
npm run typecheck
npm run contract:validate
MINIPROGRAM_DEV_BOOKING_SOURCE=http MINIPROGRAM_API_BASE_URL=http://127.0.0.1:8000 npm run build:miniprogram:development
npm run build:miniprogram:production
npm run audit:miniprogram-package
TEST_DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test .venv/bin/python -m pytest backend/tests -q
.venv/bin/ruff check backend
.venv/bin/mypy backend
git diff --check
```

Expected: all local gates PASS.

- [ ] **Step 5: Record honest completion and commit**

Document local completion evidence and explicitly leave unchecked: Alibaba Cloud/PostgreSQL production deployment, public HTTPS and domain validation, WeChat production privacy submission, iOS/Android real-device positioning, and final release after ICP.

```bash
git add docs/acceptance/map-venue-discovery-progress.md artifacts/ui/reviews/map-venue-discovery deploy/README.md backend/Dockerfile backend/tests/test_deploy_preflight.py
git commit -m "docs: record local map discovery acceptance"
```

## Final completion conditions

- The visual gate was explicitly approved before contract/backend work.
- Five verified venues load from PostgreSQL through real HTTP; no production runtime business Fixture remains.
- `ONLINE` is enforced by both UI and every server booking boundary.
- User coordinates never leave page memory and location is never requested on entry.
- Local DevTools, API, database, build, package-audit, and visual evidence are complete.
- Production deployment and real-device final delivery remain visibly deferred until ICP completion; the slice is described as **locally complete**, never production-delivered.
