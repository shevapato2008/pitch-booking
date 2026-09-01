import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const routes = [
  "dev/pages/c2e-member-removal-scenario/index",
  "dev/pages/c2e-member-removal/index",
];
const productionRoute = "pages/captain-game-members/index";
const execFileAsync = promisify(execFile);
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
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "s").exec(styles);
  assert.ok(match, `missing ${selector}`);
  return match[1];
};

const assertCenteredTouchTarget = (styles, selector) => {
  const declarations = rule(styles, selector);
  const height = /min-height:\s*(\d+)rpx/.exec(declarations);
  assert.ok(height && Number(height[1]) >= 88, `${selector} needs 88rpx`);
  assert.match(declarations, /display:\s*flex/);
  assert.match(declarations, /align-items:\s*center/);
  assert.match(declarations, /justify-content:\s*center/);
};

test("C2e inventory owns exactly two custom-navigation development routes", () => {
  const inventory = JSON.parse(read("miniprogram/dev/c2e-member-removal-pages.json"));
  assert.deepEqual(inventory, { token: "C2E_MEMBER_REMOVAL_FIXTURE", pages: routes });
  for (const route of routes) {
    for (const extension of ["ts", "json", "wxml", "wxss"]) {
      assert.equal(existsSync(`miniprogram/${route}.${extension}`), true, `missing ${route}.${extension}`);
    }
    assert.deepEqual(JSON.parse(read(`miniprogram/${route}.json`)), { navigationStyle: "custom" });
  }
});

test("C2e preview keeps one flex scroll, safe-area sheet and bound centered buttons", () => {
  for (const route of routes) {
    const wxml = read(`miniprogram/${route}.wxml`);
    const styles = read(`miniprogram/${route}.wxss`);
    assert.match(rule(styles, ".c2e-page"), /height:\s*100vh/);
    assert.match(rule(styles, ".c2e-page"), /overflow:\s*hidden/);
    assert.match(rule(styles, ".c2e-scroll"), /height:\s*0/);
    assert.match(rule(styles, ".c2e-scroll"), /min-height:\s*0/);
    assert.match(styles, /env\(safe-area-inset-bottom/);
    for (const button of wxml.match(/<button\b[^>]*>/g) ?? []) {
      assert.match(button, /bindtap="on[A-Za-z]+"/);
    }
  }
  assertCenteredTouchTarget(read(`miniprogram/${routes[0]}.wxss`), ".c2e-scenario-card");
  const pageStyles = read(`miniprogram/${routes[1]}.wxss`);
  for (const selector of [
    ".c2e-state-action", ".c2e-row-action", ".c2e-sheet-close", ".c2e-sheet-action",
  ]) assertCenteredTouchTarget(pageStyles, selector);
  const confirmationMember = rule(pageStyles, ".c2e-sheet-member");
  assert.match(confirmationMember, /white-space:\s*normal/);
  assert.match(confirmationMember, /overflow-wrap:\s*anywhere/);
  assert.doesNotMatch(confirmationMember, /text-overflow:\s*ellipsis/);
  const page = read(`miniprogram/${routes[1]}.wxml`);
  assert.match(page, /maxlength="-1"/);
  assert.match(page, /disabled="{{confirmDisabled}}"/);
  assert.match(page, /aria-modal="true"/);
});

test("fresh builds retain real C2e production UI and exclude every development marker", async (t) => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "pitch-booking-c2e-isolation-"));
  t.after(() => rm(projectRoot, { recursive: true, force: true }));
  for (const directory of ["miniprogram", "artifacts", "contracts", "scripts"]) {
    await cp(directory, path.join(projectRoot, directory), { recursive: true });
  }
  const dependencyRoot = existsSync("node_modules") ? "node_modules" : path.resolve("../../node_modules");
  await cp(dependencyRoot, path.join(projectRoot, "node_modules"), { recursive: true });
  for (const file of ["package.json", "tsconfig.json"]) await cp(file, path.join(projectRoot, file));
  const buildScript = realpathSync(path.join(projectRoot, "scripts/build-miniprogram.mjs"));

  await execFileAsync(process.execPath, [buildScript, "development"], { cwd: projectRoot, env: process.env });
  const development = JSON.parse(read(path.join(projectRoot, "dist/miniprogram-development/app.json")));
  routes.forEach((route) => assert.equal(development.pages.includes(route), true));
  assert.equal(development.pages.includes(productionRoute), true);

  await execFileAsync(process.execPath, [buildScript, "production"], {
    cwd: projectRoot,
    env: { ...process.env, MINIPROGRAM_TENCENT_MAP_KEY: mapKey, MINIPROGRAM_PAYMENT_PROVIDER: "disabled" },
  });
  const productionRoot = path.join(projectRoot, "dist/miniprogram-production");
  const production = JSON.parse(read(path.join(productionRoot, "app.json")));
  assert.equal(production.pages.includes(productionRoute), true);
  const files = collectFiles(productionRoot);
  assert.equal(files.some((file) => path.relative(productionRoot, file).startsWith("dev/")), false);
  const text = files.map(read).join("\n");
  assert.match(text, /getOpenGameRegistrationSource/);
  assert.match(text, /removeMember/);
  for (const forbidden of [
    "C2E_MEMBER_REMOVAL_FIXTURE",
    "c2e-member-removal-fixture",
    "c2e-member-removal-pages.json",
    ...routes,
    "C2e 开发预览 · 模拟数据",
    "c2e-reg-left-wing",
    "c2e-remove-member-unknown-key-0001",
  ]) assert.equal(text.includes(forbidden), false, `production output leaked ${forbidden}`);
});
