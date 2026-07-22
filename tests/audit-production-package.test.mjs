import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import test from "node:test";

const execFileAsync = promisify(execFile);
const auditScript = path.resolve("scripts/audit-production-package.mjs");

for (const token of ["ScenarioClock", "ScenarioTransport", "ScenarioClockStub"]) {
  test(`production audit rejects ${token}`, async (t) => {
    const packageRoot = await createProductionPackage();
    t.after(() => rm(packageRoot, { recursive: true, force: true }));
    await writeFile(path.join(packageRoot, "app.js"), `class ${token} {}\n`);

    await assert.rejects(
      execFileAsync(process.execPath, [auditScript, packageRoot]),
      (error) => error.code !== 0 && error.stderr.includes(token),
    );
  });
}

test("production audit accepts ordinary production code", async (t) => {
  const packageRoot = await createProductionPackage();
  t.after(() => rm(packageRoot, { recursive: true, force: true }));
  await writeFile(path.join(packageRoot, "app.js"), 'const bookingMode = "production";\n');

  const result = await execFileAsync(process.execPath, [auditScript, packageRoot]);
  assert.match(result.stdout, /0 forbidden paths\/tokens/);
});

async function createProductionPackage() {
  const packageRoot = await mkdtemp(path.join(tmpdir(), "pitch-booking-audit-"));
  const routes = ["pages/venue/index", "pages/availability/index"];
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
