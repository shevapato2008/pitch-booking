import { existsSync, readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import { parseDocument } from "yaml";

const manifestPath = "artifacts/ui/screen-manifest/intent-entry-foundation.yaml";
const flowPath = "artifacts/ui/flows/intent-entry-foundation.md";
const firstReferencePath = "artifacts/ui/references/intent-entry-first.html";
const cityOpenReferencePath = "artifacts/ui/references/intent-entry-city-open.html";
const returningReferencePath = "artifacts/ui/references/intent-home-returning.html";
const reviewRoot = "artifacts/ui/reviews/intent-entry-foundation";
const reviewStates = ["first-entry", "city-picker-open", "returning-home"];

const read = (path) => readFileSync(path, "utf8");
const mustExist = (path) => assert.equal(existsSync(path), true, `missing ${path}`);
const count = (source, pattern) => [...source.matchAll(pattern)].length;
const pngDimensions = (path) => {
  const png = readFileSync(path);
  assert.equal(png.subarray(1, 4).toString("ascii"), "PNG", `${path} must be a PNG`);
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
};

test("intent entry manifest and flow freeze the preview-only route contract", () => {
  mustExist(manifestPath);
  mustExist(flowPath);

  const document = parseDocument(read(manifestPath), { uniqueKeys: true });
  assert.deepEqual(document.errors, [], "manifest must be valid YAML with unique keys");
  assert.deepEqual(document.toJS(), {
    id: "intent-entry-foundation",
    target_viewport: { width: 375, height: 812 },
    production_enabled: false,
    states: [
      {
        id: "first-entry",
        route: "dev/pages/intent-entry/index",
        reference: "artifacts/ui/references/intent-entry-first.html",
      },
      {
        id: "city-picker-open",
        route: "dev/pages/intent-entry/index?cityPicker=open",
        reference: "artifacts/ui/references/intent-entry-city-open.html",
      },
      {
        id: "returning-home",
        route: "dev/pages/intent-home/index",
        reference: "artifacts/ui/references/intent-home-returning.html",
      },
    ],
    review_slots: ["reference", "implementation", "side-by-side", "overlay-50", "difference", "observations"],
    fixture: "miniprogram/dev/intent-entry-fixture.ts",
    deletion_condition: "delete before production intent home integration",
  });

  const flow = read(flowPath);
  for (const sentence of [
    "first-entry 点击租赁场地 → existing venue-map",
    "first-entry 点击出租场地/找球踢 → preview-only notice",
    "returning-home 同 mapping",
    "returning-home 是下次启动的独立预览，不是首次选择中间页",
    "两页 production disabled，直到所有入口有真实 destination",
    "first-entry/returning-home 点击 天津⌄ → city-picker-open",
    "city-picker-open 点击关闭或天津 → 返回来源页",
    "天津 → 当前且已开放",
    "其他城市 → 敬请期待，不导航、不请求定位",
  ]) assert.match(flow, new RegExp(sentence.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("three self-contained 375 by 812 references preserve the intent hierarchy and city-picker state", () => {
  for (const path of [firstReferencePath, cityOpenReferencePath, returningReferencePath]) mustExist(path);
  const first = read(firstReferencePath);
  const cityOpen = read(cityOpenReferencePath);
  const returning = read(returningReferencePath);

  for (const source of [first, cityOpen, returning]) {
    assert.match(source, /^<!doctype html>/i);
    assert.match(source, /\.artifact\s*\{[^}]*width:\s*375px;[^}]*height:\s*812px;/s);
    assert.match(source, /天津/);
    assert.match(source, /天津⌄/);
    assert.match(source, /class="city-button"[^>]*>天津⌄<\/button>/);
    assert.match(source, /class="capsule-safe"/);
    assert.match(source, /<svg\b/);
    assert.doesNotMatch(source, /<(?:script|img)\b[^>]*\bsrc\s*=|\b(?:src|href)\s*=\s*["']https?:\/\//i);
    assert.doesNotMatch(source, /[\u{1F300}-\u{1FAFF}]/u, "emoji must not be used as an icon");
    assert.doesNotMatch(source, /天津足球/);
    assert.doesNotMatch(source, /(?:linear|radial)-gradient\s*\(|\banimation\s*:/i);
    assert.match(source, /min-height:\s*44px/);
    assert.match(source, /\.custom-header\s*\{[^}]*height:\s*44px;/s);
    assert.match(source, /\.custom-header\s*\{[^}]*padding:\s*0\s+100px\s+0\s+20px;/s);
  }

  assert.match(first, /<main class="artifact" data-state="first-entry">/);
  assert.equal(count(first, /class="intent-card"/g), 3, "first entry has exactly three equal intent cards");
  for (const copy of [
    "你今天想做什么？", "选择一个目的开始，之后可以随时切换。",
    "我要出租场地", "申请合作，或进入已授权的场馆工作台",
    "我要租赁场地", "为球队查找时间、价格和可订整场",
    "我要找球踢", "没有球队，也能加入已锁定场地的开放球局",
    "这里选择的是当下目的，不是永久身份。",
  ]) assert.match(first, new RegExp(copy));

  assert.match(cityOpen, /<main class="artifact" data-state="city-picker-open">/);
  assert.match(cityOpen, /<div class="city-background" inert(?:\s+aria-hidden="true")?>/);
  assert.match(cityOpen, /<\/div>\s*<div class="scrim" aria-hidden="true"><\/div>\s*<section class="city-sheet"/);
  const cityDialog = cityOpen.match(/<section class="city-sheet"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*>([\s\S]*?)<\/section>/);
  assert.ok(cityDialog, "city sheet must be a modal dialog");
  assert.match(cityDialog[0], /aria-label="选择城市"/);
  assert.match(cityDialog[0], /<h[1-6][^>]*>选择城市<\/h[1-6]>/);
  assert.match(cityDialog[0], /<button class="close-button"[^>]*aria-label="关闭城市选择"/);
  assert.match(cityDialog[0], /<button class="city-row" type="button" aria-label="天津，当前且已开放">\s*<strong>天津<\/strong><span>当前 · 已开放<\/span>/);
  assert.match(cityDialog[0], /<button class="city-row" type="button" disabled>\s*<strong>其他城市<\/strong><span>敬请期待<\/span>/);
  assert.match(cityOpen, /\.city-button\s*\{[^}]*min-height:\s*44px;/s);
  assert.match(cityOpen, /\.close-button\s*\{[^}]*width:\s*44px;[^}]*min-height:\s*44px;/s);
  assert.match(cityOpen, /\.city-row\s*\{[^}]*min-height:\s*64px;/s);
  assert.match(cityOpen, /#10243E/);

  assert.match(returning, /<main class="artifact" data-state="returning-home">/);
  assert.match(
    returning,
    /<div class="greeting">\s*<h1 id="page-title">早上好<\/h1>\s*<p>今天想从哪里开始？<\/p>\s*<\/div>/,
    "returning home leads with the greeting heading and follows with weaker supporting copy",
  );
  for (const copy of [
    "早上好", "今天想从哪里开始？", "出租场地", "租赁场地", "找球踢",
    "渤海元丰足球场", "查看未来 14 天可订时段", "1 个待支付订单", "请在剩余时间内完成支付",
    "visual Fixture data",
  ]) assert.match(returning, new RegExp(copy));
});

test("review board links the complete three-state evidence matrix and records user approval", () => {
  const readmePath = `${reviewRoot}/README.md`;
  const boardPath = `${reviewRoot}/review-board.html`;
  mustExist(readmePath);
  mustExist(boardPath);
  const readme = read(readmePath);
  const board = read(boardPath);

  for (const source of [readme, board]) {
    for (const label of reviewStates) assert.match(source, new RegExp(label));
  }
  for (const text of [
    "375 × 812", "产品/IA approved；visual evidence complete；用户视觉批准 approved", "production disabled",
    "用户于 2026-08-10 明确确认三态视觉通过",
    "reference/implementation same logical viewport", "delete before production intent home integration",
    "不授权 inventory/backend",
    "user-supplied full-window DevTools screenshot is diagnostic evidence of safe-area bug only, not same-viewport implementation evidence",
    "Stable 2.01.2510290", "base library 3.17.0", "iPhone X", "DPR 3",
    "App.captureScreenshot timeout", "user-approved fallback", "detached simulator window",
    "dev/pages/intent-entry/index?cityPicker=open", "dev/pages/intent-home/index?intent=BOOK",
  ]) assert.match(readme, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(readme, /用户视觉批准 pending/);
  assert.doesNotMatch(board, /用户视觉批准仍为 pending/);
  for (const category of ["composition", "geometry/spacing", "component hierarchy", "typography/color/material", "icon assets", "copy", "state semantics"]) {
    assert.match(readme, new RegExp(category));
  }
  assert.deepEqual(
    [...board.matchAll(/<section[^>]*data-state="([^"]+)"/g)].map((match) => match[1]),
    reviewStates,
    "review board must use the exact three-state list",
  );
  for (const state of reviewStates) {
    const stateBoard = board.match(new RegExp(`<section[^>]*data-state="${state}"[\\s\\S]*?<\\/section>`));
    assert.ok(stateBoard, `missing ${state} review section`);
    assert.equal(count(stateBoard[0], /data-review-slot=/g), 6, `${state} must reserve six review slots`);
    assert.equal(count(stateBoard[0], /<img\b/g), 5, `${state} must link five image artifacts`);
    assert.doesNotMatch(stateBoard[0], /等待视觉取证/);
  }

  const expectedImages = [
    ["reference-375x812.png", 375],
    ["implementation-375x812.png", 375],
    ["side-by-side.png", 750],
    ["overlay-50.png", 375],
    ["difference.png", 375],
  ];
  for (const state of reviewStates) {
    for (const [suffix, width] of expectedImages) {
      const path = `${reviewRoot}/${state}-${suffix}`;
      mustExist(path);
      assert.deepEqual(pngDimensions(path), { width, height: 812 });
      assert.match(board, new RegExp(path.split("/").at(-1).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  }
});
