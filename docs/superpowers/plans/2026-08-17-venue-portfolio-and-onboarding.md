# Venue Portfolio, Claim, and New Venue Onboarding Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make “我要出租场地” open a stable “我的场馆” portfolio for every user, then complete two real, separately reviewed journeys for claiming an existing venue or applying to create a new venue.

**Architecture:** The mini program always renders the current user's server-authoritative managed-venue list plus two stable onboarding actions. Applications live in dedicated PostgreSQL tables and never mutate `venues` or `venue_memberships` until a platform reviewer approves them. A separate, cookie-authenticated Web console exposes only onboarding review; approval rechecks duplicates and atomically grants an existing membership or creates one unlisted venue and its first membership.

**Tech Stack:** WeChat Mini Program TypeScript/WXML/WXSS, FastAPI, SQLAlchemy 2, PostgreSQL, Alembic, Alibaba Cloud OSS private objects, plain TypeScript/HTML/CSS platform console, OpenAPI, Jest, Node test runner, pytest.

**Implementation status (2026-08-18):** Tasks 1–11 and Task 12 Steps 1–4 are implemented, reviewed and deployed. The production entry, portfolio, create/claim forms and image selection have received focused iPhone confirmation. Task 12 Steps 5–7 remain: one controlled CLAIM approval, one controlled CREATE approval, final device/desktop audit, roadmap closeout and branch integration.

---

## Scope and fixed decisions

- Clicking “我要出租场地” always opens `pages/venue-access/index`; one membership never auto-redirects.
- The page title is “我的场馆”. It shows zero, one, or many authorized venue cards and always shows “认领已有场馆” and “创建新场馆”.
- A venue card opens the existing `pages/venue-profile/index?venue_id=...` workbench. The workbench provides a stable route back to “我的场馆”.
- Claim and create are different applications. Claim binds an existing `venue_id`; create carries proposed venue identity and location.
- Submitting an application never creates a venue or grants membership.
- Approval of a claim only creates or reactivates the applicant's membership for the existing venue.
- Approval of a new venue rechecks duplicates, creates one `DIRECTORY_ONLY`, `is_listed=false` venue, and creates its first active manager membership in the same transaction.
- Sensitive licenses and authorization evidence are private OSS objects. Public media URLs and `venue_images` are not used for onboarding evidence.
- The platform console is a separate Web surface. Ordinary mini-program users and venue managers cannot obtain platform permissions by knowing its URL.
- The first platform-console authentication uses deployment-provisioned, high-entropy staff access tokens whose SHA-256 hashes and roles are stored in ignored deployment configuration. A successful same-origin exchange creates an 8-hour opaque, HttpOnly, Secure, SameSite=Strict server session under `/platform-admin`. This is intentionally smaller than email/SSO and can later be replaced without changing review authorization.
- Platform roles are `PLATFORM_ADMIN` and `ONBOARDING_REVIEWER`. Both may read and decide applications; only `PLATFORM_ADMIN` may provision or revoke reviewer credentials outside this UI.
- Platform invitations and venue employee delegation remain D1 follow-ups. They do not block the first user-application-to-platform-approval closure.

## File ownership and parallel boundaries

| Workstream | Owns | Must not touch concurrently |
| --- | --- | --- |
| Mini-program visual | `miniprogram/dev/pages/venue-*`, `miniprogram/dev/venue-onboarding-fixture.ts`, native preview tests/artifacts | Backend models, OpenAPI, platform console |
| Platform-console visual | `platform-admin/dev/**`, console preview tests/artifacts | Mini-program, backend models, OpenAPI |
| Shared onboarding backend | `backend/app/models.py`, one Alembic migration, `backend/app/modules/venue_onboarding/**` | Platform review implementation until models commit |
| Platform review backend | `backend/app/modules/platform_auth/**`, `backend/app/modules/platform_onboarding/**`, platform config | Shared onboarding models before their commit |
| Production clients | mini-program HTTP/pages or `platform-admin/src/**` after OpenAPI freezes | Each other; shared build scripts are integrated serially |

The two visual workstreams may run in parallel. Backend implementation starts only after both visual surfaces pass the user gate. After the shared migration and OpenAPI commit, mini-program integration and platform-console integration may run in parallel because their production file sets are disjoint.

---

## Chunk 1: Corrected information architecture and visual gate

### Task 1: Freeze the corrected roadmap and implementation contract

**Files:**
- Modify: `docs/superpowers/plans/2026-08-16-overall-slice-roadmap.md`
- Modify: `docs/superpowers/specs/2026-08-10-intent-entry-and-venue-inventory-design.md`
- Modify: `docs/superpowers/specs/2026-08-09-three-sided-football-product-design.md`
- Modify: `docs/superpowers/plans/2026-08-16-production-intent-entry.md`
- Create: `docs/superpowers/plans/2026-08-17-venue-portfolio-and-onboarding.md`

- [ ] **Step 1: Remove the one-venue auto-entry decision**

Document one stable portfolio for zero, one, and many memberships. Preserve the current authorization predicate: active venue, active membership, and `can_manage_inventory=true`.

- [ ] **Step 2: Move onboarding before order and football-party slices**

Replace the old deferred D1 main journey with A3 immediately after the corrected portfolio. Keep only invitation and employee delegation as the later D1 extension.

- [ ] **Step 3: Verify documentation consistency**

Run:

```bash
rg -n "一个授权场馆直接|one redirects|按授权场馆数量直达|已有授权场馆直达|切片 6：场馆加盟|D1：场馆认领" docs/superpowers
```

Expected: no match outside this verification command; no active plan or current-status paragraph instructs one-venue auto-entry or defers the main claim/create journey to old D1.

- [ ] **Step 4: Commit the plan**

```bash
git add docs/superpowers/plans/2026-08-16-overall-slice-roadmap.md docs/superpowers/plans/2026-08-16-production-intent-entry.md docs/superpowers/specs/2026-08-09-three-sided-football-product-design.md docs/superpowers/specs/2026-08-10-intent-entry-and-venue-inventory-design.md docs/superpowers/plans/2026-08-17-venue-portfolio-and-onboarding.md
git commit -m "docs: plan venue portfolio and onboarding"
```

### Task 2: Build the isolated mini-program portfolio and application previews

**Files:**
- Modify: `miniprogram/dev/pages/venue-access/index.ts`
- Modify: `miniprogram/dev/pages/venue-access/index.wxml`
- Modify: `miniprogram/dev/pages/venue-access/index.wxss`
- Create: `miniprogram/dev/pages/venue-claim/index.ts`
- Create: `miniprogram/dev/pages/venue-claim/index.json`
- Create: `miniprogram/dev/pages/venue-claim/index.wxml`
- Create: `miniprogram/dev/pages/venue-claim/index.wxss`
- Create: `miniprogram/dev/pages/venue-create/index.ts`
- Create: `miniprogram/dev/pages/venue-create/index.json`
- Create: `miniprogram/dev/pages/venue-create/index.wxml`
- Create: `miniprogram/dev/pages/venue-create/index.wxss`
- Create: `miniprogram/dev/venue-onboarding-fixture.ts`
- Modify: `miniprogram/dev/app-pages.json`
- Create: `tests/venue-onboarding-native-preview.test.mjs`
- Create: `artifacts/ui/reference/venue-onboarding/index.html`
- Create: `artifacts/ui/reviews/venue-onboarding/README.md`

- [ ] **Step 1: Create the static visual reference artifact**

Create one lightweight `375 × 812` HTML artifact with named frames for: one-venue portfolio, selected claim, ready create, upload failure/retry, submitted/reviewing, and rejected with reason. This is the visual reference, not executable product code; keep it outside every mini-program build.

- [ ] **Step 2: Write the failing native-preview test**

Require these development-only states:

```text
venue-access?case=one      -> “我的场馆”, one authorized card, claim CTA, create CTA
venue-access?case=multiple -> “我的场馆”, two authorized cards, claim CTA, create CTA
venue-access?case=empty    -> empty explanation, claim CTA, create CTA
venue-claim?case=selected  -> search result selected, required evidence slots, submit action
venue-create?case=ready    -> identity, map/address, contact, evidence slots, submit action
venue-claim?case=upload-error -> failed evidence names the item and exposes retry
venue-create?case=submitted   -> submitted/reviewing status and immutable summary
venue-create?case=rejected    -> rejected status, reason, and editable retry action
```

Every button must bind to a real preview behavior. Fixture submission may show an explicit “视觉预览，不会提交” result and must never be included in `miniprogram/app.json`.

- [ ] **Step 3: Run the focused test and confirm RED**

Run: `node --test tests/venue-onboarding-native-preview.test.mjs`

Expected: FAIL because the new preview pages and CTAs do not exist.

- [ ] **Step 4: Implement the three preview pages**

Reuse the approved `#F8FAFC`, white surface, `#10243E`, trust-blue, 8rpx spacing system, dynamic capsule-safe header, 88rpx controls, native icons, and bottom safe area. Do not adopt the generic portfolio palette suggested by the design search because the user's existing entry visual is already approved.

The claim form contains:

```text
场馆搜索/候选选择
申请人姓名
联系电话状态
经营或管理授权证明
场馆现场证明
提交认领申请
```

The create form contains:

```text
场馆名称
地图位置与详细地址
行政区
申请人姓名
联系电话状态
营业执照或主体证明
产权、租赁或管理授权证明
场馆外部与内部现场证明
提交新场馆申请
```

- [ ] **Step 5: Verify preview interactions**

Test every venue card, claim/create action, back action, search selection, upload placeholder, and submit action. Labels must be horizontally and vertically centered; disabled controls must explain why.

- [ ] **Step 6: Build development and capture representative iPhone previews**

Run:

```bash
npm run build:miniprogram:development
node --test tests/venue-onboarding-native-preview.test.mjs
```

Capture at `375 × 812`: one-venue portfolio, selected claim, ready create, upload failure, reviewing, and rejected. Record reference, implementation, side-by-side, 50% overlay, and difference observations in the README. Keep the comparison focused to these behaviorally distinct states.

- [ ] **Step 7: Commit the mini-program visual preview**

```bash
git add miniprogram/dev/pages/venue-access miniprogram/dev/pages/venue-claim miniprogram/dev/pages/venue-create miniprogram/dev/venue-onboarding-fixture.ts miniprogram/dev/app-pages.json tests/venue-onboarding-native-preview.test.mjs artifacts/ui/reference/venue-onboarding/index.html artifacts/ui/reviews/venue-onboarding
git commit -m "feat: preview venue portfolio onboarding"
```

### Task 3: Build the isolated platform-review Web preview

**Files:**
- Create: `platform-admin/dev/index.html`
- Create: `platform-admin/dev/styles.css`
- Create: `platform-admin/dev/app.js`
- Create: `platform-admin/dev/fixture.js`
- Create: `tests/platform-onboarding-preview.test.mjs`
- Create: `artifacts/ui/reference/platform-onboarding/index.html`
- Create: `artifacts/ui/reviews/platform-onboarding/README.md`

- [ ] **Step 1: Create the static visual reference artifact**

Create one lightweight `1440 × 900` HTML artifact with a login frame and a review-detail frame. Include pending, approved, rejected, expired-evidence-link and decision-error presentations so no production state is invented after the gate.

- [ ] **Step 2: Write the failing static-preview test**

Require a desktop `1440 × 900` review queue with application kind/status filters, applicant and venue identity, duplicate warning, evidence list, and explicit approve/reject actions. Require a separate login state labeled “平台工作人员登录”.

- [ ] **Step 3: Run the test and confirm RED**

Run: `node --test tests/platform-onboarding-preview.test.mjs`

Expected: FAIL because `platform-admin/dev` does not exist.

- [ ] **Step 4: Implement a plain static preview**

Use the same semantic colors and typography hierarchy as the mini program, adjusted for a dense desktop review console. The preview must clearly distinguish `CLAIM` from `CREATE`, show the target existing venue only for claims, and show proposed identity/location only for creates.

- [ ] **Step 5: Exercise every control**

Fixture filters change the visible queue, selecting a row changes detail, evidence controls open a labeled preview panel, reject requires a reason, and approve/reject update only explicit Fixture state.

- [ ] **Step 6: Capture the behaviorally distinct preview states**

Capture login, pending detail, rejected detail, and decision error at `1440 × 900`; record the same reference/implementation/comparison observations without creating a broad visual regression system.

- [ ] **Step 7: Commit the platform preview**

```bash
git add platform-admin/dev tests/platform-onboarding-preview.test.mjs artifacts/ui/reference/platform-onboarding/index.html artifacts/ui/reviews/platform-onboarding
git commit -m "feat: preview platform onboarding review"
```

### Task 4: User visual confirmation gate

- [ ] **Step 1: Complete manual self-review before delivery**

Inspect button centering, repeated card alignment, icons/chevrons/close controls, clipping, fixed footer safe areas, form labels, error placement, and state truthfulness in the target runtimes.

- [ ] **Step 2: Present the two representative visual sets**

Present the mini-program portfolio/claim/create previews and the Web login/review preview. Do not change OpenAPI, database models, or production routes before explicit user approval.

---

## Chunk 2: PostgreSQL application authority and closed API contract

### Task 5: Add onboarding application and private-evidence persistence

**Files:**
- Modify: `backend/app/models.py`
- Create: `backend/migrations/versions/0011_venue_onboarding.py`
- Create: `backend/tests/test_venue_onboarding_migration.py`
- Modify: `backend/tests/test_schema_constraints.py`
- Modify: `backend/tests/test_booking_migration_cycle.py`

- [ ] **Step 1: Write failing migration and constraint tests**

Test PostgreSQL upgrade/downgrade and these invariants:

```text
CLAIM  -> target_venue_id required; proposed venue fields absent
CREATE -> target_venue_id absent; proposed identity/location required
SUBMITTED -> no reviewer/time/reason
APPROVED/REJECTED -> reviewer and reviewed_at required
one SUBMITTED CLAIM per applicant + target existing venue
one SUBMITTED CREATE per applicant + normalized proposed name + normalized address
evidence object keys are private storage keys, not public URLs
completed evidence belongs to one owner and can attach to at most one application
SUBMITTED forbids reviewer/review time/reason/approved venue
APPROVED requires reviewer, review time, nonblank reason and approved venue
REJECTED requires reviewer, review time and nonblank reason, and forbids approved venue
approved CLAIM venue equals its target venue
```

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `uv run pytest backend/tests/test_venue_onboarding_migration.py backend/tests/test_schema_constraints.py -q`

- [ ] **Step 3: Add the minimal enums and models**

Add:

```text
VenueOnboardingKind: CLAIM | CREATE
VenueOnboardingStatus: SUBMITTED | APPROVED | REJECTED
VenueOnboardingEvidenceKind:
  BUSINESS_LICENSE | MANAGEMENT_AUTHORIZATION | VENUE_EXTERIOR | VENUE_INTERIOR
```

`venue_onboarding_applications` stores applicant, kind, optional target venue, proposed venue identity/location, normalized name/address, an encrypted verified-phone snapshot, contact name, status, submission time, reviewer principal ID, review time/reason, and approved venue ID. Decrypt the verified `users` phone with its existing AAD and re-encrypt it with application-record AAD; ciphertext must never be copied between records.

`venue_onboarding_evidence` is also the minimal pre-application upload attempt. It stores owner user ID, nullable application ID, evidence kind, `UPLOADING|COMPLETED` state, private OSS object key, content type, byte size, SHA-256, and creation time. Upload intent creation authenticates the caller and creates an unattached owner-scoped row; completion requires the same owner and verifies the object; submission row-locks each requested evidence row, validates the same owner, required kind and `COMPLETED` state, then attaches it to exactly one newly created application in the same transaction. No separate draft model is added.

- [ ] **Step 4: Implement the Alembic migration**

Set revision `0011` with `down_revision="0010"`. Use named checks, foreign keys, a partial unique index for pending claims, and a partial unique index for pending creates. Do not add pending applications to `venues` or `venue_memberships`. Update the existing migration-head assertion from `0010` to `0011` in this task; Task 8 advances it to `0012`.

- [ ] **Step 5: Run migration tests and commit**

```bash
uv run pytest backend/tests/test_venue_onboarding_migration.py backend/tests/test_schema_constraints.py -q
git add backend/app/models.py backend/migrations/versions/0011_venue_onboarding.py backend/tests/test_venue_onboarding_migration.py backend/tests/test_schema_constraints.py backend/tests/test_booking_migration_cycle.py
git commit -m "feat: persist venue onboarding applications"
```

### Task 6: Freeze candidate search, application, status, and upload contracts

**Files:**
- Modify: `contracts/openapi.yaml`
- Create: `contracts/examples/venue-onboarding-candidates.json`
- Create: `contracts/examples/venue-claim-submitted.json`
- Create: `contracts/examples/venue-create-submitted.json`
- Create: `contracts/examples/venue-onboarding-applications.json`
- Create: `contracts/examples/venue-onboarding-upload-intent.json`
- Create: `contracts/examples/error-possible-duplicate-venue.json`
- Create: `contracts/examples/error-onboarding-evidence-required.json`
- Modify: `scripts/validate-contract.mjs`
- Modify: `backend/tests/test_openapi_conformance.py`

- [ ] **Step 1: Write failing conformance checks**

Freeze these authenticated mini-program operations:

```text
GET  /api/v1/venue-onboarding/candidates?q=
POST /api/v1/venue-onboarding/evidence/upload-intents
POST /api/v1/venue-onboarding/evidence/{evidence_id}/complete
POST /api/v1/venue-onboarding/claims
POST /api/v1/venue-onboarding/venues
GET  /api/v1/venue-onboarding/applications
```

All mutation operations require `Idempotency-Key`. Closed responses expose evidence IDs/statuses, never private OSS keys or reviewer-only material. Claim submission requires `MANAGEMENT_AUTHORIZATION` and `VENUE_EXTERIOR`; create submission requires `BUSINESS_LICENSE`, `MANAGEMENT_AUTHORIZATION`, `VENUE_EXTERIOR`, and `VENUE_INTERIOR`. Both require an already verified user phone, which the server snapshots rather than trusting a client phone string.

Both claim and create requests collect the applicant's `contact_name` (1..40) explicitly. Create requests also carry the selected six-digit `district_code`, `district_name`, `latitude`, and `longitude`; the backend must persist those real values and must not manufacture placeholder locations or applicant names.

Freeze the following transport details in schemas and examples:

```text
candidates: listed + active venues only; q length 2..80; cursor pagination; limit 1..20
document evidence: image/jpeg, image/png, application/pdf; max 10 MiB
exterior/interior evidence: image/jpeg or image/png; max 15 MiB
one completed evidence item for each required kind
upload intent: owner-bound evidence_id + short-lived POST policy, never a private object key in later closed responses
complete: server streams the private object under the per-kind hard limit, computes size/SHA-256, and validates its actual JPEG/PNG decode or PDF signature; client metadata is not authoritative; 200 replay, 409 same-key mismatch
submit: 201 first result, 200 idempotent replay, 409 same-key mismatch or duplicate state
applications: newest-first cursor page, limit 1..20, only the authenticated applicant
```

- [ ] **Step 2: Define stable error semantics**

Use `POSSIBLE_DUPLICATE_VENUE`, `ONBOARDING_EVIDENCE_REQUIRED`, `ONBOARDING_EVIDENCE_INVALID`, `ONBOARDING_APPLICATION_EXISTS`, `ONBOARDING_APPLICATION_NOT_FOUND`, `ONBOARDING_APPLICATION_STATE_CHANGED`, `IDEMPOTENCY_KEY_REUSED`, and existing authentication/service errors. A duplicate among public listed venues may include the safe claim candidate; a match against an unlisted venue returns only a generic conflict and never exposes its identity or location.

- [ ] **Step 3: Validate and commit the contract**

```bash
npm run contract:validate
uv run pytest backend/tests/test_openapi_conformance.py -q
git add contracts/openapi.yaml contracts/examples/venue-onboarding-candidates.json contracts/examples/venue-claim-submitted.json contracts/examples/venue-create-submitted.json contracts/examples/venue-onboarding-applications.json contracts/examples/venue-onboarding-upload-intent.json contracts/examples/error-possible-duplicate-venue.json contracts/examples/error-onboarding-evidence-required.json scripts/validate-contract.mjs backend/tests/test_openapi_conformance.py
git commit -m "feat: define venue onboarding contract"
```

### Task 7: Implement candidate search, private evidence upload, and submission

**Files:**
- Create: `backend/app/modules/venue_onboarding/__init__.py`
- Create: `backend/app/modules/venue_onboarding/dto.py`
- Create: `backend/app/modules/venue_onboarding/repository.py`
- Create: `backend/app/modules/venue_onboarding/service.py`
- Create: `backend/app/modules/venue_onboarding/router.py`
- Create: `backend/app/modules/venue_onboarding/storage.py`
- Create: `backend/app/modules/venue_onboarding/oss_storage.py`
- Modify: `backend/app/main.py`
- Modify: `backend/app/config.py`
- Create: `backend/tests/test_venue_onboarding_api.py`
- Create: `backend/tests/test_venue_onboarding_service.py`

- [ ] **Step 1: Write failing service and API tests**

Cover authentication, candidate search, claim/create field separation, required evidence, private object completion, idempotent replay, same-key mismatch, duplicate application, fuzzy duplicate warning, application listing isolation, and no `venues`/membership mutation on submit.

- [ ] **Step 2: Confirm RED**

Run: `uv run pytest backend/tests/test_venue_onboarding_api.py backend/tests/test_venue_onboarding_service.py -q`

- [ ] **Step 3: Implement private OSS evidence storage**

Use a dedicated private onboarding bucket setting rather than the public venue-media origin. Issue short-lived direct-upload policies restricted to `venue-onboarding/{user_id}/{evidence_id}/...` and force private ACL. On completion, the API itself streams the private object with a hard byte limit, computes the stored byte size and SHA-256, verifies JPEG/PNG with Pillow or checks the permitted PDF signature/ending, and rejects type/extension mismatches before marking the row `COMPLETED`; client-provided metadata and OSS custom metadata are never treated as proof of the bytes. Only issue short-lived, attachment-oriented reviewer download URLs through the platform API.

- [ ] **Step 4: Implement applications and duplicate checks**

Candidate search returns safe identity fields for `is_active=true AND is_listed=true` venues only. Internal duplicate checks may inspect all active venues. Normalize text with Unicode NFKC, collapsed whitespace and case folding. Create submission treats an exact normalized address or any active venue within 300 meters as a possible duplicate; it returns `409 POSSIBLE_DUPLICATE_VENUE`, including a safe candidate only when that venue is publicly listed. Approval repeats the same rule under serialization before creating a venue.

- [ ] **Step 5: Verify no implicit authorization**

Tests must assert that submission creates neither a `Venue` nor `VenueMembership` and that one user cannot read another user's application.

- [ ] **Step 6: Run focused checks and commit**

```bash
uv run pytest backend/tests/test_venue_onboarding_api.py backend/tests/test_venue_onboarding_service.py backend/tests/test_openapi_conformance.py -q
uv run ruff check backend/app/modules/venue_onboarding backend/tests/test_venue_onboarding_api.py backend/tests/test_venue_onboarding_service.py
git add backend/app/modules/venue_onboarding backend/app/main.py backend/app/config.py backend/tests/test_venue_onboarding_api.py backend/tests/test_venue_onboarding_service.py backend/tests/test_openapi_conformance.py
git commit -m "feat: submit venue onboarding applications"
```

---

## Chunk 3: Platform authentication, review, and approval transaction

### Task 8: Add minimal independent platform-session authentication

**Files:**
- Modify: `backend/app/config.py`
- Modify: `backend/app/models.py`
- Create: `backend/migrations/versions/0012_platform_sessions.py`
- Create: `backend/app/modules/platform_auth/__init__.py`
- Create: `backend/app/modules/platform_auth/dto.py`
- Create: `backend/app/modules/platform_auth/repository.py`
- Create: `backend/app/modules/platform_auth/service.py`
- Create: `backend/app/modules/platform_auth/router.py`
- Modify: `backend/app/main.py`
- Create: `backend/tests/test_platform_auth.py`
- Create: `backend/tests/test_platform_session_migration.py`
- Modify: `backend/tests/test_booking_migration_cycle.py`
- Modify: `contracts/openapi.yaml`
- Create: `contracts/examples/platform-session.json`
- Modify: `backend/tests/test_openapi_conformance.py`

- [ ] **Step 1: Write failing authentication tests**

First freeze, then cover `POST /platform-admin/api/v1/auth/session`, `GET /platform-admin/api/v1/auth/session`, and `DELETE /platform-admin/api/v1/auth/session` in OpenAPI. `POST` exchanges a raw deployment token, sets the cookie, and returns principal/roles plus a CSRF token. `GET` restores the session and returns the same derivable CSRF value after reload. `DELETE` requires origin + CSRF and revokes the session. Test invalid token, disabled/removed principal, missing role, secure cookie attributes, 8-hour expiry, logout/revocation, CSRF header on mutations, and denial of ordinary WeChat bearer sessions.

- [ ] **Step 2: Add ignored deployment principal configuration**

Parse a closed JSON array from a secret setting:

```json
[{"principal_id":"ops-1","display_name":"平台审核员","token_sha256":"64-lower-hex","enabled":true,"roles":["ONBOARDING_REVIEWER"]}]
```

Never log raw access tokens or return configured hashes.

- [ ] **Step 3: Implement opaque server sessions**

Set revision `0012` with `down_revision="0011"`; test PostgreSQL upgrade/downgrade and advance the existing head assertion to `0012`. Store only session-token hashes, principal ID, issued/expiry/revoked timestamps. Derive the reload-safe CSRF value as an HMAC of the stored session hash with a dedicated ignored `PLATFORM_CSRF_SECRET`; return it from POST/GET but never persist its plaintext. Set `HttpOnly; Secure; SameSite=Strict; Path=/platform-admin` and reject `/platform-admin/api/v1/**` without an active session and required role. On every request re-read the configured principal, require `enabled=true`, and recheck its current roles; removed/disabled principals immediately lose access. Mutation routes also require same-origin `Origin` and `X-CSRF-Token` checks.

- [ ] **Step 4: Verify and commit**

```bash
uv run pytest backend/tests/test_platform_auth.py backend/tests/test_platform_session_migration.py backend/tests/test_openapi_conformance.py -q
uv run ruff check backend/app/modules/platform_auth backend/tests/test_platform_auth.py
git add backend/app/config.py backend/app/models.py backend/migrations/versions/0012_platform_sessions.py backend/app/modules/platform_auth backend/app/main.py backend/tests/test_platform_auth.py backend/tests/test_platform_session_migration.py backend/tests/test_booking_migration_cycle.py contracts/openapi.yaml contracts/examples/platform-session.json backend/tests/test_openapi_conformance.py
git commit -m "feat: authenticate platform reviewers"
```

### Task 9: Implement the review queue and atomic decisions

**Files:**
- Create: `backend/app/modules/platform_onboarding/__init__.py`
- Create: `backend/app/modules/platform_onboarding/dto.py`
- Create: `backend/app/modules/platform_onboarding/repository.py`
- Create: `backend/app/modules/platform_onboarding/service.py`
- Create: `backend/app/modules/platform_onboarding/router.py`
- Modify: `backend/app/main.py`
- Modify: `contracts/openapi.yaml`
- Create: `contracts/examples/platform-onboarding-queue.json`
- Create: `contracts/examples/platform-onboarding-detail.json`
- Create: `contracts/examples/platform-onboarding-decision.json`
- Create: `backend/tests/test_platform_onboarding_api.py`
- Create: `backend/tests/test_platform_onboarding_service.py`

- [ ] **Step 1: Write failing queue and decision tests**

Freeze and cover:

```text
GET  /platform-admin/api/v1/onboarding/applications?kind=&status=&cursor=
GET  /platform-admin/api/v1/onboarding/applications/{application_id}
GET  /platform-admin/api/v1/onboarding/evidence/{evidence_id}/download
POST /platform-admin/api/v1/onboarding/applications/{application_id}/decisions
```

Cover role enforcement, safe cursor pagination (`limit` 1..50) and filters, private evidence URL expiry, a mandatory nonblank reason for both approval and rejection, concurrent decision protection, and immutable decided applications. A repeated byte-equivalent decision on an already decided application returns the existing `200` decision; any different outcome or reason returns `409 ONBOARDING_APPLICATION_STATE_CHANGED`. No extra platform idempotency table is added because the application row is the single decision authority.

- [ ] **Step 2: Write the claim approval transaction test**

Lock the application and target venue, recheck status, and create or reactivate exactly one membership for the applicant and existing `venue_id`. Assert no new venue exists and the membership ends with `is_active=true` and `can_manage_inventory=true`.

- [ ] **Step 3: Write the create approval transaction test**

Lock the application, then acquire one transaction-scoped PostgreSQL advisory lock dedicated to CREATE approvals. This deliberately serializes the low-volume approval operation. Repeat exact/fuzzy duplicate checks inside that critical section, generate a stable unique slug, create one active `DIRECTORY_ONLY`, `is_listed=false` venue, create its first membership with `is_active=true` and `can_manage_inventory=true`, set `approved_venue_id`, and finalize the review atomically. A duplicate found at approval returns a conflict and leaves all records unchanged.

- [ ] **Step 4: Implement queue, detail, evidence and decisions**

The review API returns only to platform sessions with the required role. Every decision records principal ID, timestamp, outcome and a trimmed nonblank reason; decided application rows are immutable. Request IDs remain in normal error envelopes.

- [ ] **Step 5: Verify and commit**

```bash
uv run pytest backend/tests/test_platform_onboarding_api.py backend/tests/test_platform_onboarding_service.py backend/tests/test_openapi_conformance.py -q
npm run contract:validate
git add backend/app/modules/platform_onboarding backend/app/main.py backend/tests/test_platform_onboarding_api.py backend/tests/test_platform_onboarding_service.py backend/tests/test_openapi_conformance.py contracts/openapi.yaml contracts/examples/platform-onboarding-queue.json contracts/examples/platform-onboarding-detail.json contracts/examples/platform-onboarding-decision.json
git commit -m "feat: review venue onboarding applications"
```

---

## Chunk 4: Production clients and release closure

### Task 10: Promote “我的场馆” and onboarding forms to production

**Files:**
- Modify: `miniprogram/pages/venue-access/index.ts`
- Modify: `miniprogram/pages/venue-access/index.wxml`
- Modify: `miniprogram/pages/venue-access/index.wxss`
- Modify: `miniprogram/pages/venue-access/index.test.ts`
- Modify: `miniprogram/pages/intent-entry/index.ts`
- Modify: `miniprogram/pages/intent-entry/index.test.ts`
- Create: `miniprogram/pages/venue-claim/index.ts`
- Create: `miniprogram/pages/venue-claim/index.json`
- Create: `miniprogram/pages/venue-claim/index.wxml`
- Create: `miniprogram/pages/venue-claim/index.wxss`
- Create: `miniprogram/pages/venue-claim/index.test.ts`
- Create: `miniprogram/pages/venue-create/index.ts`
- Create: `miniprogram/pages/venue-create/index.json`
- Create: `miniprogram/pages/venue-create/index.wxml`
- Create: `miniprogram/pages/venue-create/index.wxss`
- Create: `miniprogram/pages/venue-create/index.test.ts`
- Create: `miniprogram/domain/venue-onboarding.ts`
- Create: `miniprogram/domain/venue-onboarding.test.ts`
- Create: `miniprogram/services/venue-onboarding.ts`
- Create: `miniprogram/services/http-venue-onboarding.ts`
- Create: `miniprogram/services/http-venue-onboarding.test.ts`
- Modify: `miniprogram/pages/venue-profile/index.ts`
- Modify: `miniprogram/pages/venue-profile/index.test.ts`
- Modify: `miniprogram/app.json`
- Modify: `miniprogram/dev/bootstrap.ts`
- Modify: `scripts/build-miniprogram.mjs`
- Modify: `tests/build-miniprogram.test.mjs`

- [ ] **Step 1: Write failing controller, decoder and HTTP tests**

Require the corrected entry subtitle “申请合作，或进入已授权的场馆工作台”, portfolio rendering for zero/one/many, venue selection, both onboarding routes, workbench return, bearer login/relogin, direct upload, submission idempotency, duplicate conversion from create to claim, per-evidence retryable errors, and submitted/reviewing/rejected application status display. In `tests/build-miniprogram.test.mjs`, first change the expected production manifest from ten to twelve routes, require both new native page artifacts, require the isolated Fixture in development preview output, and forbid Fixture/reference source in production output.

- [ ] **Step 2: Confirm RED**

Run these independently so both RED results are observed:

```bash
npx jest miniprogram/pages/intent-entry/index.test.ts miniprogram/pages/venue-access/index.test.ts miniprogram/pages/venue-claim/index.test.ts miniprogram/pages/venue-create/index.test.ts miniprogram/domain/venue-onboarding.test.ts miniprogram/services/http-venue-onboarding.test.ts --runInBand
node --test tests/build-miniprogram.test.mjs
```

- [ ] **Step 3: Implement from the approved visual files**

Production imports no `miniprogram/dev` files. Evidence uploads use real OSS upload intents and show per-item uploading/error/completed state. Submit stays disabled until required identity, contact and evidence are complete.

- [ ] **Step 4: Register routes and remove auto-redirect**

Add claim/create routes to `miniprogram/app.json`. Implement the already-failing production build assertion for twelve routes, assert all new native artifacts are emitted, require the isolated Fixture only in development preview output, and assert no Fixture/reference source reaches production output. The portfolio always renders after loading, and the existing workbench back action routes to `/pages/venue-access/index`.

- [ ] **Step 5: Verify and commit**

```bash
npx jest miniprogram/pages/intent-entry/index.test.ts miniprogram/pages/venue-access/index.test.ts miniprogram/pages/venue-claim/index.test.ts miniprogram/pages/venue-create/index.test.ts miniprogram/domain/venue-onboarding.test.ts miniprogram/services/http-venue-onboarding.test.ts --runInBand
node --test tests/build-miniprogram.test.mjs
npm run typecheck
git add miniprogram/pages/intent-entry/index.ts miniprogram/pages/intent-entry/index.test.ts miniprogram/pages/venue-access miniprogram/pages/venue-claim miniprogram/pages/venue-create miniprogram/pages/venue-profile/index.ts miniprogram/pages/venue-profile/index.test.ts miniprogram/domain/venue-onboarding.ts miniprogram/domain/venue-onboarding.test.ts miniprogram/services/venue-onboarding.ts miniprogram/services/http-venue-onboarding.ts miniprogram/services/http-venue-onboarding.test.ts miniprogram/app.json miniprogram/dev/bootstrap.ts scripts/build-miniprogram.mjs tests/build-miniprogram.test.mjs
git commit -m "feat: submit venue onboarding from my venues"
```

### Task 11: Promote the platform console to production

**Files:**
- Create: `platform-admin/index.html`
- Create: `platform-admin/styles.css`
- Create: `platform-admin/src/api.ts`
- Create: `platform-admin/src/auth.ts`
- Create: `platform-admin/src/review.ts`
- Create: `platform-admin/src/main.ts`
- Create: `platform-admin/src/*.test.ts`
- Create: `scripts/build-platform-admin.mjs`
- Modify: `package.json`
- Modify: `backend/app/main.py`
- Create: `backend/app/modules/platform_web.py`
- Create: `tests/build-platform-admin.test.mjs`
- Create: `backend/tests/test_platform_web.py`
- Modify: `backend/Dockerfile`
- Modify: `deploy/Caddyfile`
- Modify: `compose.yaml`

- [ ] **Step 1: Write failing Web client and build-isolation tests**

Test login, cookie session bootstrap, CSRF propagation, queue filters, detail selection, evidence expiry handling, mandatory decision reason, double-submit protection, session expiry, and production output excluding `platform-admin/dev` Fixture. Add failing server-route tests for `/platform-admin`, its static assets, unauthorized API denial, restrictive CSP including `frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and `Cache-Control: no-store` on authenticated HTML/API responses.

- [ ] **Step 2: Run the focused tests and confirm RED**

```bash
npx jest platform-admin/src --runInBand
node --test tests/build-platform-admin.test.mjs
uv run pytest backend/tests/test_platform_web.py -q
```

Expected: all three checks fail for the missing production console/build/server route.

- [ ] **Step 3: Implement the approved console**

Use plain TypeScript modules and a focused build script whose only output is `platform-admin/dist`. Add a Node build stage to `backend/Dockerfile`, copy that exact output into the final API image, serve it only under `/platform-admin`, and proxy `/platform-admin*` to the API in `deploy/Caddyfile`. Keep the API service as the only console runtime in `compose.yaml`; API authorization remains server-side and does not depend on hidden links.

- [ ] **Step 4: Add security headers**

Set a restrictive CSP, `frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, no-store on authenticated HTML/API responses, and origin/CSRF validation for mutations.

- [ ] **Step 5: Verify and commit**

```bash
npx jest platform-admin/src --runInBand
node --test tests/build-platform-admin.test.mjs
uv run pytest backend/tests/test_platform_web.py -q
npm run build:platform-admin
git add platform-admin/index.html platform-admin/styles.css platform-admin/src platform-admin/tsconfig.json scripts/build-platform-admin.mjs package.json backend/app/modules/platform_web.py backend/app/main.py backend/Dockerfile backend/tests/test_platform_web.py deploy/Caddyfile compose.yaml tests/build-platform-admin.test.mjs
git commit -m "feat: operate venue onboarding reviews"
```

### Task 12: End-to-end verification, deployment and honest handoff

**Files:**
- Modify: `deploy/README.md`
- Modify: `deploy/.env.example`
- Modify: `compose.yaml`
- Modify: `deploy/Caddyfile`
- Modify: `scripts/prepare_live_deploy.py`
- Modify: `scripts/preflight_deploy.py`
- Modify: `backend/tests/test_prepare_live_deploy.py`
- Modify: `backend/tests/test_deploy_preflight.py`
- Modify: `artifacts/ui/reviews/venue-onboarding/README.md`
- Modify: `artifacts/ui/reviews/platform-onboarding/README.md`

- [ ] **Step 1: Make the standard ignored live-config flow complete**

First add failing focused tests, then extend `prepare_live_deploy.py` and `preflight_deploy.py` so rerunning the existing standard command cannot erase or omit the new settings:

```text
ONBOARDING_OSS_BUCKET: required dedicated private bucket name; read from environment or secure prompt on first setup
PLATFORM_STAFF_PRINCIPALS_JSON: preserve an existing valid value; otherwise securely prompt for a >=32-character reviewer token and store only its SHA-256 with one enabled ONBOARDING_REVIEWER principal
PLATFORM_CSRF_SECRET: generate 32 random bytes, encode Base64, preserve on rerun
```

The generator must never print the raw reviewer token or hashes, and all generated files remain mode `0600`. Preflight validates the bucket name, closed principal JSON/roles/hash, and canonical 32-byte CSRF secret. Add the three settings to `compose.yaml` and `deploy/.env.example`.

Run:

```bash
uv run pytest backend/tests/test_prepare_live_deploy.py backend/tests/test_deploy_preflight.py -q
```

- [ ] **Step 2: Run focused full-slice checks once**

```bash
uv run pytest backend/tests/test_venue_onboarding_migration.py backend/tests/test_venue_onboarding_api.py backend/tests/test_venue_onboarding_service.py backend/tests/test_platform_auth.py backend/tests/test_platform_session_migration.py backend/tests/test_platform_onboarding_api.py backend/tests/test_platform_onboarding_service.py backend/tests/test_platform_web.py backend/tests/test_openapi_conformance.py -q
npx jest miniprogram/pages/venue-access/index.test.ts miniprogram/pages/venue-claim/index.test.ts miniprogram/pages/venue-create/index.test.ts miniprogram/domain/venue-onboarding.test.ts miniprogram/services/http-venue-onboarding.test.ts platform-admin/src --runInBand
npm run typecheck
npm run contract:validate
```

- [ ] **Step 3: Build and audit both production clients**

```bash
bash -c 'set -a; source deploy/miniprogram.live.local; set +a; npm run build:miniprogram:production'
npm run audit:miniprogram-package
npm run build:platform-admin
node --test tests/build-platform-admin.test.mjs
```

- [ ] **Step 4: Deploy migration, API and platform console**

Load ignored staff-principal hashes and private OSS settings, run Alembic, deploy one API revision, then verify health and unauthorized denial before any real decision.

- [ ] **Step 5: Perform two controlled real end-to-end acceptances**

Run both distinct journeys once with non-sensitive test evidence. Claim: choose an already existing venue for which the fresh applicant has no membership, confirm submission grants nothing, approve once, then confirm exactly one active/manage-capable membership and no new venue. Create: use a proposed venue absent from `venues`, confirm submission creates neither venue nor membership, approve once, then confirm exactly one unlisted venue and one active/manage-capable first membership. Reuse the minimum required evidence fixtures and do not repeat uploads beyond these two controlled applications.

- [ ] **Step 6: Complete manual visual and button audit**

On target iPhone and desktop viewport, click every visible action once and check centering, alignment, safe areas, loading, validation, error/retry, decision confirmation, back navigation, session expiry and status truthfulness.

- [ ] **Step 7: Final review and branch completion**

Request one final specification review and one final code-quality/security review. Resolve Critical/Important issues, update roadmap status, then use `superpowers:finishing-a-development-branch` for integration.
