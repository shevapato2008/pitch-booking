import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { readDevelopmentPreviewRoutes } from "../scripts/build-miniprogram.mjs";

const execFileAsync = promisify(execFile);
const buildScript = path.resolve("scripts/build-miniprogram.mjs");

test("development preview manifest has exactly the two booking routes", async () => {
  assert.deepEqual(await readDevelopmentPreviewRoutes("miniprogram"), [
    "pages/booking-confirmation/index",
    "pages/order-detail/index",
  ]);
});

test("source production manifest contains the exact four production routes", async () => {
  const manifest = JSON.parse(await readFile("miniprogram/app.json", "utf8"));
  assert.deepEqual(manifest.pages, [
    "pages/venue/index",
    "pages/availability/index",
    "pages/booking-confirmation/index",
    "pages/order-detail/index",
  ]);
});

test("both builds expose four routes while only development activates Fixture bootstrap", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "booking-preview-build-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const entry of ["miniprogram", "contracts", "artifacts/ui/fixtures"]) await cp(entry, path.join(root, entry), { recursive: true });
  await execFileAsync(process.execPath, [buildScript, "development"], { cwd: root });
  await execFileAsync(process.execPath, [buildScript, "production"], { cwd: root });
  const development = JSON.parse(await readFile(path.join(root, "dist/miniprogram-development/app.json"), "utf8"));
  const production = JSON.parse(await readFile(path.join(root, "dist/miniprogram-production/app.json"), "utf8"));
  const routes = ["pages/venue/index", "pages/availability/index", "pages/booking-confirmation/index", "pages/order-detail/index"];
  assert.deepEqual(development.pages, routes);
  assert.deepEqual(production.pages, routes);
  const developmentApp = await readFile(path.join(root, "dist/miniprogram-development/app.js"), "utf8");
  const productionApp = await readFile(path.join(root, "dist/miniprogram-production/app.js"), "utf8");
  assert.match(developmentApp, /dev\/bootstrap/);
  assert.match(developmentApp, /bootstrapDevelopment/);
  assert.doesNotMatch(productionApp, /dev\/|fixture/i);
});

for (const [label, route] of [
  ["empty", ""], ["absolute", "/pages/order-detail/index"], ["parent traversal", "pages/../order-detail/index"],
  ["query", "pages/order-detail/index?x=1"], ["hash", "pages/order-detail/index#x"], ["non-canonical", "pages//order-detail/index"],
]) {
  test(`development route manifest rejects ${label} routes`, async (t) => {
    const root = await mkdtemp(path.join(tmpdir(), "booking-routes-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    await mkdir(path.join(root, "dev"));
    await writeFile(path.join(root, "dev/app-pages.json"), JSON.stringify({ pages: [route] }));
    await assert.rejects(readDevelopmentPreviewRoutes(root), /invalid development preview route/i);
  });
}

test("development route manifest rejects duplicates and missing page artifacts", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "booking-routes-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "dev"));
  const route = "pages/order-detail/index";
  await writeFile(path.join(root, "dev/app-pages.json"), JSON.stringify({ pages: [route, route] }));
  await assert.rejects(readDevelopmentPreviewRoutes(root), /duplicate/i);
  await writeFile(path.join(root, "dev/app-pages.json"), JSON.stringify({ pages: [route] }));
  await assert.rejects(readDevelopmentPreviewRoutes(root), /missing development preview artifact/i);
});
