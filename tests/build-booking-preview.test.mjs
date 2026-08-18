import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  readDevelopmentPreviewRoutes,
  resolveProductionPaymentProvider,
} from "../scripts/build-miniprogram.mjs";

const execFileAsync = promisify(execFile);
const buildScript = path.resolve("scripts/build-miniprogram.mjs");
const TEST_TENCENT_MAP_KEY = "AAAAA-BBBBB-CCCCC-DDDDD-EEEEE-FFFFF";

test("production payment provider accepts only wechat or disabled", () => {
  assert.equal(resolveProductionPaymentProvider(undefined), "wechat");
  assert.equal(resolveProductionPaymentProvider("wechat"), "wechat");
  assert.equal(resolveProductionPaymentProvider("disabled"), "disabled");
  assert.throws(
    () => resolveProductionPaymentProvider("mock"),
    /MINIPROGRAM_PAYMENT_PROVIDER must be wechat or disabled/,
  );
});

test("disabled production build freezes online booking off in runtime config", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "disabled-payment-build-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const entry of ["miniprogram", "contracts", "artifacts/ui/fixtures"]) {
    await cp(entry, path.join(root, entry), { recursive: true });
  }

  await execFileAsync(process.execPath, [buildScript, "production"], {
    cwd: root,
    env: {
      ...process.env,
      MINIPROGRAM_TENCENT_MAP_KEY: TEST_TENCENT_MAP_KEY,
      MINIPROGRAM_PAYMENT_PROVIDER: "disabled",
    },
  });

  const runtime = await readFile(
    path.join(root, "dist/miniprogram-production/config/runtime.js"),
    "utf8",
  );
  assert.match(runtime, /exports\.ONLINE_BOOKING_ENABLED = false/);
});

test("development preview manifest has the two booking, two venue-profile, and venue-access routes", async () => {
  assert.deepEqual(await readDevelopmentPreviewRoutes("miniprogram"), [
    "pages/booking-confirmation/index",
    "pages/order-detail/index",
    "dev/pages/venue-profile/index",
    "dev/pages/venue-profile-public/index",
    "dev/pages/venue-access/index",
  ]);
});

test("source production manifest puts the intent entry first across ten production routes", async () => {
  const manifest = JSON.parse(await readFile("miniprogram/app.json", "utf8"));
  assert.deepEqual(manifest.pages, [
    "pages/intent-entry/index",
    "pages/venue-access/index",
    "pages/venue-map/index",
    "pages/venue/index",
    "pages/availability/index",
    "pages/booking-confirmation/index",
    "pages/order-detail/index",
    "pages/venue-profile/index",
    "pages/venue-inventory/index",
    "pages/venue-pitch-setup/index",
  ]);
});

test("development includes seven deterministic native preview pages while production stays on ten routes", async (t) => {
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
    "pages/intent-entry/index",
    "pages/venue-access/index",
    "pages/venue-map/index",
    "pages/venue/index",
    "pages/availability/index",
    "pages/booking-confirmation/index",
    "pages/order-detail/index",
    "pages/venue-profile/index",
    "pages/venue-inventory/index",
    "pages/venue-pitch-setup/index",
  ];
  const developmentRoutes = [
    ...productionRoutes,
    "dev/pages/venue-profile/index",
    "dev/pages/venue-profile-public/index",
    "dev/pages/venue-access/index",
    "dev/pages/intent-entry/index",
    "dev/pages/intent-home/index",
    "dev/pages/venue-inventory/index",
    "dev/pages/venue-pitch-setup/index",
  ];
  assert.deepEqual(development.pages, developmentRoutes);
  assert.deepEqual(production.pages, productionRoutes);
  for (const route of [
    "dev/pages/venue-profile/index",
    "dev/pages/venue-profile-public/index",
    "dev/pages/venue-access/index",
    "dev/pages/intent-entry/index",
    "dev/pages/intent-home/index",
    "dev/pages/venue-inventory/index",
    "dev/pages/venue-pitch-setup/index",
  ]) {
    for (const extension of [".js", ".json", ".wxml", ".wxss"]) {
      await readFile(path.join(root, "dist/miniprogram-development", `${route}${extension}`));
    }
  }
  assert.doesNotMatch(JSON.stringify(production), /dev\/pages\/(?:intent-(?:entry|home)|venue-(?:access|profile(?:-public)?|inventory|pitch-setup))\/index/);
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
    await readFile(path.join(root, "dist/miniprogram-production/pages/venue-pitch-setup/index.wxml"), "utf8"),
    /仅视觉预览|fixture/i,
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
