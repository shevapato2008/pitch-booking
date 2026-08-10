import { existsSync, readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import { parseDocument } from "yaml";

const manifestPath = "artifacts/ui/screen-manifest/venue-inventory-workbench.yaml";
const flowPath = "artifacts/ui/flows/venue-inventory-workbench.md";
const referencePath = "artifacts/ui/references/venue-inventory-workbench.html";
const reviewPath = "artifacts/ui/reviews/venue-inventory-workbench/README.md";
const stateIds = [
  "day-ready",
  "create-slot-open",
  "edit-slot-open",
  "save-result-unknown",
  "create-slot-overlap",
];

const read = (path) => readFileSync(path, "utf8");
const mustExist = (path) => assert.equal(existsSync(path), true, `missing ${path}`);
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const pngDimensions = (path) => {
  const png = readFileSync(path);
  assert.equal(png.subarray(1, 4).toString("ascii"), "PNG", `${path} must be a PNG`);
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
};

test("venue inventory manifest records reference approval while native approval remains pending", () => {
  mustExist(manifestPath);

  const document = parseDocument(read(manifestPath), { uniqueKeys: true });
  assert.deepEqual(document.errors, [], "manifest must be valid YAML with unique keys");
  assert.deepEqual(document.toJS(), {
    id: "venue-inventory-workbench",
    target_viewport: { width: 375, height: 812 },
    production_enabled: false,
    entry: "authorized-deep-link-only",
    venue_scope: {
      name: "渤海元丰足球场",
      booking_mode: "ONLINE",
      permission: "VenueMembership.can_manage_inventory",
    },
    states: stateIds.map((id) => ({
      id,
      reference: `artifacts/ui/references/venue-inventory-workbench.html?state=${id}`,
    })),
    review_slots: ["reference", "implementation", "side-by-side", "overlay-50", "difference", "observations"],
    fixture: {
      planned_path: "miniprogram/dev/venue-inventory-fixture.ts",
      deletion_condition: "delete after real inventory backend integration",
    },
    gate: "reference-artifact-approved-native-fixture-pending",
  });

  const review = read(reviewPath);
  assert.match(review, /Reference Artifact visual approval: approved on 2026-08-10/);
  assert.match(review, /Native Fixture visual approval: pending/);
});

test("venue inventory flow keeps writes behind authorization and server authority", () => {
  mustExist(flowPath);
  const flow = read(flowPath);

  for (const sentence of [
    "authorized worker → day-ready",
    "day-ready → create-slot-open",
    "create-slot-open → save-result-unknown or create-slot-overlap",
    "day-ready → edit-slot-open → save-result-unknown",
    "LOCKED / BOOKED / started slots → read-only",
    "save-result-unknown → retry with the original Idempotency-Key",
    "production home → disabled",
    "Fixture deletion → after real inventory backend integration",
  ]) assert.match(flow, new RegExp(escape(sentence)));
});

test("one self-contained 375 by 812 reference renders all approved inventory states", () => {
  mustExist(referencePath);
  const reference = read(referencePath);

  assert.match(reference, /^<!doctype html>/i);
  assert.match(reference, /<link rel="icon" href="data:," \/>/, "reference must not request a missing favicon");
  assert.match(reference, /<main class="artifact"[^>]*data-production-enabled="false"/);
  assert.match(reference, /\.artifact\s*\{[^}]*width:\s*375px;[^}]*height:\s*812px;/s);
  assert.match(reference, /font-family:\s*-apple-system,\s*BlinkMacSystemFont,\s*"Segoe UI",\s*sans-serif/);
  for (const color of ["#F8FAFC", "#FFFFFF", "#10243E", "#0284C7", "#059669"]) {
    assert.match(reference, new RegExp(escape(color), "i"));
  }
  for (const id of stateIds) {
    assert.match(reference, new RegExp(`data-state-template="${escape(id)}"`));
  }
  for (const copy of [
    "渤海元丰足球场",
    "库存工作台",
    "更多日期",
    "新增时段",
    "09:30–11:00",
    "新增并开放",
    "编辑时段",
    "已有时段不修改时间",
    "正在确认保存结果",
    "与已有时段冲突，请调整时间",
    "开放",
    "锁定",
    "已关闭",
    "已售出",
  ]) assert.match(reference, new RegExp(escape(copy)));

  assert.match(reference, /<label\b[^>]*>/);
  assert.match(reference, /\.touch-target\s*\{[^}]*min-height:\s*44px;/s);
  assert.match(reference, /:focus-visible\s*\{/);
  assert.match(reference, /\.close-button\[disabled\]\s*\{[^}]*color:\s*#CBD5E1;/s);
  assert.match(reference, /\.day-button\[aria-pressed="true"\]\s*\{[^}]*background:\s*var\(--brand-strong\);/s);
  assert.match(reference, /\.day-button\[aria-pressed="true"\] span\s*\{[^}]*color:\s*var\(--surface\);/s);
  assert.match(reference, /aria-live="polite"/);
  assert.match(reference, /disabled[^>]*aria-busy="true"|aria-busy="true"[^>]*disabled/);
  assert.match(reference, /<svg\b/);
  assert.doesNotMatch(reference, /<(?:script|img)\b[^>]*\bsrc\s*=|\b(?:src|href)\s*=\s*["']https?:\/\//i);
  assert.doesNotMatch(reference, /[\u{1F300}-\u{1FAFF}]/u, "emoji must not be used as an icon");
  assert.doesNotMatch(reference, /(?:linear|radial)-gradient\s*\(|\banimation\s*:/i);
  assert.doesNotMatch(reference, /DIRECTORY_ONLY|production_enabled:\s*true/i);
  assert.doesNotMatch(reference, /5 个真实时段/, "reference data must not be presented as real inventory");
});

test("native Fixture review evidence covers every state at the target viewport", () => {
  const reviewRoot = "artifacts/ui/reviews/venue-inventory-workbench";
  const review = read(reviewPath);
  const expectedImages = [
    ["reference-375x812.png", 375],
    ["implementation-375x812.png", 375],
    ["375x812-side-by-side.png", 750],
    ["375x812-overlay-50.png", 375],
    ["375x812-difference.png", 375],
  ];

  for (const state of stateIds) {
    for (const [suffix, width] of expectedImages) {
      const path = `${reviewRoot}/${state}-${suffix}`;
      mustExist(path);
      assert.deepEqual(pngDimensions(path), { width, height: 812 });
      assert.match(review, new RegExp(escape(path.split("/").at(-1))));
    }
  }

  for (const evidence of [
    "WeChat DevTools Stable 2.01.2510290",
    "base library 3.17.0",
    "captureVisibleRegion",
    "iPhone X",
    "iPhone 14 Pro Max",
    "Native Fixture visual approval: pending",
    "Production disabled",
  ]) assert.match(review, new RegExp(escape(evidence)));
});
