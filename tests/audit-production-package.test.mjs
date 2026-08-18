import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import test from "node:test";

const execFileAsync = promisify(execFile);
const auditScript = path.resolve("scripts/audit-production-package.mjs");

for (const token of [
  "fixtureVenue",
  "FixtureRepository",
  "fixtures:generate",
  "FIXTURE_MODE",
  "ScenarioClock",
  "ScenarioTransport",
  "ScenarioClockStub",
  "PAYMENT_SCENARIOS",
  "createDevelopmentPaymentDataSource",
  "createDevelopmentPaymentCapability",
  "模拟支付，不会扣款",
  "createDevelopmentVenueDirectoryDataSource",
  "createSimulatedLocationCapability",
  "previewPoiSearchCapability",
  "DEV_ONLY_POI_SEARCH_PREVIEW",
  "poi-search-preview",
  "7e68d7d8-4b7e-4f04-a5c5-3fe263e69c6f",
  "MY_ORDERS_RAW_FIXTURE",
  "VENUE_FULFILLMENT_FIXTURE",
]) {
  test(`production audit rejects ${token}`, async (t) => {
    const packageRoot = await createProductionPackage();
    t.after(() => rm(packageRoot, { recursive: true, force: true }));
    await writeFile(path.join(packageRoot, "app.js"), `const marker = "${token}";\n`);

    await assertAuditRejects(packageRoot, token);
  });
}

test("production audit rejects a dev path", async (t) => {
  const packageRoot = await createProductionPackage();
  t.after(() => rm(packageRoot, { recursive: true, force: true }));
  await mkdir(path.join(packageRoot, "dev"));
  await writeFile(path.join(packageRoot, "dev/bootstrap.js"), "\n");

  await assertAuditRejects(packageRoot, "dev/bootstrap.js");
});

test("production audit rejects a .dev-generated path", async (t) => {
  const packageRoot = await createProductionPackage();
  t.after(() => rm(packageRoot, { recursive: true, force: true }));
  await writeFile(path.join(packageRoot, ".dev-generated.js"), "\n");

  await assertAuditRejects(packageRoot, ".dev-generated.js");
});

test("production audit rejects a development route", async (t) => {
  const packageRoot = await createProductionPackage();
  t.after(() => rm(packageRoot, { recursive: true, force: true }));
  await writeFile(path.join(packageRoot, "app.js"), 'const route = "dev/tools/index";\n');

  await assertAuditRejects(packageRoot, "dev/");
});

test("production audit rejects a missing required artifact", async (t) => {
  const packageRoot = await createProductionPackage();
  t.after(() => rm(packageRoot, { recursive: true, force: true }));
  await rm(path.join(packageRoot, "pages/venue/index.js"));

  await assertAuditRejects(packageRoot, "missing: pages/venue/index.js");
});

test("production audit rejects a TypeScript route artifact", async (t) => {
  const packageRoot = await createProductionPackage();
  t.after(() => rm(packageRoot, { recursive: true, force: true }));
  await writeFile(path.join(packageRoot, "pages/venue/index.ts"), "\n");

  await assertAuditRejects(packageRoot, "TypeScript source: pages/venue/index.ts");
});

for (const filename of ["domain/decoder.test.js", "domain/decoder.spec.js"]) {
  test(`production audit rejects test artifact ${filename}`, async (t) => {
    const packageRoot = await createProductionPackage();
    t.after(() => rm(packageRoot, { recursive: true, force: true }));
    await mkdir(path.dirname(path.join(packageRoot, filename)), { recursive: true });
    await writeFile(path.join(packageRoot, filename), "\n");

    await assertAuditRejects(packageRoot, filename);
  });
}

for (const [source, diagnostic] of [
  ['jest.requireActual("../../contracts/examples/venue-primary.json");\n', "jest."],
  ['expect(value).toEqual(expected);\n', "expect("],
]) {
  test(`production audit rejects Jest global ${diagnostic}`, async (t) => {
    const packageRoot = await createProductionPackage();
    t.after(() => rm(packageRoot, { recursive: true, force: true }));
    await writeFile(path.join(packageRoot, "app.js"), source);

    await assertAuditRejects(packageRoot, diagnostic);
  });
}

test("production audit rejects contract-example references", async (t) => {
  const packageRoot = await createProductionPackage();
  t.after(() => rm(packageRoot, { recursive: true, force: true }));
  await writeFile(
    path.join(packageRoot, "app.js"),
    'const example = require("../../contracts/examples/venue-primary.json");\n',
  );

  await assertAuditRejects(packageRoot, "contracts/examples/");
});

for (const [description, source, diagnostic] of [
  ["Jest ESM import", 'import { expect } from "@jest/globals";\n', "@jest/globals"],
  ["compiled Jest require", 'const globals = require("@jest/globals");\n', "@jest/globals"],
  ["Node test require", 'const test = require("node:test");\n', "node:test"],
  ["Vitest import", 'import { describe } from "vitest";\n', "vitest"],
  ["Jest dynamic subpath import", 'const runner = import ( "@jest/globals/internal" );\n', "@jest/globals/internal"],
  ["Node test static subpath import", 'import reporter from "node:test/reporters";\n', "node:test/reporters"],
  ["Vitest bare subpath import", 'import "vitest/config";\n', "vitest/config"],
  ["Mocha spaced subpath require", "const runner = require ( 'mocha/lib/mocha' );\n", "mocha/lib/mocha"],
]) {
  test(`production audit rejects ${description}`, async (t) => {
    const packageRoot = await createProductionPackage();
    t.after(() => rm(packageRoot, { recursive: true, force: true }));
    await writeFile(path.join(packageRoot, "ordinary-production-name.js"), source);

    await assertAuditRejects(packageRoot, diagnostic);
  });
}

test("production audit accepts harmless runner-name string literals", async (t) => {
  const packageRoot = await createProductionPackage();
  t.after(() => rm(packageRoot, { recursive: true, force: true }));
  await installValidPaymentComposition(packageRoot, 'const flavor = "mocha";\nconst label = "vitest";\n');

  const result = await execFileAsync(process.execPath, [auditScript, packageRoot]);
  assert.match(result.stdout, /0 forbidden paths\/tokens/);
});

test("production audit requires compiled artifacts to be regular files", async (t) => {
  const packageRoot = await createProductionPackage();
  t.after(() => rm(packageRoot, { recursive: true, force: true }));
  const compiledArtifact = path.join(packageRoot, "pages/venue/index.js");
  await rm(compiledArtifact);
  await mkdir(compiledArtifact);

  await assertAuditRejects(packageRoot, "not a regular file: pages/venue/index.js");
});

test("production audit rejects a symlinked required artifact", async (t) => {
  const packageRoot = await createProductionPackage();
  t.after(() => rm(packageRoot, { recursive: true, force: true }));
  const compiledArtifact = path.join(packageRoot, "pages/venue/index.js");
  await rm(compiledArtifact);
  await symlink("../availability/index.js", compiledArtifact);

  await assertAuditRejects(packageRoot, "symlink: pages/venue/index.js");
});

test("production audit accepts ordinary production code", async (t) => {
  const packageRoot = await createProductionPackage();
  t.after(() => rm(packageRoot, { recursive: true, force: true }));
  await installValidPaymentComposition(packageRoot, 'const bookingMode = "production";\n');

  const result = await execFileAsync(process.execPath, [auditScript, packageRoot]);
  assert.match(result.stdout, /0 forbidden paths\/tokens/);
});

test("production audit rejects a missing Tencent map key config", async (t) => {
  const packageRoot = await createProductionPackage();
  t.after(() => rm(packageRoot, { recursive: true, force: true }));
  await installValidPaymentComposition(packageRoot);
  await rm(path.join(packageRoot, "config/runtime.js"));

  await assertAuditRejects(packageRoot, "missing Tencent map key config");
});

for (const value of ["TENCENT_MAP_KEY_REQUIRED", "invalid-key"]) {
  test(`production audit rejects Tencent map key value ${value}`, async (t) => {
    const packageRoot = await createProductionPackage();
    t.after(() => rm(packageRoot, { recursive: true, force: true }));
    await installValidPaymentComposition(packageRoot);
    await writeFile(
      path.join(packageRoot, "config/runtime.js"),
      `exports.MINIPROGRAM_TENCENT_MAP_KEY = ${JSON.stringify(value)};\n`,
    );

    await assertAuditRejects(packageRoot, "invalid Tencent map key config");
  });
}

for (const [description, source] of [
  ["commented assignment", '// exports.MINIPROGRAM_TENCENT_MAP_KEY = "AAAAA-BBBBB-CCCCC-DDDDD-EEEEE-FFFFF";\n'],
  ["unrelated string", 'const text = \'exports.MINIPROGRAM_TENCENT_MAP_KEY = "AAAAA-BBBBB-CCCCC-DDDDD-EEEEE-FFFFF";\';\n'],
  ["nested dead assignment", 'if (false) { exports.MINIPROGRAM_TENCENT_MAP_KEY = "AAAAA-BBBBB-CCCCC-DDDDD-EEEEE-FFFFF"; }\n'],
]) {
  test(`production audit rejects a Tencent key found only in ${description}`, async (t) => {
    const packageRoot = await createProductionPackage();
    t.after(() => rm(packageRoot, { recursive: true, force: true }));
    await installValidPaymentComposition(packageRoot);
    await writeFile(path.join(packageRoot, "config/runtime.js"), source);

    await assertAuditRejects(packageRoot, "invalid Tencent map key config");
  });
}

const VALID_TENCENT_KEY_ASSIGNMENT = 'exports.MINIPROGRAM_TENCENT_MAP_KEY = "AAAAA-BBBBB-CCCCC-DDDDD-EEEEE-FFFFF";';
for (const [description, mutation] of [
  ["a parse error", "const = ;"],
  ["a second key assignment", VALID_TENCENT_KEY_ASSIGNMENT],
  ["a module.exports replacement", "module.exports = {};"],
  ["a later key deletion", "delete exports.MINIPROGRAM_TENCENT_MAP_KEY;"],
  ["an exports rebind", "exports = {};"],
  [
    "a defineProperty mutation",
    'Object.defineProperty(exports, "MINIPROGRAM_TENCENT_MAP_KEY", { value: "AAAAA-BBBBB-CCCCC-DDDDD-EEEEE-FFFFF" });',
  ],
]) {
  test(`production audit rejects a valid Tencent key followed by ${description}`, async (t) => {
    const packageRoot = await createProductionPackage();
    t.after(() => rm(packageRoot, { recursive: true, force: true }));
    await installValidPaymentComposition(packageRoot);
    await writeFile(
      path.join(packageRoot, "config/runtime.js"),
      `${VALID_TENCENT_KEY_ASSIGNMENT}\n${mutation}\n`,
    );

    await assertAuditRejects(packageRoot, "invalid Tencent map key config");
  });
}

test("production audit rejects a valid Tencent key followed by an invalid overwrite", async (t) => {
  const packageRoot = await createProductionPackage();
  t.after(() => rm(packageRoot, { recursive: true, force: true }));
  await installValidPaymentComposition(packageRoot);
  await writeFile(
    path.join(packageRoot, "config/runtime.js"),
    `${VALID_TENCENT_KEY_ASSIGNMENT}\nexports.MINIPROGRAM_TENCENT_MAP_KEY = "invalid-key";\n`,
  );

  await assertAuditRejects(packageRoot, "invalid Tencent map key config");
});

test("production audit requires compiled native payment composition", async (t) => {
  const packageRoot = await createProductionPackage();
  t.after(() => rm(packageRoot, { recursive: true, force: true }));

  await assertAuditRejects(packageRoot, "missing payment composition");
});

test("production audit requires compiled venue fulfillment composition", async (t) => {
  const packageRoot = await createProductionPackage();
  t.after(() => rm(packageRoot, { recursive: true, force: true }));
  await installPaymentDependencies(packageRoot);
  await writeFile(
    path.join(packageRoot, "app.js"),
    [
      'const { createHttpPaymentDataSource } = require("./services/http-payment");',
      'const { registerPaymentDataSource, registerPaymentCapability } = require("./services/payment");',
      'const { productionPayment } = require("./runtime/production");',
      "registerPaymentDataSource(createHttpPaymentDataSource({}));",
      "registerPaymentCapability(productionPayment);",
      "App({});",
    ].join("\n"),
  );

  await assertAuditRejects(packageRoot, "missing venue fulfillment composition");
});

test("production audit rejects a venue fulfillment attempt store without production persistence", async (t) => {
  const packageRoot = await createProductionPackage();
  t.after(() => rm(packageRoot, { recursive: true, force: true }));
  await installValidPaymentComposition(packageRoot);
  const appPath = path.join(packageRoot, "app.js");
  const source = await readFile(appPath, "utf8");
  await writeFile(
    appPath,
    source.replace("createVenueFulfillmentAttemptStore(productionSessionStorage)", "createVenueFulfillmentAttemptStore({})"),
  );

  await assertAuditRejects(packageRoot, "invalid venue fulfillment registration: persistent attempt store");
});

test("production audit rejects a venue fulfillment source wired to a different attempt store", async (t) => {
  const packageRoot = await createProductionPackage();
  t.after(() => rm(packageRoot, { recursive: true, force: true }));
  await installValidPaymentComposition(packageRoot);
  const appPath = path.join(packageRoot, "app.js");
  const source = await readFile(appPath, "utf8");
  await writeFile(
    appPath,
    source
      .replace(
        "const venueFulfillmentAttemptStore = createVenueFulfillmentAttemptStore(productionSessionStorage);",
        "const venueFulfillmentAttemptStore = createVenueFulfillmentAttemptStore(productionSessionStorage);\n"
          + "const differentAttemptStore = createVenueFulfillmentAttemptStore(productionSessionStorage);",
      )
      .replace("attemptStore: venueFulfillmentAttemptStore", "attemptStore: differentAttemptStore"),
  );

  await assertAuditRejects(packageRoot, "invalid venue fulfillment registration: shared attempt store");
});

test("production audit rejects an unresolved dependency in the app closure", async (t) => {
  const packageRoot = await createProductionPackage();
  t.after(() => rm(packageRoot, { recursive: true, force: true }));
  await writeFile(
    path.join(packageRoot, "app.js"),
    'require("./missing-payment-runtime");\ncreateHttpPaymentDataSource();\nregisterPaymentDataSource();\nregisterPaymentCapability(productionPayment);\n',
  );

  await assertAuditRejects(packageRoot, "missing dependency");
});

test("production audit rejects token-only payment wiring without production source imports", async (t) => {
  const packageRoot = await createProductionPackage();
  t.after(() => rm(packageRoot, { recursive: true, force: true }));
  await writeFile(
    path.join(packageRoot, "app.js"),
    [
      "const createHttpPaymentDataSource = () => ({});",
      "const registerPaymentDataSource = () => {};",
      "const registerPaymentCapability = () => {};",
      "const productionPayment = {};",
      "registerPaymentDataSource(createHttpPaymentDataSource({}));",
      "registerPaymentCapability(productionPayment);",
    ].join("\n"),
  );

  await assertAuditRejects(packageRoot, "missing payment import");
});

test("production audit rejects real payment imports when the data source registration call is missing", async (t) => {
  const packageRoot = await createProductionPackage();
  t.after(() => rm(packageRoot, { recursive: true, force: true }));
  await installPaymentDependencies(packageRoot);
  await writeFile(
    path.join(packageRoot, "app.js"),
    [
      'const { createHttpPaymentDataSource } = require("./services/http-payment");',
      'const { registerPaymentDataSource, registerPaymentCapability } = require("./services/payment");',
      'const { productionPayment } = require("./runtime/production");',
      "createHttpPaymentDataSource({});",
      "registerPaymentCapability(productionPayment);",
      "App({});",
    ].join("\n"),
  );

  await assertAuditRejects(packageRoot, "invalid payment registration: data source");
});

test("production audit rejects payment registrations wired to the wrong objects", async (t) => {
  const packageRoot = await createProductionPackage();
  t.after(() => rm(packageRoot, { recursive: true, force: true }));
  await installPaymentDependencies(packageRoot);
  await writeFile(
    path.join(packageRoot, "app.js"),
    [
      'const { createHttpPaymentDataSource } = require("./services/http-payment");',
      'const { registerPaymentDataSource, registerPaymentCapability } = require("./services/payment");',
      'const { productionPayment } = require("./runtime/production");',
      "registerPaymentDataSource(productionPayment);",
      "registerPaymentCapability(createHttpPaymentDataSource({}));",
      "App({});",
    ].join("\n"),
  );

  await assertAuditRejects(packageRoot, "invalid payment registration");
});

test("production audit rejects payment registration after App startup", async (t) => {
  const packageRoot = await createProductionPackage();
  t.after(() => rm(packageRoot, { recursive: true, force: true }));
  await installPaymentDependencies(packageRoot);
  await writeFile(
    path.join(packageRoot, "app.js"),
    [
      'const { createHttpPaymentDataSource } = require("./services/http-payment");',
      'const { registerPaymentDataSource, registerPaymentCapability } = require("./services/payment");',
      'const { productionPayment } = require("./runtime/production");',
      "App({});",
      "registerPaymentDataSource(createHttpPaymentDataSource({}));",
      "registerPaymentCapability(productionPayment);",
    ].join("\n"),
  );

  await assertAuditRejects(packageRoot, "payment registration must precede App/Page startup");
});

test("production audit rejects payment composition hidden in a dead branch", async (t) => {
  const packageRoot = await createProductionPackage();
  t.after(() => rm(packageRoot, { recursive: true, force: true }));
  await installPaymentDependencies(packageRoot);
  await writeFile(
    path.join(packageRoot, "app.js"),
    [
      'const { createHttpPaymentDataSource } = require("./services/http-payment");',
      'const { registerPaymentDataSource, registerPaymentCapability } = require("./services/payment");',
      'const { productionPayment } = require("./runtime/production");',
      "if (false) {",
      "  registerPaymentDataSource(createHttpPaymentDataSource({}));",
      "  registerPaymentCapability(productionPayment);",
      "}",
      "App({});",
    ].join("\n"),
  );

  await assertAuditRejects(packageRoot, "invalid payment registration");
});

test("production audit rejects payment composition hidden in an uninvoked function", async (t) => {
  const packageRoot = await createProductionPackage();
  t.after(() => rm(packageRoot, { recursive: true, force: true }));
  await installPaymentDependencies(packageRoot);
  await writeFile(
    path.join(packageRoot, "app.js"),
    [
      'const { createHttpPaymentDataSource } = require("./services/http-payment");',
      'const { registerPaymentDataSource, registerPaymentCapability } = require("./services/payment");',
      'const { productionPayment } = require("./runtime/production");',
      "function registerProductionPayment() {",
      "  registerPaymentDataSource(createHttpPaymentDataSource({}));",
      "  registerPaymentCapability(productionPayment);",
      "}",
      "App({});",
    ].join("\n"),
  );

  await assertAuditRejects(packageRoot, "invalid payment registration");
});

async function createProductionPackage() {
  const packageRoot = await mkdtemp(path.join(tmpdir(), "pitch-booking-audit-"));
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
  await writeFile(
    path.join(packageRoot, "app.json"),
    `${JSON.stringify({ pages: routes })}\n`,
  );

  for (const route of routes) {
    await mkdir(path.dirname(path.join(packageRoot, route)), { recursive: true });
    for (const extension of ["js", "json", "wxml", "wxss"]) {
      await writeFile(path.join(packageRoot, `${route}.${extension}`), "\n");
    }
  }
  await mkdir(path.join(packageRoot, "config"));
  await writeFile(
    path.join(packageRoot, "config/runtime.js"),
    'exports.MINIPROGRAM_TENCENT_MAP_KEY = "AAAAA-BBBBB-CCCCC-DDDDD-EEEEE-FFFFF";\n',
  );

  return packageRoot;
}

async function installValidPaymentComposition(packageRoot, extraSource = "") {
  await installProductionDependencies(packageRoot);
  await writeFile(
    path.join(packageRoot, "app.js"),
    [
      'const { createHttpPaymentDataSource } = require("./services/http-payment");',
      'const { registerPaymentDataSource, registerPaymentCapability } = require("./services/payment");',
      'const { productionPayment, productionSessionStorage } = require("./runtime/production");',
      'const { createHttpVenueFulfillmentDataSource } = require("./services/http-venue-fulfillment");',
      'const { registerVenueFulfillmentDataSource } = require("./services/venue-fulfillment");',
      'const { createVenueFulfillmentAttemptStore, registerVenueFulfillmentAttemptStore } = require("./services/venue-fulfillment-attempt-store");',
      "const venueFulfillmentAttemptStore = createVenueFulfillmentAttemptStore(productionSessionStorage);",
      "registerVenueFulfillmentAttemptStore(venueFulfillmentAttemptStore);",
      "registerVenueFulfillmentDataSource(createHttpVenueFulfillmentDataSource({ attemptStore: venueFulfillmentAttemptStore }));",
      "registerPaymentDataSource(createHttpPaymentDataSource({}));",
      "registerPaymentCapability(productionPayment);",
      extraSource,
      "App({});",
    ].join("\n"),
  );
}

async function installProductionDependencies(packageRoot) {
  await installPaymentDependencies(packageRoot);
  for (const file of [
    "services/http-venue-fulfillment.js",
    "services/venue-fulfillment.js",
    "services/venue-fulfillment-attempt-store.js",
  ]) await writeFile(path.join(packageRoot, file), "\n");
}

async function installPaymentDependencies(packageRoot) {
  for (const directory of ["services", "runtime"]) {
    await mkdir(path.join(packageRoot, directory), { recursive: true });
  }
  await writeFile(path.join(packageRoot, "services/http-payment.js"), "\n");
  await writeFile(path.join(packageRoot, "services/payment.js"), "\n");
  await writeFile(path.join(packageRoot, "runtime/production.js"), "\n");
}

async function assertAuditRejects(packageRoot, expectedDiagnostic) {
  await assert.rejects(
    execFileAsync(process.execPath, [auditScript, packageRoot]),
    (error) => error.code !== 0 && error.stderr.includes(expectedDiagnostic),
  );
}
