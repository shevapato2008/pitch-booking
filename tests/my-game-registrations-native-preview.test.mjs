import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const routes = [
  "dev/pages/c1c-scenario/index",
  "dev/pages/c1c-discovery-entry/index",
  "dev/pages/c1c-my-registrations/index",
  "dev/pages/c1c-registration-detail/index",
];
const execFileAsync = promisify(execFile);
const buildScript = path.resolve("scripts/build-miniprogram.mjs");
const testTencentMapKey = "AAAAA-BBBBB-CCCCC-DDDDD-EEEEE-FFFFF";

const read = (file) => readFileSync(file, "utf8");

const collectText = (root) => {
  const contents = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) contents.push(...collectText(target));
    else contents.push(read(target));
  }
  return contents;
};

test("C1c inventory owns exactly four custom-navigation development routes", () => {
  const inventory = JSON.parse(read("miniprogram/dev/c1c-my-game-registrations-pages.json"));
  assert.equal(inventory.token, "C1C_MY_GAME_REGISTRATIONS_FIXTURE");
  assert.deepEqual(inventory.pages, routes);

  for (const route of routes) {
    for (const extension of ["ts", "json", "wxml", "wxss"]) {
      assert.equal(existsSync(`miniprogram/${route}.${extension}`), true, `${route}.${extension} must exist`);
    }
    const pageConfig = JSON.parse(read(`miniprogram/${route}.json`));
    assert.deepEqual(pageConfig, { navigationStyle: "custom" });
  }
});

test("C1c pages keep the flex-scroll, touch, chevron, and handler contracts", () => {
  for (const route of routes) {
    const wxss = read(`miniprogram/${route}.wxss`);
    const wxml = read(`miniprogram/${route}.wxml`);
    assert.match(wxss, /height:\s*100vh/);
    assert.match(wxss, /\.c1c-scroll\s*{[^}]*flex:\s*1[^}]*height:\s*0[^}]*min-height:\s*0/s);
    for (const button of wxml.match(/<button\b[^>]*>/g) ?? []) assert.match(button, /bindtap="on[A-Za-z]+"/);
  }

  const sharedStyles = routes.map((route) => read(`miniprogram/${route}.wxss`)).join("\n");
  assert.match(sharedStyles, /min-height:\s*88rpx/);
  assert.match(sharedStyles, /align-items:\s*center/);
  assert.match(sharedStyles, /justify-content:\s*center/);
  assert.match(sharedStyles, /border-top:\s*4rpx solid[^}]*border-right:\s*4rpx solid/s);
});

test("production source and isolated fresh output exclude every C1c preview marker and synthetic name", async (t) => {
  const sourceManifest = JSON.parse(read("miniprogram/app.json"));
  assert.equal(sourceManifest.pages.some((route) => route.includes("c1c-")), false);

  const projectRoot = await mkdtemp(path.join(tmpdir(), "pitch-booking-c1c-production-"));
  t.after(() => rm(projectRoot, { recursive: true, force: true }));
  await cp("miniprogram", path.join(projectRoot, "miniprogram"), { recursive: true });
  await execFileAsync(process.execPath, [buildScript, "production"], {
    cwd: projectRoot,
    env: { ...process.env, MINIPROGRAM_TENCENT_MAP_KEY: testTencentMapKey },
  });
  const productionRoot = path.join(projectRoot, "dist/miniprogram-production");
  const productionManifest = JSON.parse(read(`${productionRoot}/app.json`));
  assert.equal(productionManifest.pages.some((route) => route.includes("c1c-")), false);

  const productionText = collectText(productionRoot).join("\n");
  for (const forbidden of [
    "C1C_MY_GAME_REGISTRATIONS_FIXTURE",
    "海河周六轻松局",
    "津南周末友谊局",
    "reg-applied",
    "reg-joined",
    "reg-rejected",
    "reg-cancelled",
  ]) assert.equal(productionText.includes(forbidden), false, `production output leaked ${forbidden}`);
});
