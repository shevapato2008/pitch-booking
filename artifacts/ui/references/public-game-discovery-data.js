const freeze = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};

export const PUBLIC_GAME_DISCOVERY_STATE_IDS = freeze(["ready-list", "filtered-nonempty", "filter-no-match", "load-error"]);
export const PUBLIC_GAME_CATALOG = freeze([
  {
    id: "harbor-five", visibility: "PUBLIC", effectiveState: "PUBLISHED", startsAt: "2026-08-29T07:30:00+08:00",
    date: "2026-08-29", dateLabel: "8月29日 周六", timeLabel: "07:30–09:00", format: "FIVE", formatLabel: "五人制",
    name: "海河周六晨练局", venue: "天津河东体育中心", pitch: "笼式五人制 2 号场", intensity: "轻松交流",
    positions: "中场 / 前锋", currentPlayers: 6, totalPlayers: 10, remainingSpots: 4, aa: "¥36", deadline: "8月28日 20:00",
    team: "海河晨光队", arrival: "深浅两套球衣，提前 15 分钟到场",
  },
  {
    id: "olympic-seven", visibility: "PUBLIC", effectiveState: "PUBLISHED", startsAt: "2026-08-30T18:00:00+08:00",
    date: "2026-08-30", dateLabel: "8月30日 周日", timeLabel: "18:00–20:00", format: "SEVEN", formatLabel: "七人制",
    name: "奥体周日傍晚局", venue: "天津奥体足球场", pitch: "七人制 A 场", intensity: "认真对抗",
    positions: "后卫 / 门将", currentPlayers: 11, totalPlayers: 14, remainingSpots: 3, aa: "¥52", deadline: "8月30日 12:00",
    team: "津门周末足球队", arrival: "提前 20 分钟热身，备好护腿板",
  },
  {
    id: "riverside-five", visibility: "PUBLIC", effectiveState: "PUBLISHED", startsAt: "2026-08-31T20:00:00+08:00",
    date: "2026-08-31", dateLabel: "8月31日 周一", timeLabel: "20:00–21:30", format: "FIVE", formatLabel: "五人制",
    name: "水西公园夜场局", venue: "水西公园足球场", pitch: "五人制 1 号场", intensity: "新手友好",
    positions: "任意位置", currentPlayers: 10, totalPlayers: 10, remainingSpots: 0, aa: "¥42", deadline: "8月31日 16:00",
    team: "西青快乐足球", arrival: "穿碎钉球鞋，开场前 10 分钟集合",
  },
]);

export const clearFilters = () => ({ date: "ALL", format: "ALL", availableOnly: false });
export const filterGames = (catalog, filters) => catalog.filter((game) => (
  (filters.date === "ALL" || game.date === filters.date)
  && (filters.format === "ALL" || game.format === filters.format)
  && (!filters.availableOnly || game.remainingSpots > 0)
));

const presetFilters = freeze({
  "ready-list": clearFilters(),
  "filtered-nonempty": { date: "2026-08-29", format: "FIVE", availableOnly: true },
  "filter-no-match": { date: "2026-08-31", format: "FIVE", availableOnly: true },
  "load-error": clearFilters(),
});

export const createArtifactState = (requestedState = "ready-list") => {
  const validState = PUBLIC_GAME_DISCOVERY_STATE_IDS.includes(requestedState) ? requestedState : "ready-list";
  return {
    requestedState: validState,
    mode: validState === "load-error" ? "LOAD_ERROR" : requestedState === "loading" ? "LOADING" : "READY",
    filters: { ...(presetFilters[validState] ?? clearFilters()) },
    sourceEmpty: requestedState === "source-empty",
    selectedGameId: null,
    detailRequested: false,
    previewHome: false,
  };
};

export const setFilters = (state, partial) => { state.filters = { ...state.filters, ...partial }; };
export const clearStateFilters = (state) => { state.filters = clearFilters(); };
export const retryLoad = (state) => { state.mode = "READY"; };
export const getVisibleGames = (state) => state.sourceEmpty ? [] : filterGames(PUBLIC_GAME_CATALOG, state.filters);
export const openDetail = (state, id) => {
  if (!PUBLIC_GAME_CATALOG.some((game) => game.id === id)) return false;
  state.selectedGameId = id;
  state.detailRequested = true;
  return true;
};
export const getSelectedGame = (state) => PUBLIC_GAME_CATALOG.find(({ id }) => id === state.selectedGameId) ?? null;
export const returnToList = (state) => { state.selectedGameId = null; state.detailRequested = false; };

const app = typeof document === "undefined" ? null : document.querySelector("#public-game-discovery-app");
const requested = typeof window === "undefined" ? "ready-list" : new URLSearchParams(window.location.search).get("state") ?? "ready-list";
const state = createArtifactState(requested);

const el = (tag, className = "", text = "") => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
};
const actionButton = (label, action, className, extra = {}) => {
  const node = el("button", className, label);
  node.type = "button";
  node.dataset.action = action;
  Object.entries(extra).forEach(([key, value]) => { node.dataset[key] = value; });
  return node;
};
const system = (title, action = "return-preview") => {
  const fragment = document.createDocumentFragment();
  const row = el("div", "system-row");
  row.append(el("span", "system-time", "9:41"), el("span", "native-capsule"));
  const nav = el("header", "nav");
  const back = actionButton("", action, "icon-button");
  back.setAttribute("aria-label", action === "return-list" ? "返回球局列表" : "返回开发预览入口");
  back.append(el("span", "back-glyph"));
  nav.append(back, el("h1", "", title), el("span", "nav-spacer"));
  fragment.append(row, nav);
  return fragment;
};

const intro = () => {
  const fragment = document.createDocumentFragment();
  fragment.append(el("p", "preview-note", "C1b 开发预览 · 模拟数据"), el("p", "context", "天津 · 仅展示真实订场已确认的公开球局"));
  return fragment;
};
const dateOptions = [
  ["ALL", "全部日期"], ["2026-08-29", "8/29 周六"], ["2026-08-30", "8/30 周日"], ["2026-08-31", "8/31 周一"],
];
const formatLabels = { ALL: "全部人制", FIVE: "五人制", SEVEN: "七人制" };

const filters = () => {
  const section = el("section", "filters");
  const dates = el("div", "date-strip");
  dateOptions.forEach(([value, label]) => dates.append(actionButton(label, "date-filter", `date-chip${state.filters.date === value ? " date-chip--active" : ""}`, { value })));
  const row = el("div", "filter-row");
  const format = actionButton(formatLabels[state.filters.format], "format-filter", `filter-chip${state.filters.format !== "ALL" ? " filter-chip--active" : ""}`);
  format.append(el("span", "filter-chip__caret"));
  const available = actionButton("仅看有名额", "available-filter", `filter-chip${state.filters.availableOnly ? " filter-chip--active" : ""}`);
  available.prepend(el("span", "toggle-dot"));
  row.append(format, available);
  section.append(dates, row);
  return section;
};

const gameCard = (game) => {
  const card = actionButton("", "open-detail", "game-card", { gameId: game.id });
  const status = el("div", "card-status");
  status.append(el("span", "confirmed", "真实订场已确认"), el("span", `spots${game.remainingSpots === 0 ? " spots--full" : ""}`, game.remainingSpots === 0 ? "已满" : `剩 ${game.remainingSpots} 个名额`));
  card.append(status, el("h2", "game-name", game.name), el("p", "game-time", `${game.dateLabel} · ${game.timeLabel}`), el("p", "game-venue", `${game.venue} · ${game.pitch}`));
  const tags = el("div", "game-tags");
  [game.formatLabel, game.intensity, game.positions].forEach((value) => tags.append(el("span", "game-tag", value)));
  const metrics = el("div", "metrics");
  [["当前 / 计划", `${game.currentPlayers} / ${game.totalPlayers} 人`], ["预计 AA", `${game.aa} · 线下`], ["报名截止", game.deadline]].forEach(([label, value]) => {
    const metric = el("span", "metric");
    metric.append(el("span", "metric-label", label), el("strong", "metric-value", value));
    metrics.append(metric);
  });
  const organizer = el("p", "organizer");
  organizer.append(el("strong", "", game.team), el("span", "", "球队组织"));
  card.append(tags, metrics, organizer, el("span", "chevron"));
  return card;
};

const resultState = (screen) => {
  if (state.mode === "LOAD_ERROR") {
    const card = el("section", "state-card state-card--error");
    card.append(el("h2", "", "球局加载失败"), el("p", "", "网络开了个小差，请重新加载公开球局。"), actionButton("重新加载", "retry-load", "secondary-action"));
    screen.append(card);
    return;
  }
  if (state.mode === "LOADING") {
    const list = el("section", "game-list");
    list.append(el("div", "skeleton"), el("div", "skeleton"));
    screen.append(list);
    return;
  }
  const games = getVisibleGames(state);
  const line = el("p", "result-line");
  line.append(el("span", "", "按开场时间排序"), el("strong", "", `${games.length} 场`));
  screen.append(line);
  if (games.length === 0) {
    const card = el("section", "state-card");
    if (state.sourceEmpty) {
      card.append(el("h2", "", "暂时没有公开球局"), el("p", "", "可以先返回选择其他订场目的。"), actionButton("返回选择目的", "return-intent", "secondary-action"));
    } else {
      card.append(el("h2", "", "没有符合筛选的球局"), el("p", "", "换个日期或人制，看看更多公开球局。"), actionButton("清除筛选", "clear-filters", "secondary-action"));
    }
    screen.append(card);
    return;
  }
  const list = el("section", "game-list");
  games.forEach((game) => list.append(gameCard(game)));
  screen.append(list);
};

const renderList = () => {
  app.append(system("找球局"));
  const screen = el("section", "screen");
  screen.append(intro(), filters());
  resultState(screen);
  app.append(screen);
};
const renderDetail = () => {
  app.append(system("球局详情", "return-list"));
  const screen = el("section", "screen");
  screen.append(el("p", "preview-note", "C1b 开发预览 · 只读详情"));
  const game = getSelectedGame(state);
  if (!game) {
    const missing = el("section", "state-card");
    missing.append(el("h2", "", "球局不存在或已失效"), el("p", "", "返回列表查看仍可浏览的公开球局。"), actionButton("返回球局列表", "return-list", "secondary-action"));
    screen.append(missing);
  } else {
    const card = el("article", "detail-card");
    card.append(el("p", "confirmed", "真实订场已确认"), el("h2", "", game.name), el("p", "detail-meta", `${game.dateLabel} · ${game.timeLabel}`), el("p", "detail-meta", `${game.venue} · ${game.pitch}`));
    const details = el("dl", "detail-grid");
    [["人制", game.formatLabel], ["对抗强度", game.intensity], ["需要位置", game.positions], ["当前人数", `${game.currentPlayers} / ${game.totalPlayers} 人`], ["剩余名额", game.remainingSpots === 0 ? "已满" : `${game.remainingSpots} 个`], ["预计 AA", `${game.aa} · 到场线下结算`], ["球队组织者", game.team], ["报名截止", game.deadline], ["到场说明", game.arrival]].forEach(([label, value]) => {
      const item = el("div"); item.append(el("dt", "", label), el("dd", "", value)); details.append(item);
    });
    card.append(details, el("p", "detail-note", "C1b 开发预览仅验证发现与只读详情，不提供申请操作。"));
    screen.append(card);
  }
  app.append(screen);
};
const renderLauncher = () => {
  app.append(system("C1b 开发预览", "resume-list"));
  const screen = el("section", "screen launcher");
  const card = el("section", "state-card");
  card.append(el("h2", "", "公开球局发现"), el("p", "", "以下均为模拟球局，仅用于开发预览。"), actionButton("继续浏览球局", "resume-list", "secondary-action"));
  screen.append(card); app.append(screen);
};

const syncUrl = (method, view = "list", gameId = null) => {
  const params = new URLSearchParams(window.location.search);
  params.set("state", state.requestedState);
  if (view === "detail" && gameId) { params.set("view", "detail"); params.set("game", gameId); } else { params.delete("view"); params.delete("game"); }
  const nextUrl = `${window.location.pathname}?${params}`;
  if (method === "pushState") window.history.pushState({ view, gameId, fromList: view === "detail" }, "", nextUrl);
  else window.history.replaceState({ view, gameId, fromList: false }, "", nextUrl);
};
const transition = (target) => {
  const action = target.dataset.action;
  if (action === "date-filter") setFilters(state, { date: target.dataset.value });
  if (action === "format-filter") setFilters(state, { format: state.filters.format === "ALL" ? "FIVE" : state.filters.format === "FIVE" ? "SEVEN" : "ALL" });
  if (action === "available-filter") setFilters(state, { availableOnly: !state.filters.availableOnly });
  if (action === "clear-filters") clearStateFilters(state);
  if (action === "retry-load") retryLoad(state);
  if (action === "open-detail" && openDetail(state, target.dataset.gameId)) syncUrl("pushState", "detail", target.dataset.gameId);
  if (action === "return-list") { returnToList(state); if (window.history.state?.fromList) { window.history.back(); return; } syncUrl("replaceState"); }
  if (action === "return-preview") { state.previewHome = true; syncUrl("pushState", "launcher"); }
  if (action === "resume-list") { state.previewHome = false; syncUrl("replaceState"); }
  if (action === "return-intent") { state.previewHome = true; syncUrl("pushState", "launcher"); }
  render();
};
function render() {
  app.replaceChildren();
  if (state.previewHome) renderLauncher(); else if (state.detailRequested) renderDetail(); else renderList();
  app.querySelectorAll("button[data-action]").forEach((node) => node.addEventListener("click", ({ currentTarget }) => transition(currentTarget)));
}

if (app) {
  const route = new URLSearchParams(window.location.search);
  if (route.get("view") === "detail") {
    const gameId = route.get("game");
    if (!openDetail(state, gameId)) { state.selectedGameId = gameId; state.detailRequested = true; }
  }
  window.history.replaceState({ view: state.detailRequested ? "detail" : "list", gameId: state.selectedGameId, fromList: false }, "");
  window.addEventListener("popstate", ({ state: historyState }) => {
    state.previewHome = historyState?.view === "launcher";
    state.selectedGameId = historyState?.view === "detail" ? historyState.gameId : null;
    state.detailRequested = historyState?.view === "detail";
    render();
  });
  render();
}
