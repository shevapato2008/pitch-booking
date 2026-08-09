# Map Directory Slice 0 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the already-merged scalable map journey by approving its real-runtime visual baseline, returning structured venue districts from the real API, wiring a production Tencent POI suggestion adapter, and removing the temporary 100-venue/district/POI preview sources.

**Architecture:** Keep `GET /api/v1/venues/map` as the only authority for platform venues and add district metadata only to that map response. Keep Tencent suggestions behind the existing `PoiSearchCapability`; the adapter sends a trimmed query to Tencent with a Tianjin region but never sends user coordinates or writes search data to platform storage. After real HTTP and POI compositions work, delete the temporary large-directory sidecar and preview POI sources rather than maintaining parallel data paths.

**Tech Stack:** Native WeChat Mini Program, TypeScript, Jest, Node test runner, OpenAPI 3.1, FastAPI/Pydantic, SQLAlchemy/Alembic/PostgreSQL, pytest.

---

## Scope and current baseline

This plan supersedes only the unfinished post-visual-integration portion of `docs/superpowers/plans/2026-08-06-scalable-map-venue-directory.md`. It does not rebuild the merged map layout, marker clustering, search-center state machine, fixed-height venue cards, or bottom-sheet interactions.

Current evidence:

- `artifacts/ui/reviews/map-venue-discovery-scalable/` contains reference, implementation, side-by-side, overlay, and difference images.
- The latest native polish set uses the official WeChat page-content viewport `390×753`; the paired `375×812` and `390×844` evidence remains regression context.
- `GET /api/v1/venues/map` still lacks structured district fields.
- Production and development-HTTP composition do not register a real `PoiSearchCapability`.
- `miniprogram/dev/venue-map-preview-fixture.ts`, `miniprogram/services/venue-map-preview.ts`, and `miniprogram/dev/poi-search-preview.ts` are temporary development-only sources.

Out of scope:

- New map layouts, controls, filters, recommendations, or map-move search.
- More real venues or changes to `ONLINE`/`DIRECTORY_ONLY` authority.
- Bottom tab navigation, venue administration, games, teams, or registration.
- Persisted POI history, user-coordinate upload, backend proxying, or analytics.

## File responsibility map

- `contracts/openapi.yaml` and `contracts/examples/venue-map.json`: public map response authority.
- `deploy/venue-directory.schema.json` and `deploy/venue-directory.json`: reviewed source content, including structured district identity.
- `backend/migrations/versions/0007_venue_district.py`: safe persistence upgrade for existing venue rows.
- `backend/app/models.py` and `backend/app/modules/venues/{loader,dto,service}.py`: persist, validate, and expose map districts.
- `miniprogram/domain/{venue-directory,decoders}.ts`: strict client map decoding; venue detail stays unchanged.
- `miniprogram/services/tencent-poi-search.ts`: Tencent-only request and response decoding.
- `miniprogram/config/runtime.ts` and `scripts/build-miniprogram.mjs`: build-time injection of a restricted Tencent client key.
- `miniprogram/pages/venue-map/index.ts`: consume decoded district fields directly.
- `miniprogram/dev/*preview*` and `miniprogram/services/venue-map-preview.ts`: deletion targets after real integration.

## Chunk 1: Visual gate

### Task 1: Record explicit approval of the current native map

**Files:**

- Inspect: `artifacts/ui/reviews/map-venue-discovery-scalable/*390x753-{reference,implementation,side-by-side,overlay-50,difference}.png`
- Inspect: `artifacts/ui/reviews/map-venue-discovery-scalable/{nearby,poi}-{375x812,390x844}-{reference,implementation,side-by-side,overlay-50,difference}.png`
- Modify only if the user requests a visible correction: `miniprogram/pages/venue-map/index.{ts,wxml,wxss}` and the affected `miniprogram/components/venue-map-*/index.{ts,wxml,wxss}`
- Modify only if a state must be recaptured: the matching source under `artifacts/ui/references/` and matching evidence files under `artifacts/ui/reviews/map-venue-discovery-scalable/`
- Modify after approval: `artifacts/ui/reviews/map-venue-discovery-scalable/README.md`

- [x] **Step 1: Present all six required visual states**

Present `city`, `online-selected`, `directory-selected`, and `long-content` side-by-side images at the exact latest `390×753` page-content viewport. Also present the existing paired `nearby` and `poi` comparisons at `375×812` and `390×844`. Explain that the latter two freeze search-center composition and semantics before the latest marker/card polish; the latest four states freeze the current component style. Approval must explicitly accept this combined evidence or request a targeted recapture. Link corresponding overlay and difference files; do not reinterpret automated layout tests as visual approval.

- [x] **Step 2: Obtain one explicit user decision**

Ask whether all six states are visually approved as the Slice 0 baseline. If a visible correction or latest-style recapture is requested:

1. identify the affected page/component and state;
2. write or update only its focused Jest assertion;
3. run `npx jest miniprogram/pages/venue-map/index.test.ts miniprogram/components/venue-map-search/index.test.ts miniprogram/components/venue-map-sheet/index.test.ts miniprogram/components/venue-map-card/index.test.ts --runInBand` and expect PASS;
4. run `npm run build:miniprogram:development` and expect a successful development build;
5. capture only the affected native implementation and matching reference at the same viewport;
6. run `python3 scripts/create_visual_review.py <reference.png> <implementation.png> <output-prefix>` and expect side-by-side, overlay, and difference files with matching dimensions;
7. commit the corrected implementation, focused tests, reference, and regenerated evidence before presenting it again:

   ```bash
   git add miniprogram/pages/venue-map miniprogram/components/venue-map-search miniprogram/components/venue-map-sheet miniprogram/components/venue-map-card artifacts/ui/references artifacts/ui/reviews/map-venue-discovery-scalable
   git commit -m "fix: align scalable map visual state"
   ```

8. present the refreshed state and repeat this step.

- [x] **Step 3: Record the visual decision**

Change the README status to include the approval date, approved viewports/evidence generations, all six approved states, and the boundary that real API/POI integration is still pending.

- [x] **Step 4: Verify the gate record**

Run:

```bash
rg -q "状态：视觉已确认" artifacts/ui/reviews/map-venue-discovery-scalable/README.md
rg -q "390×753" artifacts/ui/reviews/map-venue-discovery-scalable/README.md
rg -q "city" artifacts/ui/reviews/map-venue-discovery-scalable/README.md
rg -q "online-selected" artifacts/ui/reviews/map-venue-discovery-scalable/README.md
rg -q "directory-selected" artifacts/ui/reviews/map-venue-discovery-scalable/README.md
rg -q "long-content" artifacts/ui/reviews/map-venue-discovery-scalable/README.md
rg -q "nearby" artifacts/ui/reviews/map-venue-discovery-scalable/README.md
rg -q "poi" artifacts/ui/reviews/map-venue-discovery-scalable/README.md
rg -q "真实.*待" artifacts/ui/reviews/map-venue-discovery-scalable/README.md
test -z "$(rg -n "等待用户视觉确认" artifacts/ui/reviews/map-venue-discovery-scalable/README.md)"
git diff --check
```

Expected: the README names all six approved states, distinguishes their viewports/evidence generations, and still marks real district/POI integration as pending; `git diff --check` exits 0.

- [x] **Step 5: Commit the gate record**

```bash
git add artifacts/ui/reviews/map-venue-discovery-scalable/README.md
git commit -m "docs: approve scalable map visual baseline"
```

Stop here until Step 2 is explicitly approved.

## Chunk 2: Real district and POI integration

Execution prerequisite: Task 1 Step 2 is explicitly approved and Steps 3–5 are committed. No Task 2–4 change starts before that commit exists.

### Task 2: Add structured districts to the real map directory

**Files:**

- Modify: `contracts/openapi.yaml`
- Modify: `contracts/examples/venue-map.json`
- Modify: `tests/contract.test.mjs`
- Modify: `deploy/venue-directory.schema.json`
- Modify: `deploy/venue-directory.json`
- Modify: `tests/venue-directory-content.test.mjs`
- Create: `backend/migrations/versions/0007_venue_district.py`
- Modify: `backend/app/models.py`
- Modify: `backend/app/modules/venues/loader.py`
- Modify: `backend/app/modules/venues/dto.py`
- Modify: `backend/app/modules/venues/service.py`
- Modify: `backend/tests/test_venue_directory_migration.py`
- Modify: `backend/tests/test_venue_directory_api.py`
- Modify: `backend/tests/test_venue_directory_loader.py`
- Modify: `backend/tests/test_openapi_conformance.py`
- Modify: `backend/tests/test_schema_constraints.py`
- Modify: `scripts/seed_demo.py`
- Modify: `backend/tests/test_seed_demo.py`
- Modify: `miniprogram/domain/venue-directory.ts`
- Modify: `miniprogram/domain/decoders.ts`
- Modify: `miniprogram/domain/decoders.test.ts`
- Modify: `miniprogram/presentation/venue-map-search.test.ts`
- Modify: `miniprogram/presentation/venue-map.test.ts`

- [ ] **Step 1: Write failing contract and directory-content tests**

Require these map-only fields on every `VenueMapItem`:

```yaml
district_code:
  type: string
  pattern: '^[0-9]{6}$'
district_name:
  type: string
  minLength: 1
```

Freeze the five reviewed pairs: `120111/西青区`, `120104/南开区`, `120105/河北区`, `120101/和平区`, and `120110/东丽区`. Do not parse districts from address text and do not add the fields to venue-detail responses.

- [ ] **Step 2: Verify the focused tests fail**

Run:

```bash
node --test tests/contract.test.mjs tests/venue-directory-content.test.mjs
npm run contract:validate
```

Expected: FAIL because the two fields are absent.

- [ ] **Step 3: Update the public contract and reviewed content**

Add the fields to the map schema/example and deploy manifest/schema. Preserve current array ordering, exactly one canonical `ONLINE` venue, and the current five-venue production content; do not expand the real directory just to exercise scale.

- [ ] **Step 4: Start the disposable PostgreSQL test service**

Run:

```bash
docker compose -f deploy/compose.test.yaml up -d --wait postgres
docker compose -f deploy/compose.test.yaml ps postgres
```

Expected: PostgreSQL 17 reports healthy on `127.0.0.1:55432`. Use `TEST_DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test` for every integration-test command below.

- [ ] **Step 5: Write and fail the migration/backend tests**

Cover 0006→0007 backfill of the five immutable UUIDs, non-null columns, an atomic failure for unknown pre-existing venue IDs, loader idempotency, exact API fields, and unchanged detail responses. Add a successful 0007→0006 downgrade test proving only the two district columns disappear while venue identities, booking modes, inventory, and all 0006 columns remain. Update existing head/version assertions from `0006` to `0007` where they exercise `head`; keep assertions for an intentionally aborted 0006→0007 upgrade at `0006`.

Run:

```bash
TEST_DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test uv run pytest -q backend/tests/test_venue_directory_migration.py backend/tests/test_venue_directory_api.py backend/tests/test_venue_directory_loader.py
```

Expected: FAIL because revision `0007` and persistence fields do not exist.

- [ ] **Step 6: Implement persistence, loader, DTO, and service projection**

Add non-null `district_code`/`district_name` columns. The migration temporarily allows null, backfills only the five known UUIDs, rejects unknown rows, and then makes both fields non-null. The loader copies validated structured values. `_map_item` exposes them; `_common_detail` stays unchanged.

- [ ] **Step 7: Write and fail Mini Program decoder tests**

Map entries require `districtCode` and `districtName`; detail variants remain independent and decode without them. Add exact-key rejection cases and prove CITY mode retains API order. Update every handwritten `VenueMapEntry` in both presentation test files with reviewed district pairs so type checking does not depend on optional fields.

Run:

```bash
npx jest miniprogram/domain/decoders.test.ts miniprogram/presentation/venue-map-search.test.ts miniprogram/presentation/venue-map.test.ts --runInBand
```

Expected: FAIL on missing client fields.

- [ ] **Step 8: Implement strict map-only decoding**

Split the current shared decoder into a district-free detail core and a map wrapper that requires the two fields. Do not make district optional.

- [ ] **Step 9: Verify and commit the district vertical slice**

Run:

```bash
npm run contract:validate
node --test tests/contract.test.mjs tests/venue-directory-content.test.mjs
npx jest miniprogram/domain/decoders.test.ts miniprogram/presentation/venue-map-search.test.ts miniprogram/presentation/venue-map.test.ts --runInBand
TEST_DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test uv run pytest -q backend/tests/test_venue_directory_migration.py backend/tests/test_venue_directory_api.py backend/tests/test_venue_directory_loader.py backend/tests/test_openapi_conformance.py backend/tests/test_seed_demo.py backend/tests/test_schema_constraints.py
```

Expected: PASS.

```bash
git add contracts deploy backend miniprogram/domain miniprogram/presentation/venue-map-search.test.ts miniprogram/presentation/venue-map.test.ts scripts/seed_demo.py tests/contract.test.mjs tests/venue-directory-content.test.mjs
git commit -m "feat: expose structured venue districts"
```

### Task 3: Register a production Tencent POI suggestion capability

**Files:**

- Create: `miniprogram/services/tencent-poi-search.ts`
- Create: `miniprogram/services/tencent-poi-search.test.ts`
- Modify: `miniprogram/services/poi-search.ts`
- Modify: `miniprogram/config/runtime.ts`
- Modify: `miniprogram/runtime/production.ts`
- Modify: `miniprogram/runtime/production.test.ts`
- Modify: `miniprogram/dev/bootstrap.ts`
- Modify: `scripts/build-miniprogram.mjs`
- Modify: `tests/build-miniprogram.test.mjs`
- Modify: `tests/build-booking-preview.test.mjs`
- Modify: `tests/development-http-build.test.mjs`
- Modify: `scripts/audit-production-package.mjs`
- Modify: `docs/llm-wiki/wechat-miniprogram/network-auth-payment.md`

- [ ] **Step 1: Write failing strict-adapter tests**

Freeze the existing `PoiSearchResult` shape. Mock the request boundary and require:

- endpoint `https://apis.map.qq.com/ws/place/v1/suggestion`;
- trimmed query of at least two non-space characters;
- `keyword`, restricted client `key`, `region: "天津市"`, and `output: "json"` only;
- no user latitude/longitude or platform API request;
- strict decoding of `id`, `title`, `address`, `city`, `district`, `adcode`, and `location.lat/lng`;
- invalid items dropped, non-zero status/timeouts mapped to `POI_SEARCH_UNAVAILABLE`, and empty results returned honestly.

Tencent's documented suggestion endpoint requires `key`, `keyword`, and `region`; keeping the region fixed to Tianjin matches this product's current operating scope. Do not add location bias or `region_fix` in this slice.

- [ ] **Step 2: Verify the adapter tests fail**

Run:

```bash
npx jest miniprogram/services/tencent-poi-search.test.ts --runInBand
```

Expected: FAIL because the adapter does not exist.

- [ ] **Step 3: Implement the minimal adapter**

Use constructor-injected request and key inputs. Convert successful results to `coordinateSystem: "GCJ02"`; never log or persist the query/results. Keep debounce and stale-response ownership in the existing page rather than the adapter.

- [ ] **Step 4: Write failing build/bootstrap tests**

Require `MINIPROGRAM_TENCENT_MAP_KEY` for production and development-HTTP builds, while development Fixture builds remain key-free. The key must only be written into generated `dist` config, production must register the adapter before `App({})`, and production audit must reject the placeholder and all preview POI symbols. Update every existing test helper that invokes a production build (`build-miniprogram`, `build-booking-preview`, and `development-http-build`) to inject the same fake format-valid key by default; missing/invalid-key cases explicitly remove or override it so unrelated build tests continue reaching their intended assertion.

- [ ] **Step 5: Verify the build tests fail**

Run:

```bash
node --test tests/build-miniprogram.test.mjs tests/build-booking-preview.test.mjs tests/development-http-build.test.mjs
npx jest miniprogram/runtime/production.test.ts --runInBand
```

Expected: FAIL because key injection and registration do not exist.

- [ ] **Step 6: Implement key injection and production composition**

Add a source placeholder export next to `API_BASE_URL`; extend the existing generated-runtime-config path rather than adding a second config system. Production and development-HTTP builds validate and inject the restricted client key. Fixture development keeps the explicit preview capability until Task 4.

- [ ] **Step 7: Verify and commit the POI boundary**

Run the focused commands from Steps 2 and 5. Expected: PASS.

```bash
git add miniprogram/config miniprogram/runtime miniprogram/services miniprogram/dev/bootstrap.ts scripts/build-miniprogram.mjs scripts/audit-production-package.mjs tests/build-miniprogram.test.mjs tests/build-booking-preview.test.mjs tests/development-http-build.test.mjs docs/llm-wiki/wechat-miniprogram/network-auth-payment.md
git commit -m "feat: add Tencent POI search capability"
```

External release prerequisites—creating/restricting the Tencent client key, adding `https://apis.map.qq.com` to WeChat request domains, and publishing the matching privacy disclosure—are recorded as blockers if account access is unavailable. They do not justify committing a real key or silently falling back to preview POIs.

### Task 4: Remove preview metadata and prove the real composition

**Files:**

- Modify: `miniprogram/presentation/venue-map-search.ts`
- Modify: `miniprogram/presentation/venue-map-search.test.ts`
- Modify: `miniprogram/pages/venue-map/index.ts`
- Modify: `miniprogram/pages/venue-map/index.test.ts`
- Modify: `miniprogram/dev/venue-directory-source.ts`
- Modify: `miniprogram/dev/bootstrap.ts`
- Modify: `miniprogram/services/booking.test.ts`
- Delete: `miniprogram/services/venue-map-preview.ts`
- Delete: `miniprogram/dev/venue-map-preview-fixture.ts`
- Delete: `miniprogram/dev/poi-search-preview.ts`
- Modify: `tests/fixtures.test.mjs`
- Modify: `tests/build-miniprogram.test.mjs`
- Modify: `scripts/audit-production-package.mjs`
- Modify: `artifacts/ui/reviews/map-venue-discovery-scalable/README.md`
- Modify: `docs/acceptance/map-venue-discovery-progress.md`

- [ ] **Step 1: Write failing page and deletion-gate tests**

Make filters read `venue.districtCode`/`venue.districtName` directly. Require all three preview files and their registrations/imports to be absent. Development Fixture directory falls back to the canonical five-venue contract fixture; update `booking.test.ts` to assert those five canonical identities and their online/directory detail behavior instead of preview-only identities. Development HTTP uses the backend and real Tencent adapter.

- [ ] **Step 2: Verify the focused tests fail**

Run:

```bash
npx jest miniprogram/pages/venue-map/index.test.ts miniprogram/presentation/venue-map-search.test.ts miniprogram/services/booking.test.ts --runInBand
node --test tests/fixtures.test.mjs tests/build-miniprogram.test.mjs
```

Expected: FAIL while the page still depends on the sidecar and preview files exist.

- [ ] **Step 3: Replace the sidecar and delete previews**

Remove `VenueDistrictSidecar` and `venue-map-preview` registration. Derive district options from decoded map entries. Delete the 100-venue and POI preview sources; do not copy their data into a new fixture.

- [ ] **Step 4: Verify real HTTP and POI states**

Start the local integration stack explicitly:

```bash
docker compose -f deploy/compose.test.yaml up -d --wait postgres
APP_ENV=development DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test uv run alembic upgrade head
APP_ENV=development DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test uv run python scripts/seed_demo.py --anchor-date today --days 31
APP_ENV=development DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test uv run python scripts/load_venue_directory.py --environment development
APP_ENV=development DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test uv run uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```

In another terminal, verify `curl -fsS http://127.0.0.1:8000/api/v1/venues/map` returns the five reviewed venues with district fields. Then build the real HTTP Mini Program composition using a real restricted client key already present in the shell environment:

```bash
MINIPROGRAM_DEV_BOOKING_SOURCE=http MINIPROGRAM_API_BASE_URL=http://127.0.0.1:8000 npm run build:miniprogram:development
```

In WeChat Developer Tools verify directory load, administrative filter, local platform search, POI loading/ready/empty/error/retry, location, and that Tencent failure leaves platform search usable. If `MINIPROGRAM_TENCENT_MAP_KEY`, its Tencent restriction, or WeChat request-domain configuration is unavailable, record that exact external blocker and do not claim POI device acceptance; this is distinct from the local API being unavailable.

After the checks, stop uvicorn with `Ctrl-C`, then run `docker compose -f deploy/compose.test.yaml down` and expect the test service to stop cleanly.

- [ ] **Step 5: Refresh only evidence invalidated by real data**

Capture the real HTTP CITY and one district-filter state at the same native page-content viewport. Do not redo every visual state unless geometry or copy changed. Record that real data contains five venues and no preview identities.

- [ ] **Step 6: Run the proportional final verification**

Run:

```bash
npm run typecheck
npm run lint
npm test
MINIPROGRAM_TENCENT_MAP_KEY=TEST1-TEST2-TEST3-TEST4-TEST5-TEST6 npm run build:miniprogram:production
npm run audit:miniprogram-package
```

Expected: all automated checks PASS; the production audit finds no preview fixture, POI preview, placeholder key, or TypeScript source. The literal `TEST1-…` key proves build-time injection only and the resulting package is never treated as release evidence; Step 4 device evidence always uses a real restricted key.

- [ ] **Step 7: Commit the integrated slice**

```bash
git add miniprogram tests scripts artifacts/ui/reviews/map-venue-discovery-scalable/README.md docs/acceptance/map-venue-discovery-progress.md
git commit -m "feat: complete real scalable map directory"
```

## Completion boundary

Slice 0 is locally complete only when:

- the user has explicitly approved the current native visual baseline;
- real HTTP map responses contain decoded structured districts;
- production/development-HTTP composition registers the Tencent adapter;
- the page has no district sidecar or large-directory/POI preview imports;
- the production package audit excludes all preview business data;
- focused and final existing tests pass.

Release readiness additionally requires real Tencent console restrictions, WeChat request-domain configuration, privacy disclosure, and device evidence. Missing account access is reported as an external blocker; it does not expand this plan or permit fake production behavior.
