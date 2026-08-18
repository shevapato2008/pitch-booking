export type VenueFulfillmentVisualState =
  | "refund-confirm"
  | "ready"
  | "refund-submitted"
  | "empty"
  | "read-error";

export type VenueFulfillmentAction = "CHECK_IN" | "COMPLETE" | "REFUND";

interface AllowedActions {
  readonly canCheckIn: boolean;
  readonly canComplete: boolean;
  readonly canRefund: boolean;
}

export interface VenueFulfillmentOrderPreview {
  readonly id: string;
  readonly number: string;
  readonly time: string;
  readonly pitch: string;
  readonly guest: string;
  readonly phone: string;
  readonly statusLabel: string;
  readonly statusTone: "ready" | "active" | "complete" | "warning" | "refund";
  readonly allowedActions: AllowedActions;
  readonly action: VenueFulfillmentAction | null;
  readonly actionLabel: string;
}

export interface VenueFulfillmentPreview {
  readonly visualState: VenueFulfillmentVisualState;
  readonly venueName: string;
  readonly contextLabel: string;
  readonly selectedDateLabel: string;
  readonly dates: readonly {
    readonly id: string;
    readonly weekday: string;
    readonly day: string;
    readonly state: VenueFulfillmentVisualState;
    readonly selected: boolean;
  }[];
  readonly orders: readonly VenueFulfillmentOrderPreview[];
  readonly sheetOpen: boolean;
  readonly refundOrderId: string;
  readonly refundOrderNumber: string;
  readonly refundReason: string;
  readonly refundReasonValid: boolean;
  readonly errorMessage: string;
  readonly headerTopPx: number;
  readonly headerRowHeightPx: number;
  readonly headerRightInsetPx: number;
}

export type VenueFulfillmentFixtureEvent =
  | { readonly type: "CHECK_IN"; readonly orderId: string }
  | { readonly type: "COMPLETE"; readonly orderId: string }
  | { readonly type: "OPEN_REFUND"; readonly orderId: string }
  | { readonly type: "EDIT_REASON"; readonly value: string }
  | { readonly type: "CANCEL_REFUND" }
  | { readonly type: "CONFIRM_REFUND" }
  | { readonly type: "SELECT_DATE"; readonly state: VenueFulfillmentVisualState }
  | { readonly type: "RETRY" };

const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value as Record<string, unknown>).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};

const allowed = (canCheckIn: boolean, canComplete: boolean, canRefund: boolean): AllowedActions => ({
  canCheckIn,
  canComplete,
  canRefund,
});

const actionFromAuthority = (actions: AllowedActions): Pick<VenueFulfillmentOrderPreview, "action" | "actionLabel"> => {
  if (actions.canCheckIn) return { action: "CHECK_IN", actionLabel: "确认签到" };
  if (actions.canComplete) return { action: "COMPLETE", actionLabel: "完成服务" };
  if (actions.canRefund) return { action: "REFUND", actionLabel: "取消并退款" };
  return { action: null, actionLabel: "" };
};

const order = (
  input: Omit<VenueFulfillmentOrderPreview, "action" | "actionLabel">,
): VenueFulfillmentOrderPreview => ({ ...input, ...actionFromAuthority(input.allowedActions) });

const baseOrders = deepFreeze([
  order({
    id: "order-check-in",
    number: "PB202608190021",
    time: "09:30–11:00",
    pitch: "七人制 A 场",
    guest: "杨先生",
    phone: "131****8612",
    statusLabel: "待签到",
    statusTone: "ready",
    allowedActions: allowed(true, false, false),
  }),
  order({
    id: "order-complete",
    number: "PB202608190018",
    time: "08:00–09:30",
    pitch: "五人制 A 场",
    guest: "陈女士",
    phone: "138****2046",
    statusLabel: "已签到",
    statusTone: "active",
    allowedActions: allowed(false, true, false),
  }),
  order({
    id: "order-refundable",
    number: "PB202608190026",
    time: "14:00–15:30",
    pitch: "七人制 B 场",
    guest: "王先生",
    phone: "186****5739",
    statusLabel: "待履约",
    statusTone: "warning",
    allowedActions: allowed(false, false, true),
  }),
]);

const dates = deepFreeze([
  { id: "yesterday", weekday: "周二", day: "18", state: "empty" as const, selected: false },
  { id: "today", weekday: "今天", day: "19", state: "refund-confirm" as const, selected: true },
  { id: "tomorrow", weekday: "周四", day: "20", state: "read-error" as const, selected: false },
]);

const base = {
  venueName: "测试环境·渤海元丰足球场",
  contextLabel: "今日订单 · 仅授权工作人员",
  selectedDateLabel: "8月19日 周三",
  dates,
  orders: baseOrders,
  sheetOpen: false,
  refundOrderId: "order-refundable",
  refundOrderNumber: "PB202608190026",
  refundReason: "场地临时检修，无法按时提供服务",
  refundReasonValid: true,
  errorMessage: "",
  headerTopPx: 0,
  headerRowHeightPx: 44,
  headerRightInsetPx: 0,
};

const states: Readonly<Record<VenueFulfillmentVisualState, VenueFulfillmentPreview>> = deepFreeze({
  "refund-confirm": { ...base, visualState: "refund-confirm", sheetOpen: true },
  ready: { ...base, visualState: "ready" },
  "refund-submitted": {
    ...base,
    visualState: "refund-submitted",
    orders: baseOrders.map((item) => item.id === "order-refundable" ? order({
      ...item,
      statusLabel: "退款处理中",
      statusTone: "refund",
      allowedActions: allowed(false, false, false),
    }) : item),
  },
  empty: {
    ...base,
    visualState: "empty",
    selectedDateLabel: "8月18日 周二",
    dates: dates.map((date) => ({ ...date, selected: date.id === "yesterday" })),
    orders: [],
    refundReason: "",
    refundReasonValid: false,
  },
  "read-error": {
    ...base,
    visualState: "read-error",
    selectedDateLabel: "8月20日 周四",
    dates: dates.map((date) => ({ ...date, selected: date.id === "tomorrow" })),
    orders: [],
    refundReason: "",
    refundReasonValid: false,
    errorMessage: "订单读取失败，请重试",
  },
});

export const VENUE_FULFILLMENT_FIXTURE = deepFreeze({
  token: "VENUE_FULFILLMENT_FIXTURE",
  states,
  deletionCondition: "delete after production venue fulfillment HTTP integration",
});

export function resolveVenueFulfillmentState(input: unknown): VenueFulfillmentVisualState {
  return typeof input === "string" && input in states ? input as VenueFulfillmentVisualState : "refund-confirm";
}

export function cloneVenueFulfillmentPreview(view: VenueFulfillmentPreview): VenueFulfillmentPreview {
  return {
    ...view,
    dates: view.dates.map((date) => ({ ...date })),
    orders: view.orders.map((item) => ({ ...item, allowedActions: { ...item.allowedActions } })),
  };
}

function preserveHeaderLayout(
  current: VenueFulfillmentPreview,
  next: VenueFulfillmentPreview,
): VenueFulfillmentPreview {
  return {
    ...next,
    headerTopPx: current.headerTopPx,
    headerRowHeightPx: current.headerRowHeightPx,
    headerRightInsetPx: current.headerRightInsetPx,
  };
}

function updateOrder(
  view: VenueFulfillmentPreview,
  orderId: string,
  update: (item: VenueFulfillmentOrderPreview) => VenueFulfillmentOrderPreview,
): VenueFulfillmentPreview {
  return { ...view, orders: view.orders.map((item) => item.id === orderId ? update(item) : item) };
}

export function transitionVenueFulfillmentFixture(
  current: VenueFulfillmentPreview,
  event: VenueFulfillmentFixtureEvent,
): VenueFulfillmentPreview {
  if (event.type === "SELECT_DATE") {
    return preserveHeaderLayout(current, cloneVenueFulfillmentPreview(states[event.state]));
  }
  if (event.type === "RETRY") {
    return preserveHeaderLayout(current, cloneVenueFulfillmentPreview(states["refund-confirm"]));
  }
  if (event.type === "EDIT_REASON") {
    return { ...current, refundReason: event.value, refundReasonValid: event.value.trim().length > 0 };
  }
  if (event.type === "CANCEL_REFUND") return { ...current, visualState: "ready", sheetOpen: false };
  if (event.type === "OPEN_REFUND") {
    const target = current.orders.find(({ id, allowedActions }) => id === event.orderId && allowedActions.canRefund);
    return target ? { ...current, visualState: "refund-confirm", sheetOpen: true, refundOrderId: target.id, refundOrderNumber: target.number } : current;
  }
  if (event.type === "CHECK_IN") {
    return updateOrder(current, event.orderId, (item) => item.allowedActions.canCheckIn ? order({
      ...item,
      statusLabel: "已签到",
      statusTone: "active",
      allowedActions: allowed(false, true, false),
    }) : item);
  }
  if (event.type === "COMPLETE") {
    return updateOrder(current, event.orderId, (item) => item.allowedActions.canComplete ? order({
      ...item,
      statusLabel: "已完成",
      statusTone: "complete",
      allowedActions: allowed(false, false, false),
    }) : item);
  }
  if (!current.sheetOpen || !current.refundReasonValid) return current;
  const submitted = updateOrder(current, current.refundOrderId, (item) => order({
    ...item,
    statusLabel: "退款处理中",
    statusTone: "refund",
    allowedActions: allowed(false, false, false),
  }));
  return { ...submitted, visualState: "refund-submitted", sheetOpen: false };
}
