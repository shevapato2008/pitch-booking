const freeze = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};

export const CAPTAIN_OPEN_GAME_STATE_IDS = freeze(["create-ready", "draft-manage", "published-manage", "public-readonly"]);
export const CAPTAIN_OPEN_GAME_INTERNAL_STATE_IDS = freeze([...CAPTAIN_OPEN_GAME_STATE_IDS, "cancelled-readonly"]);
export const CAPTAIN_OPEN_GAME_LIFECYCLES = freeze(["UNSAVED", "DRAFT", "PUBLISHED", "CANCELLED"]);
const managementStateByLifecycle = freeze({ UNSAVED: "create-ready", DRAFT: "draft-manage", PUBLISHED: "published-manage", CANCELLED: "cancelled-readonly" });
export const resolveFixtureRoute = (lifecycle, requestedState) => {
  if (requestedState === "public-readonly") return "public-readonly";
  if (lifecycle === "CANCELLED") return "cancelled-readonly";
  if (requestedState === "create-ready") return "create-ready";
  return managementStateByLifecycle[lifecycle];
};
export const CONFIRMED_ORDER = freeze({
  venue: "天津奥体足球场", pitch: "七人制 A 场", date: "2026年8月23日 周日", time: "14:00–16:00", format: "七人制", booking: "来自已确认订单，不可修改",
});

const actions = {
  save: { id: "save-draft", label: "保存草稿", nextState: "draft-manage", fixtureTransition: "save private DRAFT" },
  preview: { id: "preview", label: "预览公开详情", nextState: "public-readonly", fixtureTransition: "open readonly preview with source" },
  edit: { id: "edit", label: "编辑球局", nextState: "create-ready", fixtureTransition: "restore editable Fixture" },
  abandon: { id: "abandon", label: "放弃草稿", nextState: "draft-manage", fixtureTransition: "open abandon confirmation" },
  beginPublish: { id: "begin-publish", label: "发布球局", nextState: "draft-manage", fixtureTransition: "open publish confirmation" },
  share: { id: "share", label: "分享球局", nextState: "published-manage", fixtureTransition: "open Fixture share sheet" },
  open: { id: "open-public", label: "查看公开页", nextState: "public-readonly", fixtureTransition: "open readonly public page with source" },
  cancel: { id: "cancel", label: "取消球局", nextState: "published-manage", fixtureTransition: "open cancel confirmation; booking unchanged" },
  return: { id: "return-manage", label: "返回管理页", nextState: "draft-manage", fixtureTransition: "return to deterministic manager source" },
};

export const CAPTAIN_OPEN_GAME_STATES = freeze({
  "create-ready": { id: "create-ready", title: "创建球局", actions: [actions.save], values: { total: 14, fixed: 8, open: 4, intensity: "休闲对抗", positions: "门将、后卫、前锋", aa: "¥30 / 人", deadline: "8月23日 12:00", visibility: "公开" } },
  "draft-manage": { id: "draft-manage", title: "管理球局", status: "私有草稿", description: "仅你可见，尚未公开或分享。", actions: [actions.preview, actions.edit, actions.abandon, actions.beginPublish] },
  "published-manage": { id: "published-manage", title: "管理球局", status: "已发布", description: "公开详情已可查看；申请功能尚未开放。", actions: [actions.share, actions.open, actions.edit, actions.cancel], cancelNotice: "只取消本次开放球局，不会取消已预订场地，也不会发起退款。" },
  "public-readonly": { id: "public-readonly", title: "公开球局", notice: "当前仅供查看，申请加入即将开放", actions: [actions.return] },
  "cancelled-readonly": { id: "cancelled-readonly", title: "管理球局", lifecycle: "CANCELLED", status: "球局已取消", description: "本次开放球局已取消；真实订场、订单和退款状态均未改变。", actions: [] },
});

export const FIXTURE_PANELS = freeze({
  publish: {
    title: "发布前确认", message: "发布后会展示下列公开信息；平台不代收或担保线下结算。",
    items: ["真实场地", "开放名额", "预计 AA", "线下结算", "报名截止", "可见范围"],
    details: [["真实场地", "天津奥体足球场 · 七人制 A 场"], ["开放名额", "4 人"], ["预计 AA", "¥30 / 人"], ["线下结算", "到场线下结算，平台不代收或担保"], ["报名截止", "8月23日 12:00"], ["可见范围", "公开"]],
    close: { id: "close-panel", label: "返回修改", fixtureTransition: "close publish confirmation" },
    confirm: { id: "confirm-publish", label: "确认发布", fixtureTransition: "publish Fixture game" },
  },
  abandon: {
    title: "确认放弃草稿？", message: "草稿不会公开，也不会影响已预订场地。",
    close: { id: "close-panel", label: "继续保留", fixtureTransition: "keep private DRAFT" },
    confirm: { id: "confirm-abandon", label: "确认放弃草稿", fixtureTransition: "abandon private DRAFT" },
  },
  cancel: {
    title: "确认取消球局？", message: "只取消本次开放球局，不会取消已预订场地，也不会发起退款。",
    close: { id: "close-panel", label: "继续保留", fixtureTransition: "keep published game" },
    confirm: { id: "confirm-cancel", label: "确认取消球局", fixtureTransition: "set Fixture lifecycle to CANCELLED; booking unchanged" },
  },
  share: {
    title: "分享球局", message: "Fixture 仅演示微信分享面板；分享不改变球局状态。",
    close: { id: "close-panel", label: "关闭", fixtureTransition: "dismiss Fixture share sheet" },
  },
});

const app = typeof document === "undefined" ? null : document.querySelector("#captain-open-game-app");
const getRoute = () => {
  const params = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);
  const state = CAPTAIN_OPEN_GAME_INTERNAL_STATE_IDS.includes(params.get("state")) ? params.get("state") : "create-ready";
  const from = ["draft-manage", "published-manage"].includes(params.get("from")) ? params.get("from") : "published-manage";
  const panel = ["publish", "abandon", "cancel", "share"].includes(params.get("panel")) ? params.get("panel") : null;
  const lifecycle = state === "cancelled-readonly" ? "CANCELLED" : state === "published-manage" || (state === "public-readonly" && from === "published-manage") ? "PUBLISHED" : state === "draft-manage" || (state === "public-readonly" && from === "draft-manage") ? "DRAFT" : "UNSAVED";
  return { state, from, panel, lifecycle };
};
let { state: requestedState, from: returnState, panel, lifecycle } = getRoute();
let stateId = resolveFixtureRoute(lifecycle, requestedState);
let feedback = "";
let formValues = { ...CAPTAIN_OPEN_GAME_STATES["create-ready"].values };

const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
const button = (action, className = "secondary") => { const node = el("button", className, action.label); node.type = "button"; node.dataset.action = action.id; node.setAttribute("aria-label", action.label); return node; };
const system = (title) => { const fragment = document.createDocumentFragment(); const top = el("div", "system-row"); top.append(el("span", "system-time", "9:41"), el("span", "native-capsule")); const nav = el("header", "nav"); nav.append(el("span", "nav-spacer"), el("h1", "", title), el("span", "nav-spacer")); fragment.append(top, nav); return fragment; };
const orderCard = () => { const card = el("section", "card section"); const heading = el("div", "summary-title"); heading.append(el("span", "", "真实订场已确认"), el("span", "readonly", "不可修改")); const name = el("h2", "summary-name", CONFIRMED_ORDER.venue); const meta = el("p", "summary-meta"); meta.append(`${CONFIRMED_ORDER.pitch} · ${CONFIRMED_ORDER.format}`, document.createElement("br"), `${CONFIRMED_ORDER.date} · ${CONFIRMED_ORDER.time}`, document.createElement("br"), CONFIRMED_ORDER.booking); card.append(heading, name, meta); return card; };
const section = (title, content) => { const card = el("section", "card section"); card.append(el("h2", "section-title", title), content); return card; };
const inputRow = (label, value, help) => { const row = el("div", "form-row"); row.append(el("span", "field-label", label), el("div", "input-shell", value)); if (help) row.append(el("span", "field-help", help)); return row; };
const stepper = (label, value, prefix, help) => { const row = el("div", "form-row"); const control = el("div", "stepper"); const decrement = button({ id: `${prefix}-decrease`, label: `${label}减少` }, "icon-button"); decrement.textContent = "−"; const increment = button({ id: `${prefix}-increase`, label: `${label}增加` }, "icon-button"); increment.textContent = "+"; control.append(decrement, el("span", "stepper-value", String(value)), increment); row.append(el("span", "field-label", label), control, el("span", "field-help", help)); return row; };

const createScreen = () => {
  const screen = el("section", "screen");
  screen.append(orderCard());
  const group = el("div"); group.append(inputRow("球局名称", "奥体周日轻松局"), inputRow("球队名称", "津门周末足球队")); screen.append(section("球局与球队", group));
  const numbers = el("div"); numbers.append(stepper("计划总人数", formValues.total, "total", "范围 4–30 人"), stepper("已有固定队员", formValues.fixed, "fixed", "包含队长本人"), stepper("开放给散客", formValues.open, "open", "至少开放 1 个名额"), el("p", "quantity-copy", `计划共 ${formValues.total} 人，当前固定 ${formValues.fixed} 人，本次开放 ${formValues.open} 个名额`)); screen.append(section("人数与开放名额", numbers));
  const requirements = el("div"); requirements.append(inputRow("对抗强度", formValues.intensity), inputRow("最低经验说明", "有基本传接球经验即可"), inputRow("位置需求", formValues.positions)); screen.append(section("强度、经验与位置", requirements));
  const terms = el("div"); terms.append(inputRow("预计人均 AA", formValues.aa, "到场线下结算，平台不代收或担保"), inputRow("报名截止", formValues.deadline, "不晚于开场前 2 小时"), inputRow("可见范围", formValues.visibility, "公开与仅链接访问均展示相同脱敏详情")); screen.append(section("费用、截止与可见范围", terms));
  screen.append(el("p", "disclosure", lifecycle === "PUBLISHED" ? "装备：深浅两套球衣；提前 15 分钟到场。保存修改后仍保持已发布。" : "装备：深浅两套球衣；提前 15 分钟到场。保存后仅创建你可见的私有草稿。"));
  return screen;
};
const gameSummary = () => { const card = el("section", "card section"); const grid = el("dl", "summary-grid"); [["计划人数", "14 人"], ["开放名额", "4 人"], ["对抗强度", "休闲对抗"], ["位置需求", "门将、后卫、前锋"], ["预计 AA", "¥30 / 人"], ["可见范围", "公开"]].forEach(([term, value]) => { const item = el("div"); item.append(el("dt", "", term), el("dd", "", value)); grid.append(item); }); card.append(el("h2", "summary-title", "球局概要"), grid); return card; };
const manageScreen = (state) => { const screen = el("section", "screen screen--manage"); const status = el("section", `status-row${state.lifecycle === "CANCELLED" ? " status-row--cancelled" : ""}`); const copy = el("div"); copy.append(el("strong", "", state.status), el("p", "", state.description)); status.append(el("span", "status-dot"), copy); screen.append(status, orderCard(), gameSummary()); if (state.actions.length) { const list = el("section", "action-list section"); state.actions.forEach((action) => list.append(button(action, action.id === "cancel" || action.id === "abandon" ? "danger" : action.id === "begin-publish" ? "primary" : "secondary"))); screen.append(section("可用操作", list)); } if (state.cancelNotice) screen.append(el("p", "disclosure", state.cancelNotice)); return screen; };
const publicScreen = (state) => { const screen = el("section", "screen screen--public"); screen.append(el("p", "eyebrow", "真实订场已确认"), el("h2", "public-heading", "奥体周日轻松局"), el("p", "public-subtitle", "津门周末足球队 · 休闲对抗"), orderCard(), gameSummary()); const details = el("section", "card public-details section"); details.append(el("p", "", "最低经验：有基本传接球经验即可"), el("p", "", "报名截止：8月23日 12:00"), el("p", "", "装备与到场：深浅两套球衣，提前 15 分钟到场"), el("p", "", "成人参与，请自行评估运动风险；到场线下结算，平台不代收或担保。")); screen.append(details, el("p", "public-notice", state.notice), button(actions.return, "secondary")); return screen; };
const renderPanel = () => {
  if (!panel) return null;
  const data = FIXTURE_PANELS[panel]; const scrim = el("section", "fixture-scrim"); const sheet = el("section", "fixture-sheet");
  sheet.append(el("h2", "", data.title), el("p", "", data.message));
  if (data.details) { const details = el("dl", "confirm-details"); data.details.forEach(([label, value]) => { const item = el("div"); item.append(el("dt", "", label), el("dd", "", value)); details.append(item); }); sheet.append(details); }
  const controls = el("div", "fixture-sheet__actions"); if (data.close) controls.append(button(data.close, "secondary")); if (data.confirm) controls.append(button(data.confirm, panel === "cancel" || panel === "abandon" ? "danger" : "primary")); sheet.append(controls); scrim.append(sheet); return scrim;
};
const syncUrl = (historyMethod) => { const params = new URLSearchParams(window.location.search); params.set("state", stateId); params.delete("panel"); if (stateId === "public-readonly") params.set("from", returnState); else params.delete("from"); window.history[historyMethod]({ state: stateId, from: returnState, lifecycle }, "", `${window.location.pathname}?${params}`); };
const navigate = (nextState, source = stateId) => { stateId = resolveFixtureRoute(lifecycle, nextState); if (["draft-manage", "published-manage"].includes(source)) returnState = source; panel = null; syncUrl("pushState"); render(); };
const commitLifecycle = (nextLifecycle) => { lifecycle = nextLifecycle; stateId = managementStateByLifecycle[lifecycle]; returnState = stateId === "draft-manage" || stateId === "published-manage" ? stateId : returnState; panel = null; syncUrl("replaceState"); render(); };
const transition = (action) => {
  const step = /^(total|fixed|open)-(increase|decrease)$/.exec(action);
  if (step) { const [, field, direction] = step; const amount = direction === "increase" ? 1 : -1; const limits = { total: [4, 30], fixed: [1, formValues.total - formValues.open], open: [1, formValues.total - formValues.fixed] }; formValues[field] = Math.min(limits[field][1], Math.max(limits[field][0], formValues[field] + amount)); feedback = "update form Fixture value"; render(); return; }
  if (action === "begin-publish") { feedback = actions.beginPublish.fixtureTransition; panel = "publish"; render(); return; }
  if (action === "abandon") { feedback = actions.abandon.fixtureTransition; panel = "abandon"; render(); return; }
  if (action === "cancel") { feedback = actions.cancel.fixtureTransition; panel = "cancel"; render(); return; }
  if (action === "share") { feedback = actions.share.fixtureTransition; panel = "share"; render(); return; }
  if (action === "close-panel") { feedback = FIXTURE_PANELS[panel].close.fixtureTransition; panel = null; render(); return; }
  if (action === "confirm-publish") { feedback = FIXTURE_PANELS.publish.confirm.fixtureTransition; commitLifecycle("PUBLISHED"); return; }
  if (action === "confirm-abandon") { feedback = FIXTURE_PANELS.abandon.confirm.fixtureTransition; commitLifecycle("UNSAVED"); return; }
  if (action === "confirm-cancel") { feedback = FIXTURE_PANELS.cancel.confirm.fixtureTransition; commitLifecycle("CANCELLED"); return; }
  if (action === "return-manage") { feedback = actions.return.fixtureTransition; navigate(returnState, returnState); return; }
  const found = CAPTAIN_OPEN_GAME_STATES[stateId].actions.find(({ id }) => id === action); if (!found) return;
  feedback = found.fixtureTransition;
  if (action === "save-draft") { commitLifecycle(lifecycle === "PUBLISHED" ? "PUBLISHED" : "DRAFT"); return; }
  navigate(found.nextState, stateId);
};
function render() { const state = CAPTAIN_OPEN_GAME_STATES[stateId]; const publishedEdit = stateId === "create-ready" && lifecycle === "PUBLISHED"; app.replaceChildren(system(publishedEdit ? "编辑球局" : state.title)); if (feedback) app.append(el("p", "fixture-feedback", `Fixture：${feedback}`)); app.append(stateId === "create-ready" ? createScreen() : stateId === "public-readonly" ? publicScreen(state) : manageScreen(state)); if (stateId === "create-ready") { const footer = el("footer", "footer"); footer.append(button(publishedEdit ? { ...actions.save, label: "保存修改" } : actions.save, "primary")); app.append(footer); } const overlay = renderPanel(); if (overlay) app.append(overlay); app.querySelectorAll("button[data-action]").forEach((node) => node.addEventListener("click", () => transition(node.dataset.action))); }
if (app) { window.addEventListener("popstate", () => { const route = getRoute(); requestedState = route.state; returnState = route.from; stateId = resolveFixtureRoute(lifecycle, requestedState); panel = stateId === requestedState ? route.panel : null; if (stateId !== requestedState) syncUrl("replaceState"); render(); }); render(); }
