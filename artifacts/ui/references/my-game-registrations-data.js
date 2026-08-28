const deepFreeze = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};

export const MY_REGISTRATION_STATE_IDS = deepFreeze(["entry", "ready-list", "empty", "load-error"]);
export const REGISTRATION_CARD_FIELDS = deepFreeze([
  "effectiveStatus", "gameName", "dateLabel", "timeLabel", "venue", "pitch", "formatLabel",
]);
export const REGISTRATION_DETAIL_TARGET = "WHOLE_CARD_ONLY";

const registration = (value) => deepFreeze(value);
export const MY_REGISTRATIONS = deepFreeze([
  registration({
    registrationId: "reg-applied",
    effectiveStatus: "APPLIED",
    statusLabel: "待队长审核",
    visibility: "PUBLIC",
    appliedAt: "2026-08-29T09:30:00+08:00",
    gameName: "海河周六轻松局",
    dateLabel: "9月5日 周六",
    timeLabel: "09:00–10:30",
    venue: "天津河东体育中心",
    pitch: "笼式五人制 2 号场",
    formatLabel: "五人制",
    detailPath: "/dev/pages/c1c-registration-detail/index?registrationId=reg-applied",
  }),
  registration({
    registrationId: "reg-joined",
    effectiveStatus: "JOINED",
    statusLabel: "已加入",
    visibility: "LINK_ONLY",
    appliedAt: "2026-08-28T18:10:00+08:00",
    gameName: "奥体周日傍晚局",
    dateLabel: "9月6日 周日",
    timeLabel: "18:00–20:00",
    venue: "天津奥体足球场",
    pitch: "七人制 A 场",
    formatLabel: "七人制",
    detailPath: "/dev/pages/c1c-registration-detail/index?registrationId=reg-joined",
  }),
  registration({
    registrationId: "reg-rejected",
    effectiveStatus: "REJECTED",
    statusLabel: "未通过",
    visibility: "PUBLIC",
    appliedAt: "2026-08-20T12:40:00+08:00",
    gameName: "水西公园夜场局",
    dateLabel: "8月23日 周日",
    timeLabel: "20:00–21:30",
    venue: "水西公园足球场",
    pitch: "五人制 1 号场",
    formatLabel: "五人制",
    detailPath: "/dev/pages/c1c-registration-detail/index?registrationId=reg-rejected",
  }),
  registration({
    registrationId: "reg-cancelled",
    effectiveStatus: "CANCELLED",
    statusLabel: "球局已取消",
    visibility: "LINK_ONLY",
    appliedAt: "2026-08-10T08:20:00+08:00",
    gameName: "津南周末友谊局",
    dateLabel: "8月16日 周日",
    timeLabel: "15:00–17:00",
    venue: "天津津南体育公园",
    pitch: "七人制 B 场",
    formatLabel: "七人制",
    detailPath: "/dev/pages/c1c-registration-detail/index?registrationId=reg-cancelled",
  }),
]);

export const firstPage = deepFreeze({ items: MY_REGISTRATIONS.slice(0, 2), nextCursor: "c1c-page-2" });
export const secondPage = deepFreeze({ items: MY_REGISTRATIONS.slice(2), nextCursor: null });

export const DIRECTORY_GAMES = deepFreeze([
  {
    gameId: "game-haihe-five", date: "2026-09-05", dateLabel: "9月5日 周六", timeLabel: "09:00–10:30",
    format: "FIVE", formatLabel: "五人制", available: true, gameName: "海河周六轻松局",
    venue: "天津河东体育中心", pitch: "笼式五人制 2 号场",
  },
  {
    gameId: "game-olympic-seven", date: "2026-09-06", dateLabel: "9月6日 周日", timeLabel: "18:00–20:00",
    format: "SEVEN", formatLabel: "七人制", available: true, gameName: "奥体周日傍晚局",
    venue: "天津奥体足球场", pitch: "七人制 A 场",
  },
  {
    gameId: "game-riverside-five", date: "2026-09-07", dateLabel: "9月7日 周一", timeLabel: "20:00–21:30",
    format: "FIVE", formatLabel: "五人制", available: false, gameName: "水西公园夜场局",
    venue: "水西公园足球场", pitch: "五人制 1 号场",
  },
]);

export const clearEntryFilters = () => ({ date: "ALL", format: "ALL", availableOnly: false });
export const getVisibleDirectoryGames = (state) => DIRECTORY_GAMES.filter((game) => (
  (state.entryFilters.date === "ALL" || state.entryFilters.date === game.date)
  && (state.entryFilters.format === "ALL" || state.entryFilters.format === game.format)
  && (!state.entryFilters.availableOnly || game.available)
));

export const createArtifactState = (requestedState = "ready-list") => {
  const validState = MY_REGISTRATION_STATE_IDS.includes(requestedState) ? requestedState : "ready-list";
  const sourceEmpty = validState === "empty";
  const initialError = validState === "load-error";
  return {
    requestedState: validState,
    view: validState === "entry" ? "ENTRY" : "LIST",
    listMode: initialError ? "LOAD_ERROR" : "READY",
    sourceEmpty,
    entryFilters: clearEntryFilters(),
    entryScrollTop: 0,
    listScrollTop: 0,
    items: sourceEmpty || initialError ? [] : [...firstPage.items],
    nextCursor: sourceEmpty || initialError ? null : firstPage.nextCursor,
    selectedRegistrationId: null,
    selectedEntryGameId: null,
    secondPageLoaded: false,
  };
};

export const setEntryScrollTop = (state, value) => { state.entryScrollTop = Math.max(0, Number(value) || 0); };
export const setListScrollTop = (state, value) => { state.listScrollTop = Math.max(0, Number(value) || 0); };
export const getSelectedRegistration = (state) => (
  MY_REGISTRATIONS.find(({ registrationId }) => registrationId === state.selectedRegistrationId) ?? null
);
export const getSelectedEntryGame = (state) => (
  DIRECTORY_GAMES.find(({ gameId }) => gameId === state.selectedEntryGameId) ?? null
);

const uniqueItems = (items) => [...new Map(items.map((item) => [item.registrationId, item])).values()];
const setDate = (state, { value }) => { state.entryFilters = { ...state.entryFilters, date: value }; return true; };
const setFormat = (state, { value }) => { state.entryFilters = { ...state.entryFilters, format: value }; return true; };
const toggleAvailable = (state) => {
  state.entryFilters = { ...state.entryFilters, availableOnly: !state.entryFilters.availableOnly };
  return true;
};
const clearFilters = (state) => { state.entryFilters = clearEntryFilters(); return true; };
const openMine = (state) => { state.view = "LIST"; return true; };
const openEntryGame = (state, { gameId }) => {
  if (!DIRECTORY_GAMES.some((game) => game.gameId === gameId)) return false;
  state.selectedEntryGameId = gameId;
  state.view = "ENTRY_DETAIL";
  return true;
};
const refresh = (state) => {
  state.listMode = "READY";
  state.items = state.sourceEmpty ? [] : [...firstPage.items];
  state.nextCursor = state.sourceEmpty ? null : firstPage.nextCursor;
  state.secondPageLoaded = false;
  return true;
};
const retry = (state) => refresh(state);
const loadMore = (state) => {
  if (state.sourceEmpty || state.secondPageLoaded || state.nextCursor !== "c1c-page-2") return true;
  state.items = uniqueItems([...state.items, ...secondPage.items]);
  state.nextCursor = secondPage.nextCursor;
  state.secondPageLoaded = true;
  return true;
};
const openRegistration = (state, { registrationId }) => {
  state.selectedRegistrationId = registrationId;
  const found = MY_REGISTRATIONS.some((item) => item.registrationId === registrationId);
  state.view = found ? "DETAIL" : "NOT_FOUND";
  return found;
};
const returnList = (state) => {
  state.view = "LIST";
  state.selectedRegistrationId = null;
  return true;
};
const resumeEntry = (state) => { state.view = "ENTRY"; return true; };
const headerBack = (state) => {
  if (state.view === "DETAIL" || state.view === "NOT_FOUND") return returnList(state);
  if (state.view === "ENTRY_DETAIL") { state.selectedEntryGameId = null; state.view = "ENTRY"; return true; }
  if (state.view === "LIST") { state.view = "ENTRY"; return true; }
  if (state.view === "SCENARIO") { state.view = "ENTRY"; return true; }
  state.view = "SCENARIO";
  return true;
};

export const ARTIFACT_ACTION_HANDLERS = Object.freeze({
  "header-back": headerBack,
  "resume-entry": resumeEntry,
  "date-filter": setDate,
  "format-filter": setFormat,
  "availability-filter": toggleAvailable,
  "clear-entry-filters": clearFilters,
  "open-my-registrations": openMine,
  "open-entry-game": openEntryGame,
  "refresh-registrations": refresh,
  "retry-list": retry,
  "load-more": loadMore,
  "open-registration-detail": openRegistration,
  "return-list": returnList,
});
export const VISIBLE_CONTROL_ACTIONS = deepFreeze(Object.keys(ARTIFACT_ACTION_HANDLERS));
export const dispatchArtifactAction = (state, action, payload = {}) => {
  const handler = ARTIFACT_ACTION_HANDLERS[action];
  return handler ? handler(state, payload) : false;
};

const app = typeof document === "undefined" ? null : document.querySelector("#my-game-registrations-app");
const requested = typeof window === "undefined"
  ? "ready-list"
  : new URLSearchParams(window.location.search).get("state") ?? "ready-list";
const state = createArtifactState(requested);

const element = (tag, className = "", text = "") => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
};
const actionButton = (label, dataAction, className, details = {}) => {
  const node = element("button", className, label);
  node.type = "button";
  node.dataset.action = dataAction;
  Object.entries(details).forEach(([key, value]) => { node.dataset[key] = value; });
  return node;
};
const renderSystem = (title) => {
  const fragment = document.createDocumentFragment();
  const system = element("div", "system-row");
  system.append(element("span", "system-time", "9:41"), element("span", "native-capsule"));
  const header = element("header", "nav");
  const back = actionButton("", "header-back", "icon-button");
  back.setAttribute("aria-label", "返回上一页");
  back.append(element("span", "back-glyph"));
  header.append(back, element("h1", "", title), element("span", "nav-spacer"));
  fragment.append(system, header);
  return fragment;
};
const createScreen = (className = "") => element("section", `screen${className ? ` ${className}` : ""}`);
const statusClass = (effectiveStatus) => (
  effectiveStatus === "APPLIED" ? "status-badge status-badge--applied"
    : effectiveStatus === "JOINED" ? "status-badge status-badge--joined"
      : "status-badge status-badge--neutral"
);

const renderEntryFilters = () => {
  const filters = element("section", "entry-filters");
  const dates = element("div", "date-strip");
  [["ALL", "全部日期"], ["2026-09-05", "9/5 周六"], ["2026-09-06", "9/6 周日"]].forEach(([value, label]) => {
    dates.append(actionButton(label, "date-filter", `date-chip${state.entryFilters.date === value ? " control--active" : ""}`, { value }));
  });
  const row = element("div", "filter-row");
  const nextFormat = state.entryFilters.format === "ALL" ? "FIVE" : state.entryFilters.format === "FIVE" ? "SEVEN" : "ALL";
  const formatLabel = { ALL: "全部人制", FIVE: "五人制", SEVEN: "七人制" }[state.entryFilters.format];
  const format = actionButton(formatLabel, "format-filter", `filter-control${state.entryFilters.format !== "ALL" ? " control--active" : ""}`, { value: nextFormat });
  format.append(element("span", "caret"));
  const available = actionButton("仅看有名额", "availability-filter", `filter-control${state.entryFilters.availableOnly ? " control--active" : ""}`);
  available.prepend(element("span", "toggle-dot"));
  row.append(format, available);
  filters.append(dates, row);
  if (state.entryFilters.date !== "ALL" || state.entryFilters.format !== "ALL" || state.entryFilters.availableOnly) {
    filters.append(actionButton("清除筛选", "clear-entry-filters", "clear-link"));
  }
  return filters;
};

const directoryCard = (game) => {
  const card = actionButton("", "open-entry-game", "directory-card", { gameId: game.gameId });
  card.append(
    element("span", `availability${game.available ? "" : " availability--full"}`, game.available ? "有名额" : "已满"),
    element("h2", "", game.gameName),
    element("p", "card-time", `${game.dateLabel} · ${game.timeLabel}`),
    element("p", "card-place", `${game.venue} · ${game.pitch}`),
    element("span", "card-format", game.formatLabel),
    element("span", "chevron"),
  );
  return card;
};

const renderEntry = () => {
  app.append(renderSystem("找球局"));
  const screen = createScreen();
  screen.append(element("p", "entry-context", "天津 · 仅展示真实订场已确认的公开球局"));
  const mine = actionButton("", "open-my-registrations", "mine-entry");
  const mineCopy = element("span", "mine-entry__copy");
  mineCopy.append(element("strong", "", "我的报名"), element("small", "", "查看自己最近的报名状态"));
  mine.append(mineCopy, element("span", "chevron"));
  screen.append(mine, renderEntryFilters());
  const games = getVisibleDirectoryGames(state);
  const result = element("p", "result-line");
  result.append(element("span", "", "按开场时间排序"), element("strong", "", `${games.length} 场`));
  screen.append(result);
  if (games.length === 0) {
    const empty = element("section", "state-card");
    empty.append(element("h2", "", "没有符合筛选的球局"), element("p", "", "换个日期或人制，看看更多公开球局。"), actionButton("清除筛选", "clear-entry-filters", "secondary-action"));
    screen.append(empty);
  } else {
    const list = element("section", "card-list");
    games.forEach((game) => list.append(directoryCard(game)));
    screen.append(list);
  }
  app.append(screen);
  screen.scrollTop = state.entryScrollTop;
};

const renderEntryDetail = () => {
  app.append(renderSystem("球局详情"));
  const screen = createScreen();
  const game = getSelectedEntryGame(state);
  const card = element("article", "detail-card");
  if (game) {
    card.append(
      element("p", "confirmed", "真实订场已确认"),
      element("h2", "", game.gameName),
      element("p", "detail-line", `${game.dateLabel} · ${game.timeLabel}`),
      element("p", "detail-line", `${game.venue} · ${game.pitch}`),
      element("p", "detail-line", game.formatLabel),
    );
  }
  screen.append(card);
  app.append(screen);
};

const registrationCard = (item) => {
  const card = actionButton("", "open-registration-detail", "registration-card", { registrationId: item.registrationId });
  const top = element("div", "registration-card__top");
  top.append(element("span", statusClass(item.effectiveStatus), item.statusLabel), element("span", "card-format", item.formatLabel));
  card.append(
    top,
    element("h2", "", item.gameName),
    element("p", "card-time", `${item.dateLabel} · ${item.timeLabel}`),
    element("p", "card-place", item.venue),
    element("p", "card-pitch", item.pitch),
    element("span", "chevron"),
  );
  return card;
};

const renderListState = (screen) => {
  if (state.listMode === "LOAD_ERROR") {
    const error = element("section", "state-card state-card--error");
    error.append(element("h2", "", "报名加载失败"), element("p", "", "网络开了个小差，请重新加载。"), actionButton("重新加载", "retry-list", "secondary-action"));
    screen.append(error);
    return;
  }
  if (state.items.length === 0) {
    const empty = element("section", "state-card");
    empty.append(element("h2", "", "还没有报名记录"), element("p", "", "找到合适的公开球局后，可以提交加入申请。"), actionButton("刷新", "refresh-registrations", "secondary-action"));
    screen.append(empty);
    return;
  }
  const list = element("section", "card-list registration-list");
  state.items.forEach((item) => list.append(registrationCard(item)));
  screen.append(list);
  if (state.nextCursor) screen.append(actionButton("加载更多", "load-more", "secondary-action load-more"));
};

const renderList = () => {
  app.append(renderSystem("我的报名"));
  const screen = createScreen();
  const intro = element("div", "list-intro");
  const copy = element("span", "");
  copy.append(element("strong", "", "最近的报名"), element("small", "", "状态以服务端为准"));
  intro.append(copy, actionButton("刷新", "refresh-registrations", "refresh-action"));
  screen.append(intro);
  renderListState(screen);
  app.append(screen);
  screen.scrollTop = state.listScrollTop;
};

const renderRegistrationDetail = () => {
  app.append(renderSystem("报名详情"));
  const screen = createScreen();
  const item = getSelectedRegistration(state);
  if (!item) {
    const missing = element("section", "state-card");
    missing.append(element("h2", "", "报名不存在或已失效"), element("p", "", "返回列表查看仍可访问的报名。"), actionButton("返回我的报名", "return-list", "secondary-action"));
    screen.append(missing);
  } else {
    const card = element("article", "detail-card");
    card.append(
      element("span", statusClass(item.effectiveStatus), item.statusLabel),
      element("h2", "", item.gameName),
      element("p", "detail-line", `${item.dateLabel} · ${item.timeLabel}`),
      element("p", "detail-line", item.venue),
      element("p", "detail-line", item.pitch),
      element("p", "detail-line", item.formatLabel),
      element("p", "detail-hint", "这是只读状态预览，结果以服务端为准。"),
    );
    screen.append(card);
  }
  app.append(screen);
};

const renderScenario = () => {
  app.append(renderSystem("C1c 开发预览"));
  const screen = createScreen("scenario");
  const card = element("section", "state-card");
  card.append(element("h2", "", "已返回开发预览"), element("p", "", "以下页面使用隔离模拟数据。"), actionButton("继续找球局", "resume-entry", "secondary-action"));
  screen.append(card);
  app.append(screen);
};

const routeSnapshot = () => ({
  view: state.view,
  selectedRegistrationId: state.selectedRegistrationId,
  selectedEntryGameId: state.selectedEntryGameId,
});
const syncUrl = (method, hasArtifactHistory = false) => {
  const params = new URLSearchParams(window.location.search);
  params.set("state", state.requestedState);
  params.set("view", state.view.toLowerCase());
  if (state.selectedRegistrationId) params.set("registration", state.selectedRegistrationId); else params.delete("registration");
  if (state.selectedEntryGameId) params.set("game", state.selectedEntryGameId); else params.delete("game");
  const url = `${window.location.pathname}?${params}`;
  window.history[method]({ ...routeSnapshot(), hasArtifactHistory }, "", url);
};

const render = () => {
  app.replaceChildren();
  if (state.view === "ENTRY") renderEntry();
  else if (state.view === "ENTRY_DETAIL") renderEntryDetail();
  else if (state.view === "LIST") renderList();
  else if (state.view === "DETAIL" || state.view === "NOT_FOUND") renderRegistrationDetail();
  else renderScenario();

  const screen = app.querySelector(".screen");
  if (screen) screen.addEventListener("scroll", () => {
    if (state.view === "ENTRY") setEntryScrollTop(state, screen.scrollTop);
    if (state.view === "LIST") setListScrollTop(state, screen.scrollTop);
  }, { passive: true });
  app.querySelectorAll("button[data-action]").forEach((node) => node.addEventListener("click", ({ currentTarget }) => {
    const action = currentTarget.dataset.action;
    const priorView = state.view;
    const payload = {
      value: currentTarget.dataset.value,
      gameId: currentTarget.dataset.gameId,
      registrationId: currentTarget.dataset.registrationId,
    };
    dispatchArtifactAction(state, action, payload);
    const forward = action === "open-my-registrations" || action === "open-entry-game" || action === "open-registration-detail";
    const backward = (action === "header-back" || action === "return-list") && window.history.state?.hasArtifactHistory
      && ["ENTRY_DETAIL", "LIST", "DETAIL", "NOT_FOUND"].includes(priorView);
    if (backward) { window.history.back(); return; }
    syncUrl(forward ? "pushState" : "replaceState", forward);
    render();
  }));
};

if (app) {
  const route = new URLSearchParams(window.location.search);
  const requestedView = route.get("view");
  if (requestedView === "detail") openRegistration(state, { registrationId: route.get("registration") });
  if (requestedView === "entry_detail") openEntryGame(state, { gameId: route.get("game") });
  window.history.replaceState({ ...routeSnapshot(), hasArtifactHistory: false }, "");
  window.addEventListener("popstate", ({ state: historyState }) => {
    if (!historyState?.view) return;
    state.view = historyState.view;
    state.selectedRegistrationId = historyState.selectedRegistrationId ?? null;
    state.selectedEntryGameId = historyState.selectedEntryGameId ?? null;
    render();
  });
  render();
}
