# C2b Waitlist WeChat Notification Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a real WeChat waitlist-promotion subscription/provider capability while keeping every unconfigured environment fail-closed and preserving the application journey.

**Architecture:** A narrow Mini Program capability owns `wx.requestSubscribeMessage` and is registered only by a validated production build. A separate backend WeChat adapter owns its own access-token cache and maps only reviewed payload fields into configured template keywords. The existing outbox worker is composed only when the provider is explicitly enabled and supersedes notifications at or after game start.

**Tech Stack:** WeChat Mini Program TypeScript/WXML/WXSS, Jest, Node build scripts/tests, Python 3.13, Pydantic Settings, httpx, SQLAlchemy/PostgreSQL, pytest.

---

## Chunk 1: Client subscription capability

### Task 1: Add the isolated native subscription capability

**Files:**
- Create: `miniprogram/services/open-game-notification-subscription.ts`
- Create: `miniprogram/services/open-game-notification-subscription.test.ts`

- [ ] **Step 1: Write failing capability tests**

Cover one valid template ID passed to `wx.requestSubscribeMessage`, accepted variants, reject/ban/filter, fail, synchronous throw, timeout, single settlement, registration lookup and reset. Returned values are only `ACCEPTED | DECLINED | UNAVAILABLE | TIMED_OUT`; raw provider data never leaves the adapter.

- [ ] **Step 2: Run RED**

Run: `npx jest --runInBand miniprogram/services/open-game-notification-subscription.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the minimal capability**

Use a callback wrapper with an injected/default 8-second timer. Validate the template ID before construction; accept `accept`, `acceptWithAlert`, `acceptWithAudio`, and `acceptWithForcePush`; settle all other callback results without throwing. Timeout is distinct so the page cannot submit behind a native dialog that may still be active; late callbacks are ignored.

- [ ] **Step 4: Run GREEN**

Run the same Jest command and `npm run typecheck`.

- [ ] **Step 5: Commit**

Commit: `feat(c2b): add waitlist subscription capability`

### Task 2: Integrate only into a fresh application tap

**Files:**
- Modify: `miniprogram/pages/player-game-application/index.ts`
- Modify: `miniprogram/pages/player-game-application/index.wxml`
- Modify: `miniprogram/pages/player-game-application/index.wxss`
- Modify: `miniprogram/pages/player-game-application/index.test.ts`

- [ ] **Step 1: Write failing page tests**

Test that fresh valid `onSubmit` invokes the native capability synchronously before the first await and before `apply`; accepted, declined and unavailable outcomes all submit the exact durable attempt; timeout creates no attempt/write and late callbacks stay stale; duplicate taps share one operation; invalid drafts do not prompt; `RESULT_UNKNOWN` confirmation/replay does not prompt. Assert the conditional helper copy and existing centered/safe-area CTA rules.

- [ ] **Step 2: Run RED**

Run: `npx jest --runInBand miniprogram/pages/player-game-application/index.test.ts`

Expected: FAIL because no subscription capability is called or helper is rendered.

- [ ] **Step 3: Implement minimal page orchestration**

After synchronous local/authority validation, call the optional capability directly in the original handler before any await, start one in-flight promise, and enter `SUBMITTING`. Accepted/declined/native-failed results then begin the existing attempt and HTTP write. Timeout enters an explicit locked `SUBSCRIPTION_PENDING` state with no attempt/write; late callbacks and stale generations do nothing. Do not call the capability from `executeApply`, `onConfirmResult`, login recovery, or attempt restoration.

- [ ] **Step 4: Run GREEN**

Run the focused page/capability suites and typecheck.

- [ ] **Step 5: Commit**

Commit: `feat(c2b): request promotion subscription on apply`

## Chunk 2: Build-time fail-closed client composition

### Task 3: Validate and inject Mini Program notification config

**Files:**
- Modify: `miniprogram/config/runtime.ts`
- Modify: `scripts/build-miniprogram.mjs`
- Modify: `tests/build-miniprogram.test.mjs`
- Modify: `tests/build-booking-preview.test.mjs`

- [ ] **Step 1: Write failing Node tests**

Assert default production builds emit `disabled` and no template ID, `wechat` requires a valid template ID, invalid provider/ID fail before output replacement, and enabled production bootstrap registers the real capability. Assert development builds remain unconfigured unless explicitly using production composition.

- [ ] **Step 2: Run RED**

Run: `node --test tests/build-miniprogram.test.mjs tests/build-booking-preview.test.mjs`

Expected: FAIL on missing resolver/runtime exports/composition.

- [ ] **Step 3: Implement build validation and composition**

Add `resolveOpenGameNotificationConfig`, replace the two runtime exports, and register `createWeChatWaitlistPromotionSubscriptionCapability` only when the resolved provider is `wechat`.

- [ ] **Step 4: Run GREEN and package checks**

Run the focused Node tests, `npm run build:miniprogram:production`, and `npm run audit:miniprogram-package` with safe placeholder build inputs and notification provider disabled.

- [ ] **Step 5: Commit**

Commit: `build(c2b): gate waitlist subscription configuration`

## Chunk 3: Backend provider and lifecycle gate

### Task 4: Add strict backend settings and real WeChat adapter

**Files:**
- Modify: `backend/app/config.py`
- Modify: `backend/app/modules/open_game_notifications/__init__.py`
- Create: `backend/app/modules/open_game_notifications/wechat_provider.py`
- Create: `backend/tests/test_open_game_notification_provider.py`
- Modify: `backend/tests/test_phone_vault.py`

- [ ] **Step 1: Write failing settings/provider tests**

Settings tests cover default disabled, exact provider enum, incomplete enabled config rejection, exact closed mapping/type prefixes/distinct keywords, template ID validation, residual credentials ignored while disabled, `SecretStr` redaction, miniprogram state enum, and the staging=`trial` / production=`formal` binding. Provider tests use `httpx.MockTransport` to cover closed request JSON, Shanghai time formatting, Unicode truncation, AppID/template-key guards, the sub-30-second aggregate I/O deadline including invalid-token recovery, token cache, one invalid-token refresh, safe retryable/permanent classifications, malformed/HTTP/network responses, no secret in repr/log/error, and owned-client close.

- [ ] **Step 2: Run RED**

Run: `uv run --project backend pytest -q backend/tests/test_open_game_notification_provider.py backend/tests/test_phone_vault.py`

Expected: FAIL on missing configuration and adapter.

- [ ] **Step 3: Implement minimal provider/factory**

Keep all response parsing internal; never return/log raw WeChat bodies. Use a separate lock/cache from auth phone exchange, one token refresh retry, and the existing `NotificationResult` boundary. Factory returns `None` for disabled and constructs only complete enabled configuration.

- [ ] **Step 4: Run GREEN and static checks**

Run focused pytest, `uv run --project backend ruff check` on changed Python files, and `uv run --project backend mypy backend`.

- [ ] **Step 5: Commit**

Commit: `feat(c2b): add real WeChat notification provider`

### Task 5: Add start-time supersede and root worker composition

**Files:**
- Modify: `backend/app/modules/open_game_notifications/repository.py`
- Modify: `backend/app/worker.py`
- Modify: `backend/tests/test_open_game_notification_worker.py`

- [ ] **Step 1: Write failing repository/worker tests**

At `now == starts_at` and after start, claimed rows become `SUPERSEDED` with zero provider calls. A complete `wechat` config builds an owned provider and notification scan; disabled leaves outbox untouched and ignores residual credentials; owned clients close on normal and exceptional exit.

- [ ] **Step 2: Run RED**

Run the focused worker tests against `TEST_DATABASE_URL`.

Expected: FAIL because start time is not checked and root composition does not build the scan.

- [ ] **Step 3: Implement the minimal gate/composition**

Read one authorization time under the existing lock order, compare with `game.starts_at`, and reuse it for the send-start marker. In `main`, only build and own the notification provider/worker when explicit composition was not injected and configuration selects `wechat`; close it in `finally`.

- [ ] **Step 4: Run GREEN**

Run all open-game notification worker/provider tests and relevant root-worker tests.

- [ ] **Step 5: Commit**

Commit: `feat(c2b): compose waitlist notification delivery`

## Chunk 4: Deployment contract and verification

### Task 6: Keep staging disabled and document the external gate

**Files:**
- Modify: `compose.yaml`
- Modify: `deploy/.env.example`
- Modify: `deploy/README.md`
- Modify: `scripts/preflight_deploy.py`
- Modify: `scripts/prepare_live_deploy.py`
- Modify: `backend/tests/test_deploy_preflight.py`
- Modify: `backend/tests/test_prepare_live_deploy.py`

- [ ] **Step 1: Write failing deployment tests**

Assert generated backend and Mini Program envs default to notification `disabled`; enabling requires template/mapping and emits matching client values; preflight rejects partial/placeholder/mismatched enablement and accepts disabled empty values without printing secrets.

- [ ] **Step 2: Run RED**

Run: `uv run --project backend pytest -q backend/tests/test_deploy_preflight.py backend/tests/test_prepare_live_deploy.py`

Expected: FAIL because the variables and gates are absent.

- [ ] **Step 3: Implement the minimal deployment surface**

Thread the disabled defaults through Compose and the generator. Document the three external prerequisites and exact enablement variables. Do not change local/staging values or invoke deployment.

- [ ] **Step 4: Run GREEN**

Run the focused deployment tests and `docker compose config` only if local tooling is already available; otherwise rely on the existing compose parser test.

- [ ] **Step 5: Commit**

Commit: `docs(c2b): gate notification deployment`

### Task 7: Final review and verification

**Files:**
- Review all files changed since `3f361c9`

- [ ] **Step 1: Run focused and regression verification**

Run contract validation, all C2b notification tests, relevant application/build/deploy suites, typecheck, changed-file lint/ruff/mypy, fresh production build and package audit, and `git diff --check`.

- [ ] **Step 2: Independent specification and code review**

Ask independent agents to compare the implementation with the design, then inspect security/privacy, timeout/retry classification, disabled composition, unknown-result non-reprompt, and owned resource cleanup. Fix only Critical/Important findings with new RED tests.

- [ ] **Step 3: Independent real-runtime visual review**

With an enabled non-sending preview configuration, inspect the existing application page helper and submit state on representative iOS and Android targets. Confirm no layout/safe-area regression and that every visible button retains a real handler. This review does not satisfy physical notification delivery.

- [ ] **Step 4: Report exact result and gates**

Report commit SHAs, test counts, provider still disabled in staging, no external sends/deploys, and the outstanding real template + iOS/Android delivery/deeplink acceptance gate.
