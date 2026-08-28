import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { parseDocument } from "yaml";

const files = {
  html: "artifacts/ui/references/my-game-registrations.html",
  css: "artifacts/ui/references/my-game-registrations.css",
  data: "artifacts/ui/references/my-game-registrations-data.js",
  flow: "artifacts/ui/flows/my-game-registrations.md",
  manifest: "artifacts/ui/screen-manifest/my-game-registrations.yaml",
  review: "artifacts/ui/reviews/my-game-registrations/README.md",
  board: "artifacts/ui/reviews/my-game-registrations/review-board.html",
  reference: "artifacts/ui/reviews/my-game-registrations/ready-list-reference-375x812.png",
};
const stateIds = ["entry", "ready-list", "empty", "load-error"];
const read = (path) => readFileSync(path, "utf8");
const missing = Object.values(files).filter((path) => !existsSync(path));
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const pngDimensions = (path) => {
  const bytes = readFileSync(path);
  assert.equal(bytes.toString("ascii", 1, 4), "PNG", `${path} must be a PNG`);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
};

test("my registrations Artifact source set exists", () => {
  assert.deepEqual(missing, [], `missing source files: ${missing.join(", ")}`);
});

test("manifest freezes four production-disabled states and one 375 by 812 representative capture", { skip: missing.length > 0 }, () => {
  const document = parseDocument(read(files.manifest), { uniqueKeys: true });
  assert.deepEqual(document.errors, []);
  const manifest = document.toJS();
  assert.equal(manifest.id, "my-game-registrations");
  assert.deepEqual(manifest.target_viewport, { width: 375, height: 812 });
  assert.equal(manifest.production_enabled, false);
  assert.deepEqual(manifest.states.map(({ id }) => id), stateIds);
  assert.deepEqual(
    manifest.states.filter(({ representative_capture }) => representative_capture).map(({ id }) => id),
    ["ready-list"],
  );
  assert.equal(manifest.gate, "PENDING");
  assert.deepEqual(pngDimensions(files.reference), { width: 375, height: 812 });
});

test("fixture projection covers four effective states, both visibilities and stable two-page pagination", { skip: missing.length > 0 }, async () => {
  const data = await import(`../${files.data}?projection-test=1`);
  assert.deepEqual(data.MY_REGISTRATION_STATE_IDS, stateIds);
  assert.ok(Object.isFrozen(data.MY_REGISTRATIONS));
  assert.deepEqual(data.MY_REGISTRATIONS.map(({ effectiveStatus }) => effectiveStatus), [
    "APPLIED", "JOINED", "REJECTED", "CANCELLED",
  ]);
  assert.deepEqual(new Set(data.MY_REGISTRATIONS.map(({ visibility }) => visibility)), new Set(["PUBLIC", "LINK_ONLY"]));
  assert.deepEqual(data.firstPage.items.map(({ registrationId }) => registrationId), ["reg-applied", "reg-joined"]);
  assert.equal(data.firstPage.nextCursor, "c1c-page-2");
  assert.deepEqual(data.secondPage.items.map(({ registrationId }) => registrationId), ["reg-rejected", "reg-cancelled"]);
  assert.equal(data.secondPage.nextCursor, null);
  for (const item of data.MY_REGISTRATIONS) assert.ok(Object.isFrozen(item));
});

test("entry filters and scroll survive the trip to my registrations and back", { skip: missing.length > 0 }, async () => {
  const data = await import(`../${files.data}?entry-test=1`);
  const state = data.createArtifactState("entry");
  assert.equal(data.getVisibleDirectoryGames(state).length, 3);

  data.dispatchArtifactAction(state, "date-filter", { value: "2026-09-05" });
  data.dispatchArtifactAction(state, "format-filter", { value: "FIVE" });
  data.dispatchArtifactAction(state, "availability-filter");
  assert.deepEqual(data.getVisibleDirectoryGames(state).map(({ gameId }) => gameId), ["game-haihe-five"]);
  data.setEntryScrollTop(state, 248);

  assert.equal(data.dispatchArtifactAction(state, "open-entry-game", { gameId: "game-haihe-five" }), true);
  assert.equal(state.view, "ENTRY_DETAIL");
  assert.equal(state.selectedEntryGameId, "game-haihe-five");
  data.dispatchArtifactAction(state, "header-back");
  assert.equal(state.view, "ENTRY");
  assert.equal(state.entryScrollTop, 248);

  data.dispatchArtifactAction(state, "open-my-registrations");
  assert.equal(state.view, "LIST");
  data.dispatchArtifactAction(state, "header-back");
  assert.equal(state.view, "ENTRY");
  assert.deepEqual(state.entryFilters, { date: "2026-09-05", format: "FIVE", availableOnly: true });
  assert.equal(state.entryScrollTop, 248);

  data.dispatchArtifactAction(state, "clear-entry-filters");
  assert.deepEqual(state.entryFilters, data.clearEntryFilters());
  assert.deepEqual(data.getVisibleDirectoryGames(state).map(({ gameId }) => gameId), [
    "game-haihe-five", "game-olympic-seven", "game-riverside-five",
  ]);
});

test("refresh is stable, load more appends page two once, and whole-card detail restores list state", { skip: missing.length > 0 }, async () => {
  const data = await import(`../${files.data}?list-test=1`);
  const state = data.createArtifactState("ready-list");
  assert.deepEqual(state.items.map(({ registrationId }) => registrationId), ["reg-applied", "reg-joined"]);

  data.dispatchArtifactAction(state, "refresh-registrations");
  data.dispatchArtifactAction(state, "refresh-registrations");
  assert.deepEqual(state.items.map(({ registrationId }) => registrationId), ["reg-applied", "reg-joined"]);
  assert.equal(new Set(state.items.map(({ registrationId }) => registrationId)).size, state.items.length);

  data.dispatchArtifactAction(state, "load-more");
  data.dispatchArtifactAction(state, "load-more");
  assert.deepEqual(state.items.map(({ registrationId }) => registrationId), [
    "reg-applied", "reg-joined", "reg-rejected", "reg-cancelled",
  ]);
  assert.equal(state.nextCursor, null);
  data.setListScrollTop(state, 316);

  assert.equal(data.dispatchArtifactAction(state, "open-registration-detail", { registrationId: "reg-cancelled" }), true);
  assert.equal(state.view, "DETAIL");
  assert.equal(data.getSelectedRegistration(state)?.registrationId, "reg-cancelled");
  assert.equal(data.getSelectedRegistration(state)?.detailPath, "/dev/pages/c1c-registration-detail/index?registrationId=reg-cancelled");
  data.dispatchArtifactAction(state, "return-list");
  assert.equal(state.view, "LIST");
  assert.equal(state.listScrollTop, 316);
  assert.deepEqual(state.items.map(({ registrationId }) => registrationId), [
    "reg-applied", "reg-joined", "reg-rejected", "reg-cancelled",
  ]);

  assert.equal(data.dispatchArtifactAction(state, "open-registration-detail", { registrationId: "unknown" }), false);
  assert.equal(state.view, "NOT_FOUND");
  assert.equal(data.getSelectedRegistration(state), null);
  data.dispatchArtifactAction(state, "header-back");
  assert.equal(state.view, "LIST");
  assert.equal(state.listScrollTop, 316);
});

test("every visible control is bound, cards have one detail target, and CSS freezes touch geometry", { skip: missing.length > 0 }, async () => {
  const data = await import(`../${files.data}?controls-test=1`);
  const source = read(files.data);
  const html = read(files.html);
  const css = read(files.css);

  assert.match(html, /data-production-enabled="false"/);
  assert.deepEqual(data.REGISTRATION_CARD_FIELDS, [
    "effectiveStatus", "gameName", "dateLabel", "timeLabel", "venue", "pitch", "formatLabel",
  ]);
  assert.equal(data.REGISTRATION_DETAIL_TARGET, "WHOLE_CARD_ONLY");
  for (const action of data.VISIBLE_CONTROL_ACTIONS) {
    assert.equal(typeof data.ARTIFACT_ACTION_HANDLERS[action], "function", `${action} must have a handler`);
    assert.match(source, new RegExp(`dataAction|${escapeRegex(action)}`));
  }
  const cardRenderer = source.slice(source.indexOf("const registrationCard"), source.indexOf("const renderListState"));
  assert.match(cardRenderer, /actionButton\("", "open-registration-detail"/);
  assert.equal([...cardRenderer.matchAll(/actionButton\(/g)].length, 1, "the whole card must be the only detail target");
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /display:\s*flex;[\s\S]{0,180}?align-items:\s*center;[\s\S]{0,180}?justify-content:\s*center;/);
  assert.match(css, /env\(safe-area-inset-bottom/);
  assert.match(css, /overflow-y:\s*auto/);
  assert.doesNotMatch(css, /overflow-x:\s*auto/);
});

test("render source stays inside the frozen card fields and privacy boundary", { skip: missing.length > 0 }, () => {
  const source = [read(files.html), read(files.data)].join("\n");
  for (const phrase of ["状态以服务端为准", "待队长审核", "已加入", "未通过", "球局已取消"] ) {
    assert.match(source, new RegExp(escapeRegex(phrase)));
  }
  assert.doesNotMatch(
    source,
    /申请人|本场称呼|真实姓名|昵称|备注|审核人|决定人|其他申请人|联系方式|手机号|电话|微信号|订单|支付|成员名单|成员列表|applicant|displayName|decider|reviewer|contact|phone|mobile|payment|roster/i,
  );
  assert.doesNotMatch(source, /[\u{1F300}-\u{1FAFF}]/u, "emoji cannot serve as icons");
});

test("flow and reference review keep the production and user gates honest", { skip: missing.length > 0 }, () => {
  const flow = read(files.flow);
  for (const phrase of [
    "production-disabled", "entry → ready-list", "日期、人制和仅看有名额", "保留筛选与 entryScrollTop",
    "刷新不重复", "第二页只追加一次", "整卡是唯一详情入口", "未知报名不回退第一条", "隐私禁止项",
  ]) assert.match(flow, new RegExp(escapeRegex(phrase)));

  const review = read(files.review);
  assert.match(review, /ready-list-reference-375x812\.png/);
  assert.match(review, /Reference self-review:\s*`PASS`/);
  assert.match(review, /User visual gate:\s*`PENDING`/);
  assert.doesNotMatch(review, /implementation-375x812\.png/);

  const board = read(files.board);
  assert.deepEqual([...board.matchAll(/data-state="([^"]+)"/g)].map((match) => match[1]), ["ready-list"]);
  assert.match(board, /ready-list-reference-375x812\.png/);
  assert.doesNotMatch(board, /implementation-375x812\.png/);
});
