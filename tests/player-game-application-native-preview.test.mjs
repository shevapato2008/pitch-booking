import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const token = "C1A_PLAYER_APPLICATION_FIXTURE";
const pages = [
  "c1a-scenario",
  "c1a-game-public",
  "c1a-game-application",
  "c1a-captain-applications",
];
const routes = pages.map((page) => `dev/pages/${page}/index`);

function readTree(root) {
  if (!existsSync(root)) return "";
  return readdirSync(root).sort().map((name) => {
    const item = path.join(root, name);
    return statSync(item).isDirectory() ? readTree(item) : readFileSync(item, "utf8");
  }).join("\n");
}

test("C1a native preview owns exactly four development-only routes", () => {
  for (const page of pages) {
    for (const extension of ["ts", "wxml", "wxss", "json"]) {
      assert.equal(existsSync(`miniprogram/dev/pages/${page}/index.${extension}`), true, `missing ${page}/index.${extension}`);
    }
    assert.deepEqual(JSON.parse(readFileSync(`miniprogram/dev/pages/${page}/index.json`, "utf8")), { navigationStyle: "custom" });
  }
  assert.equal(existsSync("miniprogram/dev/c1a-player-application-pages.json"), true, "missing C1a route fragment");
  if (!existsSync("miniprogram/dev/c1a-player-application-pages.json")) return;
  assert.deepEqual(JSON.parse(readFileSync("miniprogram/dev/c1a-player-application-pages.json", "utf8")), { token, pages: routes });
});

test("all pages identify the development preview, share the singleton, and bind every visible button", () => {
  for (const page of pages) {
    const source = readFileSync(`miniprogram/dev/pages/${page}/index.ts`, "utf8");
    const template = readFileSync(`miniprogram/dev/pages/${page}/index.wxml`, "utf8");
    assert.match(source, /c1aPlayerApplicationStore/);
    assert.doesNotMatch(source, /createC1aPlayerApplicationStore\s*\(/);
    assert.match(template, /开发预览/);
    assert.doesNotMatch(template, /[🌀-🫿]/u);
    for (const match of template.matchAll(/<button\b(?:[^>"']|"[^"]*"|'[^']*')*>/g)) {
      assert.match(match[0], /\bbindtap="[^"]+"/, `${page} contains an inert visible button: ${match[0]}`);
    }
  }
  const combined = pages.map((page) => readFileSync(`miniprogram/dev/pages/${page}/index.wxml`, "utf8")).join("\n");
  for (const forbidden of ["头像", "手机号", "微信号", "履约", "通知", "候补"]) assert.doesNotMatch(combined, new RegExp(forbidden));
});

test("native controls use centered 88rpx targets and safe-area fixed footers", () => {
  for (const page of pages) {
    const styles = readFileSync(`miniprogram/dev/pages/${page}/index.wxss`, "utf8");
    const button = styles.match(/\.c1a-button\s*\{([^}]*)\}/)?.[1] ?? "";
    assert.match(button, /min-height:\s*88rpx/);
    assert.match(button, /display:\s*flex/);
    assert.match(button, /align-items:\s*center/);
    assert.match(button, /justify-content:\s*center/);
    assert.match(styles, /\.c1a-icon-button\s*\{[^}]*min-width:\s*88rpx[^}]*min-height:\s*88rpx[^}]*display:\s*flex[^}]*align-items:\s*center[^}]*justify-content:\s*center/s);
  }
  for (const page of ["c1a-game-public", "c1a-game-application"]) {
    const styles = readFileSync(`miniprogram/dev/pages/${page}/index.wxss`, "utf8");
    assert.match(styles, /\.c1a-footer\s*\{[^}]*position:\s*fixed[^}]*bottom:\s*0[^}]*env\(safe-area-inset-bottom/s);
  }
  const formStyles = readFileSync("miniprogram/dev/pages/c1a-game-application/index.wxss", "utf8");
  assert.match(formStyles, /\.c1a-option\s*\{[^}]*min-height:\s*88rpx[^}]*display:\s*flex[^}]*align-items:\s*center[^}]*justify-content:\s*center/s);
  const captainStyles = readFileSync("miniprogram/dev/pages/c1a-captain-applications/index.wxss", "utf8");
  assert.match(captainStyles, /\.c1a-sheet-close\s*\{[^}]*min-width:\s*88rpx[^}]*min-height:\s*88rpx[^}]*display:\s*flex[^}]*align-items:\s*center[^}]*justify-content:\s*center/s);
  assert.match(captainStyles, /\.c1a-scrim\s*\{[^}]*env\(safe-area-inset-bottom/s);
});

test("native representative layouts preserve the approved Artifact composition", () => {
  const publicTemplate = readFileSync("miniprogram/dev/pages/c1a-game-public/index.wxml", "utf8");
  for (const className of ["c1a-confirmed-row", "c1a-game-hero", "c1a-metrics", "c1a-status-card", "c1a-detail-grid"]) {
    assert.match(publicTemplate, new RegExp(className), `public detail is missing ${className}`);
  }
  assert.match(publicTemplate, /登录只建立本次开发预览身份/);

  const formTemplate = readFileSync("miniprogram/dev/pages/c1a-game-application/index.wxml", "utf8");
  const formSource = readFileSync("miniprogram/dev/pages/c1a-game-application/index.ts", "utf8");
  const formStyles = readFileSync("miniprogram/dev/pages/c1a-game-application/index.wxss", "utf8");
  assert.match(formTemplate, /c1a-form-intro/);
  assert.doesNotMatch(formTemplate, /<view class="c1a-card">\s*<text class="c1a-heading">你的本场信息/);
  for (const field of ["adultConfirmed", "riskConfirmed"]) {
    assert.match(formTemplate, new RegExp(`wx:if="\\{\\{attempted && validation\\.errors\\.${field}\\}\\}"`));
    assert.doesNotMatch(formTemplate, new RegExp(`wx:if="\\{\\{validation\\.errors\\.${field}\\}\\}"`));
  }
  assert.match(formSource, /\{ value: "ANY", label: "不限" \}/);
  assert.doesNotMatch(formSource, /label: "位置不限"/);
  assert.match(formStyles, /\.c1a-position-grid\s*\{[^}]*grid-template-columns:\s*repeat\(5,/s);
  assert.match(formStyles, /\.c1a-footer\s*\{[^}]*grid-template-columns:\s*repeat\(2,/s);

  const captainTemplate = readFileSync("miniprogram/dev/pages/c1a-captain-applications/index.wxml", "utf8");
  const captainStyles = readFileSync("miniprogram/dev/pages/c1a-captain-applications/index.wxss", "utf8");
  assert.match(captainTemplate, /c1a-review-context/);
  assert.match(captainTemplate, /c1a-pending-pill/);
  assert.match(captainTemplate, /class="c1a-footer"/);
  assert.doesNotMatch(captainTemplate, /class="c1a-actions"/);
  assert.match(captainStyles, /\.c1a-footer\s*\{[^}]*position:\s*fixed[^}]*bottom:\s*0[^}]*env\(safe-area-inset-bottom/s);

  const fixture = readFileSync("miniprogram/dev/c1a-player-application-fixture.ts", "utf8");
  for (const sourceTruth of [
    'startsAt: "2026-08-30T19:00:00+08:00"',
    'endsAt: "2026-08-30T21:00:00+08:00"',
    "aaCents: 3200",
    'registrationDeadline: "2026-08-30T17:00:00+08:00"',
    'equipmentAndArrivalNotes: "深浅两套球衣，提前 15 分钟到场"',
  ]) assert.match(fixture, new RegExp(sourceTruth.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("production source and the freshly built production package contain no C1a route or marker", () => {
  const productionSource = [
    readFileSync("miniprogram/app.json", "utf8"),
    readTree("miniprogram/pages"),
    readTree("miniprogram/domain"),
    readTree("miniprogram/services"),
  ].join("\n");
  assert.doesNotMatch(productionSource, /dev\/pages\/c1a-|C1A_PLAYER_APPLICATION_FIXTURE/);

  const productionRoot = "dist/miniprogram-production";
  assert.equal(existsSync(productionRoot), true, "run a fresh production build before this isolation assertion");
  const productionOutput = readTree(productionRoot);
  assert.doesNotMatch(productionOutput, /dev\/pages\/c1a-|C1A_PLAYER_APPLICATION_FIXTURE/);
  for (const route of routes) assert.equal(existsSync(path.join(productionRoot, `${route}.js`)), false);
});
