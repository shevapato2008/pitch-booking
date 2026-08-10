import { DEFAULT_SETUP_STATE, SETUP_STATES, VENUE } from "./venue-pitch-setup-data.js";

const app = document.querySelector("#setup-app");
const requestedState = new URLSearchParams(window.location.search).get("state");
let currentStateId = Object.hasOwn(SETUP_STATES, requestedState) ? requestedState : DEFAULT_SETUP_STATE;
let renderedState = SETUP_STATES[currentStateId];

const element = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const svgIcon = (kind) => {
  const box = element("span", "icon-box");
  box.setAttribute("aria-hidden", "true");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", kind === "back" ? "m15 18-6-6 6-6" : "m9 18 6-6-6-6");
  svg.append(path);
  box.append(svg);
  return box;
};

const action = (label, className, options = {}) => {
  const button = element("button", className);
  button.type = "button";
  button.disabled = Boolean(options.disabled);
  if (options.nextState) button.dataset.nextState = options.nextState;
  if (options.href) button.dataset.href = options.href;
  const text = element("span", "action-label", label);
  button.append(text);
  return button;
};

const renderHeader = () => {
  const fragment = document.createDocumentFragment();
  const system = element("div", "system-row safe-area-top");
  system.append(element("span", "status-time type-caption", "9:41"), element("span", "capsule-safe"));
  const header = element("header", "setup-header");
  const back = element("button", "sheet-close touch-target");
  back.type = "button";
  back.setAttribute("aria-label", "返回");
  back.append(svgIcon("back"));
  const identity = element("div", "setup-header__identity");
  identity.append(element("h1", "", "配置物理场地"), element("p", "type-caption muted", VENUE.name));
  header.append(back, identity, element("span", "touch-target"));
  fragment.append(system, header);
  return fragment;
};

const renderPitchCard = (pitch, state) => {
  const nextState = state.cardNextStates?.[pitch.id]
    ?? (state.id === "inactive-only" ? state.recoveryNextState : null);
  const card = element(nextState ? "button" : "article", "pitch-card touch-target");
  if (nextState) {
    card.type = "button";
    card.dataset.nextState = nextState;
  }
  card.dataset.pitchId = pitch.id ?? pitch.client_ref;
  const copy = element("span", "pitch-card__copy");
  const source = pitch.name_source ?? (pitch.custom_name ? "自定义名称" : "系统生成名称");
  const status = pitch.draft_status ?? (pitch.status === "INACTIVE" ? "INACTIVE · 已停用" : "ACTIVE · 使用中");
  copy.append(
    element("span", "pitch-card__title", pitch.display_name),
    element("span", "pitch-card__meta muted", `${source} · ${pitch.players_per_side}人制`),
    element("span", "pitch-card__status", status),
  );
  card.append(copy);
  if (nextState) card.append(svgIcon("chevron"));
  return card;
};

const renderStateBody = (state, list) => {
  if (state.mode === "loading" || state.mode === "error" || state.mode === "empty") {
    const panel = element("section", `state-panel state-panel--${state.mode}`);
    if (state.mode === "loading") panel.append(element("span", "loading-mark"));
    panel.append(element("p", "type-body", state.statusMessage));
    if (state.mode === "error") panel.append(action(state.recoveryLabel, "secondary-action", { nextState: state.recoveryNextState }));
    list.append(panel);
  } else {
    state.pitches.forEach((pitch) => list.append(renderPitchCard(pitch, state)));
  }
  if (state.id === "inactive-only") {
    const recovery = element("div", "recovery-row");
    recovery.append(action(state.recoveryLabel, "secondary-action", { nextState: state.recoveryNextState }));
    list.append(recovery);
  }
  if (state.mode !== "loading" && state.mode !== "error") {
    list.append(action("添加一块场地", "add-pitch touch-target", { nextState: "add-first-open" }));
  }
};

const renderEditor = (editor) => {
  const fragment = document.createDocumentFragment();
  fragment.append(element("div", "sheet-scrim"));
  const sheet = element("section", "sheet");
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  sheet.setAttribute("aria-labelledby", "editor-title");
  sheet.append(element("span", "sheet-handle"));

  const heading = element("div", "sheet-heading");
  const headingCopy = element("div");
  const title = element("h2", "type-title", editor.title);
  title.id = "editor-title";
  headingCopy.append(title);
  if (editor.kind !== "unsaved-leave") headingCopy.append(element("p", "type-caption muted", "完成只会写入当前页面草稿"));
  const close = element("button", "sheet-close");
  close.type = "button";
  close.setAttribute("aria-label", "关闭编辑面板");
  close.dataset.nextState = editor.kind === "unsaved-leave" ? editor.cancelNextState : "six-pitch-list";
  close.append(svgIcon("back"));
  heading.append(headingCopy, close);

  if (editor.kind === "unsaved-leave") {
    const message = element("p", "type-body", editor.message);
    const dialogActions = element("div", "sheet-actions");
    dialogActions.append(
      action(editor.cancelLabel, "secondary-action", { nextState: editor.cancelNextState }),
      action(editor.confirmLabel, "primary-action", { href: editor.confirmHref }),
    );
    sheet.append(heading, message, dialogActions);
    fragment.append(sheet);
    return fragment;
  }

  const fields = element("div", "editor-fields");
  const nameField = element("div", "editor-field");
  const nameLabel = element("label", "", "场地名称（可选）");
  nameLabel.htmlFor = "pitch-name";
  const nameInput = element("input", "text-input");
  nameInput.id = "pitch-name";
  nameInput.value = editor.nameValue;
  nameInput.autocomplete = "off";
  nameField.append(nameLabel, nameInput);
  if (editor.fieldError) nameField.append(element("span", "field-error", editor.fieldError));

  const formatField = element("fieldset", "editor-field");
  const legend = element("legend", "editor-legend", "场地制式");
  const options = element("div", "format-options");
  ["5人制", "7人制", "8人制", "11人制", "其他"].forEach((label) => {
    const format = label === "其他" ? label : Number.parseInt(label, 10);
    const option = action(label, "format-option", { disabled: !editor.formatEditable });
    option.setAttribute("aria-pressed", String(editor.selectedFormat === format));
    option.setAttribute("aria-disabled", String(!editor.formatEditable));
    options.append(option);
  });
  formatField.append(legend, options);
  if (editor.formatReason) formatField.append(element("span", "type-caption muted", editor.formatReason));

  fields.append(nameField, formatField);
  if (editor.customInput) {
    const customField = element("div", "editor-field");
    const customLabel = element("label", "", "每队人数");
    customLabel.htmlFor = "players-per-side";
    const numberRow = element("div", "custom-number-row");
    const numberInput = element("input", "numeric-input");
    numberInput.id = "players-per-side";
    numberInput.type = "number";
    numberInput.inputMode = "numeric";
    numberInput.min = "1";
    numberInput.max = "99";
    numberInput.value = String(editor.playersPerSide);
    numberRow.append(numberInput, element("span", "type-body", "人制"));
    customField.append(customLabel, numberRow, element("span", "type-caption muted", editor.preview));
    fields.append(customField);
  }

  if (editor.lifecycleAction) {
    const lifecycle = action(editor.lifecycleAction.label, "secondary-action", {
      disabled: editor.lifecycleAction.disabled,
      nextState: editor.lifecycleAction.nextState,
    });
    fields.append(lifecycle);
  }
  if (editor.futureBlockers) {
    fields.append(element("p", "field-error", editor.blockerMessage));
    const blockers = element("div", "blocker-grid");
    Object.entries(editor.futureBlockers).forEach(([status, count]) => {
      const item = element("span", "type-caption");
      item.append(element("strong", "", status), document.createTextNode(` ${count}`));
      blockers.append(item);
    });
    fields.append(blockers);
  }
  if (editor.confirmation) {
    const confirmation = element("section", "confirmation-region");
    confirmation.setAttribute("aria-label", editor.confirmation.title);
    confirmation.append(
      element("strong", "type-body", editor.confirmation.title),
      element("span", "type-caption muted", editor.confirmation.message),
      action(editor.confirmation.confirmLabel, "secondary-action", { nextState: editor.confirmation.nextState }),
    );
    fields.append(confirmation);
  }
  const sheetActions = element("div", "sheet-actions");
  sheetActions.append(
    action("取消", "secondary-action", { nextState: "six-pitch-list" }),
    action(editor.completeLabel, "primary-action", { nextState: editor.completeNextState }),
  );
  sheet.append(heading, fields, sheetActions);
  fragment.append(sheet);
  return fragment;
};

const render = (stateId, stateOverride) => {
  currentStateId = Object.hasOwn(SETUP_STATES, stateId) ? stateId : DEFAULT_SETUP_STATE;
  const state = stateOverride ?? SETUP_STATES[currentStateId];
  renderedState = state;
  app.dataset.state = currentStateId;
  app.replaceChildren(renderHeader());

  const screen = element("section", "setup-screen");
  screen.append(element("div", "status-callout setup-callout", "每块可独立预订的场地都需要单独配置"));
  const summary = element("div", "configured-summary");
  summary.append(
    element("strong", "", state.configuredCount === null ? "场地配置" : `已配置 ${state.configuredCount} 块`),
    element("span", "type-caption muted", "按制式与序号排序"),
  );
  const list = element("section", "pitch-list");
  list.setAttribute("aria-label", "物理场地列表");
  if (state.statusMessage && !["loading", "error", "empty"].includes(state.mode)) {
    list.append(element("div", "status-callout draft-banner", state.statusMessage));
  }
  renderStateBody(state, list);
  screen.append(summary, list);

  const footer = element("footer", "fixed-action page-action safe-area-bottom");
  const save = action(state.pageAction.label, "primary-action type-cta", {
    disabled: state.pageAction.disabled,
    nextState: state.pageAction.nextState,
    href: state.pageAction.href,
  });
  save.dataset.saveAction = "true";
  footer.append(save);
  app.append(screen, footer);
  const overlay = state.editor ?? state.dialog;
  if (overlay) app.append(renderEditor(overlay));
};

app.addEventListener("click", (event) => {
  const control = event.target.closest("[data-next-state], [data-href]");
  if (!control || control.disabled) return;
  if (control.dataset.href) {
    window.location.assign(control.dataset.href);
    return;
  }
  const nextState = control.dataset.nextState;
  window.history.replaceState(null, "", `?state=${nextState}`);
  if (nextState === "save-in-progress") {
    render(nextState, { ...SETUP_STATES[nextState], configuredCount: renderedState.configuredCount, pitches: renderedState.pitches });
    return;
  }
  render(nextState);
});

render(currentStateId);

const isVisible = (node) => {
  const style = window.getComputedStyle(node);
  return style.display !== "none" && style.visibility !== "hidden" && node.getClientRects().length > 0;
};

const isContained = (inner, outer, tolerance = 0.5) => inner.left >= outer.left - tolerance
  && inner.right <= outer.right + tolerance
  && inner.top >= outer.top - tolerance
  && inner.bottom <= outer.bottom + tolerance;

window.__artifactAudit__ = () => {
  const violations = [];
  const canvas = app.getBoundingClientRect();
  if (Math.abs(canvas.width - 375) > 0.5 || Math.abs(canvas.height - 812) > 0.5) violations.push("canvas-size");
  if (document.documentElement.scrollWidth > document.documentElement.clientWidth) violations.push("document-horizontal-overflow");
  if (app.scrollWidth > app.clientWidth) violations.push("canvas-horizontal-overflow");

  app.querySelectorAll("button, input, select, textarea, a[href], [role='button']").forEach((control) => {
    if (!isVisible(control)) return;
    const rect = control.getBoundingClientRect();
    if (rect.width < 44 || rect.height < 44) violations.push(`touch-target-too-small:${control.id || control.className}`);
  });

  const fixedAction = app.querySelector(".fixed-action");
  if (fixedAction && isVisible(fixedAction) && !isContained(fixedAction.getBoundingClientRect(), canvas)) {
    violations.push("fixed-action-outside-canvas");
  }
  app.querySelectorAll(".primary-action").forEach((button) => {
    if (!isVisible(button)) return;
    const label = button.querySelector(".action-label");
    if (!label) return;
    const buttonRect = button.getBoundingClientRect();
    const labelRect = label.getBoundingClientRect();
    const xDelta = Math.abs((buttonRect.left + buttonRect.right - labelRect.left - labelRect.right) / 2);
    const yDelta = Math.abs((buttonRect.top + buttonRect.bottom - labelRect.top - labelRect.bottom) / 2);
    if (xDelta > 1 || yDelta > 1) violations.push("primary-label-off-center");
  });

  app.querySelectorAll(".icon-box").forEach((icon) => {
    if (!isVisible(icon)) return;
    const control = icon.closest("button, a, [role='button']");
    if (!control || !isContained(icon.getBoundingClientRect(), control.getBoundingClientRect())) {
      violations.push("icon-box-outside-control");
    }
  });

  const visibleDialogs = [...app.querySelectorAll("[role='dialog']")].filter(isVisible);
  if (visibleDialogs.length > 1) violations.push("too-many-visible-dialogs");
  app.querySelectorAll(".sheet").forEach((sheet) => {
    if (isVisible(sheet) && !isContained(sheet.getBoundingClientRect(), canvas)) violations.push("sheet-outside-canvas");
  });

  const list = app.querySelector(".pitch-list");
  if (list && fixedAction) {
    const bottomPadding = Number.parseFloat(window.getComputedStyle(list).paddingBottom);
    if (bottomPadding < fixedAction.getBoundingClientRect().height) violations.push("list-bottom-padding-too-small");
  }

  const customInput = app.querySelector("#players-per-side");
  if ((currentStateId === "edit-custom-open") !== Boolean(customInput)) violations.push("custom-input-state-rule");
  if (currentStateId === "inactive-only") {
    const inactivePitch = app.querySelector("[data-pitch-id='pitch-7-004']");
    if (!inactivePitch || !inactivePitch.textContent.includes("INACTIVE")) violations.push("inactive-only-missing-inactive-pitch");
  }
  if (["save-in-progress", "save-result-unknown"].includes(currentStateId)) {
    const saveActions = [...app.querySelectorAll("[data-save-action]")];
    if (saveActions.some((button) => !button.disabled)) violations.push("duplicate-save-enabled");
  }
  return violations;
};
