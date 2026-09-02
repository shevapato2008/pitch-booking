# Optional Signup Avatar Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow shared-game signup with a default nickname and no uploaded avatar, using a smaller confirmation sheet.

**Architecture:** Relax the user public-profile database invariant and signup service check so a confirmed nickname-only profile is authoritative. Keep `avatar_url` nullable through OpenAPI and the mini-program decoder, then reuse the roster's existing initial-based avatar fallback in a compact signup sheet.

**Tech Stack:** PostgreSQL 17, Alembic, FastAPI/Pydantic, OpenAPI, TypeScript, WeChat Mini Program WXML/WXSS, pytest, Jest.

---

## Chunk 1: Optional avatar end to end

### Task 1: Make public avatars optional and simplify signup confirmation

**Files:**
- Create: `backend/migrations/versions/0029_optional_public_profile_avatar.py`
- Modify: `backend/app/models.py`
- Modify: `backend/app/modules/auth/service.py`
- Modify: `backend/app/modules/open_game_registrations/service.py`
- Modify: `contracts/openapi.yaml`
- Modify: `miniprogram/domain/open-game-registration.ts`
- Modify: `miniprogram/services/http-open-game-registration.ts`
- Modify: `miniprogram/pages/captain-game-public/index.ts`
- Modify: `miniprogram/pages/captain-game-public/index.wxml`
- Modify: `miniprogram/pages/captain-game-public/index.wxss`
- Test: `backend/tests/test_shared_game_signup_roster.py`
- Test: `backend/tests/test_shared_game_signup_roster_migration.py`
- Test: migration-head assertions in `backend/tests/test_platform_session_migration.py`, `backend/tests/test_venue_directory_migration.py`, `backend/tests/test_open_game_registration_schema.py`, `backend/tests/test_booking_migration_cycle.py`, and `backend/tests/test_venue_profile_postgres.py`
- Test: `backend/tests/test_openapi_conformance.py`
- Test: `miniprogram/services/http-open-game-registration.test.ts`
- Test: `miniprogram/pages/captain-game-public/index.test.ts`

- [ ] **Step 1: Write failing backend, contract, decoder, and page tests**

Cover a nickname-only confirmed profile (`nickname: "微信用户"`, null avatar, version 1), successful direct signup with a null roster avatar, migration upgrade/downgrade safety, nullable confirmed `avatar_url`, the simplified `确认报名` title, and first signup submitting without calling avatar upload.

- [ ] **Step 2: Run focused tests and confirm the new assertions fail**

Run:

```bash
TEST_DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test \
  uv run pytest backend/tests/test_shared_game_signup_roster.py \
  backend/tests/test_shared_game_signup_roster_migration.py \
  backend/tests/test_openapi_conformance.py -q
npx jest --runInBand miniprogram/pages/captain-game-public/index.test.ts \
  miniprogram/services/http-open-game-registration.test.ts
```

Expected: failures specifically show the existing avatar-pair constraint, service guard, decoder, and page validation.

- [ ] **Step 3: Implement the minimal backend and contract changes**

Replace `ck_users_public_profile_pair` so confirmed profiles require nickname/timestamp/version but not an avatar; allow nickname-only confirmation in auth and signup services; keep existing avatars when the request key is null; declare confirmed `avatar_url` nullable in OpenAPI; update migration-head assertions to `0029`. Migration `0029` must reject downgrade while any confirmed avatarless profile exists, because revision `0028` cannot represent that data.

- [ ] **Step 4: Implement the compact mini-program sheet**

Prefill missing profiles with `微信用户`; remove the avatar validation; accept null confirmed avatar URLs; show an initial-based default avatar beside the nickname field; label avatar selection as optional; retain the two mandatory confirmations; use the title `确认报名` and direct action labels `确认报名` / `加入候补`.

- [ ] **Step 5: Run focused verification**

Run the Step 2 commands again, followed by:

```bash
npm run typecheck
npm run contract:validate
npm run build:miniprogram:development
```

Expected: all commands pass.

- [ ] **Step 6: Review one real WeChat DevTools preview**

Check a first-time profile at the target viewport: no forced avatar error, default nickname visible, buttons horizontally and vertically centered, sheet scroll/safe-area intact, and signup submits after the two confirmations.

- [ ] **Step 7: Commit**

```bash
git add backend contracts miniprogram docs/superpowers
git commit -m "fix: make signup avatars optional"
```
