import {
  DEFAULT_PROFILE_STATE, FACILITY_GROUPS, PROFILE_RULES, PROFILE_STATES, REJECTION_REASONS,
  countCodePoints, truncateCodePoints,
} from "./venue-profile-workbench-data.js";

const app = document.querySelector("#venue-profile-app");
const requestedState = new URLSearchParams(window.location.search).get("state");
let currentStateId = Object.hasOwn(PROFILE_STATES, requestedState) ? requestedState : DEFAULT_PROFILE_STATE;
let liveDescription = "";
let liveFacilities = new Set();
let auditMessage = "本地 Artifact：所有操作仅切换参考状态，不会写入线上数据。";

const element = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const svgElement = (tag, attributes = {}) => {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, value));
  return node;
};

const icon = (kind) => {
  const svg = svgElement("svg", {
    viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "2",
    "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true",
  });
  const paths = {
    back: "m15 18-6-6 6-6",
    warning: "M12 9v4m0 4h.01M4.9 19h14.2a2 2 0 0 0 1.73-3L13.73 4a2 2 0 0 0-3.46 0L3.17 16a2 2 0 0 0 1.73 3Z",
  };
  svg.append(svgElement("path", { d: paths[kind] }));
  return svg;
};

const scene = (image) => {
  const wrapper = element("div", "image-scene");
  const svg = svgElement("svg", { viewBox: "0 0 320 180", role: "img", "aria-label": image.alt });
  const colors = {
    pitch: ["#CDEFFC", "#409A68"], sideline: ["#E3F4FB", "#357F5B"],
    service: ["#D7EAF3", "#D2B48C"], entry: ["#CFE8F3", "#507F67"],
  }[image.scene];
  svg.append(
    svgElement("rect", { width: "320", height: "100", fill: colors[0] }),
    svgElement("rect", { y: "100", width: "320", height: "80", fill: colors[1] }),
    svgElement("path", { d: "M0 132h320M160 100v80M118 100v34h84v-34", fill: "none", stroke: "#FFFFFF", "stroke-width": "3", opacity: ".86" }),
    svgElement("circle", { cx: "160", cy: "132", r: "23", fill: "none", stroke: "#FFFFFF", "stroke-width": "3", opacity: ".86" }),
    svgElement("path", { d: image.scene === "entry" ? "M38 104V64h62v40M47 104V77h44v27" : "M28 105V72h42v33M250 105V72h42v33", fill: "none", stroke: "#10243E", "stroke-width": "4", opacity: ".72" }),
  );
  wrapper.append(svg);
  return wrapper;
};

const actionButton = (config, className = "primary-action") => {
  const button = element("button", className, config.label);
  button.type = "button";
  button.disabled = Boolean(config.disabled);
  button.dataset.actionId = config.id;
  button.dataset.operation = config.operation;
  button.dataset.nextState = config.nextState;
  if (config.busy) button.setAttribute("aria-busy", "true");
  return button;
};

const resetLiveDraft = (state) => {
  liveDescription = state.profile?.description ?? "";
  liveFacilities = new Set(state.profile?.facilities ?? []);
};

const renderHeader = (state) => {
  const fragment = document.createDocumentFragment();
  const system = element("div", "system-row");
  system.append(element("span", "", "9:41"), element("span", "system-capsule"));
  const nav = element("header", "nav");
  nav.append(element("span", "nav-spacer"), element("h1", "", state.journey === "public" ? "场馆详情" : "场馆资料"), element("span", "nav-spacer"));
  fragment.append(system, nav);
  return fragment;
};

const renderStatus = (state) => {
  const card = element("section", `status-card status-card--${state.tone}`);
  const mark = element("span", "status-mark", state.tone === "error" ? "!" : "i");
  mark.setAttribute("aria-hidden", "true");
  const copy = element("div", "status-copy");
  copy.append(element("strong", "", state.status), element("span", "", state.statusDetail));
  card.append(mark, copy);
  return card;
};

const renderReasons = (state) => {
  if (!state.rejectionCodes.length) return null;
  const card = element("section", "card");
  card.append(element("h2", "field-label", "审核原因"));
  const list = element("ul", "reason-list");
  state.rejectionCodes.forEach((code) => {
    const reason = REJECTION_REASONS.find((item) => item.code === code);
    list.append(element("li", "", reason.label));
  });
  card.append(list);
  return card;
};

const imageControl = (config, imageId, danger = false) => {
  const button = actionButton(config, danger ? "danger" : "");
  button.dataset.imageId = imageId;
  return button;
};

const renderImages = (state) => {
  const card = element("section", "card");
  const heading = element("div", "section-heading");
  const copy = element("div");
  copy.append(element("h2", "", "场馆图片"), element("p", "", "1 张必选封面，最多 8 张；图片操作立即提交"));
  heading.append(copy, element("span", "count", `${state.profile.images.length} / ${PROFILE_RULES.maxImages}`));
  const grid = element("div", "image-grid");
  state.profile.images.forEach((image) => {
    const tile = element("article", `image-tile${image.cover ? " image-tile--cover" : ""}`);
    tile.append(scene(image));
    if (image.cover) tile.append(element("span", "image-label", "封面"));
    if (state.editable && state.imageActions && !image.cover) {
      const controls = element("div", "image-actions");
      controls.append(
        imageControl(state.imageActions.setCover, image.id),
        imageControl(state.imageActions.remove, image.id, true),
      );
      tile.append(controls);
    }
    grid.append(tile);
  });
  const add = state.actions.find(({ slot }) => slot === "images");
  if (add && state.profile.images.length < PROFILE_RULES.maxImages) {
    const button = actionButton(add, "add-image");
    button.replaceChildren(element("span", "add-mark"), element("span", "", add.label));
    grid.append(button);
  }
  card.append(heading, grid);
  return card;
};

const renderDescription = (state) => {
  const card = element("section", "card");
  const heading = element("div", "section-heading");
  heading.append(element("h2", "", "场馆介绍"), element("span", "count", "最多 300 字"));
  const label = element("label", "field-label", "介绍内容");
  label.htmlFor = "venue-description";
  const input = element("textarea", "description");
  input.id = "venue-description";
  input.value = liveDescription;
  input.disabled = !state.editable;
  input.setAttribute("aria-describedby", "description-help description-counter");
  const help = element("p", "field-help", "请勿填写联系方式、二维码、外链或站外交易信息。");
  help.id = "description-help";
  const counter = element("div", "counter", `${countCodePoints(liveDescription)} / ${PROFILE_RULES.descriptionMaxCodePoints}`);
  counter.id = "description-counter";
  card.append(heading, label, input, help, counter);
  return card;
};

const renderFacilities = (state) => {
  const card = element("section", "card");
  const heading = element("div", "section-heading");
  heading.append(element("h2", "", "场馆设施"), element("span", "count", `${liveFacilities.size} 项已选`));
  card.append(heading);
  FACILITY_GROUPS.forEach((group) => {
    const section = element("section", "facility-group");
    section.append(element("h3", "", group.title));
    const chips = element("div", "chips");
    group.items.forEach((item) => {
      const button = element("button", "chip", item.label);
      button.type = "button";
      button.disabled = !state.editable;
      button.dataset.facilityCode = item.code;
      button.dataset.operation = "EDIT_LOCAL_PROFILE";
      button.dataset.nextState = state.id;
      button.setAttribute("aria-pressed", String(liveFacilities.has(item.code)));
      chips.append(button);
    });
    section.append(chips);
    card.append(section);
  });
  return card;
};

const renderStateActions = (state) => {
  const actions = state.actions.filter(({ slot }) => slot !== "images");
  if (!actions.length) return null;
  const box = element("div", "state-actions");
  actions.forEach((item) => box.append(actionButton(item, item.secondary ? "secondary-action" : "primary-action")));
  return box;
};

const renderAdmin = (state, content) => {
  if (!state.profile) {
    const panel = element("section", "card error-panel");
    panel.append(icon("warning"), element("h2", "", "无法显示编辑内容"), element("p", "", "上一版公开资料不受影响"));
    const actions = renderStateActions(state);
    if (actions) panel.append(actions);
    content.append(panel);
    return;
  }
  content.append(renderImages(state), renderDescription(state), renderFacilities(state));
  const reasons = renderReasons(state);
  if (reasons) content.insertBefore(reasons, content.children[2]);
  const actions = renderStateActions(state);
  if (actions) content.append(actions);
};

const facilityLabel = (code) => FACILITY_GROUPS.flatMap(({ items }) => items).find((item) => item.code === code)?.label ?? code;

const renderPublic = (state, content) => {
  const galleryCard = element("section", "card");
  const gallery = element("div", "public-gallery");
  state.profile.images.forEach((image) => {
    const tile = element("figure", "image-tile");
    tile.setAttribute("aria-label", image.alt);
    tile.append(scene(image));
    gallery.append(tile);
  });
  galleryCard.append(gallery);
  const intro = element("section", "card");
  intro.append(element("h2", "field-label", "场馆介绍"), element("p", "public-copy", state.profile.description));
  const facilities = element("section", "card");
  facilities.append(element("h2", "field-label", "场馆设施"));
  const labels = element("div", "public-facilities");
  state.profile.facilities.forEach((code) => labels.append(element("span", "", facilityLabel(code))));
  facilities.append(labels);
  const price = element("section", "card public-price");
  price.append(element("span", "", "当前可订价格"), element("strong", "", state.profile.priceSummary));
  content.append(galleryCard, intro, facilities, price);
};

const renderFooter = (state) => {
  const footer = element("footer", "footer");
  const config = state.journey === "public" ? state.actions[0] : state.footerAction;
  footer.append(
    element("p", "", state.journey === "public" ? "价格与时段以可订列表为准" : "保存仅提交场馆介绍与设施，不包含图片操作"),
    actionButton(config),
  );
  return footer;
};

const render = () => {
  const state = PROFILE_STATES[currentStateId];
  app.replaceChildren(renderHeader(state));
  const content = element("div", "content");
  content.append(element("h2", "venue-heading", state.profile?.name ?? state.publicProfile.name), renderStatus(state));
  if (state.journey === "public") renderPublic(state, content);
  else renderAdmin(state, content);
  const audit = element("div", "audit", auditMessage);
  audit.setAttribute("role", "status");
  content.append(audit, element("p", "artifact-note", "参考页面 · Production disabled"));
  app.append(content, renderFooter(state));
};

const transition = (operation, nextState, detail = "") => {
  auditMessage = `参考操作 ${operation}${detail ? `（${detail}）` : ""} 已记录；本地 Artifact 未调用服务。`;
  if (Object.hasOwn(PROFILE_STATES, nextState)) {
    currentStateId = nextState;
    resetLiveDraft(PROFILE_STATES[currentStateId]);
    const url = new URL(window.location.href);
    url.searchParams.set("state", currentStateId);
    window.history.replaceState({}, "", url);
  }
  render();
};

app.addEventListener("click", (event) => {
  const facility = event.target.closest("button[data-facility-code]");
  if (facility && !facility.disabled) {
    const code = facility.dataset.facilityCode;
    if (liveFacilities.has(code)) liveFacilities.delete(code);
    else liveFacilities.add(code);
    auditMessage = `本地草稿已更新：${facilityLabel(code)}；尚未保存或发布。`;
    render();
    return;
  }
  const button = event.target.closest("button[data-operation]");
  if (!button || button.disabled) return;
  transition(button.dataset.operation, button.dataset.nextState, button.dataset.imageId ?? "");
});

app.addEventListener("input", (event) => {
  if (event.target.id !== "venue-description") return;
  liveDescription = truncateCodePoints(event.target.value, PROFILE_RULES.descriptionMaxCodePoints);
  if (event.target.value !== liveDescription) event.target.value = liveDescription;
  const counter = app.querySelector("#description-counter");
  counter.textContent = `${countCodePoints(liveDescription)} / ${PROFILE_RULES.descriptionMaxCodePoints}`;
  auditMessage = "本地介绍草稿已更新；尚未保存或发布。";
  app.querySelector(".audit").textContent = auditMessage;
});

resetLiveDraft(PROFILE_STATES[currentStateId]);
render();
