import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { readDevelopmentPreviewRoutes } from "../scripts/build-miniprogram.mjs";

const execFileAsync = promisify(execFile);
const buildScript = path.resolve("scripts/build-miniprogram.mjs");
const TEST_TENCENT_MAP_KEY = "AAAAA-BBBBB-CCCCC-DDDDD-EEEEE-FFFFF";

test("development preview manifest has exactly the two booking routes", async () => {
  assert.deepEqual(await readDevelopmentPreviewRoutes("miniprogram"), [
    "pages/booking-confirmation/index",
    "pages/order-detail/index",
  ]);
});

test("source production manifest puts the map first across six production routes", async () => {
  const manifest = JSON.parse(await readFile("miniprogram/app.json", "utf8"));
  assert.deepEqual(manifest.pages, [
    "pages/venue-map/index",
    "pages/venue/index",
    "pages/availability/index",
    "pages/booking-confirmation/index",
    "pages/order-detail/index",
    "pages/venue-inventory/index",
  ]);
});

test("development includes four deterministic native preview pages while production stays on six routes", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "booking-preview-build-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const entry of ["miniprogram", "contracts", "artifacts/ui/fixtures"]) await cp(entry, path.join(root, entry), { recursive: true });
  await execFileAsync(process.execPath, [buildScript, "development"], { cwd: root });
  await execFileAsync(process.execPath, [buildScript, "production"], {
    cwd: root,
    env: { ...process.env, MINIPROGRAM_TENCENT_MAP_KEY: TEST_TENCENT_MAP_KEY },
  });
  const development = JSON.parse(await readFile(path.join(root, "dist/miniprogram-development/app.json"), "utf8"));
  const production = JSON.parse(await readFile(path.join(root, "dist/miniprogram-production/app.json"), "utf8"));
  const productionRoutes = [
    "pages/venue-map/index",
    "pages/venue/index",
    "pages/availability/index",
    "pages/booking-confirmation/index",
    "pages/order-detail/index",
    "pages/venue-inventory/index",
  ];
  const developmentRoutes = [
    ...productionRoutes,
    "dev/pages/intent-entry/index",
    "dev/pages/intent-home/index",
    "dev/pages/venue-inventory/index",
    "dev/pages/venue-pitch-setup/index",
  ];
  assert.deepEqual(development.pages, developmentRoutes);
  assert.deepEqual(production.pages, productionRoutes);
  for (const route of [
    "dev/pages/intent-entry/index",
    "dev/pages/intent-home/index",
    "dev/pages/venue-inventory/index",
    "dev/pages/venue-pitch-setup/index",
  ]) {
    for (const extension of [".js", ".json", ".wxml", ".wxss"]) {
      await readFile(path.join(root, "dist/miniprogram-development", `${route}${extension}`));
    }
  }
  assert.doesNotMatch(JSON.stringify(production), /dev\/pages\/(?:intent-(?:entry|home)|venue-(?:inventory|pitch-setup))\/index/);
  await assert.rejects(access(path.join(root, "dist/miniprogram-production/dev")), /ENOENT/);
  const developmentApp = await readFile(path.join(root, "dist/miniprogram-development/app.js"), "utf8");
  const productionApp = await readFile(path.join(root, "dist/miniprogram-production/app.js"), "utf8");
  assert.match(developmentApp, /dev\/bootstrap/);
  assert.match(developmentApp, /bootstrapDevelopment/);
  assert.doesNotMatch(
    await readFile(path.join(root, "dist/miniprogram-development/config/runtime.js"), "utf8"),
    new RegExp(TEST_TENCENT_MAP_KEY),
  );
  assert.doesNotMatch(productionApp, /dev\/|fixture/i);
  assert.doesNotMatch(
    await readFile(path.join(root, "dist/miniprogram-production/app.json"), "utf8"),
    /venue-pitch-setup|配置物理场地/,
  );
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
