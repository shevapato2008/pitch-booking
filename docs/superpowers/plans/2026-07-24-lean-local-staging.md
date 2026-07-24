# Lean Local Staging Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the completed venue-browsing slice through a reproducible local staging stack and let the production Mini Program build target that real API without hand-editing generated files.

**Architecture:** Docker Compose runs PostgreSQL, the existing FastAPI app, and Caddy as a small staging-shaped stack. FastAPI exposes an immutable revision header, a focused verifier checks the real venue/availability journey, and the Mini Program builder accepts an explicit production API URL while keeping the checked-in placeholder safe. Remote Alibaba deployment, partner-approved content, physical-device goldens, and the full performance/CI matrix remain deferred until their credentials and inputs exist.

**Tech Stack:** Docker Compose, Caddy, FastAPI, PostgreSQL 17, pytest, Node.js test runner, native WeChat Mini Program build.

---

## Chunk 1: Revision and deploy configuration

### Task 1: Add application revision response metadata

**Files:**
- Modify: `backend/app/config.py`
- Modify: `backend/app/request_id.py`
- Modify: `backend/tests/test_health.py`

- [ ] Write a failing health test asserting `X-App-Revision` uses injected settings.
- [ ] Run `uv run pytest backend/tests/test_health.py -q` and confirm the missing header failure.
- [ ] Add `app_revision` with local default `development`, inject settings into middleware, and emit the header on every response.
- [ ] Re-run the focused test and commit.

### Task 2: Add a safe production API build override

**Files:**
- Modify: `scripts/build-miniprogram.mjs`
- Modify: `tests/build-miniprogram.test.mjs`
- Modify: `deploy/README.md`

- [ ] Write a failing build test proving `MINIPROGRAM_API_BASE_URL` changes only the production output and rejects non-HTTP(S) values.
- [ ] Run the focused Node test and confirm the expected failure.
- [ ] Generate the production runtime config with the validated override; leave development behavior and the checked-in placeholder unchanged.
- [ ] Re-run the focused test and commit.

## Chunk 2: Local staging stack and verification

### Task 3: Add focused deployment preflight

**Files:**
- Create: `scripts/preflight_deploy.py`
- Create: `backend/tests/test_deploy_preflight.py`
- Create: `deploy/.env.example`

- [ ] Write failing tests for validation sentinels, malformed public URL, and a valid local staging environment.
- [ ] Run the tests and confirm the module-missing failure.
- [ ] Implement a small env-file parser and validation result/CLI without adding dependencies.
- [ ] Re-run the focused tests and commit.

### Task 4: Add the reproducible local staging stack

**Files:**
- Create: `backend/Dockerfile`
- Create: `compose.yaml`
- Create: `deploy/Caddyfile`
- Modify: `deploy/README.md`

- [ ] Add Compose config expectations to the deploy preflight tests and confirm they fail before the files exist.
- [ ] Create PostgreSQL, FastAPI, and Caddy services with health checks, migration-before-start, persistent local data, and explicit environment wiring.
- [ ] Run `docker compose config --quiet`, build/start the stack with a temporary valid env file, migrate and seed it, then verify health through Caddy.
- [ ] Commit the deployment skeleton.

### Task 5: Verify the real venue journey

**Files:**
- Create: `scripts/verify_staging.py`
- Create: `backend/tests/test_verify_staging.py`
- Modify: `deploy/README.md`

- [ ] Write failing tests for a successful real-shape response, a missing venue field, incomplete 14-day date coverage, and revision mismatch.
- [ ] Run the tests and confirm the verifier is missing.
- [ ] Implement a dependency-free verifier for health, primary venue, and both pitch types across today through day 13; optionally write its JSON report.
- [ ] Re-run focused tests.
- [ ] Run the verifier against the local Caddy endpoint and commit.

## Chunk 3: Runtime handoff checkpoint

### Task 6: Produce and inspect the local HTTP Mini Program demo

**Files:**
- Generated only: `dist/miniprogram-production/`

- [ ] Build with `MINIPROGRAM_API_BASE_URL` pointing at the local staging endpoint.
- [ ] Audit the production package and verify it contains no Fixture/Scenario source.
- [ ] Run only the focused TypeScript/build/backend checks relevant to this delta.
- [ ] Open the production build in WeChat Developer Tools and inspect the venue and availability journey against real HTTP data.
- [ ] Stop for user review; do not begin the booking slice.

## Explicitly deferred

- Alibaba Cloud publishing, DNS, trusted HTTPS certificate, and Mini Program console domain configuration.
- Partner-confirmed venue content and signed content-approval hashes.
- iOS/Android physical-device golden matrix and canonical baseline promotion.
- 100-sample P95 performance gate and full CI workflow.

