import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const pageNames = ["c1b-scenario", "c1b-game-discovery", "c1b-game-detail"];
const routes = pageNames.map((name) => `dev/pages/${name}/index`);

test("the slice-local inventory owns exactly three complete custom-navigation pages", () => {
  assert.deepEqual(JSON.parse(readFileSync("miniprogram/dev/c1b-game-discovery-pages.json", "utf8")), {
    token: "C1B_GAME_DISCOVERY_FIXTURE",
    pages: routes,
  });
  for (const pageName of pageNames) {
    const base = `miniprogram/dev/pages/${pageName}/index`;
    for (const extension of ["ts", "wxml", "wxss", "json"]) {
      assert.equal(existsSync(`${base}.${extension}`), true, `missing ${base}.${extension}`);
    }
    assert.deepEqual(JSON.parse(readFileSync(`${base}.json`, "utf8")), { navigationStyle: "custom" });
  }
});

test("headers, controls and vertical scrolling freeze the corrected 375x812 geometry", () => {
  const templates = pageNames.map((name) => readFileSync(`miniprogram/dev/pages/${name}/index.wxml`, "utf8")).join("\n");
  const styles = pageNames.map((name) => readFileSync(`miniprogram/dev/pages/${name}/index.wxss`, "utf8")).join("\n");

  assert.doesNotMatch(templates, /‹|[\u{1F300}-\u{1FAFF}]/u);
  assert.match(styles, /grid-template-columns:\s*88rpx minmax\(0, 1fr\) 88rpx/);
  assert.match(styles, /\.c1b-back-icon::before\s*\{[^}]*border-left:[^}]*border-bottom:[^}]*transform:\s*rotate\(45deg\)/s);
  assert.match(styles, /\.c1b-page\s*\{[^}]*height:\s*100vh;[^}]*overflow:\s*hidden;/s);
  assert.match(styles, /\.c1b-scroll\s*\{[^}]*flex:\s*1[^;]*;[^}]*height:\s*0;[^}]*min-height:\s*0;/s);
  assert.match(styles, /env\(safe-area-inset-bottom/);
  assert.match(styles, /min-height:\s*88rpx/);
  assert.match(styles, /display:\s*flex;[^}]*align-items:\s*center;[^}]*justify-content:\s*center;/s);
  assert.doesNotMatch(templates, /padding-(?:left|right):\s*\{\{header(?:Left|Right)InsetPx\}\}/);
});

test("the directory uses exact whole-card actions and the preview stays read-only and private", () => {
  const directory = readFileSync("miniprogram/dev/pages/c1b-game-discovery/index.wxml", "utf8");
  const detail = readFileSync("miniprogram/dev/pages/c1b-game-detail/index.wxml", "utf8");
  const card = directory.match(/<button[^>]+class="c1b-game-card"[\s\S]*?<\/button>/)?.[0] ?? "";
  assert.match(card, /data-game-id="\{\{item\.id\}\}"/);
  assert.match(card, /bindtap="onOpenGame"/);
  assert.doesNotMatch(card, /<button[^>]*>[\s\S]*<button/);
  assert.doesNotMatch(`${directory}\n${detail}`, /申请加入|我要报名|立即加入|手机号|微信号|订单号|成员名单|支付字段/);
  for (const template of [directory, detail]) {
    for (const button of template.match(/<button\b[^>]*>/g) ?? []) assert.match(button, /bindtap="on[A-Za-z]+"/);
  }
});

test("C1b preview routes and its fixture adapter remain source-local under miniprogram/dev", () => {
  const previewInventory = JSON.parse(readFileSync("miniprogram/dev/c1b-game-discovery-pages.json", "utf8"));
  assert.deepEqual(previewInventory.pages, routes);
  for (const route of routes) {
    assert.match(route, /^dev\/pages\/c1b-/);
    assert.equal(existsSync(`miniprogram/${route}.ts`), true, `source missing ${route}.ts`);
  }

  const adapter = readFileSync("miniprogram/dev/public-game-directory-source.ts", "utf8");
  assert.match(adapter, /\.\/c1b-game-discovery-fixture/);
  assert.match(adapter, /\/dev\/pages\/c1b-game-detail\/index\?gameId=/);
  const bootstrap = readFileSync("miniprogram/dev/bootstrap.ts", "utf8");
  assert.match(bootstrap, /registerPublicGameDirectorySource\(createDevelopmentPublicGameDirectorySource\(\)\)/);
});

test("production route inventory includes discovery without any C1b preview route or token", () => {
  const manifest = JSON.parse(readFileSync("miniprogram/app.json", "utf8"));
  assert.ok(manifest.pages.includes("pages/game-discovery/index"));
  for (const route of routes) assert.equal(manifest.pages.includes(route), false, `${route} leaked into production routes`);
  assert.doesNotMatch(JSON.stringify(manifest), /C1B_GAME_DISCOVERY_FIXTURE|dev\/pages\/c1b-/);

  const productionPage = ["ts", "wxml", "wxss", "json"]
    .map((extension) => readFileSync(`miniprogram/pages/game-discovery/index.${extension}`, "utf8"))
    .join("\n");
  assert.doesNotMatch(
    productionPage,
    /C1B_GAME_DISCOVERY_FIXTURE|dev\/pages\/c1b-|海河周六晨练局|奥体周日傍晚局|水西公园夜场局/,
  );
});
