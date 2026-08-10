export type VenueInventoryVisualState =
  | "day-ready"
  | "create-slot-open"
  | "edit-slot-open"
  | "save-result-unknown"
  | "create-slot-overlap";

export type VenueSlotStatus = "AVAILABLE" | "LOCKED" | "CLOSED" | "BOOKED";

interface VenueInventoryDayFixture {
  readonly weekday: string;
  readonly day: string;
  readonly selected: boolean;
}

interface VenueInventoryPitchFixture {
  readonly id: string;
  readonly label: string;
  readonly selected: boolean;
}

export interface VenueInventorySlotFixture {
  readonly id: string;
  readonly time: string;
  readonly priceYuan: number;
  readonly status: VenueSlotStatus;
  readonly statusLabel: string;
  readonly helper: string;
  readonly editable: boolean;
  readonly statusClass: string;
  readonly trailingIcon: "chevron" | "lock" | "check";
  readonly accessibilityLabel: string;
}

const VISUAL_STATES = new Set<VenueInventoryVisualState>([
  "day-ready",
  "create-slot-open",
  "edit-slot-open",
  "save-result-unknown",
  "create-slot-overlap",
]);

export function resolveVenueInventoryVisualState(input: unknown): VenueInventoryVisualState {
  return typeof input === "string" && VISUAL_STATES.has(input as VenueInventoryVisualState)
    ? input as VenueInventoryVisualState
    : "day-ready";
}

const days = Object.freeze([
  Object.freeze({ weekday: "一", day: "10", selected: false }),
  Object.freeze({ weekday: "二", day: "11", selected: true }),
  Object.freeze({ weekday: "三", day: "12", selected: false }),
  Object.freeze({ weekday: "四", day: "13", selected: false }),
  Object.freeze({ weekday: "五", day: "14", selected: false }),
  Object.freeze({ weekday: "六", day: "15", selected: false }),
  Object.freeze({ weekday: "日", day: "16", selected: false }),
] satisfies readonly VenueInventoryDayFixture[]);

const pitches = Object.freeze([
  Object.freeze({ id: "pitch-7", label: "7人场", selected: true }),
  Object.freeze({ id: "pitch-5", label: "5人场", selected: false }),
] satisfies readonly VenueInventoryPitchFixture[]);

const slots = Object.freeze([
  Object.freeze({
    id: "slot-1400",
    time: "14:00–16:00",
    priceYuan: 260,
    status: "AVAILABLE",
    statusLabel: "开放",
    helper: "可修改价格或临时关闭",
    editable: true,
    statusClass: "available",
    trailingIcon: "chevron",
    accessibilityLabel: "14点到16点，260元，开放，可编辑",
  }),
  Object.freeze({
    id: "slot-1600",
    time: "16:00–18:00",
    priceYuan: 280,
    status: "AVAILABLE",
    statusLabel: "开放",
    helper: "可修改价格或临时关闭",
    editable: true,
    statusClass: "available",
    trailingIcon: "chevron",
    accessibilityLabel: "16点到18点，280元，开放，可编辑",
  }),
  Object.freeze({
    id: "slot-1800",
    time: "18:00–20:00",
    priceYuan: 320,
    status: "LOCKED",
    statusLabel: "锁定",
    helper: "用户下单中 · 只读",
    editable: false,
    statusClass: "locked",
    trailingIcon: "lock",
    accessibilityLabel: "18点到20点，320元，用户下单中，只读",
  }),
  Object.freeze({
    id: "slot-2000",
    time: "20:00–22:00",
    priceYuan: 360,
    status: "CLOSED",
    statusLabel: "已关闭",
    helper: "可调整价格并重新开放",
    editable: true,
    statusClass: "closed",
    trailingIcon: "chevron",
    accessibilityLabel: "20点到22点，360元，已关闭，可编辑",
  }),
  Object.freeze({
    id: "slot-2200",
    time: "22:00–23:00",
    priceYuan: 220,
    status: "BOOKED",
    statusLabel: "已售出",
    helper: "订单已确认 · 只读",
    editable: false,
    statusClass: "booked",
    trailingIcon: "check",
    accessibilityLabel: "22点到23点，220元，已售出，只读",
  }),
] satisfies readonly VenueInventorySlotFixture[]);

export const VENUE_INVENTORY_VISUAL_FIXTURE = Object.freeze({
  venueName: "渤海元丰足球场",
  venueNote: "库存工作台 · 仅授权工作人员",
  monthLabel: "2026年8月",
  selectedDateLabel: "8月11日 周二",
  totalLabel: "5 个时段",
  days,
  pitches,
  slots,
  createDraft: Object.freeze({ start: "09:30", end: "11:00", priceYuan: 200 }),
  deletionCondition: "delete after real inventory backend integration",
});
