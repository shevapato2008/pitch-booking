import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import test from "node:test";

const execFileAsync = promisify(execFile);
const audit = path.resolve("scripts/audit-production-package.mjs");
const productionRoutes = [
  "pages/venue-map/index",
  "pages/venue/index",
  "pages/availability/index",
  "pages/booking-confirmation/index",
  "pages/order-detail/index",
];

for (const token of ["dev-login-code", "dev-phone-code", "138****0000", "developmentBookingDataSource", "booking-fixture"]) {
  test(`production audit rejects ${token} and names it`, async (t) => {
    const root = await mkdtemp(path.join(tmpdir(), "booking-audit-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    await writeFile(path.join(root, "app.json"), JSON.stringify({ pages: productionRoutes }));
    for (const route of productionRoutes) {
      await mkdir(path.dirname(path.join(root, route)), { recursive: true });
      for (const extension of ["js", "json", "wxml", "wxss"]) await writeFile(path.join(root, `${route}.${extension}`), "\n");
    }
    await writeFile(path.join(root, "app.js"), `const poison = ${JSON.stringify(token)};\n`);
    await assert.rejects(execFileAsync(process.execPath, [audit, root]), (error) => error.code !== 0 && error.stderr.includes(token));
  });
}

test("production audit rejects a package that omits booking routes", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "booking-audit-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const incompleteRoutes = productionRoutes.slice(0, 2);
  await writeFile(path.join(root, "app.json"), JSON.stringify({ pages: incompleteRoutes }));
  for (const route of incompleteRoutes) {
    await mkdir(path.dirname(path.join(root, route)), { recursive: true });
    for (const extension of ["js", "json", "wxml", "wxss"])
      await writeFile(path.join(root, `${route}.${extension}`), "\n");
  }

  await assert.rejects(
    execFileAsync(process.execPath, [audit, root]),
    (error) => error.code !== 0 && error.stderr.includes("unexpected routes"),
  );
});

test("production audit rejects TypeScript source anywhere in the package", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "booking-audit-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, "app.json"), JSON.stringify({ pages: productionRoutes }));
  for (const route of productionRoutes) {
    await mkdir(path.dirname(path.join(root, route)), { recursive: true });
    for (const extension of ["js", "json", "wxml", "wxss"])
      await writeFile(path.join(root, `${route}.${extension}`), "\n");
  }
  await mkdir(path.join(root, "runtime"));
  await writeFile(path.join(root, "runtime/leaked.ts"), "export const leaked = true;\n");

  await assert.rejects(
    execFileAsync(process.execPath, [audit, root]),
    (error) => error.code !== 0 && error.stderr.includes("runtime/leaked.ts"),
  );
});
