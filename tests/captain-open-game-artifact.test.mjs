import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { parseDocument } from "yaml";

const files = {
  html: "artifacts/ui/references/captain-open-game.html",
  css: "artifacts/ui/references/captain-open-game.css",
  data: "artifacts/ui/references/captain-open-game-data.js",
  flow: "artifacts/ui/flows/captain-open-game.md",
  manifest: "artifacts/ui/screen-manifest/captain-open-game.yaml",
  review: "artifacts/ui/reviews/captain-open-game/README.md",
  board: "artifacts/ui/reviews/captain-open-game/review-board.html",
};
const states = ["create-ready", "draft-manage", "published-manage", "public-readonly"];
const read = (path) => readFileSync(path, "utf8");
const missing = Object.values(files).filter((path) => !existsSync(path));
const esc = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

test("captain open-game Artifact source set exists", () => {
  assert.deepEqual(missing, [], `missing source files: ${missing.join(", ")}`);
});

test("manifest freezes exactly four 375 by 812 captain states and review slots", { skip: missing.length > 0 }, () => {
  const doc = parseDocument(read(files.manifest), { uniqueKeys: true });
  assert.deepEqual(doc.errors, []);
  const manifest = doc.toJS();
  assert.equal(manifest.id, "captain-open-game");
  assert.deepEqual(manifest.target_viewport, { width: 375, height: 812 });
  assert.equal(manifest.production_enabled, false);
  assert.deepEqual(manifest.states.map(({ id }) => id), states);
  assert.equal(manifest.states.filter(({ representative_capture }) => representative_capture).length, 4);
  assert.deepEqual(manifest.review_slots, ["reference", "implementation", "side-by-side", "overlay-50", "difference", "observations"]);
  assert.match(manifest.fixture.deletion_condition, /production/i);
});

test("captain data separates four reference states from an honest internal cancellation result", { skip: missing.length > 0 }, async () => {
  const data = await import(`../${files.data}?artifact-test=1`);
  assert.deepEqual(data.CAPTAIN_OPEN_GAME_STATE_IDS, states);
  assert.ok(Object.isFrozen(data.CAPTAIN_OPEN_GAME_STATES));
  for (const id of states) {
    const state = data.CAPTAIN_OPEN_GAME_STATES[id];
    assert.equal(state.id, id);
    assert.ok(Object.isFrozen(state));
    for (const action of state.actions) {
      assert.ok(states.includes(action.nextState), `${id}:${action.id} needs a valid next state`);
      assert.ok(action.fixtureTransition, `${id}:${action.id} needs Fixture transition intent`);
    }
  }
  assert.deepEqual(data.CAPTAIN_OPEN_GAME_INTERNAL_STATE_IDS, [...states, "cancelled-readonly"]);
  assert.equal(data.CAPTAIN_OPEN_GAME_STATES["cancelled-readonly"].lifecycle, "CANCELLED");
  assert.equal(data.CAPTAIN_OPEN_GAME_STATES["cancelled-readonly"].actions.length, 0);
  assert.doesNotMatch(JSON.stringify(data.CAPTAIN_OPEN_GAME_STATES["cancelled-readonly"]), /分享球局|编辑球局|取消球局/);
  assert.deepEqual(data.CAPTAIN_OPEN_GAME_STATES["public-readonly"].actions.map(({ id }) => id), ["return-manage"]);
  assert.equal(data.CAPTAIN_OPEN_GAME_STATES["public-readonly"].notice, "当前仅供查看，申请加入即将开放");
  assert.match(JSON.stringify(data.CAPTAIN_OPEN_GAME_STATES["published-manage"]), /只取消本次开放球局，不会取消已预订场地，也不会发起退款/);
  assert.deepEqual(data.CAPTAIN_OPEN_GAME_STATES["draft-manage"].actions.map(({ id, label }) => [id, label]), [
    ["preview", "预览公开详情"], ["edit", "编辑球局"], ["abandon", "放弃草稿"], ["begin-publish", "发布球局"],
  ]);
  assert.deepEqual(data.FIXTURE_PANELS.publish.items, ["真实场地", "开放名额", "预计 AA", "线下结算", "报名截止", "可见范围"]);
  for (const panel of [data.FIXTURE_PANELS.abandon, data.FIXTURE_PANELS.cancel]) {
    assert.equal(panel.close.label, "继续保留");
    assert.ok(panel.confirm.fixtureTransition);
  }
});

test("persistent Fixture lifecycle wins over stale browser history while public preview remains navigable", { skip: missing.length > 0 }, async () => {
  const data = await import(`../${files.data}?lifecycle-test=1`);
  assert.deepEqual(data.CAPTAIN_OPEN_GAME_LIFECYCLES, ["UNSAVED", "DRAFT", "PUBLISHED", "CANCELLED"]);
  assert.equal(data.resolveFixtureRoute("PUBLISHED", "draft-manage"), "published-manage");
  assert.equal(data.resolveFixtureRoute("CANCELLED", "draft-manage"), "cancelled-readonly");
  assert.equal(data.resolveFixtureRoute("CANCELLED", "published-manage"), "cancelled-readonly");
  assert.equal(data.resolveFixtureRoute("CANCELLED", "create-ready"), "cancelled-readonly");
  assert.equal(data.resolveFixtureRoute("PUBLISHED", "public-readonly"), "public-readonly");
  assert.equal(data.resolveFixtureRoute("CANCELLED", "public-readonly"), "cancelled-readonly");
  const publicReturnCancelBack = ["public-readonly", "published-manage"].map((staleHistoryRoute) => data.resolveFixtureRoute("CANCELLED", staleHistoryRoute));
  assert.deepEqual(publicReturnCancelBack, ["cancelled-readonly", "cancelled-readonly"], "public → return → cancel → Back must remain cancelled");
  assert.match(read(files.data), /commitLifecycle[\s\S]*?syncUrl\("replaceState"\)/, "lifecycle commits must replace stale history");
  assert.match(read(files.data), /navigate[\s\S]*?syncUrl\("pushState"\)/, "public-preview navigation stays in browser history");
});

test("Fixture stepper interaction preserves capacity and saved game snapshot drives summaries", { skip: missing.length > 0 }, async () => {
  const data = await import(`../${files.data}?form-test=1`);
  let form = data.createGameForm();
  for (let index = 0; index < 12; index += 1) form = data.applyFormStepperAction(form, "total-decrease");
  assert.deepEqual([form.total, form.fixed, form.open], [12, 8, 4]);
  form = data.applyFormStepperAction(form, "fixed-increase");
  form = data.applyFormStepperAction(form, "open-increase");
  assert.deepEqual([form.total, form.fixed, form.open], [12, 8, 4], "fixed + open cannot exceed total");
  const saved = data.freezeGameSnapshot(form);
  form = data.applyFormStepperAction(form, "open-decrease");
  assert.equal(saved.open, 4, "saving keeps a snapshot rather than a live form reference");
  assert.deepEqual(data.getGameSummary(saved).slice(0, 2), [
    ["人数与名额", "计划 12 人 · 固定 8 人 · 开放 4 人"], ["对抗强度", "休闲对抗"],
  ]);
  assert.match(read(files.data), /applyFormStepperAction\(formValues, action\)/, "renderer must use the tested stepper interaction");
  assert.match(read(files.data), /freezeGameSnapshot\(formValues\)/, "save must persist the current form snapshot");
});

test("reference preserves existing light system, real order content, and privacy boundary", { skip: missing.length > 0 }, () => {
  const source = [read(files.html), read(files.css), read(files.data)].join("\n");
  assert.match(read(files.html), /data-production-enabled="false"/);
  for (const color of ["#F8FAFC", "#FFFFFF", "#10243E", "#0284C7", "#059669"]) assert.match(read(files.css), new RegExp(esc(color), "i"));
  for (const copy of ["天津奥体足球场", "七人制 A 场", "2026年8月23日", "计划共", "保存草稿", "私有草稿", "发布球局", "确认发布", "分享球局", "返回管理页", "当前仅供查看，申请加入即将开放"]) assert.match(source, new RegExp(esc(copy)));
  assert.match(read(files.css), /min-height:\s*44px/);
  assert.match(read(files.css), /position:\s*fixed/);
  assert.match(read(files.css), /env\(safe-area-inset-bottom/);
  assert.match(read(files.css), /display:\s*flex;[\s\S]{0,180}?align-items:\s*center;[\s\S]{0,180}?justify-content:\s*center;/);
  assert.match(read(files.css), /\.public-notice\s*\{[^}]*text-align:\s*left;/s);
  assert.doesNotMatch(read(files.css), /\.public-notice\s*\{[^}]*border:/s, "public pending copy must not look like a CTA");
  assert.doesNotMatch(source, /(?:phone|tel:|wechat|微信号|order[_ -]?id|payment|支付流水|contact)/i);
  assert.doesNotMatch(source, /[\u{1F300}-\u{1FAFF}]/u, "emoji cannot serve as icons");
});

test("flow and review record action closures, order isolation, and four reference captures", { skip: missing.length > 0 }, () => {
  const flow = read(files.flow);
  for (const phrase of [
    "create-ready → draft-manage", "draft-manage → public-readonly", "draft-manage → published-manage",
    "published-manage → public-readonly", "取消球局不改订单", "CANCELLED", "继续保留", "发布前确认",
    "公开页不暴露联系、订单或支付字段", "返回管理页", "申请加入即将开放", "Fixture transition",
  ]) assert.match(flow, new RegExp(esc(phrase)));
  const review = read(files.review);
  for (const state of states) assert.match(review, new RegExp(`${esc(state)}-reference-375x812\\.png`));
  assert.match(read(files.board), /data-state="create-ready"/);
  assert.doesNotMatch(read(files.board), /implementation-375x812\.png/);
});
