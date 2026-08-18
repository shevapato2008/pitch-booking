const deepFreeze = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
};

export const MY_ORDERS_STATES = deepFreeze([
  { id: "map-entry", label: "地图入口" },
  { id: "ready", label: "订单列表" },
  { id: "empty", label: "空列表" },
  { id: "error", label: "加载失败" },
  { id: "loading", label: "加载中" },
  { id: "load-more-error", label: "分页失败" },
]);

export const MY_ORDERS = deepFreeze([
  {
    id: "order-pending-001",
    venue: "天津奥体足球场",
    pitch: "七人制 A 场",
    schedule: "8月20日 周四 · 19:00–20:00",
    amount: "¥360",
    status: "pending",
    statusLabel: "待支付",
    statusDescription: "请在订单关闭前完成支付",
    route: "/pages/order-detail/index?order_id=order-pending-001",
  },
  {
    id: "order-closing-002",
    venue: "渤海元丰足球场",
    pitch: "五人制 滨河场",
    schedule: "8月19日 周三 · 20:00–22:00",
    amount: "¥320",
    status: "closing",
    statusLabel: "正在关闭",
    statusDescription: "正在确认订单与场地状态",
    route: "/pages/order-detail/index?order_id=order-closing-002",
  },
  {
    id: "order-confirmed-003",
    venue: "浦东星跃足球公园",
    pitch: "五人制 A 场",
    schedule: "8月23日 周日 · 14:00–16:00",
    amount: "¥280",
    status: "confirmed",
    statusLabel: "预订成功",
    statusDescription: "场地已为你预订",
    route: "/pages/order-detail/index?order_id=order-confirmed-003",
  },
  {
    id: "order-expired-004",
    venue: "天津市人民体育馆足球场",
    pitch: "十一人制 主场",
    schedule: "8月16日 周日 · 09:00–11:00",
    amount: "¥520",
    status: "expired",
    statusLabel: "已过期",
    statusDescription: "该订单已关闭",
    route: "/pages/order-detail/index?order_id=order-expired-004",
  },
  {
    id: "order-exception-005",
    venue: "天津奥林匹克中心五人制足球场",
    pitch: "五人制 2 号场",
    schedule: "8月18日 周二 · 18:30–20:00",
    amount: "¥260",
    status: "exception",
    statusLabel: "支付待确认",
    statusDescription: "请进入详情重新查询",
    route: "/pages/order-detail/index?order_id=order-exception-005",
  },
]);

const app = document.querySelector("#my-orders-app");
const params = new URLSearchParams(window.location.search);
const validStateIds = new Set(MY_ORDERS_STATES.map(({ id }) => id));
let currentState = validStateIds.has(params.get("state")) ? params.get("state") : "map-entry";

const element = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const svgIcon = (kind, className = "") => {
  const wrapper = element("span", className);
  wrapper.setAttribute("aria-hidden", "true");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  const paths = {
    back: ["m15 18-6-6 6-6"],
    chevron: ["m9 18 6-6-6-6"],
    search: ["M21 21l-4.35-4.35", "M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z"],
    locate: ["M12 2v3M12 19v3M2 12h3M19 12h3", "M19 12a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z", "M14.5 12a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z"],
    order: ["M7 3h10v18H7z", "M9.5 8h5M9.5 12h5M9.5 16h3"],
    empty: ["M5 7h14v12H5z", "M8 4h8l2 3H6l2-3", "M9 12h6"],
    error: ["M12 3 2.8 19h18.4L12 3Z", "M12 9v4", "M12 16h.01"],
  };
  paths[kind].forEach((pathData) => {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pathData);
    svg.append(path);
  });
  wrapper.append(svg);
  return wrapper;
};

const action = (label, className, nextState) => {
  const button = element("button", className);
  button.type = "button";
  if (nextState) button.dataset.nextState = nextState;
  button.append(element("span", "action-label", label));
  return button;
};

const navigateToState = (nextState) => {
  if (!validStateIds.has(nextState)) return;
  currentState = nextState;
  const nextParams = new URLSearchParams(window.location.search);
  nextParams.set("state", nextState);
  window.history.replaceState({}, "", `${window.location.pathname}?${nextParams.toString()}`);
  render();
};

const renderSystemNav = () => {
  const fragment = document.createDocumentFragment();
  const system = element("div", "system-row safe-area-top");
  system.append(element("span", "system-time", "9:41"), element("span", "native-capsule"));
  const nav = element("header", "orders-nav");
  const back = element("button", "orders-nav__back");
  back.type = "button";
  back.dataset.nextState = "map-entry";
  back.setAttribute("aria-label", "返回场馆地图");
  back.append(svgIcon("back"));
  nav.append(back, element("h1", "", "我的订单"));
  fragment.append(system, nav);
  return fragment;
};

const renderIntro = () => {
  const intro = element("header", "orders-intro");
  intro.append(element("h2", "", "最近的预订"), element("p", "", "状态以服务端为准"));
  return intro;
};

const renderOrderCard = (order) => {
  const card = element("button", "order-card");
  card.type = "button";
  card.dataset.orderId = order.id;
  card.dataset.route = order.route;
  card.setAttribute("aria-label", `${order.venue}，${order.pitch}，${order.statusLabel}，${order.amount}，查看订单详情`);
  const main = element("span", "order-main");
  main.append(element("h3", "", order.venue), element("p", "", order.pitch));
  const status = element("span", "order-status");
  status.append(
    element("span", `status-badge status-${order.status}`, order.statusLabel),
    element("span", "status-description", order.statusDescription),
  );
  card.append(
    main,
    element("strong", "order-amount", order.amount),
    svgIcon("chevron", "order-chevron"),
    element("span", "order-schedule", order.schedule),
    status,
  );
  return card;
};

const renderOrders = (orders) => {
  const list = element("section", "order-list");
  list.setAttribute("aria-label", "订单列表");
  orders.forEach((order) => list.append(renderOrderCard(order)));
  return list;
};

const renderReadyBody = (loadMoreError = false) => {
  const content = element("section", "orders-content");
  content.append(renderIntro(), renderOrders(loadMoreError ? MY_ORDERS.slice(0, 3) : MY_ORDERS));
  if (loadMoreError) {
    const error = element("div", "load-more-error");
    error.append(
      element("p", "", "更多订单暂时无法加载"),
      action("重试加载更多", "secondary-action load-more-action centered-action", "ready"),
    );
    content.append(error);
  } else {
    content.append(action("加载更多", "secondary-action load-more-action centered-action", "load-more-error"));
  }
  return content;
};

const renderStatePanel = (kind) => {
  const isError = kind === "error";
  const shell = element("section", "orders-content");
  const inner = element("div", "state-shell");
  const panel = element("section", "state-panel");
  const icon = svgIcon(isError ? "error" : "empty", `state-icon${isError ? " state-icon--error" : ""}`);
  icon.setAttribute("role", "img");
  icon.setAttribute("aria-label", isError ? "加载失败" : "暂无订单");
  panel.append(
    icon,
    element("h2", "", isError ? "订单暂时无法加载" : "还没有订单"),
    element("p", "", isError ? "请检查网络后重新加载，现有订单不会被改为空列表。" : "选择合适的场地并完成预订后，订单会显示在这里。"),
    action(isError ? "重新加载" : "去选场地", "primary-action state-action centered-action", isError ? "loading" : "map-entry"),
  );
  inner.append(panel);
  shell.append(renderIntro(), inner);
  return shell;
};

const renderLoading = () => {
  const content = element("section", "orders-content");
  content.setAttribute("aria-busy", "true");
  const list = element("section", "order-list");
  list.setAttribute("aria-label", "正在加载订单");
  for (let index = 0; index < 3; index += 1) {
    const card = element("article", "skeleton-card");
    const stack = element("span", "skeleton-stack");
    stack.append(
      element("span", "skeleton-line skeleton-line--title"),
      element("span", "skeleton-line"),
      element("span", "skeleton-line skeleton-line--short"),
    );
    card.append(stack, element("span", "skeleton-amount"));
    list.append(card);
  }
  content.append(renderIntro(), list);
  return content;
};

const renderMarker = (classes, label) => {
  const marker = element("button", `map-marker ${classes}`);
  marker.type = "button";
  marker.setAttribute("aria-label", label);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 36 36");
  const pin = document.createElementNS("http://www.w3.org/2000/svg", "path");
  pin.setAttribute("d", "M18 33s11-9.2 11-19A11 11 0 1 0 7 14c0 9.8 11 19 11 19Z");
  const center = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  center.setAttribute("cx", "18");
  center.setAttribute("cy", "14");
  center.setAttribute("r", "4");
  center.setAttribute("fill", "none");
  svg.append(pin, center);
  marker.append(svg);
  return marker;
};

const renderMapVenue = (name, address, meta, selected = false) => {
  const row = element("article", `map-venue-row${selected ? " map-venue-row--selected" : ""}`);
  const main = element("div", "map-venue-main");
  const metaLine = element("p", "map-venue-meta");
  metaLine.append(element("strong", "", meta), element("span", "", selected ? "· 可在线预订" : "· 场馆目录"));
  main.append(element("h2", "", name), element("p", "", address), metaLine);
  const arrow = element("button", "map-row-chevron");
  arrow.type = "button";
  arrow.setAttribute("aria-label", `查看${name}`);
  arrow.append(svgIcon("chevron"));
  row.append(main, arrow);
  return row;
};

const renderMapEntry = () => {
  const frame = element("section", "map-frame");
  frame.setAttribute("aria-label", "场馆地图与我的订单入口参考稿");
  const map = element("div", "map-canvas");
  map.setAttribute("aria-label", "天津球场示意地图，不是第三方地图瓦片");
  map.append(
    element("i", "map-road map-road--one"),
    element("i", "map-road map-road--two"),
  );

  const controls = element("header", "map-controls");
  const searchRow = element("div", "map-search-row");
  const search = element("button", "map-search");
  search.type = "button";
  search.setAttribute("aria-label", "搜索球场或地图地点");
  search.append(svgIcon("search", "map-icon"), element("span", "", "搜索球场或地图地点"));
  const locate = element("button", "map-locate");
  locate.type = "button";
  locate.setAttribute("aria-label", "使用我的位置作为搜索中心");
  locate.append(svgIcon("locate", "map-icon"));
  searchRow.append(search, locate);

  const contextRow = element("div", "map-context-row");
  const center = element("div", "map-center-copy");
  center.append(
    element("span", "map-center-label", "搜索中心"),
    element("span", "map-center-value", "天津奥林匹克中心体育馆南门附近超长地点名称"),
  );
  const orders = action("我的订单", "map-orders-action centered-action", "ready");
  orders.prepend(svgIcon("order", "map-order-icon"));
  contextRow.append(center, orders);
  controls.append(searchRow, contextRow);

  const sheet = element("section", "map-sheet safe-area-bottom");
  sheet.setAttribute("aria-label", "附近球场纵向目录");
  const handle = element("button", "map-sheet-handle");
  handle.type = "button";
  handle.setAttribute("aria-label", "展开球场列表");
  handle.append(element("span"));
  const heading = element("div", "map-sheet-head");
  heading.append(element("h1", "", "天津球场"), element("span", "", "5 个已核验地点"));
  const filters = element("div", "map-filters");
  ["距离最近", "可在线预订", "行政区"].forEach((label, index) => {
    const filter = element("button", "map-filter", label);
    filter.type = "button";
    filter.setAttribute("aria-pressed", String(index === 0));
    filters.append(filter);
  });
  const venues = element("div", "map-venue-list");
  venues.append(
    renderMapVenue("渤海元丰足球场", "天津市西青区利达路", "距搜索中心 1.2 km", true),
    renderMapVenue("天津市人民体育馆足球场", "天津市和平区贵州路33号", "距搜索中心 4.8 km"),
    renderMapVenue("天津奥林匹克中心五人制足球场", "天津市南开区宾水西道1号", "距搜索中心 6.4 km"),
  );
  sheet.append(handle, heading, filters, venues);

  frame.append(
    map,
    controls,
    renderMarker("map-marker--online map-marker--one", "渤海元丰足球场，可在线预订"),
    renderMarker("map-marker--two", "天津市人民体育馆足球场，场馆目录"),
    renderMarker("map-marker--three", "天津奥林匹克中心五人制足球场，场馆目录"),
    sheet,
  );
  return frame;
};

const renderPreviewControls = () => {
  const controls = element("nav", "preview-controls");
  controls.setAttribute("aria-label", "Artifact 状态切换");
  MY_ORDERS_STATES.forEach(({ id, label }) => {
    const button = action(label, "preview-state-action", id);
    button.setAttribute("aria-pressed", String(id === currentState));
    controls.append(button);
  });
  return controls;
};

const render = () => {
  app.replaceChildren();
  app.dataset.state = currentState;
  app.dataset.showControls = String(params.get("controls") === "1");
  if (currentState === "map-entry") {
    app.append(renderMapEntry());
  } else {
    app.append(renderSystemNav());
    if (currentState === "ready") app.append(renderReadyBody());
    if (currentState === "empty" || currentState === "error") app.append(renderStatePanel(currentState));
    if (currentState === "loading") app.append(renderLoading());
    if (currentState === "load-more-error") app.append(renderReadyBody(true));
  }
  app.append(renderPreviewControls());
};

app.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.dataset.nextState) {
    navigateToState(button.dataset.nextState);
    return;
  }
  if (button.dataset.route) {
    const announcement = element("span", "sr-only", `Fixture 路由：${button.dataset.route}`);
    announcement.setAttribute("role", "status");
    app.append(announcement);
    window.location.hash = `route=${encodeURIComponent(button.dataset.route)}`;
  }
});

const parseColor = (value) => {
  const match = value.match(/[\d.]+/g);
  return match ? match.slice(0, 3).map(Number) : [0, 0, 0];
};

const luminance = ([red, green, blue]) => {
  const channels = [red, green, blue].map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return (channels[0] * 0.2126) + (channels[1] * 0.7152) + (channels[2] * 0.0722);
};

const contrast = (foreground, background) => {
  const light = Math.max(luminance(parseColor(foreground)), luminance(parseColor(background)));
  const dark = Math.min(luminance(parseColor(foreground)), luminance(parseColor(background)));
  return (light + 0.05) / (dark + 0.05);
};

window.__artifactAudit__ = () => {
  const issues = [];
  const artifactRect = app.getBoundingClientRect();
  if (artifactRect.width !== 375 || artifactRect.height !== 812) issues.push(`artifact:${artifactRect.width}x${artifactRect.height}`);
  if (document.documentElement.scrollWidth > 375) issues.push(`horizontal-overflow:${document.documentElement.scrollWidth}`);

  const visibleButtons = [...app.querySelectorAll("button")].filter((button) => {
    const rect = button.getBoundingClientRect();
    const style = getComputedStyle(button);
    return style.display !== "none" && rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < 812;
  });
  visibleButtons.forEach((button) => {
    const rect = button.getBoundingClientRect();
    if (rect.width < 44 || rect.height < 44) issues.push(`target:${button.getAttribute("aria-label") || button.textContent.trim()}:${rect.width}x${rect.height}`);
  });

  app.querySelectorAll(".centered-action").forEach((button) => {
    const label = button.querySelector(".action-label");
    if (!label) return;
    const buttonRect = button.getBoundingClientRect();
    const labelRect = label.getBoundingClientRect();
    const xDelta = Math.abs((buttonRect.left + buttonRect.width / 2) - (labelRect.left + labelRect.width / 2));
    const yDelta = Math.abs((buttonRect.top + buttonRect.height / 2) - (labelRect.top + labelRect.height / 2));
    if (xDelta > 1 || yDelta > 1) issues.push(`button-centering:${button.textContent.trim()}:${xDelta.toFixed(1)},${yDelta.toFixed(1)}`);
  });

  app.querySelectorAll(".status-badge,.status-description").forEach((node) => {
    const style = getComputedStyle(node);
    const background = style.backgroundColor === "rgba(0, 0, 0, 0)"
      ? getComputedStyle(node.parentElement.closest(".order-card")).backgroundColor
      : style.backgroundColor;
    const ratio = contrast(style.color, background);
    if (ratio < 4.5) issues.push(`contrast:${node.textContent.trim()}:${ratio.toFixed(2)}`);
  });

  if (currentState === "map-entry") {
    const longLabel = app.querySelector(".map-center-value");
    if (longLabel.scrollWidth <= longLabel.clientWidth) issues.push("long-label:not-truncated");
    if (getComputedStyle(longLabel).textOverflow !== "ellipsis") issues.push("long-label:no-ellipsis");
  }

  if (currentState === "ready") {
    const rightEdges = [...app.querySelectorAll(".order-amount")].map((node) => node.getBoundingClientRect().right);
    if (Math.max(...rightEdges) - Math.min(...rightEdges) > 1) issues.push("amounts:not-aligned");
    const chevrons = [...app.querySelectorAll(".order-chevron")];
    if (chevrons.length !== MY_ORDERS.length || chevrons.some((node) => !node.querySelector("svg"))) issues.push("chevrons:missing");
    const content = app.querySelector(".orders-content");
    if (getComputedStyle(content).overflowY !== "auto") issues.push("scrolling:not-enabled");
    if (Number.parseFloat(getComputedStyle(content).paddingBottom) < 16) issues.push("safe-bottom:insufficient");
  }

  return issues;
};

render();
