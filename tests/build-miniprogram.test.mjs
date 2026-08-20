import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import test from "node:test";

const execFileAsync = promisify(execFile);
const buildScript = path.resolve("scripts/build-miniprogram.mjs");
const TEST_TENCENT_MAP_KEY = "AAAAA-BBBBB-CCCCC-DDDDD-EEEEE-FFFFF";

function build(projectRoot, mode, environment = {}) {
  return execFileAsync(process.execPath, [buildScript, mode], {
    cwd: projectRoot,
    env: {
      ...process.env,
      ...(mode === "production" ? { MINIPROGRAM_TENCENT_MAP_KEY: TEST_TENCENT_MAP_KEY } : {}),
      ...environment,
    },
  });
}

for (const [description, source] of [
  ["syntactic", "const broken: = 1;\n"],
  ["semantic", 'const count: number = "wrong";\n'],
]) {
  test(`production build rejects ${description} TypeScript errors`, async (t) => {
    const projectRoot = await createBuildProject(source);
    t.after(() => rm(projectRoot, { recursive: true, force: true }));

    await assert.rejects(
      build(projectRoot, "production"),
      (error) => error.code !== 0 && /TS\d+/.test(error.stderr),
    );
  });
}

test("output resolution is restricted to allow-listed children of dist", async () => {
  const moduleUrl = pathToFileURL(buildScript).href;
  const verification = `
    import assert from "node:assert/strict";
    import path from "node:path";
    const { resolveOutputRoot } = await import(${JSON.stringify(moduleUrl)});
    const root = path.resolve("safe-project");
    assert.equal(resolveOutputRoot("production", root), path.join(root, "dist/miniprogram-production"));
    assert.equal(resolveOutputRoot("development", root), path.join(root, "dist/miniprogram-development"));
    assert.throws(() => resolveOutputRoot("../outside", root));
  `;

  await execFileAsync(process.execPath, ["--input-type=module", "--eval", verification]);
});

test("build rejects a symlinked dist parent without deleting external output", async (t) => {
  const sandboxRoot = await mkdtemp(path.join(tmpdir(), "pitch-booking-build-boundary-"));
  t.after(() => rm(sandboxRoot, { recursive: true, force: true }));
  const projectRoot = await createBuildProjectIn(path.join(sandboxRoot, "project"), "");
  const externalRoot = path.join(sandboxRoot, "external");
  const sentinel = path.join(externalRoot, "miniprogram-production/sentinel");
  await mkdir(path.dirname(sentinel), { recursive: true });
  await writeFile(sentinel, "preserve\n");
  await symlink(externalRoot, path.join(projectRoot, "dist"));

  let rejected = false;
  try {
    await build(projectRoot, "production");
  } catch {
    rejected = true;
  }

  assert.equal(existsSync(sentinel), true, "external sentinel was deleted");
  assert.equal(rejected, true, "build accepted a symlinked dist parent");
});

test("build rejects a symlinked output child without deleting its target", async (t) => {
  const sandboxRoot = await mkdtemp(path.join(tmpdir(), "pitch-booking-build-boundary-"));
  t.after(() => rm(sandboxRoot, { recursive: true, force: true }));
  const projectRoot = await createBuildProjectIn(path.join(sandboxRoot, "project"), "");
  const externalOutput = path.join(sandboxRoot, "external-output");
  const sentinel = path.join(externalOutput, "sentinel");
  await mkdir(path.join(projectRoot, "dist"));
  await mkdir(externalOutput);
  await writeFile(sentinel, "preserve\n");
  await symlink(externalOutput, path.join(projectRoot, "dist/miniprogram-production"));

  let rejected = false;
  try {
    await build(projectRoot, "production");
  } catch {
    rejected = true;
  }

  assert.equal(existsSync(sentinel), true, "external sentinel was deleted");
  assert.equal(rejected, true, "build accepted a symlinked output child");
});

test("production and development builds exclude test and spec TypeScript", async (t) => {
  const projectRoot = await createBuildProject("");
  t.after(() => rm(projectRoot, { recursive: true, force: true }));
  await writeFile(
    path.join(projectRoot, "miniprogram/domain-boundary.test.ts"),
    'const invalid: number = "test-only"; jest.requireActual("../../contracts/examples/venue-primary.json");\n',
  );
  await writeFile(
    path.join(projectRoot, "miniprogram/domain-boundary.spec.ts"),
    'expect("test-only").toBeDefined();\n',
  );

  for (const mode of ["production", "development"]) {
    await build(projectRoot, mode);
    const outputRoot = path.join(projectRoot, `dist/miniprogram-${mode}`);
    assert.equal(existsSync(path.join(outputRoot, "domain-boundary.test.js")), false);
    assert.equal(existsSync(path.join(outputRoot, "domain-boundary.test.ts")), false);
    assert.equal(existsSync(path.join(outputRoot, "domain-boundary.spec.js")), false);
    assert.equal(existsSync(path.join(outputRoot, "domain-boundary.spec.ts")), false);
  }
});

test("Scenario runtime is development-only", async (t) => {
  const projectRoot = await createBuildProject("");
  t.after(() => rm(projectRoot, { recursive: true, force: true }));
  await mkdir(path.join(projectRoot, "miniprogram/runtime"));
  await writeFile(path.join(projectRoot, "miniprogram/runtime/interfaces.ts"), "export interface Clock { now(): Date; }\n");
  await writeFile(path.join(projectRoot, "miniprogram/runtime/scenario.ts"), "export const scenarioMarker = true;\n");
  await writeFile(path.join(projectRoot, "miniprogram/dev/fixture-transport.ts"), "export const fixtureMarker = true;\n");

  await build(projectRoot, "production");
  assert.equal(existsSync(path.join(projectRoot, "dist/miniprogram-production/runtime/interfaces.js")), true);
  assert.equal(existsSync(path.join(projectRoot, "dist/miniprogram-production/runtime/scenario.js")), false);
  assert.equal(existsSync(path.join(projectRoot, "dist/miniprogram-production/dev/fixture-transport.js")), false);

  await build(projectRoot, "development");
  assert.equal(existsSync(path.join(projectRoot, "dist/miniprogram-development/runtime/scenario.js")), true);
  assert.equal(existsSync(path.join(projectRoot, "dist/miniprogram-development/dev/fixture-transport.js")), true);
});

test("development app invokes its single composition root before source app code can open a page", async (t) => {
  const projectRoot = await createBuildProject(
    'const venueFallbackUrl = "https://example.test/cover.png";\nPage({ route: "direct-availability" });\nApp({});\n',
  );
  t.after(() => rm(projectRoot, { recursive: true, force: true }));

  await build(projectRoot, "development");
  const app = await readFile(path.join(projectRoot, "dist/miniprogram-development/app.js"), "utf8");
  const devImport = app.indexOf('require("./dev/bootstrap")');
  const registration = app.indexOf("bootstrapDevelopment");
  const venueFallback = app.indexOf("venueFallbackUrl");
  const directPage = app.indexOf("Page({");

  assert.notEqual(devImport, -1);
  assert.notEqual(registration, -1);
  assert.equal(devImport < registration, true);
  assert.equal(registration < venueFallback, true);
  assert.equal(registration < directPage, true);
});

test("owner cancellation preview source is selectable in development and excluded from production", async (t) => {
  await build(process.cwd(), "development", {
    MINIPROGRAM_DEV_BOOKING_SOURCE: "order-cancellation",
  });
  const developmentRoot = path.resolve("dist/miniprogram-development");
  const developmentApp = await readFile(path.join(developmentRoot, "app.js"), "utf8");

  assert.match(developmentApp, /bootstrapDevelopment\)\(\{\s*source:\s*["']order-cancellation["']/s);
  assert.equal(existsSync(path.join(developmentRoot, "dev/order-cancellation-fixture.js")), true);
  assert.equal(existsSync(path.join(developmentRoot, "dev/order-cancellation-route-fragment.js")), true);

  await build(process.cwd(), "production");
  const productionRoot = path.resolve("dist/miniprogram-production");
  const productionFiles = await collectFiles(productionRoot);
  const productionText = (await Promise.all(productionFiles
    .filter((file) => !file.endsWith(".png"))
    .map((file) => readFile(file, "utf8")))).join("\n");
  assert.equal(existsSync(path.join(productionRoot, "dev/order-cancellation-fixture.js")), false);
  assert.equal(existsSync(path.join(productionRoot, "dev/order-cancellation-route-fragment.js")), false);
  assert.doesNotMatch(productionText, /order-cancellation|createOrderCancellationFixture/);

  t.after(() => rm(path.resolve("dist"), { recursive: true, force: true }));
});

test("production app registers HTTP data, venue fulfillment, Tencent POI, and native payment before source app code", async (t) => {
  const projectRoot = await createBuildProject('const venueFallbackUrl = "https://example.test/cover.png";\nApp({});\n');
  t.after(() => rm(projectRoot, { recursive: true, force: true }));

  await build(projectRoot, "production");
  const app = await readFile(path.join(projectRoot, "dist/miniprogram-production/app.js"), "utf8");

  assert.match(app, /venueFallbackUrl/);
  assert.match(app, /productionRuntime/);
  assert.match(app, /createHttpPageDataSource/);
  assert.match(app, /registerPageDataSource/);
  assert.match(app, /createHttpVenueDirectoryDataSource/);
  assert.match(app, /registerVenueDirectoryDataSource/);
  assert.match(app, /createHttpVenueProfileDataSource/);
  assert.match(app, /registerVenueProfileDataSource/);
  assert.match(app, /createHttpVenueAccessDataSource/);
  assert.match(app, /registerVenueAccessDataSource/);
  assert.match(app, /createHttpVenueOnboardingDataSource/);
  assert.match(app, /registerVenueOnboardingDataSource/);
  assert.match(app, /registerVenueOnboardingEvidenceCapability/);
  assert.match(app, /registerVenueProfileMediaCapability/);
  assert.match(app, /registerLocationCapability/);
  assert.match(app, /productionLocation/);
  assert.match(app, /createHttpBookingDataSource/);
  assert.match(app, /registerBookingDataSource/);
  assert.match(app, /createSessionStore/);
  assert.match(app, /createHttpPaymentDataSource/);
  assert.match(app, /registerPaymentDataSource/);
  assert.match(app, /productionPayment/);
  assert.match(app, /registerPaymentCapability/);
  assert.match(app, /createHttpVenueFulfillmentDataSource/);
  assert.match(app, /registerVenueFulfillmentDataSource/);
  assert.match(app, /createVenueFulfillmentAttemptStore/);
  assert.match(app, /registerVenueFulfillmentAttemptStore/);
  assert.match(app, /attemptStore:\s*venueFulfillmentAttemptStore/);
  assert.match(app, /productionSessionStorage/);
  assert.match(app, /productionPhone/);
  assert.match(app, /TencentPoiSearchCapability/);
  assert.match(app, /productionTencentPoiRequest/);
  assert.match(app, /registerPoiSearchCapability/);
  assert.equal(app.indexOf("registerPageDataSource") < app.indexOf("venueFallbackUrl"), true);
  assert.equal(app.indexOf("registerBookingDataSource") < app.indexOf("venueFallbackUrl"), true);
  assert.equal(app.indexOf("registerVenueProfileDataSource") < app.indexOf("venueFallbackUrl"), true);
  assert.equal(app.indexOf("registerVenueAccessDataSource") < app.indexOf("venueFallbackUrl"), true);
  assert.equal(app.indexOf("registerVenueOnboardingDataSource") < app.indexOf("venueFallbackUrl"), true);
  assert.equal(app.indexOf("registerVenueOnboardingEvidenceCapability") < app.indexOf("venueFallbackUrl"), true);
  assert.equal(app.indexOf("registerVenueProfileMediaCapability") < app.indexOf("venueFallbackUrl"), true);
  assert.equal(app.indexOf("registerPaymentDataSource") < app.indexOf("venueFallbackUrl"), true);
  assert.equal(app.indexOf("registerPaymentCapability") < app.indexOf("venueFallbackUrl"), true);
  assert.equal(app.indexOf("registerVenueFulfillmentAttemptStore") < app.indexOf("venueFallbackUrl"), true);
  assert.equal(app.indexOf("registerVenueFulfillmentDataSource") < app.indexOf("venueFallbackUrl"), true);
  assert.equal(app.indexOf("registerPoiSearchCapability") < app.indexOf("venueFallbackUrl"), true);
  assert.doesNotMatch(app, /dev\/|fixture/i);
});

test("temporary map previews are absent while the approved center asset remains", async (t) => {
  await build(process.cwd(), "development");
  await build(process.cwd(), "production");
  const developmentRoot = path.resolve("dist/miniprogram-development");
  const productionRoot = path.resolve("dist/miniprogram-production");
  t.after(() => rm(path.resolve("dist"), { recursive: true, force: true }));

  for (const relativePath of [
    "services/venue-map-preview.js",
    "dev/venue-map-preview-fixture.js",
    "dev/poi-search-preview.js",
  ]) {
    assert.equal(existsSync(path.join(developmentRoot, relativePath)), false, relativePath);
    assert.equal(existsSync(path.join(productionRoot, relativePath)), false, relativePath);
  }
  assert.equal(existsSync(path.join(developmentRoot, "assets/map-search-center.png")), true);
  assert.equal(existsSync(path.join(productionRoot, "assets/map-search-center.png")), true);
  for (const route of ["dev/pages/venue-access/index", "dev/pages/venue-claim/index", "dev/pages/venue-create/index"]) {
    for (const extension of ["js", "json", "wxml", "wxss"])
      assert.equal(existsSync(path.join(developmentRoot, `${route}.${extension}`)), true, `${route}.${extension}`);
    assert.equal(existsSync(path.join(productionRoot, `${route}.js`)), false, route);
  }
  const developmentText = (await Promise.all((await collectFiles(developmentRoot))
    .filter((file) => !file.endsWith(".png"))
    .map((file) => readFile(file, "utf8")))).join("\n");
  const productionText = (await Promise.all((await collectFiles(productionRoot))
    .filter((file) => !file.endsWith(".png"))
    .map((file) => readFile(file, "utf8")))).join("\n");
  const previewSymbols = /VenueDistrictSidecar|venue-map-preview|poi-search-preview|DEV_ONLY_POI_SEARCH_PREVIEW|previewPoiSearchCapability/;
  assert.doesNotMatch(developmentText, previewSymbols);
  assert.doesNotMatch(productionText, previewSymbols);
  assert.match(developmentText, /VENUE_(?:ACCESS|CLAIM|CREATE)_ONBOARDING_FIXTURES/);
  assert.doesNotMatch(productionText, /VENUE_(?:ACCESS|CLAIM|CREATE)_ONBOARDING_FIXTURES/);
});

test("retired my orders previews stay absent while the production route remains", async (t) => {
  const previewRoutes = ["dev/pages/my-orders-map/index", "dev/pages/my-orders/index"];
  const retiredSourcePaths = [
    "miniprogram/dev/my-orders-fixture.ts",
    ...previewRoutes.flatMap((route) => ["ts", "json", "wxml", "wxss", "test.ts"].map((extension) => `miniprogram/${route}.${extension}`)),
  ];
  const developmentSourceManifest = JSON.parse(await readFile("miniprogram/dev/app-pages.json", "utf8"));

  for (const sourcePath of retiredSourcePaths) {
    assert.equal(existsSync(sourcePath), false, `temporary asset still exists: ${sourcePath}`);
  }
  for (const route of previewRoutes) {
    assert.equal(developmentSourceManifest.pages.includes(route), false, `${route} remains in the development manifest`);
  }

  await build(process.cwd(), "development");
  await build(process.cwd(), "production");
  const developmentRoot = path.resolve("dist/miniprogram-development");
  const productionRoot = path.resolve("dist/miniprogram-production");
  t.after(() => rm(path.resolve("dist"), { recursive: true, force: true }));
  const developmentManifest = JSON.parse(await readFile(path.join(developmentRoot, "app.json"), "utf8"));
  const productionManifest = JSON.parse(await readFile(path.join(productionRoot, "app.json"), "utf8"));

  for (const route of previewRoutes) {
    assert.equal(developmentManifest.pages.includes(route), false, `${route} remains in development`);
    assert.equal(productionManifest.pages.includes(route), false, `${route} leaked into production`);
    for (const root of [developmentRoot, productionRoot]) {
      for (const extension of ["js", "json", "wxml", "wxss"]) {
        assert.equal(existsSync(path.join(root, `${route}.${extension}`)), false, `${route}.${extension} remains in ${root}`);
      }
    }
  }
  assert.equal(developmentManifest.pages.includes("pages/my-orders/index"), true);
  assert.equal(productionManifest.pages.includes("pages/my-orders/index"), true);
  assert.equal(existsSync(path.join(developmentRoot, "dev/my-orders-fixture.js")), false);
  assert.equal(existsSync(path.join(productionRoot, "dev/my-orders-fixture.js")), false);
});

test("real production build emits all fourteen production routes as native artifacts", async (t) => {
  await build(process.cwd(), "production");
  const outputRoot = path.resolve("dist/miniprogram-production");
  t.after(() => rm(outputRoot, { recursive: true, force: true }));
  const manifest = JSON.parse(await readFile(path.join(outputRoot, "app.json"), "utf8"));
  const routes = [
    "pages/intent-entry/index",
    "pages/venue-access/index",
    "pages/venue-claim/index",
    "pages/venue-create/index",
    "pages/venue-map/index",
    "pages/venue/index",
    "pages/availability/index",
    "pages/booking-confirmation/index",
    "pages/order-detail/index",
    "pages/my-orders/index",
    "pages/venue-profile/index",
    "pages/venue-inventory/index",
    "pages/venue-pitch-setup/index",
    "pages/venue-fulfillment/index",
  ];
  assert.deepEqual(manifest.pages, routes);
  for (const route of routes) {
    for (const extension of ["js", "json", "wxml", "wxss"])
      assert.equal(existsSync(path.join(outputRoot, `${route}.${extension}`)), true);
    assert.equal(existsSync(path.join(outputRoot, `${route}.ts`)), false);
  }
  assert.equal(existsSync(path.join(outputRoot, "route-fragments/venue-fulfillment.json")), false);
  const productionText = (await Promise.all((await collectFiles(outputRoot))
    .filter((file) => !file.endsWith(".png"))
    .map((file) => readFile(file, "utf8")))).join("\n");
  assert.doesNotMatch(productionText, /venue-onboarding-fixture|VENUE_(?:ACCESS|CLAIM|CREATE)_ONBOARDING_FIXTURES|视觉预览，不会提交/);
});

test("production API URL override changes generated production config only", async (t) => {
  const projectRoot = await createBuildProject("");
  t.after(() => rm(projectRoot, { recursive: true, force: true }));
  await mkdir(path.join(projectRoot, "miniprogram/config"));
  const runtimePath = path.join(projectRoot, "miniprogram/config/runtime.ts");
  await writeFile(runtimePath, [
    'export const API_BASE_URL = "https://placeholder.invalid";',
    'export const MINIPROGRAM_TENCENT_MAP_KEY = "TENCENT_MAP_KEY_REQUIRED";',
    "",
  ].join("\n"));

  await build(projectRoot, "production", { MINIPROGRAM_API_BASE_URL: "https://api.modelstella.com" });
  await build(projectRoot, "development", { MINIPROGRAM_API_BASE_URL: "https://api.modelstella.com" });

  assert.match(
    await readFile(path.join(projectRoot, "dist/miniprogram-production/config/runtime.js"), "utf8"),
    /https:\/\/api\.modelstella\.com/,
  );
  assert.match(
    await readFile(path.join(projectRoot, "dist/miniprogram-production/config/runtime.js"), "utf8"),
    new RegExp(TEST_TENCENT_MAP_KEY),
  );
  assert.match(
    await readFile(path.join(projectRoot, "dist/miniprogram-development/config/runtime.js"), "utf8"),
    /https:\/\/placeholder\.invalid/,
  );
  assert.match(await readFile(runtimePath, "utf8"), /https:\/\/placeholder\.invalid/);
  assert.match(await readFile(runtimePath, "utf8"), /TENCENT_MAP_KEY_REQUIRED/);
});

test("production build requires a format-valid Tencent client key", async (t) => {
  const projectRoot = await createBuildProject("");
  t.after(() => rm(projectRoot, { recursive: true, force: true }));

  await assert.rejects(
    build(projectRoot, "production", { MINIPROGRAM_TENCENT_MAP_KEY: "" }),
    /MINIPROGRAM_TENCENT_MAP_KEY is required/,
  );
  await assert.rejects(
    build(projectRoot, "production", { MINIPROGRAM_TENCENT_MAP_KEY: "TENCENT_MAP_KEY_REQUIRED" }),
    /MINIPROGRAM_TENCENT_MAP_KEY must be a valid Tencent client key/,
  );
});

test("production build rejects a non-HTTP API URL override", async (t) => {
  const projectRoot = await createBuildProject("");
  t.after(() => rm(projectRoot, { recursive: true, force: true }));

  await assert.rejects(
    build(projectRoot, "production", { MINIPROGRAM_API_BASE_URL: "file:///tmp/api" }),
    /MINIPROGRAM_API_BASE_URL must use http or https/,
  );
});

test("built development Scenario runtime is self-contained without URL", async (t) => {
  const projectRoot = await createBuildProject("");
  t.after(() => rm(projectRoot, { recursive: true, force: true }));
  await cp("miniprogram/runtime", path.join(projectRoot, "miniprogram/runtime"), { recursive: true });
  await mkdir(path.join(projectRoot, "miniprogram/services"));
  await writeFile(
    path.join(projectRoot, "miniprogram/services/session-store.ts"),
    "export interface SessionStorage { get(key: string): unknown; set(key: string, value: unknown): void; remove(key: string): void; }\n",
  );
  await writeFile(
    path.join(projectRoot, "miniprogram/services/tencent-poi-search.ts"),
    "export type TencentPoiRequest = (input: { readonly url: string; readonly data: Readonly<Record<string, string>> }) => Promise<unknown>;\n",
  );
  await writeFile(
    path.join(projectRoot, "miniprogram/services/venue-profile.ts"),
    [
      "export interface VenueProfileMediaCapability {",
      "  chooseImage(): Promise<{ readonly filename: string; readonly mimeType: 'image/jpeg' | 'image/png' | 'image/webp'; readonly byteSize: number; readonly bytes: ArrayBuffer }>;",
      "  upload(signedPutUrl: string, bytes: ArrayBuffer, requiredHeaders: Readonly<Record<string, string>>): Promise<void>;",
      "}",
      "",
    ].join("\n"),
  );
  await mkdir(path.join(projectRoot, "miniprogram/domain"));
  await cp("miniprogram/domain/booking.ts", path.join(projectRoot, "miniprogram/domain/booking.ts"));
  await cp("miniprogram/domain/payment.ts", path.join(projectRoot, "miniprogram/domain/payment.ts"));
  await cp("miniprogram/dev/fixture-transport.ts", path.join(projectRoot, "miniprogram/dev/fixture-transport.ts"));
  if (existsSync("miniprogram/dev/fixture-data.ts")) {
    await cp("miniprogram/dev/fixture-data.ts", path.join(projectRoot, "miniprogram/dev/fixture-data.ts"));
  }
  await build(projectRoot, "development");
  const outputRoot = path.join(projectRoot, "dist/miniprogram-development");
  for (const file of await collectFiles(outputRoot)) {
    const source = await readFile(file, "utf8");
    assert.doesNotMatch(source, /node:fs|["']yaml["']|\bnew URL\b/);
  }

  const verification = `
    void (async () => {
      global.URL = undefined;
      const assert = require("node:assert/strict");
      const { scenarioRuntime } = require("./runtime/scenario.js");
      const { FIXTURE_DATA } = require("./dev/fixture-data.js");
      const names = [
        "venue-ready", "slots-ready", "slots-empty",
        "booking-checkout-ready", "order-pending", "order-expired",
        "order-confirmed", "order-payment-confirming", "order-payment-exception",
        "venue-map", "venue-online-detail", "venue-directory-detail",
      ];
      assert.deepEqual(Object.keys(FIXTURE_DATA).sort(), [...names].sort());
      assert.equal(Object.isFrozen(FIXTURE_DATA), true);
      assert.equal(Object.isFrozen(FIXTURE_DATA["venue-ready"]), true);
      assert.equal(Object.isFrozen(FIXTURE_DATA["venue-ready"].profile.images), true);
      assert.equal(Object.isFrozen(FIXTURE_DATA["venue-ready"].profile.images[0]), true);
      const originalCover = FIXTURE_DATA["venue-ready"].profile.images[0].url;
      FIXTURE_DATA["venue-ready"].profile.images[0].url = "https://mutated.invalid/cover.jpg";
      assert.equal(FIXTURE_DATA["venue-ready"].profile.images[0].url, originalCover);
      for (const name of names) {
        const runtime = scenarioRuntime({
          id: name,
          clock: "2026-07-22T10:30:00+08:00",
          http: [{ match: {}, fixture: name }],
        });
        const value = await runtime.transport.get("/resource");
        assert.equal(typeof value, "object");
        value.__scenarioMutation = true;
        const freshValue = await scenarioRuntime({
          id: name,
          clock: "2026-07-22T10:30:00+08:00",
          http: [{ match: {}, fixture: name }],
        }).transport.get("/resource");
        assert.equal(freshValue.__scenarioMutation, undefined);
      }
      assert.equal(typeof FIXTURE_DATA["venue-ready"].name, "string");
      assert.equal(FIXTURE_DATA["slots-ready"].pitches.length > 0, true);
      assert.deepEqual(FIXTURE_DATA["slots-empty"].pitches, []);
    })();
  `;
  await execFileAsync(process.execPath, ["--input-type=commonjs", "--eval", verification], { cwd: outputRoot });
});

test("development build rejects Fixture drift from canonical examples", async (t) => {
  const projectRoot = await createRealDevelopmentBuildProject();
  t.after(() => rm(projectRoot, { recursive: true, force: true }));
  const fixturePath = path.join(projectRoot, "artifacts/ui/fixtures/slots-ready.json");
  const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
  fixture.pitches = [];
  await writeFile(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`);

  await assert.rejects(
    build(projectRoot, "development"),
    /Fixture differs from canonical example/,
  );
});

test("development build rejects non-normalized Fixture bytes", async (t) => {
  const projectRoot = await createRealDevelopmentBuildProject();
  t.after(() => rm(projectRoot, { recursive: true, force: true }));
  const fixturePath = path.join(projectRoot, "artifacts/ui/fixtures/slots-empty.json");
  await writeFile(fixturePath, `${await readFile(fixturePath, "utf8")} `);

  await assert.rejects(
    build(projectRoot, "development"),
    /Fixture is not normalized/,
  );
});

test("development build runs full contract validation before generating Fixture data", async (t) => {
  const projectRoot = await createRealDevelopmentBuildProject();
  t.after(() => rm(projectRoot, { recursive: true, force: true }));
  await writeFile(path.join(projectRoot, "contracts/openapi.yaml"), "openapi: 3.1.0\ninfo: {}\npaths: {}\n");

  await assert.rejects(
    build(projectRoot, "development"),
    /Contract validation failed|operation matrix|must have required property/,
  );
  assert.equal(existsSync(path.join(projectRoot, "dist/miniprogram-development/dev/fixture-data.js")), false);
});

for (const symlinkedComponent of ["artifacts", "artifacts/ui", "artifacts/ui/fixtures"]) {
  test(`development build rejects symlinked input component ${symlinkedComponent}`, async (t) => {
    const projectRoot = await createRealDevelopmentBuildProject();
    t.after(() => rm(projectRoot, { recursive: true, force: true }));
    const externalRoot = await mkdtemp(path.join(tmpdir(), "pitch-booking-fixture-external-"));
    t.after(() => rm(externalRoot, { recursive: true, force: true }));
    const componentPath = path.join(projectRoot, symlinkedComponent);
    await cp(componentPath, externalRoot, { recursive: true });
    await rm(componentPath, { recursive: true });
    await symlink(externalRoot, componentPath);

    await assert.rejects(
      build(projectRoot, "development"),
      /symlink/,
    );
  });
}

async function createBuildProject(source) {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "pitch-booking-build-"));
  return createBuildProjectIn(projectRoot, source);
}

async function createRealDevelopmentBuildProject() {
  return createBuildProject("");
}

async function createBuildProjectIn(projectRoot, source) {
  const sourceRoot = path.join(projectRoot, "miniprogram");
  await mkdir(sourceRoot, { recursive: true });
  await mkdir(path.join(sourceRoot, "dev"));
  await writeFile(path.join(sourceRoot, "dev/app-pages.json"), '{"pages":[]}\n');
  await cp("contracts", path.join(projectRoot, "contracts"), { recursive: true });
  await mkdir(path.join(projectRoot, "artifacts/ui"), { recursive: true });
  await cp("artifacts/ui/fixtures", path.join(projectRoot, "artifacts/ui/fixtures"), { recursive: true });
  await writeFile(path.join(sourceRoot, "app.json"), '{"pages":[]}\n');
  await writeFile(path.join(sourceRoot, "app.ts"), source);
  return projectRoot;
}

async function collectFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectFiles(entryPath)));
    else files.push(entryPath);
  }
  return files;
}
