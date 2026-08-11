# Venue Profile and Moderation Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Deliver a deployable venue-level profile journey with reviewed description and images, structured facilities, no public venue phone, and real WeChat Mini Program interactions backed by FastAPI, PostgreSQL, Aliyun OSS, and DashScope.

**Architecture:** Follow one foundation-first vertical slice. First freeze and approve both `375 × 812` administrator and public-view experiences with isolated Fixtures. After visual approval, add a versioned profile contract, private upload storage, persistent moderation jobs, and atomic publication. Then integrate the approved native pages, verify one real DashScope/OSS journey, and remove the Fixtures from the production path. Existing `Venue.description`, `VenueImage`, and `VenueFacility` remain the published read model.

**Tech Stack:** WeChat Mini Program TypeScript/WXML/WXSS, FastAPI, SQLAlchemy, Alembic, PostgreSQL, Aliyun OSS, DashScope compatible API, `qwen3-vl-flash`, Jest, pytest, Node contract checks.

**Scope controls:** Keep the first release venue-level only: one description, up to eight images, fixed facilities, and a minimal manual fallback API. Do not add per-pitch media, custom tags, chat, public venue phone, a general moderation console, or unrelated security infrastructure.

---

## Chunk 1 — Approved Visual Journey Before Backend Work

### Task 1: Freeze the visual state contract

**Files:**

- Create: `artifacts/ui/references/venue-profile-workbench.html`
- Create: `artifacts/ui/references/venue-profile-workbench.css`
- Create: `artifacts/ui/references/venue-profile-workbench-data.js`
- Create: `artifacts/ui/references/venue-profile-workbench-controller.js`
- Create: `artifacts/ui/screen-manifest/venue-profile-workbench.json`
- Create: `tests/venue-profile-artifact.test.mjs`

**Responsibilities and budgets:** HTML is a shell only (≤40 lines); CSS owns presentation only (≤550 lines); data owns the ten immutable states and transitions (≤400 lines); controller owns rendering/event dispatch/audit only (≤380 lines); manifest owns the frozen state/copy/service-operation matrix (≤320 lines); the test owns source and artifact contracts (≤280 lines).

- [ ] Read the current Mini Program visual tokens from `miniprogram/pages/venue-pitch-setup/index.wxss` and `miniprogram/pages/venue-inventory/index.wxss`; run the applicable `ui-ux-pro-max` design-system lookup and record only recommendations that fit the existing system.
- [ ] Define a small immutable state matrix: admin `ready`, `uploading`, `image-reviewing`, `image-rejected`, `description-reviewing`, `description-rejected`, `pending-manual`, `load-error`, and `save-unknown`, plus user-facing `public-published` showing only the last approved profile.
- [ ] In the manifest, specify exact visible copy, fixed rejection reason mapping, image count/cover rules, selected facilities, button labels, and every button's intended future service operation.
- [ ] Add a failing source-contract test asserting all nine admin states plus `public-published`, the 300-code-point counter, maximum-eight rule, one cover, fixed facility codes, and no phone/chat/link action in either journey.
- [ ] Build the local-only reference renderer with a prominent venue name below the navigation title, image grid, introduction editor, grouped facility chips, review states, and fixed safe-area save action. Add the user-facing published view with cover/gallery, fixed facility labels, description, live-price summary, and `查看可订时段`; include no phone/chat/link controls.
- [ ] Make every reference control transition truthfully between declared Fixture states; do not show a fake published success.
- [ ] Run `node --test tests/venue-profile-artifact.test.mjs`; expect all assertions to pass.
- [ ] Run `npm run lint` and `git diff --check`; expect exit code 0.
- [ ] Commit: `design: add venue profile moderation reference`.

### Task 2: Implement the isolated native Fixture page

**Files:**

- Create: `miniprogram/dev/pages/venue-profile/index.json`
- Create: `miniprogram/dev/pages/venue-profile/index.ts`
- Create: `miniprogram/dev/pages/venue-profile/index.wxml`
- Create: `miniprogram/dev/pages/venue-profile/index.wxss`
- Create: `miniprogram/dev/pages/venue-profile-public/index.json`
- Create: `miniprogram/dev/pages/venue-profile-public/index.ts`
- Create: `miniprogram/dev/pages/venue-profile-public/index.wxml`
- Create: `miniprogram/dev/pages/venue-profile-public/index.wxss`
- Create: `miniprogram/dev/pages/venue-profile-public/index.test.ts`
- Create: `miniprogram/dev/fixtures/venue-profile.ts`
- Modify: `miniprogram/dev/app-pages.json`
- Create: `miniprogram/dev/pages/venue-profile/index.test.ts`
- Create: `tests/venue-profile-native-preview.test.mjs`

**Responsibilities and budgets:** Fixture data owns deterministic state builders shared only inside development (≤400 lines); admin controller owns draft/upload/review handlers (≤300 lines); public controller owns gallery selection and availability navigation only (≤160 lines); each WXML owns markup only (≤300 lines per page); each WXSS owns page styles only (≤700 lines per page); each Jest file covers its page's transitions (≤400 lines per file); Node test covers both routes/build isolation and source contracts (≤280 lines).

- [ ] Add failing controller tests for all visible admin actions: choose image, retry upload, delete, reorder, set cover, retry moderation, edit description, toggle each facility, save, reload, and retry unknown result. Add a public-page test proving gallery selection and `查看可订时段` navigation work while no contact action exists.
- [ ] Implement a deterministic Fixture adapter local to `miniprogram/dev`; it may simulate state transitions but must never be imported by production composition.
- [ ] Implement both approved Fixture pages using existing navigation, card, chip, status, icon, fixed-footer, and safe-area primitives. The admin page must not use native `maxlength="300"`; on input, truncate with `Array.from(value).slice(0, 300).join("")` and derive the counter from the same array so non-BMP characters follow the backend's Python `len` rule. The public page must render only published Fixture data and bind gallery/availability actions.
- [ ] Ensure every button has a real Fixture handler and every handler produces an explicit state; disable controls whose operation is unavailable in the current state.
- [ ] Add production-isolation assertions proving `miniprogram/app.json` and production build output do not contain either Fixture route or data source.
- [ ] Run `npx jest miniprogram/dev/pages/venue-profile/index.test.ts miniprogram/dev/pages/venue-profile-public/index.test.ts --runInBand`; expect all ten state fixtures, all eleven admin action paths, gallery selection, and availability navigation to pass with zero failures.
- [ ] Run `node --test tests/venue-profile-native-preview.test.mjs`; expect both Fixture routes present in development, both absent from production, and zero missing handler/source assertions.
- [ ] Run `npm run typecheck`, `npm run lint`, and `npm run build:miniprogram:development`; expect pass.
- [ ] Commit: `feat: add venue profile native fixture`.

### Task 3: Perform same-size visual self-review and request approval

**Files:**

- Create: `artifacts/ui/reviews/venue-profile-workbench/README.md`
- Create: `artifacts/ui/reviews/venue-profile-workbench/review-board.html`
- Create: `artifacts/ui/reviews/venue-profile-workbench/*-reference.png`
- Create: `artifacts/ui/reviews/venue-profile-workbench/*-implementation.png`
- Create: `artifacts/ui/reviews/venue-profile-workbench/*-side-by-side.png`
- Create: `artifacts/ui/reviews/venue-profile-workbench/*-overlay-50.png`
- Create: `artifacts/ui/reviews/venue-profile-workbench/*-difference.png`
- Modify: `tests/venue-profile-artifact.test.mjs`

**Responsibilities and budgets:** README records capture/runtime/visual observations/gates (≤250 lines); board is a generated local viewer only (≤250 lines); the test validates filenames, distinctness, dimensions, and approval metadata (≤300 lines). PNGs are generated evidence, never hand-edited.

- [ ] Add a failing evidence test requiring all approved manifest states and exact `375 × 812` reference, implementation, overlay, and difference images plus `750 × 812` side-by-side images.
- [ ] Build the latest development Mini Program and open both the admin and public Fixture routes in the real WeChat DevTools iPhone X simulator.
- [ ] Capture every state at `375 × 812`; retain real status bar, capsule, bottom safe area, and Home Indicator without synthesized pixels.
- [ ] Generate same-size side-by-side, 50% overlay, and difference evidence.
- [ ] Visually inspect composition, geometry/spacing, hierarchy, typography/colors/materials, icons, copy, and state meaning. Explicitly check centered button text, complete close/chevron icons, image-grid alignment, chip wrapping, fixed footer, and safe-area clearance.
- [ ] Exercise every visible button once in the Fixture and record the resulting state in the review README.
- [ ] Fix only visible or functional defects found, rebuild, and recapture affected states.
- [ ] Run `node --test tests/venue-profile-artifact.test.mjs tests/venue-profile-native-preview.test.mjs`; expect ten states × five evidence files = 50 PNGs, all 40 single-panel images at `375 × 812`, all ten side-by-side images at `750 × 812`, ten distinct implementation captures, and zero missing interactions.
- [ ] Present the review board to the user and stop. Do not begin Chunk 2 until the user explicitly approves the venue-profile visual journey.
- [ ] After approval, record the approval date and approved state set in the README.
- [ ] Commit: `test: add venue profile visual evidence`.

### Task 4: Freeze the post-approval API contract

**Prerequisite:** Task 3 has explicit user visual approval.

**Files:**

- Modify: `contracts/openapi.yaml`
- Create: `contracts/examples/venue-profile-admin-ready.json`
- Create: `contracts/examples/venue-profile-upload-intent.json`
- Create: `contracts/examples/venue-profile-reviewing.json`
- Create: `contracts/examples/venue-profile-rejected.json`
- Create: `contracts/examples/manual-review-queue.json`
- Create: `contracts/examples/error-venue-profile-version-conflict.json`
- Create: `contracts/examples/error-venue-profile-validation.json`
- Modify: `contracts/examples/venue-primary.json`
- Modify: `contracts/examples/venue-online-detail.json`
- Modify: `contracts/examples/venue-directory-detail.json`
- Modify: `contracts/examples/order-confirmed.json`
- Modify: `contracts/examples/order-expired.json`
- Modify: `contracts/examples/order-payment-exception.json`
- Modify: `contracts/examples/order-pending.json`
- Modify: `contracts/examples/payment-already-confirmed.json`
- Modify: `contracts/examples/payment-confirming.json`
- Modify: `scripts/validate-contract.mjs`
- Create: `tests/venue-profile-contract.test.mjs`

**Responsibilities and budgets:** OpenAPI owns schemas/routes only; each example owns one frozen response/error state; the validator owns the expected path/example matrix; the focused test owns cross-example privacy and moderation invariants (≤350 lines). Split schemas into named OpenAPI components rather than embedding repeated response objects.

- [ ] Add a failing contract test for the exact endpoints and examples below.
- [ ] Define `GET /api/v1/admin/venues/{venue_id}/profile` returning published data, current revision, facility/draft versions, upload/review states, and fixed reason codes.
- [ ] Define atomic `PUT /api/v1/admin/venues/{venue_id}/profile` with `Idempotency-Key`, `expected_facility_version`, `expected_revision_version`, `description`, and fixed facility codes.
- [ ] Define image operations: create upload intent, complete upload, delete draft image, reorder, set cover, and retry moderation. Each mutation carries its expected version and an idempotency key.
- [ ] Make upload intent return only `image_id`, private `object_key`, short-lived OSS PUT URL, required headers, maximum bytes, and accepted MIME types—never credentials.
- [ ] Define restricted manual queue read and idempotent decision endpoints using only `PASS` or a fixed reason code.
- [ ] Freeze `qwen3-vl-flash` as the initial `DASHSCOPE_MODERATION_MODEL` default because it is the selected low-cost vision-capable model; require every image moderation job to include the compressed review image as a real image input plus the short policy prompt, while description jobs contain text only. Keep the model identifier configurable and never expose the API key.
- [ ] Remove venue `phone` from primary, online, and directory public venue responses; remove venue `customer_service_phone` from order responses while retaining the user's masked phone.
- [ ] Define public fields for published gallery, cover, description, fixed facilities, derived pitch sizes, live price, and `查看可订时段` navigation target.
- [ ] Run `node scripts/validate-contract.mjs` and `node --test tests/venue-profile-contract.test.mjs`; expect all ten new admin/manual operations and all examples registered, all six order examples free of `customer_service_phone`, all three venue examples free of `phone`, and zero schema/example mismatches.
- [ ] Commit: `contract: define venue profile moderation api`.

---

## Chunk 2 — Persistent Profile, Upload, Moderation, and Publication

### Task 5: Add the profile revision and moderation schema

**Files:**

- Modify: `backend/app/models.py`
- Create: `backend/migrations/versions/0010_venue_profile_moderation.py`
- Create: `backend/tests/test_venue_profile_migration.py`
- Modify: `backend/tests/test_schema_constraints.py`

**Responsibilities and budgets:** migration owns reversible DDL/data backfill only (≤450 lines); models own ORM declarations only, with profile enums/classes grouped but no service logic (net addition ≤350 lines); migration test owns upgrade/downgrade and legacy-data preservation (≤350 lines); schema test owns database constraints (net addition ≤200 lines).

- [ ] Add a failing migration test that upgrades a legacy venue with published images/facilities and preserves its public data.
- [ ] Add `profile_version` and `facility_version` counters to `Venue`, initialized to 1 without changing `configuration_version`.
- [ ] Add enums and tables for `VenueProfileRevision`, `VenueProfileImageDraft`, `ContentModerationJob`, `ContentModerationDecision`, and profile mutation idempotency records.
- [ ] Model image drafts as either a reference to an existing published `VenueImage` or a new private object key; enforce one source, unique sort order per revision, and at most one current editable revision per venue.
- [ ] Store content hash, MIME type, byte size, review-object key, review status, fixed reason code, attempt count, next-attempt time, claimed lease, item version, reviewer ID/time, and timestamps needed to reject stale decisions.
- [ ] Add database constraints for 300-code-point application validation companion fields, valid review/status transitions, positive versions, unique idempotency scope/key, and indexed due-job lookup. Keep the exact eight-image and one-cover rules in the transaction service where current draft references must be considered together.
- [ ] Upgrade then downgrade a PostgreSQL test database; expect legacy published rows unchanged after upgrade, all new tables/columns present, and a clean downgrade.
- [ ] Run `python -m pytest backend/tests/test_venue_profile_migration.py backend/tests/test_schema_constraints.py -q`; expect the new migration cases and existing schema cases to pass with zero failures.
- [ ] Commit: `feat: add venue profile moderation schema`.

### Task 6: Add private OSS upload storage behind a narrow interface

**Files:**

- Modify: `pyproject.toml`
- Modify: `backend/app/config.py`
- Create: `backend/app/modules/venue_profiles/storage.py`
- Create: `backend/app/modules/venue_profiles/oss_storage.py`
- Create: `backend/app/modules/venue_profiles/local_storage.py`
- Create: `backend/tests/test_venue_profile_storage.py`
- Modify: `backend/tests/test_deploy_preflight.py`

**Responsibilities and budgets:** `storage.py` defines typed intent/bounded-read/review-copy/review-URL/publish/verify/delete operations only (≤220 lines); OSS adapter owns signing, bounded object streaming, and object metadata operations (≤350 lines); local adapter owns deterministic test/development behavior (≤250 lines); config owns validated secret/settings fields; focused tests own adapter behavior without network calls (≤450 lines).

- [ ] Add failing tests for JPEG/PNG/WebP intent creation, 10 MB bounded reads, private key prefix, required content-type headers, server-computed hash, signature validation, review-copy writes, five-minute moderation read URL, published-object promotion/verification, and cleanup.
- [ ] Add the official `oss2` dependency plus runtime Pillow for decoding/compression, and validated settings: `OSS_ENDPOINT`, `OSS_BUCKET`, `OSS_PUBLIC_BASE_URL`, `OSS_ACCESS_KEY_ID`, and secret `OSS_ACCESS_KEY_SECRET`; deployed environments fail preflight when storage configuration is incomplete.
- [ ] Define `VenueMediaStore` without exposing OSS types to services. Production uses Aliyun OSS; tests/development can inject the local adapter.
- [ ] Generate a short-lived signed PUT URL for an immutable private object key. The Mini Program uploads raw `ArrayBuffer` with HTTP PUT; treat all client content type/hash metadata as hints only.
- [ ] On completion, stream at most 10 MB from the private object into the service, compute SHA-256 server-side, decode with Pillow, and verify actual JPEG/PNG/WebP signature before recording MIME/hash or creating a moderation job. Delete and reject invalid objects.
- [ ] Add storage operations to write a compressed moderation copy, generate its separate short-lived signed GET URL, promote an approved original to a stable published prefix, HEAD-verify the promoted object, and delete orphaned promoted/private/review objects. Rejected/private objects are never public.
- [ ] Verify URL expiration, key isolation by venue/image UUID, no credentials in returned DTOs/logs, and idempotent cleanup/publish operations.
- [ ] Run `python -m pytest backend/tests/test_venue_profile_storage.py backend/tests/test_deploy_preflight.py -q`; expect signature spoofing and oversized streams rejected, server SHA-256 stable, review-copy/promotion lifecycle idempotent, deployed settings redacted, and zero real OSS calls.
- [ ] Commit: `feat: add venue media storage adapter`.

### Task 7: Implement the atomic venue-profile administrator service

**Files:**

- Create: `backend/app/modules/venue_profiles/__init__.py`
- Create: `backend/app/modules/venue_profiles/dto.py`
- Create: `backend/app/modules/venue_profiles/repository.py`
- Create: `backend/app/modules/venue_profiles/service.py`
- Create: `backend/app/modules/venue_profiles/router.py`
- Modify: `backend/app/main.py`
- Create: `backend/tests/test_venue_profile_service.py`
- Create: `backend/tests/test_venue_profile_api.py`

**Responsibilities and budgets:** DTO owns closed request/response schemas and fixed enum mapping (≤450 lines); repository owns SQL/locking/idempotency persistence only (≤450 lines); service owns permissions, validation, draft mutation, and atomic transactions (≤550 lines, split image mutation helpers if exceeded); router owns HTTP wiring only (≤250 lines); service/API tests remain separated by business versus transport concerns (≤700 lines each).

- [ ] Add failing service tests for membership isolation, 300-code-point acceptance/rejection, facility whitelist, atomic facility+description save, optimistic conflict, idempotent replay, eight-image maximum, unique cover, inherited published-image approval, and unchanged-image reorder without review.
- [ ] Add failing API tests covering the ten frozen admin/manual operations' administrator subset, error envelopes, bearer authentication, and cross-venue denial.
- [ ] Implement read bootstrap that returns the authoritative published profile plus the single current draft and its per-item review states.
- [ ] Implement atomic profile save: lock venue/current revision, check both expected versions, validate facilities, replace facility rows and increment `facility_version`, update description revision, and create a moderation job only when description changed; roll back all writes on any error.
- [ ] Implement upload intent and completion as two truthful operations. Intent reserves one draft image/idempotency result; completion verifies the object and creates exactly one image moderation job.
- [ ] Implement delete, reorder, set-cover, and retry operations against the current revision. Published references inherit approval; only new bytes create review jobs.
- [ ] Map validation/version/permission/not-found/read-only failures to the frozen fixed error codes; never return private object keys or signed URLs from normal bootstrap/public reads.
- [ ] Register the router and injected storage on application state; close any owned clients in lifespan.
- [ ] Run `python -m pytest backend/tests/test_venue_profile_service.py backend/tests/test_venue_profile_api.py -q`; expect every declared mutation path, idempotent replay, and rollback assertion to pass.
- [ ] Run `python -m ruff check backend/app/modules/venue_profiles backend/tests/test_venue_profile_*.py` and `python -m mypy backend/app`; expect zero errors.
- [ ] Commit: `feat: add venue profile admin api`.

### Task 8: Implement DashScope vision moderation and minimal manual fallback

**Files:**

- Modify: `backend/app/config.py`
- Create: `backend/app/modules/venue_profiles/moderation.py`
- Create: `backend/app/modules/venue_profiles/dashscope_moderation.py`
- Create: `backend/app/modules/venue_profiles/publisher.py`
- Create: `backend/app/modules/venue_profiles/worker.py`
- Modify: `backend/app/worker.py`
- Modify: `backend/app/modules/venue_profiles/router.py`
- Create: `backend/tests/test_dashscope_moderation.py`
- Create: `backend/tests/test_venue_profile_worker.py`
- Create: `backend/tests/test_venue_profile_publication.py`
- Create: `backend/tests/test_venue_profile_manual_review.py`

**Responsibilities and budgets:** moderation defines provider input/output and strict fixed-result decoder (≤220 lines); DashScope adapter owns one HTTP request and provider mapping (≤300 lines); publisher owns publication preconditions/transaction only (≤350 lines); profile worker owns claim/retry/stale-result orchestration (≤400 lines); root worker only composes existing workers (net addition ≤120 lines); each focused test file stays ≤500 lines.

- [ ] Add failing provider tests that distinguish description from image jobs. Assert an image job sends a compressed review-image URL in DashScope's image content block—not a filename or text description—while a description job sends text only.
- [ ] Add `DASHSCOPE_API_KEY` as a redacted required deployed secret, `DASHSCOPE_BASE_URL` as a validated configurable HTTPS URL, and `DASHSCOPE_MODERATION_MODEL` defaulting to `qwen3-vl-flash`.
- [ ] Implement `ContentModerationProvider` and an `httpx` DashScope adapter using non-thinking mode and strict short JSON output: `PASS`, `REJECT` plus one fixed reason code, or `UNCERTAIN`. Ignore/reject all provider free text and unknown codes.
- [ ] Keep image moderation on a vision-capable request path: obtain the private five-minute review URL from `VenueMediaStore`, place it in the model image input, include only the short policy prompt, and send the configurable low-cost vision model identifier. Add a guard test that refuses to execute an image job with an empty image input.
- [ ] Compress the server-validated original into the storage review-copy operation at a bounded dimension/quality while preserving OCR readability; retain the approved original separately. Hash the original from server-read bytes and reuse a still-valid prior fixed result before calling DashScope.
- [ ] Implement due-job claiming with database lease/`SKIP LOCKED`, limited retry with backoff, transition to `PENDING_MANUAL` on exhausted uncertainty/provider failures, and stale item-version rejection.
- [ ] Implement publisher preconditions: latest revision, unchanged published base version, approved changed description, all target images approved, at most eight images, and exactly one cover. First idempotently promote and HEAD-verify every new object without changing public rows; then in one database transaction recheck the locked revision/base version, replace published rows/description, increment `profile_version`, and mark the revision published. If promotion or the database transaction fails, retain the old public version and enqueue/best-effort delete unreferenced promoted objects; delete superseded published/private/review objects only after commit.
- [ ] Restrict manual queue/decision to configured `MODERATION_REVIEWER_USER_IDS`; record reviewer/time/decision, make decisions idempotent, reject late versions, and invoke the same publisher after `PASS`.
- [ ] Compose the moderation scan into the existing worker without changing order/payment semantics. One `--once` execution reports the combined processed count.
- [ ] Run `python -m pytest backend/tests/test_dashscope_moderation.py backend/tests/test_venue_profile_worker.py backend/tests/test_venue_profile_publication.py backend/tests/test_venue_profile_manual_review.py -q`; expect vision payload, fixed decoder, hash reuse, retry/manual transition, stale-result discard, manual authorization, verified promotion-before-switch, orphan cleanup, and atomic database publish/rollback cases all to pass with zero external network calls.
- [ ] Run `python -m ruff check backend/app backend/tests` and `python -m mypy backend/app`; expect zero errors.
- [ ] Commit: `feat: moderate and publish venue profiles`.

### Task 9: Remove public venue phone and expose only published profile data

**Files:**

- Modify: `backend/app/modules/venues/dto.py`
- Modify: `backend/app/modules/venues/repository.py`
- Modify: `backend/app/modules/venues/service.py`
- Modify: `backend/app/modules/orders/dto.py`
- Modify: `backend/app/modules/orders/service.py`
- Modify: `backend/tests/test_primary_venue.py`
- Modify: `backend/tests/test_venue_directory_api.py`
- Modify: `backend/tests/test_order_detail.py`
- Modify: `backend/tests/test_order_creation.py`
- Modify: `backend/tests/test_openapi_conformance.py`

**Responsibilities and budgets:** modify existing DTO/repository/service boundaries only; do not create a second public profile service. Keep net additions below 120 lines per existing production file and 180 lines per test file; split query helpers only if an existing file would exceed its current project budget. Tests own explicit privacy/published-only assertions and retain existing user masked-phone coverage.

- [ ] Add failing tests proving primary, online, and directory venue responses omit `phone`; every order state omits venue `customer_service_phone`; the user's own `masked_phone` remains present where already required.
- [ ] Add failing tests proving public responses expose only published cover/gallery/description/facilities plus derived active pitch sizes, never revision IDs, review states, object keys, or pending/rejected content.
- [ ] Remove the two venue-contact DTO fields and their service mappings without deleting the internal `Venue.phone` storage column.
- [ ] Extend existing venue loaders/repositories to read the published `VenueImage`, `VenueFacility`, and active pitch data; do not query draft tables in public endpoints.
- [ ] Run `python -m pytest backend/tests/test_primary_venue.py backend/tests/test_venue_directory_api.py backend/tests/test_order_detail.py backend/tests/test_order_creation.py backend/tests/test_openapi_conformance.py -q`; expect all public privacy, published-only, six order-state, and masked-user-phone cases to pass with zero failures.
- [ ] Run `python -m pytest backend/tests/test_openapi_conformance.py -q`; expect runtime OpenAPI to equal the frozen contract.
- [ ] Commit: `feat: publish moderated venue profile details`.

---

## Chunk 3 — Real Mini Program Integration and Release Evidence

### Task 10: Add strict Mini Program profile domain and real HTTP/media adapters

**Files:**

- Create: `miniprogram/domain/venue-profile.ts`
- Create: `miniprogram/domain/venue-profile.test.ts`
- Create: `miniprogram/services/venue-profile.ts`
- Create: `miniprogram/services/http-venue-profile.ts`
- Create: `miniprogram/services/http-venue-profile.test.ts`
- Create: `miniprogram/services/venue-profile-attempt-store.ts`
- Create: `miniprogram/services/venue-profile-attempt-store.test.ts`
- Modify: `miniprogram/runtime/interfaces.ts`
- Modify: `miniprogram/runtime/production.ts`
- Modify: `miniprogram/runtime/production.test.ts`

**Responsibilities and budgets:** domain owns immutable camelCase types/strict snake_case decoders/fixed copy mapping (≤500 lines); service owns the source/capability interface only (≤220 lines); HTTP adapter owns authentication, endpoint encoding, and error mapping (≤450 lines); attempt store owns persisted unknown-result keys/payloads (≤240 lines); runtime media capability owns choose/read/absolute PUT primitives only (net addition ≤220 lines); focused tests stay ≤550 lines each.

- [ ] Add failing decoder tests for ready/reviewing/rejected/manual states, exact facility/reason enums, ten endpoint responses, unknown/missing fields, 300-code-point text, and absence of private object keys in normal bootstrap.
- [ ] Add failing adapter tests for one-login bearer retry, every declared endpoint, stable `Idempotency-Key`, expected versions, unknown write result, and original-key confirmation.
- [ ] Add `VenueProfileMediaCapability`: choose one JPEG/PNG/WebP image, read its bytes as bounded `ArrayBuffer`, and PUT to an absolute signed URL with only required headers. This capability must not receive OSS credentials or reuse the API base URL transport.
- [ ] Implement production media operations with `wx.chooseMedia`, `FileSystemManager.readFile`, and `wx.request` PUT; reject unsupported extension/type, client-visible size over 10 MB, non-2xx OSS status, timeout, and user cancellation with distinct fixed errors.
- [ ] Implement strict domain decoders and an HTTP data source for bootstrap, atomic save, upload intent/complete, delete, reorder, cover, retry, and read-latest. Keep manual reviewer endpoints backend-only in this release.
- [ ] Persist the exact idempotency key plus canonical payload for each unresolved mutation; refuse a different payload under the same pending key and clear only after an authoritative response.
- [ ] Run `npx jest miniprogram/domain/venue-profile.test.ts miniprogram/services/http-venue-profile.test.ts miniprogram/services/venue-profile-attempt-store.test.ts miniprogram/runtime/production.test.ts --runInBand`; expect all ten endpoint mappings, three media failure classes, stable retry keys, and strict decoder cases to pass.
- [ ] Run `npm run typecheck` and `npm run lint`; expect zero errors.
- [ ] Commit: `feat: add venue profile client adapters`.

### Task 11: Replace the admin Fixture with the approved production page

**Files:**

- Create: `miniprogram/pages/venue-profile/index.json`
- Create: `miniprogram/pages/venue-profile/index.ts`
- Create: `miniprogram/pages/venue-profile/index.wxml`
- Create: `miniprogram/pages/venue-profile/index.wxss`
- Create: `miniprogram/pages/venue-profile/index.test.ts`
- Modify: `miniprogram/app.json`
- Modify: `miniprogram/app.ts`
- Modify: `scripts/build-miniprogram.mjs`
- Modify: `tests/audit-production-package.test.mjs`

**Responsibilities and budgets:** production controller maps approved view states to real source calls (≤350 lines); WXML/WXSS are copied/adapted from approved Fixture geometry rather than redesigned (≤300/700 lines); controller test covers action-to-service truthfulness and stale async guards (≤600 lines); bootstrap registers one real source/media/attempt store; audit forbids Fixture imports/data in production.

- [ ] Add failing page tests asserting every approved visible button invokes its matching source/media operation and renders the authoritative result: upload, retry upload, delete, reorder, set cover, moderation retry, description input, facility toggle, save, reload, and unknown-result retry. Separately assert `场馆资料`, `配置场地`, `库存时段`, and any custom return control navigate to their exact real routes.
- [ ] Copy the visually approved structure/styles into the production route; preserve exact title/venue-name hierarchy, button centering, image/status alignment, icons, fixed footer, and safe area.
- [ ] Implement load/login/reload, Unicode-safe 300-character editing, facility draft state, atomic save, upload intent → local read → OSS PUT → completion, per-item busy state, review polling on page show, and fixed rejection reasons.
- [ ] Guard stale reads and duplicate taps. Preserve local description/facility edits across image operations and recover an unknown write only with its persisted original key/payload.
- [ ] Add navigation among the three administrator workbench pages: `场馆资料`, `配置场地`, and `库存时段`. Each entry uses real `navigateTo`/`redirectTo`; do not add placeholder buttons.
- [ ] Register the production route and HTTP/media/attempt-store composition; assert production builds contain no `miniprogram/dev` import, Fixture data, fake moderation result, or hard-coded DashScope/OSS secret.
- [ ] Run `npx jest miniprogram/pages/venue-profile/index.test.ts --runInBand`; expect every visible button path and all approved states to pass.
- [ ] Run `node --test tests/audit-production-package.test.mjs`; expect zero forbidden Fixture/secret paths or tokens.
- [ ] Commit: `feat: integrate venue profile workbench`.

### Task 12: Integrate the approved published profile into the user journey

**Files:**

- Modify: `miniprogram/domain/contracts.ts`
- Modify: `miniprogram/domain/booking.ts`
- Modify: `miniprogram/domain/booking-foundation.test.ts`
- Modify: `miniprogram/domain/decoders.ts`
- Modify: `miniprogram/domain/decoders.test.ts`
- Modify: `miniprogram/domain/venue-directory.ts`
- Modify: `miniprogram/services/http-page-data.ts`
- Modify: `miniprogram/services/http-page-data.test.ts`
- Modify: `miniprogram/services/http-venue-directory.ts`
- Modify: `miniprogram/services/http-venue-directory.test.ts`
- Modify: `miniprogram/presentation/venue.ts`
- Modify: `miniprogram/presentation/venue.test.ts`
- Modify: `miniprogram/presentation/order-detail.ts`
- Modify: `miniprogram/presentation/order-detail.test.ts`
- Modify: `miniprogram/presentation/booking.test.ts`
- Modify: `miniprogram/components/venue-card/index.ts`
- Modify: `miniprogram/components/venue-card/index.wxml`
- Modify: `miniprogram/components/venue-card/index.wxss`
- Modify: `miniprogram/components/venue-card/index.test.ts`
- Modify: `miniprogram/pages/venue/index.ts`
- Modify: `miniprogram/pages/venue/index.wxml`
- Modify: `miniprogram/pages/venue/index.wxss`
- Modify: `miniprogram/pages/venue/index.test.ts`
- Modify: `miniprogram/pages/order-detail/index.wxml`
- Modify: `miniprogram/pages/order-detail/index.test.ts`
- Modify: `miniprogram/pages/booking-confirmation/index.test.ts`
- Modify: `miniprogram/dev/booking-source.ts`
- Modify: `miniprogram/dev/payment-scenarios.ts`
- Modify: `miniprogram/dev/http-booking-source.ts`
- Modify: `miniprogram/dev/http-booking-source.test.ts`
- Modify: `miniprogram/services/http-booking.test.ts`
- Modify: `miniprogram/services/booking.test.ts`
- Modify: `tests/venue-directory-content.test.mjs`

**Responsibilities and budgets:** extend existing domain/service/presentation/component/page layers rather than duplicate them; keep net production additions ≤180 lines per file and focused test additions ≤220 lines per file. `venue-card` owns published gallery/description/facility presentation; venue page owns gallery selection and existing map/availability navigation; order presentation removes only venue contact data and retains user phone.

- [ ] Add failing decoder/presentation/page tests proving venue phone and order `customer_service_phone` are absent, user `maskedPhone` remains, and only published images/description/facilities are renderable.
- [ ] Add failing component tests for cover/gallery selection, all fixed facility labels, derived pitch-size labels, long 300-code-point description layout, image fallback, and `查看可订时段` navigation.
- [ ] Remove `phone` and venue service-phone decoding/view fields/UI rows from primary, online, directory, Fixture, and order paths. Do not remove the user's login/verification/masked-phone capability.
- [ ] Adapt the approved public Fixture view into the existing venue detail/component: cover/gallery, facility module, introduction module, live price summary, existing map action, and primary `查看可订时段` action. Do not add phone, chat, QR, link, or fake urgency controls.
- [ ] Ensure pending/rejected administrator drafts cannot appear because the page accepts only the public contract; keep current fallback art when no approved images exist.
- [ ] Run `npx jest miniprogram/domain/booking-foundation.test.ts miniprogram/domain/decoders.test.ts miniprogram/services/http-booking.test.ts miniprogram/services/booking.test.ts miniprogram/services/http-page-data.test.ts miniprogram/services/http-venue-directory.test.ts miniprogram/presentation/booking.test.ts miniprogram/presentation/venue.test.ts miniprogram/presentation/order-detail.test.ts miniprogram/components/venue-card/index.test.ts miniprogram/pages/booking-confirmation/index.test.ts miniprogram/pages/order-detail/index.test.ts miniprogram/pages/venue/index.test.ts miniprogram/dev/http-booking-source.test.ts --runInBand`; expect published profile rendering, gallery navigation, availability navigation, every venue-contact field removed, and masked-user-phone cases to pass.
- [ ] Run `node --test tests/venue-directory-content.test.mjs`; expect zero public phone/contact UI tokens and all approved facility/profile copy present.
- [ ] Commit: `feat: show published venue profiles`.

### Task 13: Run one real PostgreSQL, OSS, DashScope, and device acceptance journey

**Files:**

- Modify: `scripts/seed_demo.py`
- Create: `backend/tests/test_venue_profile_postgres.py`
- Create: `docs/operations/venue-profile-moderation.md`
- Modify: `artifacts/ui/reviews/venue-profile-workbench/README.md`
- Modify: `artifacts/ui/reviews/venue-profile-workbench/review-board.html`
- Modify: `tests/venue-profile-native-preview.test.mjs`

**Responsibilities and budgets:** seed adds one deterministic admin membership/published profile only (net addition ≤180 lines); PostgreSQL test owns real constraint/locking/publication assertions (≤600 lines); operations guide owns required env, worker, OSS CORS/domain, cleanup, and smoke commands (≤300 lines); evidence files record facts only and never claim approval not given.

- [ ] Add a failing PostgreSQL integration test for migration, concurrent version conflict, single current revision, job claim lease, stale result rejection, atomic facility/description rollback, and publication switch after verified object promotion.
- [ ] Seed one venue administrator and a stable published profile without model-generated or Fixture business data in production code.
- [ ] Document deployed settings without values: `DASHSCOPE_API_KEY`, configurable `DASHSCOPE_MODERATION_MODEL=qwen3-vl-flash`, DashScope base URL, OSS endpoint/bucket/public base/access credentials, reviewer IDs, Mini Program API/request/upload/download legal domains, and worker command.
- [ ] Load `DASHSCOPE_API_KEY` from the shell environment without printing it. Configure a temporary/staging OSS bucket/CORS and backend settings; never copy the key into `.env`, screenshots, logs, test snapshots, commits, or client builds.
- [ ] Run the real PostgreSQL focused test; expect all migration/locking/publication cases to pass.
- [ ] With the real worker, submit exactly one acceptable venue image and confirm the DashScope request uses model `qwen3-vl-flash` with a non-empty image content block and returns `APPROVED`; submit exactly one policy-rejecting test image and confirm a fixed reason code. Do not repeatedly call the paid model once this smoke passes.
- [ ] Submit one acceptable description, one facility save, and one image reorder/cover change; confirm the user endpoint keeps the old version during review and switches the whole approved revision only after all changed items pass.
- [ ] Build/open the production-composed development HTTP mode in real WeChat DevTools at `375 × 812`; exercise every visible admin button against the real backend/OSS, then open the user page and `查看可订时段`.
- [ ] Capture final implementation/side-by-side/overlay/difference evidence for `admin-ready`, `admin-reviewing`, `admin-rejected`, and `public-published`. Record a redacted provider summary containing model ID and `image_input_present=true`, never the signed URL or secret. Visually self-review button text centering, equal status geometry, image grid, gallery, tags, 300-character layout, icons, fixed footer, and safe areas before showing the user.
- [ ] Exercise one larger iPhone safe-area profile and scroll to every bottom action; record device/runtime, real service results, and any non-blocking differences in README.
- [ ] Update the native evidence test to require four real-service states × five files = 20 current PNGs: 16 single-panel reference/implementation/overlay/difference images at `375 × 812`, four side-by-side images at `750 × 812`, four distinct implementation captures, and README metadata proving production-composed development HTTP mode rather than a Fixture source.
- [ ] Run `python -m pytest backend/tests/test_venue_profile_postgres.py -q`; expect zero failures against the real test database.
- [ ] Run `node --test tests/venue-profile-native-preview.test.mjs`; expect all 20 evidence files, exact dimensions/distinctness, production HTTP composition metadata, and four real backend result records to pass.
- [ ] Run `npm run typecheck`, `npm run lint`, `npm run build:miniprogram:development`, `npm run build:miniprogram:production`, `npm run audit:miniprogram:production`, and `git diff --check`; expect zero errors and zero forbidden paths/tokens.
- [ ] Present the final real-service evidence to the user and stop for device/user acceptance. Do not claim acceptance before the user confirms it.
- [ ] Commit: `test: verify venue profile end to end`.

### Task 14: Remove the temporary Fixture after acceptance

**Prerequisite:** Task 13 has explicit user acceptance of the real integrated journey.

**Files:**

- Delete: `miniprogram/dev/pages/venue-profile/index.json`
- Delete: `miniprogram/dev/pages/venue-profile/index.ts`
- Delete: `miniprogram/dev/pages/venue-profile/index.wxml`
- Delete: `miniprogram/dev/pages/venue-profile/index.wxss`
- Delete: `miniprogram/dev/pages/venue-profile/index.test.ts`
- Delete: `miniprogram/dev/pages/venue-profile-public/index.json`
- Delete: `miniprogram/dev/pages/venue-profile-public/index.ts`
- Delete: `miniprogram/dev/pages/venue-profile-public/index.wxml`
- Delete: `miniprogram/dev/pages/venue-profile-public/index.wxss`
- Delete: `miniprogram/dev/pages/venue-profile-public/index.test.ts`
- Delete: `miniprogram/dev/fixtures/venue-profile.ts`
- Modify: `miniprogram/dev/app-pages.json`
- Modify: `tests/venue-profile-native-preview.test.mjs`
- Modify: `tests/audit-production-package.test.mjs`

**Responsibilities and budgets:** delete only the temporary Fixture implementation and route registration; retain reference/evidence artifacts as design history. Tests change from Fixture isolation to asserting the accepted production route and continued absence of mock moderation in production.

- [ ] Add a failing cleanup assertion that rejects either Fixture route/data source after real-service acceptance is recorded.
- [ ] Delete the two Fixture pages/data and remove both routes from the development manifest; do not delete the approved reference/evidence boards.
- [ ] Delete smoke-test private/review/orphan OSS objects and restore temporary CORS entries unless they are the documented permanent Mini Program origins; retain only the approved published objects needed by the seeded staging venue.
- [ ] Update native/build tests to target the production page and preserve all production-isolation/secret checks.
- [ ] Run `node --test tests/venue-profile-native-preview.test.mjs tests/audit-production-package.test.mjs`; expect zero Fixture route/data matches and the production route present.
- [ ] Run the focused backend and Mini Program venue-profile suites, typecheck, lint, both builds, production audit, and `git diff --check`; expect zero failures.
- [ ] Commit: `chore: retire venue profile fixture`.
