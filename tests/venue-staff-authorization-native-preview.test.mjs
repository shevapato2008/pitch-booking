import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const pages = [
  "dev/pages/d1b-staff-scenario/index",
  "dev/pages/d1b-venue-staff/index",
  "dev/pages/d1b-staff-invitation/index",
];
const read = (path) => readFileSync(path, "utf8");

test("D1b preview declares three isolated native pages", () => {
  assert.deepEqual(JSON.parse(read("miniprogram/dev/d1b-venue-staff-pages.json")), {
    token: "D1B_VENUE_STAFF_AUTHORIZATION_FIXTURE",
    pages,
  });
  for (const page of pages) {
    for (const extension of ["ts", "json", "wxml", "wxss"]) {
      assert.equal(existsSync(`miniprogram/${page}.${extension}`), true, `${page}.${extension}`);
    }
  }
});

test("D1b preview exposes truthful roles, permissions and working actions", () => {
  const fixture = read("miniprogram/dev/d1b-venue-staff-fixture.ts");
  const scenario = read("miniprogram/dev/pages/d1b-staff-scenario/index.ts");
  const staff = read("miniprogram/dev/pages/d1b-venue-staff/index.ts");
  const invitation = read("miniprogram/dev/pages/d1b-staff-invitation/index.ts");
  const markup = pages.map((page) => read(`miniprogram/${page}.wxml`)).join("\n");
  const styles = pages.map((page) => read(`miniprogram/${page}.wxss`)).join("\n");

  assert.match(fixture, /MANAGE_PROFILE[\s\S]*MANAGE_PITCHES[\s\S]*MANAGE_INVENTORY[\s\S]*FULFILL_ORDERS/);
  assert.match(fixture, /OWNER[\s\S]*STAFF/);
  assert.match(scenario, /owner[\s\S]*staff[\s\S]*invitation[\s\S]*unavailable/);
  for (const handler of [
    "onOpenCreate", "onCreateInvitation", "onCopyInvitation", "onOpenEdit",
    "onSavePermissions", "onPrepareRemove", "onConfirmRemove", "onRevokeInvitation",
    "onAcceptInvitation", "onOpenPortfolio", "onRetry",
  ]) assert.match(staff + invitation, new RegExp(handler));
  assert.match(markup, /D1b 开发预览 · 模拟数据/);
  assert.match(markup, /负责人转移请联系平台处理/);
  assert.doesNotMatch(staff + invitation, /wx\.request|fetch\(|WebSocket|sendBeacon/);
  for (const selector of ["d1b-header-back", "d1b-primary", "d1b-modal-button"]) {
    const rule = styles.match(new RegExp(`\\.${selector}\\s*\\{[^}]*\\}`, "s"))?.[0] ?? "";
    assert.match(rule, /display:\s*flex/);
    assert.match(rule, /align-items:\s*center/);
    assert.match(rule, /justify-content:\s*center/);
  }
  assert.match(styles, /env\(safe-area-inset-bottom,\s*0px\)/);
});

test("D1b fixtures are absent from the production manifest", () => {
  const production = JSON.parse(read("miniprogram/app.json"));
  for (const page of pages) assert.equal(production.pages.includes(page), false);
});

