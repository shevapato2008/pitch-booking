import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (relativePath) => readFile(relativePath, "utf8");

function declarationProperties(stylesheet, selector) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const body = stylesheet.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`))?.[1];
  assert.notEqual(body, undefined, `missing declaration ${selector}`);

  return Object.fromEntries(
    [...body.matchAll(/([a-z-]+)\s*:\s*([^;]+)\s*;/g)]
      .map(([, property, value]) => [property, value.trim()]),
  );
}

function assertDeclaration(stylesheet, selector, expected) {
  const properties = declarationProperties(stylesheet, selector);
  for (const [property, value] of Object.entries(expected)) {
    assert.equal(properties[property], value, `${selector} must set ${property}: ${value}`);
  }
}

test("venue page uses the shared navigation title and back action", async () => {
  const pageConfig = JSON.parse(await read("miniprogram/pages/venue/index.json"));

  assert.equal(pageConfig.navigationBarTitleText, "球场预订");
  assert.equal(pageConfig.navigationStyle, "custom");
  assert.equal(pageConfig.usingComponents["module-navigation"], "/components/module-navigation/index");
  assert.match(await read("miniprogram/pages/venue/index.wxml"), /<module-navigation title="球场预订" action="back" bind:navigate="onHeaderBack"/);
});

test("venue page registers the shared venue card", async () => {
  const pageConfig = JSON.parse(await read("miniprogram/pages/venue/index.json"));

  assert.equal(pageConfig.usingComponents?.["venue-card"], "/components/venue-card/index");
});

test("venue journey guards the availability action without promising online booking", async () => {
  const pageMarkup = await read("miniprogram/pages/venue/index.wxml");
  const primaryAction = pageMarkup.match(
    /<button[^>]*bindtap="onViewAvailability"[^>]*>([\s\S]*?)<\/button>/,
  )?.[1] ?? "";

  assert.match(pageMarkup, /<button[^>]*wx:if="\{\{canBook\}\}"[^>]*bindtap="onViewAvailability"/);
  assert.equal(primaryAction.trim(), "查看场地时段");
});

test("production venue page has no development import", async () => {
  const pageController = await read("miniprogram/pages/venue/index.ts");

  assert.doesNotMatch(pageController, /(?:from\s+["'][^"']*\/dev\/|require\s*\(\s*["'][^"']*\/dev\/)/);
});

test("venue CTA keeps all required navigation parameters guarded", async () => {
  const pageController = await read("miniprogram/pages/venue/index.ts");

  assert.match(pageController, /if\s*\(\s*!venue\s*\|\|\s*!initialPitchType\s*\|\|\s*!initialDate\s*\)\s*return/);
  assert.match(pageController, /venueId=\$\{encodeURIComponent\(venue\.id\)\}/);
  assert.match(pageController, /[?&]pitchType=\$\{initialPitchType\}/);
  assert.match(pageController, /[?&]date=\$\{initialDate\}/);
});

test("venue content reserves the fixed action bar and device safe area", async () => {
  const pageStyles = await read("miniprogram/pages/venue/index.wxss");
  const content = declarationProperties(pageStyles, ".content");

  assert.equal(content["padding-bottom"], "calc(160rpx + env(safe-area-inset-bottom))");
});

test("global and isolated styles import the shared tokens", async () => {
  const [appStyles, componentStyles] = await Promise.all([
    read("miniprogram/app.wxss"),
    read("miniprogram/components/venue-card/index.wxss"),
  ]);

  assert.match(appStyles, /^@import\s+["']\.\/styles\/tokens\.wxss["'];/m);
  assert.match(componentStyles, /^@import\s+["']\.\.\/\.\.\/styles\/tokens\.wxss["'];/m);
});

test("shared tokens contain the approved Night Glow native design values", async () => {
  const tokens = await read("miniprogram/styles/tokens.wxss");

  assertDeclaration(tokens, ".u-page", { background: "#0B1727" });
  assertDeclaration(tokens, ".u-surface", { background: "#152539" });
  assertDeclaration(tokens, ".u-text", { color: "#F3F8FF" });
  assertDeclaration(tokens, ".u-muted", { color: "#A4B5C8" });
  assertDeclaration(tokens, ".u-border", { border: "2rpx solid #314157" });
  assertDeclaration(tokens, ".u-radius-sm", { "border-radius": "16rpx" });
  assertDeclaration(tokens, ".u-radius-md", { "border-radius": "24rpx" });
  assertDeclaration(tokens, ".u-radius-lg", { "border-radius": "32rpx" });
  assertDeclaration(tokens, ".u-type-caption", { "font-size": "24rpx" });
  assertDeclaration(tokens, ".u-type-body", { "font-size": "28rpx" });
  assertDeclaration(tokens, ".u-type-subtitle", { "font-size": "32rpx" });
  assertDeclaration(tokens, ".u-type-title", { "font-size": "40rpx" });
  assertDeclaration(tokens, ".u-type-cta", { "font-size": "30rpx" });
  assertDeclaration(tokens, ".u-pad-page", { "padding-right": "24rpx", "padding-left": "24rpx" });
  assertDeclaration(tokens, ".u-control", { "min-height": "88rpx" });
  assertDeclaration(tokens, ".u-status-available", { color: "#A6EDB9", background: "#17392F" });
  assertDeclaration(tokens, ".u-trust-primary", { color: "#CEFF80" });
  assertDeclaration(tokens, ".u-trust-secondary", { color: "#92DDC3" });
  assertDeclaration(tokens, ".u-status-unavailable", { color: "#8B9DB3" });
  assertDeclaration(tokens, ".u-status-held", { color: "#FFD094" });
  assert.doesNotMatch(tokens, /--[a-z][a-z0-9-]*\s*:/i);
});

test("venue identity is overlaid inside the hero", async () => {
  const markup = await read("miniprogram/components/venue-card/index.wxml");
  const hero = markup.match(/<view class="hero">([\s\S]*?)<\/view>\s*<view class="card-body/)?.[1] ?? "";

  assert.match(hero, /class="hero-overlay/);
  assert.match(hero, /\{\{venue\.name\}\}/);
  assert.match(hero, /\{\{venue\.description\}\}/);
});

test("venue card renders every server-provided pitch and facility label", async () => {
  const markup = await read("miniprogram/components/venue-card/index.wxml");
  assert.match(markup, /wx:for="\{\{venue\.pitchTypes\}\}"[^>]*wx:key="code"[^>]*>\{\{item\.label\}\}<\/view>/);
  assert.match(markup, /wx:for="\{\{venue\.facilities\}\}"[^>]*wx:key="code"[^>]*>\{\{item\.label\}\}<\/view>/);
  assert.equal((markup.match(/wx:for="\{\{venue\.(?:pitchTypes|facilities)\}\}"/g) ?? []).length, 2);
});

test("venue consumers use shared token utilities", async () => {
  const [tokens, componentMarkup, pageMarkup] = await Promise.all([
    read("miniprogram/styles/tokens.wxss"),
    read("miniprogram/components/venue-card/index.wxml"),
    read("miniprogram/pages/venue/index.wxml"),
  ]);

  for (const utility of ["u-surface", "u-text", "u-muted", "u-radius-lg", "u-type-body"]) {
    assert.match(tokens, new RegExp(`\\.${utility}\\s*\\{`), `missing utility ${utility}`);
    assert.match(`${componentMarkup}\n${pageMarkup}`, new RegExp(`class="[^"]*\\b${utility}\\b`), `unused utility ${utility}`);
  }
  assert.match(pageMarkup, /class="[^"]*\bu-control\b/);
  assert.match(componentMarkup, /class="[^"]*\bu-trust-primary\b/);
});

test("availability page registers native controls with the shared neutral title", async () => {
  const pageConfig = JSON.parse(await read("miniprogram/pages/availability/index.json"));

  assert.equal(pageConfig.navigationBarTitleText, "场地时段");
  assert.equal(pageConfig.navigationStyle, "custom");
  assert.match(await read("miniprogram/pages/availability/index.wxml"), /<module-navigation title="场地时段" action="back" bind:navigate="onHeaderBack"/);
  assert.deepEqual(pageConfig.usingComponents, {
    "module-navigation": "/components/module-navigation/index",
    "date-strip": "/components/date-strip/index",
    "pitch-filter": "/components/pitch-filter/index",
    "slot-grid": "/components/slot-grid/index",
  });
});

test("availability boundary exposes all slot states and an explicit empty state", async () => {
  const [pageMarkup, slotMarkup, presentation] = await Promise.all([
    read("miniprogram/pages/availability/index.wxml"),
    read("miniprogram/components/slot-grid/index.wxml").catch(() => ""),
    read("miniprogram/presentation/availability.ts"),
  ]);
  const availabilityBoundary = `${pageMarkup}\n${slotMarkup}\n${presentation}`;

  for (const label of ["可订", "已结束", "暂时锁定", "已预订", "未开放"]) {
    assert.match(availabilityBoundary, new RegExp(label));
  }
  assert.match(pageMarkup, />\s*当天暂无场地时段\s*</);
  assert.match(pageMarkup, /disabled="\{\{!onlineBookingEnabled\}\}"/);
  assert.match(pageMarkup, /仅展示场地库存，暂不能选择或下单。/);
});

test("slot grid avoids unsupported component attribute selectors", async () => {
  const [markup, styles] = await Promise.all([
    read("miniprogram/components/slot-grid/index.wxml"),
    read("miniprogram/components/slot-grid/index.wxss"),
  ]);

  assert.doesNotMatch(styles, /\[[^\]]+\]\s*\{/);
  assert.match(markup, /slot--disabled/);
  assertDeclaration(styles, ".slot--disabled", { opacity: "1" });
});
