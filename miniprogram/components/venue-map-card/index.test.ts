/// <reference types="node" />

import { expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";

const template = readFileSync("miniprogram/components/venue-map-card/index.wxml", "utf8");
const styles = readFileSync("miniprogram/components/venue-map-card/index.wxss", "utf8");

test("renders a permanently reserved action for both booking modes", () => {
  expect(template).not.toContain('wx:if="{{card.selected}}"');
  expect(template).toContain('class="venue-row-action"');
  expect(template).toContain("查看可订时段");
  expect(template).toContain("查看场馆详情");
  expect(template).toContain('catchtap="onAction"');
});

test("keeps every selected and unselected row at the exact fixed dimensions", () => {
  expect(styles).toMatch(/\.venue-row\s*\{[^}]*height:\s*232rpx/s);
  expect(styles).toMatch(/\.venue-row-action\s*\{[^}]*width:\s*88rpx[^}]*height:\s*88rpx/s);
  const selectedRule = styles.match(/\.venue-row--selected\s*\{([^}]*)\}/s)?.[1] ?? "";
  expect(selectedRule).not.toMatch(/height\s*:/);
  expect(selectedRule).not.toMatch(/transform\s*:\s*scale/);
});

test("protects longest content with one-line ellipsis slots", () => {
  expect(template).toContain('class="venue-row-name"');
  expect(template).toContain('class="venue-row-address"');
  expect(template).toContain('class="venue-row-summary"');
  expect(template).toContain('class="venue-row-status venue-row-status--{{card.action}}"');
  for (const name of ["venue-row-name", "venue-row-address", "venue-row-summary"]) {
    expect(styles).toMatch(new RegExp(`\\.${name}\\s*\\{[^}]*white-space:\\s*nowrap[^}]*overflow:\\s*hidden[^}]*text-overflow:\\s*ellipsis`, "s"));
  }
  expect(styles).toMatch(/\.venue-row-status\s*\{[^}]*white-space:\s*nowrap[^}]*flex-shrink:\s*0/s);
  expect(styles).toMatch(/\.venue-row-status--VIEW_AVAILABILITY\s*\{[^}]*color:\s*#0369a1/s);
});

test("renders name, address, and combined metadata as exactly three ordered rows", () => {
  expect(template).toMatch(
    /<button class="venue-row-body"[^>]*>\s*<text class="venue-row-name">{{card\.name}}<\/text>\s*<text class="venue-row-address">{{card\.address}}<\/text>\s*<view class="venue-row-meta">\s*<text class="venue-row-summary">{{card\.distanceText \|\| card\.transitText}}<\/text>\s*<text class="venue-row-separator">·<\/text>\s*<text class="venue-row-status venue-row-status--{{card\.action}}">{{card\.statusText}}<\/text>\s*<\/view>\s*<\/button>/s,
  );
});

test("keeps combined metadata clipped while summary shrinks and status stays fixed", () => {
  expect(styles).toMatch(/\.venue-row-meta\s*\{[^}]*display:\s*flex[^}]*min-width:\s*0[^}]*overflow:\s*hidden/s);
  expect(styles).toMatch(/\.venue-row-summary\s*\{[^}]*min-width:\s*0[^}]*flex-shrink:\s*1/s);
});
