# Production Intent Entry Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the approved three-purpose page the honest production start of the mini program, with real booking navigation and membership-authoritative venue-manager routing.

**Status:** The production entry and read endpoint were implemented. The original single-membership auto-redirect and deferred onboarding UI are superseded by [the 2026-08-17 venue portfolio and onboarding plan](./2026-08-17-venue-portfolio-and-onboarding.md).

**Architecture:** Reuse the approved intent-entry composition without importing `miniprogram/dev`. The authenticated read endpoint lists the current user's active managed venues. The corrected venue-access page always renders one portfolio for zero, one, or many memberships; venue cards open a workbench and stable claim/create actions are completed by the superseding plan.

**Tech Stack:** WeChat Mini Program TypeScript/WXML/WXSS, FastAPI, SQLAlchemy, PostgreSQL, Jest, Node test runner, pytest.

---

## Chunk 1: New venue-access visual gate

### Task 1: Produce the multiple-venue and no-access native preview

**Files:**
- Create: `miniprogram/dev/pages/venue-access/index.ts`
- Create: `miniprogram/dev/pages/venue-access/index.json`
- Create: `miniprogram/dev/pages/venue-access/index.wxml`
- Create: `miniprogram/dev/pages/venue-access/index.wxss`
- Create: `miniprogram/dev/venue-access-fixture.ts`
- Modify: `miniprogram/dev/app-pages.json`
- Create: `tests/venue-access-native-preview.test.mjs`
- Create after preview: `artifacts/ui/reviews/venue-access-entry/README.md`

- [ ] **Step 1: Use `ui-ux-pro-max` against the existing mini-program tokens**

Keep the approved `#F8FAFC` / white surface / `#10243E` / trust-blue system, 88rpx touch targets, dynamic capsule-safe header, and existing card geometry. Do not introduce a new theme.

- [ ] **Step 2: Write a failing native-preview structure test**

Require two fixture cases selected only by a development query parameter:

```text
case=multiple  -> title “选择管理场馆”, two venue cards, district/address, chevron
case=empty     -> title “场馆管理”, verification explanation, “返回入口”
```

The test must reject production imports and must verify centered button text, 88rpx touch targets, safe-area footer padding, and no self-approval language.

- [ ] **Step 3: Run the focused test and confirm RED**

Run: `node --test tests/venue-access-native-preview.test.mjs`

Expected: FAIL because the page and fixture do not exist.

- [ ] **Step 4: Implement the isolated Fixture page**

The multiple state lists only venue name, district and address. The empty state says that WeChat login does not prove physical-venue authority and that verified onboarding will open later; it must not present a working application submission.

- [ ] **Step 5: Build the development package and capture one target-viewport preview per state**

Run: `npm run build:miniprogram:development`

Capture at `375 × 812`; compare both states with the existing intent-entry design system. Record only the representative screenshots and concise observations in the review README.

- [ ] **Step 6: Stop for user visual confirmation**

Do not change the OpenAPI contract or backend before the user confirms the new venue-access states. The already approved three-purpose page itself does not need another visual approval cycle.

- [ ] **Step 7: Commit the approved visual Fixture**

```bash
git add miniprogram/dev/pages/venue-access miniprogram/dev/venue-access-fixture.ts miniprogram/dev/app-pages.json tests/venue-access-native-preview.test.mjs artifacts/ui/reviews/venue-access-entry
git commit -m "feat: preview venue access routing states"
```

## Chunk 2: Membership-authoritative read contract

### Task 2: Add the current user's managed-venue endpoint

**Files:**
- Create: `backend/app/modules/venue_access/__init__.py`
- Create: `backend/app/modules/venue_access/dto.py`
- Create: `backend/app/modules/venue_access/repository.py`
- Create: `backend/app/modules/venue_access/service.py`
- Create: `backend/app/modules/venue_access/router.py`
- Modify: `backend/app/main.py`
- Modify: `contracts/openapi.yaml`
- Create: `contracts/examples/managed-venues.json`
- Create: `backend/tests/test_venue_access_api.py`
- Modify: `backend/tests/test_openapi_conformance.py`
- Modify: `scripts/validate-contract.mjs`

- [ ] **Step 1: Write failing API tests**

Cover unauthenticated `401`, zero memberships, one membership, multiple memberships, deterministic sorting, and exclusion of inactive memberships, memberships without `can_manage_inventory=true`, or inactive venues. No database migration is required.

- [ ] **Step 2: Freeze the minimal response contract**

Add `GET /api/v1/admin/venues` with this closed response shape:

```json
{
  "venues": [
    {
      "id": "uuid",
      "name": "渤海元丰足球场",
      "district_name": "西青区",
      "address": "天津市西青区利达路"
    }
  ]
}
```

Return only venues where `VenueMembership.is_active`, `VenueMembership.can_manage_inventory`, and `Venue.is_active` are all true. The endpoint is read-only and never creates a venue or membership.

- [ ] **Step 3: Run focused tests and confirm RED**

Run: `uv run pytest backend/tests/test_venue_access_api.py backend/tests/test_openapi_conformance.py -q`

Expected: FAIL because the route and schema are absent.

- [ ] **Step 4: Implement repository, service, DTO and router**

Repository performs one deterministic joined query ordered by normalized venue name and venue ID. Service maps persistence rows to the closed DTO. Router uses the existing bearer dependency `get_current_user`.

- [ ] **Step 5: Validate focused backend and contract checks**

Run:

```bash
uv run pytest backend/tests/test_venue_access_api.py backend/tests/test_openapi_conformance.py -q
npm run contract:validate
```

Expected: all pass.

- [ ] **Step 6: Commit the read contract**

```bash
git add backend/app/modules/venue_access backend/app/main.py backend/tests/test_venue_access_api.py backend/tests/test_openapi_conformance.py contracts/openapi.yaml contracts/examples/managed-venues.json scripts/validate-contract.mjs
git commit -m "feat: list managed venues for current user"
```

## Chunk 3: Production mini-program routing

### Task 3: Add the production venue-access data source

**Files:**
- Create: `miniprogram/domain/venue-access.ts`
- Create: `miniprogram/domain/venue-access.test.ts`
- Create: `miniprogram/services/venue-access.ts`
- Create: `miniprogram/services/http-venue-access.ts`
- Create: `miniprogram/services/http-venue-access.test.ts`
- Modify: `scripts/build-miniprogram.mjs`
- Modify: `miniprogram/dev/bootstrap.ts`

- [ ] **Step 1: Write decoder and HTTP-adapter tests**

Require closed-object decoding, UUID/name/address validation, bearer authentication, one automatic re-login after `401`, and honest `LOGIN_FAILED` / `VENUE_ACCESS_UNAVAILABLE` errors.

- [ ] **Step 2: Run focused Jest tests and confirm RED**

Run: `npx jest miniprogram/domain/venue-access.test.ts miniprogram/services/http-venue-access.test.ts --runInBand`

- [ ] **Step 3: Implement the smallest port and adapter**

```ts
export interface VenueAccessDataSource {
  login(): Promise<void>;
  listManagedVenues(): Promise<readonly ManagedVenue[]>;
}
```

Reuse the existing session store and production identity. Do not add another token cache.

- [ ] **Step 4: Register HTTP composition in production and HTTP development mode**

Fixture mode may register only the isolated dev page fixture; production must always bind `createHttpVenueAccessDataSource`.

- [ ] **Step 5: Run focused tests and typecheck**

Run:

```bash
npx jest miniprogram/domain/venue-access.test.ts miniprogram/services/http-venue-access.test.ts --runInBand
npm run typecheck
```

### Task 4: Promote the approved intent entry and venue-access page to production

**Files:**
- Create: `miniprogram/presentation/intent-header-layout.ts`
- Create: `miniprogram/pages/intent-entry/index.ts`
- Create: `miniprogram/pages/intent-entry/index.json`
- Create: `miniprogram/pages/intent-entry/index.wxml`
- Create: `miniprogram/pages/intent-entry/index.wxss`
- Create: `miniprogram/pages/intent-entry/index.test.ts`
- Create: `miniprogram/pages/venue-access/index.ts`
- Create: `miniprogram/pages/venue-access/index.json`
- Create: `miniprogram/pages/venue-access/index.wxml`
- Create: `miniprogram/pages/venue-access/index.wxss`
- Create: `miniprogram/pages/venue-access/index.test.ts`
- Modify: `miniprogram/dev/pages/intent-entry/index.ts`
- Modify: `miniprogram/app.json`
- Modify: production route assertions in `tests/structure.test.mjs`, `tests/build-booking-preview.test.mjs`, `tests/build-miniprogram.test.mjs`, `tests/production-package-booking-audit.test.mjs`, `tests/audit-production-package.test.mjs`, and `scripts/audit-production-package.mjs`

- [ ] **Step 1: Write failing controller and route tests**

Verify:

```text
BOOK -> reLaunch /pages/venue-map/index
PLAY -> disabled, visible “即将开放”, no navigation
HOST -> navigate /pages/venue-access/index
venue access zero/one/many -> render the same “我的场馆” portfolio structure
venue card -> redirect /pages/venue-profile/index?venue_id=...
claim/create -> implemented only with the superseding real onboarding slice
read failure -> explicit retry preserving the page
```

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `npx jest miniprogram/pages/intent-entry/index.test.ts miniprogram/pages/venue-access/index.test.ts --runInBand`

- [ ] **Step 3: Implement production pages from approved visuals**

Production code owns immutable intent/city copy and imports nothing under `miniprogram/dev`. Move only the capsule-safe header calculation to `miniprogram/presentation`; keep the existing dev preview compiling against that shared pure helper.

- [ ] **Step 4: Make the entry route first and update exact route audits**

`miniprogram/app.json` begins with:

```json
[
  "pages/intent-entry/index",
  "pages/venue-access/index",
  "pages/venue-map/index"
]
```

Retain all existing production routes after these entries. Do not add the Fixture returning-home route.

- [ ] **Step 5: Run focused frontend checks**

Run:

```bash
npx jest miniprogram/pages/intent-entry/index.test.ts miniprogram/pages/venue-access/index.test.ts miniprogram/domain/venue-access.test.ts miniprogram/services/http-venue-access.test.ts --runInBand
node --test tests/structure.test.mjs tests/build-booking-preview.test.mjs tests/build-miniprogram.test.mjs tests/production-package-booking-audit.test.mjs tests/audit-production-package.test.mjs
npm run typecheck
```

- [ ] **Step 6: Commit production routing**

```bash
git add miniprogram scripts/build-miniprogram.mjs scripts/audit-production-package.mjs tests
git commit -m "feat: launch production intent entry"
```

## Chunk 4: Proportional release verification

### Task 5: Verify the production slice without expanding scope

**Files:**
- Modify if required: `artifacts/ui/reviews/venue-access-entry/README.md`

- [ ] **Step 1: Run production build and Fixture leakage audit**

```bash
npm run build:miniprogram:production
npm run audit:miniprogram-package
```

- [ ] **Step 2: Run the focused backend and frontend suites once**

Run the tests named in Tasks 2–4. Do not add a new broad evidence framework.

- [ ] **Step 3: Generate the live preview and do one iPhone acceptance pass**

Verify all visible buttons once: city picker, rent venue, host venue, retry, venue choice, return, and the disabled “即将开放” card. Check centered labels, capsule clearance, 88rpx touch targets, loading/error clarity and bottom safe area.

- [ ] **Step 4: Confirm server-side authorization**

An authenticated user receives only active memberships; an unprivileged user cannot infer another user's venue list or reach venue admin data by changing `venue_id`.

- [ ] **Step 5: Record outcome and return to A1 closeout**

After the entry slice passes, resume the existing venue-profile/pitch/inventory final acceptance work. Platform onboarding submission and the Web admin console remain roadmap slice D1.
