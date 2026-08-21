# Captain Open Game Production Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把已通过 375×812 视觉门的“队长开放球局”接到真实订单、PostgreSQL 和生产小程序，使订单所有者能创建草稿、发布、分享、编辑、取消并查看脱敏公开详情，同时不实现散客申请或修改订单/支付/退款/库存。

**Architecture:** 新增最小 `teams` 与 `open_games` 持久化模型；数据库只保存 `DRAFT / PUBLISHED / CANCELLED`，`SUSPENDED / COMPLETED` 由锁定后的 B1 订单事实实时投影。所有 owner 写操作先锁 Order、再锁 OpenGame，复用现有幂等记录；公开详情只凭不可枚举 share token 返回白名单 DTO。生产小程序沿用已批准的三页结构，通过独立 HTTP data source 与持久化 mutation attempt 接入真实 API，C1 申请入口继续关闭。

**Tech Stack:** FastAPI、SQLAlchemy 2、Alembic/PostgreSQL、Pydantic、OpenAPI、微信小程序 TypeScript/WXML/WXSS、Jest、Node test runner。

**Design:** `docs/superpowers/specs/2026-08-18-captain-open-game-design.md`

**Approved visual baseline:** `4be9e49f30174543eaf7d6072b74026b0c0634ef` on `feature/b2-captain-preview-integration`; independent review `PASS` at iPhone X `375×812`.

**Scope boundary:** 本计划不实现公开球局列表、散客申请/审核/候补、平台内 AA、通知、球队名册、支付或退款；不启用“我要找球踢”。取消球局永远不写 Order、Payment、RefundCase、RefundAttempt 或 Slot。

**Shared-staging stop line:** Tasks 1–9 只在隔离 worktree 和 disposable PostgreSQL 执行。应用 migration `0015` 到共享 staging、部署 API、上传新体验版、选择/造真实未来 `CONFIRMED` 订单及真机验收，必须在 Task 10 再次向用户报告并取得确认。

---

## Chunk 1: Freeze the contract and database authority

### Task 1: Freeze the closed HTTP contract

**Files:**

- Modify: `contracts/openapi.yaml`
- Modify: `scripts/validate-contract.mjs`
- Create: `contracts/examples/open-game-entry-create.json`
- Create: `contracts/examples/open-game-entry-manage.json`
- Create: `contracts/examples/open-game-entry-none.json`
- Create: `contracts/examples/open-game-owner-draft.json`
- Create: `contracts/examples/open-game-owner-published.json`
- Create: `contracts/examples/open-game-owner-suspended.json`
- Create: `contracts/examples/open-game-owner-cancelled.json`
- Create: `contracts/examples/open-game-public-published.json`
- Create: `contracts/examples/error-order-not-eligible.json`
- Create: `contracts/examples/error-open-game-not-found.json`
- Create: `contracts/examples/error-open-game-already-exists.json`
- Create: `contracts/examples/error-open-game-state-changed.json`
- Modify: `backend/tests/test_openapi_conformance.py`
- Modify: `docs/superpowers/specs/2026-08-18-captain-open-game-design.md`

The frozen operations are:

```text
GET  /api/v1/orders/{order_id}/game
POST /api/v1/orders/{order_id}/game
GET  /api/v1/games/{game_id}
PUT  /api/v1/games/{game_id}
POST /api/v1/games/{game_id}/publish
POST /api/v1/games/{game_id}/cancel
GET  /api/v1/shared-games/{share_token}
```

Owner operations use `bearerAuth`. Every write requires `Idempotency-Key` length 16–128. The response matrices are frozen exactly:

| Operation | Responses |
| --- | --- |
| owner entry GET | `200, 401, 404, 422, 503` |
| create POST | `201, 401, 404, 409, 422, 503` |
| owner game GET | `200, 401, 404, 422, 503` |
| update PUT | `200, 401, 404, 409, 422, 503` |
| publish POST | `200, 401, 404, 409, 422, 503` |
| cancel POST | `200, 401, 404, 409, 422, 503` |
| shared-token GET | `200, 404, 503` |

The shared route accepts a raw path string and maps malformed and unknown tokens to the same 404; it never publishes 401 or 422. No public response contains contact, payment, refund, order number, order ID, user ID or management fields.

The closed entry response is a discriminated union:

```yaml
OpenGameEntry:
  oneOf:
    - { entry: CREATE, order: OpenGameOrderSummary, game_id: null, blocked_reason: null }
    - { entry: MANAGE, order: null, game_id: uuid, blocked_reason: null }
    - { entry: NONE, order: null, game_id: null, blocked_reason: ORDER_NOT_ELIGIBLE }
```

`OpenGameOrderSummary` is closed and exactly `{venue_name, pitch_name, pitch_specification, players_per_side, booking_price_cents, starts_at, ends_at, time_zone}`. `players_per_side` is the immutable physical-pitch value and only supplies a form suggestion; it is not a game capacity limit. `pitch_specification` is derived exactly as `f"{players_per_side}人制"`, rather than copied from a mutable display name. `booking_price_cents` is owner-only and supplies the displayed `ceil(price / total_players)` AA suggestion; it is never copied into `aa_cents` automatically or exposed publicly. `time_zone` is an IANA identifier from the venue authority and is used for all form/date/share formatting. The entry `order` is present only for `CREATE`; the owner response carries the same summary in its `order` property.

Entry precedence is exact: any game whose stored status is not `CANCELLED` returns `MANAGE`, including an order-projected CANCELLED/COMPLETED view; otherwise an eligible order returns `CREATE`; otherwise return `NONE`. Historical stored-CANCELLED games never block a new game on a still-eligible order.

The write bodies are closed and exact:

```text
OpenGameDraftInput = name, team_name, total_players, fixed_players, open_spots,
  intensity, minimum_experience, positions, aa_cents, registration_deadline,
  equipment_and_arrival_notes, visibility
CreateOpenGameRequest = OpenGameDraftInput
UpdateOpenGameRequest = OpenGameDraftInput + expected_version
OpenGameVersionRequest = expected_version
```

`OpenGameOwner` properties are exactly `id`, `order_id`, `order`, all `OpenGameDraftInput` fields except `team_name` is nested as `team: {id, name}`, `persisted_status`, `state`, `state_reason`, `version`, `allowed_actions`, `share`, and `public_view`. `team` is exactly `{id, name}`. `allowed_actions` is exactly `{can_edit, can_publish, can_share, can_cancel, can_preview}`. `state_reason` is nullable or one of `REGISTRATION_WINDOW_CLOSED`, `REGISTRATION_DEADLINE_PASSED`, `CAPTAIN_CANCELLED`, `ORDER_CANCELLATION_PENDING`, `ORDER_PAYMENT_EXCEPTION`, `ORDER_REFUND_PENDING`, `ORDER_REFUND_FAILED`, `ORDER_CANCELLED`, `ORDER_REFUNDED`, `ORDER_COMPLETED`. SUSPENDED explains the reason inline; it does not invent a “查看原因” button.

The owner action matrix is exact:

| Effective state | Condition | edit | publish | share | cancel | preview |
| --- | --- | --- | --- | --- | --- | --- |
| DRAFT | B1 eligible | true | true | false | true | true |
| DRAFT | B1 eligible but selected deadline elapsed | true | false | false | true | true |
| DRAFT | registration window closed | false | false | false | true | true |
| PUBLISHED | healthy order, including after deadline | true | false | true | true | true |
| SUSPENDED | any | false | false | false | true | true |
| CANCELLED | any | false | false | false | false | false |
| COMPLETED | any | false | false | false | false | true |

Navigation such as “返回订单/返回管理页” is page context, not a server mutation permission. Contradictory state/action combinations are invalid responses.

`share` is null unless the effective state is PUBLISHED; otherwise it is exactly `{title, path, image_url}`. `title` contains game name plus local date/time in `order.time_zone`; `path` is exactly `/pages/captain-game-public/index?token=<percent-encoded-opaque-token>` and contains no order/game/user identifier; `image_url` is an approved published venue cover or null. The token is URL-safe, 32 characters from `secrets.token_urlsafe(24)`, and the decoder rejects any path outside that one route/query shape. When the image is null, the Mini Program omits `imageUrl` and lets WeChat use its standard page-card image; no temporary bitmap is generated.

`OpenGamePublic` is exactly `name`, `team_name`, `state`, `state_reason`, `venue_name`, `pitch_name`, `pitch_specification`, `starts_at`, `ends_at`, `time_zone`, `total_players`, `fixed_players`, `open_spots`, `intensity`, `minimum_experience`, `positions`, `aa_cents`, `registration_deadline`, `equipment_and_arrival_notes`, and `visibility`. `OpenGameOwner.public_view` uses this exact schema.

- [ ] **Step 1: Write contract examples and the failing conformance assertions**

Add every new example to `scripts/validate-contract.mjs` with its exact schema and operation attachment. Add assertions for exact paths, methods, bearer/public security, required idempotency headers, no request body on GET, closed write bodies, response status sets and the public privacy deny-list. In this contract-first task, list the seven B2 operations in the conformance test's explicit unpublished set; Task 5 moves the same exact operations to the published runtime set when the router exists:

```python
for forbidden in (
    "order_id", "order_number", "user_id", "phone", "openid",
    "payment", "refund", "contact", "idempotency_key", "booking_price_cents",
):
    assert forbidden not in public_schema["properties"]
```

- [ ] **Step 2: Run the contract RED check**

Run:

```bash
npm run contract:validate
uv run pytest backend/tests/test_openapi_conformance.py -q
```

Expected: FAIL only because the seven B2 operations/schemas/examples are not yet present.

- [ ] **Step 3: Add the closed component and request/response schemas**

Freeze these enums exactly:

```text
persisted_status: DRAFT | PUBLISHED | CANCELLED
state: DRAFT | PUBLISHED | SUSPENDED | CANCELLED | COMPLETED
state_reason: REGISTRATION_WINDOW_CLOSED | REGISTRATION_DEADLINE_PASSED |
  CAPTAIN_CANCELLED | ORDER_CANCELLATION_PENDING | ORDER_PAYMENT_EXCEPTION |
  ORDER_REFUND_PENDING | ORDER_REFUND_FAILED | ORDER_CANCELLED |
  ORDER_REFUNDED | ORDER_COMPLETED | null
visibility: PUBLIC | LINK_ONLY
intensity: BEGINNER_FRIENDLY | CASUAL | COMPETITIVE
positions: GOALKEEPER | DEFENDER | MIDFIELDER | FORWARD | ANY
entry_blocked_reason: ORDER_NOT_ELIGIBLE
```

`positions` is a non-empty unique array. `ANY` is mutually exclusive with every specific position. Specific positions are always serialized in the canonical order `GOALKEEPER, DEFENDER, MIDFIELDER, FORWARD`, independent of request order.

Write error examples using the existing `ErrorEnvelope`; do not add a second envelope. Mutation 409 codes are exactly `ORDER_NOT_ELIGIBLE`, `OPEN_GAME_ALREADY_EXISTS`, `OPEN_GAME_STATE_CHANGED`, and `IDEMPOTENCY_KEY_REUSED`. Private owner mismatch and unknown share tokens both use `OPEN_GAME_NOT_FOUND` without revealing existence. Domain validation returns 422 `INVALID_ARGUMENT`; when a specific field is known, `error.details.fields` is a closed array of `{field, message}` using request property names, otherwise details remains empty.

- [ ] **Step 4: Add all seven paths and attach every example**

Add exact operation IDs, security, parameters, bodies and the response table above to `contracts/openapi.yaml`. Attach all success/error examples through `scripts/validate-contract.mjs`. Keep the paths explicitly unpublished in runtime conformance until Task 5.

- [ ] **Step 5: Correct the stale design decisions**

Record that B1 eligibility is frozen and the visual gate passed at `4be9e49`. Replace the stale “没有任何退款业务单” wording with the frozen controlling-refund rule: `ORDER_CANCELLATION` and `PAYMENT_INVENTORY_CONFLICT` block, while `DUPLICATE_CHARGE` does not. Reconcile the approved preview by replacing SUSPENDED “查看原因” with an inline reason and no fake action. Record that a healthy PUBLISHED game keeps real preview/share/edit/cancel actions after its registration deadline; an unchanged elapsed deadline may be retained, but may not be changed to another invalid value. Freeze the share fallback as “approved venue cover or WeChat default page card”; retain all product scope and C1 exclusions.

- [ ] **Step 6: Run GREEN and commit**

```bash
npm run contract:validate
uv run pytest backend/tests/test_openapi_conformance.py -q
git add contracts scripts/validate-contract.mjs backend/tests/test_openapi_conformance.py docs/superpowers/specs/2026-08-18-captain-open-game-design.md
git diff --cached --check
git commit -m "contract: freeze captain open game api"
```

Expected: contract validation and conformance PASS.

### Task 2: Add migration 0015 and ORM models

**Files:**

- Create: `backend/migrations/versions/0015_open_games.py`
- Modify: `backend/app/models.py`
- Create: `backend/tests/test_open_game_schema.py`
- Modify: `backend/tests/test_booking_migration_cycle.py`
- Modify: `backend/tests/test_platform_session_migration.py`

Persist only these two aggregates:

```text
teams
  id uuid PK
  captain_user_id uuid FK users RESTRICT
  name varchar(24), name_key varchar(64)
  created_at, updated_at timestamptz
  UNIQUE(captain_user_id, name_key)

open_games
  id uuid PK
  order_id uuid FK orders RESTRICT
  team_id uuid FK teams RESTRICT
  name varchar(30)
  total_players int, fixed_players int, open_spots int
  intensity open_game_intensity
  minimum_experience varchar(60) nullable
  position_mask smallint
  aa_cents int
  registration_deadline timestamptz
  equipment_and_arrival_notes varchar(200) nullable
  visibility open_game_visibility
  status open_game_status
  version int
  share_token varchar(64), CONSTRAINT uq_open_games_share_token UNIQUE (share_token)
  published_at, cancelled_at timestamptz nullable
  created_at, updated_at timestamptz
```

`position_mask=0` means `ANY`; bits 1/2/4/8 mean goalkeeper/defender/midfielder/forward. This avoids an extra join table while keeping the accepted closed set.

- [ ] **Step 1: Write failing real-PostgreSQL schema tests**

Cover migration upgrade/downgrade/upgrade; both repository head assertions advancing from `0014` to `0015`; Alembic `command.check`; trimmed name lengths; `4 <= total_players <= 30`; `fixed_players >= 1`; `open_spots >= 1`; `fixed_players + open_spots <= total_players`; `0 <= position_mask <= 15`; `aa_cents >= 0`; `version >= 1`; exact `uq_open_games_share_token` uniqueness; unique captain/name key; and the partial unique index allowing at most one `status <> 'CANCELLED'` game per order.

Freeze timestamp constraints exactly:

```text
DRAFT: published_at IS NULL AND cancelled_at IS NULL
PUBLISHED: published_at IS NOT NULL AND cancelled_at IS NULL
CANCELLED before publication: published_at IS NULL AND cancelled_at IS NOT NULL
CANCELLED after publication: published_at IS NOT NULL AND cancelled_at IS NOT NULL AND cancelled_at >= published_at
```

- [ ] **Step 2: Run RED**

```bash
uv run pytest backend/tests/test_open_game_schema.py \
  backend/tests/test_booking_migration_cycle.py \
  backend/tests/test_platform_session_migration.py -q
```

Expected: FAIL because revision `0015`, enums and tables are absent.

- [ ] **Step 3: Implement migration `0015`**

Use enum names `open_game_status`, `open_game_visibility`, `open_game_intensity`, the exact constraints above and `down_revision="0014"`. Name the share-token constraint exactly `uq_open_games_share_token` so Task 4 can distinguish its retry path. The partial index is:

```python
sa.Index(
    "uq_open_games_one_active_per_order",
    "order_id",
    unique=True,
    postgresql_where=sa.text("status <> 'CANCELLED'"),
)
```

Do not alter revisions `0013` or `0014`.

- [ ] **Step 4: Add matching ORM enums, models and relationships**

Add `Team` and `OpenGame` with constraints matching migration bytes, including the explicit ORM `UniqueConstraint("share_token", name="uq_open_games_share_token")`, and relationships `User.teams`, `Order.open_games`, `Team.open_games`, and `OpenGame.order/team`. Do not add a second persisted captain/user field to OpenGame.

- [ ] **Step 5: Run GREEN, static checks and commit**

```bash
uv run pytest backend/tests/test_open_game_schema.py \
  backend/tests/test_booking_migration_cycle.py \
  backend/tests/test_platform_session_migration.py -q
uv run ruff check backend/app/models.py backend/migrations/versions/0015_open_games.py backend/tests/test_open_game_schema.py
git add backend/app/models.py backend/migrations/versions/0015_open_games.py backend/tests/test_open_game_schema.py backend/tests/test_booking_migration_cycle.py backend/tests/test_platform_session_migration.py
git diff --cached --check
git commit -m "feat: persist captain open games"
```

Expected: schema and migration-cycle tests PASS.

### Task 3: Freeze pure lifecycle, validation and privacy projection

**Files:**

- Create: `backend/app/modules/open_games/__init__.py`
- Create: `backend/app/modules/open_games/lifecycle.py`
- Create: `backend/app/modules/open_games/privacy.py`
- Create: `backend/app/modules/open_games/dto.py`
- Create: `backend/tests/test_open_game_lifecycle.py`

- [ ] **Step 1: Write pure RED tests**

Cover:

- B1 `is_b2_open_game_eligible` is the only create, DRAFT-save and publish eligibility decision;
- stored `CANCELLED` stays cancelled;
- Order `CANCELLED/REFUNDED` projects `CANCELLED`;
- Order `COMPLETED` projects `COMPLETED`;
- cancel requested or Order `PAYMENT_EXCEPTION/REFUND_PENDING/REFUND_FAILED` projects `SUSPENDED`;
- otherwise stored DRAFT/PUBLISHED remains unchanged;
- DRAFT keeps preview/cancel, and exposes edit/publish only while B1 eligibility still holds;
- DRAFT with an elapsed selected deadline but still-eligible order remains editable, disables publish and explains `REGISTRATION_DEADLINE_PASSED`;
- `cancel_requested_at` alone projects SUSPENDED with `ORDER_CANCELLATION_PENDING`;
- PUBLISHED remains published when the order is otherwise healthy; preview/share/edit/cancel remain real even after the registration deadline, while a changed deadline must still satisfy the deadline rule;
- SUSPENDED is preview/cancel only; CANCELLED has no mutation; COMPLETED is preview only;
- form bounds, deadline `now < deadline <= starts_at - 2h`, position-mask mapping and trimmed visible-character limits;
- obvious phone numbers, URL schemes and explicit WeChat-contact markers are rejected from public free text, without adding generic moderation infrastructure;
- public DTO projection omits every private identifier and funding field.

- [ ] **Step 2: Run RED**

```bash
uv run pytest backend/tests/test_open_game_lifecycle.py -q
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the pure state/action projection**

Use a fact object, not request-derived booleans:

```python
@dataclass(frozen=True, slots=True)
class OpenGameFacts:
    stored_status: OpenGameStatus
    order_facts: OrderLifecycleFacts
    registration_deadline: datetime

def project_open_game_state(facts: OpenGameFacts) -> EffectiveOpenGameState:
    if facts.stored_status is OpenGameStatus.CANCELLED:
        return EffectiveOpenGameState.CANCELLED
    if facts.order_facts.status in {OrderStatus.CANCELLED, OrderStatus.REFUNDED}:
        return EffectiveOpenGameState.CANCELLED
    if facts.order_facts.status is OrderStatus.COMPLETED:
        return EffectiveOpenGameState.COMPLETED
    if facts.order_facts.cancel_requested_at is not None or facts.order_facts.status in {
        OrderStatus.PAYMENT_EXCEPTION, OrderStatus.REFUND_PENDING, OrderStatus.REFUND_FAILED,
    }:
        return EffectiveOpenGameState.SUSPENDED
    return EffectiveOpenGameState(facts.stored_status.value)
```

`project_open_game_actions` follows the exact matrix in Step 1 and never derives B1 eligibility from client input. `project_open_game_reason` returns `CAPTAIN_CANCELLED` for stored cancellation, `ORDER_CANCELLATION_PENDING` when only `cancel_requested_at` suspends the game, the matching `ORDER_*` reason for projected order status, `REGISTRATION_DEADLINE_PASSED` when only the selected DRAFT deadline elapsed, and `REGISTRATION_WINDOW_CLOSED` when an otherwise-healthy DRAFT crossed the strict creation/publish boundary.

- [ ] **Step 4: Implement closed DTO validation**

Normalize team keys with `NFKC`, trimmed/collapsed whitespace and `casefold()`. Validate create, DRAFT update and publish through `is_b2_open_game_eligible`, including `now < deadline <= starts_at - 2h`. A PUBLISHED update instead proves the order is still healthy (`CONFIRMED`, no cancel request and no controlling refund); it may retain an unchanged elapsed deadline, while any changed deadline must satisfy the ordinary rule. Keep DTOs `extra="forbid"` through the existing `ClosedModel` convention.

- [ ] **Step 5: Implement the public privacy projection**

Reject obvious mainland mobile numbers, `http/https` URLs and explicit `微信/WeChat/wx/vx` contact markers in public free text. Build `OpenGamePublic` only through one explicit whitelist projector and assert its keys exactly match Task 1; never serialize an ORM object or owner DTO into the public response. Share metadata may select only the venue's published `VenueImage.role=COVER` HTTPS URL; a missing cover produces null and never falls back to an editable/moderation draft.

- [ ] **Step 6: Run GREEN and commit**

```bash
uv run pytest backend/tests/test_order_lifecycle_policy.py \
  backend/tests/test_open_game_lifecycle.py -q
uv run ruff check backend/app/modules/open_games backend/tests/test_open_game_lifecycle.py
uv run mypy backend/app/modules/open_games
git add backend/app/modules/open_games backend/tests/test_open_game_lifecycle.py
git diff --cached --check
git commit -m "feat: project open game lifecycle"
```

Expected: shared B1 policy and B2 pure tests PASS.

---

## Chunk 2: Implement owner commands and public reads

### Task 4: Implement repository locking and owner draft operations

**Files:**

- Create: `backend/app/modules/open_games/repository.py`
- Create: `backend/app/modules/open_games/service.py`
- Create: `backend/tests/test_open_game_service.py`
- Create: `backend/tests/test_open_game_concurrency.py`

Lock/write order is fixed:

```text
locate immutable order_id if starting from game_id
→ SELECT Order FOR UPDATE and prove owner
→ SELECT active/target OpenGame FOR UPDATE
→ re-read B1 payment/refund facts needed by is_b2_open_game_eligible
→ claim/replay idempotency inside the same transaction, before current-state eligibility checks
→ Team/OpenGame write
→ response projection + complete idempotency
→ one commit
```

Never lock OpenGame and then Order. Never write B1 rows.

- [ ] **Step 1: Write owner entry/create/update RED tests on real PostgreSQL**

Cover owner/non-owner 404 symmetry; exact entry precedence for active/projected-terminal/stored-cancelled games; CREATE/MANAGE/NONE; exact >2h boundary; cancel/refund facts; concurrent create yielding one active game; concurrent same-captain team reuse across different orders; canonical digest and same-key replay; same key/different body 409; team reuse by normalized name; team-name change re-association; expected-version conflict; update of all accepted fields; DB failure rolling back team/game/idempotency atomically; no Order/Payment/RefundCase/RefundAttempt/Slot mutation. Inject one and two deterministic share-token collisions to prove retry and 503 behavior without relying on chance.

- [ ] **Step 2: Run RED**

```bash
uv run pytest backend/tests/test_open_game_service.py \
  backend/tests/test_open_game_concurrency.py -q
```

Expected: FAIL because repository/service methods do not exist.

- [ ] **Step 3: Implement repository selectors and the fixed lock order**

Add read entry lookup, immutable game→order locator, owner-filtered Order lock, active/target OpenGame lock and public-token lookup. Every target lookup rechecks ownership and resource identity after locking. Do not commit inside the repository.

- [ ] **Step 4: Implement team upsert, token allocation and idempotency helpers**

Use the existing `OrderRepository.claim_idempotency()` and `complete_idempotency()` on the same SQLAlchemy Session instead of creating another idempotency abstraction. Canonical hashes use sorted compact JSON with operation/version included:

```python
payload = {
    "operation": operation,
    "resource_id": str(resource_id),
    "body": request.model_dump(mode="json"),
    "version": 1,
}
digest = sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
```

Create/reuse Team with PostgreSQL `INSERT ... ON CONFLICT DO NOTHING` followed by an owner/name-key select, so concurrent reuse cannot abort the transaction. Generate `share_token` with at least 128 bits of entropy using `secrets.token_urlsafe(24)`. Insert each candidate inside `Session.begin_nested()`; catch only the exact `uq_open_games_share_token` IntegrityError, roll back that savepoint and build a fresh OpenGame with one new token. A second exact token collision maps to 503. Active-order uniqueness maps separately to 409. Do not expose raw DB/constraint text.

- [ ] **Step 5: Implement owner entry and create-draft service methods**

Lock Order, claim/replay before eligibility checks, calculate B1 facts from locked DB rows, create/reuse Team, persist one DRAFT, project `OpenGameOwner`, complete idempotency and commit once. Entry is read-only and returns CREATE/MANAGE/NONE from server authority.

- [ ] **Step 6: Implement owner update service method**

Locate order ID, lock Order then OpenGame, claim/replay before version/state checks, apply the full closed draft input, re-associate Team when its normalized name changes, increment version, complete idempotency and commit once. A DRAFT update rechecks full B1 eligibility. A PUBLISHED update applies the healthy-order rule from Task 3, may retain an elapsed unchanged deadline, and validates any changed deadline.

- [ ] **Step 7: Run GREEN and commit**

```bash
uv run pytest backend/tests/test_open_game_service.py \
  backend/tests/test_open_game_concurrency.py -q
uv run ruff check backend/app/modules/open_games backend/tests/test_open_game_service.py backend/tests/test_open_game_concurrency.py
uv run mypy backend/app/modules/open_games
git add backend/app/modules/open_games backend/tests/test_open_game_service.py backend/tests/test_open_game_concurrency.py
git diff --cached --check
git commit -m "feat: create and edit owned open games"
```

Expected: focused owner draft tests PASS.

### Task 5: Publish, cancel, public privacy and runtime routing

**Files:**

- Create: `backend/app/modules/open_games/router.py`
- Modify: `backend/app/modules/open_games/service.py`
- Modify: `backend/app/main.py`
- Create: `backend/tests/test_open_game_api.py`
- Create: `backend/tests/test_open_game_public_api.py`
- Modify: `backend/tests/test_openapi_conformance.py`

- [ ] **Step 1: Write publish/cancel/public RED tests**

Cover DRAFT publish; same-key replay after state changes; publish blocked after eligibility changes; PUBLISHED update with an unchanged elapsed deadline; published state/share remaining honest after the >2h creation boundary; SUSPENDED action clamp; cancel DRAFT/PUBLISHED/SUSPENDED; cancel replay; cancel does not touch any B1 row; public DRAFT 404; never-published cancelled draft 404; draft cancelled indirectly by its Order 404; formerly published PUBLISHED/SUSPENDED/CANCELLED/COMPLETED token reads; PUBLIC and LINK_ONLY both remaining token-only in B2; token non-enumerability format; no bearer on public GET; private owner mismatch 404; malformed/unknown token 404; free-text privacy rejection; DB error 503 with rollback. Add one ordinary Pydantic body failure (for example invalid `name`, enum or extra field) and one cross-field service failure, and require both to return 422 `INVALID_ARGUMENT` with the closed `details.fields` array naming only request properties.

- [ ] **Step 2: Run RED**

```bash
uv run pytest backend/tests/test_open_game_api.py \
  backend/tests/test_open_game_public_api.py -q
```

Expected: publish/cancel/public cases FAIL because router and service methods are absent.

- [ ] **Step 3: Implement publish**

Publish locks Order then OpenGame, revalidates B1 eligibility, sets `PUBLISHED`, `published_at=now`, increments version and completes the same transaction.

- [ ] **Step 4: Implement cancel**

Cancel uses the same lock/idempotency order, sets only `OpenGame.status=CANCELLED`, `cancelled_at=now`, increments version and never mutates B1 rows.

- [ ] **Step 5: Implement publication-history-gated public projection**

Public token lookup requires `published_at IS NOT NULL`; this keeps abandoned/cancelled private drafts private. A formerly published game remains token-readable when effectively PUBLISHED, SUSPENDED, CANCELLED or COMPLETED. Return only `OpenGamePublic`, never an owner response or management link; PUBLIC and LINK_ONLY have identical token privacy in B2.

- [ ] **Step 6: Add router and path-scoped validation error translation**

Use the existing `bearerAuth` dependency behavior, including auth DB failure → 503. Translate only the frozen 404/409/422/503 codes and strip internal DB text. Add an `open_game_request_validation_handler` beside the router and dispatch to it from `main.py` only for the B2 owner mutation paths. It maps known Pydantic body locations to 422 `INVALID_ARGUMENT` with the same closed `details.fields: [{field, message}]` shape used by service cross-field errors; unknown locations keep empty details. Do not change validation envelopes for unrelated routes, and do not expose a validation distinction on the shared-token GET.

- [ ] **Step 7: Add runtime composition**

Register the router unconditionally because it has no payment/provider dependency. Move the seven operations from the conformance test's explicit unpublished set to the published runtime set and compare exact status matrices. Keep “find games” absent: there is no collection/list route.

- [ ] **Step 8: Run the backend slice GREEN set and commit**

```bash
uv run pytest backend/tests/test_open_game_schema.py \
  backend/tests/test_open_game_lifecycle.py \
  backend/tests/test_open_game_service.py \
  backend/tests/test_open_game_concurrency.py \
  backend/tests/test_open_game_api.py \
  backend/tests/test_open_game_public_api.py \
  backend/tests/test_order_lifecycle_policy.py \
  backend/tests/test_openapi_conformance.py -q
uv run ruff check backend/app/modules/open_games backend/app/main.py backend/tests/test_open_game_*.py
uv run mypy backend/app/modules/open_games
git add backend/app/modules/open_games backend/app/main.py backend/tests/test_open_game_api.py backend/tests/test_open_game_public_api.py backend/tests/test_openapi_conformance.py
git diff --cached --check
git commit -m "feat: publish and share open games"
```

Expected: focused backend set PASS; no Provider is constructed or called.

---

## Chunk 3: Connect the production Mini Program journey

### Task 6: Add strict domain decoding, HTTP transport and durable attempts

**Files:**

- Create: `miniprogram/domain/open-game.ts`
- Create: `miniprogram/domain/open-game-decoder.ts`
- Create: `miniprogram/domain/open-game-decoder.test.ts`
- Create: `miniprogram/services/open-game.ts`
- Create: `miniprogram/services/http-open-game.ts`
- Create: `miniprogram/services/http-open-game.test.ts`
- Create: `miniprogram/services/open-game-attempt-store.ts`
- Create: `miniprogram/services/open-game-attempt-store.test.ts`

- [ ] **Step 1: Write and run strict decoder RED tests**

Require exact-object decoding for `CREATE / MANAGE / NONE`, owner states, action matrices, nullable reason/share, the nested public view and the public privacy whitelist. Reject unknown properties, contradictory state/actions, malformed timestamps, unsafe share paths and a shared payload containing any private field.

```bash
npx jest miniprogram/domain/open-game-decoder.test.ts --runInBand
```

Expected: FAIL because the domain decoder does not exist.

- [ ] **Step 2: Implement the domain types and decoder, then make its test GREEN**

Keep B2 decoding in `open-game-decoder.ts` rather than growing the central order decoder. Decode server timestamps as validated ISO strings and retain cents/UTC values in the domain; formatting belongs to presentation.

```bash
npx jest miniprogram/domain/open-game-decoder.test.ts --runInBand
```

- [ ] **Step 3: Write and run durable-attempt RED tests**

Persist exactly one unresolved mutation containing operation kind, target order/game ID, canonical request body, expected version when present, and the original 16–128 byte idempotency key. Invalid storage self-clears. A pending attempt for another resource or operation is never overwritten; it is returned as a foreign pending attempt so the page can offer the real “确认上次操作” action before accepting another write.

```bash
npx jest miniprogram/services/open-game-attempt-store.test.ts --runInBand
```

Expected: FAIL because the store does not exist.

- [ ] **Step 4: Implement the attempt store and make its test GREEN**

The mutation union is closed:

```ts
type OpenGameMutationAttempt =
  | { kind: "create"; orderId: string; body: OpenGameDraftInput; idempotencyKey: string }
  | { kind: "update"; gameId: string; body: OpenGameDraftInput & { expectedVersion: number }; idempotencyKey: string }
  | { kind: "publish" | "cancel"; gameId: string; expectedVersion: number; idempotencyKey: string };
```

The store preserves the exact canonical body; it does not reconstruct a mutation from current form data.

```bash
npx jest miniprogram/services/open-game-attempt-store.test.ts --runInBand
```

- [ ] **Step 5: Write and run HTTP transport RED tests**

Test encoded order/game/token path segments; no bearer on the shared-token GET; one silent 401 re-login for owner calls; stable idempotency headers; exact snake_case requests; strict 2xx decoding; and closed error classification. A definitive 404/409/422 is returned to page authority but is cleared only by the Step 7 authority matrix; network failure, timeout, 5xx and malformed 2xx become `OPEN_GAME_RESULT_UNKNOWN` without changing or clearing the stored attempt.

```bash
npx jest miniprogram/services/http-open-game.test.ts --runInBand
```

Expected: FAIL because the HTTP source does not exist.

- [ ] **Step 6: Implement the HTTP source and make its test GREEN**

The source exposes `getEntry`, `getOwnedGame`, `getSharedGame`, `create`, `update`, `publish`, and `cancel`. It reuses `Transport`, `WeChatIdentityCapability`, `SessionStore`, and the existing once-only 401 pattern; do not copy booking/payment UI state into this module.

```bash
npx jest miniprogram/services/http-open-game.test.ts --runInBand
```

- [ ] **Step 7: Freeze per-mutation unknown-result recovery**

Add focused store/source assertions for this exact matrix; pages in Task 7 consume it without inventing local terminal states:

| Stored attempt | Authoritative read after unknown | Next action |
| --- | --- | --- |
| create | entry `MANAGE` | navigate to that game and clear |
| create | entry `CREATE` | replay identical attempt/key |
| create | entry `NONE` | clear and show authority reason |
| update | owner body/version equals requested result | accept and clear |
| update | version is still expected version | replay identical attempt/key |
| update | another version/body won | clear and show state changed |
| publish | owner state `PUBLISHED` | accept and clear |
| publish | owner state `DRAFT` at the same version | replay identical attempt/key |
| publish | any other authoritative state/version | clear and clamp to authority |
| cancel | owner state `CANCELLED` | accept and clear |
| cancel | owner remains mutable at the same version | replay identical attempt/key |
| cancel | any other authoritative state/version | clear and clamp to authority |

For definitive `OPEN_GAME_ALREADY_EXISTS`, refresh entry authority and navigate only when it returns `MANAGE`; do not trust an ID from an error body. `IDEMPOTENCY_KEY_REUSED` clears that unusable local attempt and shows a definitive conflict. `ORDER_NOT_ELIGIBLE` and `OPEN_GAME_STATE_CHANGED` first refresh owner/entry authority, then clear and clamp to that response. A definitive 422 maps its field details and clears so a corrected body receives a new key; a definitive 404 or second 401 clears and returns to the appropriate not-found/login state. A foreign pending attempt blocks unrelated writes until its own authority check resolves.

- [ ] **Step 8: Run the focused GREEN set, typecheck and commit**

```bash
npx jest miniprogram/domain/open-game-decoder.test.ts \
  miniprogram/services/http-open-game.test.ts \
  miniprogram/services/open-game-attempt-store.test.ts --runInBand
npm run typecheck
git add miniprogram/domain miniprogram/services
git diff --cached --check
git commit -m "feat: connect open game http source"
```

Expected: focused domain/service tests and typecheck PASS.

### Task 7: Implement the three production pages and order-detail entry

**Files:**

- Create: `miniprogram/presentation/open-game.ts`
- Create: `miniprogram/presentation/open-game.test.ts`
- Create: `miniprogram/pages/captain-game-form/index.{ts,wxml,wxss,json}`
- Create: `miniprogram/pages/captain-game-form/index.test.ts`
- Create: `miniprogram/pages/captain-game-manage/index.{ts,wxml,wxss,json}`
- Create: `miniprogram/pages/captain-game-manage/index.test.ts`
- Create: `miniprogram/pages/captain-game-public/index.{ts,wxml,wxss,json}`
- Create: `miniprogram/pages/captain-game-public/index.test.ts`
- Modify: `miniprogram/pages/order-detail/index.{ts,wxml,wxss}`
- Modify: `miniprogram/pages/order-detail/index.test.ts`
- Modify: `miniprogram/app.json`

- [ ] **Step 1: Write and run presentation/form RED tests**

Cover create/edit `LOADING`, `READY`, `INELIGIBLE`, `SAVING`, `SAVE_ERROR`, `SAVE_UNKNOWN` and auth-loss states; each error/auth state has one real retry or return/login action and never shows a working-looking save button without authority. Require immutable order facts, visible labels and these real controls: text inputs for name/team; three steppers for total/fixed/open; intensity radio; experience input; position checkboxes; AA input; deadline picker; notes textarea; visibility radio. `ANY` is mutually exclusive. Show `ceil(booking_price_cents / total_players)` only as an AA suggestion; accept a nonnegative yuan string with at most two decimal digits and convert it to integer `aa_cents` with string arithmetic, without float rounding or auto-overwriting. Convert the picker value to ISO using the authoritative order/venue timezone returned by the API, never device-local arithmetic. Validate ordinary fields on blur, capacity/deadline cross-fields immediately, render an adjacent error and one top summary, and map server 422 field details back to those same controls.

```bash
npx jest miniprogram/presentation/open-game.test.ts \
  miniprogram/pages/captain-game-form/index.test.ts --runInBand
```

Expected: FAIL because production presentation/form files do not exist.

- [ ] **Step 2: Implement the presentation and form, then make their tests GREEN**

Copy the approved geometry/content hierarchy into production files, but import only production domain/service/presentation modules. Do not import anything under `miniprogram/dev`. Replace Fixture transitions with source calls and server action projections. Use `pages/captain-game-public/index?token=<opaque-token>` for shared visits and `?game_id=<uuid>&preview=1` for owner draft preview; the latter loads the owner response's nested public projection and never shows management controls.

The form writes through the Task 6 attempt store, serializes duplicate taps, and performs the exact create/update authority recovery matrix. A foreign pending attempt replaces mutation controls with a real “确认上次操作” action that resolves that attempt's own authority before returning to the form. It never claims success from a toast or local state.

```bash
npx jest miniprogram/presentation/open-game.test.ts \
  miniprogram/pages/captain-game-form/index.test.ts --runInBand
```

- [ ] **Step 3: Write and run management-page RED tests**

Cover `LOADING`, load-error/reload, auth-loss/login and DRAFT/PUBLISHED/SUSPENDED/CANCELLED/COMPLETED; publish/cancel confirmation open/close/confirm; edit/save navigation; owner preview/return; duplicate-submit suppression; and the Task 6 recovery matrix. Every visible recovery button calls the real source/login/navigation action.

```bash
npx jest miniprogram/pages/captain-game-manage/index.test.ts --runInBand
```

Expected: FAIL because the management page does not exist.

- [ ] **Step 4: Implement and verify the management page**

Render native sharing only when `can_share=true`:

```ts
onShareAppMessage() {
  return {
    title: this.data.game.share.title,
    path: this.data.game.share.path,
    ...(this.data.game.share.imageUrl ? { imageUrl: this.data.game.share.imageUrl } : {}),
  };
}
```

Use `<button open-type="share">`; platform share cancellation/failure never changes game state. The cancel copy states that the booking, slot and any payment/refund remain untouched.

```bash
npx jest miniprogram/pages/captain-game-manage/index.test.ts --runInBand
```

- [ ] **Step 5: Write and run public-page RED tests**

Cover loading, malformed/unknown token not-found, transient load-error/retry, PUBLISHED/SUSPENDED/CANCELLED/COMPLETED shared-token reads, owner preview, privacy deny fields, no application CTA, normal back and return-to-management. Shared visitors never see login or owner actions.

```bash
npx jest miniprogram/pages/captain-game-public/index.test.ts --runInBand
```

Expected: FAIL because the public page does not exist.

- [ ] **Step 6: Implement and verify the public page**

Shared-token visits load only `OpenGamePublic`, render no owner/apply action or private data, and use the normal Mini Program back action. Owner preview loads `public_view` by `game_id` and adds one real return-to-management action; it does not pretend to be a shared visitor.

```bash
npx jest miniprogram/pages/captain-game-public/index.test.ts --runInBand
```

- [ ] **Step 7: Write and run order-detail entry RED tests**

Require CREATE/MANAGE/NONE, non-blocking failure/retry and preservation of existing payment/cancellation authority.

```bash
npx jest miniprogram/pages/order-detail/index.test.ts --runInBand
```

Expected: FAIL because the B2 entry is absent.

- [ ] **Step 8: Implement and verify order-detail entry**

Load entry without blocking the existing order detail: `CREATE` shows a real create action, `MANAGE` shows a real manage action, and `NONE` shows no disabled/fake action. A load failure shows an inline retry tied to `getEntry`. Do not change existing payment/cancellation authority.

```bash
npx jest miniprogram/pages/order-detail/index.test.ts --runInBand
```

- [ ] **Step 9: Run the combined page GREEN set and typecheck**

```bash
npx jest miniprogram/presentation/open-game.test.ts \
  miniprogram/pages/captain-game-form/index.test.ts \
  miniprogram/pages/captain-game-manage/index.test.ts \
  miniprogram/pages/captain-game-public/index.test.ts \
  miniprogram/pages/order-detail/index.test.ts --runInBand
npm run typecheck
```

- [ ] **Step 10: Commit**

```bash
git add miniprogram/presentation miniprogram/pages miniprogram/app.json
git diff --cached --check
git commit -m "feat: manage open games in mini program"
```

### Task 8: Wire development HTTP and production composition without Fixture leakage

**Files:**

- Create temporarily: `miniprogram/dev/open-game-source.ts`
- Create temporarily: `miniprogram/dev/open-game-source.test.ts`
- Modify: `miniprogram/dev/bootstrap.ts`
- Modify: `scripts/build-miniprogram.mjs`
- Modify: `scripts/audit-production-package.mjs`
- Modify: `tests/build-miniprogram.test.mjs`
- Modify: `tests/development-http-build.test.mjs`
- Modify: `tests/audit-production-package.test.mjs`
- Modify: `tests/production-package-booking-audit.test.mjs`
- Create: `docs/acceptance/captain-open-game-progress.md`

- [ ] **Step 1: Write composition/isolation RED tests**

Require all three production routes in both builds; a temporary development-only adapter for production pages in Fixture mode; HTTP data source + attempt store registration in development HTTP and production; all existing 14 production routes preserved before adding the three new routes; and no C1/list/apply route. Production audit must reject dev paths plus the exact Fixture-only literals `CAPTAIN_OPEN_GAME_FIXTURE`, `奥体周日轻松局` and `津门周末足球队`. A disabled-payment build keeps `ONLINE_BOOKING_ENABLED=false` without disabling B2 owner management.

- [ ] **Step 2: Run RED**

```bash
node --test tests/build-miniprogram.test.mjs \
  tests/development-http-build.test.mjs \
  tests/audit-production-package.test.mjs \
  tests/production-package-booking-audit.test.mjs
```

Expected: focused failures only for missing B2 production composition/routes/audit rules.

- [ ] **Step 3: Add the development registrations**

Adapt the approved Fixture to the production `OpenGameSource` through `miniprogram/dev/open-game-source.ts`; do not import it from a production module. Fixture-mode development registers this adapter. Development HTTP registers the real HTTP source and attempt store. Preserve every existing development route/source registration by additive merge.

- [ ] **Step 4: Add production composition and the audit deny rules**

Production always registers the real HTTP source and attempt store. Extend the fixed production route inventory from 14 to 17 routes without replacing it. Add the three Fixture-only literals and dev page paths to the production audit; retain every existing deny and required-composition rule.

- [ ] **Step 5: Run the focused composition GREEN set**

```bash
node --test tests/build-miniprogram.test.mjs \
  tests/development-http-build.test.mjs \
  tests/audit-production-package.test.mjs \
  tests/production-package-booking-audit.test.mjs
npx jest miniprogram/dev/open-game-source.test.ts --runInBand
npm run typecheck
```

- [ ] **Step 6: Build/audit the disabled-payment production package**

Use only the ignored live build input; do not print it. If it is absent, report that single environment blocker instead of inventing values.

```bash
test -f deploy/miniprogram.live.local
bash -c 'set -a; source deploy/miniprogram.live.local; set +a; MINIPROGRAM_PAYMENT_PROVIDER=disabled npm run build:miniprogram:production'
npm run audit:miniprogram-package
```

Assert the generated runtime has `ONLINE_BOOKING_ENABLED=false`, 17 production routes, real B2 HTTP composition and zero forbidden paths/tokens/business literals.

- [ ] **Step 7: Run one proportional native visual self-review**

Run `npm run build:miniprogram:development`, then open the production create form in WeChat DevTools iPhone X `375×812`. This is a production-page-code review backed by a development-only adapter, not an HTTP/staging claim. Check one representative form because real controls materially replace Fixture summary rows: visible labels and correct keyboards; `ANY` exclusivity; deadline picker; button text explicitly centered on both axes; repeated steppers/status badges aligned and equal-sized; back arrow and modal X complete; no clipping/overflow; fixed footer clear of the safe area; key copy/data correct. Record only blockers and the final PASS in `docs/acceptance/captain-open-game-progress.md` as `PRODUCTION_PAGE_FIXTURE_ADAPTER_VISUAL_PASS / HTTP_PENDING`; do not recapture all approved states unless this form changed their structure.

- [ ] **Step 8: Commit**

```bash
git add miniprogram/dev/open-game-source.ts miniprogram/dev/open-game-source.test.ts miniprogram/dev/bootstrap.ts scripts/build-miniprogram.mjs scripts/audit-production-package.mjs tests/build-miniprogram.test.mjs tests/development-http-build.test.mjs tests/audit-production-package.test.mjs tests/production-package-booking-audit.test.mjs docs/acceptance/captain-open-game-progress.md
git diff --cached --check
git commit -m "build: compose production open game journey"
```

Expected: focused checks PASS; production audit reports zero forbidden paths/tokens/business literals.

---

## Chunk 4: Prove local integration and stop before shared staging

### Task 9: Prove backend HTTP and Mini Program automation locally

**Files:**

- Create: `backend/tests/test_open_game_http_journey.py`
- Modify: `docs/acceptance/captain-open-game-progress.md`
- Modify: `docs/superpowers/plans/2026-08-16-overall-slice-roadmap.md`

- [ ] **Step 1: Write the real-backend HTTP journey RED test**

Use a disposable PostgreSQL database plus a real local Uvicorn socket, not TestClient or a Mini Program Fixture. Seed one owner and one non-owner around a future `CONFIRMED` Order more than 2h away, with one internally consistent synthetic applied-success Payment baseline but no Provider call. Exercise auth, entry, create DRAFT, owner read, edit, preview data, publish, public token read, cancel and post-cancel public read.

Assert throughout:

```text
one active game per order before cancel
same idempotency key replays byte-equivalent authority
non-owner private reads are 404
public payload contains no order/contact/payment/refund fields
cancel changes only open_games and leaves Order CONFIRMED + Slot BOOKED
no Payment/RefundCase/RefundAttempt row is created or changed
post-cancel entry becomes CREATE
a second DRAFT can be created on the same still-eligible order
the partial unique rule still leaves at most one non-CANCELLED game
```

- [ ] **Step 2: Run RED then implement only the harness needed for the real journey**

```bash
uv run pytest backend/tests/test_open_game_http_journey.py -q
```

Expected first run: FAIL until the local network harness and complete route composition are connected; final run PASS.

- [ ] **Step 3: Run the proportional backend and Mini Program verification**

```bash
uv run pytest backend/tests/test_open_game_schema.py \
  backend/tests/test_open_game_lifecycle.py \
  backend/tests/test_open_game_service.py \
  backend/tests/test_open_game_concurrency.py \
  backend/tests/test_open_game_api.py \
  backend/tests/test_open_game_public_api.py \
  backend/tests/test_open_game_http_journey.py \
  backend/tests/test_openapi_conformance.py -q
npx jest miniprogram/domain/open-game-decoder.test.ts \
  miniprogram/services/http-open-game.test.ts \
  miniprogram/services/open-game-attempt-store.test.ts \
  miniprogram/presentation/open-game.test.ts \
  miniprogram/pages/captain-game-form/index.test.ts \
  miniprogram/pages/captain-game-manage/index.test.ts \
  miniprogram/pages/captain-game-public/index.test.ts \
  miniprogram/pages/order-detail/index.test.ts --runInBand
npm run contract:validate
npm run typecheck
git diff --check
```

Do not run unrelated full backend or Mini Program suites.

- [ ] **Step 4: Record honest acceptance state and commit**

Record exact SHA, focused counts, real-local backend HTTP/DB result, Mini Program unit/composition result, privacy result, B1-row immutability and remaining shared-staging/device gates. Mark B2 `LOCAL_BACKEND_HTTP_AND_MINIPROGRAM_AUTOMATION_PASS / STAGING_PENDING`; do not call this a full Mini Program HTTP journey, do not call a seeded confirmed order a real paid order, and do not claim production/device completion.

```bash
git add backend/tests/test_open_game_http_journey.py docs/acceptance/captain-open-game-progress.md docs/superpowers/plans/2026-08-16-overall-slice-roadmap.md
git diff --cached --check
git commit -m "test: prove captain open game journey"
```

### Task 10: Shared-staging and device checkpoint — STOP FOR USER CONFIRMATION

**Files after confirmation:**

- Modify: `docs/acceptance/captain-open-game-progress.md`
- Modify: `docs/superpowers/plans/2026-08-16-overall-slice-roadmap.md`
- Delete only after device PASS: `miniprogram/dev/captain-open-game-fixture.ts`
- Delete only after device PASS: `miniprogram/dev/captain-open-game-fixture.test.ts`
- Delete only after device PASS: `miniprogram/dev/captain-open-game-pages.json`
- Delete only after device PASS: `miniprogram/dev/pages/captain-game-form/**`
- Delete only after device PASS: `miniprogram/dev/pages/captain-game-manage/**`
- Delete only after device PASS: `miniprogram/dev/pages/captain-game-public/**`
- Delete only after device PASS: `miniprogram/dev/open-game-source.ts`
- Delete only after device PASS: `miniprogram/dev/open-game-source.test.ts`
- Modify after cleanup: `miniprogram/dev/app-pages.json`
- Modify after cleanup: `miniprogram/dev/bootstrap.ts`
- Modify after cleanup: `tests/build-miniprogram.test.mjs`
- Modify after cleanup: `tests/captain-open-game-native-preview.test.mjs`

- [ ] **Step 1: Pause and report the exact candidate**

Report branch/SHA, clean tree, migration head, contract/focused test counts, production audit, `MINIPROGRAM_PAYMENT_PROVIDER=disabled`, `ONLINE_BOOKING_ENABLED=false`, target `ucloud-v100`, backup paths and rollback. Ask for permission to apply `0015` and deploy the exact API candidate, including this narrow failed-rollout recovery: first inspect the actual Alembic revision and `to_regclass` existence of `teams` and `open_games`; an intact `0014` with both tables absent needs no downgrade, while an intact `0015` may be downgraded only when both tables exist and are empty. Any other revision/table combination, or any non-empty B2 table, stops for new authorization. The authorized recovery then restores the prior env/release and restarts the recorded old images. This is not permission to select/create acceptance data, restore a dump, upload, submit for review or publish a Mini Program.

- [ ] **Step 2: After deployment confirmation, preflight and back up**

Follow `deploy/README.md` “Prepare live-staging inputs”. Locally run without printing the ignored environment:

```bash
uv run python -m scripts.preflight_deploy --env-file deploy/.env.live.local
docker compose --env-file deploy/.env.live.local config --quiet
```

On `ucloud-v100`, first prove: `current` is a symlink whose target is under `/opt/pitch-booking/releases`; the shared env is a regular mode-`0600` file; the candidate directory is absent; and exactly one running Caddy container owns `127.0.0.1:8080`. Read that container's `com.docker.compose.project` label and use the resulting `compose_project` with `-p` in every Compose command. Record the current PostgreSQL mount name and current API/worker image IDs, and abort if either is ambiguous.

With `umask 077`, copy the shared env to `backups/env-before-<sha>-<utc>`, require `cmp -s`, and never print it. Using the same `-p "$compose_project"`, stream `pg_dump -Fc --no-owner --no-acl` from the existing PostgreSQL container to a temporary backup, require non-empty output, validate it silently with `pg_restore --list`, then atomically rename it under `/opt/pitch-booking/backups`. Do not emit the dump/list/env or expanded connection variables.

- [ ] **Step 3: Deploy the immutable backend candidate and verify health**

Set `candidate_sha` to the verified 40-character `git rev-parse HEAD` from a clean tree. Create `git archive --format=tar "$candidate_sha"`, verify `git get-tar-commit-id` equals that SHA, record the archive SHA-256, transfer it to a mode-`0600` `.incoming-$candidate_sha.tar`, verify the checksum remotely, extract to `.incoming-$candidate_sha/`, assert the expected Compose and `0015` files, then atomically rename it to `/opt/pitch-booking/releases/$candidate_sha`. Never overwrite an existing release and never copy/link secrets into it; every Compose call uses the absolute shared `--env-file`.

After backing up the env, replace only `APP_REVISION` with `$candidate_sha` through a mode-`0600` temporary file and atomic rename without printing content. Render the candidate with `docker compose -p "$compose_project" --env-file "$shared_env" -f "$release_dir/compose.yaml" config --quiet`, then run the same prefix with `up -d --build --wait --wait-timeout 180`. Assert the PostgreSQL mount name is byte-identical to the recorded value. Only after all checks below pass, atomically replace the `current` symlink with the candidate.

Verify:

```text
GET /api/v1/health = 200 with X-App-Revision=<exact-sha>
api/postgres container health = healthy
worker/caddy container state = running
alembic current = 0015
unauthenticated owner entry = 401
unknown shared token = 404
```

If a rollout check fails before acceptance data is authorized, stop API/worker/Caddy but keep PostgreSQL running. Inspect the actual Alembic revision and, without assuming the migration completed, query `to_regclass` for `teams` and `open_games`:

- revision `0014` with both tables absent means the transactional upgrade did not land; skip downgrade;
- revision `0015` with both tables present requires exact counts for both tables and permits `uv run alembic downgrade 0014` through the candidate API image with the same Compose project/network only when both counts are zero;
- every other revision/table combination, either non-zero count, or any query ambiguity stops for user authorization.

After the permitted no-downgrade or zero-row downgrade branch, atomically restore the env backup and previous symlink, retag the recorded old API/worker image IDs to their Compose service tags, and start the previous release with `--no-build`. Re-verify revision/health/mount. Any missing old image, ambiguous project/volume, or DB restore need stops for user authorization; never silently restore the dump.

- [ ] **Step 4: Pause for controlled acceptance-data authorization**

Report the deployed revision and ask permission to select one existing or create one dedicated future `CONFIRMED` order more than 2h away. Before any write, record counts and immutable identifiers for Order, Slot, Payment, RefundCase and RefundAttempt without printing PII. If no suitable real order exists, do not fabricate a paid claim: propose a clearly marked non-funding staging order and obtain explicit approval. Its cleanup recipe must target an exact acceptance marker and never delete user/venue/pitch/membership data.

- [ ] **Step 5: Build and audit an isolated experience candidate**

After data authorization, build against the real staging API with the ignored live input and forced `MINIPROGRAM_PAYMENT_PROVIDER=disabled`; assert `ONLINE_BOOKING_ENABLED=false`, 17 production routes, and zero Fixture/dev/sample-literal leakage. Generate the isolated live-preview project only from the audited package.

- [ ] **Step 6: Pause before WeChat DevTools upload**

Report the candidate SHA, proposed experience version/remark, staging revision, disabled-payment checks and audit result. Request separate explicit confirmation to click “上传”. This confirmation does not authorize formal review or public release.

- [ ] **Step 7: After upload confirmation, upload and record the experience version**

Upload only the isolated audited project, set that build as the experience version, and record version/SHA/remark in the acceptance document. Do not submit it for review, publish it or expose a QR outside authorized experience members.

- [ ] **Step 8: Run the complete real-iPhone journey**

On the authorized controlled order, test each visible action once: open CREATE; edit every field/control including `ANY`, deadline and AA; save DRAFT; preview and return; edit/prefill/save; open and close publish confirmation; confirm publish; invoke native share and open the token view; verify public privacy/back; edit/save while published; open and close cancel confirmation; confirm cancel; verify CANCELLED has no mutation actions; return to order. Assert post-journey Order and Slot are unchanged and Payment/RefundCase/RefundAttempt counts and rows are byte-equivalent to the baseline; only the intended Team/OpenGame/idempotency rows may change. Do not enable C1 or make a payment/refund call.

- [ ] **Step 9: Clean only dedicated staging acceptance data**

In one transaction, lock the exact marked game/team graph, re-prove its Order/Slot/payment/refund baseline, delete only the cancelled acceptance OpenGame and an otherwise-unreferenced dedicated Team, and remove only B2 idempotency records whose canonical resource/body hashes match that graph. Abort on any count or ownership mismatch. Never delete the Order or Slot. In a fresh transaction prove the acceptance marker is gone and all B1 baselines are unchanged.

- [ ] **Step 10: Write the cleanup RED gate and inventory the route/token union**

Update `tests/captain-open-game-native-preview.test.mjs` and the focused build test so they require the retired Fixture/pages/adapter to be absent while all three production routes and real development-HTTP source/store remain. Run them once and require RED only because the temporary files still exist. Inventory the complete current development route/token union before editing central registration.

- [ ] **Step 11: Delete only the B2 temporary preview boundary**

Delete exactly the listed captain Fixture, dev pages, page manifest and temporary adapter. Remove only Fixture-mode captain hooks from central bootstrap/manifests; preserve real HTTP source/attempt-store registration, all unrelated dev routes, all 17 production routes, the audit deny rules and historical Artifact/review evidence.

- [ ] **Step 12: Verify cleanup, document and commit**

```bash
node --test tests/captain-open-game-native-preview.test.mjs \
  tests/build-miniprogram.test.mjs \
  tests/development-http-build.test.mjs \
  tests/audit-production-package.test.mjs \
  tests/production-package-booking-audit.test.mjs
npx jest miniprogram/domain/open-game-decoder.test.ts \
  miniprogram/services/http-open-game.test.ts \
  miniprogram/services/open-game-attempt-store.test.ts \
  miniprogram/presentation/open-game.test.ts \
  miniprogram/pages/captain-game-form/index.test.ts \
  miniprogram/pages/captain-game-manage/index.test.ts \
  miniprogram/pages/captain-game-public/index.test.ts \
  miniprogram/pages/order-detail/index.test.ts --runInBand
npm run typecheck
bash -c 'set -a; source deploy/miniprogram.live.local; set +a; MINIPROGRAM_PAYMENT_PROVIDER=disabled npm run build:miniprogram:production'
npm run audit:miniprogram-package
git diff --check
```

Record device results, exact staging cleanup assertions, Fixture removal, disabled-payment build and zero-forbidden audit. Commit only these root-owned cleanup/docs changes.

- [ ] **Step 13: Mark B2 complete only after the production package is Fixture-free**

`B2 COMPLETE` requires real staging/API integration, real-iPhone acceptance, every visible action backed by production behavior, and a production package with zero captain Fixture/dev data. It does not enable C1 or prove any payment/refund path.
