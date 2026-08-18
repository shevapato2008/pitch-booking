import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const fixturePath = "miniprogram/dev/captain-open-game-fixture.ts";
const pages = ["captain-game-form", "captain-game-manage", "captain-game-public"];

test("captain open game preview is entirely isolated under development with a slice-local route fragment", () => {
  for (const page of pages) for (const extension of ["ts", "wxml", "wxss", "json"]) {
    assert.equal(existsSync(`miniprogram/dev/pages/${page}/index.${extension}`), true, `missing ${page}/index.${extension}`);
  }
  const routes = JSON.parse(readFileSync("miniprogram/dev/captain-open-game-pages.json", "utf8"));
  assert.deepEqual(routes, { token: "CAPTAIN_OPEN_GAME_FIXTURE", pages: pages.map((page) => `dev/pages/${page}/index`) });
  assert.match(readFileSync(fixturePath, "utf8"), /CAPTAIN_OPEN_GAME_FIXTURE/);
  const production = readFileSync("miniprogram/app.json", "utf8");
  assert.doesNotMatch(production, /CAPTAIN_OPEN_GAME_FIXTURE|captain-game-|captain-open-game/i);
  for (const page of pages) assert.deepEqual(JSON.parse(readFileSync(`miniprogram/dev/pages/${page}/index.json`, "utf8")), { navigationStyle: "custom" });
});

test("native templates preserve honest Fixture-only lifecycle and public read-only semantics", () => {
  const form = readFileSync("miniprogram/dev/pages/captain-game-form/index.wxml", "utf8");
  const manage = readFileSync("miniprogram/dev/pages/captain-game-manage/index.wxml", "utf8");
  const publicPage = readFileSync("miniprogram/dev/pages/captain-game-public/index.wxml", "utf8");
  const styles = pages.map((page) => readFileSync(`miniprogram/dev/pages/${page}/index.wxss`, "utf8")).join("\n");
  for (const copy of ["真实订场已确认", "{{saveLabel}}", "返回订单", "计划总人数不能少于固定队员和开放名额之和"]) assert.match(form, new RegExp(copy));
  for (const copy of ["发布前确认", "确认发布", "暂时无法分享", "确认取消球局", "只取消本次开放球局，不会取消已预订场地，也不会发起退款。", "球局已取消"]) assert.match(manage, new RegExp(copy));
  assert.match(publicPage, /当前仅供查看，申请加入即将开放/);
  assert.doesNotMatch(publicPage, /<button[^>]*>[^<]*(申请加入|我要报名|立即加入)/);
  assert.doesNotMatch(`${form}\n${manage}\n${publicPage}`, /[\u{1F300}-\u{1FAFF}]/u);
  for (const template of [form, manage, publicPage]) assert.match(template, /class="captain-game-nav-back"[^>]*bindtap="onHeaderBack"/);
  for (const template of [form, manage, publicPage]) {
    assert.match(template, /padding-left: \{\{headerLeftInsetPx\}\}px; padding-right: \{\{headerRightInsetPx\}\}px/);
    assert.match(template, /class="captain-game-nav-subtitle">开发预览/);
    assert.doesNotMatch(template.match(/class="captain-game-nav"[\s\S]*?<\/view>/)?.[0] ?? "", /CAPTAIN_OPEN_GAME_FIXTURE/);
  }
  assert.match(manage, /bindtap="onAbandon">放弃草稿/);
  assert.match(manage, /panel === 'abandon'[\s\S]*确认放弃草稿[\s\S]*继续保留/);
  for (const selector of [".captain-game-primary", ".captain-game-secondary", ".captain-game-stepper__button"]) {
    const body = styles.match(new RegExp(`${selector.replace(".", "\\.")}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
    assert.match(body, /display:\s*flex;/);
    assert.match(body, /align-items:\s*center;/);
    assert.match(body, /justify-content:\s*center;/);
  }
  assert.match(styles, /min-height:\s*88rpx/);
  assert.match(styles, /env\(safe-area-inset-bottom/);
  for (const selector of [".captain-game-nav-back", ".captain-game-stepper__button"]) {
    const bodies = [...styles.matchAll(new RegExp(`${selector.replace(".", "\\.")}\\s*\\{([^}]*)\\}`, "g"))].map((match) => match[1]);
    assert.ok(bodies.some((body) => /min-width:\s*88rpx/.test(body) && /min-height:\s*88rpx/.test(body) && /display:\s*flex/.test(body) && /align-items:\s*center/.test(body) && /justify-content:\s*center/.test(body)), `${selector} must be an 88rpx centered target`);
  }
});
