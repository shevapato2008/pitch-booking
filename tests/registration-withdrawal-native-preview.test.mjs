import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const routes = [
  "dev/pages/c2a-withdrawal-scenario/index",
  "dev/pages/c2a-my-registrations/index",
  "dev/pages/c2a-registration-detail/index",
];
const execFileAsync = promisify(execFile);
const buildScript = path.resolve("scripts/build-miniprogram.mjs");
const mapKey = "AAAAA-BBBBB-CCCCC-DDDDD-EEEEE-FFFFF";
const read = (file) => readFileSync(file, "utf8");

const collectText = (root) => {
  const result = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...collectText(target));
    else result.push(read(target));
  }
  return result;
};

test("C2a inventory owns exactly three custom-navigation development routes", () => {
  const inventory = JSON.parse(read("miniprogram/dev/c2a-registration-withdrawal-pages.json"));
  assert.deepEqual(inventory, { token: "C2A_REGISTRATION_WITHDRAWAL_FIXTURE", pages: routes });
  for (const route of routes) {
    for (const extension of ["ts", "json", "wxml", "wxss"]) {
      assert.equal(existsSync(`miniprogram/${route}.${extension}`), true, `missing ${route}.${extension}`);
    }
    assert.deepEqual(JSON.parse(read(`miniprogram/${route}.json`)), { navigationStyle: "custom" });
  }
});

test("C2a native controls are bound, centered touch targets with scroll and safe-area contracts", () => {
  for (const route of routes) {
    const wxml = read(`miniprogram/${route}.wxml`);
    const wxss = read(`miniprogram/${route}.wxss`);
    assert.match(wxss, /height:\s*100vh/);
    assert.match(wxss, /\.c2a-scroll\s*\{[^}]*flex:\s*1[^}]*height:\s*0[^}]*min-height:\s*0/s);
    for (const button of wxml.match(/<button\b[^>]*>/g) ?? []) assert.match(button, /bindtap="on[A-Za-z]+"/);
  }
  const styles = routes.map((route) => read(`miniprogram/${route}.wxss`)).join("\n");
  assert.match(styles, /min-height:\s*88rpx/);
  assert.match(styles, /align-items:\s*center/);
  assert.match(styles, /justify-content:\s*center/);
  assert.match(styles, /env\(safe-area-inset-bottom/);
  assert.match(styles, /border-top:\s*4rpx solid[^}]*border-right:\s*4rpx solid/s);
});

test("detail exposes one state-derived action, real confirm controls, and terminal no-reapply semantics", () => {
  const detail = read("miniprogram/dev/pages/c2a-registration-detail/index.wxml");
  assert.match(detail, /{{registration.primaryActionLabel}}/);
  assert.match(detail, /bindtap="onOpenWithdrawalConfirm"/);
  assert.match(detail, /bindtap="onCancelWithdrawal"/);
  assert.match(detail, /bindtap="onConfirmWithdrawal"/);
  assert.match(detail, /bindtap="onConfirmWithdrawalResult"/);
  assert.match(detail, /本场不可再次申请/);
  assert.doesNotMatch(detail, /重新申请|再次申请按钮/);
});

test("thin list is the only card target and restores an exact scroll position", () => {
  const list = read("miniprogram/dev/pages/c2a-my-registrations/index.wxml");
  const cards = list.match(/<button[^>]+class="c2a-registration-card[^>]*>[\s\S]*?<\/button>/g) ?? [];
  assert.notEqual(cards.length, 0);
  cards.forEach((card) => {
    assert.match(card, /bindtap="onOpenRegistration"/);
    assert.doesNotMatch(card, /<button[^>]*>[\s\S]*<button/);
  });
  assert.match(list, /scroll-top="{{listScrollTop}}"/);
  assert.match(list, /bindscroll="onScroll"/);
  assert.match(list, /{{item.statusLabel}}/);
});

test("fresh development contains C2a while fresh production excludes all preview markers", async (t) => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "pitch-booking-c2a-isolation-"));
  t.after(() => rm(projectRoot, { recursive: true, force: true }));
  await cp("miniprogram", path.join(projectRoot, "miniprogram"), { recursive: true });
  await cp("artifacts", path.join(projectRoot, "artifacts"), { recursive: true });
  await cp("contracts", path.join(projectRoot, "contracts"), { recursive: true });
  await cp("scripts", path.join(projectRoot, "scripts"), { recursive: true });
  await cp("node_modules", path.join(projectRoot, "node_modules"), { recursive: true });
  await cp("package.json", path.join(projectRoot, "package.json"));
  await cp("tsconfig.json", path.join(projectRoot, "tsconfig.json"));

  await execFileAsync(process.execPath, [buildScript, "development"], { cwd: projectRoot, env: process.env });
  const development = JSON.parse(read(path.join(projectRoot, "dist/miniprogram-development/app.json")));
  routes.forEach((route) => assert.equal(development.pages.includes(route), true));

  await execFileAsync(process.execPath, [buildScript, "production"], {
    cwd: projectRoot,
    env: { ...process.env, MINIPROGRAM_TENCENT_MAP_KEY: mapKey, MINIPROGRAM_PAYMENT_PROVIDER: "disabled" },
  });
  const productionRoot = path.join(projectRoot, "dist/miniprogram-production");
  const production = JSON.parse(read(path.join(productionRoot, "app.json")));
  assert.equal(production.pages.some((route) => route.includes("c2a-")), false);
  const productionText = collectText(productionRoot).join("\n");
  for (const forbidden of [
    "C2A_REGISTRATION_WITHDRAWAL_FIXTURE",
    "C2a 开发预览 · 模拟数据",
    "c2a-registration-withdrawal-fixture",
    "c2a-withdrawal-scenario",
    "c2a-my-registrations",
    "c2a-registration-detail",
  ]) assert.equal(productionText.includes(forbidden), false, `production output leaked ${forbidden}`);
});
