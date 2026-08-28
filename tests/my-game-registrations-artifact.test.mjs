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

class FakeNode {
  constructor(tagName = "fragment") {
    this.tagName = tagName.toUpperCase();
    this.className = "";
    this.dataset = {};
    this.attributes = {};
    this.children = [];
    this.listeners = new Map();
    this.parentNode = null;
    this.scrollTop = 0;
    this._text = "";
  }

  set textContent(value) { this._text = String(value ?? ""); }
  get textContent() { return `${this._text}${this.children.map((child) => child.textContent).join("")}`; }

  append(...children) {
    for (const child of children.flat()) {
      if (!child) continue;
      if (child.tagName === "FRAGMENT") { this.append(...child.children); continue; }
      child.parentNode = this;
      this.children.push(child);
    }
  }

  prepend(...children) {
    const prepared = [];
    for (const child of children.flat()) {
      if (!child) continue;
      if (child.tagName === "FRAGMENT") prepared.push(...child.children);
      else prepared.push(child);
    }
    prepared.forEach((child) => { child.parentNode = this; });
    this.children.unshift(...prepared);
  }

  replaceChildren(...children) { this.children = []; this._text = ""; this.append(...children); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener(name, listener) {
    const listeners = this.listeners.get(name) ?? [];
    listeners.push(listener);
    this.listeners.set(name, listeners);
  }
  emit(name) { for (const listener of this.listeners.get(name) ?? []) listener({ currentTarget: this }); }
  click() { this.emit("click"); }

  descendants() { return this.children.flatMap((child) => [child, ...child.descendants()]); }
  querySelectorAll(selector) {
    if (selector === "button[data-action]") {
      return this.descendants().filter((node) => node.tagName === "BUTTON" && typeof node.dataset.action === "string");
    }
    if (selector.startsWith(".")) {
      const className = selector.slice(1);
      return this.descendants().filter((node) => node.className.split(/\s+/).includes(className));
    }
    return this.descendants().filter((node) => node.tagName === selector.toUpperCase());
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
}

const createFakeBrowser = (search) => {
  const root = new FakeNode("main");
  const documentListeners = new Map();
  const document = {
    querySelector: (selector) => selector === "#my-game-registrations-app" ? root : null,
    createElement: (tag) => new FakeNode(tag),
    createDocumentFragment: () => new FakeNode("fragment"),
    addEventListener: (name, listener) => documentListeners.set(name, listener),
  };
  const windowListeners = new Map();
  const location = { pathname: "/artifacts/ui/references/my-game-registrations.html", search };
  const history = {
    state: null,
    entries: [],
    index: -1,
    pushCalls: 0,
    backCalls: 0,
    replaceState(nextState, _title, url = `${location.pathname}${location.search}`) {
      this.state = nextState;
      const parsed = new URL(url, "http://artifact.local");
      location.pathname = parsed.pathname;
      location.search = parsed.search;
      const entry = { state: nextState, url: `${parsed.pathname}${parsed.search}` };
      if (this.index < 0) { this.entries.push(entry); this.index = 0; }
      else this.entries[this.index] = entry;
    },
    pushState(nextState, _title, url) {
      this.pushCalls += 1;
      this.entries.splice(this.index + 1);
      this.entries.push({ state: nextState, url });
      this.index = this.entries.length - 1;
      this.state = nextState;
      const parsed = new URL(url, "http://artifact.local");
      location.pathname = parsed.pathname;
      location.search = parsed.search;
    },
    back() {
      this.backCalls += 1;
      if (this.index <= 0) return;
      this.index -= 1;
      const entry = this.entries[this.index];
      this.state = entry.state;
      const parsed = new URL(entry.url, "http://artifact.local");
      location.pathname = parsed.pathname;
      location.search = parsed.search;
      windowListeners.get("popstate")?.({ state: entry.state });
    },
  };
  const window = { location, history, addEventListener: (name, listener) => windowListeners.set(name, listener) };
  return { root, document, window, history };
};

let browserImportSequence = 0;
const withRenderedArtifact = async (search, callback) => {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const browser = createFakeBrowser(search);
  globalThis.document = browser.document;
  globalThis.window = browser.window;
  try {
    browserImportSequence += 1;
    const data = await import(`../${files.data}?browser-render=${browserImportSequence}`);
    return await callback({ ...browser, data });
  } finally {
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
  }
};

const findControl = (root, action) => root.querySelectorAll("button[data-action]").find((node) => node.dataset.action === action);
const visibleTitle = (root) => root.querySelector("h1")?.textContent ?? "";
const parseDeclarations = (body) => Object.fromEntries(
  [...body.matchAll(/([\w-]+)\s*:\s*([^;]+);/g)].map((match) => [match[1], match[2].trim()]),
);
const selectorMatchesControl = (selector, control) => {
  const clean = selector.replace(/:[\w-]+(?:\([^)]*\))?/g, "").trim();
  if (/\s/.test(clean)) return false;
  const tag = clean.match(/^[a-z]+/i)?.[0];
  if (tag && tag.toUpperCase() !== control.tagName) return false;
  const requiredClasses = [...clean.matchAll(/\.([\w-]+)/g)].map((match) => match[1]);
  const controlClasses = new Set(control.className.split(/\s+/).filter(Boolean));
  return (tag || requiredClasses.length > 0) && requiredClasses.every((className) => controlClasses.has(className));
};
const controlStyle = (control, css) => {
  const style = {};
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (match[1].split(",").some((selector) => selectorMatchesControl(selector, control))) {
      Object.assign(style, parseDeclarations(match[2]));
    }
  }
  return style;
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
  assert.match(read(files.html), /data-production-enabled="false"/);
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

test("the rendered my registrations entry is a single centered 44px row", { skip: missing.length > 0 }, async () => {
  const css = read(files.css);
  await withRenderedArtifact("?state=entry", ({ root }) => {
    const mine = findControl(root, "open-my-registrations");
    assert.ok(mine, "entry state must visibly render the my registrations control");
    assert.equal(mine.textContent.trim(), "我的报名");
    const style = controlStyle(mine, css);
    assert.equal(style["min-height"], "44px");
    assert.equal(style.display, "flex");
    assert.equal(style["align-items"], "center");
    assert.equal(style["justify-content"], "space-between");
  });
});

test("rendered date and availability toggles expose synchronized aria-pressed state", { skip: missing.length > 0 }, async () => {
  await withRenderedArtifact("?state=entry", ({ root }) => {
    const dateControls = () => root.querySelectorAll("button[data-action]").filter(({ dataset }) => dataset.action === "date-filter");
    const availability = () => findControl(root, "availability-filter");
    assert.deepEqual(dateControls().map(({ attributes }) => attributes["aria-pressed"]), ["true", "false", "false"]);
    assert.equal(availability().attributes["aria-pressed"], "false");

    dateControls()[1].click();
    assert.deepEqual(dateControls().map(({ attributes }) => attributes["aria-pressed"]), ["false", "true", "false"]);
    availability().click();
    assert.equal(availability().attributes["aria-pressed"], "true");
  });
});

test("real screen scroll listeners restore exact entry and list positions through browser history", { skip: missing.length > 0 }, async () => {
  await withRenderedArtifact("?state=entry", ({ root, history }) => {
    const entryScreen = root.querySelector(".screen");
    entryScreen.scrollTop = 248;
    entryScreen.emit("scroll");
    findControl(root, "open-my-registrations").click();
    findControl(root, "header-back").click();
    assert.equal(history.backCalls, 1);
    assert.equal(visibleTitle(root), "找球局");
    assert.equal(root.querySelector(".screen").scrollTop, 248);
  });

  await withRenderedArtifact("?state=ready-list", ({ root, history }) => {
    const listScreen = root.querySelector(".screen");
    listScreen.scrollTop = 316;
    listScreen.emit("scroll");
    findControl(root, "open-registration-detail").click();
    findControl(root, "header-back").click();
    assert.equal(history.backCalls, 1);
    assert.equal(visibleTitle(root), "我的报名");
    assert.equal(root.querySelector(".screen").scrollTop, 316);
  });
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

test("known and unknown registration deep links without history return to discovery entry", { skip: missing.length > 0 }, async () => {
  const data = await import(`../${files.data}?deep-link-state-test=1`);
  for (const registrationId of ["reg-applied", "unknown"]) {
    const state = data.createArtifactState("ready-list");
    data.dispatchArtifactAction(state, "open-registration-detail", { registrationId, fromList: false });
    assert.equal(state.view, registrationId === "reg-applied" ? "DETAIL" : "NOT_FOUND");
    data.dispatchArtifactAction(state, "header-back");
    assert.equal(state.view, "ENTRY");
  }

  for (const registrationId of ["reg-applied", "unknown"]) {
    await withRenderedArtifact(`?state=ready-list&view=detail&registration=${registrationId}`, ({ root, history }) => {
      assert.equal(visibleTitle(root), "报名详情");
      findControl(root, "header-back").click();
      assert.equal(visibleTitle(root), "找球局");
      assert.equal(history.backCalls, 0, "a direct detail must not call browser back without Artifact history");
    });
  }
});

test("list to exact detail uses browser history and returns to the rendered list", { skip: missing.length > 0 }, async () => {
  await withRenderedArtifact("?state=entry", ({ root, history }) => {
    findControl(root, "open-my-registrations").click();
    assert.equal(visibleTitle(root), "我的报名");
    const card = findControl(root, "open-registration-detail");
    assert.equal(card.dataset.registrationId, "reg-applied");
    card.click();
    assert.equal(visibleTitle(root), "报名详情");
    assert.equal(history.pushCalls, 2);
    findControl(root, "header-back").click();
    assert.equal(history.backCalls, 1);
    assert.equal(visibleTitle(root), "我的报名");
  });
});

test("actual controls rendered across query states map to fixed handlers and per-control touch geometry", { skip: missing.length > 0 }, async () => {
  const css = read(files.css);
  const expectedActions = [
    "header-back", "resume-entry", "date-filter", "format-filter", "availability-filter",
    "clear-entry-filters", "open-my-registrations", "open-entry-game", "refresh-registrations",
    "retry-list", "load-more", "open-registration-detail", "return-list",
  ].sort();
  const actualActions = new Set();
  const renderedControls = [];
  let handlers = null;
  const collectControls = (root, context) => {
    const visibleButtons = root.querySelectorAll("button");
    const boundControls = root.querySelectorAll("button[data-action]");
    assert.equal(boundControls.length, visibleButtons.length, `${context} must not render an unbound button`);
    boundControls.forEach((control) => { actualActions.add(control.dataset.action); renderedControls.push(control); });
  };

  for (const stateId of stateIds) {
    await withRenderedArtifact(`?state=${stateId}`, ({ root, data }) => {
      handlers ??= data.ARTIFACT_ACTION_HANDLERS;
      collectControls(root, stateId);
      if (stateId === "entry") {
        root.querySelectorAll("button[data-action]")
          .find((control) => control.dataset.action === "date-filter" && control.dataset.value !== "ALL")
          .click();
        collectControls(root, "entry-filtered");
        findControl(root, "header-back").click();
        collectControls(root, "entry-scenario");
      }
    });
  }
  await withRenderedArtifact("?state=ready-list&view=detail&registration=unknown", ({ root }) => {
    collectControls(root, "unknown-detail");
  });

  assert.deepEqual([...actualActions].sort(), expectedActions);
  assert.deepEqual(Object.keys(handlers).sort(), expectedActions);
  for (const control of renderedControls) {
    assert.equal(typeof handlers[control.dataset.action], "function", `${control.dataset.action} must bind a real handler`);
    const style = controlStyle(control, css);
    assert.ok(Number.parseFloat(style["min-height"]) >= 44, `${control.dataset.action} needs its own >=44px rule`);
    assert.equal(style.display, "flex", `${control.dataset.action} must use flex`);
    assert.equal(style["align-items"], "center", `${control.dataset.action} must center on the cross axis`);
    assert.ok(["center", "space-between"].includes(style["justify-content"]), `${control.dataset.action} must center or distribute its content explicitly`);
  }

  const source = read(files.data);
  const cardRenderer = source.slice(source.indexOf("const registrationCard"), source.indexOf("const renderListState"));
  const cardModule = await import(`../${files.data}?card-fields-test=1`);
  assert.deepEqual(cardModule.REGISTRATION_CARD_FIELDS, [
    "effectiveStatus", "gameName", "dateLabel", "timeLabel", "venue", "pitch", "formatLabel",
  ]);
  assert.equal(cardModule.REGISTRATION_DETAIL_TARGET, "WHOLE_CARD_ONLY");
  assert.equal([...cardRenderer.matchAll(/actionButton\(/g)].length, 1, "the whole card must be the only detail target");
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
