export type VenueInventoryVisualState =
  | "initial-loading" | "load-error" | "day-empty" | "day-ready" | "pitch-picker-open"
  | "pitch-refreshing" | "pitch-load-error" | "calendar-open" | "date-refreshing"
  | "date-load-error" | "cross-week-ready" | "long-list-end" | "create-slot-open"
  | "edit-slot-open" | "save-in-progress" | "save-result-unknown" | "create-slot-overlap"
  | "concurrent-change" | "permission-expired";

export type VenueSlotStatus = "AVAILABLE" | "LOCKED" | "CLOSED" | "BOOKED";

export interface VenuePitch {
  readonly id: string;
  readonly displayName: string;
  readonly systemName: string;
  readonly playersPerSide: number;
  readonly sequence: number;
}

export interface VenueSlot {
  readonly id: string;
  readonly start: string;
  readonly end: string;
  readonly price: number;
  readonly status: VenueSlotStatus;
  readonly statusLabel: string;
  readonly detail: string;
  readonly editable: boolean;
}

export interface InventoryDay {
  readonly iso: string;
  readonly day: number;
  readonly weekday: string;
  readonly manageable: boolean;
  readonly selected?: boolean;
}

interface InventoryEditor {
  readonly kind: "slot-editor";
  readonly mode: "create" | "edit";
  readonly title: string;
  readonly contextChips: readonly string[];
  readonly draft: { readonly start: string; readonly end: string; readonly price: string };
  readonly timeReadOnly: boolean;
  readonly closeDisabled: boolean;
  readonly saveDisabled: boolean;
  readonly saveLabel: string;
  readonly saveNextState: VenueInventoryVisualState;
  readonly cancelNextState: VenueInventoryVisualState;
  readonly inlineError?: string;
  readonly conflictingTime?: string;
  readonly reviewCopy?: string;
}

interface InventorySheet {
  readonly kind: "pitch-picker" | "calendar";
  readonly title: string;
  readonly cancelNextState: VenueInventoryVisualState;
  readonly groups?: readonly { readonly playersPerSide: number; readonly pitches: readonly VenuePitch[] }[];
  readonly selectedPitchId?: string;
  readonly subtitle?: string;
  readonly pendingDate?: string;
  readonly pendingLabel?: string;
  readonly days?: readonly InventoryDay[];
  readonly confirmNextState?: VenueInventoryVisualState;
}

export interface VenueInventoryView {
  readonly visualState: VenueInventoryVisualState;
  readonly mode: string;
  readonly selectedPitch: VenuePitch | null;
  readonly selectedDate: string | null;
  readonly requestSequence: number;
  readonly week: readonly InventoryDay[];
  readonly slots: readonly VenueSlot[];
  readonly slotCount: number | null;
  readonly pageAction: { readonly label: string; readonly disabled: boolean; readonly nextState: VenueInventoryVisualState };
  readonly statusMessage?: string;
  readonly recoveryLabel?: string;
  readonly recoveryNextState?: VenueInventoryVisualState;
  readonly sheet?: InventorySheet;
  readonly editor?: InventoryEditor;
  readonly duplicateSaveDisabled?: boolean;
  readonly writeControlsDisabled?: boolean;
  readonly initializeAtEnd?: boolean;
}

const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value as Record<string, unknown>).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};

export const INVENTORY_STATE_IDS = deepFreeze([
  "initial-loading", "load-error", "day-empty", "day-ready", "pitch-picker-open",
  "pitch-refreshing", "pitch-load-error", "calendar-open", "date-refreshing",
  "date-load-error", "cross-week-ready", "long-list-end", "create-slot-open",
  "edit-slot-open", "save-in-progress", "save-result-unknown", "create-slot-overlap",
  "concurrent-change", "permission-expired",
] as const);

const stateSet = new Set<string>(INVENTORY_STATE_IDS);
export function resolveVenueInventoryVisualState(input: unknown): VenueInventoryVisualState {
  return typeof input === "string" && stateSet.has(input) ? input as VenueInventoryVisualState : "day-ready";
}

const pitchGroups = deepFreeze([
  { playersPerSide: 5, pitches: [
    { id: "pitch-5-001", displayName: "滨河场", systemName: "5人场 · 1号场", playersPerSide: 5, sequence: 1 },
    { id: "pitch-5-002", displayName: "5人场 · 2号场", systemName: "5人场 · 2号场", playersPerSide: 5, sequence: 2 },
  ] },
  { playersPerSide: 7, pitches: [
    { id: "pitch-7-001", displayName: "A场", systemName: "7人场 · 1号场", playersPerSide: 7, sequence: 1 },
    { id: "pitch-7-002", displayName: "7人场 · 2号场", systemName: "7人场 · 2号场", playersPerSide: 7, sequence: 2 },
    { id: "pitch-7-003", displayName: "7人场 · 3号场", systemName: "7人场 · 3号场", playersPerSide: 7, sequence: 3 },
  ] },
] satisfies readonly { playersPerSide: number; pitches: readonly VenuePitch[] }[]);

const pitches = deepFreeze(pitchGroups.flatMap(({ pitches: group }) => group));
const slots = deepFreeze([
  { id: "slot-1400", start: "14:00", end: "16:00", price: 260, status: "AVAILABLE", statusLabel: "开放", detail: "可修改价格或临时关闭", editable: true },
  { id: "slot-1600", start: "16:00", end: "18:00", price: 280, status: "AVAILABLE", statusLabel: "开放", detail: "可修改价格或临时关闭", editable: true },
  { id: "slot-1800", start: "18:00", end: "20:00", price: 320, status: "LOCKED", statusLabel: "锁定", detail: "用户下单中 · 只读", editable: false },
  { id: "slot-2000", start: "20:00", end: "22:00", price: 360, status: "CLOSED", statusLabel: "已关闭", detail: "可调整价格并重新开放", editable: true },
  { id: "slot-2200", start: "22:00", end: "23:00", price: 220, status: "BOOKED", statusLabel: "已售出", detail: "订单已确认 · 只读", editable: false },
] satisfies readonly VenueSlot[]);

const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const calendar = deepFreeze(Array.from({ length: 42 }, (_, index) => {
  const date = new Date(Date.UTC(2026, 6, 27 + index));
  const iso = date.toISOString().slice(0, 10);
  return { iso, day: date.getUTCDate(), weekday: weekdays[date.getUTCDay()], manageable: iso >= "2026-08-10" && iso <= "2026-08-23" };
}));
const manageableDays = calendar.filter(({ manageable }) => manageable);
const firstWeek = deepFreeze(manageableDays.slice(0, 7));
const secondWeek = deepFreeze(manageableDays.slice(7, 14));
const longSlots = deepFreeze([
  { id: "slot-0800", start: "08:00", end: "09:00", price: 160, status: "AVAILABLE", statusLabel: "开放", detail: "可修改价格或临时关闭", editable: true },
  { id: "slot-0900", start: "09:00", end: "10:30", price: 220, status: "CLOSED", statusLabel: "已关闭", detail: "可调整价格并重新开放", editable: true },
  { id: "slot-1030", start: "10:30", end: "12:00", price: 240, status: "AVAILABLE", statusLabel: "开放", detail: "可修改价格或临时关闭", editable: true },
  ...slots,
] satisfies readonly VenueSlot[]);

export const VENUE_INVENTORY_VISUAL_FIXTURE = deepFreeze({
  venue: { id: "venue-bohai-yuanfeng", name: "渤海元丰足球场" },
  venueNote: "库存工作台 · 仅授权工作人员",
  defaultSelection: { pitchId: "pitch-7-001", localDate: "2026-08-11", requestSequence: 1 },
  dateWindow: { start: "2026-08-10", end: "2026-08-23" },
  pitchGroups,
  slots,
  calendar,
  deletionCondition: "delete after physical-pitch configuration and real inventory backend integration",
});

const action = (disabled = false) => ({ label: "新增时段", disabled, nextState: "create-slot-open" as const });
const ready = (visualState: VenueInventoryVisualState, patch: Partial<VenueInventoryView> = {}): VenueInventoryView => ({
  visualState, mode: "ready", selectedPitch: pitches[2], selectedDate: "2026-08-11", requestSequence: 1,
  week: firstWeek, slots, slotCount: slots.length, pageAction: action(), ...patch,
});
const editor = (patch: Partial<InventoryEditor> = {}): InventoryEditor => ({
  kind: "slot-editor", mode: "create", title: "新增时段", contextChips: ["8月11日 周二", "A场", "7人制", "09:30–11:00"],
  draft: { start: "09:30", end: "11:00", price: "260" }, timeReadOnly: false, closeDisabled: false,
  saveDisabled: false, saveLabel: "保存时段", saveNextState: "save-in-progress", cancelNextState: "day-ready", ...patch,
});
const calendarSheet = (): InventorySheet => ({
  kind: "calendar", title: "更多日期", subtitle: "未来 14 天", cancelNextState: "day-ready",
  pendingDate: "2026-08-23", pendingLabel: "8月23日 周日",
  days: calendar.map((day) => ({ ...day, selected: day.iso === "2026-08-23" })), confirmNextState: "date-refreshing",
});

const states: Record<VenueInventoryVisualState, VenueInventoryView> = {
  "initial-loading": ready("initial-loading", { mode: "initial-loading", selectedPitch: null, selectedDate: null, week: [], slots: [], slotCount: null, statusMessage: "正在读取库存工作台", pageAction: action(true) }),
  "load-error": ready("load-error", { mode: "load-error", selectedPitch: null, selectedDate: null, week: [], slots: [], slotCount: null, statusMessage: "库存加载失败，请重新加载", recoveryLabel: "重新加载", recoveryNextState: "day-ready", pageAction: action(true) }),
  "day-empty": ready("day-empty", { mode: "empty", selectedDate: "2026-08-12", slots: [], slotCount: 0, statusMessage: "当天还没有时段，可从下方新增第一条时段" }),
  "day-ready": ready("day-ready"),
  "pitch-picker-open": ready("pitch-picker-open", { sheet: { kind: "pitch-picker", title: "选择物理场地", cancelNextState: "day-ready", selectedPitchId: "pitch-7-001", groups: pitchGroups } }),
  "pitch-refreshing": ready("pitch-refreshing", { mode: "partial-loading", selectedPitch: pitches[0], requestSequence: 2, slots: [], slotCount: null, statusMessage: "正在读取滨河场的时段" }),
  "pitch-load-error": ready("pitch-load-error", { mode: "partial-error", selectedPitch: pitches[0], requestSequence: 2, slots: [], slotCount: null, statusMessage: "滨河场的时段加载失败", recoveryLabel: "重试", recoveryNextState: "pitch-refreshing" }),
  "calendar-open": ready("calendar-open", { sheet: calendarSheet() }),
  "date-refreshing": ready("date-refreshing", { mode: "partial-loading", selectedDate: "2026-08-23", requestSequence: 2, week: secondWeek, slots: [], slotCount: null, statusMessage: "正在读取8月23日的时段" }),
  "date-load-error": ready("date-load-error", { mode: "partial-error", selectedDate: "2026-08-23", requestSequence: 2, week: secondWeek, slots: [], slotCount: null, statusMessage: "8月23日的时段加载失败", recoveryLabel: "重试", recoveryNextState: "date-refreshing" }),
  "cross-week-ready": ready("cross-week-ready", { selectedDate: "2026-08-23", requestSequence: 2, week: secondWeek }),
  "long-list-end": ready("long-list-end", { slots: longSlots, slotCount: longSlots.length, initializeAtEnd: true }),
  "create-slot-open": ready("create-slot-open", { editor: editor() }),
  "edit-slot-open": ready("edit-slot-open", { editor: editor({ mode: "edit", title: "编辑时段", timeReadOnly: true, contextChips: ["8月11日 周二", "A场", "7人制", "14:00–16:00"], draft: { start: "14:00", end: "16:00", price: "260" }, saveLabel: "保存价格" }) }),
  "save-in-progress": ready("save-in-progress", { mode: "saving", statusMessage: "正在保存时段，输入内容已保留", duplicateSaveDisabled: true, editor: editor({ closeDisabled: true, saveDisabled: true, saveLabel: "正在保存" }), pageAction: action(true) }),
  "save-result-unknown": ready("save-result-unknown", { mode: "saving", statusMessage: "正在确认保存结果", duplicateSaveDisabled: true, editor: editor({ closeDisabled: true, saveDisabled: true, saveLabel: "正在确认" }), pageAction: action(true) }),
  "create-slot-overlap": ready("create-slot-overlap", { editor: editor({ inlineError: "与已有时段冲突，请调整时间", conflictingTime: "10:30–12:00" }) }),
  "concurrent-change": ready("concurrent-change", { mode: "authority-error", statusMessage: "库存已发生变化，请重新核对", editor: editor({ reviewCopy: "权威库存已刷新；草稿保留，请核对后再保存", saveDisabled: true }) }),
  "permission-expired": ready("permission-expired", { mode: "permission-error", statusMessage: "权限已失效，请重新进入", writeControlsDisabled: true, pageAction: action(true) }),
};

deepFreeze(states);
export function buildVenueInventoryView(state: VenueInventoryVisualState): VenueInventoryView {
  return states[state];
}
