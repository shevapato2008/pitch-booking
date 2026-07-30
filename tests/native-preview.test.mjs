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

test("venue page uses the system navigation title", async () => {
  const pageConfig = JSON.parse(await read("miniprogram/pages/venue/index.json"));

  assert.equal(pageConfig.navigationBarTitleText, "球场预订");
  assert.equal(pageConfig.navigationStyle, undefined);
});

test("venue page registers the shared venue card", async () => {
  const pageConfig = JSON.parse(await read("miniprogram/pages/venue/index.json"));

  assert.equal(pageConfig.usingComponents?.["venue-card"], "/components/venue-card/index");
});

test("venue journey exposes the agreed primary action", async () => {
  const [pageMarkup, componentMarkup] = await Promise.all([
    read("miniprogram/pages/venue/index.wxml"),
    read("miniprogram/components/venue-card/index.wxml").catch(() => ""),
  ]);

  assert.match(`${pageMarkup}\n${componentMarkup}`, />\s*查看可订时段\s*</);
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

test("shared tokens contain the approved native design values", async () => {
  const tokens = await read("miniprogram/styles/tokens.wxss");

  assertDeclaration(tokens, ".u-page", { background: "#F8FAFC" });
  assertDeclaration(tokens, ".u-surface", { background: "#FFFFFF" });
  assertDeclaration(tokens, ".u-text", { color: "#10243E" });
  assertDeclaration(tokens, ".u-muted", { color: "#64748B" });
  assertDeclaration(tokens, ".u-border", { border: "2rpx solid #DBE5EC" });
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
  assertDeclaration(tokens, ".u-status-available", { color: "#059669", background: "#EFFBF6" });
  assertDeclaration(tokens, ".u-trust-primary", { color: "#0284C7" });
  assertDeclaration(tokens, ".u-trust-secondary", { color: "#0EA5E9" });
  assertDeclaration(tokens, ".u-status-unavailable", { color: "#94A3B8" });
  assertDeclaration(tokens, ".u-status-held", { color: "#B45309" });
  assert.doesNotMatch(tokens, /--[a-z][a-z0-9-]*\s*:/i);
});

test("venue identity is overlaid inside the hero", async () => {
  const markup = await read("miniprogram/components/venue-card/index.wxml");
  const hero = markup.match(/<view class="hero">([\s\S]*?)<\/view>\s*<view class="card-body/)?.[1] ?? "";

  assert.match(hero, /class="hero-overlay/);
  assert.match(hero, /\{\{venue\.name\}\}/);
  assert.match(hero, /\{\{venue\.description\}\}/);
});

test("venue card shows exactly the three confirmed preview labels", async () => {
  const markup = await read("miniprogram/components/venue-card/index.wxml");
  const chipGroup = markup.match(
    /<view class="chip-group"[^>]*>([\s\S]*?)<\/view>\s*<view wx:if="\{\{venue\.bookingMode === 'DIRECTORY_ONLY'\}\}" class="directory-notice/,
  )?.[1] ?? "";
  const chipNodes = chipGroup.match(/<view[^>]*class="[^"]*\bchip\b[^"]*"[^>]*>[\s\S]*?<\/view>/g) ?? [];
  const chipBindings = chipGroup.match(/\{\{venue\.(?:pitchTypes|facilities)\[\d\]\.label\}\}/g) ?? [];

  assert.equal(chipNodes.length, 3);
  assert.deepEqual(chipBindings, [
    "{{venue.pitchTypes[0].label}}",
    "{{venue.pitchTypes[1].label}}",
    "{{venue.facilities[0].label}}",
  ]);
  assert.doesNotMatch(markup, /wx:for="\{\{venue\.(?:pitchTypes|facilities)\}\}"/);
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

test("availability page registers native controls with the system title", async () => {
  const pageConfig = JSON.parse(await read("miniprogram/pages/availability/index.json"));

  assert.equal(pageConfig.navigationBarTitleText, "选择可订时段");
  assert.equal(pageConfig.navigationStyle, undefined);
  assert.deepEqual(pageConfig.usingComponents, {
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
  assert.match(pageMarkup, />\s*当天暂无可订时段\s*</);
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
