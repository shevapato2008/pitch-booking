import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import test from "node:test";

const execFileAsync = promisify(execFile);
const buildScript = path.resolve("scripts/build-miniprogram.mjs");

for (const [description, source] of [
  ["syntactic", "const broken: = 1;\n"],
  ["semantic", 'const count: number = "wrong";\n'],
]) {
  test(`production build rejects ${description} TypeScript errors`, async (t) => {
    const projectRoot = await createBuildProject(source);
    t.after(() => rm(projectRoot, { recursive: true, force: true }));

    await assert.rejects(
      execFileAsync(process.execPath, [buildScript, "production"], { cwd: projectRoot }),
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
    await execFileAsync(process.execPath, [buildScript, "production"], { cwd: projectRoot });
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
    await execFileAsync(process.execPath, [buildScript, "production"], { cwd: projectRoot });
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
    await execFileAsync(process.execPath, [buildScript, mode], { cwd: projectRoot });
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

  await execFileAsync(process.execPath, [buildScript, "production"], { cwd: projectRoot });
  assert.equal(existsSync(path.join(projectRoot, "dist/miniprogram-production/runtime/interfaces.js")), true);
  assert.equal(existsSync(path.join(projectRoot, "dist/miniprogram-production/runtime/scenario.js")), false);
  assert.equal(existsSync(path.join(projectRoot, "dist/miniprogram-production/dev/fixture-transport.js")), false);

  await execFileAsync(process.execPath, [buildScript, "development"], { cwd: projectRoot });
  assert.equal(existsSync(path.join(projectRoot, "dist/miniprogram-development/runtime/scenario.js")), true);
  assert.equal(existsSync(path.join(projectRoot, "dist/miniprogram-development/dev/fixture-transport.js")), true);
});

async function createBuildProject(source) {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "pitch-booking-build-"));
  return createBuildProjectIn(projectRoot, source);
}

async function createBuildProjectIn(projectRoot, source) {
  const sourceRoot = path.join(projectRoot, "miniprogram");
  await mkdir(sourceRoot, { recursive: true });
  await mkdir(path.join(sourceRoot, "dev"));
  await writeFile(path.join(sourceRoot, "app.json"), '{"pages":[]}\n');
  await writeFile(path.join(sourceRoot, "app.ts"), source);
  return projectRoot;
}
