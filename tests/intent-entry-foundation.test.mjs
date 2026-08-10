import { existsSync, readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import { parseDocument } from "yaml";

const manifestPath = "artifacts/ui/screen-manifest/intent-entry-foundation.yaml";
const flowPath = "artifacts/ui/flows/intent-entry-foundation.md";
const firstReferencePath = "artifacts/ui/references/intent-entry-first.html";
const returningReferencePath = "artifacts/ui/references/intent-home-returning.html";
const reviewRoot = "artifacts/ui/reviews/intent-entry-foundation";

const read = (path) => readFileSync(path, "utf8");
const mustExist = (path) => assert.equal(existsSync(path), true, `missing ${path}`);
const count = (source, pattern) => [...source.matchAll(pattern)].length;

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
  ]) assert.match(flow, new RegExp(sentence.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("both self-contained 375 by 812 references preserve the intent hierarchy", () => {
  for (const path of [firstReferencePath, returningReferencePath]) mustExist(path);
  const first = read(firstReferencePath);
  const returning = read(returningReferencePath);

  for (const source of [first, returning]) {
    assert.match(source, /^<!doctype html>/i);
    assert.match(source, /\.artifact\s*\{[^}]*width:\s*375px;[^}]*height:\s*812px;/s);
    assert.match(source, /天津足球/);
    assert.match(source, /class="capsule-safe"/);
    assert.match(source, /<svg\b/);
    assert.doesNotMatch(source, /<(?:script|img)\b[^>]*\bsrc\s*=|\b(?:src|href)\s*=\s*["']https?:\/\//i);
    assert.doesNotMatch(source, /[\u{1F300}-\u{1FAFF}]/u, "emoji must not be used as an icon");
    assert.match(source, /min-height:\s*44px/);
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

  assert.match(returning, /<main class="artifact" data-state="returning-home">/);
  for (const copy of [
    "早上好", "今天想从哪里开始？", "出租场地", "租赁场地", "找球踢",
    "渤海元丰足球场", "查看未来 14 天可订时段", "1 个待支付订单", "请在剩余时间内完成支付",
    "visual Fixture data",
  ]) assert.match(returning, new RegExp(copy));
});

test("review board reserves all evidence and records the visual approval boundary", () => {
  const readmePath = `${reviewRoot}/README.md`;
  const boardPath = `${reviewRoot}/review-board.html`;
  mustExist(readmePath);
  mustExist(boardPath);
  const readme = read(readmePath);
  const board = read(boardPath);

  for (const source of [readme, board]) {
    for (const label of ["first-entry", "returning-home"]) assert.match(source, new RegExp(label));
  }
  for (const text of [
    "375 × 812", "产品/IA approved，但 native visual not approved", "production disabled",
    "reference/implementation same logical viewport", "delete before production intent home integration",
    "不授权 inventory/backend",
  ]) assert.match(readme, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  for (const category of ["composition", "geometry/spacing", "component hierarchy", "typography/color/material", "icon assets", "copy", "state semantics"]) {
    assert.match(readme, new RegExp(category));
  }
  for (const state of ["first-entry", "returning-home"]) {
    const stateBoard = board.match(new RegExp(`<section[^>]*data-state="${state}"[\\s\\S]*?<\\/section>`));
    assert.ok(stateBoard, `missing ${state} review section`);
    assert.equal(count(stateBoard[0], /data-review-slot=/g), 6, `${state} must reserve six review slots`);
    assert.equal(count(stateBoard[0], /等待视觉取证/g), 5, `${state} must mark all image slots pending`);
  }
});
