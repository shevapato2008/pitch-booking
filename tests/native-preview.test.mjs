import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (relativePath) => readFile(relativePath, "utf8");

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
  const exactValues = [
    "#F8FAFC", "#FFFFFF", "#10243E", "#64748B", "#DBE5EC",
    "#0284C7", "#0EA5E9", "#059669", "#EFFBF6", "#94A3B8", "#B45309",
    "24rpx", "28rpx", "32rpx", "40rpx", "30rpx",
    "16rpx", "24rpx", "32rpx", "8rpx", "48rpx", "88rpx",
  ];

  for (const value of exactValues) assert.match(tokens, new RegExp(value), `missing ${value}`);
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
  const chipBindings = markup.match(/\{\{venue\.(?:pitchTypes|facilities)\[\d\]\.label\}\}/g) ?? [];

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
