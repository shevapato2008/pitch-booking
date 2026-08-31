# C1a 散客申请与队长审核生产集成 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把已批准的私域分享申请、队长审核和申请人结果回读接入真实 FastAPI/PostgreSQL/微信会话，并在 C1a 与尚待设备验收的 B2 完整旅程共同通过后删除两者的 development Fixtures、合并、推送、部署和上传最终体验版。

**Architecture:** 新建独立 `open_game_registrations` 后端聚合与四个 `/applications` 产品 API，复用 B2 球局、订单权威、bearer 会话和通用幂等记录；现有 `OpenGamePublic` / `OpenGameOwner` 保持封闭不变。小程序新增报名 domain/source/attempt store 与两个 production 页面，现有分享详情和管理页只增加真实接点。最后名额、B2 编辑与接受共享 `Order → OpenGame → Registration` 锁序。

**Tech Stack:** Python 3.13、FastAPI、Pydantic v2、SQLAlchemy 2、Alembic、PostgreSQL 17、pytest；TypeScript 5、原生微信小程序、Jest/Node test、OpenAPI 3、微信开发者工具。

---

**Approved spec:** `docs/superpowers/specs/2026-08-24-player-game-application-production-design.md`

**Existing B2 device/Fixture gate reused by the combined candidate:** `docs/superpowers/plans/2026-08-21-captain-open-game-production.md` Task 10 Steps 8–12. B2 Fixture retirement is authorized only after that full gate passes here.

**Worktree:** `/Users/fan/Repositories/startups/pitch-booking/.worktrees/c1-player-application-preview`

**Baseline:** `feature/c1-player-application-preview@a1c9e16`；开始执行前允许本计划自己的提交位于其后，但不得从脏工作树开始任务。

**Hard boundaries:** 不启用公开找球入口、候补、退出、重申请、通知、历史或线上 AA；不改变 `OpenGamePublic` / `OpenGameOwner` 字段；不打印、展示或提交 live secret，候选发布前的开发门禁只用非秘密测试值。每个任务遵守 @superpowers:test-driven-development；每个 chunk 完成后做独立 review。候选 staging/体验版是双账号验收输入，不得提前称为完成。

## File structure map

后端新增一个职责单一的报名模块：

```text
backend/app/modules/open_game_registrations/
  dto.py          closed request/response and validation
  lifecycle.py    remaining capacity, effective state, allowed actions/blockers
  privacy.py      applicant input filtering and owner/viewer whitelists
  repository.py   registration persistence, locks and ordered owner queue
  service.py      context/apply/list/decision transactions and idempotency
  router.py       optional/required bearer routes and validation translation
```

小程序新增报名 sibling 模块，不扩大 B2 decoder/source：

```text
miniprogram/domain/open-game-registration.ts
miniprogram/domain/open-game-registration-decoder.ts
miniprogram/services/open-game-registration.ts
miniprogram/services/http-open-game-registration.ts
miniprogram/services/open-game-registration-attempt-store.ts
miniprogram/pages/player-game-application/index.*
miniprogram/pages/captain-game-applications/index.*
```

现有 `captain-game-public` shared 模式和 `captain-game-manage` 只负责导航与页面组合；数据库、HTTP source 和页面状态不得互相越层。批准的 dev 页面只作为 CSS/WXML 与文案迁移来源，不能被 production import。

## Chunk 1: Contract, persistence and backend authority

### Task 1: Freeze the four application endpoints and closed examples

**Files:**

- Modify: `contracts/openapi.yaml`
- Create: `contracts/examples/open-game-registration-context-anonymous.json`
- Create: `contracts/examples/open-game-registration-context-apply-ready.json`
- Create: `contracts/examples/open-game-registration-context-applied.json`
- Create: `contracts/examples/open-game-registration-context-joined.json`
- Create: `contracts/examples/open-game-registration-context-rejected.json`
- Create: `contracts/examples/open-game-registration-context-cancelled.json`
- Create: `contracts/examples/open-game-applications-pending.json`
- Create: `contracts/examples/open-game-applications-empty.json`
- Create: `contracts/examples/open-game-application-decision-joined.json`
- Create: `contracts/examples/open-game-application-decision-rejected.json`
- Create: `contracts/examples/error-application-not-found.json`
- Create: `contracts/examples/error-application-already-exists.json`
- Create: `contracts/examples/error-application-not-allowed.json`
- Create: `contracts/examples/error-application-state-changed.json`
- Create: `contracts/examples/error-application-capacity-changed.json`
- Create: `contracts/examples/error-open-game-joined-update-invalid.json`
- Create: `artifacts/ui/fixtures/open-game-registration-context-anonymous.json`
- Create: `artifacts/ui/fixtures/open-game-registration-context-apply-ready.json`
- Create: `artifacts/ui/fixtures/open-game-registration-context-applied.json`
- Create: `artifacts/ui/fixtures/open-game-registration-context-joined.json`
- Create: `artifacts/ui/fixtures/open-game-registration-context-rejected.json`
- Create: `artifacts/ui/fixtures/open-game-registration-context-cancelled.json`
- Create: `artifacts/ui/fixtures/open-game-applications-pending.json`
- Create: `artifacts/ui/fixtures/open-game-applications-empty.json`
- Create: `artifacts/ui/fixtures/open-game-application-decision-joined.json`
- Create: `artifacts/ui/fixtures/open-game-application-decision-rejected.json`
- Modify: `backend/tests/test_openapi_conformance.py`
- Modify: `scripts/generate-fixtures.mjs`
- Modify: `scripts/validate-contract.mjs`
- Modify: `tests/contract.test.mjs`

- [ ] **Step 1: Write failing contract assertions**

Add tests that require exactly these paths and methods:

```python
REGISTRATION_OPERATIONS = {
    "/api/v1/shared-games/{share_token}/registration-context": {"get"},
    "/api/v1/shared-games/{share_token}/applications": {"post"},
    "/api/v1/games/{game_id}/applications": {"get"},
    "/api/v1/games/{game_id}/applications/{application_id}/decision": {"post"},
}
```

Freeze these exact `operationId` values in static contract assertions now; Task 7 must assert the same table against generated runtime OpenAPI once the routes exist:

```text
GET  /api/v1/shared-games/{share_token}/registration-context              getOpenGameRegistrationContext
POST /api/v1/shared-games/{share_token}/applications                      createOpenGameApplication
GET  /api/v1/games/{game_id}/applications                                 listOpenGameApplications
POST /api/v1/games/{game_id}/applications/{application_id}/decision       decideOpenGameApplication
```

Assert the context operation has optional auth (`security: [{}, {bearerAuth: []}]`), the other three require `bearerAuth`, both POST operations require `Idempotency-Key`, every request/response has `additionalProperties: false`, and the old `OpenGamePublic` / `OpenGameOwner` required/property sets remain byte-for-byte unchanged.

Freeze these action shapes:

```yaml
OpenGameApplyActions:
  required: [can_apply, apply_blocked_reason]
OpenGameReviewActions:
  required: [can_accept, accept_blocked_reason, can_reject, reject_blocked_reason]
```

Require the exact blocker enums and action/blocker nullability from spec §6.5. Do not add server-side `APPLICATION_RESULT_UNKNOWN`.

Before changing the contract or generator, add the named C1a operation/example membership assertions to `tests/contract.test.mjs`. Extend only its two generator mapping assertions with the exact ten success-example mappings where source and destination both use the checked-in filenames `open-game-registration-context-{anonymous,apply-ready,applied,joined,rejected,cancelled}.json`, `open-game-applications-{pending,empty}.json`, and `open-game-application-decision-{joined,rejected}.json`. Require all nineteen generated fixtures and byte-for-byte normalized equality; leave the generator allow-list unchanged until Step 3 so this is RED. Error examples remain forbidden.

- [ ] **Step 2: Run RED**

Run:

```bash
uv run pytest backend/tests/test_openapi_conformance.py -q
npm run contract:validate
node --test tests/contract.test.mjs
```

Expected: pytest and the named JavaScript assertions fail because the four paths/schemas and ten generator mappings are absent; existing contract validation remains otherwise healthy.

- [ ] **Step 3: Add the minimal OpenAPI paths, schemas and examples**

Define closed schemas for:

```text
OpenGameRegistrationPosition
OpenGameRegistrationPersistedStatus
OpenGameRegistrationEffectiveStatus
OpenGameApplyBlockedReason
OpenGameReviewBlockedReason
OpenGameApplyActions
OpenGameReviewActions
OpenGameViewerRegistration
OpenGameRegistrationContext
CreateOpenGameApplicationRequest
CaptainOpenGameApplication
OpenGameApplicationQueue
OpenGameApplicationDecisionRequest
OpenGameApplicationDecisionResult
```

Freeze these exact required/property sets (nullable fields remain required and use a nullable schema):

```text
OpenGameApplyActions
  can_apply, apply_blocked_reason
OpenGameReviewActions
  can_accept, accept_blocked_reason, can_reject, reject_blocked_reason
OpenGameViewerRegistration
  display_name, position, note, persisted_status, effective_status,
  applied_at, decided_at
OpenGameRegistrationContext
  game, remaining_spots, viewer_authenticated, viewer_registration,
  allowed_actions
CreateOpenGameApplicationRequest
  display_name, position, note, adult_confirmed, risk_confirmed
CaptainOpenGameApplication
  id, display_name, position, note, applied_at, version, allowed_actions
OpenGameApplicationQueue
  remaining_spots, pending_count, applications
OpenGameApplicationDecisionRequest
  decision, expected_version
OpenGameApplicationDecisionResult
  application_id, status, version, decided_at, remaining_spots,
  allowed_actions
ApplicationNotAllowedDetails
  apply_blocked_reason, remaining_spots
ApplicationCapacityChangedDetails
  remaining_spots, allowed_actions
```

`note`, viewer registration and decision timestamps use explicit nullability. Persisted status is only `APPLIED | JOINED | REJECTED`; effective status adds `CANCELLED`; decision result status is persisted terminal status. UUID, RFC3339, integer bounds and every nested object are closed. `OpenGameRegistrationContext.game` must `$ref` the existing `OpenGamePublic`; never copy or extend it.

Freeze the operation/status/example attachment matrix:

```text
GET /shared-games/{share_token}/registration-context
  200: context-anonymous, context-apply-ready, context-applied,
       context-joined, context-rejected, context-cancelled
  401: existing error-auth-required
  404: existing error-open-game-not-found
  503: existing error-service-unavailable

POST /shared-games/{share_token}/applications
  201: context-applied
  401: existing error-auth-required
  404: existing error-open-game-not-found
  409: error-application-already-exists, error-application-not-allowed,
       existing error-idempotency-key-reused
  422: existing error-invalid-argument
  503: existing error-service-unavailable

GET /games/{game_id}/applications
  200: applications-pending, applications-empty
  401: existing error-auth-required
  404: existing error-open-game-not-found
  422: existing error-invalid-argument
  503: existing error-service-unavailable

POST /games/{game_id}/applications/{application_id}/decision
  200: decision-joined, decision-rejected
  401: existing error-auth-required
  404: error-application-not-found and existing error-open-game-not-found
  409: error-application-state-changed, error-application-capacity-changed,
       existing error-idempotency-key-reused
  422: existing error-invalid-argument
  503: existing error-service-unavailable

PUT /games/{game_id}
  422: error-open-game-joined-update-invalid in addition to existing examples
```

Requests use snake_case wire keys. Decision error details are closed objects:

```yaml
ApplicationNotAllowedDetails:
  required: [apply_blocked_reason, remaining_spots]
ApplicationCapacityChangedDetails:
  required: [remaining_spots, allowed_actions]
```

Add every external example to `scripts/validate-contract.mjs`'s exact endpoint map. Implement the already-failing named operation/example assertions in `tests/contract.test.mjs`; replace global path/example count assertions with named membership assertions for the four new operations and their mapped examples, while preserving the existing operation/example coverage checks. This makes the test fail on a missing C1a operation without coupling it to an unrelated repository-wide count. Extend the generator allow-list with exactly the ten mappings frozen in Step 1.

- [ ] **Step 4: Run GREEN**

Run:

```bash
uv run pytest backend/tests/test_openapi_conformance.py -q
npm run contract:validate
npm run fixtures:generate
node --test tests/contract.test.mjs
```

Expected: all commands PASS; validator reports all checked examples without orphan or endpoint mismatch, generator reports nineteen fixtures, and every new checked-in C1a fixture is byte-for-byte normalized from its canonical success example.

- [ ] **Step 5: Commit the frozen contract**

```bash
git add contracts/openapi.yaml contracts/examples/open-game-registration-*.json \
  contracts/examples/open-game-applications-*.json \
  contracts/examples/open-game-application-decision-*.json \
  contracts/examples/error-application-*.json \
  contracts/examples/error-open-game-joined-update-invalid.json \
  artifacts/ui/fixtures/open-game-registration-*.json \
  artifacts/ui/fixtures/open-game-applications-*.json \
  artifacts/ui/fixtures/open-game-application-decision-*.json \
  backend/tests/test_openapi_conformance.py scripts/generate-fixtures.mjs \
  scripts/validate-contract.mjs tests/contract.test.mjs
git diff --cached --check
git commit -m "contract: freeze open game applications api"
```

### Task 2: Persist registrations in additive migration 0016

**Files:**

- Create: `backend/migrations/versions/0016_open_game_registrations.py`
- Modify: `backend/app/models.py`
- Create: `backend/tests/test_open_game_registration_schema.py`
- Modify: `backend/tests/test_booking_migration_cycle.py`
- Modify: `backend/tests/test_platform_session_migration.py`
- Modify: `backend/tests/test_open_game_schema.py`

- [ ] **Step 1: Write failing PostgreSQL schema tests**

Cover `0015 → 0016 → 0015 → 0016`, Alembic head/check, exact enum labels, columns, named FK/check/unique/index catalog, duplicate `(game_id, applicant_user_id)`, valid/invalid decision timestamp matrices, and ORM parity. Before adding the migration or model relationships, update both existing hard-coded head assertions from `0015` to `0016`, change `test_open_game_models_match_persistence_contract` to require `OpenGame` relationships exactly `{"order", "team", "registrations"}`, and require `User.open_game_registrations` plus `User.decided_open_game_registrations` with their explicit foreign keys; then run Step 2 and observe RED.

The test must require these named constraints:

```text
fk_open_game_registrations_game_id_open_games
fk_open_game_registrations_applicant_user_id_users
fk_open_game_registrations_decided_by_user_id_users
uq_open_game_registrations_game_applicant
ck_open_game_registrations_display_name
ck_open_game_registrations_note
ck_open_game_registrations_version
ck_open_game_registrations_consent_version
ck_open_game_registrations_decision_pair
ck_open_game_registrations_decision_time
ix_open_game_registrations_pending
```

- [ ] **Step 2: Run RED against real PostgreSQL**

Run:

```bash
TEST_DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test \
uv run pytest backend/tests/test_open_game_registration_schema.py \
  backend/tests/test_booking_migration_cycle.py \
  backend/tests/test_platform_session_migration.py \
  backend/tests/test_open_game_schema.py -q
```

Expected: FAIL because revision `0016`, enums and table are absent.

- [ ] **Step 3: Implement migration and matching ORM model**

Create enum types `open_game_registration_position` and `open_game_registration_status`. Persist only `APPLIED`, `JOINED`, `REJECTED`; never persist `NONE` or `CANCELLED`.

Implement the table shape exactly:

```text
id uuid PK
game_id uuid FK open_games RESTRICT
applicant_user_id uuid FK users RESTRICT
display_name varchar(24)
position open_game_registration_position
note varchar(120) null
status open_game_registration_status
version int
consent_version varchar(32)
adult_confirmed_at timestamptz
risk_confirmed_at timestamptz
applied_at timestamptz
decided_at timestamptz null
decided_by_user_id uuid FK users RESTRICT null
created_at, updated_at timestamptz
```

Decision checks enforce APPLIED has neither decision field, terminal states have both, and `decided_at >= applied_at`. Add `User.open_game_registrations`, `User.decided_open_game_registrations`, and `OpenGame.registrations` with explicit foreign keys.

- [ ] **Step 4: Run GREEN and static checks**

```bash
TEST_DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test \
uv run pytest backend/tests/test_open_game_registration_schema.py \
  backend/tests/test_booking_migration_cycle.py \
  backend/tests/test_platform_session_migration.py \
  backend/tests/test_open_game_schema.py -q
uv run ruff check backend/app/models.py backend/migrations/versions/0016_open_game_registrations.py \
  backend/tests/test_open_game_registration_schema.py
```

Expected: schema/migration tests PASS and Ruff reports no errors.

- [ ] **Step 5: Commit persistence**

```bash
git add backend/app/models.py backend/migrations/versions/0016_open_game_registrations.py \
  backend/tests/test_open_game_registration_schema.py \
  backend/tests/test_booking_migration_cycle.py backend/tests/test_platform_session_migration.py \
  backend/tests/test_open_game_schema.py
git diff --cached --check
git commit -m "feat: persist open game registrations"
```

### Task 3: Implement pure registration DTO, lifecycle and privacy projection

**Files:**

- Create: `backend/app/modules/open_game_registrations/__init__.py`
- Create: `backend/app/modules/open_game_registrations/dto.py`
- Create: `backend/app/modules/open_game_registrations/lifecycle.py`
- Create: `backend/app/modules/open_game_registrations/privacy.py`
- Create: `backend/tests/test_open_game_registration_lifecycle.py`

- [ ] **Step 1: Write pure RED tests**

Cover exact request bounds, trim/empty-note normalization, phone/WeChat/URL/mainland-ID rejection, fixed consent version, all apply/review blocker precedence, action/blocker pairing, `remaining_spots`, effective `CANCELLED`, and exact applicant/owner privacy whitelists.

Use a fact object that contains authority, not request booleans:

```python
@dataclass(frozen=True, slots=True)
class RegistrationFacts:
    game_state: EffectiveOpenGameState
    stored_game_status: OpenGameStatus
    viewer_authenticated: bool
    viewer_is_owner: bool
    viewer_has_registration: bool
    registration_deadline: datetime
    starts_at: datetime
    open_spots: int
    joined_count: int
```

- [ ] **Step 2: Run RED**

```bash
uv run pytest backend/tests/test_open_game_registration_lifecycle.py -q
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement closed types and pure projection**

Use Pydantic `extra="forbid"`, frozen response models, strict scalar fields and these functions:

```python
def remaining_spots(*, open_spots: int, joined_count: int) -> int:
    return max(open_spots - joined_count, 0)
```

`project_apply_actions(facts, now)` selects the first true condition in this exact order and returns `can_apply = (blocker is None)`:

```text
effective state CANCELLED                         → GAME_CANCELLED
effective state COMPLETED                         → GAME_COMPLETED
effective state SUSPENDED                         → GAME_SUSPENDED
now >= starts_at                                  → GAME_STARTED
stored status is not PUBLISHED                    → GAME_NOT_PUBLISHED
viewer already has any persisted registration     → ALREADY_APPLIED
viewer is owner                                    → OWNER_CANNOT_APPLY
now >= registration_deadline                      → REGISTRATION_DEADLINE_PASSED
remaining_spots(...) == 0                          → GAME_FULL
viewer is anonymous                               → AUTH_REQUIRED
otherwise                                          → null
```

`project_review_actions(facts, decision_status, now)` first computes the common blocker in the exact order `APPLICATION_NOT_PENDING`, `GAME_CANCELLED`, `GAME_COMPLETED`, `GAME_SUSPENDED`, `GAME_STARTED`. `can_reject` is true only when that common blocker is null. `can_accept` additionally checks `remaining_spots == 0 → GAME_FULL`. Return both booleans with a null blocker iff their boolean is true; never apply `GAME_FULL` to reject.

`OpenGameViewerRegistration` exposes only the current user's submitted values/status/times. `CaptainOpenGameApplication` exposes only ID, display name, position, note, applied time, version and four-field actions. `CANCELLED` is effective response state only.

- [ ] **Step 4: Implement authoritative text validation**

Port the approved contact patterns from `miniprogram/dev/c1a-player-application-fixture.ts` into backend-owned validation: mainland mobile, explicit WeChat markers, URL and mainland ID. The backend trims once, counts Unicode code points, maps an empty note to `None`, requires both booleans true, and writes `c1a-2026-08-24`; it never accepts client timestamps or consent version.

- [ ] **Step 5: Run GREEN and commit**

```bash
uv run pytest backend/tests/test_open_game_registration_lifecycle.py -q
uv run ruff check backend/app/modules/open_game_registrations \
  backend/tests/test_open_game_registration_lifecycle.py
uv run mypy backend/app/modules/open_game_registrations
git add backend/app/modules/open_game_registrations/{__init__,dto,lifecycle,privacy}.py \
  backend/tests/test_open_game_registration_lifecycle.py
git diff --cached --check
git commit -m "feat: project open game registration lifecycle"
```

### Task 4: Implement applicant context and idempotent apply

**Files:**

- Create: `backend/app/modules/open_game_registrations/repository.py`
- Create: `backend/app/modules/open_game_registrations/service.py`
- Modify: `backend/app/modules/open_games/service.py`
- Create: `backend/tests/test_open_game_registration_service.py`
- Modify: `backend/tests/test_open_game_service.py`

- [ ] **Step 1: Write failing service tests**

Seed a B2 PUBLISHED game and test anonymous/authenticated context, self-apply, deadline, full capacity, existing terminal application, cancellation projection, exact privacy, successful apply, same-key replay, different-key duplicate and request-digest mismatch. Prove the request digest changes with share token/resolved game ID or any closed body field, not only the body. Add B2 regression assertions showing the shared authority helper returns the same unchanged `OpenGamePublic` as `OpenGameService.get_public`. Inject `SQLAlchemyError` separately during context repository read, registration insert/flush, idempotency completion and commit; require rollback, exact `503 SERVICE_UNAVAILABLE`, and no registration/idempotency/B1 mutation. Snapshot B1 Order/Slot/Payment/Refund rows before and after.

- [ ] **Step 2: Run RED**

```bash
TEST_DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test \
uv run pytest backend/tests/test_open_game_registration_service.py \
  backend/tests/test_open_game_service.py -q
```

Expected: FAIL because repository/service are absent.

- [ ] **Step 3: Implement repository reads and apply transaction**

Registration repository methods are narrowly scoped:

```python
get_registration(game_id, applicant_user_id)
count_joined(game_id)
lock_order(order_id)
add_registration(registration)
list_pending(game_id)
```

Inject the existing `OpenGameRepository` in the same SQLAlchemy session and reuse `get_by_share_token`, `lock_target_game`, `get_order_authority` / `lock_order_authority`, `get_order_row` and `get_team`; do not add duplicate B2 queries to the registration repository. Factor the existing `OpenGameService.get_public` assembly into one shared `project_authoritative_public_game(...)` helper in `open_games/service.py`. It accepts the loaded game/order, B1 authority rows, order row, team and `now`, and returns a frozen value containing the unchanged `OpenGamePublic`, `OpenGameFacts`, effective state, `starts_at` and owner user ID. `OpenGameService.get_public` and every registration context/apply/queue/decision projection must call this one helper, so cancellation/suspension, start time, venue/pitch/team privacy and `OpenGamePublic` cannot drift.

Use operation `create_open_game_application` and a canonical digest containing operation, share token, resolved game ID and the complete closed request body. Claim/replay idempotency before current-state rejection. After locking `Order → OpenGame`, explicitly query the applicant's existing registration: the POST returns `APPLICATION_ALREADY_EXISTS` for any existing row, while context projection separately uses `ALREADY_APPLIED`. Otherwise project authoritative actions, insert one APPLIED row with server timestamps/consent, complete idempotency with the 201 context and commit.

Same-key/same-digest replay returns the stored response even after state changes; same key with another target/body returns `IDEMPOTENCY_KEY_REUSED`. Keep an insert-race fallback that maps only PostgreSQL constraint `uq_open_game_registrations_game_applicant` to `APPLICATION_ALREADY_EXISTS` after rollback; re-raise every other `IntegrityError`. Any deterministic error rolls back its newly claimed idempotency row.

Wrap every public registration service entrypoint in the same transaction boundary as `OpenGameService`: an `AppError` rolls back and is re-raised; any repository/idempotency/flush/commit `SQLAlchemyError` rolls back and becomes the non-secret `AppError(503, "SERVICE_UNAVAILABLE", ...)`. Never allow a database exception to reach the global 500 handler, and never commit in a `finally` block.

- [ ] **Step 4: Run GREEN and commit**

```bash
TEST_DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test \
uv run pytest backend/tests/test_open_game_registration_service.py -q
uv run pytest backend/tests/test_open_game_service.py -q
uv run ruff check backend/app/modules/open_game_registrations \
  backend/app/modules/open_games/service.py \
  backend/tests/test_open_game_registration_service.py backend/tests/test_open_game_service.py
git add backend/app/modules/open_game_registrations/{repository,service}.py \
  backend/app/modules/open_games/service.py \
  backend/tests/test_open_game_registration_service.py backend/tests/test_open_game_service.py
git diff --cached --check
git commit -m "feat: apply to shared open games"
```

### Task 5: Implement owner queue and idempotent decisions

**Files:**

- Modify: `backend/app/modules/open_game_registrations/repository.py`
- Modify: `backend/app/modules/open_game_registrations/service.py`
- Modify: `backend/tests/test_open_game_registration_service.py`

- [ ] **Step 1: Write RED tests for queue and decisions**

Require owner/non-owner/missing symmetry, full untruncated ordered APPLIED queue (`applied_at`, then `id`), exact `pending_count`, accept/reject, expected version, terminal state, same-key/same-request replay after the row is terminal/full, same-key/different-target/body rejection, `GAME_FULL` blocking accept only, and exact `APPLICATION_STATE_CHANGED` / `APPLICATION_CAPACITY_CHANGED` details. Prove queue and decision actions derive `GAME_CANCELLED`, `GAME_SUSPENDED`, `GAME_COMPLETED`, `GAME_STARTED` and capacity blockers from changed B1/OpenGame authority rather than stored registration state. Inject `SQLAlchemyError` during queue read and decision registration update/flush, idempotency completion and commit; require the shared rollback/503 boundary and byte-identical registration/idempotency/B1 state. Prove the digest changes with game ID, application ID, decision or expected version, and prove an application ID belonging to another game returns the same 404 without mutation. Snapshot B1 authority rows before and after both decisions.

- [ ] **Step 2: Run RED**

```bash
TEST_DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test \
uv run pytest backend/tests/test_open_game_registration_service.py -q
```

Expected: new owner queue and decision cases FAIL.

- [ ] **Step 3: Implement owner queue and decision transaction**

For the queue GET, use `locate_order_id(game_id)` followed by `get_owned_order(order_id, user_id)` and `get_owned_game(game_id, user_id)` so missing and non-owned games share one 404. Read `get_order_authority`, `get_order_row` and `get_team`, call `project_authoritative_public_game(...)`, count current JOINED rows, then fetch every APPLIED row via `list_pending(game_id)` ordered by `applied_at, id`. Return `pending_count == len(applications)` and project each row's four-field review actions from the same authoritative facts; do not paginate or truncate this C1a queue.

Use operation `decide_open_game_application` and a canonical digest containing operation, game ID, application ID, decision and expected version. First lock `Order → OpenGame`, verify the route game is owned by the caller, then lock the target registration with a repository predicate on both `registration.game_id == route game_id` and `registration.id == route application_id`; missing, foreign-game and non-owned resources all reach the uniform 404 before idempotency can reveal key history. Only after authorization/resource proof, claim idempotency and return a completed same-key/same-request replay before checking terminal state, expected version or capacity. For a new claim, read the locked B1 authority plus order row/team through `OpenGameRepository`, call `project_authoritative_public_game(...)`, require `registration.version == expected_version`, count JOINED registrations under the already-held game lock, and derive all review blockers/actions from that shared projection.

ACCEPT changes APPLIED to JOINED and increments version; REJECT changes APPLIED to REJECTED and increments version without consuming capacity. Both write server decision time/user. Capacity conflict leaves the target APPLIED and returns latest remaining capacity plus four-field actions. Complete idempotency with the successful response before commit; roll back the newly claimed record on every deterministic conflict so a corrected retry can proceed.

Use the Task 4 service-level `AppError`/`SQLAlchemyError` transaction boundary for both queue and decision; do not add route-only exception handling that could leave a failed session or claimed key behind.

- [ ] **Step 4: Run GREEN and commit**

```bash
TEST_DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test \
uv run pytest backend/tests/test_open_game_registration_service.py -q
uv run ruff check backend/app/modules/open_game_registrations \
  backend/tests/test_open_game_registration_service.py
git add backend/app/modules/open_game_registrations/repository.py \
  backend/app/modules/open_game_registrations/service.py \
  backend/tests/test_open_game_registration_service.py
git diff --cached --check
git commit -m "feat: review open game applications"
```

### Task 6: Preserve joined-player invariants during B2 edits and races

**Files:**

- Modify: `backend/app/modules/open_games/dto.py`
- Modify: `backend/app/modules/open_games/repository.py`
- Modify: `backend/app/modules/open_games/service.py`
- Modify: `backend/app/modules/open_games/router.py`
- Modify: `backend/app/modules/open_game_registrations/repository.py`
- Modify: `backend/app/modules/open_game_registrations/service.py`
- Modify: `backend/tests/test_open_game_service.py`
- Modify: `backend/tests/test_open_game_api.py`
- Create: `backend/tests/test_open_game_registration_concurrency.py`

- [ ] **Step 1: Write RED tests for joined-aware edit invariants**

Extend B2 service/API tests so joined players enforce:

```text
new open_spots >= joined_count
new total_players >= new fixed_players + joined_count
new aa_cents <= current aa_cents when joined_count > 0
```

Assert precise service and HTTP field errors for `open_spots`, `total_players`, and `aa_cents`; preserve existing CREATE and no-joined update rules. Make the total-floor case independently reachable by overriding the inherited roster-capacity model validator only on `UpdateOpenGameRequest`, deferring `fixed_players + open_spots <= total_players` to the locked update service. Test `open_spots == joined_count` with `total_players < fixed_players + joined_count`: request parsing succeeds, then service returns exactly `total_players`. `OpenGameDraftInput` and `CreateOpenGameRequest` retain the current model-level rejection.

- [ ] **Step 2: Write deterministic PostgreSQL concurrency RED tests**

Use separate `NullPool` engines/sessions and test-only observed repository subclasses—no production lock hook. `ObservedRegistrationRepository.lock_order()` and `ObservedOpenGameRepository.lock_owned_order()` call `super()`, then set an `acquired` Event and assert that `release.wait(timeout=5)` succeeds. Each worker records `SELECT pg_backend_pid()` in a `Queue` before entering the service. Start the first worker and assert `acquired.wait(timeout=5)` succeeds, start the second, then poll `pg_stat_activity.wait_event_type` for that second PID only until a `time.monotonic()` deadline five seconds later. Require `Lock` before the deadline; whether observation succeeds or raises, set `release` in that polling block's `finally` before awaiting either future. Every future has a bounded timeout, and each worker/final fixture teardown rolls back/closes sessions, sets `release` again harmlessly and disposes request engines.

For two accepts of the last place, hold the first after its Order lock, prove the second blocks, release, then assert exactly one JOINED; the other returns `APPLICATION_CAPACITY_CHANGED` and remains APPLIED. For accept-first versus edit, use `ObservedRegistrationRepository` to hold accept and prove edit blocks. For edit-first versus accept, use `ObservedOpenGameRepository` to hold update and prove accept blocks. After both schedules assert persisted open spots are never below JOINED count, planned total is never below fixed plus JOINED, AA never increases after the first join, and B1 rows are unchanged.

- [ ] **Step 3: Run RED**

```bash
TEST_DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test \
uv run pytest backend/tests/test_open_game_registration_service.py \
  backend/tests/test_open_game_registration_concurrency.py \
  backend/tests/test_open_game_service.py \
  backend/tests/test_open_game_api.py -q
```

Expected: joined-aware edit and deterministic concurrency cases FAIL.

- [ ] **Step 4: Implement the shared lock order and B2 edit floor**

Keep decision locks `Order → OpenGame → target Registration`. Override the inherited validator by the same method name only on Update:

```python
class UpdateOpenGameRequest(OpenGameDraftInput):
    expected_version: Annotated[int, Field(strict=True, ge=1)]

    @model_validator(mode="after")
    def validate_roster_capacity(self) -> Self:
        return self  # locked update service validates all capacity relationships
```

Leave `OpenGameDraftInput` / CREATE validation untouched. In the already locked B2 update service, read JOINED count, then validate both the existing `fixed_players + open_spots <= total_players` rule and the joined floors/current AA, collecting deduplicated exact fields `total_players`, `open_spots`, `aa_cents` before any mutation. In `_translate_service_validation`, use the deadline-specific top-level message only when every translated field is `registration_deadline`; use the generic invalid-update message for capacity/AA fields. The repository must not introduce a count cache or a second capacity authority.

- [ ] **Step 5: Run GREEN and commit**

```bash
TEST_DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test \
uv run pytest backend/tests/test_open_game_registration_service.py \
  backend/tests/test_open_game_registration_concurrency.py \
  backend/tests/test_open_game_service.py \
  backend/tests/test_open_game_api.py -q
uv run ruff check backend/app/modules/open_games backend/app/modules/open_game_registrations \
  backend/tests/test_open_game_registration_{service,concurrency}.py \
  backend/tests/test_open_game_service.py backend/tests/test_open_game_api.py
git add backend/app/modules/open_games/dto.py backend/app/modules/open_games/repository.py \
  backend/app/modules/open_games/service.py backend/app/modules/open_games/router.py \
  backend/app/modules/open_game_registrations/repository.py \
  backend/app/modules/open_game_registrations/service.py \
  backend/tests/test_open_game_registration_service.py \
  backend/tests/test_open_game_registration_concurrency.py \
  backend/tests/test_open_game_service.py backend/tests/test_open_game_api.py
git diff --cached --check
git commit -m "fix: preserve joined open game invariants"
```

### Task 7: Expose routes and prove the real backend journey

**Files:**

- Create: `backend/app/modules/open_game_registrations/router.py`
- Modify: `backend/app/main.py`
- Create: `backend/tests/test_open_game_registration_api.py`
- Create: `backend/tests/test_open_game_registration_http_journey.py`
- Modify: `backend/tests/test_openapi_conformance.py`
- Create: `deploy/compose.rollback-retain-schema.yaml`
- Modify: `backend/tests/test_deploy_preflight.py`

- [ ] **Step 1: Write API and route-precedence RED tests**

Cover absent Authorization as anonymous; malformed/non-Bearer/empty/invalid/expired as 401; required bearer on writes/list; field validation; owner/non-owner 404; every 409 code/details; privacy key sets; child routes not swallowed by `shared-games/{share_token:path}`; and request validation exposing only known first-level fields. Inject `SQLAlchemyError` during optional and required auth lookup and require rollback plus the existing safe `503 SERVICE_UNAVAILABLE` envelope. Exercise one registration read failure and one mutation flush/commit failure through HTTP and require that same 503 envelope plus unchanged database rows. Assert generated runtime OpenAPI gives the context operation exactly `security: [{}, {bearerAuth: []}]` and the three protected operations only bearer security. Reuse Task 1's exact four-operation table to assert all four runtime `operationId` values and response status sets, including queue GET 422 with the frozen `InvalidArgument` example.

Add a deploy-preflight RED assertion for one narrow rollback override: `deploy/compose.rollback-retain-schema.yaml` must contain only `services.api.command`, replacing `uv run alembic upgrade head && ...` with the exact direct Uvicorn argv while inheriting every image/environment/network/health setting from the selected old release. Render it after `compose.yaml` and require the merged API command has no Alembic token, worker/Caddy/PostgreSQL remain unchanged, and normal `compose.yaml` still requires `alembic upgrade head`.

- [ ] **Step 2: Write the real Uvicorn/PostgreSQL three-identity journey test**

In `test_open_game_registration_http_journey.py`, copy the in-process threaded harness shape from `test_open_game_http_journey.py`. Construct it with `create_app(settings=Settings(app_env="test", database_url=pg_engine.url.render_as_string(hide_password=False), payment_provider="disabled", wechat_app_id="wx-open-game-registration-test", wechat_provider="development"))`; override `get_database` with `Session(pg_engine)`. Bind a loopback socket on an OS-assigned port, run `uvicorn.Server` in a bounded daemon thread, and poll `/api/v1/health` with a five-second monotonic deadline while also detecting thread/listener failure. In fixture teardown always set `should_exit`, join with a bound, close the listener, clear dependency overrides and propagate recorded server failures. Seed and align three distinct development codes/users: captain, accepted applicant and rejected applicant. Exercise:

```text
anonymous context
→ accepted-applicant session/apply/replay
→ captain queue/accept/replay
→ accepted-applicant JOINED context
→ rejected-applicant session/apply
→ captain reject
→ rejected-applicant REJECTED context
```

Assert public/privacy key sets and exact Order/Slot/Payment/RefundCase/RefundAttempt snapshots before and after.

- [ ] **Step 3: Run both route and journey tests RED**

```bash
TEST_DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test \
uv run pytest backend/tests/test_open_game_registration_api.py \
  backend/tests/test_open_game_registration_http_journey.py \
  backend/tests/test_openapi_conformance.py \
  backend/tests/test_deploy_preflight.py -q
```

Expected: route/runtime OpenAPI tests fail because router/main composition are absent, and the real HTTP journey cannot reach the four endpoints.

- [ ] **Step 4: Implement router and register it before B2 catch-all**

Provide separate optional and required current-user dependencies. The optional dependency must read and parse `Request.headers` directly and must not subclass/use `SecurityBase`; it returns `None` only when Authorization is absent, while any present malformed, empty, non-Bearer or invalid credential raises `AUTH_REQUIRED`. Keep the existing `HTTPBearer`-based required dependency for protected operations. Both dependencies catch `SQLAlchemyError`, roll back defensively and map it to the same non-secret 503 behavior as B2. Put exactly `openapi_extra={"security": [{}, {"bearerAuth": []}]}` on the context route; because the optional dependency contributes no generated security entry, the runtime operation must contain exactly those two alternatives, while protected operations contain only bearer security. Export a mutation-path predicate and validation handler so `main.py` maps registration POST validation through the same safe error envelope. Call:

```python
application.include_router(open_game_registrations_router)
application.include_router(open_games_router)
```

in that order. Implement only enough composition to make the already-written API, runtime OpenAPI and three-identity HTTP tests GREEN.

In `frozen_runtime_openapi()`, remove FastAPI's automatic 422 only from `GET /api/v1/shared-games/{share_token}/registration-context`, matching the existing shared-game GET normalization. Preserve the explicit frozen 422 on queue GET and both mutations.

Create the closed Compose override exactly as tested:

```yaml
services:
  api:
    command: [uv, run, uvicorn, backend.app.main:app, --host, 0.0.0.0, --port, "8000"]
```

It exists only for failed-rollout recovery when an older application image must start against a retained additive schema it cannot migrate. Normal candidate/final startup never layers this file.

- [ ] **Step 5: Run backend Chunk 1 verification**

```bash
TEST_DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test \
uv run pytest \
  backend/tests/test_open_game_registration_schema.py \
  backend/tests/test_open_game_registration_lifecycle.py \
  backend/tests/test_open_game_registration_service.py \
  backend/tests/test_open_game_registration_api.py \
  backend/tests/test_open_game_registration_concurrency.py \
  backend/tests/test_open_game_registration_http_journey.py \
  backend/tests/test_open_game_service.py \
  backend/tests/test_open_game_api.py \
  backend/tests/test_open_game_schema.py \
  backend/tests/test_booking_migration_cycle.py \
  backend/tests/test_platform_session_migration.py \
  backend/tests/test_openapi_conformance.py \
  backend/tests/test_deploy_preflight.py -q
uv run ruff check backend/app/models.py backend/app/main.py \
  backend/app/modules/open_games backend/app/modules/open_game_registrations \
  backend/migrations/versions/0016_open_game_registrations.py \
  backend/tests/test_open_game_registration_*.py backend/tests/test_open_game_service.py \
  backend/tests/test_open_game_api.py backend/tests/test_deploy_preflight.py
uv run mypy backend/app/modules/open_games backend/app/modules/open_game_registrations
npm run contract:validate
```

Expected: focused backend/contract suite PASS; no B1 authority row changes.

- [ ] **Step 6: Commit API and journey evidence**

```bash
git add backend/app/modules/open_game_registrations/router.py backend/app/main.py \
  backend/tests/test_open_game_registration_api.py \
  backend/tests/test_open_game_registration_http_journey.py \
  backend/tests/test_openapi_conformance.py backend/tests/test_deploy_preflight.py \
  deploy/compose.rollback-retain-schema.yaml
git diff --cached --check
git commit -m "test: prove open game application backend journey"
```

## Chunk 2: Mini Program production client and pages

### Task 8: Bind every stored session to the decoded WeChat user

**Files:**

- Modify: `miniprogram/services/session-store.ts`
- Modify: `miniprogram/services/session-store.test.ts`
- Modify: `miniprogram/services/http-booking.ts`
- Modify: `miniprogram/services/http-booking.test.ts`
- Modify: `miniprogram/services/http-inventory.ts`
- Modify: `miniprogram/services/http-inventory.test.ts`
- Modify: `miniprogram/services/http-open-game.ts`
- Modify: `miniprogram/services/http-open-game.test.ts`
- Modify: `miniprogram/services/http-payment.ts`
- Modify: `miniprogram/services/http-payment.test.ts`
- Modify: `miniprogram/services/http-pitch-configuration.ts`
- Modify: `miniprogram/services/http-pitch-configuration.test.ts`
- Modify: `miniprogram/services/http-venue-access.ts`
- Modify: `miniprogram/services/http-venue-access.test.ts`
- Modify: `miniprogram/services/http-venue-fulfillment.ts`
- Modify: `miniprogram/services/http-venue-fulfillment.test.ts`
- Modify: `miniprogram/services/http-venue-onboarding.ts`
- Modify: `miniprogram/services/http-venue-onboarding.test.ts`
- Modify: `miniprogram/services/http-venue-profile.ts`
- Modify: `miniprogram/services/http-venue-profile.test.ts`

- [ ] **Step 1: Write RED tests for session v2 ownership**

Require the new exact stored shape `{ token, expiresAt, userId }`, UUID validation for `userId`, expiry cleanup, extra-key cleanup, and defensive clones. Seed the old key `modelstella.pitch-booking.session.v1` and prove it is removed rather than migrated because its account cannot be established. Require `save` to write only `modelstella.pitch-booking.session.v2` and remove v1; require `clear` to remove both keys.

In the eight HTTP service tests whose login response shape is `session.user`, make the login response user ID distinct and assert the stored v2 value contains the decoded `session.user.userId`. In the venue-onboarding service test, assert the stored v2 value contains the decoded `session.identity.userId`. No service may synthesize or omit the ID.

- [ ] **Step 2: Run RED**

```bash
npx jest miniprogram/services/session-store.test.ts \
  miniprogram/services/http-booking.test.ts \
  miniprogram/services/http-inventory.test.ts \
  miniprogram/services/http-open-game.test.ts \
  miniprogram/services/http-payment.test.ts \
  miniprogram/services/http-pitch-configuration.test.ts \
  miniprogram/services/http-venue-access.test.ts \
  miniprogram/services/http-venue-fulfillment.test.ts \
  miniprogram/services/http-venue-onboarding.test.ts \
  miniprogram/services/http-venue-profile.test.ts --runInBand
npm run typecheck
```

Expected: the new session assertions and/or TypeScript compile fail while `StoredSession` is still v1.

- [ ] **Step 3: Implement one closed v2 store and update all session exchanges**

Use constants for both v1 and v2 keys. `load()` first removes v1, then accepts only the three exact v2 keys, validates RFC3339/expiry and a UUID user ID, and clears malformed v2. `save()` writes a new plain object with all three fields and removes v1. In the eight services that use `decodeWeChatSession`, pass:

```typescript
sessionStore.save({
  token: session.token,
  expiresAt: session.expiresAt,
  userId: session.user.userId,
});
```

`http-venue-onboarding.ts` uses its private `decodeOnboardingSession`, so pass the equivalent `userId: session.identity.userId` there. Do not add a second decoder merely to make these lines identical.

Do not change authorization/relogin behavior outside this ownership addition.

- [ ] **Step 4: Run GREEN and commit**

```bash
npx jest miniprogram/services/session-store.test.ts \
  miniprogram/services/http-booking.test.ts \
  miniprogram/services/http-inventory.test.ts \
  miniprogram/services/http-open-game.test.ts \
  miniprogram/services/http-payment.test.ts \
  miniprogram/services/http-pitch-configuration.test.ts \
  miniprogram/services/http-venue-access.test.ts \
  miniprogram/services/http-venue-fulfillment.test.ts \
  miniprogram/services/http-venue-onboarding.test.ts \
  miniprogram/services/http-venue-profile.test.ts --runInBand
npm run typecheck
git add miniprogram/services/session-store.ts miniprogram/services/session-store.test.ts \
  miniprogram/services/http-{booking,inventory,open-game,payment,pitch-configuration,venue-access,venue-fulfillment,venue-onboarding,venue-profile}.ts \
  miniprogram/services/http-{booking,inventory,open-game,payment,pitch-configuration,venue-access,venue-fulfillment,venue-onboarding,venue-profile}.test.ts
git diff --cached --check
git commit -m "feat: bind sessions to wechat users"
```

### Task 9: Decode the closed registration contract and validate drafts

**Files:**

- Create: `miniprogram/domain/open-game-registration.ts`
- Create: `miniprogram/domain/open-game-registration-decoder.ts`
- Create: `miniprogram/domain/open-game-registration-decoder.test.ts`

- [ ] **Step 1: Write decoder and pure-validation RED tests**

Read the checked-in success examples from `contracts/examples/` and require exact snake_case-to-camelCase decoding for context, owner queue and decision result. Reject every extra key recursively, missing/nullability mistakes, unknown enum, invalid UUID/RFC3339, negative capacity, inconsistent action/blocker pair and an effective `CANCELLED` value used as a persisted status. Require a terminal JOINED or REJECTED decision result to contain `canAccept=false`, `canReject=false` and `APPLICATION_NOT_PENDING` for both blockers; reject any terminal/action mismatch even when each boolean/blocker pair is individually well formed.

Port the approved form cases from `miniprogram/dev/c1a-player-application-fixture.test.ts`: trim-aware 2–24 character display name, five positions, 120-character note, empty note normalization, both confirmations, and phone/WeChat/URL/mainland-ID rejection. Keep this client validation as feedback only; it must not make authorization or capacity decisions.

- [ ] **Step 2: Run RED**

```bash
npx jest miniprogram/domain/open-game-registration-decoder.test.ts --runInBand
```

Expected: FAIL because the production domain and decoder do not exist.

- [ ] **Step 3: Implement exact domain types and decoder entry points**

Define only the contract types needed by the pages:

```typescript
OpenGameApplicationDraft
OpenGameApplicationDraftValidation
OpenGameApplicationSubmission
OpenGameApplyBlockedReason
OpenGameReviewBlockedReason
OpenGameApplyActions
OpenGameReviewActions
OpenGameViewerRegistration
OpenGameRegistrationContext
CaptainOpenGameApplication
OpenGameApplicationQueue
OpenGameApplicationDecisionResult
```

Reuse `OpenGamePosition` and `OpenGamePublic`; do not duplicate B2 public fields. Export:

```typescript
decodeOpenGameRegistrationContext(value)
decodeOpenGameApplicationQueue(value)
decodeOpenGameApplicationDecisionResult(value)
validateOpenGameApplicationDraft(draft)
```

`OpenGameApplicationDraft` keeps `position: OpenGamePosition | null` for editing. A valid result contains an immutable normalized `OpenGameApplicationSubmission` with trimmed display name, non-null position, trimmed note mapped to `null`, and both confirmations; invalid validation contains no submission. The decoder must enforce the boolean/blocker invariant, but the client never recomputes a looser blocker or remaining capacity.

- [ ] **Step 4: Run GREEN and commit**

```bash
npx jest miniprogram/domain/open-game-registration-decoder.test.ts --runInBand
npm run typecheck
git add miniprogram/domain/open-game-registration.ts \
  miniprogram/domain/open-game-registration-decoder.ts \
  miniprogram/domain/open-game-registration-decoder.test.ts
git diff --cached --check
git commit -m "feat: decode open game registrations"
```

### Task 10: Persist account-bound application and decision attempts

**Files:**

- Create: `miniprogram/services/open-game-registration-attempt-store.ts`
- Create: `miniprogram/services/open-game-registration-attempt-store.test.ts`
- Create: `miniprogram/services/open-game-registration.ts`
- Create: `miniprogram/services/open-game-registration.test.ts`

- [ ] **Step 1: Write attempt-store RED tests**

Freeze this one-record union under `modelstella.pitch-booking.open-game-registration-attempt.v1`:

```typescript
type OpenGameRegistrationAttempt =
  | { kind: "apply"; originatingUserId: string; shareToken: string;
      body: OpenGameApplicationSubmission; idempotencyKey: string }
  | { kind: "decision"; originatingUserId: string; gameId: string;
      applicationId: string; decision: "ACCEPT" | "REJECT";
      expectedVersion: number; idempotencyKey: string };
```

Cover exact keys, UUID/token/key/bounds, canonical cloning, corrupt-value cleanup and persistence across a new store instance. `begin()` must reuse the existing key for the same account and canonical mutation, return `SAME_ACCOUNT_PENDING` for another mutation owned by that account, and return `FOREIGN_ACCOUNT_PENDING` when owner IDs differ. `resolveForUser()` must never return a foreign attempt as replayable. `clear()` is the only account-switch escape and removes only this local key.

In `open-game-registration.test.ts`, freeze the source/store registry names and missing-registry errors, exact source method signatures through compile-time fakes, and the closed recovery matrix below. Require same-account/same-resource replay, same-account/other-resource navigation, foreign-account no-send, and success/preserve/clear disposition without page-specific invention.

- [ ] **Step 2: Run RED**

```bash
npx jest miniprogram/services/open-game-registration-attempt-store.test.ts \
  miniprogram/services/open-game-registration.test.ts --runInBand
```

Expected: FAIL because the store and service types are absent.

- [ ] **Step 3: Implement the minimal registry, recovery decisions and store**

In `open-game-registration.ts`, export these exact aliases and source interface:

```typescript
type OpenGameRegistrationApplyAttempt = Extract<OpenGameRegistrationAttempt, { kind: "apply" }>;
type OpenGameRegistrationDecisionAttempt = Extract<OpenGameRegistrationAttempt, { kind: "decision" }>;

interface OpenGameRegistrationSource {
  login(): Promise<string>; // authoritative decoded userId saved in session v2
  currentUserId(): string | null;
  getContext(shareToken: string): Promise<OpenGameRegistrationContext>;
  apply(attempt: OpenGameRegistrationApplyAttempt): Promise<OpenGameRegistrationContext>;
  getPending(gameId: string): Promise<OpenGameApplicationQueue>;
  decide(attempt: OpenGameRegistrationDecisionAttempt): Promise<OpenGameApplicationDecisionResult>;
}
```

Export exactly `registerOpenGameRegistrationSource`, `getOpenGameRegistrationSource`, `resetOpenGameRegistrationSourceForTesting`, `registerOpenGameRegistrationAttemptStore`, `getOpenGameRegistrationAttemptStore`, and `resetOpenGameRegistrationAttemptStoreForTesting`; missing getters throw `OPEN_GAME_REGISTRATION_SOURCE_NOT_CONFIGURED` or `OPEN_GAME_REGISTRATION_ATTEMPT_STORE_NOT_CONFIGURED`. Freeze the concrete persistence API:

```typescript
type OpenGameRegistrationAttemptAvailability =
  | { readonly kind: "READY"; readonly attempt: OpenGameRegistrationAttempt }
  | { readonly kind: "SAME_ACCOUNT_PENDING"; readonly attempt: OpenGameRegistrationAttempt }
  | { readonly kind: "FOREIGN_ACCOUNT_PENDING"; readonly attempt: OpenGameRegistrationAttempt };
type OpenGameRegistrationAttemptResolution =
  | Extract<OpenGameRegistrationAttemptAvailability, { kind: "READY" }>
  | Extract<OpenGameRegistrationAttemptAvailability, { kind: "FOREIGN_ACCOUNT_PENDING" }>;
interface OpenGameRegistrationAttemptStore {
  load(): OpenGameRegistrationAttempt | null;
  begin(attempt: OpenGameRegistrationAttempt): OpenGameRegistrationAttemptAvailability;
  resolveForUser(userId: string): OpenGameRegistrationAttemptResolution | null;
  clear(): void;
}
function createOpenGameRegistrationAttemptStore(
  storage: SessionStorage,
): OpenGameRegistrationAttemptStore;
```

Export all four concrete type names, the interface and the factory. Tests must compile a real factory against the sibling `SessionStorage`, prove `resolveForUser` returns `null` when empty, and exercise persistence through a second factory instance.

Add pure recovery helpers and freeze this complete mutation-result matrix before page work:

```text
successful apply/decision                         → ACCEPT_AUTHORITY_AND_CLEAR
AUTH_REQUIRED or LOGIN_FAILED                     → PRESERVE_LOGIN_COMPARE_ACCOUNT
write timeout/5xx/malformed success                → PRESERVE_APPLICATION_RESULT_UNKNOWN
apply unknown + context has viewer registration    → ACCEPT_AUTHORITY_AND_CLEAR
apply unknown + no viewer registration             → REPLAY_SAME_ATTEMPT
decision unknown                                   → REPLAY_SAME_ATTEMPT
apply APPLICATION_ALREADY_EXISTS                   → PRESERVE_READ_CONTEXT_THEN_CLEAR
apply APPLICATION_NOT_ALLOWED                      → CLEAR_AND_REFRESH_CONTEXT
decision APPLICATION_STATE_CHANGED                 → CLEAR_AND_REFRESH_QUEUE
decision APPLICATION_CAPACITY_CHANGED              → CLEAR_AND_REFRESH_QUEUE
IDEMPOTENCY_KEY_REUSED                              → CLEAR_AND_SHOW_CONFLICT
INVALID_ARGUMENT                                    → CLEAR_AND_CORRECT_OR_REFRESH
OPEN_GAME_NOT_FOUND / APPLICATION_NOT_FOUND         → CLEAR_AND_RETURN
same account + pending attempt for other resource   → PRESERVE_AND_NAVIGATE
different current user                              → FOREIGN_ACCOUNT_PENDING; never send
read SERVICE_UNAVAILABLE                            → RETRY_READ; do not change attempt
```

`SERVICE_UNAVAILABLE` is a read result only: Task 11 maps mutation 5xx/timeouts/malformed success to `APPLICATION_RESULT_UNKNOWN`. Implement the registries, pure classifiers and attempt store exactly as the RED matrix. Never rewrite `originatingUserId`, never generate a new key during restore, and never infer success from local state. A same-account pending attempt on another resource exposes only a deterministic recovery route: apply → its shared detail token; decision → its captain review game ID. It cannot be cleared as if it belonged to another account; the user must navigate to resolve it.

- [ ] **Step 4: Run GREEN and commit**

```bash
npx jest miniprogram/services/open-game-registration-attempt-store.test.ts \
  miniprogram/services/open-game-registration.test.ts --runInBand
npm run typecheck
git add miniprogram/services/open-game-registration.ts \
  miniprogram/services/open-game-registration-attempt-store.ts \
  miniprogram/services/open-game-registration-attempt-store.test.ts \
  miniprogram/services/open-game-registration.test.ts
git diff --cached --check
git commit -m "feat: persist open game registration attempts"
```

### Task 11: Implement the strict HTTP registration source

**Files:**

- Create: `miniprogram/services/http-open-game-registration.ts`
- Create: `miniprogram/services/http-open-game-registration.test.ts`

- [ ] **Step 1: Write transport RED tests**

Require exact URL encoding, method, snake_case body and headers for all four endpoints. `getContext` sends no Authorization when the store is empty and sends the stored bearer when present. A present bearer that receives 401 is cleared and returns `AUTH_REQUIRED`; it is never retried anonymously. Required operations fail locally with `AUTH_REQUIRED` when no v2 session exists. `login()` coalesces concurrent exchange calls and returns/saves the decoded v2 user ID; `currentUserId()` returns only the valid stored owner ID.

Freeze `OpenGameRegistrationApiError` as the only source rejection type. Its closed code union is `AUTH_REQUIRED | LOGIN_FAILED | OPEN_GAME_NOT_FOUND | APPLICATION_NOT_FOUND | APPLICATION_ALREADY_EXISTS | APPLICATION_NOT_ALLOWED | APPLICATION_STATE_CHANGED | APPLICATION_CAPACITY_CHANGED | IDEMPOTENCY_KEY_REUSED | INVALID_ARGUMENT | SERVICE_UNAVAILABLE | APPLICATION_RESULT_UNKNOWN`. Its closed details union is none, 422 field errors, `{ applyBlockedReason, remainingSpots }`, or `{ remainingSpots, allowedActions }`; each error code accepts only its contract-defined detail variant.

Freeze the status/code matrix:

```text
context: 401 AUTH_REQUIRED; 404 OPEN_GAME_NOT_FOUND
apply:   401 AUTH_REQUIRED; 404 OPEN_GAME_NOT_FOUND;
         409 APPLICATION_ALREADY_EXISTS | APPLICATION_NOT_ALLOWED | IDEMPOTENCY_KEY_REUSED;
         422 INVALID_ARGUMENT
queue:   401 AUTH_REQUIRED; 404 OPEN_GAME_NOT_FOUND;
         422 INVALID_ARGUMENT
decide:  401 AUTH_REQUIRED; 404 OPEN_GAME_NOT_FOUND | APPLICATION_NOT_FOUND;
         409 APPLICATION_STATE_CHANGED | APPLICATION_CAPACITY_CHANGED | IDEMPOTENCY_KEY_REUSED;
         422 INVALID_ARGUMENT
```

Decode the two closed 409 detail shapes. Network timeout, 5xx, out-of-matrix envelope, or malformed successful mutation is `APPLICATION_RESULT_UNKNOWN`; the equivalent read failure is `SERVICE_UNAVAILABLE`. A write never returns a locally invented JOINED/REJECTED result.

- [ ] **Step 2: Run RED**

```bash
npx jest miniprogram/services/http-open-game-registration.test.ts --runInBand
```

Expected: FAIL because the HTTP source is absent.

- [ ] **Step 3: Implement request construction, strict decoding and error classification**

Use the existing `StatusTransport`, `WeChatIdentityCapability`, `SessionStore`, decoder primitives and WeChat session decoder. Implement the exact `OpenGameRegistrationSource` return/rejection contract from Tasks 10–11. Keep one explicit login method; authenticated registration operations do not silently exchange identities. Send `Idempotency-Key` only for apply/decision and use the attempt verbatim. Decode response authority before returning success.

- [ ] **Step 4: Run GREEN and commit**

```bash
npx jest miniprogram/services/http-open-game-registration.test.ts --runInBand
npm run typecheck
git add miniprogram/services/http-open-game-registration.ts \
  miniprogram/services/http-open-game-registration.test.ts
git diff --cached --check
git commit -m "feat: call open game registration api"
```

### Task 12: Implement the production player application form

**Files:**

- Create: `miniprogram/pages/player-game-application/index.json`
- Create: `miniprogram/pages/player-game-application/index.ts`
- Create: `miniprogram/pages/player-game-application/index.wxml`
- Create: `miniprogram/pages/player-game-application/index.wxss`
- Create: `miniprogram/pages/player-game-application/index.test.ts`

- [ ] **Step 1: Write page-controller RED tests**

Use registered fake source/store authority and cover invalid token, context load, draft editing, all five positions, both confirmations, client errors, cancel/back with zero write, duplicate-tap suppression, successful submit/navigation, 401 draft preservation and explicit login, definite validation/state/capacity failures, unknown-result context-read/replay with the same key, stale async results after hide/unload, same-account restart, same-account other pending operation, different-account no-replay, explicit local clear and every visible recovery button.

Parse WXML to require a real handler for every button. Require submission to be impossible unless context says `canApply`, validation passes, and the current v2 user ID owns the attempt.

- [ ] **Step 2: Run RED**

```bash
npx jest miniprogram/pages/player-game-application/index.test.ts --runInBand
```

Expected: FAIL because the production page does not exist.

- [ ] **Step 3: Implement the page with the approved native layout**

Migrate the approved structure/styles from `miniprogram/dev/pages/c1a-game-application/index.{wxml,wxss,json}` into the production files, removing the Fixture notice, preview subtitle, injected outcomes and development routes. Accept only `?token=<32-char token>`, reload authoritative context on entry, and keep all bottom buttons explicitly flex-centered on both axes with the existing safe-area padding.

Create the attempt only after a valid v2 session is present. On 401 keep draft/attempt and ask for login; after login compare user IDs before any replay. On definite no-longer-applicable state clear the unsubmitted attempt and return to the shared detail. On unknown result, read context first and either accept existing registration or replay exactly the stored attempt. A same-account attempt for another resource shows “前往确认” and navigates by its stored token/game ID; it cannot start a second mutation. “清除本机待确认记录” is shown only for a different-account attempt, removes only that local registration attempt and then reloads authority.

- [ ] **Step 4: Run GREEN and commit**

```bash
npx jest miniprogram/pages/player-game-application/index.test.ts --runInBand
npm run typecheck
git add miniprogram/pages/player-game-application
git diff --cached --check
git commit -m "feat: submit player game applications"
```

### Task 13: Connect shared game detail to registration authority

**Files:**

- Modify: `miniprogram/pages/captain-game-public/index.ts`
- Modify: `miniprogram/pages/captain-game-public/index.wxml`
- Modify: `miniprogram/pages/captain-game-public/index.wxss`
- Modify: `miniprogram/pages/captain-game-public/index.test.ts`

- [ ] **Step 1: Write shared-mode RED tests**

Keep every existing owner-preview test. For shared mode, cover anonymous/login/apply navigation, APPLIED refresh, JOINED, REJECTED, effective CANCELLED, every server blocker, service error/retry, auth loss, invalid token, stale reads, own unknown apply recovery, same-account pending attempt for another token/game navigating to its deterministic recovery route, different-account pending clear/no-send, and native share/back behavior. Assert anonymous projection contains no applicant keys and shared mode never calls `getSharedGame` directly.

- [ ] **Step 2: Run RED**

```bash
npx jest miniprogram/pages/captain-game-public/index.test.ts --runInBand
```

Expected: shared-mode registration cases FAIL while owner-preview cases remain GREEN.

- [ ] **Step 3: Compose the two authoritative modes**

Owner preview continues to use `OpenGameSource.getOwnedGame(...).publicView` and existing B2 return-to-manage behavior. Shared mode uses only `OpenGameRegistrationSource.getContext(token)`. Move the approved `c1a-game-public` status card and fixed-action composition into a shared-only WXML block, without Fixture data; keep the existing owner-only summary block intact.

Render action text/blocker from the response. “登录并继续” performs explicit login then reloads the same token; “申请加入” navigates to `/pages/player-game-application/index?token=...`; “刷新结果” performs a real context read. Unknown recovery uses the stored key only when account ownership matches. A same-account attempt for another resource navigates to that resource for resolution; a different-account attempt offers only local clear/back and is never sent.

- [ ] **Step 4: Run GREEN and commit**

```bash
npx jest miniprogram/pages/captain-game-public/index.test.ts --runInBand
npm run typecheck
git add miniprogram/pages/captain-game-public/index.{ts,wxml,wxss,test.ts}
git diff --cached --check
git commit -m "feat: show player application status"
```

### Task 14: Implement the production captain review queue

**Files:**

- Create: `miniprogram/pages/captain-game-applications/index.json`
- Create: `miniprogram/pages/captain-game-applications/index.ts`
- Create: `miniprogram/pages/captain-game-applications/index.wxml`
- Create: `miniprogram/pages/captain-game-applications/index.wxss`
- Create: `miniprogram/pages/captain-game-applications/index.test.ts`

- [ ] **Step 1: Write review-page RED tests**

Cover invalid game ID, ordered queue/empty states, exact applicant privacy fields, accept and reject confirmation open/close, duplicate-tap suppression, response-authoritative success and next-item reload, full disables accept but keeps reject, capacity conflict keeps the row pending, state conflict refreshes, unknown decision replays the same key, 401 explicit login, symmetric 404, service retry, stale responses, same-account restart, same-account pending attempt for another token/game navigating to its deterministic recovery route, different-account no-replay/local clear and every visible WXML button handler.

Behavior-test every replacement for a preview-only control: normal header back uses `navigateBack` when possible and otherwise redirects to `/pages/captain-game-manage/index?game_id=<current>`; the empty-state button returns to that real manage route; a 404 return uses history when available and otherwise reLaunches `/pages/intent-entry/index`; “关闭并稍后确认” preserves the decision attempt and uses the same real back/manage fallback without replaying it. Production WXML contains no role switch, scenario route, “返回预览入口” or “切换到申请人视角”.

- [ ] **Step 2: Run RED**

```bash
npx jest miniprogram/pages/captain-game-applications/index.test.ts --runInBand
```

Expected: FAIL because the production review page is absent.

- [ ] **Step 3: Implement one-at-a-time review over the full authority queue**

Migrate the approved structure/styles from `miniprogram/dev/pages/c1a-captain-applications/index.{wxml,wxss,json}`, removing Fixture role switches, preview routes and injected outcomes. Show `pendingCount` but render only the first returned item. Derive button visibility exclusively from its four-field `allowedActions`.

Both actions open the approved confirmation sheet; closing changes nothing. Store an account-bound attempt before the POST. A successful decision clears it and reloads the queue. Capacity/state conflicts never optimistically remove the row. Unknown replay is verbatim and cannot run under another session user ID. A same-account attempt for another resource navigates to its stored shared-detail/review route; a different-account attempt can only be locally cleared. Replace the preview header/empty/not-found/unknown-close controls with the real navigation behaviors frozen in Step 1; delete role-switch/scenario handlers entirely. All buttons retain explicit flex centering and the fixed footer/sheet retain safe-area padding.

- [ ] **Step 4: Run GREEN and commit**

```bash
npx jest miniprogram/pages/captain-game-applications/index.test.ts --runInBand
npm run typecheck
git add miniprogram/pages/captain-game-applications
git diff --cached --check
git commit -m "feat: review player game applications"
```

### Task 15: Wire navigation, runtime composition and package gates

**Files:**

- Modify: `miniprogram/app.json`
- Modify: `miniprogram/pages/captain-game-manage/index.ts`
- Modify: `miniprogram/pages/captain-game-manage/index.wxml`
- Modify: `miniprogram/pages/captain-game-manage/index.wxss`
- Modify: `miniprogram/pages/captain-game-manage/index.test.ts`
- Modify: `miniprogram/dev/bootstrap.ts`
- Modify: `scripts/build-miniprogram.mjs`
- Modify: `scripts/audit-production-package.mjs`
- Modify: `tests/build-miniprogram.test.mjs`
- Modify: `tests/development-http-build.test.mjs`
- Modify: `tests/audit-production-package.test.mjs`
- Modify: `tests/production-package-booking-audit.test.mjs`

- [ ] **Step 1: Write composition/navigation RED tests**

Require both new production routes in development and production manifests, raising the base production route count from 17 to exactly 19. Require production bootstrap and development HTTP mode to register one shared `createHttpOpenGameRegistrationSource`, the account-bound attempt store and the same session store used by B2 registration-adjacent HTTP calls. Fixture development mode must not register synthetic C1a production authority; opening a production C1a route there must fail honestly into its normal load error.

Extend manage-page tests so a READY PUBLISHED owner sees “报名审核”, its click navigates to `/pages/captain-game-applications/index?game_id=...`, all other states hide it, and B2 owner actions remain unchanged. Extend package audit tests to reject the C1a Fixture marker, `miniprogram/dev/c1a-*`, dev C1a routes and synthetic names/times from every production output.

Update the `productionRoutes` fixture in `tests/production-package-booking-audit.test.mjs` from the current 17 routes to the exact 19-route order by adding player application and captain review; all its poisoned-package cases must continue to construct an otherwise-valid production package.

- [ ] **Step 2: Run RED**

```bash
node --test tests/build-miniprogram.test.mjs \
  tests/development-http-build.test.mjs \
  tests/audit-production-package.test.mjs \
  tests/production-package-booking-audit.test.mjs
npx jest miniprogram/pages/captain-game-manage/index.test.ts --runInBand
```

Expected: route, bootstrap, audit and manage navigation assertions FAIL.

- [ ] **Step 3: Implement the minimal composition changes**

Add the two routes to `app.json`. In manage data set `canReviewApplications = owner.state === "PUBLISHED"`; add one real navigation handler and button without extending `OpenGameOwner`. In generated production bootstrap, call `createOpenGameRegistrationAttemptStore(productionSessionStorage)`, register that instance, and create/register the HTTP source using `productionIdentity`, `runtime.transport` and the existing v2 `sessionStore`. Mirror the exact factory/registry wiring with the development HTTP `SessionStorage` only in `bootstrapDevelopment({ source: "http" })`; leave Fixture mode unregistered.

Keep the audit path/token lists closed. Do not include `miniprogram/dev`, contract JSON, synthetic identities or sample application data in production.

- [ ] **Step 4: Run the full Chunk 2 gate**

```bash
npx jest miniprogram/services/session-store.test.ts \
  miniprogram/domain/open-game-registration-decoder.test.ts \
  miniprogram/services/open-game-registration.test.ts \
  miniprogram/services/open-game-registration-attempt-store.test.ts \
  miniprogram/services/http-open-game-registration.test.ts \
  miniprogram/pages/player-game-application/index.test.ts \
  miniprogram/pages/captain-game-public/index.test.ts \
  miniprogram/pages/captain-game-applications/index.test.ts \
  miniprogram/pages/captain-game-manage/index.test.ts --runInBand
node --test tests/build-miniprogram.test.mjs \
  tests/development-http-build.test.mjs \
  tests/audit-production-package.test.mjs \
  tests/production-package-booking-audit.test.mjs
npx eslint miniprogram/domain/open-game-registration*.ts \
  miniprogram/services/session-store*.ts \
  miniprogram/services/open-game-registration*.ts \
  miniprogram/services/http-open-game-registration*.ts \
  miniprogram/services/http-{booking,inventory,open-game,payment,pitch-configuration,venue-access,venue-fulfillment,venue-onboarding,venue-profile}*.ts \
  miniprogram/pages/player-game-application/index*.ts \
  miniprogram/pages/captain-game-public/index*.ts \
  miniprogram/pages/captain-game-applications/index*.ts \
  miniprogram/pages/captain-game-manage/index*.ts \
  miniprogram/dev/bootstrap.ts scripts/build-miniprogram.mjs \
  scripts/audit-production-package.mjs tests/build-miniprogram.test.mjs \
  tests/development-http-build.test.mjs tests/audit-production-package.test.mjs \
  tests/production-package-booking-audit.test.mjs
npm run typecheck
npm run build:miniprogram:development
MINIPROGRAM_API_BASE_URL=https://pitch-api-staging.modelstella.com \
MINIPROGRAM_TENCENT_MAP_KEY=AAAAA-BBBBB-CCCCC-DDDDD-EEEEE-FFFFF \
MINIPROGRAM_PAYMENT_PROVIDER=disabled npm run build:miniprogram:production
npm run audit:miniprogram-package
```

Expected: focused Jest/Node/ESLint/type/build/audit gates PASS; the non-secret test-key package contains both C1a routes, real HTTP wiring and zero dev/Fixture data. Real ignored live input is first used only in the candidate release chunk.

- [ ] **Step 5: Commit production composition**

```bash
git add miniprogram/app.json miniprogram/pages/captain-game-manage/index.{ts,wxml,wxss,test.ts} \
  miniprogram/dev/bootstrap.ts scripts/build-miniprogram.mjs scripts/audit-production-package.mjs \
  tests/build-miniprogram.test.mjs tests/development-http-build.test.mjs \
  tests/audit-production-package.test.mjs tests/production-package-booking-audit.test.mjs
git diff --cached --check
git commit -m "feat: wire open game registration journey"
```

## Chunk 3: Candidate acceptance, Fixture retirement and final release

### Task 16: Synchronize with main and freeze a locally verified candidate

**Files:**

- No product files expected beyond conflict resolution.
- Do not modify acceptance status until a result has actually been observed.
- Execution starts only after this implementation plan and Tasks 1–15 are committed; an untracked plan is a hard stop.

- [ ] **Step 1: Bring the feature branch up to date before release testing**

First require this plan is tracked and the feature worktree has no tracked or non-ignored untracked changes. The two ignored mode-0600 live inputs currently live only in the main worktree. Provision them without printing or overwriting a different value:

```bash
feature_root=/Users/fan/Repositories/startups/pitch-booking/.worktrees/c1-player-application-preview
main_root=/Users/fan/Repositories/startups/pitch-booking
git ls-files --error-unmatch \
  docs/superpowers/plans/2026-08-24-player-game-application-production.md
test -z "$(git status --porcelain)"
for relative_path in deploy/.env.live.local deploy/miniprogram.live.local; do
  input_path="$main_root/$relative_path"
  local_path="$feature_root/$relative_path"
  test -f "$input_path" && test ! -L "$input_path"
  test "$(stat -f '%Lp' "$input_path")" = 600
  if test ! -e "$local_path"; then install -m 600 "$input_path" "$local_path"; fi
  test -f "$local_path" && test ! -L "$local_path"
  test "$(stat -f '%Lp' "$local_path")" = 600
  cmp -s "$input_path" "$local_path"
done
```

Then run from the feature worktree:

```bash
git fetch origin
git merge --no-edit origin/main
git status --short
```

Expected: the ignored inputs are regular mode-0600 byte-equivalent copies, merge succeeds (or reports already up to date), and status is empty. Resolve a conflict only by preserving both the current main behavior and this plan's approved C1a contract; rerun the affected task gate after any resolution.

- [ ] **Step 2: Start the scoped disposable database and run backend/contract gates**

```bash
docker compose -f deploy/compose.test.yaml up -d --wait
TEST_DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test \
uv run pytest \
  backend/tests/test_open_game_registration_schema.py \
  backend/tests/test_open_game_registration_lifecycle.py \
  backend/tests/test_open_game_registration_service.py \
  backend/tests/test_open_game_registration_api.py \
  backend/tests/test_open_game_registration_concurrency.py \
  backend/tests/test_open_game_registration_http_journey.py \
  backend/tests/test_open_game_service.py \
  backend/tests/test_open_game_schema.py \
  backend/tests/test_booking_migration_cycle.py \
  backend/tests/test_platform_session_migration.py \
  backend/tests/test_openapi_conformance.py \
  backend/tests/test_deploy_preflight.py -q
uv run ruff check backend/app/models.py backend/app/main.py \
  backend/app/modules/open_games backend/app/modules/open_game_registrations \
  backend/migrations/versions/0016_open_game_registrations.py \
  backend/tests/test_open_game_registration_*.py backend/tests/test_open_game_service.py \
  backend/tests/test_deploy_preflight.py
uv run mypy backend/app/modules/open_games backend/app/modules/open_game_registrations
npm run contract:validate
docker compose -f deploy/compose.test.yaml down
```

Expected: every command PASS and the disposable database is stopped after the gate. If a test fails, leave it available only while diagnosing that failure; never continue to candidate deployment.

- [ ] **Step 3: Run the focused Mini Program/build gate**

```bash
npx jest miniprogram/services/session-store.test.ts \
  miniprogram/domain/open-game-registration-decoder.test.ts \
  miniprogram/services/open-game-registration.test.ts \
  miniprogram/services/open-game-registration-attempt-store.test.ts \
  miniprogram/services/http-open-game-registration.test.ts \
  miniprogram/pages/player-game-application/index.test.ts \
  miniprogram/pages/captain-game-public/index.test.ts \
  miniprogram/pages/captain-game-applications/index.test.ts \
  miniprogram/pages/captain-game-manage/index.test.ts --runInBand
node --test tests/build-miniprogram.test.mjs \
  tests/development-http-build.test.mjs \
  tests/audit-production-package.test.mjs \
  tests/production-package-booking-audit.test.mjs
npm run typecheck
npm run build:miniprogram:development
bash -c 'set -a; source deploy/miniprogram.live.local; set +a; MINIPROGRAM_PAYMENT_PROVIDER=disabled npm run build:miniprogram:production'
npm run audit:miniprogram-package
git diff --check
git status --short
```

Expected: all gates PASS, production audit reports zero forbidden paths/tokens, payment remains disabled, and the tree is clean.

- [ ] **Step 4: Push the reproducible candidate branch**

```bash
git push -u origin feature/c1-player-application-preview
candidate_sha="$(git rev-parse HEAD)"
test "${#candidate_sha}" -eq 40
test "$(git rev-parse origin/feature/c1-player-application-preview)" = "$candidate_sha"
git diff --quiet
git diff --cached --quiet
```

Record the 40-character value as `candidate_sha` in the release run state. Candidate staging, production package and candidate experience upload must all use this exact commit; later tasks must substitute that recorded literal and must never redefine it from a newer `HEAD`.

### Task 17: Deploy the immutable candidate and upload the next experience version

**Files:**

- No tracked file changes.
- Ignored inputs only: `deploy/.env.live.local`, `deploy/miniprogram.live.local`, `dist/**`.

- [ ] **Step 1: Run local live preflight without printing secrets**

```bash
candidate_sha='<recorded Task 16 candidate_sha literal>'
test "${#candidate_sha}" -eq 40
test "$(git rev-parse HEAD)" = "$candidate_sha"
test "$(git rev-parse origin/feature/c1-player-application-preview)" = "$candidate_sha"
git diff --quiet
git diff --cached --quiet
test -f deploy/.env.live.local
test -f deploy/miniprogram.live.local
uv run python -m scripts.preflight_deploy --env-file deploy/.env.live.local
docker compose --env-file deploy/.env.live.local config --quiet
docker compose --env-file deploy/.env.live.local -f compose.yaml \
  -f deploy/compose.rollback-retain-schema.yaml config --quiet
```

Expected: both ignored inputs exist and preflight/config PASS. Do not source either file with tracing enabled and do not print their contents.

- [ ] **Step 2: Snapshot and back up the current `ucloud-v100` release**

Before upload, resolve and record without secret values:

```text
current symlink target under /opt/pitch-booking/releases
shared env regular file with mode 0600
active Compose project label from the sole Caddy bound to 127.0.0.1:8080
PostgreSQL mount name
API/worker image IDs
API/worker Compose image references
GET /api/v1/health revision
Alembic revision
```

With `umask 077`, copy the shared env to `/opt/pitch-booking/backups/env-before-<candidate_sha>-<utc>` and require `cmp -s`. Using the resolved Compose project and existing PostgreSQL service, stream `pg_dump -Fc --no-owner --no-acl` to a temporary mode-0600 file, require non-empty output, validate silently with `pg_restore --list`, then atomically rename it under `/opt/pitch-booking/backups/`. Never print the env, dump, database URL or list output.

- [ ] **Step 3: Transfer and activate the exact candidate archive**

Locally create an archive from the verified commit, not the working tree:

```bash
test "${#candidate_sha}" -eq 40
test "$(git rev-parse HEAD)" = "$candidate_sha"
test "$(git rev-parse origin/feature/c1-player-application-preview)" = "$candidate_sha"
git diff --quiet
git diff --cached --quiet
git archive --format=tar --output="/tmp/pitch-booking-${candidate_sha}.tar" "$candidate_sha"
test "$(git get-tar-commit-id < "/tmp/pitch-booking-${candidate_sha}.tar")" = "$candidate_sha"
shasum -a 256 "/tmp/pitch-booking-${candidate_sha}.tar"
```

Transfer as a mode-0600 incoming file, verify the SHA-256 remotely, extract to a new `/opt/pitch-booking/releases/$candidate_sha`, require `compose.yaml`, migration `0016` and `deploy/compose.rollback-retain-schema.yaml`, and refuse to overwrite an existing release. Derive a mode-0600 same-directory temporary env from the verified backup, changing only `APP_REVISION`; render candidate config against that temporary file before replacing the shared env atomically. On the remote host set only these non-secret shell variables and run:

```bash
shared_env=/opt/pitch-booking/shared/.env.live.local
release_dir="/opt/pitch-booking/releases/$candidate_sha"
candidate_env_tmp="/opt/pitch-booking/shared/.env.candidate-${candidate_sha}.tmp"
test -f "$candidate_env_tmp" && test ! -L "$candidate_env_tmp"
test "$(stat -c '%a' "$candidate_env_tmp")" = 600
docker compose -p "$compose_project" --env-file "$candidate_env_tmp" \
  -f "$release_dir/compose.yaml" config --quiet
mv "$candidate_env_tmp" "$shared_env"
docker compose -p "$compose_project" --env-file "$shared_env" \
  -f "$release_dir/compose.yaml" up -d --build --wait --wait-timeout 180
```

Then require the PostgreSQL mount to be unchanged, atomically repoint `current`, and verify:

```text
GET /api/v1/health = 200 and X-App-Revision = candidate_sha
api/postgres healthy; worker/caddy running
alembic current = 0016
unknown shared token context = 404
unauthenticated apply/list/decision = 401
malformed Authorization on registration context = 401
```

An archive/extraction/config failure before shared-env mutation removes only the exact temporary env/archive input and stops with the old release untouched. After the shared env changes, any activation or post-`up` failure enters rollback: stop candidate `api`, `worker` and `caddy` if present while leaving PostgreSQL running. Read `alembic_version.version_num` directly through PostgreSQL without credentials in host output; accept only `0015` (transactional upgrade did not land) or `0016` (additive schema landed and must remain). Never run an online downgrade or restore the dump.

```bash
docker compose -p "$compose_project" --env-file "$shared_env" \
  -f "$release_dir/compose.yaml" stop api worker caddy
docker compose -p "$compose_project" --env-file "$shared_env" \
  -f "$release_dir/compose.yaml" exec -T postgres sh -c \
  'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT version_num FROM alembic_version"'
```

Atomically restore the previous env and symlink. Require both recorded image IDs and exact image references, plus the candidate's tested rollback override, to exist. Retag the old images, render the previous release layered with the candidate override, and restart it with migrations bypassed:

```bash
rollback_override="$release_dir/deploy/compose.rollback-retain-schema.yaml"
test -f "$rollback_override" && test ! -L "$rollback_override"
docker image tag "$previous_api_image_id" "$previous_api_image_ref"
docker image tag "$previous_worker_image_id" "$previous_worker_image_ref"
docker compose -p "$compose_project" --env-file "$shared_env" \
  -f "$previous_release_dir/compose.yaml" -f "$rollback_override" config --quiet
docker compose -p "$compose_project" --env-file "$shared_env" \
  -f "$previous_release_dir/compose.yaml" -f "$rollback_override" \
  up -d --no-build --force-recreate \
  api worker caddy --wait --wait-timeout 180
```

Re-require previous application revision/health/mount, that `current` resolves to the previous release, and that the database revision remains the observed `0015` or retained `0016`. A mount/project/image ambiguity, missing old image/override, any other database revision or failed old-release health check stops for user direction.

- [ ] **Step 4: Prepare and audit the isolated candidate Mini Program**

```bash
test "$(git rev-parse HEAD)" = "$candidate_sha"
test "$(git rev-parse origin/feature/c1-player-application-preview)" = "$candidate_sha"
git diff --quiet
git diff --cached --quiet
bash -c 'set -a; source deploy/miniprogram.live.local; set +a; MINIPROGRAM_PAYMENT_PROVIDER=disabled npm run build:miniprogram:production'
npm run audit:miniprogram-package
uv run python -m scripts.preflight_deploy \
  --env-file deploy/.env.live.local \
  --require-miniprogram-acceptance
npm run prepare:miniprogram:live-preview
```

Expected: audited package targets `https://pitch-api-staging.modelstella.com`, payment/online booking remain disabled, both C1a production routes and HTTP source are present, C1a/B2 development Fixtures are absent from the production output, and `dist/miniprogram-live-preview` uses the production AppID/project root.

- [ ] **Step 5: Upload the next actual experience version**

Open only `dist/miniprogram-live-preview` in WeChat DevTools. Read the current highest uploaded version in the platform before choosing a number. The known baseline supplied by the user is `0.1.4`, so the expected candidate is `0.1.5`; if the platform is already newer, use the next free patch instead of overwriting history.

Immediately before clicking upload, repeat the clean tracked-tree, local `HEAD == candidate_sha` and `origin/feature/... == candidate_sha` assertions from Step 4, rerun `npm run audit:miniprogram-package`, and require staging health still reports the same `candidate_sha`. A mismatch invalidates this build; do not upload it.

Upload with remark:

```text
2026-08-24 C1a候选；B2+C1a真实staging；支付关闭；source <candidate_sha>
```

Set that upload as the experience version. This standing action is authorized by the user's instruction to deploy/upload each completed module; it does not authorize formal review or public release. Record the actual candidate version and SHA in local run evidence for Task 18.

### Task 18: Complete native visual review and dual-account candidate acceptance

**Files after observed results:**

- Create: `docs/acceptance/player-game-application-progress.md`
- Modify: `docs/acceptance/captain-open-game-progress.md`
- Modify: `docs/superpowers/plans/2026-08-16-overall-slice-roadmap.md`

- [ ] **Step 1: Prepare three exact, non-funding acceptance games**

Select three future `CONFIRMED` staging orders owned by the captain account, more than two hours from start, with no payment/refund mutation required. If fewer than three exist, create the missing clearly marked staging-only non-funding orders through the existing staging acceptance mechanism; never describe them as paid. Record exact Order/Slot/Payment/RefundCase/RefundAttempt baselines and stable acceptance markers without PII. Before the first UI mutation, take a baseline of existing `IdempotencyRecord` IDs/tuples for every participating account. Create exactly `/tmp/pitch-booking-c1a-acceptance-${candidate_sha}.json` with `umask 077`, refusing an existing path or symlink; keep `(id, user_id, operation, key, request_sha256)` only in that outside-repository mode-0600 ledger and never commit or print it.

The first two games are for ACCEPT and REJECT so one applicant account can exercise both terminal results without violating the one-application-per-game rule. The third game is reserved for both the full B2 device journey and the C1a capacity-change scenario; its final published edit leaves exactly one remaining spot.

- [ ] **Step 2: Run B2 plus C1a with different captain/applicant accounts**

Using the candidate experience version, first exercise the complete B2 gate on the third order rather than only create/share:

```text
open CREATE from the real order detail
edit every visible field/control, including ANY, deadline and AA; save DRAFT
preview and return; reopen edit; verify prefill; edit and save again
open and close publish confirmation; reopen and confirm publish
invoke native share; open token view; verify public privacy and back
edit and save while PUBLISHED, leaving exactly one open spot
```

Create/publish/share the first two marked games as well. Then run the C1a terminal journeys:

```text
applicant: open first share, log in, submit, see APPLIED, refresh
captain: open review, open/close ACCEPT sheet, accept
applicant: refresh same detail and see JOINED
applicant: open second share, submit, see APPLIED
captain: open review, open/close REJECT sheet, reject
applicant: refresh same detail and see REJECTED
```

After each successful B2 or C1a mutation, immediately identify the one new idempotency row by the controlled account/operation and record its exact tuple in the local ledger; any ambiguity or unexpected concurrent row stops cleanup/acceptance. Also verify owner cannot self-apply, anonymous/public views contain no applicant data, manage → review and all back paths work, fixed controls remain safe, and Order/Slot/Payment/Refund rows equal their baselines.

At the natural journey milestones, capture but do not yet share exactly three production-runtime iPhone X `375×812` states: application-ready with the approved field content, both confirmations unselected and submit disabled; captain-pending before the first decision; and rejected applicant detail after the second decision. These become Step 4's only production visual-review inputs.

- [ ] **Step 3: Exercise one real capacity-change UI response**

On the third game, use one captain plus two distinct authorized applicant identities. Applicant A applies first, applicant B second. Load the captain page while A is still the first pending item and `can_accept=true`. Through a second authenticated captain API session whose bearer is kept only in memory, list the same queue and ACCEPT B by its application ID/version, consuming the last spot; do not log the bearer. Without refreshing the first page, tap its original ACCEPT for A. Require real API `APPLICATION_CAPACITY_CHANGED`, A remains APPLIED, the page shows “名额状态已变化”, refresh keeps reject available, and no local JOINED result appears. If the second applicant or controlled captain session is unavailable, leave this gate pending and stop; do not substitute a Toast, Fixture, direct database edit or local state toggle for the real response.

Finally return to the third game's owner manage page, open and close the cancel confirmation, reopen and confirm cancel, verify CANCELLED has no mutation actions, verify both applicant contexts project effective cancellation, and return to the order. Re-prove all three Order/Slot/Payment/Refund baselines. Query the participating accounts' idempotency rows and require the exact post-baseline difference to equal the mode-0600 ledger, including every B2 create/update/publish/cancel and C1a apply/decision tuple; any missing or extra tuple blocks PASS.

- [ ] **Step 4: Perform one proportional production-runtime visual self-review**

Using the three real staging captures from Step 2, compare each at the same viewport to its approved reference with implementation, side-by-side, 50% overlay and difference views; do not recapture all six approved Fixture states.

Before sharing any image or PASS, manually check: button labels are centered horizontally and vertically; repeated options/badges align and match size; arrows/check/X glyphs are complete; no boundary clipping; fixed footer/sheet clears safe area; business copy/data and status semantics are authoritative. If a visible product issue needs a code change, first run only Task 19 Step 3's exact ledger-driven data cleanup and re-prove B1 baselines while retaining all Fixtures; then commit the minimal fix, rerun the affected gate, and repeat Tasks 16–18 from candidate freeze with fresh acceptance data. The prior candidate and observed results are invalid. One failed capture-tool attempt may use a simpler screenshot path; do not turn it into a toolchain project.

- [ ] **Step 5: Record only observed acceptance evidence**

Create/update the three documents with candidate SHA/version, staging revision, DevTools/runtime versions, account roles (no identifiers), the three visual PASS results, full B2 draft/preview/publish/share/published-edit/cancel PASS, C1a ACCEPT/REJECT/capacity results, B1-row immutability and current completion state. Mark B2 Task 10 and C1a candidate acceptance PASS only when all prior steps passed; do not yet claim final merge/deploy/upload.

### Task 19: Retire the C1a and B2 development Fixtures after combined PASS

**Files:**

- Delete: `miniprogram/dev/c1a-player-application-fixture.ts`
- Delete: `miniprogram/dev/c1a-player-application-fixture.test.ts`
- Delete: `miniprogram/dev/c1a-player-application-pages.json`
- Delete: `miniprogram/dev/pages/c1a-scenario/**`
- Delete: `miniprogram/dev/pages/c1a-game-public/**`
- Delete: `miniprogram/dev/pages/c1a-game-application/**`
- Delete: `miniprogram/dev/pages/c1a-captain-applications/**`
- Delete: `miniprogram/dev/captain-open-game-fixture.ts`
- Delete: `miniprogram/dev/captain-open-game-fixture.test.ts`
- Delete: `miniprogram/dev/captain-open-game-pages.json`
- Delete: `miniprogram/dev/pages/captain-game-form/**`
- Delete: `miniprogram/dev/pages/captain-game-manage/**`
- Delete: `miniprogram/dev/pages/captain-game-public/**`
- Delete: `miniprogram/dev/open-game-source.ts`
- Delete: `miniprogram/dev/open-game-source.test.ts`
- Modify: `miniprogram/dev/app-pages.json`
- Modify: `miniprogram/dev/bootstrap.ts`
- Modify: `tests/player-game-application-native-preview.test.mjs`
- Modify: `tests/captain-open-game-native-preview.test.mjs`
- Modify: `tests/build-miniprogram.test.mjs`
- Modify: `tests/audit-production-package.test.mjs`
- Modify: `docs/acceptance/player-game-application-progress.md`
- Modify: `docs/acceptance/captain-open-game-progress.md`
- Modify: `docs/superpowers/plans/2026-08-16-overall-slice-roadmap.md`

- [ ] **Step 1: Write the Fixture-retirement RED gate**

Change both native-preview tests from preview-presence tests into retirement gates. Require every listed C1a/B2 dev artifact and marker to be absent while both slices' Artifact/reference/review evidence, five production routes, strict HTTP sources and persistent attempt stores remain. Update build/audit tests to require the same final source/package boundary and remove the three B2 dev routes from `miniprogram/dev/app-pages.json`. Run:

```bash
node --test tests/player-game-application-native-preview.test.mjs \
  tests/captain-open-game-native-preview.test.mjs \
  tests/build-miniprogram.test.mjs \
  tests/audit-production-package.test.mjs
```

Expected: RED only because the approved temporary C1a/B2 Fixture files and route entries still exist.

- [ ] **Step 2: Delete exactly the approved C1a/B2 preview boundaries**

Delete only the listed C1a Fixture/store/route fragment/four dev page directories and the listed B2 Fixture/adapter/route fragment/three dev page directories. Remove only B2 Fixture-mode imports/registration from `miniprogram/dev/bootstrap.ts`; preserve its real HTTP-mode OpenGame and registration wiring. Do not delete any production registration/open-game code, production pages, Artifact tests, `artifacts/ui/**`, design/spec/plan documents or unrelated dev routes.

- [ ] **Step 3: Clean only marked staging acceptance domain rows**

Set `ledger_path=/tmp/pitch-booking-c1a-acceptance-${candidate_sha}.json`, require that exact path to be a regular non-symlink mode-0600 file, and refuse any other target. In one transaction, lock the three exact marked game graphs and re-prove their Order/Slot/Payment/Refund baselines. Requery every ledger `IdempotencyRecord` by primary key and require exact equality of `(user_id, operation, key, request_sha256)` plus the previously proved post-baseline set difference; do not infer ownership from a game/application foreign key because none exists. Delete registration rows for only those game IDs, then delete exactly the captured B2 and C1a idempotency rows, the three acceptance OpenGames and otherwise-unreferenced dedicated Teams. Require the ledger operations to be only the observed open-game create/update/publish/cancel and registration apply/decision operations, and abort on any missing/extra tuple, marker/count/ownership mismatch or unrelated reference. Never delete users, orders, slots, payments, refunds, venues, pitches or memberships. In a fresh transaction prove all exact ledger IDs and markers are gone and all B1 baselines are unchanged. Only after that proof, run `unlink "$ledger_path"` and require `test ! -e "$ledger_path"`; this deliberately removes the sensitive temporary ledger and does not target any repository file.

- [ ] **Step 4: Run the final source/build/audit gate**

```bash
npx jest miniprogram/domain/open-game-registration-decoder.test.ts \
  miniprogram/services/open-game-registration.test.ts \
  miniprogram/services/open-game-registration-attempt-store.test.ts \
  miniprogram/services/http-open-game-registration.test.ts \
  miniprogram/domain/open-game-decoder.test.ts \
  miniprogram/services/http-open-game.test.ts \
  miniprogram/services/open-game-attempt-store.test.ts \
  miniprogram/pages/player-game-application/index.test.ts \
  miniprogram/pages/captain-game-public/index.test.ts \
  miniprogram/pages/captain-game-applications/index.test.ts \
  miniprogram/pages/captain-game-manage/index.test.ts --runInBand
node --test tests/player-game-application-artifact.test.mjs \
  tests/player-game-application-native-preview.test.mjs \
  tests/captain-open-game-artifact.test.mjs \
  tests/captain-open-game-native-preview.test.mjs \
  tests/build-miniprogram.test.mjs \
  tests/development-http-build.test.mjs \
  tests/audit-production-package.test.mjs \
  tests/production-package-booking-audit.test.mjs
npm run typecheck
bash -c 'set -a; source deploy/miniprogram.live.local; set +a; MINIPROGRAM_PAYMENT_PROVIDER=disabled npm run build:miniprogram:production'
npm run audit:miniprogram-package
git diff --check
```

Expected: production/runtime tests PASS, retirement gate PASS, audit finds zero Fixture/dev leakage, and only the intended deletions/docs/test changes remain.

- [ ] **Step 5: Commit accepted cleanup and evidence**

```bash
git add -A -- miniprogram/dev/c1a-player-application-fixture.ts \
  miniprogram/dev/c1a-player-application-fixture.test.ts \
  miniprogram/dev/c1a-player-application-pages.json \
  miniprogram/dev/pages/c1a-scenario \
  miniprogram/dev/pages/c1a-game-public \
  miniprogram/dev/pages/c1a-game-application \
  miniprogram/dev/pages/c1a-captain-applications \
  miniprogram/dev/captain-open-game-fixture.ts \
  miniprogram/dev/captain-open-game-fixture.test.ts \
  miniprogram/dev/captain-open-game-pages.json \
  miniprogram/dev/pages/captain-game-form \
  miniprogram/dev/pages/captain-game-manage \
  miniprogram/dev/pages/captain-game-public \
  miniprogram/dev/open-game-source.ts miniprogram/dev/open-game-source.test.ts \
  miniprogram/dev/app-pages.json miniprogram/dev/bootstrap.ts \
  tests/player-game-application-native-preview.test.mjs \
  tests/captain-open-game-native-preview.test.mjs \
  tests/build-miniprogram.test.mjs tests/audit-production-package.test.mjs \
  docs/acceptance/player-game-application-progress.md \
  docs/acceptance/captain-open-game-progress.md \
  docs/superpowers/plans/2026-08-16-overall-slice-roadmap.md
git diff --cached --check
git commit -m "chore: retire open game preview fixtures"
git push origin feature/c1-player-application-preview
```

### Task 20: Merge, push, deploy and upload the final main revision

**Files:**

- No new tracked changes after the approved cleanup commit.
- Preserve unrelated untracked files in the main worktree.

- [ ] **Step 1: Verify both branches and merge through the main worktree**

```bash
git fetch origin
git merge --no-edit origin/main
git status --short
git -C /Users/fan/Repositories/startups/pitch-booking status --short --untracked-files=no
git -C /Users/fan/Repositories/startups/pitch-booking pull --ff-only origin main
git -C /Users/fan/Repositories/startups/pitch-booking merge --no-ff \
  feature/c1-player-application-preview \
  -m "Merge C1a player game applications"
```

Expected: feature is caught up, the main worktree has no tracked user edits, and the merge succeeds without touching unrelated untracked files. If main advanced or conflicts, resolve on the feature branch first and rerun the affected focused gates; never overwrite user files.

- [ ] **Step 2: Verify and push final main**

From the main worktree run the exact merged-tree gates:

```bash
docker compose -f deploy/compose.test.yaml up -d --wait
TEST_DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test \
uv run pytest \
  backend/tests/test_open_game_registration_schema.py \
  backend/tests/test_open_game_registration_lifecycle.py \
  backend/tests/test_open_game_registration_service.py \
  backend/tests/test_open_game_registration_api.py \
  backend/tests/test_open_game_registration_concurrency.py \
  backend/tests/test_open_game_registration_http_journey.py \
  backend/tests/test_open_game_service.py backend/tests/test_open_game_api.py \
  backend/tests/test_open_game_schema.py backend/tests/test_booking_migration_cycle.py \
  backend/tests/test_platform_session_migration.py backend/tests/test_openapi_conformance.py \
  backend/tests/test_deploy_preflight.py -q
uv run ruff check backend/app/models.py backend/app/main.py \
  backend/app/modules/open_games backend/app/modules/open_game_registrations \
  backend/migrations/versions/0016_open_game_registrations.py \
  backend/tests/test_open_game_registration_*.py \
  backend/tests/test_open_game_service.py backend/tests/test_open_game_api.py \
  backend/tests/test_deploy_preflight.py
uv run mypy backend/app/modules/open_games backend/app/modules/open_game_registrations
npm run contract:validate
npx jest miniprogram/domain/open-game-decoder.test.ts \
  miniprogram/domain/open-game-registration-decoder.test.ts \
  miniprogram/services/session-store.test.ts \
  miniprogram/services/http-open-game.test.ts \
  miniprogram/services/open-game-attempt-store.test.ts \
  miniprogram/services/open-game-registration.test.ts \
  miniprogram/services/http-open-game-registration.test.ts \
  miniprogram/services/open-game-registration-attempt-store.test.ts \
  miniprogram/pages/player-game-application/index.test.ts \
  miniprogram/pages/captain-game-public/index.test.ts \
  miniprogram/pages/captain-game-applications/index.test.ts \
  miniprogram/pages/captain-game-manage/index.test.ts --runInBand
node --test tests/player-game-application-artifact.test.mjs \
  tests/player-game-application-native-preview.test.mjs \
  tests/captain-open-game-artifact.test.mjs \
  tests/captain-open-game-native-preview.test.mjs \
  tests/build-miniprogram.test.mjs tests/development-http-build.test.mjs \
  tests/audit-production-package.test.mjs tests/production-package-booking-audit.test.mjs
npm run typecheck
bash -c 'set -a; source deploy/miniprogram.live.local; set +a; MINIPROGRAM_PAYMENT_PROVIDER=disabled npm run build:miniprogram:production'
npm run audit:miniprogram-package
docker compose -f deploy/compose.test.yaml down
```

Expected: every focused backend/contract/Mini Program/build/audit gate PASS. Then push both refs and resolve them again:

```bash
git -C /Users/fan/Repositories/startups/pitch-booking status --short --untracked-files=no
git push origin feature/c1-player-application-preview
git -C /Users/fan/Repositories/startups/pitch-booking push origin main
final_main_sha="$(git -C /Users/fan/Repositories/startups/pitch-booking rev-parse HEAD)"
test "${#final_main_sha}" -eq 40
test "$(git -C /Users/fan/Repositories/startups/pitch-booking rev-parse origin/main)" = "$final_main_sha"
test "$(git rev-parse origin/feature/c1-player-application-preview)" = "$(git rev-parse HEAD)"
git -C /Users/fan/Repositories/startups/pitch-booking diff --quiet
git -C /Users/fan/Repositories/startups/pitch-booking diff --cached --quiet
```

Record the exact 40-character value as `final_main_sha` in the release run state. Later steps substitute that recorded literal and never redefine it from a newer main `HEAD`.

- [ ] **Step 3: Deploy the final main SHA**

From main, run live preflight without printing ignored values:

```bash
final_main_sha='<recorded Task 20 Step 2 final_main_sha literal>'
test "${#final_main_sha}" -eq 40
test "$(git rev-parse HEAD)" = "$final_main_sha"
test "$(git rev-parse origin/main)" = "$final_main_sha"
git diff --quiet
git diff --cached --quiet
uv run python -m scripts.preflight_deploy --env-file deploy/.env.live.local
docker compose --env-file deploy/.env.live.local config --quiet
docker compose --env-file deploy/.env.live.local -f compose.yaml \
  -f deploy/compose.rollback-retain-schema.yaml config --quiet
git archive --format=tar --output="/tmp/pitch-booking-${final_main_sha}.tar" "$final_main_sha"
test "$(git get-tar-commit-id < "/tmp/pitch-booking-${final_main_sha}.tar")" = "$final_main_sha"
shasum -a 256 "/tmp/pitch-booking-${final_main_sha}.tar"
```

On `ucloud-v100`, re-resolve the current symlink, shared mode-0600 env, sole Caddy Compose project, PostgreSQL mount, and candidate API/worker image IDs plus their exact Compose image references. Take a new mode-0600 env copy and validated `pg_dump -Fc` under `/opt/pitch-booking/backups`. Transfer/checksum/extract the final archive into a new `/opt/pitch-booking/releases/$final_main_sha`. Derive a same-directory mode-0600 temporary env changing only `APP_REVISION`, render with it, then atomically replace the shared env and run:

```bash
shared_env=/opt/pitch-booking/shared/.env.live.local
release_dir="/opt/pitch-booking/releases/$final_main_sha"
final_env_tmp="/opt/pitch-booking/shared/.env.final-${final_main_sha}.tmp"
test -f "$final_env_tmp" && test ! -L "$final_env_tmp"
test "$(stat -c '%a' "$final_env_tmp")" = 600
docker compose -p "$compose_project" --env-file "$final_env_tmp" \
  -f "$release_dir/compose.yaml" config --quiet
mv "$final_env_tmp" "$shared_env"
docker compose -p "$compose_project" --env-file "$shared_env" \
  -f "$release_dir/compose.yaml" up -d --build --wait --wait-timeout 180
```

Require the mount unchanged, repoint `current`, then require health 200 with `X-App-Revision=$final_main_sha`, healthy API/PostgreSQL, running worker/Caddy, Alembic `0016`, an unknown context 404 and protected registration writes 401. Do not create acceptance rows.

An archive/extraction/config failure before the shared-env replacement removes only the exact temporary input and leaves the candidate running. After the shared env changes, an activation or post-`up` failure stops final `api`, `worker` and `caddy` but keeps PostgreSQL running; both candidate and final releases know schema `0016`, so do not downgrade. Atomically restore the candidate env and symlink, require both recorded candidate image IDs to exist, retag them to their exact recorded references, then run:

```bash
docker image tag "$candidate_api_image_id" "$candidate_api_image_ref"
docker image tag "$candidate_worker_image_id" "$candidate_worker_image_ref"
docker compose -p "$compose_project" --env-file "$shared_env" \
  -f "$candidate_release_dir/compose.yaml" up -d --no-build --force-recreate \
  api worker caddy --wait --wait-timeout 180
```

Require candidate health revision, Alembic `0016` and the original mount. Any ambiguity, missing image or failed candidate health stops for user direction; never restore the dump automatically.

- [ ] **Step 4: Upload the next final experience version**

From the merged main worktree run:

```bash
test "$(git rev-parse HEAD)" = "$final_main_sha"
test "$(git rev-parse origin/main)" = "$final_main_sha"
git diff --quiet
git diff --cached --quiet
bash -c 'set -a; source deploy/miniprogram.live.local; set +a; MINIPROGRAM_PAYMENT_PROVIDER=disabled npm run build:miniprogram:production'
npm run audit:miniprogram-package
uv run python -m scripts.preflight_deploy \
  --env-file deploy/.env.live.local \
  --require-miniprogram-acceptance
npm run prepare:miniprogram:live-preview
```

Read the actual current platform version again; expected after candidate `0.1.5` is final `0.1.6`, otherwise choose the next free patch. Immediately before upload, repeat the clean tracked-tree and local/`origin/main == final_main_sha` assertions, rerun `npm run audit:miniprogram-package`, and require staging health still reports `final_main_sha`. Any mismatch invalidates the prepared package. Upload/set the isolated project as experience with:

```text
2026-08-24 C1a最终体验版；B2+C1a验收通过；支付关闭；source <final_main_sha>
```

Do not submit for formal review or public release.

- [ ] **Step 5: Final truth checks and handoff**

Require all of the following before declaring the slice complete:

```text
feature branch and main pushed
origin/main = final_main_sha
staging health X-App-Revision = final_main_sha
Alembic = 0016
final experience version remark contains final_main_sha
production audit = zero forbidden paths/tokens
C1a and B2 development Fixtures absent
B2+C1a dual-account/device evidence PASS
dedicated acceptance rows cleaned with B1 baselines unchanged
outside-repository acceptance ledger removed
```

Report exact candidate/final experience versions, candidate/final SHA, staging revision, focused gate counts and any deliberately excluded scope. Do not call public discovery, payment, refund, candidate waitlist, withdrawal/reapply, notifications, history or online AA complete.
