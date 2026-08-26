# Public Game Discovery Production Implementation Plan

> **For agentic workers:** REQUIRED: Use `superpowers:subagent-driven-development` to execute this plan task by task, `superpowers:test-driven-development` for every production change, and `superpowers:verification-before-completion` before any completion claim.

**Goal:** Ship one truthful B2+C1a+C1b experience candidate in which an anonymous player discovers real public games, filters them, opens the existing C1a detail, and can continue through the real application journey.

**Architecture:** Add a narrow anonymous `public_games` read module over existing B2/C1a authority and registrations. Expose one closed response contract, then adapt the approved C1b page to a strict HTTP source and the existing token detail path. Keep all preview Fixtures under `miniprogram/dev`; production composition and audit must exclude them.

**Tech Stack:** Python 3.13, FastAPI, SQLAlchemy 2, PostgreSQL, Pydantic 2, Alembic, TypeScript, WeChat Mini Program, Jest, Node test runner, Docker Compose.

---

## Task 1: Freeze the anonymous contract and shared authority predicate

**Files:**

- Create: `backend/app/modules/public_games/__init__.py`
- Create: `backend/app/modules/public_games/dto.py`
- Create: `contracts/examples/public-games-ready.json`
- Create: `contracts/examples/public-games-empty.json`
- Modify: `backend/app/modules/open_games/lifecycle.py`
- Modify: `backend/app/modules/open_games/dto.py`
- Modify: `backend/tests/test_open_game_lifecycle.py`
- Modify: `contracts/openapi.yaml`
- Modify: `scripts/validate-contract.mjs`
- Modify: `tests/contract.test.mjs`
- Modify: `backend/tests/test_openapi_conformance.py`
- Test: `backend/tests/test_public_game_directory_contract.py`

### Steps

- [ ] Add failing lifecycle tests proving one exported `published_authority_is_healthy()` returns true only for `CONFIRMED`, uncancelled authority with no controlling cancellation/inventory-conflict refund purpose, and prove both action projection and published update validation use the same function.
- [ ] Run `uv run pytest backend/tests/test_open_game_lifecycle.py -q` and confirm RED because the exported function/usage does not exist.
- [ ] Export the one predicate, replace both private duplicate implementations, and keep existing behavior unchanged.
- [ ] Add failing DTO/contract tests for closed models equivalent to:

  ```python
  class PublicGameFormat(StrEnum):
      FIVE = "FIVE"
      SEVEN = "SEVEN"

  class PublicGameDirectoryItem(ClosedModel):
      detail_path: Annotated[str, Field(pattern=r"^/pages/captain-game-public/index\?token=[A-Za-z0-9_-]{32}$")]
      local_date: date
      format: PublicGameFormat
      current_players: Annotated[int, Field(strict=True, ge=1)]
      remaining_spots: Annotated[int, Field(strict=True, ge=0)]
      game: OpenGamePublic

  class PublicGameDirectoryResponse(ClosedModel):
      authoritative_now: datetime
      available_dates: list[date]
      items: list[PublicGameDirectoryItem]
  ```

  Assert aware timestamps, unique sorted dates, stable item order, format/pitch consistency, capacity consistency, published/public visibility, future start/deadline, strict detail path, and rejection of extra/private fields.
- [ ] Run `uv run pytest backend/tests/test_public_game_directory_contract.py backend/tests/test_openapi_conformance.py -q && npm run contract:validate && node --test tests/contract.test.mjs`; confirm RED because the directory models/path/examples are absent.
- [ ] Implement the minimum closed DTOs and committed examples. Add `GET /api/v1/public-games` to the frozen OpenAPI contract with optional `local_date`, aliased `format`, and `available_only`; declare `security: []`, response `PublicGameDirectoryResponse`, and `422`/`503` `ErrorEnvelope` responses.
- [ ] Extend contract validation to require the anonymous security declaration, strict schema refs, the three query parameters, and examples. Do not add pagination or authentication.
- [ ] Run:

  ```bash
  uv run pytest \
    backend/tests/test_open_game_lifecycle.py \
    backend/tests/test_public_game_directory_contract.py \
    backend/tests/test_openapi_conformance.py -q
  npm run contract:validate
  node --test tests/contract.test.mjs
  ```

  Expected: PASS with no warnings or contract drift.
- [ ] Review the diff for duplicate lifecycle policy, extra response fields, and scope creep; then commit as `feat(c1b): define public game directory contract`.

## Task 2: Implement the bounded authoritative directory query and API

**Files:**

- Create: `backend/app/modules/public_games/repository.py`
- Create: `backend/app/modules/public_games/service.py`
- Create: `backend/app/modules/public_games/router.py`
- Create: `backend/tests/test_public_game_directory_service.py`
- Create: `backend/tests/test_public_game_directory_api.py`
- Modify: `backend/app/main.py`

### Steps

- [ ] Start the disposable PostgreSQL dependency with `docker compose -f deploy/compose.test.yaml up -d --wait`; keep it running through Task 6.
- [ ] Add failing service tests for: PUBLIC/PUBLISHED/healthy/future eligibility; LINK_ONLY, draft, cancelled, completed, unhealthy authority, expired deadline, started game, unsupported format, and malformed token omission; stable `(starts_at,id)` order; local dates in the venue time zone; pre-filter `available_dates`; all three filters; only `JOINED` consuming spots; and zero remaining capacity.
- [ ] Add a failing query-count test proving a multi-card response performs a fixed number of SQL statements rather than one query per game.
- [ ] Run `TEST_DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test uv run pytest backend/tests/test_public_game_directory_service.py -q` and confirm RED because repository/service do not exist.
- [ ] Implement one repository candidate query. It must join `OpenGame → Order → Slot → Pitch → Venue → Team`, include a grouped/correlated `JOINED` count and the newest controlling-refund purpose ordered by `(RefundCase.created_at DESC, RefundCase.id DESC)`, apply coarse PUBLIC/PUBLISHED/future/format bounds, and order by `(Slot.starts_at, OpenGame.id)`. It must not load users, payments, applications, or member rows and must not query inside a card loop.
- [ ] Implement a fail-closed service projection that:

  1. captures one aware `authoritative_now`;
  2. calls shared `published_authority_is_healthy()`;
  3. verifies strict token/time-zone/public projection invariants;
  4. computes `current_players` and `remaining_spots` from `JOINED` only;
  5. builds all eligible items and `available_dates` before user filters;
  6. applies `local_date`, `format`, and `available_only` without reordering.

- [ ] Add failing API tests for anonymous success, each query parameter, invalid parameters returning `ErrorEnvelope`, database failure returning `503`, no bearer dependency, and runtime OpenAPI equality with the committed contract.
- [ ] Run `TEST_DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test uv run pytest backend/tests/test_public_game_directory_api.py -q` and confirm RED because the route is absent.
- [ ] Implement `GET /api/v1/public-games` with an injected database and clock, `Query(alias="format")`, `openapi_extra={"security": []}`, and existing error-envelope handling. Register its router before runtime OpenAPI is frozen.
- [ ] Run:

  ```bash
  TEST_DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test \
    uv run pytest \
      backend/tests/test_public_game_directory_service.py \
      backend/tests/test_public_game_directory_api.py \
      backend/tests/test_open_game_service.py \
      backend/tests/test_open_game_api.py \
      backend/tests/test_openapi_conformance.py -q
  npm run contract:validate
  ```

  Expected: PASS; no privacy-field or query-count regression.
- [ ] Self-review repository bounds, fail-closed branches, time-zone conversion, and response order; then commit as `feat(c1b): expose authoritative public game directory`.

## Task 3: Add the strict Mini Program directory domain and HTTP source

**Files:**

- Create: `miniprogram/domain/public-game-directory.ts`
- Create: `miniprogram/domain/public-game-directory-decoder.ts`
- Create: `miniprogram/domain/public-game-directory-decoder.test.ts`
- Create: `miniprogram/services/public-game-directory.ts`
- Create: `miniprogram/services/http-public-game-directory.ts`
- Create: `miniprogram/services/http-public-game-directory.test.ts`
- Create: `miniprogram/presentation/public-game-directory.ts`
- Create: `miniprogram/presentation/public-game-directory.test.ts`

### Steps

- [ ] Add failing decoder tests for a valid ready response plus rejection of extra/private keys, malformed token path, wrong enum, invalid/naive timestamp, inconsistent format/pitch, non-public or non-published game, capacity inconsistency, unsorted/duplicate dates, and unsorted items.
- [ ] Run `npx jest miniprogram/domain/public-game-directory-decoder.test.ts --runInBand` and confirm RED because the domain and decoder do not exist.
- [ ] Define readonly domain types matching only the frozen wire contract. Reuse the existing `OpenGamePublic` decoder for `game`, then perform directory-specific cross-field checks and return immutable values. Do not accept a game ID or construct a token path client-side.
- [ ] Add failing source tests proving registration/reset behavior, missing-source failure, exact anonymous GET path/query serialization, omitted default filters, strict decoding, and transport/decode error propagation.
- [ ] Run `npx jest miniprogram/services/http-public-game-directory.test.ts --runInBand` and confirm RED because the registry/HTTP adapter do not exist.
- [ ] Implement a small source registry and an HTTP adapter using the existing anonymous transport conventions. Serialize `local_date`, `format`, and `available_only=true` only when selected.
- [ ] Add failing presentation tests for Shanghai date/time labels, five/seven labels, player/spot summaries, intensity/experience/position text, and the existing approved card copy.
- [ ] Run `npx jest miniprogram/presentation/public-game-directory.test.ts --runInBand` and confirm RED because the presentation projector does not exist.
- [ ] Implement pure display projection by reusing existing open-game and Shanghai-time helpers; do not duplicate business eligibility or capacity decisions in presentation code.
- [ ] Run:

  ```bash
  npx jest \
    miniprogram/domain/public-game-directory-decoder.test.ts \
    miniprogram/services/http-public-game-directory.test.ts \
    miniprogram/presentation/public-game-directory.test.ts \
    --runInBand
  npm run typecheck
  ```

  Expected: PASS with strict malformed-payload rejection.
- [ ] Self-review wire/domain naming, readonly boundaries, and absence of auth/session/token construction; then commit as `feat(c1b): add public game directory client`.

## Task 4: Turn the approved preview into the real production page

**Files:**

- Create: `miniprogram/pages/game-discovery/index.json`
- Create: `miniprogram/pages/game-discovery/index.ts`
- Create: `miniprogram/pages/game-discovery/index.wxml`
- Create: `miniprogram/pages/game-discovery/index.wxss`
- Create: `miniprogram/pages/game-discovery/index.test.ts`

### Steps

- [ ] Add failing page tests for initial two-skeleton loading, ready cards, server-backed date/format/availability changes, filtered empty and clear, source empty and return, load error and retry, exact card `detailPath` navigation, refresh on return, stale-response suppression, interactions disabled while loading, scroll-view structure, header fallback, and all visible buttons bound to real handlers.
- [ ] Run `npx jest miniprogram/pages/game-discovery/index.test.ts --runInBand` and confirm RED because the production page does not exist.
- [ ] Adapt the approved C1b WXML/WXSS into the production page. Preserve native header geometry, 44-pixel controls, equal cards, nested scroll, bottom safe area, visual hierarchy, and approved state copy; remove development/Fixture wording and scenario controls.
- [ ] Implement the page controller around `PublicGameDirectorySource` with a monotonically increasing request revision. Initial `onShow` loads; returning from detail reloads; each filter updates selected state then performs a real request. A failed current request clears cards and shows retry without pretending old results are current.
- [ ] Navigate the full card to its server-provided detail path. Header back uses `navigateBack` when history exists and otherwise `reLaunch('/pages/intent-entry/index')`. Source-empty recovery performs the same real re-launch. Clear-filter resets all filters and reloads.
- [ ] Run:

  ```bash
  npx jest \
    miniprogram/pages/game-discovery/index.test.ts \
    miniprogram/pages/captain-game-public/index.test.ts \
    --runInBand
  npm run typecheck
  ```

  Expected: PASS; every product button has a real asserted behavior.
- [ ] Manually inspect the generated WXML/WXSS against the approved native screenshots, focusing on button centering, repeated-control alignment, clipping, nested scroll, and safe area; then commit as `feat(c1b): ship production game discovery page`.

## Task 5: Wire development/production composition and enforce Fixture isolation

**Files:**

- Create: `miniprogram/dev/public-game-directory-source.ts`
- Create: `miniprogram/dev/public-game-directory-source.test.ts`
- Modify: `miniprogram/app.json`
- Modify: `miniprogram/pages/intent-entry/index.ts`
- Modify: `miniprogram/pages/intent-entry/index.wxml`
- Modify: `miniprogram/pages/intent-entry/index.test.ts`
- Modify: `miniprogram/dev/bootstrap.ts`
- Modify: `scripts/build-miniprogram.mjs`
- Modify: `tests/build-miniprogram.test.mjs`
- Modify: `tests/development-http-build.test.mjs`
- Modify: `scripts/audit-production-package.mjs`
- Modify: `tests/audit-production-package.test.mjs`
- Modify: `tests/production-package-booking-audit.test.mjs`
- Modify: `tests/public-game-discovery-native-preview.test.mjs`

### Steps

- [ ] Add failing intent-entry tests proving PLAY is enabled, has no “即将开放” badge, and one tap navigates exactly once to `/pages/game-discovery/index`; invalid/double taps remain inert.
- [ ] Add failing development-source tests proving its cards are deterministic, satisfy the production page's domain type, and link only to isolated development details. This adapter exists only to keep default local development operable.
- [ ] Add failing build tests proving: development fixture registers only the development adapter; development HTTP registers the real HTTP source; production registers the real HTTP source before `App({})`; route inventory increases from 19 to 20; and the C1b preview route test no longer assumes the combined branch is add-only relative to `main`.
- [ ] Add failing production-audit tests that inject each forbidden C1b fixture/scenario symbol or route and confirm rejection, while a clean production directory/source is accepted.
- [ ] Run the exact RED gate and confirm failures are limited to the missing adapter, registration, enabled entry, route, and audit rules:

  ```bash
  npx jest \
    miniprogram/pages/intent-entry/index.test.ts \
    miniprogram/dev/public-game-directory-source.test.ts --runInBand
  node --test \
    tests/public-game-discovery-native-preview.test.mjs \
    tests/build-miniprogram.test.mjs \
    tests/development-http-build.test.mjs \
    tests/audit-production-package.test.mjs \
    tests/production-package-booking-audit.test.mjs
  ```
- [ ] Implement the smallest development adapter by mapping the approved C1b fixture catalog to typed directory entries with development-only detail paths. Register it only in the fixture branch of `bootstrapDevelopment`.
- [ ] Register `HttpPublicGameDirectorySource` in development HTTP and generated production bootstrap before `App({})`. Ensure its anonymous transport does not require a session store or identity.
- [ ] In the same implementation/commit, add the production route to `app.json`, enable PLAY, remove its “即将开放” badge, and navigate with `wx.navigateTo` so the route is never reachable without a registered source.
- [ ] Update route counts and replace the preview test's combined-branch-incompatible Git-history assertion with direct checks that preview files stay under `miniprogram/dev` and never enter production output.
- [ ] Extend production audit with exact forbidden dev routes/symbols/copy; do not ban legitimate production “公开球局” copy.
- [ ] Run:

  ```bash
  npx jest \
    miniprogram/pages/intent-entry/index.test.ts \
    miniprogram/dev/public-game-directory-source.test.ts --runInBand
  node --test \
    tests/public-game-discovery-artifact.test.mjs \
    tests/public-game-discovery-native-preview.test.mjs \
    tests/build-miniprogram.test.mjs \
    tests/development-http-build.test.mjs \
    tests/audit-production-package.test.mjs \
    tests/production-package-booking-audit.test.mjs
  npm run typecheck
  npm run build:miniprogram:development
  ```

  Expected: PASS and no C1b dev artifact in the production composition.
- [ ] Self-review generated bootstrap order and audit specificity; then commit as `build(c1b): wire discovery and isolate previews`.

## Task 6: Verify one immutable combined experience candidate

**Files:**

- Modify only when a failing test proves a product defect within B2/C1a/C1b scope.
- Create release evidence under the repository's existing ignored/generated evidence location only when the deployment scripts require it.

### Steps

- [ ] Request independent specification and code-quality reviews over the full production delta. Resolve every Critical/Important issue through a new failing regression test, the minimum fix, and the affected focused gates. Commit each fix before continuing.
- [ ] Synchronize before collecting release evidence:

  ```bash
  git fetch origin
  git merge --no-edit origin/main
  git diff --check
  git status --short
  ```

  Expected: the merge is conflict-free, `git status --short` is empty, and the combined branch still contains both exact preview ancestors. Record `combined_candidate_sha=$(git rev-parse HEAD)` and require 40 characters. Any later tracked change creates a new candidate SHA and restarts Task 6 from this synchronization step.
- [ ] Start disposable PostgreSQL and run migrations through current head against the frozen candidate:

  ```bash
  test "$(git rev-parse HEAD)" = "$combined_candidate_sha"
  docker compose -f deploy/compose.test.yaml up -d --wait
  TEST_DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test \
    uv run alembic upgrade head
  ```

- [ ] Run the affected combined backend suite:

  ```bash
  TEST_DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test \
    uv run pytest \
      backend/tests/test_public_game_directory_contract.py \
      backend/tests/test_public_game_directory_service.py \
      backend/tests/test_public_game_directory_api.py \
      backend/tests/test_open_game_lifecycle.py \
      backend/tests/test_open_game_api.py \
      backend/tests/test_open_game_service.py \
      backend/tests/test_open_game_registration_api.py \
      backend/tests/test_open_game_registration_service.py \
      backend/tests/test_open_game_registration_concurrency.py \
      backend/tests/test_openapi_conformance.py \
      backend/tests/test_booking_migration_cycle.py -q
  ```

- [ ] Run the contract, TypeScript, and package gates:

  ```bash
  npm run contract:validate
  node --test tests/contract.test.mjs
  npm run typecheck
  npx jest \
    miniprogram/domain/public-game-directory-decoder.test.ts \
    miniprogram/services/http-public-game-directory.test.ts \
    miniprogram/presentation/public-game-directory.test.ts \
    miniprogram/dev/public-game-directory-source.test.ts \
    miniprogram/pages/intent-entry/index.test.ts \
    miniprogram/pages/game-discovery/index.test.ts \
    miniprogram/pages/captain-game-public/index.test.ts \
    miniprogram/pages/player-game-application/index.test.ts \
    miniprogram/pages/captain-game-manage/index.test.ts \
    miniprogram/pages/captain-game-applications/index.test.ts \
    --runInBand
  node --test \
    tests/public-game-discovery-artifact.test.mjs \
    tests/public-game-discovery-native-preview.test.mjs \
    tests/build-miniprogram.test.mjs \
    tests/development-http-build.test.mjs \
    tests/audit-production-package.test.mjs \
    tests/production-package-booking-audit.test.mjs
  npm run build:miniprogram:development
  bash -c 'set -a; source "$1"; set +a; MINIPROGRAM_PAYMENT_PROVIDER=disabled npm run build:miniprogram:production' \
    bash /Users/fan/Repositories/startups/pitch-booking/deploy/miniprogram.live.local
  npm run audit:miniprogram-package
  git diff --check
  test "$(git rev-parse HEAD)" = "$combined_candidate_sha"
  ```

- [ ] Open `dist/miniprogram-development` in WeChat Developer Tools and use Computer Use/DevTools automation at iPhone X `375 × 812`. From the real intent page, tap PLAY and verify the representative ready → date/format/availability filter → nested-scroll → card → development detail → back journey. Manually inspect centered button labels, aligned repeated controls/cards, complete icons, clipping, safe area, copy/data, console errors, and failed requests. Loading/error/filtered-empty/source-empty recovery remain covered by the focused page tests and the already accepted native C1b scenario evidence; do not rebuild a second scenario harness.
- [ ] If native review or any gate finds a product defect, write a focused failing test first, implement and commit the minimum fix, then restart Task 6 from synchronization with a new candidate SHA. Spend at most one bounded attempt on non-product screenshot tooling before using direct DevTools inspection.
- [ ] Push and prove the frozen branch reference:

  ```bash
  git push -u origin feature/c1b-game-discovery-production
  test "$(git rev-parse HEAD)" = "$combined_candidate_sha"
  test "$(git rev-parse origin/feature/c1b-game-discovery-production)" = "$combined_candidate_sha"
  git diff --quiet
  git diff --cached --quiet
  ```

- [ ] Run live preflight without copying or printing secrets:

  ```bash
  uv run python -m scripts.preflight_deploy \
    --env-file /Users/fan/Repositories/startups/pitch-booking/deploy/.env.live.local
  docker compose \
    --env-file /Users/fan/Repositories/startups/pitch-booking/deploy/.env.live.local \
    -f compose.yaml config --quiet
  docker compose \
    --env-file /Users/fan/Repositories/startups/pitch-booking/deploy/.env.live.local \
    -f compose.yaml -f deploy/compose.rollback-retain-schema.yaml config --quiet
  ```

  Expected: all three commands PASS and neither ignored file is printed.
- [ ] Create the immutable archive and transfer it to the existing `ucloud-v100` release host:

  ```bash
  release_archive="/tmp/pitch-booking-${combined_candidate_sha}.tar"
  git archive --format=tar --output="$release_archive" "$combined_candidate_sha"
  test "$(git get-tar-commit-id < "$release_archive")" = "$combined_candidate_sha"
  archive_checksum=$(shasum -a 256 "$release_archive" | awk '{print $1}')
  scp "$release_archive" "ucloud-v100:/opt/pitch-booking/releases/.incoming-${combined_candidate_sha}.tar"
  ssh ucloud-v100 "test \"\$(sha256sum /opt/pitch-booking/releases/.incoming-${combined_candidate_sha}.tar | awk '{print \\$1}')\" = '$archive_checksum'"
  ```

  Before activation, use the established immutable-release checks to require: `current` resolves under `/opt/pitch-booking/releases`; the shared env is a non-symlink mode-0600 file; one Compose project owns the active Caddy bound to `127.0.0.1:8080`; and PostgreSQL mount plus API/worker image IDs/references are unambiguous. Create and byte-compare a mode-0600 env backup and stream a nonempty `pg_dump -Fc --no-owner --no-acl` backup, validating it with `pg_restore --list` without printing either file.
- [ ] Extract to the new exact release directory (refuse an existing target), require `compose.yaml`, migration `0016`, and `deploy/compose.rollback-retain-schema.yaml`; derive a mode-0600 candidate env by changing only `APP_REVISION` to `combined_candidate_sha`; then activate with the resolved Compose project:

  ```bash
  shared_env=/opt/pitch-booking/shared/.env.live.local
  release_dir="/opt/pitch-booking/releases/$combined_candidate_sha"
  candidate_env_tmp="/opt/pitch-booking/shared/.env.candidate-${combined_candidate_sha}.tmp"
  test -f "$candidate_env_tmp" && test ! -L "$candidate_env_tmp"
  test "$(stat -c '%a' "$candidate_env_tmp")" = 600
  docker compose -p "$compose_project" --env-file "$candidate_env_tmp" \
    -f "$release_dir/compose.yaml" config --quiet
  mv "$candidate_env_tmp" "$shared_env"
  docker compose -p "$compose_project" --env-file "$shared_env" \
    -f "$release_dir/compose.yaml" up -d --build --wait --wait-timeout 180
  ```

  Require the PostgreSQL mount to be unchanged before repointing `current`. If activation or post-activation checks fail, stop only candidate `api worker caddy`, keep PostgreSQL/schema `0016`, atomically restore the prior env/current link, retag the recorded old API/worker images, and restart the previous release with `deploy/compose.rollback-retain-schema.yaml`; never downgrade or restore a dump online.
- [ ] Verify staging from the local machine without authentication:

  ```bash
  candidate_headers="/tmp/c1b-health-${combined_candidate_sha}.headers"
  candidate_body="/tmp/c1b-health-${combined_candidate_sha}.json"
  curl -fsS -D "$candidate_headers" -o "$candidate_body" \
    https://pitch-api-staging.modelstella.com/api/v1/health
  rg -i "^x-app-revision: ${combined_candidate_sha}\\r?$" "$candidate_headers"
  test "$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["status"])' "$candidate_body")" = ok
  curl -fsS https://pitch-api-staging.modelstella.com/api/v1/public-games \
    -o "/tmp/c1b-directory-${combined_candidate_sha}.json"
  python3 - "/tmp/c1b-directory-${combined_candidate_sha}.json" <<'PY'
  import json, re, sys
  body = json.load(open(sys.argv[1]))
  assert set(body) == {"authoritative_now", "available_dates", "items"}
  assert body["available_dates"] == sorted(set(body["available_dates"]))
  assert all(re.fullmatch(r"/pages/captain-game-public/index\?token=[A-Za-z0-9_-]{32}", item["detail_path"]) for item in body["items"])
  assert all(item["game"]["visibility"] == "PUBLIC" and item["game"]["state"] == "PUBLISHED" for item in body["items"])
  print(len(body["items"]))
  PY
  ```

  On the host also require Alembic `0016`, healthy API/PostgreSQL, running worker/Caddy, and no startup traceback. Exercise one returned date/format/availability combination and one deliberately unmatched filter, preserving the same `available_dates`; do not continue if revision, schema, privacy shape, or filtering fails.
- [ ] Prepare the isolated production Mini Program from the same frozen SHA:

  ```bash
  test "$(git rev-parse HEAD)" = "$combined_candidate_sha"
  test "$(git rev-parse origin/feature/c1b-game-discovery-production)" = "$combined_candidate_sha"
  bash -c 'set -a; source "$1"; set +a; MINIPROGRAM_PAYMENT_PROVIDER=disabled npm run build:miniprogram:production' \
    bash /Users/fan/Repositories/startups/pitch-booking/deploy/miniprogram.live.local
  npm run audit:miniprogram-package
  uv run python -m scripts.preflight_deploy \
    --env-file /Users/fan/Repositories/startups/pitch-booking/deploy/.env.live.local \
    --require-miniprogram-acceptance
  npm run prepare:miniprogram:live-preview
  test ! -d dist/miniprogram-production/dev
  rg -n 'ONLINE_BOOKING_ENABLED.*false' dist/miniprogram-production/config/runtime.js
  ```

- [ ] Open only `dist/miniprogram-live-preview` in WeChat Developer Tools. Using Computer Use at `375 × 812`, verify the staging-backed PLAY → directory → one filter → real C1a detail → back journey, correct real data, no console errors/failed requests, and the same manual visual checklist. Re-query `/api/v1/health` and require the frozen SHA after this smoke.
- [ ] Use Computer Use to inspect the WeChat upload/version UI and select the next unused patch version; never infer it from stale local evidence. Upload through DevTools CLI and capture machine-readable output outside the repository:

  ```bash
  experience_version='<next unused version observed in WeChat>'
  upload_info="/tmp/c1b-upload-${combined_candidate_sha}.json"
  /Applications/wechatwebdevtools.app/Contents/MacOS/cli upload \
    --project "$PWD/dist/miniprogram-live-preview" \
    --version "$experience_version" \
    --desc "B2+C1a+C1b统一候选；支付关闭；source ${combined_candidate_sha}" \
    --info-output "$upload_info"
  test -s "$upload_info"
  ```

  Verify the uploaded version and source remark in the UI, then set that upload as the experience version. This authorizes neither formal review nor public release.
- [ ] Stop disposable services with `docker compose -f deploy/compose.test.yaml down`.
- [ ] Report the exact branch SHA, staging revision, migration, experience version, automated results, native QA result, and the remaining physical-phone scenarios. Do not retire Fixtures or merge to `main` until the user confirms that exact experience version on phone.
