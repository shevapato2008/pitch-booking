# Foundation and Venue Browsing Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a deployable WeChat Mini Program slice where a guest opens the app, views the primary venue, selects a pitch type and date, and sees truthful availability from a FastAPI/PostgreSQL staging backend.

**Architecture:** Build only the shared foundation required by this journey: native WXML/WXSS/TypeScript pages behind narrow runtime interfaces, an OpenAPI-first HTTP boundary, and a FastAPI modular monolith backed by PostgreSQL. Design truth lives in the WeChat runtime; contract-derived data Fixtures and Scenario-only fault injection are development inputs and are excluded from the production package.

**Tech Stack:** Native WeChat Mini Program, TypeScript, Jest, official `miniprogram-automator`, OpenAPI 3.1, Python 3.13, uv, FastAPI, Pydantic v2, SQLAlchemy 2, Alembic, PostgreSQL 17, pytest, Docker Compose, Caddy.

**Approved spec:** `docs/superpowers/specs/2026-07-22-pitch-booking-foundation-and-venue-browsing-design.md`

**Execution prerequisites:** Restore write access to `.git` before execution so the required worktree and commits can be created. Install the stable WeChat Developer Tools on the Mac and supply a development Mini Program AppID in the ignored `project.private.config.json`; do not commit credentials or production domain values.

---

## File map

The repository is greenfield. Create focused files with these responsibilities:

```text
artifacts/ui/
  design-system/tokens.json             reviewable visual tokens
  screen-manifest/venue-browsing.yaml   screens, states, scenarios, goldens, acceptance IDs
  fixtures/*.json                       schema-valid success/empty data only
  scenarios/*.yaml                      clocks, HTTP behavior, native/media faults, user actions
  golden/README.md                      capture rules and metadata requirements
contracts/
  openapi.yaml                          HTTP contract source of truth
  examples/*.json                       canonical schema-valid responses/errors
miniprogram/
  app.{ts,json,wxss}                    production entry and global style
  config/runtime.ts                     environment API configuration
  domain/{contracts,decoders}.ts         API types and strict boundary validation
  runtime/interfaces.ts                 Clock/Transport/NativeCapabilities/MediaSourceResolver
  runtime/production.ts                 production bindings only
  services/{venue,availability}.ts       page-facing service boundaries
  components/*                          stateless native UI components
  pages/{venue,availability}/*           page composition and state machines
  dev/{bootstrap,fixture-transport}.ts   development-only bindings
  dev/ui-gallery/*                       component/state gallery
  dev/scenario-runner/*                  deterministic scenario entry
pyproject.toml                           locked Python dependencies and commands
compose.yaml                             API/PostgreSQL/Caddy staging stack
backend/
  app/{main,config,database,errors}.py   application foundation
  app/modules/venues/*                   venue persistence/query/API
  app/modules/availability/*             slot persistence/projection/query/API
  migrations/*                           PostgreSQL schema
  tests/*                                unit, API, DB, contract and seed tests
deploy/
  Caddyfile                              HTTPS reverse proxy
scripts/
  validate-contract.mjs                 OpenAPI/example validation
  generate-fixtures.mjs                 success/empty example projection
  build-miniprogram.mjs                  production/dev entry assembly
  audit-production-package.mjs           dev/Fixture exclusion gate
  seed_demo.py                           idempotent non-production demo data
  verify_staging.py                      health, contract and latency checks
tests/
  structure.test.mjs                     repository/build boundary checks
```

## Chunk 1: Minimal foundation and executable contracts

### Task 1: Establish the greenfield repository and production/dev build boundary

**Files:**
- Modify: `.gitignore`
- Create: `.editorconfig`
- Create: `README.md`
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `jest.config.cjs`
- Create: `eslint.config.js`
- Create: `project.config.json`
- Create: `project.private.config.json.example`
- Create: `miniprogram/app.ts`
- Create: `miniprogram/app.json`
- Create: `miniprogram/app.wxss`
- Create: `miniprogram/sitemap.json`
- Create: `miniprogram/config/runtime.ts`
- Create: `miniprogram/pages/venue/index.ts`
- Create: `miniprogram/pages/venue/index.json`
- Create: `miniprogram/pages/venue/index.wxml`
- Create: `miniprogram/pages/venue/index.wxss`
- Create: `miniprogram/pages/availability/index.ts`
- Create: `miniprogram/pages/availability/index.json`
- Create: `miniprogram/pages/availability/index.wxml`
- Create: `miniprogram/pages/availability/index.wxss`
- Create: `miniprogram/dev/bootstrap.ts`
- Create: `artifacts/ui/README.md`
- Create: `contracts/README.md`
- Create: `backend/README.md`
- Create: `deploy/README.md`
- Create: `scripts/build-miniprogram.mjs`
- Create: `scripts/audit-production-package.mjs`
- Create: `tests/structure.test.mjs`

- [ ] **Step 1: Write the failing structure and build-boundary test**

```js
// tests/structure.test.mjs
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

test("production app registers no development pages", () => {
  const app = JSON.parse(readFileSync("miniprogram/app.json", "utf8"));
  assert.deepEqual(app.pages, ["pages/venue/index", "pages/availability/index"]);
  assert.equal(app.pages.some((page) => page.startsWith("dev/")), false);
});

test("required roots exist", () => {
  for (const path of ["artifacts/ui", "contracts", "miniprogram", "backend", "deploy"])
    assert.equal(existsSync(path), true, `missing ${path}`);
});

test("every production route has four native page files", () => {
  const app = JSON.parse(readFileSync("miniprogram/app.json", "utf8"));
  for (const route of app.pages)
    for (const ext of ["ts", "json", "wxml", "wxss"])
      assert.equal(existsSync(`miniprogram/${route}.${ext}`), true);
});
```

- [ ] **Step 2: Run the test and verify it fails before scaffolding**

Run: `node --test tests/structure.test.mjs`

Expected: FAIL with a missing `miniprogram/app.json` or required directory.

- [ ] **Step 3: Create the minimal package and project configuration**

Use this package surface and let `npm install` write exact versions to `package-lock.json`:

```json
{
  "name": "pitch-booking",
  "private": true,
  "type": "module",
  "scripts": {
    "lint": "eslint .",
    "test:structure": "node --test tests/structure.test.mjs",
    "test:unit": "jest --runInBand --passWithNoTests",
    "test": "node --test tests/*.test.mjs && jest --runInBand --passWithNoTests",
    "typecheck": "tsc --noEmit",
    "contract:validate": "node scripts/validate-contract.mjs",
    "fixtures:generate": "node scripts/generate-fixtures.mjs",
    "build:miniprogram:production": "node scripts/build-miniprogram.mjs production",
    "build:miniprogram:development": "node scripts/build-miniprogram.mjs development",
    "audit:miniprogram-package": "node scripts/audit-production-package.mjs dist/miniprogram-production"
  }
}
```

Run:

```bash
npm install --save-dev typescript jest ts-jest @types/jest miniprogram-api-typings yaml @apidevtools/swagger-parser openapi-typescript ajv ajv-formats eslint typescript-eslint
```

Create `project.config.json` with `miniprogramRoot: "dist/miniprogram-development/"`, an empty non-secret `appid`, `compileType: "miniprogram"`, and TypeScript/ES6 post-processing enabled. Put the real AppID only in ignored `project.private.config.json`, documented by the example file. `miniprogram/config/runtime.ts` exports the checked-in non-secret staging placeholder `https://staging-api.pitch-booking.example`; Task 14 replaces it with the provisioned HTTPS domain before staging verification. The two initial pages render only an honest `加载中…` state and are replaced by Tasks 8–9.

- [ ] **Step 4: Implement explicit production and development assembly**

`scripts/build-miniprogram.mjs` must:

1. reject any mode except `production|development`;
2. recreate only `dist/miniprogram-production` or `dist/miniprogram-development` selected by mode (never a broad path);
3. copy shared production files;
4. copy `miniprogram/dev` and generate an app manifest containing dev routes only in development mode;
5. leave production `app.json` containing exactly the two business routes;
6. never embed secrets; read the API base URL from an environment-specific checked-in non-secret config placeholder.

`scripts/audit-production-package.mjs` recursively scans its explicit directory argument and fails on a `dev` path, `.dev-generated`, `fixture` (case-insensitive), `FIXTURE_MODE`, Scenario stub class names, or a development route. It also asserts both production routes and their four compiled files exist. The build transpiles `.ts` to `.js`; copied output must not contain `.ts` page files.

Minimum production manifest:

```json
{
  "pages": ["pages/venue/index", "pages/availability/index"],
  "window": {
    "navigationBarTitleText": "球场预订",
    "navigationBarBackgroundColor": "#F8FAFC",
    "navigationBarTextStyle": "black",
    "backgroundColor": "#F8FAFC"
  },
  "sitemapLocation": "sitemap.json"
}
```

- [ ] **Step 5: Run the structure test and both assembly modes**

Run:

```bash
npm run test:structure
npm run lint
npm run typecheck
npm test
npm run build:miniprogram:production
npm run audit:miniprogram-package
npm run build:miniprogram:development
```

Expected: all checks PASS; production audit reports `0 forbidden paths/tokens`; `dist/miniprogram-production/dev` is absent; `dist/miniprogram-development/dev/bootstrap.js` exists; the separate output roots preserve both results for inspection.

- [ ] **Step 6: Commit the scaffold**

```bash
git add .gitignore .editorconfig README.md package.json package-lock.json tsconfig.json jest.config.cjs eslint.config.js project.config.json project.private.config.json.example miniprogram artifacts/ui/README.md contracts/README.md backend/README.md deploy/README.md scripts/build-miniprogram.mjs scripts/audit-production-package.mjs tests/structure.test.mjs
git commit -m "chore: scaffold mini program workspace"
```

### Task 2: Make the OpenAPI contract and examples executable

**Files:**
- Create: `contracts/openapi.yaml`
- Create: `contracts/examples/venue-primary.json`
- Create: `contracts/examples/availability-ready.json`
- Create: `contracts/examples/availability-empty.json`
- Create: `contracts/examples/error-invalid-argument.json`
- Create: `contracts/examples/error-pitch-type-not-supported.json`
- Create: `contracts/examples/error-date-out-of-range.json`
- Create: `contracts/examples/error-venue-not-found.json`
- Create: `contracts/examples/error-service-unavailable.json`
- Create: `contracts/examples/error-internal.json`
- Create: `contracts/examples/error-primary-venue-misconfigured.json`
- Create: `scripts/validate-contract.mjs`
- Create: `scripts/generate-fixtures.mjs`
- Create: `tests/contract.test.mjs`

- [ ] **Step 1: Write failing contract tests**

```js
// tests/contract.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import SwaggerParser from "@apidevtools/swagger-parser";

test("contract exposes only first-slice endpoints", async () => {
  const api = await SwaggerParser.validate("contracts/openapi.yaml");
  assert.deepEqual(Object.keys(api.paths).sort(), [
    "/api/v1/health",
    "/api/v1/venues/primary",
    "/api/v1/venues/{venue_id}/availability"
  ]);
});

test("examples contain stable IDs and no placeholder copy", () => {
  const venue = JSON.parse(readFileSync("contracts/examples/venue-primary.json", "utf8"));
  assert.match(venue.id, /^[0-9a-f-]{36}$/);
  const serialized = JSON.stringify(venue);
  for (const placeholder of ["TODO", "TBD", "待配置", "\"string\""])
    assert.equal(serialized.includes(placeholder), false, `placeholder: ${placeholder}`);
});

test("all required error branches use the wrapped envelope", () => {
  const names = [
    "invalid-argument", "pitch-type-not-supported", "date-out-of-range",
    "venue-not-found", "service-unavailable", "internal",
    "primary-venue-misconfigured"
  ];
  const codes = names.map((name) => {
    const body = JSON.parse(readFileSync(`contracts/examples/error-${name}.json`, "utf8"));
    assert.deepEqual(Object.keys(body), ["error"]);
    assert.deepEqual(Object.keys(body.error).sort(), ["code", "details", "message", "request_id"]);
    assert.equal(typeof body.error.details, "object");
    return body.error.code;
  });
  assert.deepEqual(codes, [
    "INVALID_ARGUMENT", "PITCH_TYPE_NOT_SUPPORTED", "DATE_OUT_OF_RANGE",
    "VENUE_NOT_FOUND", "SERVICE_UNAVAILABLE", "INTERNAL_ERROR",
    "PRIMARY_VENUE_MISCONFIGURED"
  ]);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test tests/contract.test.mjs`

Expected: FAIL because `contracts/openapi.yaml` does not exist.

- [ ] **Step 3: Define the exact OpenAPI schemas and examples**

Implement the three endpoints and DTOs from spec sections 6.1–6.2. Every object schema must set `additionalProperties: false`; declare all required fields explicitly; use integer cents, RFC 3339 timestamps with `+08:00`, UUIDs, HTTPS image URLs, and these exact public states:

```yaml
SlotStatus:
  type: string
  enum: [AVAILABLE, TEMPORARILY_LOCKED, BOOKED, CLOSED, EXPIRED]
```

The primary venue example must have exactly one `COVER`, valid coordinates, non-empty venue policy/contact content, and both pitch types. The ready availability example must cover all five contract-allowed display states—`AVAILABLE`, `TEMPORARILY_LOCKED`, `BOOKED`, `CLOSED`, and projected `EXPIRED`—so its generated Fixture exercises every Gallery state; the empty example must contain an empty `pitches` array with otherwise valid date metadata. Every error uses the exact wrapper `{error: {code, message, request_id, details}}`; `details` is always an object. Provide examples for `INVALID_ARGUMENT`, `PITCH_TYPE_NOT_SUPPORTED`, `DATE_OUT_OF_RANGE`, `VENUE_NOT_FOUND`, `SERVICE_UNAVAILABLE`, `INTERNAL_ERROR`, and `PRIMARY_VENUE_MISCONFIGURED`, and assert each is attached to its specified response/status in OpenAPI.

- [ ] **Step 4: Implement validation and Fixture generation**

`scripts/validate-contract.mjs` uses Swagger Parser to validate/dereference OpenAPI, then Ajv 2020 plus `ajv-formats` to validate every JSON example against the response schema selected by an explicit filename-to-operation/status map. It fails if the seven required error codes are not all covered. `scripts/generate-fixtures.mjs` must accept only the three success/empty example names and copy normalized output to:

```text
artifacts/ui/fixtures/venue-ready.json
artifacts/ui/fixtures/slots-ready.json
artifacts/ui/fixtures/slots-empty.json
```

It must reject error examples so transport failures cannot become data Fixtures.

- [ ] **Step 5: Run validation and prove error examples cannot become Fixtures**

Run:

```bash
npm run contract:validate
npm run fixtures:generate
node --test tests/contract.test.mjs
node scripts/generate-fixtures.mjs contracts/examples/error-service-unavailable.json
```

Expected: first three commands PASS; final command exits non-zero with `error responses belong in scenarios`.

- [ ] **Step 6: Commit the executable contract**

```bash
git add contracts artifacts/ui/fixtures scripts/validate-contract.mjs scripts/generate-fixtures.mjs tests/contract.test.mjs package.json package-lock.json
git commit -m "feat: define venue browsing API contract"
```

### Task 3: Add strict Mini Program boundary decoders

**Files:**
- Create: `miniprogram/domain/contracts.ts`
- Create: `miniprogram/domain/decoder-primitives.ts`
- Create: `miniprogram/domain/decoders.ts`
- Create: `miniprogram/domain/decoders.test.ts`
- Create: `miniprogram/services/venue.ts`
- Create: `miniprogram/services/availability.ts`

- [ ] **Step 1: Write failing decoder tests for valid and corrupt responses**

```ts
import venue from "../../contracts/examples/venue-primary.json";
import ready from "../../contracts/examples/availability-ready.json";
import { decodeAvailability, decodeVenue } from "./decoders";

test("decodes canonical responses", () => {
  expect(decodeVenue(venue).id).toBe(venue.id);
  expect(decodeAvailability(ready).pitchGroups.length).toBeGreaterThan(0);
});

const firstSlot = ready.pitches[0].slots[0];
const withSlot = (slot: object) => ({
  ...ready,
  pitches: [{ ...ready.pitches[0], slots: [slot] }]
});

test.each([
  ["unknown key", { ...ready, unexpected: true }],
  ["missing field", (({ generated_at: _, ...rest }) => rest)(ready)],
  ["bad UUID", { ...ready, venue_id: "not-a-uuid" }],
  ["unknown status", withSlot({ ...firstSlot, status: "UNKNOWN" })],
  ["fractional price", withSlot({ ...firstSlot, price_cents: 1.5 })],
  ["reversed time", withSlot({ ...firstSlot, starts_at: firstSlot.ends_at, ends_at: firstSlot.starts_at })],
  ["wrong reason", withSlot({ ...firstSlot, status: "BOOKED", unavailable_reason: null })]
])("rejects corrupt availability: %s", (_name, value) => {
  expect(() => decodeAvailability(value)).toThrow("INVALID_API_RESPONSE");
});

test.each([
  ["unknown venue key", { ...venue, unexpected: true }],
  ["missing cover", { ...venue, images: venue.images.filter((image) => image.role !== "COVER") }],
  ["non-HTTPS image", { ...venue, images: [{ ...venue.images[0], url: "http://unsafe.test/a.jpg" }] }],
  ["bad generated timestamp", { ...venue, generated_at: "22 July" }]
])("rejects corrupt venue: %s", (_name, value) => {
  expect(() => decodeVenue(value)).toThrow("INVALID_API_RESPONSE");
});
```

- [ ] **Step 2: Run the decoder tests and verify they fail**

Run: `npm run test:unit -- miniprogram/domain/decoders.test.ts`

Expected: FAIL because decoder modules do not exist.

- [ ] **Step 3: Implement focused DTOs and strict decoders**

Export camel-case view-safe DTOs plus `ApiResponseError`. Keep reusable object/key/string/number/UUID/URL/date guards in `decoder-primitives.ts` and response composition in `decoders.ts`; neither file should exceed 250 lines. Decoder helpers must verify object shape, reject unknown/missing keys, validate UUID/HTTPS/integer/enum/RFC 3339 values, enforce `starts_at < ends_at`, exactly one `COVER`, and the exact status-to-`unavailable_reason` correlation. Decode the full response before returning any data. Do not add auth, order, or payment types.

```ts
export class ApiResponseError extends Error {
  readonly code = "INVALID_API_RESPONSE";
  constructor(readonly path: string) {
    super(`INVALID_API_RESPONSE at ${path}`);
  }
}

export type SlotStatus =
  | "AVAILABLE"
  | "TEMPORARILY_LOCKED"
  | "BOOKED"
  | "CLOSED"
  | "EXPIRED";
```

Define page-facing interfaces only:

```ts
export interface VenueService { getPrimary(): Promise<Venue>; }
export interface AvailabilityService {
  get(venueId: string, pitchType: PitchType, date: string): Promise<Availability>;
}
```

- [ ] **Step 4: Run decoder tests and type checking**

Run:

```bash
npm run test:unit -- miniprogram/domain/decoders.test.ts
npm run typecheck
```

Expected: PASS with no TypeScript diagnostics.

- [ ] **Step 5: Commit the client boundary**

```bash
git add miniprogram/domain miniprogram/services tsconfig.json jest.config.cjs
git commit -m "feat: validate mini program API responses"
```

### Task 4: Implement deterministic runtime and Scenario interfaces

**Files:**
- Create: `miniprogram/runtime/interfaces.ts`
- Create: `miniprogram/runtime/production.ts`
- Create: `miniprogram/runtime/scenario.ts`
- Create: `miniprogram/runtime/scenario.test.ts`
- Create: `miniprogram/dev/fixture-transport.ts`
- Create: `artifacts/ui/scenarios/venue-ready.yaml`
- Create: `artifacts/ui/scenarios/venue-first-load-error.yaml`
- Create: `artifacts/ui/scenarios/venue-image-failure.yaml`
- Create: `artifacts/ui/scenarios/venue-map-error.yaml`
- Create: `artifacts/ui/scenarios/venue-phone-error.yaml`
- Create: `artifacts/ui/scenarios/slots-ready.yaml`
- Create: `artifacts/ui/scenarios/slots-empty.yaml`
- Create: `artifacts/ui/scenarios/slots-first-load-error.yaml`
- Create: `artifacts/ui/scenarios/slots-refresh-error.yaml`
- Create: `artifacts/ui/scenarios/slots-selected.yaml`
- Create: `artifacts/ui/scenarios/slots-late-response.yaml`

- [ ] **Step 1: Write failing tests for all four injected boundaries**

```ts
import { existsSync, readdirSync } from "node:fs";
import {
  assertMissingImageSentinel, loadScenarioForTest, parseScenario,
  scenarioBehaviorSignature, scenarioRuntime
} from "./scenario";

const fixture = (name: string) => ({ fixture: name });
const base = { id: "base", clock: "2026-07-22T10:30:00+08:00" };
const slotsReady = { ...base, http: [{ match: {}, ...fixture("slots-ready") }], native: { open_location: "success", make_phone_call: "success" } };
const slotsLateResponse = { ...base, http: [
  { match: { date: "2026-07-22" }, ...fixture("slots-ready"), delay_ms: 1200 },
  { match: { date: "2026-07-23" }, ...fixture("slots-empty"), delay_ms: 100 }
] };
const slotsSelected = { ...base, http: [{ match: {}, ...fixture("slots-ready") }], actions: [{ type: "tap", target: "slot", id: "00000000-0000-4000-8000-000000000201" }] };
const venueFirstLoadError = { ...base, http: [{ match: {}, error: "SERVICE_UNAVAILABLE" }] };
const venueImageFailure = { ...base, http: [{ match: {}, ...fixture("venue-ready") }], media: { fail_image_roles: ["COVER"] } };
const venueMapError = { ...base, http: [{ match: {}, ...fixture("venue-ready") }], native: { open_location: "failure", make_phone_call: "success" } };
const venuePhoneError = { ...base, http: [{ match: {}, ...fixture("venue-ready") }], native: { open_location: "success", make_phone_call: "failure" } };

test("uses the fixed Asia/Shanghai instant", () => {
  const runtime = scenarioRuntime(slotsReady);
  expect(runtime.clock.now().toISOString()).toBe("2026-07-22T02:30:00.000Z");
});

test("late responses preserve configured completion order", async () => {
  const runtime = scenarioRuntime(slotsLateResponse);
  const first = runtime.transport.get("/availability?date=2026-07-22");
  const second = runtime.transport.get("/availability?date=2026-07-23");
  await expect(second).resolves.toMatchObject({ pitches: [] });
  await expect(first).resolves.toMatchObject({ pitches: expect.any(Array) });
});

test("image failure uses a guaranteed absent local source", () => {
  const runtime = scenarioRuntime(venueImageFailure);
  expect(runtime.media.resolve("COVER", "https://example.test/cover.jpg"))
    .toBe("/_scenario_missing_/venue-cover.png");
});

test("injects map failure", async () => {
  const native = scenarioRuntime(venueMapError).native;
  await expect(native.openLocation({ latitude: 39, longitude: 117, name: "球场", address: "天津" }))
    .rejects.toMatchObject({ code: "MAP_UNAVAILABLE" });
});

test("injects phone failure", async () => {
  const native = scenarioRuntime(venuePhoneError).native;
  await expect(native.makePhoneCall("02212345678"))
    .rejects.toMatchObject({ code: "PHONE_UNAVAILABLE" });
});

test("passes through configured native success", async () => {
  const native = scenarioRuntime(slotsReady).native;
  await expect(native.openLocation({ latitude: 39, longitude: 117, name: "球场", address: "天津" }))
    .resolves.toBeUndefined();
  await expect(native.makePhoneCall("02212345678")).resolves.toBeUndefined();
});

test("injects first-load error and eight-second timeout", async () => {
  await expect(scenarioRuntime(venueFirstLoadError).transport.get("/venues/primary"))
    .rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });

  jest.useFakeTimers();
  const request = scenarioRuntime({ ...base, http: [{ match: {}, timeout_ms: 8000 }] })
    .transport.get("/availability");
  let settled = false;
  void request.then(() => { settled = true; }, () => { settled = true; });
  await jest.advanceTimersByTimeAsync(7999);
  expect(settled).toBe(false);
  await jest.advanceTimersByTimeAsync(1);
  await expect(request).rejects.toMatchObject({ code: "REQUEST_TIMEOUT" });
  jest.useRealTimers();
});

test("rejects non-allow-listed Fixtures, unknown YAML keys, and a present missing-image sentinel", () => {
  expect(() => parseScenario({ id: "bad", http: [{ fixture: "error-service-unavailable" }] }))
    .toThrow("FIXTURE_NOT_ALLOWED");
  expect(() => parseScenario({ id: "bad", mystery: true })).toThrow("UNKNOWN_SCENARIO_KEY");
  expect(() => assertMissingImageSentinel("miniprogram/app.json"))
    .toThrow("SENTINEL_MUST_NOT_EXIST");
});

test("parses explicit user actions for selected state", () => {
  expect(parseScenario(slotsSelected).actions).toEqual([
    { type: "tap", target: "slot", id: "00000000-0000-4000-8000-000000000201" }
  ]);
});

test("every checked-in Scenario parses and references allow-listed Fixtures", () => {
  const names = readdirSync("artifacts/ui/scenarios").filter((name) => name.endsWith(".yaml"));
  expect(names.sort()).toEqual([
    "slots-empty.yaml", "slots-first-load-error.yaml", "slots-late-response.yaml",
    "slots-ready.yaml", "slots-refresh-error.yaml", "slots-selected.yaml",
    "venue-first-load-error.yaml", "venue-image-failure.yaml", "venue-map-error.yaml",
    "venue-phone-error.yaml", "venue-ready.yaml"
  ]);
  for (const name of names)
    expect(() => loadScenarioForTest(`artifacts/ui/scenarios/${name}`)).not.toThrow();
  expect(existsSync("miniprogram/_scenario_missing_/venue-cover.png")).toBe(false);
});

test("every checked-in Scenario has its required behavior signature", () => {
  const expected = {
    "venue-ready": ["fixture:venue-ready"],
    "venue-first-load-error": ["error:SERVICE_UNAVAILABLE"],
    "venue-image-failure": ["fixture:venue-ready", "media-failure:COVER"],
    "venue-map-error": ["fixture:venue-ready", "native-failure:open_location"],
    "venue-phone-error": ["fixture:venue-ready", "native-failure:make_phone_call"],
    "slots-ready": ["fixture:slots-ready"],
    "slots-empty": ["fixture:slots-empty"],
    "slots-first-load-error": ["error:SERVICE_UNAVAILABLE", "timeout:8000"],
    "slots-refresh-error": ["sequence:fixture:slots-ready>error:SERVICE_UNAVAILABLE"],
    "slots-selected": ["fixture:slots-ready", "action:tap:slot:00000000-0000-4000-8000-000000000201"],
    "slots-late-response": ["fixture:slots-ready:delay:1200", "fixture:slots-empty:delay:100"]
  };
  for (const [id, signature] of Object.entries(expected)) {
    const parsed = loadScenarioForTest(`artifacts/ui/scenarios/${id}.yaml`);
    expect(scenarioBehaviorSignature(parsed)).toEqual(signature);
  }
});
```

- [ ] **Step 2: Run the Scenario test and verify it fails**

Run: `npm run test:unit -- miniprogram/runtime/scenario.test.ts`

Expected: FAIL at the import because `runtime/scenario.ts` does not exist; the unit cases use inline Scenario objects, so failure is not caused by missing YAML inputs.

- [ ] **Step 3: Implement the four narrow interfaces**

```ts
export interface Clock { now(): Date; }
export interface Transport { get<T>(path: string): Promise<T>; }
export interface NativeCapabilities {
  openLocation(input: OpenLocationInput): Promise<void>;
  makePhoneCall(phoneNumber: string): Promise<void>;
}
export interface MediaSourceResolver {
  resolve(role: "COVER" | "GALLERY", source: string): string;
}
```

Production bindings use `new Date()`, an 8-second `wx.request` wrapper, `wx.openLocation`, `wx.makePhoneCall`, and identity media resolution. Scenario bindings parse a closed YAML schema (`id`, `clock`, `http`, `native`, `media`, `actions`); an HTTP rule has exactly one of `fixture`, `error`, `timeout_ms`, or `sequence`, where `sequence` is an ordered non-empty list of those outcomes consumed once per matching request. They use a fixed clock, resolve only the three allow-listed Fixtures, inject delay/error/timeout outcomes, stub native success/failure, rewrite only configured image roles, and expose actions to the Scenario Runner. Implement `scenarioBehaviorSignature` as a test-facing normalized projection of those parsed fields. Create all eleven YAML files listed under **Files** to match the exact behavior signatures above: selected and native/media failure scenarios first load their ready Fixture; refresh failure returns `slots-ready` on the first match and `SERVICE_UNAVAILABLE` on the second; first-load failure covers service error and an 8000ms timeout using distinct match cases. Before running image failure, assert `miniprogram/_scenario_missing_/venue-cover.png` does not exist.

- [ ] **Step 4: Run Scenario tests and validate every YAML file**

Run:

```bash
npm run test:unit -- miniprogram/runtime/scenario.test.ts
npm run typecheck
```

Expected: PASS; Clock, Transport order/error/timeout, native success/failure, media rewriting, action parsing, malformed keys, Fixture allow-listing, and every YAML file are covered.

- [ ] **Step 5: Commit Scenario infrastructure**

```bash
git add miniprogram/runtime miniprogram/dev/fixture-transport.ts artifacts/ui/scenarios
git commit -m "feat: add deterministic mini program scenarios"
```

### Task 5: Record design tokens, screen manifest, and golden-image protocol

**Files:**
- Create: `artifacts/ui/design-system/tokens.json`
- Create: `artifacts/ui/screen-manifest/venue-browsing.yaml`
- Create: `artifacts/ui/flows/venue-browsing.md`
- Create: `artifacts/ui/golden/README.md`
- Create: `artifacts/ui/golden/metadata.schema.json`
- Create: `tests/artifacts.test.mjs`

- [ ] **Step 1: Write a failing Artifact integrity test**

```js
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { parse } from "yaml";

const readYaml = (path) => parse(readFileSync(path, "utf8"));
const assertFile = (path) => assert.equal(existsSync(path), true, `missing ${path}`);

test("every manifest scenario and fixture exists", () => {
  const manifest = readYaml("artifacts/ui/screen-manifest/venue-browsing.yaml");
  for (const screen of manifest.screens) {
    for (const id of screen.fixtures) assertFile(`artifacts/ui/fixtures/${id}.json`);
    for (const id of screen.scenarios) assertFile(`artifacts/ui/scenarios/${id}.yaml`);
    assert.ok(screen.acceptance.length > 0);
  }
  assert.deepEqual(manifest.screens, [
    {
      id: "venue-home", route: "pages/venue/index",
      components: ["venue-card", "state-panel"],
      states: ["loading", "ready", "first-load-error", "image-fallback", "map-error", "phone-error"],
      fixtures: ["venue-ready"],
      scenarios: ["venue-first-load-error", "venue-image-failure", "venue-map-error", "venue-phone-error"],
      goldens: ["devtools-375-ready", "devtools-390-ready", "ios-ready", "android-ready"],
      acceptance: ["VENUE-01", "VENUE-02", "VENUE-03"]
    },
    {
      id: "availability", route: "pages/availability/index",
      components: ["date-strip", "pitch-filter", "slot-grid", "state-panel"],
      states: ["loading", "ready", "selected", "empty", "first-load-error", "refreshing", "stale-error"],
      fixtures: ["slots-ready", "slots-empty"],
      scenarios: ["slots-first-load-error", "slots-refresh-error", "slots-selected", "slots-late-response"],
      goldens: ["devtools-375-ready", "devtools-390-empty", "ios-ready", "android-ready"],
      acceptance: ["SLOT-01"]
    }
  ]);
});

test("tokens contain only the approved first-slice constraints", () => {
  const tokens = JSON.parse(readFileSync("artifacts/ui/design-system/tokens.json", "utf8"));
  assert.deepEqual(tokens, {
    color: {
      brand: { trust: "#0284C7", secondary: "#0EA5E9" },
      semantic: { available: "#059669" }
    },
    typography: { systemFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" },
    spacing: { minimumInteractiveGap: 8 },
    target: { minimum: 44 }
  });
});

test("golden metadata schema requires reproducibility fields", () => {
  const schema = JSON.parse(readFileSync("artifacts/ui/golden/metadata.schema.json", "utf8"));
  assert.deepEqual(new Set(schema.required), new Set([
    "sha256", "route", "scenario", "logical_width", "device_pixel_ratio",
    "operating_system", "wechat_version", "base_library_version",
    "developer_tools_version", "commit"
  ]));
  assert.equal(schema.additionalProperties, false);
});

test("flow artifact contains only the four approved edges", () => {
  const lines = readFileSync("artifacts/ui/flows/venue-browsing.md", "utf8")
    .split("\n").filter((line) => line.includes("-->"));
  assert.deepEqual(lines, [
    "venue-home --tap \"查看可订时段\"--> availability",
    "availability --change pitch type/date--> refresh availability",
    "availability --tap AVAILABLE--> selected",
    "availability --tap selected--> unselected"
  ]);
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `node --test tests/artifacts.test.mjs`

Expected: FAIL because the manifest and token artifacts do not exist.

- [ ] **Step 3: Encode only approved first-slice design decisions**

Record only the spec-approved constraints at this stage: the three asserted semantic colors, system font family beginning with `-apple-system`, minimum 8px interactive gap, and minimum 44px target. Do not invent exact neutral colors, radius scales, shadows, dark mode, or later-slice tokens here; Chunk 2 chooses any additional component-local values through native runtime preview and records the accepted result back into this Artifact. The manifest must reproduce the exact two-screen fixture/scenario/golden/acceptance arrays in spec section 4; the test deep-compares those arrays rather than merely checking non-empty values. The flow document records only:

```text
venue-home --tap "查看可订时段"--> availability
availability --change pitch type/date--> refresh availability
availability --tap AVAILABLE--> selected
availability --tap selected--> unselected
```

The golden metadata schema requires baseline SHA-256, route, scenario, logical width, DPR, OS, WeChat version, base-library version, Developer Tools version, and generating commit.

- [ ] **Step 4: Run Artifact and contract checks**

Run:

```bash
node --test tests/artifacts.test.mjs
npm run contract:validate
```

Expected: PASS with exact token values, exact two-screen mappings, no unresolved IDs, the four approved flow edges only, and all ten required golden metadata fields.

- [ ] **Step 5: Run the complete Chunk 1 quality interface**

Run:

```bash
npm run lint
npm run typecheck
npm test
npm run build:miniprogram:production
npm run audit:miniprogram-package
```

Expected: every command exits 0; production package audit reports no development routes, Fixture data, Scenario stubs, `.dev-generated`, or TypeScript sources.

- [ ] **Step 6: Commit the reviewable Artifact index**

```bash
git add artifacts/ui/design-system artifacts/ui/screen-manifest artifacts/ui/flows artifacts/ui/golden tests/artifacts.test.mjs
git commit -m "docs: record venue browsing runtime artifacts"
```

## Chunk 2: Native runtime Artifact and complete first-slice frontend

### Task 6: Build the first-slice native component system

**Files:**
- Modify: `package.json`
- Modify: `miniprogram/app.wxss`
- Modify: `artifacts/ui/design-system/tokens.json`
- Create: `miniprogram/styles/tokens.wxss`
- Create: `scripts/generate-wxss-tokens.mjs`
- Create: `miniprogram/components/state-panel/{index.ts,index.json,index.wxml,index.wxss}`
- Create: `miniprogram/components/venue-card/{index.ts,index.json,index.wxml,index.wxss}`
- Create: `miniprogram/components/date-strip/{index.ts,index.json,index.wxml,index.wxss}`
- Create: `miniprogram/components/pitch-filter/{index.ts,index.json,index.wxml,index.wxss}`
- Create: `miniprogram/components/slot-grid/{index.ts,index.json,index.wxml,index.wxss}`
- Create: `miniprogram/components/components.test.ts`

- [ ] **Step 1: Install the official component simulator and write failing behavior tests**

Run: `npm install --save-dev miniprogram-simulate`

```ts
import simulate from "miniprogram-simulate";
import { readFileSync } from "node:fs";

const availableSlot = { id: "a", startsAt: "2026-07-22T18:00:00+08:00", endsAt: "2026-07-22T20:00:00+08:00", priceCents: 30000, status: "AVAILABLE", unavailableReason: null };
const allFiveSlots = [
  availableSlot,
  { ...availableSlot, id: "l", status: "TEMPORARILY_LOCKED", unavailableReason: "HELD_FOR_PAYMENT" },
  { ...availableSlot, id: "b", status: "BOOKED", unavailableReason: "ALREADY_BOOKED" },
  { ...availableSlot, id: "c", status: "CLOSED", unavailableReason: "VENUE_CLOSED" },
  { ...availableSlot, id: "e", status: "EXPIRED", unavailableReason: "TIME_PASSED" }
];
const venueWithCoverAndTwoGallery = {
  id: "00000000-0000-4000-8000-000000000001", name: "西青示范足球场", description: "场馆介绍",
  priceAdvantageText: "同规格更具竞争力", timezone: "Asia/Shanghai", businessHoursText: "09:00—23:00",
  address: "天津市西青区示范路 1 号", latitude: 39, longitude: 117, parkingText: "院内停车",
  phone: "02212345678", refundPolicySummary: "开场前按规则退款",
  images: [
    { url: "https://cdn.test/cover.jpg", alt: "主场地", role: "COVER", sortOrder: 0 },
    { url: "https://cdn.test/gallery-1.jpg", alt: "五人制场地", role: "GALLERY", sortOrder: 1 },
    { url: "https://cdn.test/gallery-2.jpg", alt: "七人制场地", role: "GALLERY", sortOrder: 2 }
  ],
  facilities: [{ code: "LIGHTING", name: "照明", sortOrder: 0 }],
  pitchTypes: [{ code: "FIVE_A_SIDE", name: "五人制", sortOrder: 0 }],
  availabilityWindow: { startDate: "2026-07-22", endDate: "2026-08-04" },
  generatedAt: "2026-07-22T10:30:00+08:00"
};
const readComponentWxss = (name: string) =>
  readFileSync(`miniprogram/components/${name}/index.wxss`, "utf8");

test("state-panel emits retry only when retryable", () => {
  const id = simulate.load("components/state-panel/index");
  const component = simulate.render(id, { kind: "error", message: "加载失败", retryable: true });
  const retry = jest.fn();
  component.addEventListener("retry", retry);
  component.querySelector(".state-panel__retry").dispatchEvent("tap");
  expect(retry).toHaveBeenCalledTimes(1);
});

test("slot-grid emits select for AVAILABLE only", () => {
  const id = simulate.load("components/slot-grid/index");
  const component = simulate.render(id, {
    pitches: [{ id: "pitch-1", name: "五人制 1 号场", pitchType: "FIVE_A_SIDE", sortOrder: 0, slots: allFiveSlots }],
    selectedSlotId: null,
    disabled: false
  });
  const select = jest.fn();
  component.addEventListener("selectslot", select);
  for (const slot of allFiveSlots) component.querySelector(`#slot-${slot.id}`).dispatchEvent("tap");
  expect(select.mock.calls.map(([event]) => event.detail.slotId)).toEqual([availableSlot.id]);
});

test("venue-card tracks fallback by image URL without hiding other photos", () => {
  const id = simulate.load("components/venue-card/index");
  const component = simulate.render(id, { venue: venueWithCoverAndTwoGallery, failedImageUrls: [] });
  const imageError = jest.fn();
  component.addEventListener("imageerror", imageError);
  component.querySelector("#venue-image-gallery-1").dispatchEvent("error");
  expect(imageError.mock.calls[0][0].detail.url).toBe(venueWithCoverAndTwoGallery.images[1].url);
  component.setData({ failedImageUrls: [venueWithCoverAndTwoGallery.images[1].url] });
  expect(component.querySelectorAll(".venue-card__image--fallback")).toHaveLength(1);
  component.setData({ failedImageUrls: venueWithCoverAndTwoGallery.images.map((image) => image.url) });
  expect(component.querySelectorAll(".venue-card__image--fallback")).toHaveLength(3);
  expect(component.querySelector(".venue-card__content")).not.toBeNull();
});

test("all controls expose state and minimum hit-area classes", () => {
  for (const componentPath of ["date-strip", "pitch-filter", "slot-grid"])
    expect(readComponentWxss(componentPath)).toMatch(/min-height:\s*88rpx/);
});
```

- [ ] **Step 2: Run component tests and verify they fail**

Run: `npm run test:unit -- miniprogram/components/components.test.ts`

Expected: FAIL because the five native components do not exist.

- [ ] **Step 3: Use @ui-ux-pro-max and native preview to choose component-local visual values**

Read and apply `@ui-ux-pro-max` before making visual choices. Preserve the approved trust/secondary/available colors, system font, 44px target, 8px minimum gap, soft flat style, white cards and deep body text. Choose only the neutral colors, radii, spacing scale, and subtle/no-shadow treatment needed by these five components; record the chosen values in `tokens.json`, generate the matching `tokens.wxss`, and add exact-value assertions to `tests/artifacts.test.mjs`. Do not use a browser screenshot as the acceptance source.

- [ ] **Step 4: Implement five stateless native components**

Component contracts:

```ts
// state-panel: properties kind/message/retryable; event retry
// venue-card: properties venue/failedImageUrls; events openmap/callphone/openavailability/imageerror(url)
// date-strip: properties dates/selectedDate/disabled; event changedate
// pitch-filter: properties pitchTypes/selectedPitchType/disabled; event changepitchtype
// slot-grid: properties pitches/selectedSlotId/disabled; event selectslot
```

`venue-card` renders the exactly one COVER as the hero and every ordered GALLERY image in a horizontal photo strip, all with `mode="aspectFill"`, per-image `binderror` fallback, retained `aria-label`/alt copy, and stable keys. It also renders price advantage, address, hours, parking, facilities, policy summary, map/phone actions, and “查看可订时段”; one or all image failures never hide textual content or the availability action. `date-strip` presents all 14 inclusive dates in a horizontal `scroll-view`. `slot-grid` groups by physical pitch, shows local start/end time, formats integer cents, exposes the five Chinese status labels, and never emits selection for unavailable states or while disabled. Components receive already-decoded data and never call services.

- [ ] **Step 5: Generate styles and run component verification**

Run:

```bash
node scripts/generate-wxss-tokens.mjs
npm run test:unit -- miniprogram/components/components.test.ts
npm run typecheck
node --test tests/artifacts.test.mjs
```

Expected: PASS; generated WXSS exactly matches token JSON; all five states render; grouped pitch contract is exercised; only `AVAILABLE` emits; one-image/all-image fallback keeps content; interactive selectors have at least `88rpx` minimum dimension.

- [ ] **Step 6: Commit the component Artifact**

```bash
git add package.json package-lock.json artifacts/ui/design-system miniprogram/app.wxss miniprogram/styles miniprogram/components scripts/generate-wxss-tokens.mjs tests/artifacts.test.mjs
git commit -m "feat: build venue browsing native components"
```

### Task 7: Make every UI state inspectable in the WeChat runtime

**Files:**
- Modify: `scripts/build-miniprogram.mjs`
- Modify: `miniprogram/dev/bootstrap.ts`
- Create: `miniprogram/dev/ui-gallery/index.ts`
- Create: `miniprogram/dev/ui-gallery/index.json`
- Create: `miniprogram/dev/ui-gallery/index.wxml`
- Create: `miniprogram/dev/ui-gallery/index.wxss`
- Create: `miniprogram/dev/scenario-runner/index.ts`
- Create: `miniprogram/dev/scenario-runner/index.json`
- Create: `miniprogram/dev/scenario-runner/index.wxml`
- Create: `miniprogram/dev/scenario-runner/index.wxss`
- Create: `miniprogram/dev/dev-entry.test.ts`

- [ ] **Step 1: Write failing tests for manifest-driven development entries**

```ts
test("gallery lists every manifest state", () => {
  const gallery = buildGalleryModel(manifest, fixtures);
  expect(gallery.screenIds).toEqual(["venue-home", "availability"]);
  expect(gallery.stateIds).toEqual(expect.arrayContaining([
    "loading", "ready", "first-load-error", "image-fallback", "map-error",
    "phone-error", "selected", "empty", "refreshing", "stale-error"
  ]));
});

test("runner accepts only a manifest-listed scenario", () => {
  expect(() => selectScenario("venue-home", "slots-ready")).toThrow("SCENARIO_NOT_ALLOWED_FOR_SCREEN");
  expect(selectScenario("availability", "slots-selected").id).toBe("slots-selected");
});
```

- [ ] **Step 2: Run the dev-entry test and verify it fails**

Run: `npm run test:unit -- miniprogram/dev/dev-entry.test.ts`

Expected: FAIL because the gallery/runner entry models do not exist.

- [ ] **Step 3: Implement the Gallery and Scenario Runner**

Development manifest routes must be ordered before business routes:

```json
[
  "dev/ui-gallery/index",
  "dev/scenario-runner/index",
  "pages/venue/index",
  "pages/availability/index"
]
```

The Gallery renders each component with every Screen Manifest state and labels the current fixture/state. The Runner accepts `screen` and `scenario` query parameters, binds the four Scenario interfaces, executes declared actions only after the screen reaches `ready`, and displays a persistent development-only banner containing scenario ID and fixed clock. It must reject missing/unknown/disallowed IDs instead of silently defaulting.

- [ ] **Step 4: Inspect the component Artifact in the native runtime**

Build development mode, open `dev/ui-gallery/index` in WeChat Developer Tools at 375px and 390px, and inspect every manifest state, text wrapping, capsule safe area, one/all image fallbacks, gallery ordering, accessibility labels, and tap targets. Save an inspection report under the ignored run-evidence directory and update component-local tokens until both widths pass. This is an engineering review, not the user’s final stage checkpoint and not canonical golden acceptance.

After any inspection-driven token/component/style change, rerun:

```bash
node scripts/generate-wxss-tokens.mjs
npm run test:unit -- miniprogram/components/components.test.ts miniprogram/dev/dev-entry.test.ts
node --test tests/artifacts.test.mjs
npm run typecheck
```

Expected: all commands PASS and a second native inspection confirms the change at both widths.

- [ ] **Step 5: Verify development and production isolation**

Run:

```bash
npm run test:unit -- miniprogram/dev/dev-entry.test.ts
npm run build:miniprogram:development
test -f dist/miniprogram-development/dev/ui-gallery/index.js
test -f dist/miniprogram-development/dev/scenario-runner/index.js
npm run build:miniprogram:production
npm run audit:miniprogram-package
```

Expected: tests PASS; both dev entries exist only in the development output; production audit reports zero forbidden paths/tokens.

- [ ] **Step 6: Commit development preview entries**

```bash
git add scripts/build-miniprogram.mjs scripts/generate-wxss-tokens.mjs miniprogram/dev miniprogram/components miniprogram/styles artifacts/ui/design-system/tokens.json tests/artifacts.test.mjs
git commit -m "feat: add native UI gallery and scenario runner"
```

### Task 8: Implement the primary venue page as a tested state machine

**Files:**
- Modify: `miniprogram/pages/venue/index.ts`
- Modify: `miniprogram/pages/venue/index.json`
- Modify: `miniprogram/pages/venue/index.wxml`
- Modify: `miniprogram/pages/venue/index.wxss`
- Modify: `miniprogram/services/venue.ts`
- Modify: `miniprogram/services/availability.ts`
- Create: `miniprogram/services/http-services.test.ts`
- Create: `miniprogram/pages/venue/controller.ts`
- Create: `miniprogram/pages/venue/controller.test.ts`

- [ ] **Step 1: Write failing venue controller tests**

```ts
test("loads the primary venue and ignores a stale response", async () => {
  const { controller, requests } = venueHarness();
  const first = controller.load();
  const second = controller.load();
  requests[1].resolve(venue);
  await second;
  requests[0].resolve(olderVenue);
  await first;
  expect(controller.state).toMatchObject({ kind: "ready", venue });
});

test("first load error is retryable without fake content", async () => {
  const { controller, rejectNext } = venueHarness();
  rejectNext({ code: "SERVICE_UNAVAILABLE", requestId: "req-1" });
  await controller.load();
  expect(controller.state).toEqual({ kind: "first-load-error", message: "服务暂时不可用，请重试", requestId: "req-1" });
  expect(controller.state).not.toHaveProperty("venue");
});

test("map and phone failures preserve ready content and expose a toast message", async () => {
  const { controller, native } = loadedVenueHarness();
  native.openLocation.mockRejectedValue({ code: "MAP_UNAVAILABLE" });
  await controller.openMap();
  expect(controller.state.kind).toBe("ready");
  expect(controller.effect).toEqual({ type: "toast", message: "暂时无法打开地图" });
});

test("image failures are tracked independently by URL", async () => {
  const { controller } = loadedVenueHarness();
  controller.imageFailed(venue.images[1].url);
  expect(controller.state).toMatchObject({ failedImageUrls: [venue.images[1].url] });
  controller.imageFailed(venue.images[2].url);
  controller.imageFailed(venue.images[1].url);
  expect(controller.state).toMatchObject({ failedImageUrls: [venue.images[1].url, venue.images[2].url] });
});
```

Add boundary tests proving concrete services compose the configured production Transport and strict decoders:

```ts
test("HTTP venue service requests only the primary endpoint and decodes before returning", async () => {
  const transport = stubTransport(venueWireBody);
  await expect(new HttpVenueService(transport).getPrimary()).resolves.toEqual(decodedVenue);
  expect(transport.get).toHaveBeenCalledWith("/api/v1/venues/primary");
});

test("HTTP availability service URL-encodes authoritative query inputs and rejects corrupt data", async () => {
  const transport = stubTransport({ ...availabilityWireBody, unexpected: true });
  await expect(new HttpAvailabilityService(transport).get(venueId, "FIVE_A_SIDE", "2026-07-22"))
    .rejects.toThrow("INVALID_API_RESPONSE");
  expect(transport.get).toHaveBeenCalledWith(
    `/api/v1/venues/${venueId}/availability?date=2026-07-22&pitch_type=FIVE_A_SIDE`
  );
});
```

- [ ] **Step 2: Run venue tests and verify they fail**

Run: `npm run test:unit -- miniprogram/pages/venue/controller.test.ts miniprogram/services/http-services.test.ts`

Expected: FAIL because `VenueController`, `HttpVenueService`, and `HttpAvailabilityService` do not exist.

- [ ] **Step 3: Implement the controller and page bindings**

Keep `controller.ts` independent of `Page()`. Its closed state union is:

```ts
type VenuePageState =
  | { kind: "initial" | "loading" }
  | { kind: "ready"; venue: Venue; failedImageUrls: string[] }
  | { kind: "first-load-error"; message: string; requestId: string | null };
```

Use a monotonically increasing request generation to ignore stale completions. Retry invokes a new load. Image-error events add the exact URL to a stable de-duplicated `failedImageUrls` list, so each COVER/GALLERY fallback is independent; native map/phone failure emits a toast effect and preserves venue content. “查看可订时段” navigates with the decoded venue ID; do not include price, inventory or full venue JSON in the URL.

Implement the two concrete HTTP services beside their interfaces. They accept only a `Transport`, build relative paths, and always pass unknown response bodies through `decodeVenue`/`decodeAvailability`. In production `Page()` constructs them with the production Transport, whose base URL comes from `config/runtime.ts`; development pages inject Scenario services. No business page imports Fixture or Scenario code.

- [ ] **Step 4: Run controller, component and type checks**

Run:

```bash
npm run test:unit -- miniprogram/pages/venue/controller.test.ts miniprogram/services/http-services.test.ts miniprogram/components/components.test.ts
npm run typecheck
```

Expected: PASS; stale responses cannot overwrite the newest state; errors never render Fixture fallback.

- [ ] **Step 5: Commit the venue page**

```bash
git add miniprogram/pages/venue miniprogram/services
git commit -m "feat: implement primary venue page"
```

### Task 9: Implement availability loading, refresh, selection, and midnight recovery

**Files:**
- Modify: `miniprogram/pages/availability/index.ts`
- Modify: `miniprogram/pages/availability/index.json`
- Modify: `miniprogram/pages/availability/index.wxml`
- Modify: `miniprogram/pages/availability/index.wxss`
- Create: `miniprogram/pages/availability/controller.ts`
- Create: `miniprogram/pages/availability/controller.test.ts`
- Create: `miniprogram/pages/availability/memory-cache.ts`
- Create: `miniprogram/pages/availability/memory-cache.test.ts`
- Create: `miniprogram/utils/shanghai-date.ts`
- Create: `miniprogram/utils/shanghai-date.test.ts`

- [ ] **Step 1: Write failing tests for the complete selection lifecycle**

```ts
test("defaults to server start date and first sorted pitch type", async () => {
  const controller = availabilityHarness({ venue, availability: ready }).controller;
  await controller.load();
  expect(controller.context).toMatchObject({ date: "2026-07-22", pitchType: "FIVE_A_SIDE" });
});

test("bootstrap re-fetches primary venue and rejects a mismatched route venue", async () => {
  const { controller, calls } = availabilityHarness({ routeVenueId: venue.id });
  await controller.load();
  expect(calls.slice(0, 2)).toEqual(["venue-primary", "availability"]);
  await expect(availabilityHarness({ routeVenueId: otherVenue.id }).controller.load())
    .rejects.toMatchObject({ code: "VENUE_ROUTE_MISMATCH" });
});

test("selection is single, toggleable, and AVAILABLE-only", async () => {
  const controller = loadedAvailabilityHarness().controller;
  controller.select(availableA.id);
  expect(controller.selectedSlotId).toBe(availableA.id);
  controller.select(availableB.id);
  expect(controller.selectedSlotId).toBe(availableB.id);
  controller.select(availableB.id);
  expect(controller.selectedSlotId).toBeNull();
  controller.select(booked.id);
  expect(controller.selectedSlotId).toBeNull();
});

test.each(["changeDate", "changePitchType", "manualRefresh", "leave"])("%s clears selection", async (action) => {
  const controller = selectedAvailabilityHarness().controller;
  await controller[action](actionInput[action]);
  expect(controller.selectedSlotId).toBeNull();
});

test("automatic refresh preserves only a still-available selected slot", async () => {
  const { controller, respondRefresh } = selectedAvailabilityHarness();
  const refreshing = controller.autoRefresh();
  const selectedBeforeTap = controller.selectedSlotId;
  controller.select(availableB.id);
  expect(controller.selectedSlotId).toBe(selectedBeforeTap);
  respondRefresh(withStatus(availableA.id, "BOOKED"));
  await refreshing;
  expect(controller.selectedSlotId).toBeNull();
  expect(controller.effect).toEqual({ type: "toast", message: "该时段状态已变化，请重新选择" });
});

test("automatic refresh preserves a selected slot that remains AVAILABLE", async () => {
  const { controller, respondRefresh } = selectedAvailabilityHarness();
  const refreshing = controller.autoRefresh();
  respondRefresh(withStatus(availableA.id, "AVAILABLE"));
  await refreshing;
  expect(controller.selectedSlotId).toBe(availableA.id);
});
```

- [ ] **Step 2: Add failing error, stale response, 422 recovery, and cross-midnight tests**

```ts
test("refresh failure preserves stale data and marks it stale", async () => {
  const { controller, rejectRefresh } = loadedAvailabilityHarness();
  rejectRefresh({ code: "SERVICE_UNAVAILABLE", requestId: "req-2" });
  await controller.manualRefresh();
  expect(controller.state).toMatchObject({ kind: "stale-error", data: ready, requestId: "req-2" });
});

test("DATE_OUT_OF_RANGE resets the window and retries availability once", async () => {
  const { controller, calls } = outOfRangeHarness();
  await controller.load();
  expect(calls).toEqual(["venue", "availability", "venue", "availability"]);
  expect(controller.context).toMatchObject({ date: newVenue.availabilityWindow.startDate, pitchType: newVenue.pitchTypes[0].code });
});

test("a second DATE_OUT_OF_RANGE fails without a retry loop", async () => {
  const { controller, calls } = repeatedOutOfRangeHarness();
  await controller.load();
  expect(calls).toEqual(["venue", "availability", "venue", "availability"]);
  expect(controller.state.kind).toBe("first-load-error");
});

test("onShow after Shanghai midnight discards the old window and reloads venue", async () => {
  const { controller, clock, calls } = loadedAvailabilityHarness();
  clock.set("2026-07-23T00:00:01+08:00");
  await controller.resume();
  expect(calls).toEqual(expect.arrayContaining(["venue", "availability"]));
});

test("a late response for an old date cannot replace the current date", async () => {
  const { controller, requests } = loadedAvailabilityHarness();
  const oldRequest = controller.changeDate("2026-07-23");
  const currentRequest = controller.changeDate("2026-07-24");
  requests.forDate("2026-07-24").resolve(day24);
  await currentRequest;
  requests.forDate("2026-07-23").resolve(day23);
  await oldRequest;
  expect(controller.context.date).toBe("2026-07-24");
  expect(controller.state).toMatchObject({ data: day24 });
});

test("Shanghai date calculation is independent of device timezone", () => {
  expect(shanghaiDateAt("2026-07-22T16:30:00.000Z", "America/Los_Angeles")).toBe("2026-07-23");
  expect(inclusiveShanghaiDates("2026-07-22", "2026-08-04")).toHaveLength(14);
});
```

- [ ] **Step 3: Run tests and verify they fail**

Run: `npm run test:unit -- miniprogram/pages/availability/controller.test.ts miniprogram/pages/availability/memory-cache.test.ts miniprogram/utils/shanghai-date.test.ts`

Expected: FAIL because the controller, page-memory cache, and named-timezone utility do not exist.

- [ ] **Step 4: Implement the controller and page state projection**

On entry, use the route `venueId` only as an identity check: re-fetch `/venues/primary`, require its ID to equal the route ID, then derive the date window and first sorted pitch type exclusively from that fresh server response before requesting availability. A mismatch is a configuration/navigation error and must not query availability. Use this closed state union and keep request/selection logic out of `Page()`:

```ts
type AvailabilityPageState =
  | { kind: "initial" | "loading" }
  | { kind: "ready" | "empty" | "refreshing"; data: Availability }
  | { kind: "first-load-error"; message: string; requestId: string | null }
  | { kind: "stale-error"; data: Availability; message: string; requestId: string | null };
```

Generate the 14 date chips from the server boundaries using `Asia/Shanghai`, never from device-local date arithmetic. Use a request generation key `(venueId,pitchType,date,sequence)` so late responses cannot overwrite the current context. Disable selection while refreshing. Render the selected copy exactly as “已选择，预订功能将在下一阶段开放”; never issue a POST, lock request, or success claim. Clear selection on context changes/manual refresh/leave/midnight; auto-refresh preserves it only if the same ID remains `AVAILABLE`.

Implement `AvailabilityMemoryCache` separately so `controller.ts` stays under 250 lines. Key entries by `(venueId,pitchType,date)` and store `{data,fetchedAt}` only in the page/controller instance—never `wx.setStorage`. At age `<= 60_000ms`, show cached `ready|empty` immediately and start background refresh. At age `> 60_000ms`, retain cached rows only while showing `refreshing` plus “数据可能已更新” and disable selection. Refresh success replaces the entry; refresh failure becomes `stale-error`, keeps rows, and leaves selection disabled. Context changes read only their own key; leaving destroys the cache.

In `memory-cache.test.ts`, cover exact ages 59,999ms, 60,000ms and 60,001ms; verify fresh background refresh, expired warning/disablement, per-key isolation, success replacement, failure retention, and that neither `wx.setStorage` nor `wx.setStorageSync` is called.

- [ ] **Step 5: Run full frontend unit verification**

Run:

```bash
npm run lint
npm run typecheck
npm test
```

Expected: PASS; tests cover both date boundaries, all five status clicks, empty, first-load error, stale-error, late response, one-retry 422 recovery and midnight recovery.

- [ ] **Step 6: Commit the availability page**

```bash
git add miniprogram/pages/availability miniprogram/utils
git commit -m "feat: implement availability browsing states"
```

### Task 10: Automate native journeys and establish visual baselines

**Files:**
- Modify: `.gitignore`
- Modify: `package.json`
- Create: `artifacts/ui/golden/masks.yaml`
- Create: `artifacts/ui/golden/masks.schema.json`
- Create: `artifacts/ui/golden/capture-matrix.yaml`
- Create: `artifacts/ui/golden/capture-matrix.schema.json`
- Create: `tests/miniprogram/venue-browsing.e2e.mjs`
- Create: `tests/miniprogram/visual-regression.e2e.mjs`
- Create: `tests/miniprogram/helpers/devtools.mjs`
- Create: `tests/miniprogram/helpers/golden.mjs`
- Create: `scripts/run-miniprogram-e2e.mjs`

- [ ] **Step 1: Install official automation and image-comparison dependencies**

Run: `npm install --save-dev miniprogram-automator pngjs ssim.js`

Add scripts:

```json
{
  "test:miniprogram:e2e": "node scripts/run-miniprogram-e2e.mjs journeys",
  "test:miniprogram:visual:candidate": "node scripts/run-miniprogram-e2e.mjs visual-candidate",
  "test:miniprogram:visual": "node scripts/run-miniprogram-e2e.mjs visual-regression"
}
```

- [ ] **Step 2: Write failing journey automation from the traceability matrix**

The test must launch `dist/miniprogram-development`, open Scenario Runner with explicit screen/scenario query values, and assert:

```js
for (const status of ["AVAILABLE", "TEMPORARILY_LOCKED", "BOOKED", "CLOSED", "EXPIRED"])
  await assertSelectionResult(status, status === "AVAILABLE");
await assertNoRequest((request) => request.method !== "GET");
await runScenario("availability", "slots-late-response", assertLatestContextWins);
await runScenario("availability", "slots-refresh-error", assertStaleDataAndRetry);
await runScenario("venue-home", "venue-image-failure", assertImageFallback);
await runScenario("venue-home", "venue-map-error", assertMapFailureCopy);
await runScenario("venue-home", "venue-phone-error", assertPhoneFailureCopy);
```

Also cover opening venue, navigation, default date/type, 14-day inclusive boundaries, empty, first-load retry, refresh selection lock, and simulated cross-midnight `onShow`.

- [ ] **Step 3: Run automation and verify it fails before harness implementation**

Run: `WECHAT_DEVTOOLS_CLI="/absolute/path/to/cli" npm run test:miniprogram:e2e`

Expected: FAIL with a clear missing harness/connection error, not a skipped test. If Developer Tools are unavailable, record this as an environment blocker; do not mark the task complete.

- [ ] **Step 4: Implement Developer Tools launch, journey tests, and evidence capture**

`run-miniprogram-e2e.mjs` validates the absolute CLI path, builds development output, starts automation with a fixed base-library version, and always closes the connection. Each failure includes screen/scenario/current state. Save screenshots under ignored `artifacts/ui/golden/.candidates/` until accepted as a baseline; add this explicit path to `.gitignore`.

- [ ] **Step 5: Implement visual comparison and baseline metadata**

Use the unambiguous key `<screen-id>/<golden-id>` everywhere. Candidate and canonical filenames are `<screen-id>__<golden-id>.png` plus `.metadata.json`; no flat golden ID is legal. Define `capture-matrix.yaml` and its closed schema with these exact assignments:

```yaml
venue-home/devtools-375-ready: {environment: devtools, logical_width: 375, scenario: venue-ready}
venue-home/devtools-390-ready: {environment: devtools, logical_width: 390, scenario: venue-ready}
venue-home/ios-ready: {environment: ios-device, logical_width: null, scenario: venue-ready}
venue-home/android-ready: {environment: android-device, logical_width: null, scenario: venue-ready}
availability/devtools-375-ready: {environment: devtools, logical_width: 375, scenario: slots-ready}
availability/devtools-390-empty: {environment: devtools, logical_width: 390, scenario: slots-empty}
availability/ios-ready: {environment: ios-device, logical_width: null, scenario: slots-ready}
availability/android-ready: {environment: android-device, logical_width: null, scenario: slots-ready}
```

Define `masks.yaml` as a closed mapping from those same eight screen-qualified keys to explicit selector arrays. All eight approved ready/empty goldens initially map to `[]` because the fixed Scenario clock removes time variance and these states render no request ID. A future golden may add `[data-visual-mask="request-id"]` only if that node is actually present. Both schemas reject coordinates, unknown keys, missing manifest entries, and environment/ID mismatches. For non-empty arrays, the runner resolves each selector after layout, records its bounding box in the run report, and fails if a selector matches zero or multiple nodes; an explicit empty array is valid and means no masking.

Chunk 2 captures only the four `environment: devtools` entries, each at its one assigned width. The iOS/Android entries are mandatory declarations but are captured on their actual devices in the final checkpoint; Developer Tools must never write those files. Their `logical_width: null` is a schema-valid pre-capture sentinel only. Task 15 must query `wx.getWindowInfo().windowWidth` on each physical device, replace null with that positive integer in `capture-matrix.yaml`, validate and commit the frozen matrix, then capture; metadata validation and baseline promotion reject any remaining null or any width different from the frozen value. In `visual-candidate` mode there is intentionally no canonical comparison: validate PNG assigned dimensions/non-blank variance, metadata schema, SHA-256, exact environment versions, and mask resolution, then leave the candidate plus report in the ignored directory. In `visual-regression` mode require a user-accepted canonical PNG/metadata pair; fail with `BASELINE_NOT_ACCEPTED` if absent, otherwise mask the resolved boxes and fail when SSIM `< 0.99` or changed pixels `> 0.5%`. Never copy a candidate to the canonical directory automatically.

- [ ] **Step 6: Run the complete Chunk 2 quality interface**

Run:

```bash
npm run lint
npm run typecheck
npm test
npm run build:miniprogram:development
WECHAT_DEVTOOLS_CLI="/absolute/path/to/cli" npm run test:miniprogram:e2e
WECHAT_DEVTOOLS_CLI="/absolute/path/to/cli" npm run test:miniprogram:visual:candidate
npm run build:miniprogram:production
npm run audit:miniprogram-package
```

Expected: all commands exit 0; journey matrix passes; first-capture candidates pass schema/dimension/non-blank/mask checks; no candidate is treated as canonical; production contains no dev/Fixture/Scenario code.

- [ ] **Step 7: Carry candidates to the final slice checkpoint and commit the frontend harness**

Do not pause for user acceptance here and do not commit `.candidates`. Chunk 3 repeats the captures against the HTTP-integrated staging build, then presents those final candidates and metadata at the single vertical-slice stage checkpoint. Only explicit user acceptance there promotes them to canonical baselines and unlocks `test:miniprogram:visual`.

```bash
git add .gitignore package.json package-lock.json tests/miniprogram scripts/run-miniprogram-e2e.mjs artifacts/ui/golden/masks.yaml artifacts/ui/golden/masks.schema.json artifacts/ui/golden/capture-matrix.yaml artifacts/ui/golden/capture-matrix.schema.json miniprogram
git commit -m "test: verify native venue browsing journey"
```

## Chunk 3: PostgreSQL backend, real HTTP integration, staging, and slice acceptance

### Task 11: Establish the FastAPI foundation and stable Python quality interface

**Files:**
- Create: `pyproject.toml`
- Create: `uv.lock`
- Create: `backend/__init__.py`
- Create: `backend/app/__init__.py`
- Create: `backend/app/main.py`
- Create: `backend/app/config.py`
- Create: `backend/app/database.py`
- Create: `backend/app/errors.py`
- Create: `backend/app/request_id.py`
- Create: `backend/tests/conftest.py`
- Create: `backend/tests/test_health.py`
- Create: `backend/tests/test_errors.py`

- [ ] **Step 1: Initialize locked Python dependencies**

Run:

```bash
uv init --bare
uv add fastapi 'uvicorn[standard]' sqlalchemy 'psycopg[binary]' alembic pydantic-settings httpx
uv add --dev pytest pytest-cov mypy ruff
```

Configure Python `>=3.13`, Ruff, strict mypy for `backend`, and pytest discovery under `backend/tests`. Keep the root `pyproject.toml` so the spec’s stable root commands work exactly; do not create a second backend dependency file.

- [ ] **Step 2: Write failing health and error-envelope tests**

```py
def test_health_reports_database_connectivity(client, db_session):
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    assert response.headers["X-Request-Id"]

def test_health_returns_503_when_database_is_unavailable(client, broken_database):
    response = client.get("/api/v1/health")
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "SERVICE_UNAVAILABLE"

def test_error_envelope_reuses_header_request_id(client):
    response = client.get("/__test__/known-error")
    assert set(response.json()) == {"error"}
    assert response.json()["error"] == {
        "code": "INVALID_ARGUMENT", "message": "请求参数无效",
        "request_id": response.headers["X-Request-Id"], "details": {}
    }
```

- [ ] **Step 3: Run tests and verify they fail**

Run: `uv run pytest backend/tests/test_health.py backend/tests/test_errors.py -q`

Expected: FAIL because the FastAPI app foundation does not exist.

- [ ] **Step 4: Implement configuration, database dependency, request IDs, and errors**

`Settings` accepts `APP_ENV`, `DATABASE_URL`, `PUBLIC_API_BASE_URL`, and `PUBLIC_IMAGE_HOSTS`; rejects missing production/staging values; and never logs secrets. Use a request-ID middleware that validates an optional incoming safe ID or generates a ULID-like sortable ID, places it in request state and `X-Request-Id`, and is reused by every error. Define one `AppError(status_code, code, message, details)` handler and a final exception handler that logs the request ID but returns only `INTERNAL_ERROR`. The health route executes `SELECT 1`, checks no WeChat service, and returns 503 on DB failure. `/__test__/known-error` is mounted only by the `create_test_app` fixture and must be absent from the production app’s route table, not merely hidden from OpenAPI.

- [ ] **Step 5: Run Python quality checks**

Run:

```bash
uv run ruff check backend
uv run mypy backend
uv run pytest backend/tests/test_health.py backend/tests/test_errors.py -q
```

Expected: all PASS; 500/503 responses contain no traceback, DSN, or credentials.

- [ ] **Step 6: Commit the backend foundation**

```bash
git add pyproject.toml uv.lock backend
git commit -m "chore: establish FastAPI service foundation"
```

### Task 12: Encode PostgreSQL integrity rules in migrations and models

**Files:**
- Create: `alembic.ini`
- Create: `backend/migrations/env.py`
- Create: `backend/migrations/script.py.mako`
- Create: `backend/migrations/versions/0001_venue_inventory.py`
- Create: `backend/app/models.py`
- Create: `deploy/compose.test.yaml`
- Create: `backend/tests/test_schema_constraints.py`

- [ ] **Step 1: Write failing PostgreSQL constraint tests**

```py
def test_only_one_active_primary_venue(pg_session, venue_factory):
    venue_factory(is_primary=True, is_active=True)
    with pytest.raises(IntegrityError):
        venue_factory(is_primary=True, is_active=True)

def test_adjacent_slots_are_allowed_but_overlap_is_rejected(pg_session, pitch):
    slot(pg_session, pitch, "18:00", "20:00")
    slot(pg_session, pitch, "20:00", "22:00")
    pg_session.commit()
    with pytest.raises(IntegrityError):
        slot(pg_session, pitch, "19:00", "21:00")
        pg_session.commit()

@pytest.mark.parametrize("status,locked_until,order_id,valid", [
    ("LOCKED", locked_until, order_id, True),
    ("LOCKED", None, None, False),
    ("AVAILABLE", locked_until, order_id, False),
    ("BOOKED", None, None, True),
])
def test_lock_fields_correlate_with_status(pg_session, slot_values, status, locked_until, order_id, valid):
    row = Slot(**slot_values, status=status, locked_until=locked_until, locked_by_order_id=order_id)
    pg_session.add(row)
    if valid:
        pg_session.commit()
        assert row.id is not None
    else:
        with pytest.raises(IntegrityError):
            pg_session.commit()

@pytest.mark.parametrize("mutation", [
    "negative_price", "reversed_time", "cross_midnight", "negative_sort",
    "latitude_out_of_range", "longitude_out_of_range", "duplicate_cover",
    "duplicate_facility", "duplicate_pitch_code", "missing_parent"
])
def test_each_declared_schema_violation_is_rejected(pg_session, valid_graph, mutation):
    apply_schema_mutation(valid_graph, mutation)
    with pytest.raises(IntegrityError):
        pg_session.commit()

def test_delete_rules_protect_inventory_but_cascade_venue_content(pg_session, valid_graph):
    with pytest.raises(IntegrityError):
        pg_session.delete(valid_graph.pitch)
        pg_session.commit()
    pg_session.rollback()
    pg_session.delete(valid_graph.venue)
    with pytest.raises(IntegrityError):  # pitches/slots protect venue deletion
        pg_session.commit()
```

`apply_schema_mutation` is an explicit fixture helper with one branch per listed name; each branch changes only that invariant. Add a metadata assertion that the primary/COVER partial unique indexes, every FK index, `UNIQUE(pitch_id,starts_at,ends_at)`, and `ex_slots_no_overlap` exist by exact name. The tests above therefore cover UUID/FKs/delete behavior, non-negative price/sort order, coordinates, COVER/facility/pitch uniqueness, `starts_at < ends_at`, cross-midnight rejection and lock correlation without prose-only cases.

- [ ] **Step 2: Start a disposable PostgreSQL and verify tests fail before migration**

Run:

```bash
docker compose -f deploy/compose.test.yaml up -d postgres
TEST_DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test uv run pytest backend/tests/test_schema_constraints.py -q
```

Expected: FAIL because tables/migration do not exist. The fixture must migrate a fresh database and clean only the named test schema between tests.

- [ ] **Step 3: Implement one migration and focused SQLAlchemy models**

Create enums and the five tables exactly as spec section 6.3. Migration requirements:

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE UNIQUE INDEX uq_one_active_primary_venue ON venues ((true))
  WHERE is_primary AND is_active;
ALTER TABLE slots ADD CONSTRAINT ex_slots_no_overlap
  EXCLUDE USING gist (pitch_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&);
```

Add the exact one-COVER partial unique index, all checks and FK indexes, UTC-aware timestamps, and `locked_by_order_id UUID` without an orders FK until the order slice. Models map schema only; projection/query logic stays in modules.

- [ ] **Step 4: Run migration and constraint tests against real PostgreSQL**

Run:

```bash
TEST_DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test uv run alembic upgrade head
TEST_DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test uv run pytest backend/tests/test_schema_constraints.py -q
uv run ruff check backend
uv run mypy backend
```

Expected: PASS; adjacent intervals succeed, duplicate/overlap/cross-midnight and invalid lock fields fail at the database boundary.

- [ ] **Step 5: Commit the persistence boundary**

```bash
git add alembic.ini backend/migrations backend/app/models.py backend/tests deploy/compose.test.yaml
git commit -m "feat: enforce venue inventory database constraints"
```

### Task 13: Implement the primary venue query and endpoint contract-first

**Files:**
- Create: `backend/app/modules/__init__.py`
- Create: `backend/app/modules/venues/__init__.py`
- Create: `backend/app/modules/venues/dto.py`
- Create: `backend/app/modules/venues/repository.py`
- Create: `backend/app/modules/venues/service.py`
- Create: `backend/app/modules/venues/router.py`
- Create: `backend/tests/test_primary_venue.py`
- Create: `backend/tests/test_openapi_conformance.py`
- Modify: `backend/app/main.py`

- [ ] **Step 1: Write failing API tests for success, ordering, and misconfiguration**

```py
def test_primary_venue_matches_contract(client, complete_primary_venue, openapi_validator):
    response = client.get("/api/v1/venues/primary")
    assert response.status_code == 200
    openapi_validator.validate_response(response)
    body = response.json()
    assert [item["sort_order"] for item in body["images"]] == sorted(item["sort_order"] for item in body["images"])
    assert sum(image["role"] == "COVER" for image in body["images"]) == 1
    assert body["availability_window"] == {"start_date": today_shanghai(), "end_date": plus_days(today_shanghai(), 13)}

@pytest.mark.parametrize("primary_count", [0, 2])
def test_primary_misconfiguration_is_500_without_failing_health(client, fake_venue_repository, primary_count):
    fake_venue_repository.return_count(primary_count)
    assert client.get("/api/v1/venues/primary").json()["error"]["code"] == "PRIMARY_VENUE_MISCONFIGURED"
    assert client.get("/api/v1/health").status_code == 200

def test_missing_cover_is_misconfiguration(client, primary_without_cover):
    assert client.get("/api/v1/venues/primary").json()["error"]["code"] == "PRIMARY_VENUE_MISCONFIGURED"
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `TEST_DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test uv run pytest backend/tests/test_primary_venue.py backend/tests/test_openapi_conformance.py -q`

Expected: FAIL with 404/missing venue module.

- [ ] **Step 3: Implement repository, service validation, DTO, and router**

Repository performs deterministic eager reads ordered by `(sort_order,id)` and returns persistence records only. Service requires exactly one active primary, exactly one COVER, non-empty required content, supported named timezone, GCJ-02 coordinates already stored, and at least one pitch type; it computes the inclusive 14-day window in `Asia/Shanghai`. Pydantic response DTOs mirror `contracts/openapi.yaml`, do not expose ORM objects, and return `generated_at` with `+08:00`. Router remains a thin GET adapter.

- [ ] **Step 4: Validate implementation and generated FastAPI OpenAPI against the contract**

At this stage `test_openapi_conformance.py` compares only the two implemented paths—health and primary venue—including methods, status codes, required fields and `additionalProperties` semantics. It explicitly asserts the availability path is still absent from generated FastAPI OpenAPI. Approved descriptive differences are normalized explicitly, never ignored wholesale. Task 14 extends the same test to require all three paths after its router is registered.

Run:

```bash
TEST_DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test uv run pytest backend/tests/test_primary_venue.py backend/tests/test_openapi_conformance.py -q
npm run contract:validate
```

Expected: PASS for complete venue, zero/duplicate repository results, missing COVER, sorting, both date boundaries, and the exact two-path implementation subset.

- [ ] **Step 5: Commit the venue endpoint**

```bash
git add backend/app/modules backend/app/main.py backend/tests
git commit -m "feat: expose the primary venue endpoint"
```

### Task 14: Implement availability projection and idempotent test data

**Files:**
- Create: `backend/app/modules/availability/__init__.py`
- Create: `backend/app/modules/availability/dto.py`
- Create: `backend/app/modules/availability/repository.py`
- Create: `backend/app/modules/availability/projection.py`
- Create: `backend/app/modules/availability/service.py`
- Create: `backend/app/modules/availability/router.py`
- Create: `scripts/__init__.py`
- Create: `scripts/seed_demo.py`
- Create: `backend/tests/test_availability.py`
- Create: `backend/tests/test_seed_demo.py`
- Modify: `backend/app/main.py`

- [ ] **Step 1: Write failing status, boundary, and error tests**

```py
@pytest.mark.parametrize("stored,starts_at,expected,reason", [
    ("AVAILABLE", future, "AVAILABLE", None),
    ("LOCKED", future, "TEMPORARILY_LOCKED", "HELD_FOR_PAYMENT"),
    ("BOOKED", future, "BOOKED", "ALREADY_BOOKED"),
    ("CLOSED", future, "CLOSED", "VENUE_CLOSED"),
    ("AVAILABLE", past, "EXPIRED", "TIME_PASSED"),
])
def test_status_projection(client, seeded_pitch, slot_factory, frozen_clock, stored, starts_at, expected, reason):
    created = slot_factory(pitch=seeded_pitch, status=stored, starts_at=starts_at)
    body = client.get(availability_url(seeded_pitch)).json()
    projected = find_slot(body, created.id)
    assert (projected["status"], projected["unavailable_reason"]) == (expected, reason)

@pytest.mark.parametrize("query,code", [
    ({"date": "bad", "pitch_type": "FIVE_A_SIDE"}, "INVALID_ARGUMENT"),
    ({"date": in_range, "pitch_type": "ELEVEN_A_SIDE"}, "INVALID_ARGUMENT"),
    ({"date": in_range, "pitch_type": "SEVEN_A_SIDE"}, "PITCH_TYPE_NOT_SUPPORTED"),
    ({"date": before_range, "pitch_type": "FIVE_A_SIDE"}, "DATE_OUT_OF_RANGE"),
    ({"date": after_range, "pitch_type": "FIVE_A_SIDE"}, "DATE_OUT_OF_RANGE"),
])
def test_query_errors_use_contract_envelope(client, primary_venue, query, code):
    response = client.get(f"/api/v1/venues/{primary_venue.id}/availability", params=query)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == code
    assert response.json()["error"]["request_id"] == response.headers["X-Request-Id"]
```

Add named tests with direct assertions: `test_unknown_venue_is_404`; `test_first_and_last_dates_are_inclusive`; `test_legal_empty_day_returns_200_with_empty_pitches`; `test_pitches_and_slots_use_sort_order_then_stable_id`; `test_price_is_non_negative_integer_cents`; `test_adjacent_half_open_slots_are_returned`; `test_timestamps_are_plus_08`; `test_expired_locked_until_remains_temporarily_locked`; and `test_availability_error_reuses_header_request_id`. Each uses a real database row and validates the complete response through the OpenAPI response validator.

- [ ] **Step 2: Write failing seed tests**

```py
def test_seed_is_idempotent_and_covers_31_days(pg_session):
    run_seed(anchor="2026-07-22", days=31)
    snapshot = inventory_snapshot(pg_session)
    run_seed(anchor="2026-07-22", days=31)
    assert inventory_snapshot(pg_session) == snapshot
    assert covered_dates(pg_session) == date_range("2026-07-22", days=31)

def test_seed_does_not_overwrite_existing_inventory_or_partner_content(pg_session, partner_venue):
    existing = slot(pg_session, price_cents=45600, status="BOOKED")
    before = partner_content_snapshot(partner_venue)
    run_seed(anchor="2026-07-22", days=31)
    pg_session.refresh(existing)
    assert (existing.price_cents, existing.status) == (45600, "BOOKED")
    assert partner_content_snapshot(partner_venue) == before

def test_seed_refuses_production(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    with pytest.raises(SystemExit, match="seed is disabled in production"):
        run_seed(anchor="2026-07-22", days=31)
```

- [ ] **Step 3: Run tests and verify they fail**

Run: `TEST_DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test uv run pytest backend/tests/test_availability.py backend/tests/test_seed_demo.py -q`

Expected: FAIL because availability module and seed command do not exist.

- [ ] **Step 4: Implement projection, query, validation, and router**

Compute `EXPIRED` first when `now >= starts_at`; otherwise map persistent status one-to-one and never mutate/release a lock in a GET. Validate query format before service execution, supported enum separately from venue-supported types, and inclusive range against a freshly calculated primary window. Query the requested local business day as a UTC half-open interval and group/sort by physical pitch. A legal no-data day returns 200 with `pitches: []`.

Register the availability router and extend `test_openapi_conformance.py` from Task 13 so generated FastAPI OpenAPI must now contain all three contract paths and the full availability success/error schemas, enums, nullable reason, status codes, and closed-object semantics.

- [ ] **Step 5: Implement the non-production seed command**

`uv run python -m scripts.seed_demo --anchor-date today --days 31` accepts `today|YYYY-MM-DD`, computes in `Asia/Shanghai`, and hard-fails unless `APP_ENV` is `local|test|staging`. Every entity uses insert-if-missing by a stable business key; conflicts are `DO NOTHING`, never updates. Thus repeated/deployment seeds may add missing future slots but can never overwrite existing venue name/content/coordinates/phone/policies, images, facilities, pitches, slot price or status. It creates a complete labeled test venue only when no matching venue exists, exactly one COVER plus gallery images, both pitch types and 31 days of AVAILABLE/BOOKED/CLOSED inventory, no active LOCKED rows, and deliberately no seven-a-side slots on day +13 while five-a-side still covers that day. This supplies a legitimate HTTP empty case without violating the per-calendar-day coverage gate. The staging banner and test content remain clearly labeled “测试环境”; partner-confirmed content is loaded through an explicit deployment data step before final acceptance and is then protected from seed changes.

- [ ] **Step 6: Run availability, seed, contract, and complete backend checks**

Run:

```bash
TEST_DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test uv run pytest backend/tests/test_availability.py backend/tests/test_seed_demo.py backend/tests/test_openapi_conformance.py -q
APP_ENV=test DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test uv run python -m scripts.seed_demo --anchor-date today --days 31
uv run ruff check backend scripts
uv run mypy backend scripts
TEST_DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test uv run pytest
npm run contract:validate
```

Expected: all PASS against real PostgreSQL; repeated seed changes no existing slot values; all OpenAPI examples validate.

- [ ] **Step 7: Stop the disposable database after all backend checks**

Run: `docker compose -f deploy/compose.test.yaml down --volumes`

Expected: only the named test services and `pitch_test` volume are removed. Tasks 12–14 deliberately share the running test database; do not tear it down earlier.

- [ ] **Step 8: Commit availability and seed**

```bash
git add backend/app/modules/availability backend/app/main.py backend/tests scripts/seed_demo.py scripts/__init__.py
git commit -m "feat: serve seeded venue availability"
```

### Task 15: Deploy staging, prove real HTTP integration, and stop for slice acceptance

**Files:**
- Modify: `pyproject.toml`
- Modify: `uv.lock`
- Create: `compose.yaml`
- Create: `deploy/Caddyfile`
- Create: `deploy/.env.example`
- Modify: `deploy/README.md`
- Create: `deploy/venue-content.schema.json`
- Create: `deploy/venue-content.example.json`
- Create: `deploy/venue-content.json` (partner-confirmed public staging content; required before acceptance)
- Create: `scripts/load_venue_content.py`
- Create: `scripts/preflight_deploy.py`
- Create: `scripts/verify_staging.py`
- Create: `scripts/validate_capture_matrix.mjs`
- Create: `scripts/promote-goldens.mjs`
- Create: `scripts/compare-device-goldens.mjs`
- Create: `backend/tests/test_verify_staging.py`
- Create: `backend/tests/test_load_venue_content.py`
- Create: `backend/tests/test_deploy_preflight.py`
- Create: `tests/miniprogram/http-integration.e2e.mjs`
- Create: `.github/workflows/ci.yml`
- Create: `docs/acceptance/venue-browsing-checklist.md`
- Create: `docs/acceptance/venue-content-approval.json` (required confirmation record)
- Create: `docs/acceptance/golden-acceptance-record.example.json`
- Modify: `miniprogram/config/runtime.ts`
- Modify: `backend/app/config.py`
- Modify: `backend/app/request_id.py`
- Modify: `package.json`
- Modify: `artifacts/ui/golden/capture-matrix.yaml`

- [ ] **Step 1: Write failing staging verifier and production-package integration tests**

Run `uv add jsonschema` first and commit the resulting dependency/lock changes with the Task 15 implementation. `load_venue_content.py` uses Draft 2020-12 validation through this library; handwritten partial validation is not acceptable.

```py
def test_verify_staging_rejects_incomplete_content(fake_staging):
    fake_staging.venue["phone"] = ""
    assert verify(fake_staging.url).failures == ["venue.phone is empty"]

def test_latency_report_requires_100_successes_below_500ms(fake_staging):
    report = verify(fake_staging.url, samples=100)
    assert report.sample_count == 100
    assert report.error_rate == 0
    assert report.p95_ms < 500

def test_today_through_day_13_have_inventory_coverage(fake_staging):
    report = verify(fake_staging.url, today=date(2026, 7, 22))
    assert report.covered_dates == [date(2026, 7, 22) + timedelta(days=i) for i in range(14)]

def test_api_and_every_image_use_allowlisted_https_hosts(fake_staging):
    report = verify(fake_staging.url, allowed_hosts={"api.staging.test", "cdn.staging.test"})
    assert report.invalid_urls == []
    assert all(url.startswith("https://") for url in report.checked_urls)

def test_content_loader_is_transactional_and_preserves_inventory(pg_session, approved_content):
    before_slots = inventory_snapshot(pg_session)
    load_content(approved_content)
    assert venue_content_snapshot(pg_session) == approved_content.expected_snapshot
    assert inventory_snapshot(pg_session) == before_slots

def test_content_loader_rejects_missing_or_mismatched_approval(pg_session, approved_content):
    with pytest.raises(ContentApprovalError):
        load_content(approved_content, approval_sha256="wrong")
    assert venue_content_snapshot(pg_session) == original_content_snapshot

def test_deploy_preflight_rejects_every_validation_sentinel(tmp_path):
    env_file = write_env(tmp_path, {
        "POSTGRES_PASSWORD": "change-before-deploy",
        "PUBLIC_API_DOMAIN": "staging.invalid",
        "APP_REVISION": "uncommitted"
    })
    result = preflight(env_file)
    assert set(result.failures) == {
        "POSTGRES_PASSWORD uses validation sentinel",
        "PUBLIC_API_DOMAIN uses validation sentinel",
        "APP_REVISION is not a commit SHA"
    }
```

```js
test("production page uses HTTP and never falls back when API is unavailable", async () => {
  await openProductionVenuePage({ api: "unavailable" });
  await expectVisible("first-load-error");
  await expectNoLoadedFixtureData();
  await expectNoNonGetRequests();
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
docker compose -f deploy/compose.test.yaml up -d postgres
TEST_DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test uv run alembic upgrade head
TEST_DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test uv run pytest backend/tests/test_verify_staging.py backend/tests/test_load_venue_content.py backend/tests/test_deploy_preflight.py -q
npm run build:miniprogram:production
WECHAT_DEVTOOLS_CLI="/absolute/path/to/cli" node --test tests/miniprogram/http-integration.e2e.mjs
```

Expected: FAIL because staging verifier, real domain configuration, and HTTP integration harness are missing.

- [ ] **Step 3: Build the HTTPS staging deployment skeleton**

Compose contains named `postgres`, `api`, and `caddy` services, a PostgreSQL healthcheck, API migration-before-start command, non-root containers, persistent named DB volume, resource limits, and no secrets in the file. Every interpolation has a non-secret validation-only default, including unmistakable `change-before-deploy`/`.invalid` sentinels, so root `docker compose config --quiet` is reproducible without an implicit env file. `scripts/preflight_deploy.py --env-file <path>` invokes Compose JSON rendering, rejects every sentinel, validates HTTPS/DNS/revision/password requirements, and exits before any remote mutation. Caddy terminates HTTPS and proxies only `/api/*`; deploy docs cover DNS, firewall, backups, env file permissions, logs, seed order and rollback.

Run:

```bash
docker compose config --quiet
docker compose --env-file deploy/.env.example config --quiet
uv run python -m scripts.preflight_deploy --env-file deploy/.env.example
```

Expected: both Compose commands exit 0 with no unresolved variable; the preflight command exits non-zero listing the deliberate example sentinels. Before a real deployment, run the same preflight with the ignored, permission-restricted staging env file and require exit 0. Deploy to the user-authorized Alibaba Cloud staging host only when credentials/DNS are available; otherwise run the identical stack locally and report external staging as an explicit delivery blocker.

- [ ] **Step 4: Seed and verify staging before Mini Program integration**

Implement `load_venue_content` as the only update path for partner-confirmed public content. It validates `deploy/venue-content.json` against the closed schema; requires `venue-content-approval.json` containing the exact file SHA-256, confirmer, confirmation date and field checklist; rejects placeholders/test labels/non-HTTPS images/wrong host/not-exactly-one COVER; and runs in one transaction. It updates the matched venue slug, replaces image/facility rows deterministically, and inserts/updates pitch display metadata without deleting pitches or changing/deleting any slots. It supports `--dry-run`, refuses production in this slice, logs the content hash/request ID, and rolls back fully on any error.

After every staging deploy and before stage delivery:

```bash
APP_ENV=staging DATABASE_URL="$STAGING_DATABASE_URL" uv run alembic upgrade head
APP_ENV=staging DATABASE_URL="$STAGING_DATABASE_URL" uv run python -m scripts.seed_demo --anchor-date today --days 31
APP_ENV=staging DATABASE_URL="$STAGING_DATABASE_URL" uv run python -m scripts.load_venue_content --file deploy/venue-content.json --approval docs/acceptance/venue-content-approval.json --dry-run
APP_ENV=staging DATABASE_URL="$STAGING_DATABASE_URL" uv run python -m scripts.load_venue_content --file deploy/venue-content.json --approval docs/acceptance/venue-content-approval.json
STAGING_API_BASE_URL="$STAGING_API_BASE_URL" uv run python -m scripts.verify_staging --output .superpowers/run-evidence/preliminary-staging.json
```

`verify_staging` requires exactly one active primary, exactly one COVER, complete content/coordinates/phone, both desired pitch types, today through day 13 inventory, approved HTTPS API/image hosts, 100 warmed successful samples per read endpoint, 0% errors and P95 `<500ms`. It writes a JSON report with timestamp, commit, environment and sample distribution.

Add required `APP_REVISION` staging/production configuration and emit it as `X-App-Revision` on responses without changing response bodies. `verify_staging --expected-revision <sha>` must compare that header on health and both read endpoints. Local/test may use `development`; deployment preflight permits only a 40-character commit SHA.

- [ ] **Step 5: Switch production runtime to the real staging API and run HTTP journeys**

Replace the placeholder with the provisioned HTTPS API domain, add API/download domains in the Mini Program console, and build production. Automation opens the two real production routes—not Scenario Runner—against staging, verifies venue content/defaults/14 days/empty and all database-backed states available in seed, and observes only GETs. `TEMPORARILY_LOCKED` remains Gallery-only until the order slice, exactly as the spec states.

Run:

```bash
npm run build:miniprogram:production
npm run audit:miniprogram-package
WECHAT_DEVTOOLS_CLI="/absolute/path/to/cli" node --test tests/miniprogram/http-integration.e2e.mjs
```

Expected: PASS; disabling the API produces honest errors, never Fixture data; upload package has no dev/Fixture/Scenario path or token.

- [ ] **Step 6: Execute the complete CI-quality gate**

Configure CI with a PostgreSQL service and exact commands:

```bash
export TEST_DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test
npm run lint
npm run typecheck
npm test
npm run build:miniprogram:production
npm run audit:miniprogram-package
uv run ruff check backend
uv run mypy backend
uv run pytest
uv run python -m scripts.verify_staging
docker compose config --quiet
```

The workflow defines that exact `TEST_DATABASE_URL` at job scope before the bare `uv run pytest`; local execution uses the export shown above. For CI, `verify_staging` targets the deployed staging environment only in the protected staging job; pull-request jobs use the same verifier against the ephemeral Compose URL. Any non-zero command blocks delivery.

- [ ] **Step 7: Commit the complete implementation before generating acceptance evidence**

After all Step 6 gates pass, commit every Task 15 code/config/content input but no ignored candidate or generated evidence:

```bash
git add pyproject.toml uv.lock compose.yaml deploy scripts/load_venue_content.py scripts/preflight_deploy.py scripts/verify_staging.py scripts/validate_capture_matrix.mjs scripts/promote-goldens.mjs scripts/compare-device-goldens.mjs backend/app/config.py backend/app/request_id.py backend/tests/test_load_venue_content.py backend/tests/test_verify_staging.py backend/tests/test_deploy_preflight.py tests/miniprogram .github/workflows/ci.yml docs/acceptance/venue-browsing-checklist.md docs/acceptance/golden-acceptance-record.example.json docs/acceptance/venue-content-approval.json miniprogram/config/runtime.ts package.json package-lock.json artifacts/ui/golden
git commit -m "feat: integrate venue browsing staging slice"
git rev-parse HEAD
```

Record this SHA as `implementation_commit`. Redeploy that exact committed revision, then repeat migration, seed, approved content load and verification with `APP_REVISION`/`--expected-revision` set to the SHA:

```bash
implementation_commit=$(git rev-parse HEAD)
uv run python -m scripts.preflight_deploy --env-file "$STAGING_ENV_FILE"
APP_REVISION="$implementation_commit" docker compose --env-file "$STAGING_ENV_FILE" up -d --build
APP_ENV=staging DATABASE_URL="$STAGING_DATABASE_URL" uv run alembic upgrade head
APP_ENV=staging DATABASE_URL="$STAGING_DATABASE_URL" uv run python -m scripts.seed_demo --anchor-date today --days 31
APP_ENV=staging DATABASE_URL="$STAGING_DATABASE_URL" uv run python -m scripts.load_venue_content --file deploy/venue-content.json --approval docs/acceptance/venue-content-approval.json
STAGING_API_BASE_URL="$STAGING_API_BASE_URL" uv run python -m scripts.verify_staging --expected-revision "$implementation_commit" --output docs/acceptance/evidence/staging-verification.json
```

For remote Alibaba Cloud, the documented deployment mechanism performs the same image build/start with that revision. The authoritative staging report, HTTP evidence and acceptance record must all identify `implementation_commit`; the preliminary pre-commit report from Step 4 is not handoff evidence.

- [ ] **Step 8: Capture deterministic Artifact goldens and separate real-HTTP evidence**

Artifact candidates always use the development build and the capture-matrix Scenario IDs/fixed clock. Re-capture its four Developer Tools entries through Scenario Runner. On one iOS and one Android device running the development preview, record model/OS/WeChat/base-library versions and query `wx.getWindowInfo().windowWidth`. Replace the corresponding four null widths in `capture-matrix.yaml`, validate it, then make the required pre-capture commit:

Run the exact matrix/schema gate before its commit:

```bash
node --test tests/artifacts.test.mjs
node scripts/validate_capture_matrix.mjs --require-frozen-devices
git add artifacts/ui/golden/capture-matrix.yaml
git commit -m "test: freeze physical device capture widths"
git rev-parse HEAD
```

`validate_capture_matrix.mjs` validates both schemas, exact eight-key completeness and manifest equality; `--require-frozen-devices` additionally rejects any null/non-positive device width. Record the resulting commit SHA as `matrix_commit` in every subsequently captured device metadata file—capture must refuse a dirty matrix or a different HEAD. Only then capture the four device candidates. These four physical goldens verify the declared venue-ready and slots-ready layouts. Image/map/phone failure behavior remains Task 10 Scenario journey evidence; the four physical golden IDs do not claim those fault states.

Separately, use the production/experience build against staging to capture HTTP evidence under `docs/acceptance/evidence/http/`, not `artifacts/ui/golden/`: venue and availability on Developer Tools/iOS/Android, real 14-day window, day+13 seven-a-side empty response, selected wording, GCJ-02 map landing and phone action. Verify the production Network log contains only GETs and no Fixture/Scenario source. Do not claim a production image-failure test because production has no approved fault injection. Validate all eight Artifact candidate PNGs/metadata and the separate HTTP checklist; do not promote yet.

- [ ] **Step 9: Remove temporary production Fixture paths and prepare handoff evidence**

Regenerate production from a clean output, delete ignored `.dev-generated/`, and verify business pages import only HTTP services. Keep contract-derived Fixtures solely in `artifacts/ui/fixtures` and tests, and Scenario bindings solely under `miniprogram/dev`; they must not appear in upload output. Assemble the acceptance checklist with traceability evidence, staging verifier/P95 report, CI logs, package audit, known limitations, PRD completed/uncompleted scope, eight deterministic Artifact candidates/metadata, and clearly separated real-HTTP device evidence.

- [ ] **Step 10: Stop at the vertical-slice stage checkpoint for user review**

Do not start the booking slice. Present the importable Developer Tools project, staging/experience access, the two-screen real-HTTP journey, acceptance checklist, all eight screen-qualified deterministic Artifact candidates, separate HTTP evidence, environment metadata, and any blockers. If partner-confirmed venue content, Alibaba Cloud access, Mini Program AppID/domain configuration, iOS device, or Android device is missing, explicitly mark the current slice incomplete and stop without claiming acceptance.

- [ ] **Step 11: After explicit user acceptance, promote and verify canonical goldens**

Create `docs/acceptance/golden-acceptance-record.json` containing the accepted candidate SHA-256 values, user decision date, `implementation_commit` from Step 7 and the exact `matrix_commit` from Step 8. `scripts/promote-goldens.mjs` must reject missing acceptance records, implementation/matrix commit mismatch, candidate metadata from another matrix commit, hash mismatches, null device widths, schema failures or incomplete eight-key sets; it copies only the accepted candidates to canonical screen-qualified paths.

Run:

```bash
node scripts/promote-goldens.mjs docs/acceptance/golden-acceptance-record.json
WECHAT_DEVTOOLS_CLI="/absolute/path/to/cli" npm run test:miniprogram:visual
node scripts/compare-device-goldens.mjs --validate-canonical-only
npm run audit:miniprogram-package
```

Expected: eight baselines promoted; the four Developer Tools entries are immediately recaptured and satisfy SSIM `>=0.99` and changed pixels `<=0.5%`; the four device canonical files pass frozen-width/environment/schema/hash validation. `compare-device-goldens.mjs --candidate-dir <new-device-captures>` is the later device-regression entry and applies the same two thresholds only to newly supplied captures from the exact frozen device environments—it never fabricates or remotely captures device images. Package audit remains clean. If the user requests visual changes, return to Task 6/7, regenerate candidates and repeat the checkpoint; never overwrite canonical files silently.

- [ ] **Step 12: Commit accepted evidence, clean test infrastructure, and stop before the next slice**

```bash
git add docs/acceptance artifacts/ui/golden
git commit -m "feat: deliver venue browsing vertical slice"
export TEST_DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test
implementation_commit=$(node -p "require('./docs/acceptance/golden-acceptance-record.json').implementation_commit")
npm run lint
npm run typecheck
npm test
npm run build:miniprogram:production
npm run audit:miniprogram-package
uv run ruff check backend
uv run mypy backend
uv run pytest
STAGING_API_BASE_URL="$STAGING_API_BASE_URL" uv run python -m scripts.verify_staging --expected-revision "$implementation_commit" --output /tmp/pitch-booking-final-staging.json
docker compose config --quiet
git status --short
docker compose -f deploy/compose.test.yaml down --volumes
git status --short
```

Expected: all gates run while PostgreSQL is still available and PASS; both status outputs are empty; only after verification are the named test services/volume removed; staging is healthy at `implementation_commit`; accepted evidence is committed. Report this slice complete and wait; do not begin orders or payments.
