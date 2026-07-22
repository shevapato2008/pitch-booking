import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
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

async function createBuildProject(source) {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "pitch-booking-build-"));
  const sourceRoot = path.join(projectRoot, "miniprogram");
  await mkdir(sourceRoot);
  await writeFile(path.join(sourceRoot, "app.json"), '{"pages":[]}\n');
  await writeFile(path.join(sourceRoot, "app.ts"), source);
  return projectRoot;
}
