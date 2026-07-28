import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
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
  await writeFile(
    path.join(packageRoot, "app.js"),
    'const flavor = "mocha";\nconst label = "vitest";\n',
  );

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
  await writeFile(path.join(packageRoot, "app.js"), 'const bookingMode = "production";\n');

  const result = await execFileAsync(process.execPath, [auditScript, packageRoot]);
  assert.match(result.stdout, /0 forbidden paths\/tokens/);
});

async function createProductionPackage() {
  const packageRoot = await mkdtemp(path.join(tmpdir(), "pitch-booking-audit-"));
  const routes = [
    "pages/venue/index",
    "pages/availability/index",
    "pages/booking-confirmation/index",
    "pages/order-detail/index",
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

  return packageRoot;
}

async function assertAuditRejects(packageRoot, expectedDiagnostic) {
  await assert.rejects(
    execFileAsync(process.execPath, [auditScript, packageRoot]),
    (error) => error.code !== 0 && error.stderr.includes(expectedDiagnostic),
  );
}
