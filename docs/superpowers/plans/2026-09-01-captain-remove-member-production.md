# C2e Captain Member Removal Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an order owner safely remove one eligible joined member before kickoff, preserve an immutable audit, optionally promote exactly one FIFO waitlisted member when the game was full, and expose honest captain/player readback in the real mini program.

**Architecture:** Extend the existing open-game-registration aggregate instead of adding a second membership store. A new owner-only member roster and idempotent remove endpoint share the existing `Order → OpenGame → Registration → FIFO head` lock order, while migration `0023` adds `REMOVED` and an append-only audit. A dedicated captain member page uses the existing HTTP source and persistent registration attempt store; development-only preview routes exercise the same interaction states without shipping fixtures.

**Tech Stack:** FastAPI, Pydantic v2, SQLAlchemy 2, PostgreSQL/Alembic, TypeScript, WeChat Mini Program WXML/WXSS, Jest, Node test runner, pytest/Hypothesis.

---

## Chunk 1: Contract, lifecycle, and persistence

### Task 1: Freeze the closed member-management contract

**Files:**
- Create: `tests/captain-member-removal-contract.test.mjs`
- Create: `contracts/examples/open-game-member-roster-ready.json`
- Create: `contracts/examples/open-game-member-roster-blocked.json`
- Create: `contracts/examples/open-game-member-removal-promoted.json`
- Create: `contracts/examples/open-game-member-removal-open-spot.json`
- Modify: `contracts/openapi.yaml`
- Modify: `scripts/validate-contract.mjs`

- [ ] Write contract tests first for both paths, owner-only security, exact request/response fields, 1..120 trimmed reason, exact error matrix, new `REMOVED` read status, and examples with no private user/order/payment fields.
- [ ] Run `node --test tests/captain-member-removal-contract.test.mjs` and confirm RED because paths/schemas/examples are absent.
- [ ] Add the minimal OpenAPI schemas, examples, and validator wiring; keep every object closed and preserve existing examples by adding only required nullable `removed_at` where appropriate.
- [ ] Run the focused contract test and `npm run contract:validate`; expect PASS.
- [ ] Commit contract and examples.

### Task 2: Define pure lifecycle and privacy projections

**Files:**
- Create: `backend/tests/test_open_game_member_removal_lifecycle.py`
- Modify: `backend/app/modules/open_game_registrations/lifecycle.py`
- Modify: `backend/app/modules/open_game_registrations/dto.py`
- Modify: `backend/app/modules/open_game_registrations/privacy.py`
- Modify: `backend/tests/test_open_game_registration_lifecycle.py`
- Modify: `backend/tests/test_open_game_registration_withdrawal_lifecycle.py`

- [ ] Write RED tests for the exact removal blocker matrix, closed/frozen roster and result DTOs, reason normalization/privacy rejection, `REMOVED` viewer lifecycle, removal timestamp invariants, and absence of reason from player projections.
- [ ] Run the focused lifecycle tests and confirm failures are due to missing models/status.
- [ ] Add `MemberRemovalBlockedReason`, `MemberRemovalActions`, roster/result DTOs, `REMOVED` effective/persisted status, nullable player `removed_at`, and explicit whitelist projectors.
- [ ] Update stale exact C2d field assertions encountered on the base only where they describe the current contract.
- [ ] Run focused lifecycle tests and commit.

### Task 3: Persist REMOVED and append-only audit

**Files:**
- Create: `backend/migrations/versions/0023_open_game_member_removals.py`
- Create: `backend/tests/test_open_game_member_removal_migration.py`
- Modify: `backend/app/models.py`

- [ ] Write migration tests first for 0022→0023 upgrade, enum/columns/FKs/checks/indexes, valid direct/promoted removals, invalid lifecycle matrices, append-only UPDATE/DELETE rejection, and fail-closed downgrade with history.
- [ ] Run with `TEST_DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test` and confirm RED because revision 0023 is missing.
- [ ] Implement reversible enum rebuild, paired removal columns, updated registration constraints, `OpenGameMemberRemoval` model/table, and append-only trigger.
- [ ] Run the migration tests plus registration schema/migration regressions; commit.

## Chunk 2: Backend transaction and HTTP API

### Task 4: Implement repository and service transaction

**Files:**
- Create: `backend/tests/test_open_game_member_removal_service.py`
- Modify: `backend/app/modules/open_game_registrations/repository.py`
- Modify: `backend/app/modules/open_game_registrations/service.py`

- [ ] Write RED tests for owner roster privacy/order, eligibility projection, successful non-full removal, full removal plus exact FIFO promotion/outbox, same-key replay, changed-key rejection, stale/terminal/attendance/authority blockers, rollback on audit/outbox/idempotency failure, and no removed-member notification.
- [ ] Run focused tests against disposable PostgreSQL and confirm RED on missing service methods.
- [ ] Add repository locate/list/audit methods and service `get_member_roster` / `remove_member` using the fixed lock order and one clock snapshot.
- [ ] Ensure the audit captures both version transitions and is committed atomically with idempotency and optional promotion.
- [ ] Run service tests and the existing withdrawal/waitlist/concurrency regressions; commit.

### Task 5: Expose strict FastAPI routes

**Files:**
- Create: `backend/tests/test_open_game_member_removal_api.py`
- Modify: `backend/app/modules/open_game_registrations/router.py`
- Modify: `backend/app/main.py` only if route aligner registration requires it

- [ ] Write RED tests for GET/POST auth, strict UUID/header/body validation, symmetric privacy 404, exact 409/422/503 envelopes, route precedence, and byte-stable replay.
- [ ] Add route schemas/aligner and handlers with the same repository session and injected clock.
- [ ] Run focused API tests and generated OpenAPI comparison; commit.

## Chunk 3: Real mini-program transport and user journey

### Task 6: Add strict TypeScript domain, decoder, transport, and durable attempt

**Files:**
- Modify: `miniprogram/domain/open-game-registration.ts`
- Modify: `miniprogram/domain/open-game-registration-decoder.ts`
- Modify: `miniprogram/domain/open-game-registration-decoder.test.ts`
- Modify: `miniprogram/services/open-game-registration.ts`
- Modify: `miniprogram/services/open-game-registration.test.ts`
- Modify: `miniprogram/services/open-game-registration-attempt-store.ts`
- Modify: `miniprogram/services/open-game-registration-attempt-store.test.ts`
- Modify: `miniprogram/services/http-open-game-registration.ts`
- Modify: `miniprogram/services/http-open-game-registration.test.ts`

- [ ] Write RED tests for exact roster/result decoding, `REMOVED` readback, malformed pair rejection, remove request mapping, definitive/unknown errors, same-attempt persistence, account binding, and same-key recovery.
- [ ] Add the minimum types and source methods `getMembers` / `removeMember`; extend the existing attempt union with `remove-member` and strict storage validation.
- [ ] Ensure unknown mutation recovery only replays the persisted attempt and never creates a new key.
- [ ] Run focused Jest and typecheck; commit.

### Task 7: Build the captain member-management production page

**Files:**
- Create: `miniprogram/pages/captain-game-members/index.ts`
- Create: `miniprogram/pages/captain-game-members/index.wxml`
- Create: `miniprogram/pages/captain-game-members/index.wxss`
- Create: `miniprogram/pages/captain-game-members/index.json`
- Create: `miniprogram/pages/captain-game-members/index.test.ts`
- Modify: `miniprogram/app.json`
- Modify: `miniprogram/pages/captain-game-manage/index.ts`
- Modify: `miniprogram/pages/captain-game-manage/index.wxml`
- Modify: `miniprogram/pages/captain-game-manage/index.test.ts`
- Modify: `miniprogram/pages/captain-game-public/index.ts`
- Modify: `miniprogram/pages/captain-game-public/index.wxml`
- Modify: `miniprogram/pages/captain-game-public/index.test.ts`
- Modify: `miniprogram/pages/my-game-registrations/index.ts`
- Modify: `miniprogram/pages/my-game-registrations/index.test.ts`

- [ ] Write page RED tests for route validation, owner roster, selection freeze, trimmed reason errors, disabled/centered confirmation, real submit, success/promotion copy, conflict refresh, login/account recovery, unknown replay, stale response guards, navigation, and `REMOVED` player/list labels.
- [ ] Add the production route and entry button, then implement the page with one scroll surface, safe-area confirmation sheet, >=88rpx targets, explicit flex centering, stable rows, and no nested interactive controls.
- [ ] Wire every visible button to navigation, HTTP/recovery, retry, or close behavior.
- [ ] Run the focused page suites and typecheck; commit.

### Task 8: Add isolated development scenarios and self-reviewable preview

**Files:**
- Create: `miniprogram/dev/c2e-member-removal-fixture.ts`
- Create: `miniprogram/dev/c2e-member-removal-fixture.test.ts`
- Create: `miniprogram/dev/c2e-member-removal-pages.json`
- Create: `miniprogram/dev/pages/c2e-member-removal-scenario/index.{ts,json,wxml,wxss}`
- Create: `miniprogram/dev/pages/c2e-member-removal/index.{ts,json,wxml,wxss}`
- Create: `tests/captain-member-removal-native-preview.test.mjs`
- Modify: `miniprogram/dev/app-pages.json`
- Modify: `scripts/audit-production-package.mjs`

- [ ] Write RED fixture/native tests for six approved scenarios, real local transitions, page inventory, 375/411 responsive/safe-area rules, handler completeness, and production exclusion.
- [ ] Implement the minimal scenario launcher and interactive preview using the production visual hierarchy and development-only fixture marker.
- [ ] Build development; manually self-check representative ready/confirm/promoted/blocked states in the target runtime, fixing only visible defects.
- [ ] Build production with payment disabled and a format-valid map key; audit that all C2e fixtures/dev routes/names are absent; commit.

## Chunk 4: Journey verification and handoff

### Task 9: Verify the real HTTP journey and regression boundary

**Files:**
- Create: `backend/tests/test_open_game_member_removal_http_journey.py`
- Modify: `docs/superpowers/specs/2026-09-01-captain-remove-member-production-design.md` only if implementation evidence clarifies a frozen invariant

- [ ] Write an HTTP journey first and prove RED on a clean pre-C2e base: owner lists full roster, removes one member, FIFO candidate joins, replay is byte-stable, owner/player readback is current, order/payment unchanged, exactly one promotion outbox exists, and no removed-member event exists.
- [ ] Run GREEN against 0023 and the real Uvicorn app.
- [ ] Run focused contract, Python, Jest, typecheck, lint, production build/audit, and `git diff --check` serially.
- [ ] Record any pre-existing unrelated baseline failure separately; do not weaken the C2e gate.
- [ ] Commit final journey/evidence and leave the worktree clean for independent code and visual review. Do not deploy or merge.
