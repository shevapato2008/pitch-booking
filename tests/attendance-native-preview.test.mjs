import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const routes = [
  "dev/pages/c2c-attendance-scenario/index",
  "dev/pages/c2c-attendance/index",
];
const execFileAsync = promisify(execFile);
const buildScript = path.resolve("scripts/build-miniprogram.mjs");
const mapKey = "AAAAA-BBBBB-CCCCC-DDDDD-EEEEE-FFFFF";
const read = (file) => readFileSync(file, "utf8");

const collectFiles = (root) => {
  const result = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...collectFiles(target));
    else result.push(target);
  }
  return result;
};

const rule = (styles, selector) => {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`, "s").exec(styles);
  assert.ok(match, `missing ${selector} rule`);
  return match[1];
};

const assertCenteredTouchTarget = (styles, selector) => {
  const declarations = rule(styles, selector);
  const minHeight = /min-height:\s*(\d+)rpx/.exec(declarations);
  assert.ok(minHeight, `${selector} must declare an rpx min-height`);
  assert.ok(Number(minHeight[1]) >= 88, `${selector} touch height must be at least 88rpx`);
  assert.match(declarations, /display:\s*flex/);
  assert.match(declarations, /align-items:\s*center/);
  assert.match(declarations, /justify-content:\s*center/);
};

test("C2c inventory owns exactly two custom-navigation development routes", () => {
  const inventory = JSON.parse(read("miniprogram/dev/c2c-attendance-pages.json"));
  assert.deepEqual(inventory, { token: "C2C_ATTENDANCE_FIXTURE", pages: routes });
  for (const route of routes) {
    for (const extension of ["ts", "json", "wxml", "wxss"]) {
      assert.equal(existsSync(`miniprogram/${route}.${extension}`), true, `missing ${route}.${extension}`);
    }
    assert.deepEqual(JSON.parse(read(`miniprogram/${route}.json`)), { navigationStyle: "custom" });
  }
});

test("C2c buttons are bound centered touch targets inside flex-scroll safe areas", () => {
  for (const route of routes) {
    const wxml = read(`miniprogram/${route}.wxml`);
    const styles = read(`miniprogram/${route}.wxss`);
    const pageRule = rule(styles, ".c2c-page");
    const scrollRule = rule(styles, ".c2c-scroll");
    assert.match(pageRule, /display:\s*flex/);
    assert.match(pageRule, /height:\s*100vh/);
    assert.match(pageRule, /flex-direction:\s*column/);
    assert.match(pageRule, /overflow:\s*hidden/);
    assert.match(scrollRule, /flex:\s*1(?:\s+1\s+auto)?/);
    assert.match(scrollRule, /height:\s*0/);
    assert.match(scrollRule, /min-height:\s*0/);
    assert.match(styles, /env\(safe-area-inset-bottom/);
    for (const button of wxml.match(/<button\b[^>]*>/g) ?? []) {
      assert.match(button, /bindtap="on[A-Za-z]+"/);
    }
  }

  const scenarioStyles = read(`miniprogram/${routes[0]}.wxss`);
  const attendanceStyles = read(`miniprogram/${routes[1]}.wxss`);
  assertCenteredTouchTarget(scenarioStyles, ".c2c-scenario-card");
  for (const selector of [
    ".c2c-state-action",
    ".c2c-row-action",
    ".c2c-sheet-close",
    ".c2c-sheet-action",
  ]) assertCenteredTouchTarget(attendanceStyles, selector);
});

test("C2c recovery states expose row actions only for READY and UNMARKED players", () => {
  const fixture = read("miniprogram/dev/c2c-attendance-fixture.ts");
  const source = read("miniprogram/dev/pages/c2c-attendance/index.ts");
  const template = read("miniprogram/dev/pages/c2c-attendance/index.wxml");
  assert.match(source, /canMark:\s*canManage\s*&&\s*player\.attendanceResult\s*===\s*"UNMARKED"/);
  assert.match(
    source,
    /roster:\s*current\.roster\.map\(\(player\)\s*=>\s*projectPlayer\(player,\s*current\.previewState\s*===\s*"READY"\)\)/s,
  );
  assert.match(
    fixture,
    /previewState\s*===\s*"READY"\s*&&\s*player\?\.attendanceResult\s*===\s*"UNMARKED"/,
  );
  assert.match(template, /<view\s+wx:if="{{item\.canMark}}"\s+class="c2c-row-actions">/);
  assert.doesNotMatch(template, /wx:if="{{item\.isUnmarked}}"\s+class="c2c-row-actions"/);
});

test("fresh development contains C2c while fresh production excludes every C2c source and marker", async (t) => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "pitch-booking-c2c-isolation-"));
  t.after(() => rm(projectRoot, { recursive: true, force: true }));
  for (const directory of ["miniprogram", "artifacts", "contracts", "scripts", "node_modules"]) {
    await cp(directory, path.join(projectRoot, directory), { recursive: true });
  }
  for (const file of ["package.json", "tsconfig.json"]) await cp(file, path.join(projectRoot, file));

  await execFileAsync(process.execPath, [buildScript, "development"], { cwd: projectRoot, env: process.env });
  const development = JSON.parse(read(path.join(projectRoot, "dist/miniprogram-development/app.json")));
  routes.forEach((route) => assert.equal(development.pages.includes(route), true));

  await execFileAsync(process.execPath, [buildScript, "production"], {
    cwd: projectRoot,
    env: { ...process.env, MINIPROGRAM_TENCENT_MAP_KEY: mapKey, MINIPROGRAM_PAYMENT_PROVIDER: "disabled" },
  });
  const productionRoot = path.join(projectRoot, "dist/miniprogram-production");
  const production = JSON.parse(read(path.join(productionRoot, "app.json")));
  assert.equal(production.pages.some((route) => route.includes("c2c-attendance")), false);
  const productionFiles = collectFiles(productionRoot);
  assert.equal(
    productionFiles.some((file) => path.relative(productionRoot, file).includes("c2c-attendance")),
    false,
  );
  const productionText = productionFiles.map(read).join("\n");
  for (const forbidden of [
    "C2C_ATTENDANCE_FIXTURE",
    "remove C2C_ATTENDANCE_FIXTURE before production build or integration",
    "c2c-attendance-fixture",
    "c2c-attendance-pages.json",
    ...routes,
    "C2c 开发预览 · 模拟数据",
    "c2c-open-game-20260830-1830",
    "c2c-reg-unmarked",
    "c2c-reg-present",
    "c2c-reg-no-show",
    "奥体周日傍晚局",
  ]) assert.equal(productionText.includes(forbidden), false, `production output leaked ${forbidden}`);
});
