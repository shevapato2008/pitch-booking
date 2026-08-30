import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const routes = [
  "dev/pages/c2b-waitlist-scenario/index",
  "dev/pages/c2b-captain-applications/index",
  "dev/pages/c2b-my-registrations/index",
  "dev/pages/c2b-registration-detail/index",
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

test("C2b inventory owns exactly four custom-navigation development routes", () => {
  const inventory = JSON.parse(read("miniprogram/dev/c2b-waitlist-pages.json"));
  assert.deepEqual(inventory, { token: "C2B_WAITLIST_FIXTURE", pages: routes });
  for (const route of routes) {
    for (const extension of ["ts", "json", "wxml", "wxss"]) {
      assert.equal(existsSync(`miniprogram/${route}.${extension}`), true, `missing ${route}.${extension}`);
    }
    assert.deepEqual(JSON.parse(read(`miniprogram/${route}.json`)), { navigationStyle: "custom" });
  }
});

test("every native product button is bound and repeated controls are centered touch targets", () => {
  for (const route of routes) {
    const wxml = read(`miniprogram/${route}.wxml`);
    for (const button of wxml.match(/<button\b[^>]*>/g) ?? []) assert.match(button, /bindtap="on[A-Za-z]+"/);
  }
  const styles = routes.map((route) => read(`miniprogram/${route}.wxss`)).join("\n");
  assert.match(styles, /min-height:\s*88rpx/);
  assert.match(styles, /align-items:\s*center/);
  assert.match(styles, /justify-content:\s*center/);
  assert.match(styles, /env\(safe-area-inset-bottom/);
});

test("full review exposes waitlist and reject, but no enabled accept path", () => {
  const source = read("miniprogram/dev/pages/c2b-captain-applications/index.ts");
  const template = read("miniprogram/dev/pages/c2b-captain-applications/index.wxml");
  assert.match(template, /bindtap="onWaitlist"/);
  assert.match(template, /bindtap="onReject"/);
  assert.match(template, /bindtap="onClosePanel"/);
  assert.match(template, /bindtap="onConfirmDecision"/);
  assert.doesNotMatch(template, /bindtap="onAccept"/);
  assert.match(source, /applicantName/);
  assert.match(`${source}\n${template}`, /gameName/);
});

test("waitlisted detail retains a real exit action when suspended and never claims notification delivery", () => {
  const source = read("miniprogram/dev/pages/c2b-registration-detail/index.ts");
  const template = read("miniprogram/dev/pages/c2b-registration-detail/index.wxml");
  assert.match(template, /bindtap="onOpenWithdrawalConfirm"/);
  assert.match(template, /bindtap="onCancelWithdrawal"/);
  assert.match(template, /bindtap="onConfirmWithdrawal"/);
  assert.match(template, /本场不可再次申请/);
  assert.match(source, /暂停期间不会自动递补；你仍可随时退出候补/);
  assert.doesNotMatch(`${source}\n${template}`, /已通知|通知成功/);
});

test("fresh development contains C2b while fresh production excludes every preview marker", async (t) => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "pitch-booking-c2b-isolation-"));
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
  assert.equal(production.pages.some((route) => route.includes("c2b-")), false);
  const productionText = collectText(productionRoot).join("\n");
  for (const forbidden of [
    "C2B_WAITLIST_FIXTURE",
    "C2b 开发预览 · 模拟数据",
    "c2b-waitlist-fixture",
    "c2b-waitlist-scenario",
    "c2b-captain-applications",
    "c2b-my-registrations",
    "c2b-registration-detail",
  ]) assert.equal(productionText.includes(forbidden), false, `production output leaked ${forbidden}`);
});
