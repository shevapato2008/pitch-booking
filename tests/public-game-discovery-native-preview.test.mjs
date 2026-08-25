import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const pageNames = ["c1b-scenario", "c1b-game-discovery", "c1b-game-detail"];
const routes = pageNames.map((name) => `dev/pages/${name}/index`);

const readTree = (root) => {
  if (!existsSync(root)) return "";
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) return [readTree(target)];
    return statSync(target).isFile() ? [readFileSync(target, "utf8")] : [];
  }).join("\n");
};

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

test("fresh development output contains C1b while fresh production output contains no route, marker or synthetic game", () => {
  const developmentManifest = JSON.parse(readFileSync("dist/miniprogram-development/app.json", "utf8"));
  for (const route of routes) {
    assert.ok(developmentManifest.pages.includes(route), `development manifest missing ${route}`);
    for (const extension of ["js", "wxml", "wxss", "json"]) {
      assert.equal(existsSync(`dist/miniprogram-development/${route}.${extension}`), true, `development output missing ${route}.${extension}`);
    }
  }

  const productionManifest = readFileSync("dist/miniprogram-production/app.json", "utf8");
  const productionSource = readTree("dist/miniprogram-production");
  assert.doesNotMatch(productionManifest, /dev\/pages\/c1b-|C1B_GAME_DISCOVERY_FIXTURE/);
  assert.doesNotMatch(productionSource, /C1B_GAME_DISCOVERY_FIXTURE|dev\/pages\/c1b-|海河周六晨练局|奥体周日傍晚局|水西公园夜场局/);
});

test("the branch remains add-only inside the approved C1b boundary", () => {
  const committed = execFileSync("git", ["diff", "--name-status", "main...HEAD"], { encoding: "utf8" }).trim().split("\n").filter(Boolean);
  const working = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { encoding: "utf8" }).trim().split("\n").filter(Boolean);
  const entries = [
    ...committed.map((line) => ({ status: line.split("\t")[0], file: line.split("\t").at(-1) })),
    ...working.map((line) => ({ status: line.slice(0, 2).trim(), file: line.slice(3) })),
  ];
  const approved = [
    /^docs\/superpowers\/(?:plans|specs)\/2026-08-26-public-game-discovery-preview(?:-design)?\.md$/,
    /^artifacts\/ui\/(?:references\/public-game-discovery(?:\.(?:html|css)|-data\.js)|flows\/public-game-discovery\.md|screen-manifest\/public-game-discovery\.yaml|reviews\/public-game-discovery\/)/,
    /^miniprogram\/dev\/c1b-game-discovery-(?:fixture(?:\.test)?\.ts|pages\.json)$/,
    /^miniprogram\/dev\/pages\/c1b-(?:scenario|game-discovery|game-detail)\/index\.(?:ts|wxml|wxss|json|test\.ts)$/,
    /^tests\/public-game-discovery-(?:artifact|native-preview)\.test\.mjs$/,
  ];
  assert.ok(entries.length > 0);
  for (const { status, file } of entries) {
    assert.ok(status === "A" || status === "??", `${file} must be add-only, saw ${status}`);
    assert.ok(approved.some((pattern) => pattern.test(file)), `outside approved C1b boundary: ${file}`);
  }
});
