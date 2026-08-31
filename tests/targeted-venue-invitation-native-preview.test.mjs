import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const miniPages = [
  "dev/pages/d1a-invitation-scenario/index",
  "dev/pages/d1a-venue-invitation/index",
];

const read = (path) => readFileSync(path, "utf8");

test("D1a preview declares isolated mini and platform artifacts", () => {
  const inventory = JSON.parse(read("miniprogram/dev/d1a-invitation-pages.json"));
  assert.deepEqual(inventory, {
    token: "D1A_VENUE_INVITATION_FIXTURE",
    pages: miniPages,
  });

  for (const page of miniPages) {
    for (const extension of ["ts", "json", "wxml", "wxss"]) {
      assert.equal(existsSync(`miniprogram/${page}.${extension}`), true, `${page}.${extension}`);
    }
  }

  for (const path of [
    "platform-admin/dev-recruitment-invitations/index.html",
    "platform-admin/dev-recruitment-invitations/app.js",
    "platform-admin/dev-recruitment-invitations/styles.css",
  ]) assert.equal(existsSync(path), true, path);
});

test("D1a mini preview keeps four truthful states and working buttons", () => {
  const scenarioSource = read("miniprogram/dev/pages/d1a-invitation-scenario/index.ts");
  const invitationSource = read("miniprogram/dev/pages/d1a-venue-invitation/index.ts");
  const fixtureSource = read("miniprogram/dev/d1a-venue-invitation-fixture.ts");
  const templates = miniPages.map((page) => read(`miniprogram/${page}.wxml`)).join("\n");
  const styles = miniPages.map((page) => read(`miniprogram/${page}.wxss`)).join("\n");

  assert.match(scenarioSource, /ready[\s\S]*claimed[\s\S]*submitted[\s\S]*unavailable/);
  assert.match(invitationSource, /onAcceptInvitation/);
  assert.match(invitationSource, /onContinueClaim/);
  assert.match(invitationSource, /onOpenApplications/);
  assert.match(invitationSource, /onRetry/);
  assert.match(templates, /D1a 开发预览 · 模拟数据/);
  assert.match(fixtureSource, /接受邀请并继续认领/);
  assert.match(fixtureSource, /补充认领资料/);
  assert.match(fixtureSource, /认领申请待审核/);
  assert.doesNotMatch(scenarioSource + invitationSource, /wx\.request|fetch\(|WebSocket|sendBeacon/);

  for (const selector of ["d1a-header-back", "d1a-scenario-button", "d1a-primary-button"]) {
    const rule = styles.match(new RegExp(`\\.${selector}\\s*\\{[^}]*\\}`, "s"))?.[0] ?? "";
    assert.match(rule, /display:\s*flex/);
    assert.match(rule, /align-items:\s*center/);
    assert.match(rule, /justify-content:\s*center/);
  }
  assert.match(styles, /env\(safe-area-inset-bottom,\s*0px\)/);
});

test("D1a platform preview is local-only and every visible action is wired", () => {
  const html = read("platform-admin/dev-recruitment-invitations/index.html");
  const source = read("platform-admin/dev-recruitment-invitations/app.js");
  const styles = read("platform-admin/dev-recruitment-invitations/styles.css");

  assert.match(html + source, /GAME_RECRUITMENT_INVITATION_FIXTURE/);
  assert.match(html + source, /D1a 开发预览 · 模拟数据/);
  assert.match(source, /tokenInvitationId/);
  assert.match(source, /eligibleVenues/);
  assert.match(source, /天津南开云际足球公园[\s\S]*南开区[\s\S]*红旗南路/);
  const tokenPath = source.match(/tokenPath:\s*"pages\/venue-invitation\/index\?token=([A-Za-z0-9_-]+)"/)?.[1];
  assert.equal(tokenPath?.length, 43);
  for (const action of ["create", "copy", "prepare-revoke", "cancel-revoke", "confirm-revoke", "select-row", "open-application", "nav-invitations"]) {
    assert.match(html + source, new RegExp(`data-action=["']${action}["']`));
  }
  assert.doesNotMatch(source, /fetch\(|XMLHttpRequest|WebSocket|sendBeacon|localStorage|sessionStorage/);
  assert.match(styles, /\.button\s*\{[^}]*display:\s*inline-flex[^}]*align-items:\s*center[^}]*justify-content:\s*center/s);
  assert.match(styles, /@media\s*\(max-width:\s*1200px\)/);
});

test("D1a fixtures stay out of the production manifest", () => {
  const production = JSON.parse(read("miniprogram/app.json"));
  for (const page of miniPages) assert.equal(production.pages.includes(page), false);
  assert.doesNotMatch(read("platform-admin/src/main.ts"), /GAME_RECRUITMENT_INVITATION_FIXTURE/);
});
