const freeze = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};

export const CAPTAIN_OPEN_GAME_STATE_IDS = freeze(["create-ready", "draft-manage", "published-manage", "public-readonly"]);
export const CONFIRMED_ORDER = freeze({ venue: "天津奥体足球场", pitch: "七人制 A 场", date: "2026年8月23日 周日", time: "14:00–16:00", format: "七人制", booking: "来自已确认订单，不可修改" });
const baseActions = {
  save: { id: "save-draft", label: "保存草稿", nextState: "draft-manage", fixtureTransition: "save private DRAFT" },
  preview: { id: "preview", label: "预览公开详情", nextState: "public-readonly", fixtureTransition: "open readonly preview" },
  edit: { id: "edit", label: "编辑球局", nextState: "create-ready", fixtureTransition: "restore editable Fixture" },
  abandon: { id: "abandon", label: "放弃草稿", nextState: "create-ready", fixtureTransition: "confirm then abandon private DRAFT" },
  publish: { id: "publish", label: "确认发布", nextState: "published-manage", fixtureTransition: "publish Fixture game" },
  share: { id: "share", label: "分享球局", nextState: "published-manage", fixtureTransition: "open Fixture share sheet" },
  open: { id: "open-public", label: "查看公开页", nextState: "public-readonly", fixtureTransition: "open readonly public page" },
  cancel: { id: "cancel", label: "取消球局", nextState: "published-manage", fixtureTransition: "open cancel confirmation; booking unchanged" },
};
export const CAPTAIN_OPEN_GAME_STATES = freeze({
  "create-ready": { id: "create-ready", title: "创建球局", actions: [baseActions.save], values: { total: 14, fixed: 8, open: 4, intensity: "休闲对抗", positions: "门将、后卫、前锋", aa: "¥30 / 人", deadline: "8月23日 12:00", visibility: "公开" } },
  "draft-manage": { id: "draft-manage", title: "管理球局", status: "私有草稿", description: "仅你可见，尚未公开或分享。", actions: [baseActions.preview, baseActions.edit, baseActions.abandon, baseActions.publish] },
  "published-manage": { id: "published-manage", title: "管理球局", status: "已发布", description: "公开详情已可查看；申请功能尚未开放。", actions: [baseActions.share, baseActions.open, baseActions.edit, baseActions.cancel], cancelNotice: "只取消本次开放球局，不会取消已预订场地，也不会发起退款。" },
  "public-readonly": { id: "public-readonly", title: "公开球局", notice: "当前仅供查看，申请加入即将开放", actions: [] },
});

const app = typeof document === "undefined" ? null : document.querySelector("#captain-open-game-app");
const query = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);
let stateId = CAPTAIN_OPEN_GAME_STATE_IDS.includes(query.get("state")) ? query.get("state") : "create-ready";
let feedback = "";
let formValues = { ...CAPTAIN_OPEN_GAME_STATES["create-ready"].values };
let overlay = null;
const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
const button = (action, className = "secondary") => { const node = el("button", className, action.label); node.type = "button"; node.dataset.action = action.id; node.setAttribute("aria-label", action.label); return node; };
const system = (title) => { const frag = document.createDocumentFragment(); const top = el("div", "system-row"); top.append(el("span", "system-time", "9:41"), el("span", "native-capsule")); const nav = el("header", "nav"); nav.append(el("span", "nav-spacer"), el("h1", "", title), el("span", "nav-spacer")); frag.append(top, nav); return frag; };
const orderCard = () => { const card = el("section", "card section"); const heading = el("div", "summary-title"); heading.append(el("span", "", "真实订场已确认"), el("span", "readonly", "不可修改")); const name = el("h2", "summary-name", CONFIRMED_ORDER.venue); const meta = el("p", "summary-meta"); meta.append(`${CONFIRMED_ORDER.pitch} · ${CONFIRMED_ORDER.format}`, document.createElement("br"), `${CONFIRMED_ORDER.date} · ${CONFIRMED_ORDER.time}`, document.createElement("br"), CONFIRMED_ORDER.booking); card.append(heading, name, meta); return card; };
const section = (title, content) => { const card = el("section", "card section"); card.append(el("h2", "section-title", title), content); return card; };
const inputRow = (label, value, help) => { const row = el("div", "form-row"); row.append(el("span", "field-label", label), el("div", "input-shell", value)); if (help) row.append(el("span", "field-help", help)); return row; };
const stepper = (label, value, actionPrefix, help) => { const row = el("div", "form-row"); const control = el("div", "stepper"); const decrement = button({ id: `${actionPrefix}-decrease`, label: `${label}减少`, nextState: "create-ready", fixtureTransition: "update form Fixture value" }, "icon-button"); decrement.textContent = "−"; const increment = button({ id: `${actionPrefix}-increase`, label: `${label}增加`, nextState: "create-ready", fixtureTransition: "update form Fixture value" }, "icon-button"); increment.textContent = "+"; control.append(decrement, el("span", "stepper-value", String(value)), increment); row.append(el("span", "field-label", label), control, el("span", "field-help", help)); return row; };
const selections = (items, active) => { const wrap = el("div", "selection-row"); items.forEach((item) => wrap.append(el("span", `selection${item === active || active.includes?.(item) ? " selection--active" : ""}`, item))); return wrap; };
const createScreen = (state) => {
  const screen = el("section", "screen");
  screen.append(orderCard());
  const group = el("div", ""); group.append(inputRow("球局名称", "奥体周日轻松局"), inputRow("球队名称", "津门周末足球队")); screen.append(section("球局与球队", group));
  const numbers = el("div", ""); numbers.append(stepper("计划总人数", formValues.total, "total", "范围 4–30 人"), stepper("已有固定队员", formValues.fixed, "fixed", "包含队长本人"), stepper("开放给散客", formValues.open, "open", "至少开放 1 个名额"), el("p", "quantity-copy", `计划共 ${formValues.total} 人，当前固定 ${formValues.fixed} 人，本次开放 ${formValues.open} 个名额`)); screen.append(section("人数与开放名额", numbers));
  const requirements = el("div", ""); requirements.append(inputRow("对抗强度", formValues.intensity), inputRow("最低经验说明", "有基本传接球经验即可"), inputRow("位置需求", formValues.positions)); screen.append(section("强度、经验与位置", requirements));
  const terms = el("div", ""); terms.append(inputRow("预计人均 AA", formValues.aa, "到场线下结算，平台不代收或担保"), inputRow("报名截止", formValues.deadline, "不晚于开场前 2 小时"), inputRow("可见范围", formValues.visibility, "公开与仅链接访问均展示相同脱敏详情")); screen.append(section("费用、截止与可见范围", terms));
  screen.append(el("p", "disclosure", "装备：深浅两套球衣；提前 15 分钟到场。保存后仅创建你可见的私有草稿。"));
  return screen;
};
const gameSummary = () => { const card = el("section", "card section"); const grid = el("dl", "summary-grid"); [["计划人数", "14 人"], ["开放名额", "4 人"], ["对抗强度", "休闲对抗"], ["位置需求", "门将、后卫、前锋"], ["预计 AA", "¥30 / 人"], ["可见范围", "公开"]].forEach(([term, value]) => { const item = el("div"); item.append(el("dt", "", term), el("dd", "", value)); grid.append(item); }); card.append(el("h2", "summary-title", "球局概要"), grid); return card; };
const manageScreen = (state) => { const screen = el("section", "screen screen--manage"); const status = el("section", "status-row"); const copy = el("div"); copy.append(el("strong", "", state.status), el("p", "", state.description)); status.append(el("span", "status-dot"), copy); screen.append(status, orderCard(), gameSummary()); const actions = el("section", "action-list section"); state.actions.forEach((action) => actions.append(button(action, action.id === "cancel" || action.id === "abandon" ? "danger" : action.id === "publish" ? "primary" : "secondary"))); screen.append(section("可用操作", actions)); if (state.cancelNotice) screen.append(el("p", "disclosure", state.cancelNotice)); return screen; };
const publicScreen = (state) => { const screen = el("section", "screen screen--public"); screen.append(el("p", "eyebrow", "真实订场已确认"), el("h2", "public-heading", "奥体周日轻松局"), el("p", "public-subtitle", "津门周末足球队 · 休闲对抗"), orderCard(), gameSummary()); const details = el("section", "card public-details section"); details.append(el("p", "", "最低经验：有基本传接球经验即可"), el("p", "", "报名截止：8月23日 12:00"), el("p", "", "装备与到场：深浅两套球衣，提前 15 分钟到场"), el("p", "", "成人参与，请自行评估运动风险；到场线下结算，平台不代收或担保。")); screen.append(details, el("section", "notice", state.notice)); return screen; };
const renderOverlay = () => { if (!overlay) return null; const scrim = el("section", "fixture-scrim"); const sheet = el("section", "fixture-sheet"); const action = { id: overlay.action, label: overlay.label, nextState: stateId, fixtureTransition: overlay.transition }; sheet.append(el("h2", "", overlay.title), el("p", "", overlay.message), button(action, overlay.danger ? "danger" : "primary")); scrim.append(sheet); return scrim; };
const transition = (action) => { const step = /^(total|fixed|open)-(increase|decrease)$/.exec(action); if (step) { const [, field, direction] = step; const amount = direction === "increase" ? 1 : -1; const limits = { total: [4, 30], fixed: [1, formValues.total - formValues.open], open: [1, formValues.total - formValues.fixed] }; formValues[field] = Math.min(limits[field][1], Math.max(limits[field][0], formValues[field] + amount)); feedback = "update form Fixture value"; render(); return; } if (action === "share") { feedback = "open Fixture share sheet"; overlay = { title: "分享球局", message: "Fixture 仅演示微信分享面板；分享不改变球局状态。", label: "关闭", action: "dismiss-overlay", transition: "dismiss Fixture share sheet" }; render(); return; } if (action === "cancel") { feedback = "open cancel confirmation; booking unchanged"; overlay = { title: "确认取消球局？", message: "只取消本次开放球局，不会取消已预订场地，也不会发起退款。", label: "确认取消球局", action: "confirm-cancel", transition: "confirm cancellation Fixture; booking unchanged", danger: true }; render(); return; } if (action === "abandon") { feedback = "open abandon confirmation"; overlay = { title: "确认放弃草稿？", message: "草稿不会公开，也不会影响已预订场地。", label: "确认放弃草稿", action: "confirm-abandon", transition: "confirm abandon private DRAFT", danger: true }; render(); return; } if (action === "dismiss-overlay") { feedback = "dismiss Fixture share sheet"; overlay = null; render(); return; } if (action === "confirm-cancel") { feedback = "cancelled open game Fixture; booking unchanged"; overlay = null; render(); return; } if (action === "confirm-abandon") { feedback = "abandoned private DRAFT Fixture"; overlay = null; stateId = "create-ready"; render(); return; } const current = CAPTAIN_OPEN_GAME_STATES[stateId]; const found = current.actions.find(({ id }) => id === action); if (!found) return; feedback = found.fixtureTransition; stateId = found.nextState; const params = new URLSearchParams(window.location.search); params.set("state", stateId); window.history.replaceState({}, "", `${window.location.pathname}?${params}`); render(); };
function render() { const state = CAPTAIN_OPEN_GAME_STATES[stateId]; app.replaceChildren(system(state.title)); if (feedback) app.append(el("p", "fixture-feedback", `Fixture：${feedback}`)); app.append(stateId === "create-ready" ? createScreen(state) : stateId === "public-readonly" ? publicScreen(state) : manageScreen(state)); if (stateId === "create-ready") { const footer = el("footer", "footer"); footer.append(button(baseActions.save, "primary")); app.append(footer); } const sheet = renderOverlay(); if (sheet) app.append(sheet); app.querySelectorAll("button[data-action]").forEach((node) => node.addEventListener("click", () => transition(node.dataset.action))); }
if (app) render();
