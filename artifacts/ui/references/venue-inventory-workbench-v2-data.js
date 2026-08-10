const deepFreeze = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};

export const DEFAULT_INVENTORY_STATE = "day-ready";

export const INVENTORY_STATE_IDS = deepFreeze([
  "initial-loading", "load-error", "day-empty", "day-ready", "pitch-picker-open", "pitch-refreshing", "pitch-load-error",
  "calendar-open", "date-refreshing", "date-load-error", "cross-week-ready", "long-list-end", "create-slot-open", "edit-slot-open",
  "save-in-progress", "save-result-unknown", "create-slot-overlap", "concurrent-change", "permission-expired",
]);

export const VENUE = deepFreeze({
  venue_id: "venue-bohai-yuanfeng",
  name: "渤海元丰足球场",
  booking_mode: "ONLINE",
  permission: "VenueMembership.can_manage_inventory",
});

export const DEFAULT_SELECTION = deepFreeze({
  pitch_id: "pitch-7-001",
  local_date: "2026-08-11",
  request_sequence: 1,
});
export const DEFAULT_PITCH_LABEL = "A场 · 7人制";

export const DATE_WINDOW = deepFreeze({ start: "2026-08-10", end: "2026-08-23", inclusive: true });

export const PITCH_GROUPS = deepFreeze([
  { players_per_side: 5, pitches: [
    { id: "pitch-5-001", custom_name: "滨河场", system_name: "5人场 · 1号场", display_name: "滨河场", players_per_side: 5, sequence: 1, status: "ACTIVE" },
    { id: "pitch-5-002", custom_name: null, system_name: "5人场 · 2号场", display_name: "5人场 · 2号场", players_per_side: 5, sequence: 2, status: "ACTIVE" },
  ] },
  { players_per_side: 7, pitches: [
    { id: "pitch-7-001", custom_name: "A场", system_name: "7人场 · 1号场", display_name: "A场", players_per_side: 7, sequence: 1, status: "ACTIVE" },
    { id: "pitch-7-002", custom_name: null, system_name: "7人场 · 2号场", display_name: "7人场 · 2号场", players_per_side: 7, sequence: 2, status: "ACTIVE" },
    { id: "pitch-7-003", custom_name: null, system_name: "7人场 · 3号场", display_name: "7人场 · 3号场", players_per_side: 7, sequence: 3, status: "ACTIVE" },
  ] },
]);

export const PITCHES = deepFreeze(PITCH_GROUPS.flatMap(({ pitches }) => pitches));

export const SLOTS = deepFreeze([
  { id: "slot-1400", start: "14:00", end: "16:00", price: 260, status: "AVAILABLE", statusLabel: "开放", detail: "可修改价格或临时关闭", editable: true },
  { id: "slot-1600", start: "16:00", end: "18:00", price: 280, status: "AVAILABLE", statusLabel: "开放", detail: "可修改价格或临时关闭", editable: true },
  { id: "slot-1800", start: "18:00", end: "20:00", price: 320, status: "LOCKED", statusLabel: "锁定", detail: "用户下单中 · 只读", editable: false },
  { id: "slot-2000", start: "20:00", end: "22:00", price: 360, status: "CLOSED", statusLabel: "已关闭", detail: "可调整价格并重新开放", editable: true },
  { id: "slot-2200", start: "22:00", end: "23:00", price: 220, status: "BOOKED", statusLabel: "已售出", detail: "订单已确认 · 只读", editable: false },
]);

const weekdayNames = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const isoDays = Array.from({ length: 42 }, (_, index) => {
  const date = new Date(Date.UTC(2026, 6, 27 + index));
  return date.toISOString().slice(0, 10);
});
const makeDate = (iso) => {
  const date = new Date(`${iso}T00:00:00Z`);
  return {
    iso,
    day: date.getUTCDate(),
    weekday: weekdayNames[date.getUTCDay()],
    inMonth: iso.startsWith("2026-08"),
    manageable: iso >= DATE_WINDOW.start && iso <= DATE_WINDOW.end,
  };
};

export const AUGUST_CALENDAR = deepFreeze(isoDays.map(makeDate));
export const MANAGEABLE_DATES = deepFreeze(AUGUST_CALENDAR.filter(({ manageable }) => manageable));
const FIRST_WEEK = deepFreeze(MANAGEABLE_DATES.slice(0, 7));
const SECOND_WEEK = deepFreeze(MANAGEABLE_DATES.slice(7, 14));

const LONG_SLOTS = deepFreeze([
  { id: "slot-0800", start: "08:00", end: "09:00", price: 160, status: "AVAILABLE", statusLabel: "开放", detail: "可修改价格或临时关闭", editable: true },
  { id: "slot-0900", start: "09:00", end: "10:30", price: 220, status: "CLOSED", statusLabel: "已关闭", detail: "可调整价格并重新开放", editable: true },
  { id: "slot-1030", start: "10:30", end: "12:00", price: 240, status: "AVAILABLE", statusLabel: "开放", detail: "可修改价格或临时关闭", editable: true },
  { id: "slot-1200", start: "12:00", end: "13:30", price: 240, status: "LOCKED", statusLabel: "锁定", detail: "用户下单中 · 只读", editable: false },
  ...SLOTS,
]);

const pageAction = (disabled = false) => ({ label: "新增时段", disabled, nextState: "create-slot-open", fixed: true });
const ready = (id, changes = {}) => ({
  id,
  mode: "ready",
  selectedPitch: PITCHES[2],
  selectedDate: "2026-08-11",
  request_sequence: 1,
  week: FIRST_WEEK,
  slots: SLOTS,
  slotCount: SLOTS.length,
  pageAction: pageAction(),
  ...changes,
});
const createEditor = (changes = {}) => ({
  kind: "slot-editor",
  mode: "create",
  title: "新增时段",
  contextChips: ["8月11日 周二", "A场", "7人制", "09:30–11:00"],
  draft: { start: "09:30", end: "11:00", price: "260" },
  timeReadOnly: false,
  closeDisabled: false,
  saveDisabled: false,
  saveLabel: "保存时段",
  saveNextState: "save-in-progress",
  cancelNextState: "day-ready",
  ...changes,
});
const calendarSheet = (pendingDate = "2026-08-23") => ({
  kind: "calendar",
  title: "更多日期",
  subtitle: "未来 14 天",
  pendingDate,
  pendingLabel: "8月23日 周日",
  days: AUGUST_CALENDAR.map((day) => ({ ...day, selected: day.iso === pendingDate })),
  confirmLabel: "确认日期",
  confirmNextState: "date-refreshing",
  cancelNextState: "day-ready",
});

const states = {
  "initial-loading": {
    id: "initial-loading", mode: "initial-loading", selectedPitch: null, selectedDate: null, request_sequence: 1,
    week: [], slots: [], slotCount: null, statusMessage: "正在读取库存工作台", pageAction: pageAction(true),
  },
  "load-error": {
    id: "load-error", mode: "load-error", selectedPitch: null, selectedDate: null, request_sequence: 1,
    week: [], slots: [], slotCount: null, statusMessage: "库存加载失败，请重新加载", recoveryLabel: "重新加载",
    recoveryNextState: "day-ready", pageAction: pageAction(true),
  },
  "day-empty": ready("day-empty", {
    mode: "empty", selectedDate: "2026-08-12", slots: [], slotCount: 0,
    statusMessage: "当天还没有时段，可从下方新增第一条时段",
  }),
  "day-ready": ready("day-ready"),
  "pitch-picker-open": ready("pitch-picker-open", {
    sheet: { kind: "pitch-picker", title: "选择物理场地", selectedPitchId: "pitch-7-001", groups: PITCH_GROUPS, cancelNextState: "day-ready" },
  }),
  "pitch-refreshing": ready("pitch-refreshing", {
    mode: "partial-loading", selectedPitch: PITCHES[0], request_sequence: 2, slots: [], slotCount: null,
    staleSlotsVisible: false, preservedDate: "2026-08-11", statusMessage: "正在读取滨河场的时段",
  }),
  "pitch-load-error": ready("pitch-load-error", {
    mode: "partial-error", selectedPitch: PITCHES[0], request_sequence: 2, slots: [], slotCount: null,
    staleSlotsVisible: false, preservedDate: "2026-08-11", statusMessage: "滨河场的时段加载失败", recoveryLabel: "重试", recoveryNextState: "pitch-refreshing",
  }),
  "calendar-open": ready("calendar-open", { sheet: calendarSheet() }),
  "date-refreshing": ready("date-refreshing", {
    mode: "partial-loading", selectedDate: "2026-08-23", request_sequence: 2, week: SECOND_WEEK, slots: [], slotCount: null,
    staleSlotsVisible: false, preservedPitchId: "pitch-7-001", statusMessage: "正在读取8月23日的时段",
  }),
  "date-load-error": ready("date-load-error", {
    mode: "partial-error", selectedDate: "2026-08-23", request_sequence: 2, week: SECOND_WEEK, slots: [], slotCount: null,
    staleSlotsVisible: false, preservedPitchId: "pitch-7-001", statusMessage: "8月23日的时段加载失败", recoveryLabel: "重试", recoveryNextState: "date-refreshing",
  }),
  "cross-week-ready": ready("cross-week-ready", { selectedDate: "2026-08-23", request_sequence: 2, week: SECOND_WEEK }),
  "long-list-end": ready("long-list-end", { slots: LONG_SLOTS, slotCount: LONG_SLOTS.length, initializeAtEnd: true }),
  "create-slot-open": ready("create-slot-open", { editor: createEditor() }),
  "edit-slot-open": ready("edit-slot-open", {
    editor: {
      ...createEditor(), mode: "edit", title: "编辑时段", slotId: "slot-1400", timeReadOnly: true,
      contextChips: ["8月11日 周二", "A场", "7人制", "14:00–16:00"],
      draft: { start: "14:00", end: "16:00", price: "260" }, saveLabel: "保存价格",
    },
  }),
  "save-in-progress": ready("save-in-progress", {
    mode: "saving", statusMessage: "正在保存时段，输入内容已保留", duplicateSaveDisabled: true,
    editor: createEditor({ closeDisabled: true, saveDisabled: true, saveLabel: "正在保存" }), pageAction: pageAction(true),
  }),
  "save-result-unknown": ready("save-result-unknown", {
    mode: "saving", statusMessage: "正在确认保存结果", duplicateSaveDisabled: true,
    editor: createEditor({ closeDisabled: true, saveDisabled: true, saveLabel: "正在确认" }), pageAction: pageAction(true),
  }),
  "create-slot-overlap": ready("create-slot-overlap", {
    editor: createEditor({ inlineError: "与已有时段冲突，请调整时间", conflictingTime: "10:30–12:00" }),
  }),
  "concurrent-change": ready("concurrent-change", {
    mode: "authority-error", statusMessage: "库存已发生变化，请重新核对", draftPreserved: true,
    editor: createEditor({ reviewCopy: "权威库存已刷新；草稿保留，请核对后再保存", saveDisabled: true }),
  }),
  "permission-expired": ready("permission-expired", {
    mode: "permission-error", statusMessage: "权限已失效，请重新进入", contextReadable: true,
    writeControlsDisabled: true, pageAction: pageAction(true),
  }),
};

export const INVENTORY_STATES = deepFreeze(states);
