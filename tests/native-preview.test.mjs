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
  const chipGroup = markup.match(/<view class="chip-group"[^>]*>([\s\S]*?)<\/view>\s*<view class="price-panel/)?.[1] ?? "";
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
});
