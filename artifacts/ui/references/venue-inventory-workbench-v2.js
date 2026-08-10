import {
  DATE_WINDOW, DEFAULT_INVENTORY_STATE, INVENTORY_STATES, PITCHES, VENUE,
} from "./venue-inventory-workbench-v2-data.js";

const app = document.querySelector("#inventory-app");
const requestedState = new URLSearchParams(window.location.search).get("state");
let currentStateId = Object.hasOwn(INVENTORY_STATES, requestedState) ? requestedState : DEFAULT_INVENTORY_STATE;
let renderedState = INVENTORY_STATES[currentStateId];
let liveDraft = null;

const element = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const iconPaths = {
  back: "m15 18-6-6 6-6",
  chevron: "m9 18 6-6-6-6",
  close: "m6 6 12 12M18 6 6 18",
};

const svgIcon = (kind) => {
  const box = element("span", "icon-box trailing-icon");
  box.setAttribute("aria-hidden", "true");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", iconPaths[kind]);
  svg.append(path);
  box.append(svg);
  return box;
};

const action = (label, className, options = {}) => {
  const button = element("button", className);
  button.type = "button";
  button.disabled = Boolean(options.disabled);
  if (options.nextState) button.dataset.nextState = options.nextState;
  const text = element("span", "action-label", label);
  button.append(text);
  return button;
};

const dateLabel = (iso) => {
  if (!iso) return "日期待加载";
  const date = new Date(`${iso}T00:00:00Z`);
  const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  return `${date.getUTCMonth() + 1}月${date.getUTCDate()}日 ${weekdays[date.getUTCDay()]}`;
};

const renderHeader = () => {
  const fragment = document.createDocumentFragment();
  const system = element("div", "system-row safe-area-top");
  system.append(element("span", "status-time type-caption", "9:41"), element("span", "capsule-safe"));
  const header = element("header", "inventory-header");
  const back = element("button", "sheet-close touch-target");
  back.type = "button";
  back.dataset.historyBack = "true";
  back.setAttribute("aria-label", "返回");
  back.append(svgIcon("back"));
  const identity = element("div", "inventory-header__identity");
  identity.append(
    element("h1", "", VENUE.name),
    element("p", "type-caption muted", "库存工作台 · 仅授权工作人员"),
  );
  header.append(back, identity, element("span", "touch-target"));
  fragment.append(system, header);
  return fragment;
};

const renderWeek = (state) => {
  const week = element("div", "week-strip");
  week.setAttribute("role", "group");
  week.setAttribute("aria-label", "当前自然周");
  state.week.forEach((day) => {
    const button = element("button", "week-day touch-target");
    button.type = "button";
    button.dataset.date = day.iso;
    button.setAttribute("aria-pressed", String(day.iso === state.selectedDate));
    button.setAttribute("aria-label", dateLabel(day.iso));
    button.append(element("span", "", day.weekday.replace("周", "")), element("strong", "", String(day.day)));
    week.append(button);
  });
  return week;
};

const renderContext = (state, shell) => {
  const month = element("div", "month-row");
  month.append(element("h2", "", "2026年8月"), action("更多日期", "text-action touch-target", { nextState: "calendar-open" }));
  const pitch = element("button", "current-pitch touch-target");
  pitch.type = "button";
  pitch.dataset.nextState = "pitch-picker-open";
  pitch.setAttribute("aria-current", "true");
  const pitchCopy = element("span", "current-pitch__copy");
  pitchCopy.append(
    element("span", "type-caption muted", "当前场地"),
    element("span", "type-body", `${state.selectedPitch.display_name} · ${state.selectedPitch.players_per_side}人制`),
  );
  pitch.append(pitchCopy, svgIcon("chevron"));
  const summary = element("div", "inventory-summary");
  summary.append(
    element("strong", "", dateLabel(state.selectedDate)),
    element("span", "type-caption muted", state.slotCount === null ? "正在读取" : `${state.slotCount} 个时段`),
  );
  shell.append(month, renderWeek(state), pitch, summary);
};

const renderSlot = (slot, state) => {
  const writeDisabled = Boolean(state.writeControlsDisabled);
  const interactive = slot.editable && !writeDisabled;
  const row = element(slot.editable ? "button" : "article", `slot-row touch-target${interactive ? "" : " slot-row--readonly"}`);
  if (slot.editable) {
    row.type = "button";
    row.disabled = writeDisabled;
  }
  if (interactive) row.dataset.nextState = "edit-slot-open";
  row.dataset.slotId = slot.id;
  row.setAttribute("aria-label", `${slot.start}到${slot.end}，${slot.statusLabel}${slot.editable ? "，可编辑" : "，只读"}`);
  const copy = element("span", "slot-main");
  copy.append(
    element("strong", "", `${slot.start}–${slot.end} · ¥${slot.price}`),
    element("span", "", writeDisabled && slot.editable ? "权限已失效 · 不可修改" : slot.detail),
  );
  row.append(copy, element("span", `status-badge status-${slot.status.toLowerCase()}`, slot.statusLabel));
  if (interactive) row.append(svgIcon("chevron"));
  return row;
};

const renderList = (state) => {
  const list = element("section", "slot-list");
  list.setAttribute("aria-label", "当日时段列表");
  if (["partial-loading", "partial-error", "empty"].includes(state.mode)) {
    const panel = element("section", `state-panel state-panel--${state.mode}`);
    if (state.mode === "partial-loading") panel.append(element("span", "loading-mark"));
    panel.append(element("p", "type-body", state.statusMessage));
    if (state.mode === "partial-error") {
      panel.append(action(state.recoveryLabel, "secondary-action", { nextState: state.recoveryNextState }));
    }
    list.append(panel);
  } else {
    if (state.statusMessage) list.append(element("div", "status-callout", state.statusMessage));
    state.slots.forEach((slot) => list.append(renderSlot(slot, state)));
  }
  return list;
};

const sheetHeading = (title, subtitle, closeDisabled, cancelNextState) => {
  const heading = element("div", "sheet-heading");
  const copy = element("div", "sheet-heading__copy");
  copy.append(element("h2", "type-title", title));
  if (subtitle) copy.append(element("p", "type-caption muted", subtitle));
  const close = element("button", "sheet-close touch-target");
  close.type = "button";
  close.disabled = Boolean(closeDisabled);
  close.dataset.nextState = cancelNextState;
  close.setAttribute("aria-label", "关闭面板");
  close.append(svgIcon("close"));
  heading.append(copy, close);
  return heading;
};

const renderPitchPicker = (sheet) => {
  const content = document.createDocumentFragment();
  content.append(sheetHeading(sheet.title, "只显示使用中的物理场地", false, sheet.cancelNextState));
  const groups = element("div", "picker-groups");
  sheet.groups.forEach((group) => {
    const section = element("section", "picker-group");
    section.append(element("h3", "", `${group.players_per_side}人制`));
    group.pitches.forEach((pitch) => {
      const button = element("button", "picker-option touch-target");
      button.type = "button";
      button.dataset.pitchId = pitch.id;
      button.dataset.pickerPitch = "true";
      button.setAttribute("aria-pressed", String(pitch.id === sheet.selectedPitchId));
      button.append(
        element("span", "", `${pitch.display_name} · ${pitch.players_per_side}人制`),
        element("span", "type-caption muted", pitch.id === sheet.selectedPitchId ? "当前" : `第 ${pitch.sequence} 块`),
      );
      section.append(button);
    });
    groups.append(section);
  });
  content.append(groups);
  return content;
};

const renderCalendar = (sheet) => {
  const content = document.createDocumentFragment();
  content.append(sheetHeading(sheet.title, sheet.subtitle, false, sheet.cancelNextState));
  const weekdays = element("div", "calendar-weekdays");
  ["一", "二", "三", "四", "五", "六", "日"].forEach((day) => weekdays.append(element("span", "", day)));
  const grid = element("div", "calendar-grid");
  sheet.days.forEach((day) => {
    const button = element("button", "calendar-day touch-target", String(day.day));
    button.type = "button";
    button.disabled = !day.manageable;
    button.tabIndex = day.manageable ? 0 : -1;
    if (day.manageable) button.dataset.date = day.iso;
    button.setAttribute("aria-pressed", String(day.selected));
    button.setAttribute("aria-label", `${dateLabel(day.iso)}${day.manageable ? "" : "，不可管理"}`);
    grid.append(button);
  });
  const pending = element("div", "calendar-pending");
  pending.append(element("span", "type-caption muted", "待确认日期"), element("strong", "type-body", sheet.pendingLabel));
  const confirm = action(sheet.confirmLabel, "primary-action type-cta");
  confirm.dataset.confirmDate = sheet.pendingDate;
  const fixed = element("div", "sheet-fixed-action");
  fixed.append(confirm);
  content.append(weekdays, grid, pending, fixed);
  return content;
};

const editorField = (label, id, value, options = {}) => {
  const field = element("div", "editor-field");
  const fieldLabel = element("label", "", label);
  fieldLabel.htmlFor = id;
  const input = element("input", "");
  input.id = id;
  input.value = value;
  input.inputMode = options.inputMode ?? "text";
  input.readOnly = Boolean(options.readOnly);
  input.dataset.draftField = options.draftField;
  field.append(fieldLabel, input);
  return field;
};

const renderEditor = (editor, statusMessage) => {
  const content = document.createDocumentFragment();
  content.append(sheetHeading(editor.title, statusMessage, editor.closeDisabled, editor.cancelNextState));
  const chips = element("div", "context-chips");
  editor.contextChips.forEach((chip) => chips.append(element("span", "context-chip", chip)));
  const fields = element("div", "editor-fields");
  fields.append(
    editorField("开始时间", "slot-start", editor.draft.start, { readOnly: editor.timeReadOnly, draftField: "start" }),
    editorField("结束时间", "slot-end", editor.draft.end, { readOnly: editor.timeReadOnly, draftField: "end" }),
    editorField("价格（元）", "slot-price", editor.draft.price, { inputMode: "decimal", draftField: "price" }),
  );
  if (editor.inlineError) {
    const conflict = element("div", "conflict-copy");
    conflict.append(element("strong", "field-error", editor.inlineError), element("div", "type-caption muted", `冲突时段 ${editor.conflictingTime}`));
    fields.append(conflict);
  }
  if (editor.reviewCopy) fields.append(element("div", "review-copy type-body", editor.reviewCopy));
  const actions = element("div", "sheet-actions");
  actions.append(
    action("取消", "secondary-action", { disabled: editor.closeDisabled, nextState: editor.cancelNextState }),
    action(editor.saveLabel, "primary-action", { disabled: editor.saveDisabled, nextState: editor.saveNextState }),
  );
  content.append(chips, fields, actions);
  return content;
};

const renderOverlay = (state) => {
  const overlay = state.sheet ?? state.editor;
  const fragment = document.createDocumentFragment();
  fragment.append(element("div", "sheet-scrim"));
  const sheet = element("section", "sheet inventory-sheet");
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  sheet.append(element("span", "sheet-handle"));
  if (overlay.kind === "pitch-picker") sheet.append(renderPitchPicker(overlay));
  if (overlay.kind === "calendar") sheet.append(renderCalendar(overlay));
  if (overlay.kind === "slot-editor") sheet.append(renderEditor(overlay, state.statusMessage));
  fragment.append(sheet);
  return fragment;
};

const render = (stateId, stateOverride) => {
  currentStateId = Object.hasOwn(INVENTORY_STATES, stateId) ? stateId : DEFAULT_INVENTORY_STATE;
  const state = stateOverride ?? INVENTORY_STATES[currentStateId];
  renderedState = state;
  if (state.editor) liveDraft = { ...state.editor.draft };
  app.dataset.state = currentStateId;
  app.replaceChildren(renderHeader());
  const shell = element("section", "inventory-shell");
  if (["initial-loading", "load-error"].includes(state.mode)) {
    const panel = element("section", "state-panel state-panel--initial");
    if (state.mode === "initial-loading") panel.append(element("span", "loading-mark"));
    panel.append(element("p", "type-body", state.statusMessage));
    if (state.mode === "load-error") panel.append(action(state.recoveryLabel, "secondary-action", { nextState: state.recoveryNextState }));
    shell.append(panel);
  } else {
    renderContext(state, shell);
    shell.append(renderList(state));
  }
  const footer = element("footer", "fixed-action inventory-action safe-area-bottom");
  const add = action(state.pageAction.label, "primary-action type-cta", {
    disabled: state.pageAction.disabled,
    nextState: state.pageAction.nextState,
  });
  add.dataset.inventoryWrite = "true";
  footer.append(add);
  app.append(shell, footer);
  if (state.sheet || state.editor) app.append(renderOverlay(state));
  const list = app.querySelector(".slot-list");
  if (state.initializeAtEnd && list) requestAnimationFrame(() => { list.scrollTop = list.scrollHeight; });
};

const weekForDate = (iso) => iso >= "2026-08-17"
  ? INVENTORY_STATES["cross-week-ready"].week
  : INVENTORY_STATES["day-ready"].week;

app.addEventListener("input", (event) => {
  if (event.target.dataset.draftField && liveDraft) liveDraft[event.target.dataset.draftField] = event.target.value;
});

app.addEventListener("click", (event) => {
  const control = event.target.closest("[data-history-back], [data-next-state], [data-pitch-id], [data-date], [data-confirm-date]");
  if (!control || control.disabled) return;
  if (control.dataset.historyBack) {
    window.history.back();
    return;
  }
  if (control.dataset.pitchId) {
    const selectedPitch = PITCHES.find(({ id }) => id === control.dataset.pitchId);
    const target = INVENTORY_STATES["pitch-refreshing"];
    render("pitch-refreshing", {
      ...target, selectedPitch, selectedDate: renderedState.selectedDate, week: renderedState.week,
      preservedDate: renderedState.selectedDate, request_sequence: renderedState.request_sequence + 1,
    });
    window.history.replaceState(null, "", "?state=pitch-refreshing");
    return;
  }
  if (control.dataset.date) {
    const iso = control.dataset.date;
    if (currentStateId === "calendar-open") {
      const sheet = renderedState.sheet;
      render("calendar-open", {
        ...renderedState,
        sheet: {
          ...sheet, pendingDate: iso, pendingLabel: dateLabel(iso),
          days: sheet.days.map((day) => ({ ...day, selected: day.iso === iso })),
        },
      });
    } else {
      const target = INVENTORY_STATES["date-refreshing"];
      render("date-refreshing", {
        ...target, selectedDate: iso, selectedPitch: renderedState.selectedPitch, week: weekForDate(iso),
        preservedPitchId: renderedState.selectedPitch.id, request_sequence: renderedState.request_sequence + 1,
      });
      window.history.replaceState(null, "", "?state=date-refreshing");
    }
    return;
  }
  if (control.dataset.confirmDate) {
    const iso = control.dataset.confirmDate;
    const target = INVENTORY_STATES["date-refreshing"];
    render("date-refreshing", {
      ...target, selectedDate: iso, selectedPitch: renderedState.selectedPitch, week: weekForDate(iso),
      preservedPitchId: renderedState.selectedPitch.id, request_sequence: renderedState.request_sequence + 1,
    });
    window.history.replaceState(null, "", "?state=date-refreshing");
    return;
  }
  const nextState = control.dataset.nextState;
  if (nextState === "pitch-picker-open") {
    const target = INVENTORY_STATES[nextState];
    render(nextState, {
      ...target, selectedPitch: renderedState.selectedPitch, selectedDate: renderedState.selectedDate, week: renderedState.week,
      sheet: { ...target.sheet, selectedPitchId: renderedState.selectedPitch.id, cancelNextState: currentStateId },
    });
  } else if (nextState === "calendar-open") {
    const target = INVENTORY_STATES[nextState];
    const iso = renderedState.selectedDate;
    render(nextState, {
      ...target, selectedPitch: renderedState.selectedPitch, selectedDate: iso, week: renderedState.week,
      sheet: {
        ...target.sheet, pendingDate: iso, pendingLabel: dateLabel(iso), cancelNextState: currentStateId,
        days: target.sheet.days.map((day) => ({ ...day, selected: day.iso === iso })),
      },
    });
  } else if (nextState === "save-in-progress" && liveDraft) {
    const target = INVENTORY_STATES[nextState];
    render(nextState, { ...target, editor: { ...target.editor, draft: { ...liveDraft } } });
  } else {
    render(nextState);
  }
  window.history.replaceState(null, "", `?state=${nextState}`);
});

render(currentStateId);

const overlaps = (start, end, clipStart, clipEnd) => end > clipStart && start < clipEnd;
const intersects = (first, second) => overlaps(first.left, first.right, second.left, second.right)
  && overlaps(first.top, first.bottom, second.top, second.bottom);
const isVisible = (node) => {
  const style = window.getComputedStyle(node);
  if (style.display === "none" || style.visibility === "hidden" || node.getClientRects().length === 0) return false;
  const rect = node.getBoundingClientRect();
  if (!intersects(rect, app.getBoundingClientRect())) return false;
  for (let ancestor = node.parentElement; ancestor && ancestor !== app; ancestor = ancestor.parentElement) {
    const ancestorStyle = window.getComputedStyle(ancestor);
    const bounds = ancestor.getBoundingClientRect();
    const clipsX = /^(?:auto|scroll|hidden|clip)$/.test(ancestorStyle.overflowX);
    const clipsY = /^(?:auto|scroll|hidden|clip)$/.test(ancestorStyle.overflowY);
    if ((clipsX && !overlaps(rect.left, rect.right, bounds.left, bounds.right))
      || (clipsY && !overlaps(rect.top, rect.bottom, bounds.top, bounds.bottom))) return false;
  }
  return true;
};
const isContained = (inner, outer, tolerance = 0.5) => inner.left >= outer.left - tolerance
  && inner.right <= outer.right + tolerance && inner.top >= outer.top - tolerance && inner.bottom <= outer.bottom + tolerance;

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
  if (!fixedAction || !isVisible(fixedAction) || !isContained(fixedAction.getBoundingClientRect(), canvas)) violations.push("fixed-action-outside-canvas");
  app.querySelectorAll(".primary-action").forEach((button) => {
    if (!isVisible(button)) return;
    const label = button.querySelector(".action-label");
    if (!label) return;
    const outer = button.getBoundingClientRect();
    const inner = label.getBoundingClientRect();
    if (Math.abs((outer.left + outer.right - inner.left - inner.right) / 2) > 1
      || Math.abs((outer.top + outer.bottom - inner.top - inner.bottom) / 2) > 1) violations.push("primary-label-off-center");
  });
  app.querySelectorAll(".icon-box").forEach((icon) => {
    if (!isVisible(icon)) return;
    const control = icon.closest("button, a, [role='button']");
    if (!control || !isContained(icon.getBoundingClientRect(), control.getBoundingClientRect())) violations.push("icon-box-outside-control");
    if (!isContained(icon.getBoundingClientRect(), canvas)) violations.push("icon-outside-canvas");
  });
  const dialogs = [...app.querySelectorAll("[role='dialog']")].filter(isVisible);
  if (dialogs.length > 1) violations.push("too-many-visible-dialogs");
  app.querySelectorAll(".sheet").forEach((sheet) => {
    if (isVisible(sheet) && !isContained(sheet.getBoundingClientRect(), canvas)) violations.push("sheet-outside-canvas");
  });
  const list = app.querySelector(".slot-list");
  if (list && fixedAction) {
    const padding = Number.parseFloat(window.getComputedStyle(list).paddingBottom);
    if (padding < fixedAction.getBoundingClientRect().height) violations.push("list-bottom-padding-too-small");
    if (renderedState.slots.length >= 5 && list.scrollHeight <= list.clientHeight) violations.push("slot-list-not-independent");
  }
  if (app.querySelector(".inventory-header")?.textContent.includes("新增时段")) violations.push("header-cta-present");
  const currentPitchCount = app.querySelectorAll(".current-pitch[aria-current='true']").length;
  const pickerSelected = app.querySelectorAll("[data-picker-pitch][aria-pressed='true']").length;
  if (renderedState.selectedPitch && (currentPitchCount !== 1 || (dialogs.length && renderedState.sheet?.kind === "pitch-picker" && pickerSelected !== 1))) violations.push("selected-pitch-count");
  app.querySelectorAll(".calendar-day:disabled").forEach((day) => {
    if (day.tabIndex >= 0 || day.dataset.date) violations.push("disabled-date-focusable");
  });
  if (renderedState.selectedDate && (renderedState.selectedDate < DATE_WINDOW.start || renderedState.selectedDate > DATE_WINDOW.end)) violations.push("selected-date-outside-window");
  const pickerOrder = [...app.querySelectorAll("[data-picker-pitch]")].map(({ dataset }) => dataset.pitchId);
  if (pickerOrder.length && pickerOrder.join() !== PITCHES.map(({ id }) => id).join()) violations.push("picker-order-mismatch");
  if (renderedState.preservedDate && renderedState.selectedDate !== renderedState.preservedDate) violations.push("pitch-switch-date-not-preserved");
  if (renderedState.preservedPitchId && renderedState.selectedPitch.id !== renderedState.preservedPitchId) violations.push("date-switch-pitch-not-preserved");
  if (fixedAction) {
    const button = fixedAction.querySelector(".primary-action");
    const outer = fixedAction.getBoundingClientRect();
    const inner = button?.getBoundingClientRect();
    if (!inner || Math.abs((outer.left + outer.right - inner.left - inner.right) / 2) > 1) violations.push("fixed-action-not-centered");
  }
  if (currentStateId === "long-list-end" && list && fixedAction) {
    const final = list.querySelector(".slot-row:last-child");
    if (!final || final.getBoundingClientRect().bottom > fixedAction.getBoundingClientRect().top + 0.5) violations.push("long-list-final-row-obscured");
  }
  return violations;
};
