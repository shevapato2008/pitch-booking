# C1c “我的报名”生产候选实施计划

> **For agentic workers:** REQUIRED: Use `superpowers:subagent-driven-development` task by task, `superpowers:test-driven-development` for every behavior change, and `superpowers:verification-before-completion` before any completion or release claim. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在统一 B2+C1a+C1b 候选上接通“找球局 → 我的报名 → 共享详情 → 返回保留状态”的真实 self-only 旅程，并生成一个可供明早手机验收的新体验候选。

**Architecture:** 扩展既有 `open_game_registrations` 聚合、Source、会话与共享详情页；新增一个稳定 keyset 列表 API 和一个生产列表页。保留 development Fixtures 到手机验收，production build/audit 严格排除它们。

**Tech Stack:** Python 3.13, FastAPI, SQLAlchemy 2, PostgreSQL 17, Pydantic 2, Alembic, TypeScript, native WeChat Mini Program, Jest, Node test runner, Docker Compose.

**Design:** `docs/superpowers/specs/2026-08-30-my-game-registrations-production-design.md`

---

## Chunk 1: Self-only backend

### Task 1: Freeze the closed contract and index

**Files:**

- Modify: `backend/app/modules/open_game_registrations/dto.py`
- Modify: `backend/app/models.py`
- Create: `backend/migrations/versions/0017_my_open_game_applications.py`
- Create: `contracts/examples/my-open-game-applications-ready.json`
- Create: `contracts/examples/my-open-game-applications-empty.json`
- Modify: `contracts/openapi.yaml`
- Modify: `scripts/validate-contract.mjs`
- Modify: `tests/contract.test.mjs`
- Modify: `backend/tests/test_openapi_conformance.py`
- Create: `backend/tests/test_my_open_game_applications_contract.py`
- Create: `backend/tests/test_my_open_game_applications_migration.py`

- [ ] Start disposable PostgreSQL before the first migration test with `docker compose -p pitch-booking-test -f deploy/compose.test.yaml up -d --wait postgres`; use `TEST_DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test` for every Python test command through the final gate.
- [ ] Write RED tests for exact response fields, four effective statuses, aware timestamps, strict detail path, no private fields, `limit` 1–50, opaque cursor, authenticated OpenAPI security, and migration upgrade/downgrade with `(applicant_user_id, applied_at, id)`.
- [ ] Run the focused Python/Node contract tests and confirm failure is only the missing contract/index.
- [ ] Implement the minimal closed DTOs, examples, OpenAPI path and `0017` index; add no columns, enums or backfill.
- [ ] Run the same focused tests GREEN, `npm run contract:validate`, `git diff --check`, and commit `feat(c1c): define my registrations contract`.

### Task 2: Implement authoritative self-only query and API

**Files:**

- Modify: `backend/app/modules/open_game_registrations/repository.py`
- Modify: `backend/app/modules/open_game_registrations/privacy.py`
- Modify: `backend/app/modules/open_game_registrations/service.py`
- Modify: `backend/app/modules/open_game_registrations/router.py`
- Create: `backend/tests/test_my_open_game_applications_service.py`
- Create: `backend/tests/test_my_open_game_applications_api.py`
- Create: `backend/tests/test_my_open_game_applications_http_journey.py`

- [ ] Write RED tests proving A/B self-only isolation (including A cursor used by B), PUBLIC+LINK_ONLY, future+history, APPLIED/JOINED/REJECTED/CANCELLED projection, stable no-duplicate keyset pagination, empty page, invalid cursor/limit, 401, whole-page 503 on broken authority, and the exact local HTTP journey.
- [ ] Implement one bounded repository query rooted at `OpenGameRegistration`, filtered by authenticated applicant before cursor, ordered `(applied_at DESC,id DESC)`, returning `limit+1`; reuse existing lifecycle/privacy projection and fail the whole page on an invalid joined authority row.
- [ ] Encode/decode a versioned base64url cursor without identity; map 401/422/503 through existing error envelopes; never return the privacy deny-list.
- [ ] Run focused backend tests plus existing C1a lifecycle/API/journey and OpenAPI conformance GREEN; run `ruff`, `mypy`, `git diff --check`, then commit `feat(c1c): expose self-only registrations`.

## Chunk 2: Strict client and production page

### Task 3: Add list domain, decoder, source and presentation

**Files:**

- Modify: `miniprogram/domain/open-game-registration.ts`
- Modify: `miniprogram/domain/open-game-registration-decoder.ts`
- Modify: `miniprogram/domain/open-game-registration-decoder.test.ts`
- Modify: `miniprogram/services/open-game-registration.ts`
- Modify: `miniprogram/services/http-open-game-registration.ts`
- Modify: `miniprogram/services/http-open-game-registration.test.ts`
- Create: `miniprogram/presentation/my-game-registrations.ts`
- Create: `miniprogram/presentation/my-game-registrations.test.ts`

- [ ] Write RED decoder tests for exact payload, status/path/time-zone/sort invariants, opaque cursor, and rejection of extra/private fields.
- [ ] Write RED source tests for exact authenticated GET/query serialization, 401 session clearing, 422/503 mapping, strict decode failure, login reuse and current user identity.
- [ ] Write RED presentation tests for the four frozen status labels and Shanghai date/time/format labels.
- [ ] Implement readonly `OpenGameApplicationPage`, `listMine(cursor?,limit?)`, strict decoder and pure presenter by extending existing C1a units; do not create a second session/source stack.
- [ ] Run the focused Jest suites and `npm run typecheck` GREEN; `git diff --check`; commit `feat(c1c): add my registrations client`.

### Task 4: Ship the production list and preserve both return journeys

**Files:**

- Create: `miniprogram/pages/my-game-registrations/index.json`
- Create: `miniprogram/pages/my-game-registrations/index.ts`
- Create: `miniprogram/pages/my-game-registrations/index.wxml`
- Create: `miniprogram/pages/my-game-registrations/index.wxss`
- Create: `miniprogram/pages/my-game-registrations/index.test.ts`
- Modify: `miniprogram/pages/game-discovery/index.ts`
- Modify: `miniprogram/pages/game-discovery/index.wxml`
- Modify: `miniprogram/pages/game-discovery/index.wxss`
- Modify: `miniprogram/pages/game-discovery/index.test.ts`
- Modify: `miniprogram/app.json`

- [ ] Write RED page tests for initial/ready/empty/auth/login failure/initial error, refresh and load-more failures retaining cards, stable dedupe, exact detail path, header/deep-link back, scroll restoration, and account A late response discarded after account B/generation change.
- [ ] Write RED C1b tests for a real “我的报名” button, exact `navigateTo`, filters/results/scroll preserved on its return, while the existing detail-return refresh remains intact.
- [ ] Port the user-approved C1c WXML/WXSS without preview copy; implement the minimum page state machine over `listMine`; every visible button must perform a real read/login/navigation action.
- [ ] Add the production route and entry. Bind scroll positions explicitly and gate every response by active user/generation.
- [ ] Run both page suites, existing C1a shared-detail/C1b discovery suites and typecheck GREEN; manually inspect WXML/WXSS against the approved preview; commit `feat(c1c): ship my registrations journey`.

## Chunk 3: Isolation, runtime review and unified candidate

### Task 5: Enforce build isolation and focused regression

**Files:**

- Modify: `scripts/build-miniprogram.mjs`
- Modify: `tests/build-miniprogram.test.mjs`
- Modify: `tests/development-http-build.test.mjs`
- Modify: `scripts/audit-production-package.mjs`
- Modify: `tests/audit-production-package.test.mjs`
- Modify: `tests/production-package-booking-audit.test.mjs`
- Modify: `tests/my-game-registrations-native-preview.test.mjs`

- [ ] Write RED tests for route/composition inventory and explicit rejection of C1c marker, synthetic values and all `dev/pages/c1c-*` in production output.
- [ ] Make only the required inventory/audit changes; keep development Fixture registration unchanged and production registration on the existing HTTP source.
- [ ] Run focused Node/Jest suites, contract validation, typecheck, fresh development build, live-config production build, package audit and `git diff --check`.
- [ ] Use official WeChat DevTools on one iOS runtime and one representative Android runtime/width; exercise only naturally reachable production states: list, refresh, detail/back, scroll and login. Pagination/error/account-race branches are proved by focused automation and the local HTTP journey rather than injected into the production runtime. Apply only visible blocking fixes with RED/GREEN tests, then recapture the affected representative view. If DevTools cannot switch to an Android profile, stop before upload and record that candidate release gate as blocked; do not claim a dual-platform pass.
- [ ] Commit `test(c1c): gate unified production candidate`.

### Task 6: Freeze, deploy and upload the experience candidate

**Files:**

- Modify only existing release/acceptance records if the repository already requires them; do not delete Fixtures.

- [ ] Fetch `origin`; if `origin/main` advanced, merge it once (never rebase), rerun affected focused gates, and prove `113d603` and `aabea20` remain ancestors.
- [ ] Commit all final code and required release metadata, then record the immutable candidate SHA. No source or metadata modification is allowed after this point without creating a new SHA and restarting this gate.
- [ ] Run `superpowers:requesting-code-review` and fix all important findings before refreezing the SHA if needed. Then run `superpowers:verification-before-completion` against the exact final candidate SHA with these explicit gates:

  ```bash
  TEST_DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test uv run pytest -q
  npm test
  npm run typecheck
  npm run contract:validate
  npm run build:miniprogram:development
  # source deploy/miniprogram.live.local without printing it, force payment disabled
  npm run build:miniprogram:production
  npm run audit:miniprogram-package
  ```

  All must pass on the recorded SHA. Afterwards stop the disposable database with `docker compose -p pitch-booking-test -f deploy/compose.test.yaml down`.
- [ ] Push `feature/c1c-my-registrations-production`, then deploy exactly that SHA by following `docs/superpowers/plans/2026-08-26-public-game-discovery-production.md` Task 6: retain its backup/checksum, reject-overwrite, schema-retaining rollback, same-SHA build and truth-check procedure, with the expected migration head updated to `0017`. Verify health, revision, API privacy smoke and `MINIPROGRAM_PAYMENT_PROVIDER=disabled`.
- [ ] Confirm the next unused WeChat version immediately before upload, build/prepare from that same SHA, upload one new experience candidate and set it as experience version.
- [ ] Record honest status: automated/staging/iOS+Android DevTools gates passed; physical multi-account Android+iOS acceptance, Fixture retirement and final `main` merge remain for the user tomorrow.
