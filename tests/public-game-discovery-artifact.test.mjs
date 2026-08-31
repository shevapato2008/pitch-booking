import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { parseDocument } from "yaml";

const files = {
  html: "artifacts/ui/references/public-game-discovery.html",
  css: "artifacts/ui/references/public-game-discovery.css",
  data: "artifacts/ui/references/public-game-discovery-data.js",
  flow: "artifacts/ui/flows/public-game-discovery.md",
  manifest: "artifacts/ui/screen-manifest/public-game-discovery.yaml",
  review: "artifacts/ui/reviews/public-game-discovery/README.md",
  board: "artifacts/ui/reviews/public-game-discovery/review-board.html",
};
const states = ["ready-list", "filtered-nonempty", "filter-no-match", "load-error"];
const read = (path) => readFileSync(path, "utf8");
const missing = Object.values(files).filter((path) => !existsSync(path));
const esc = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

test("public game discovery Artifact source set exists", () => {
  assert.deepEqual(missing, [], `missing source files: ${missing.join(", ")}`);
});

test("user-visual-approved manifest freezes exactly four 375 by 812 development-only states", { skip: missing.length > 0 }, () => {
  const doc = parseDocument(read(files.manifest), { uniqueKeys: true });
  assert.deepEqual(doc.errors, []);
  const manifest = doc.toJS();
  assert.equal(manifest.id, "public-game-discovery");
  assert.deepEqual(manifest.target_viewport, { width: 375, height: 812 });
  assert.equal(manifest.production_enabled, false);
  assert.deepEqual(manifest.states.map(({ id }) => id), states);
  assert.equal(manifest.states.filter(({ representative_capture }) => representative_capture).length, 4);
  assert.deepEqual(manifest.review_slots, ["reference", "implementation", "side-by-side", "overlay-50", "difference", "observations"]);
  assert.match(manifest.fixture.deletion_condition, /production/i);
  assert.equal(manifest.gate, "user-visual-approved");
});

test("catalog is sorted and covers two available games plus one full game", { skip: missing.length > 0 }, async () => {
  const data = await import(`../${files.data}?catalog-test=1`);
  assert.deepEqual(data.PUBLIC_GAME_DISCOVERY_STATE_IDS, states);
  assert.ok(Object.isFrozen(data.PUBLIC_GAME_CATALOG));
  assert.equal(data.PUBLIC_GAME_CATALOG.length, 3);
  assert.deepEqual(data.PUBLIC_GAME_CATALOG.map(({ id }) => id), ["harbor-five", "olympic-seven", "riverside-five"]);
  assert.deepEqual(data.PUBLIC_GAME_CATALOG.map(({ remainingSpots }) => remainingSpots > 0), [true, true, false]);
  assert.deepEqual(data.PUBLIC_GAME_CATALOG.map(({ startsAt }) => startsAt), [...data.PUBLIC_GAME_CATALOG.map(({ startsAt }) => startsAt)].sort());
  for (const game of data.PUBLIC_GAME_CATALOG) {
    assert.equal(game.visibility, "PUBLIC");
    assert.equal(game.effectiveState, "PUBLISHED");
    assert.ok(Object.isFrozen(game));
  }
});

test("date, format and availability filters combine with AND and can be cleared", { skip: missing.length > 0 }, async () => {
  const data = await import(`../${files.data}?filter-test=1`);
  const filtered = data.filterGames(data.PUBLIC_GAME_CATALOG, {
    date: "2026-08-29",
    format: "FIVE",
    availableOnly: true,
  });
  assert.deepEqual(filtered.map(({ id }) => id), ["harbor-five"]);
  assert.deepEqual(data.clearFilters(), { date: "ALL", format: "ALL", availableOnly: false });
  assert.deepEqual(data.filterGames(data.PUBLIC_GAME_CATALOG, data.clearFilters()).map(({ id }) => id), ["harbor-five", "olympic-seven", "riverside-five"]);
  assert.deepEqual(data.filterGames(data.PUBLIC_GAME_CATALOG, { date: "2026-08-31", format: "FIVE", availableOnly: true }), []);
});

test("reference routes use real state transitions, detail history and exact card identity", { skip: missing.length > 0 }, async () => {
  const data = await import(`../${files.data}?interaction-test=1`);
  const state = data.createArtifactState("load-error");
  assert.equal(state.mode, "LOAD_ERROR");
  data.retryLoad(state);
  assert.equal(state.mode, "READY");
  data.setFilters(state, { date: "2026-08-29", format: "FIVE", availableOnly: true });
  assert.deepEqual(data.getVisibleGames(state).map(({ id }) => id), ["harbor-five"]);
  data.openDetail(state, "harbor-five");
  assert.equal(state.selectedGameId, "harbor-five");
  assert.equal(data.getSelectedGame(state).name, "海河周六晨练局");
  assert.equal(data.getSelectedGame({ ...state, selectedGameId: "unknown" }), null);
  data.returnToList(state);
  assert.equal(state.selectedGameId, null);
  assert.deepEqual(state.filters, { date: "2026-08-29", format: "FIVE", availableOnly: true });
  data.clearStateFilters(state);
  assert.deepEqual(state.filters, data.clearFilters());

  const source = read(files.data);
  assert.match(source, /history\.pushState/);
  assert.match(source, /history\.back/);
  for (const action of ["date-filter", "format-filter", "available-filter", "clear-filters", "retry-load", "open-detail", "return-list"]) {
    assert.ok(source.split(`"${action}"`).length >= 3, `${action} needs both a visible control and a bound behavior`);
  }
});

test("reference follows the existing light system, touch sizing and privacy boundary", { skip: missing.length > 0 }, () => {
  const html = read(files.html);
  const css = read(files.css);
  const source = [html, css, read(files.data)].join("\n");
  assert.match(html, /data-production-enabled="false"/);
  for (const color of ["#F8FAFC", "#FFFFFF", "#10243E", "#0284C7", "#047857"]) assert.match(css, new RegExp(esc(color), "i"));
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /display:\s*flex;[\s\S]{0,180}?align-items:\s*center;[\s\S]{0,180}?justify-content:\s*center;/);
  assert.match(css, /env\(safe-area-inset-bottom/);
  assert.match(source, /天津 · 仅展示真实订场已确认的公开球局/);
  assert.match(source, /C1b 开发预览 · 模拟数据/);
  assert.doesNotMatch(source, /申请加入|手机号|微信号|订单号|成员名单|报名记录|头像|支付字段/i);
  assert.doesNotMatch(source, /[\u{1F300}-\u{1FAFF}]/u, "emoji cannot serve as icons");
});

test("flow and review freeze approved recovery and four reference captures", { skip: missing.length > 0 }, () => {
  const flow = read(files.flow);
  for (const phrase of [
    "日期、人制和仅看有名额使用 AND", "卡片 → 对应只读详情", "返回列表并保留筛选", "清除筛选",
    "重新加载", "source-empty", "filter-no-match", "不提供申请操作", "production-disabled",
  ]) assert.match(flow, new RegExp(esc(phrase)));
  const review = read(files.review);
  for (const state of states) assert.match(review, new RegExp(`${esc(state)}-reference-375x812\\.png`));
  assert.match(review, /User visual gate:\s*`PASS`/);
  const board = read(files.board);
  for (const state of states) assert.match(board, new RegExp(`data-state="${esc(state)}"`));
  assert.doesNotMatch(board, /implementation-375x812\.png/);
});
