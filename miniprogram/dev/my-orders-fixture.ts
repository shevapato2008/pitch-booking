export type MyOrdersFixtureStatus =
  | "pending"
  | "confirming"
  | "closing"
  | "confirmed"
  | "expired"
  | "exception";

type MyOrdersServerStatus = "PENDING_PAYMENT" | "CONFIRMED" | "EXPIRED" | "PAYMENT_EXCEPTION";

export interface MyOrdersRawFixtureOrder {
  readonly orderId: string;
  readonly venue: string;
  readonly pitch: string;
  readonly schedule: string;
  readonly amount: string;
  readonly serverStatus: MyOrdersServerStatus;
  readonly paymentConfirming: boolean;
  readonly closingPayment: boolean;
}

export interface MyOrdersFixtureOrder {
  readonly orderId: string;
  readonly venue: string;
  readonly pitch: string;
  readonly schedule: string;
  readonly amount: string;
  readonly status: MyOrdersFixtureStatus;
  readonly statusLabel: string;
  readonly statusDescription: string;
  readonly route: string;
}

export type MyOrdersPreviewStateId =
  | "loading"
  | "ready"
  | "empty"
  | "error"
  | "refreshing"
  | "ready-refreshed"
  | "loading-more"
  | "load-more-error"
  | "end";

export interface MyOrdersPreviewState {
  readonly previewState: MyOrdersPreviewStateId;
  readonly orders: readonly MyOrdersFixtureOrder[];
  readonly showSkeleton: boolean;
  readonly showEmpty: boolean;
  readonly showError: boolean;
  readonly refreshing: boolean;
  readonly loadingMore: boolean;
  readonly loadMoreError: boolean;
  readonly hasMore: boolean;
  readonly end: boolean;
}

export type MyOrdersFixtureAction =
  | "retry"
  | "retry-resolved"
  | "refresh"
  | "refresh-resolved"
  | "load-more"
  | "load-more-failed"
  | "retry-load-more"
  | "load-more-resolved";

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

export const MY_ORDERS_RAW_FIXTURE = deepFreeze<MyOrdersRawFixtureOrder[]>([
  {
    orderId: "00000000-0000-4000-8000-000000000040",
    venue: "天津奥体足球场",
    pitch: "七人制 A 场",
    schedule: "8月20日 周四 · 19:00–20:00",
    amount: "¥360",
    serverStatus: "PENDING_PAYMENT",
    paymentConfirming: false,
    closingPayment: false,
  },
  {
    orderId: "00000000-0000-4000-8000-000000000041",
    venue: "渤海元丰足球场",
    pitch: "五人制 滨河场",
    schedule: "8月19日 周三 · 20:00–22:00",
    amount: "¥320",
    serverStatus: "PENDING_PAYMENT",
    paymentConfirming: true,
    closingPayment: true,
  },
  {
    orderId: "00000000-0000-4000-8000-000000000042",
    venue: "浦东星跃足球公园",
    pitch: "五人制 A 场",
    schedule: "8月23日 周日 · 14:00–16:00",
    amount: "¥280",
    serverStatus: "CONFIRMED",
    paymentConfirming: false,
    closingPayment: false,
  },
  {
    orderId: "00000000-0000-4000-8000-000000000043",
    venue: "天津市人民体育馆足球场",
    pitch: "十一人制 主场",
    schedule: "8月16日 周日 · 09:00–11:00",
    amount: "¥520",
    serverStatus: "EXPIRED",
    paymentConfirming: false,
    closingPayment: false,
  },
  {
    orderId: "00000000-0000-4000-8000-000000000044",
    venue: "天津奥林匹克中心五人制足球场",
    pitch: "五人制 2 号场",
    schedule: "8月18日 周二 · 18:30–20:00",
    amount: "¥260",
    serverStatus: "PAYMENT_EXCEPTION",
    paymentConfirming: false,
    closingPayment: false,
  },
  {
    orderId: "00000000-0000-4000-8000-000000000045",
    venue: "海河东岸足球训练场",
    pitch: "七人制 B 场",
    schedule: "8月15日 周六 · 16:00–18:00",
    amount: "¥300",
    serverStatus: "PENDING_PAYMENT",
    paymentConfirming: true,
    closingPayment: false,
  },
  {
    orderId: "00000000-0000-4000-8000-000000000046",
    venue: "天津体育学院足球场",
    pitch: "五人制 西场",
    schedule: "8月14日 周五 · 19:00–20:00",
    amount: "¥220",
    serverStatus: "CONFIRMED",
    paymentConfirming: false,
    closingPayment: false,
  },
]);

export function projectMyOrdersFixtureOrder(order: MyOrdersRawFixtureOrder): MyOrdersFixtureOrder {
  let projection: Pick<MyOrdersFixtureOrder, "status" | "statusLabel" | "statusDescription">;
  if (order.serverStatus === "PAYMENT_EXCEPTION") {
    projection = { status: "exception", statusLabel: "支付待确认", statusDescription: "请进入详情重新查询" };
  } else if (order.closingPayment) {
    projection = { status: "closing", statusLabel: "正在关闭", statusDescription: "正在确认订单与场地状态" };
  } else if (order.paymentConfirming) {
    projection = { status: "confirming", statusLabel: "支付确认中", statusDescription: "结果以服务端确认为准" };
  } else if (order.serverStatus === "CONFIRMED") {
    projection = { status: "confirmed", statusLabel: "预订成功", statusDescription: "场地已为你预订" };
  } else if (order.serverStatus === "EXPIRED") {
    projection = { status: "expired", statusLabel: "已过期", statusDescription: "该订单已关闭" };
  } else {
    projection = { status: "pending", statusLabel: "待支付", statusDescription: "请在订单关闭前完成支付" };
  }
  return deepFreeze({
    orderId: order.orderId,
    venue: order.venue,
    pitch: order.pitch,
    schedule: order.schedule,
    amount: order.amount,
    ...projection,
    route: `/pages/order-detail/index?order_id=${order.orderId}`,
  });
}

const firstPage = MY_ORDERS_RAW_FIXTURE.slice(0, 5).map(projectMyOrdersFixtureOrder);
const allOrders = MY_ORDERS_RAW_FIXTURE.map(projectMyOrdersFixtureOrder);

function previewState(
  previewStateId: MyOrdersPreviewStateId,
  orders: readonly MyOrdersFixtureOrder[],
  options: Partial<Omit<MyOrdersPreviewState, "previewState" | "orders">> = {},
): MyOrdersPreviewState {
  return {
    previewState: previewStateId,
    orders,
    showSkeleton: false,
    showEmpty: false,
    showError: false,
    refreshing: false,
    loadingMore: false,
    loadMoreError: false,
    hasMore: false,
    end: false,
    ...options,
  };
}

export const MY_ORDERS_PREVIEW_STATES = deepFreeze<Record<MyOrdersPreviewStateId, MyOrdersPreviewState>>({
  loading: previewState("loading", [], { showSkeleton: true }),
  ready: previewState("ready", firstPage, { hasMore: true }),
  empty: previewState("empty", [], { showEmpty: true }),
  error: previewState("error", [], { showError: true }),
  refreshing: previewState("refreshing", firstPage, { refreshing: true, hasMore: true }),
  "ready-refreshed": previewState("ready-refreshed", firstPage, { hasMore: true }),
  "loading-more": previewState("loading-more", firstPage, { loadingMore: true, hasMore: true }),
  "load-more-error": previewState("load-more-error", firstPage, { loadMoreError: true, hasMore: true }),
  end: previewState("end", allOrders, { end: true }),
});

const TRANSITIONS: Readonly<Record<MyOrdersFixtureAction, MyOrdersPreviewStateId>> = Object.freeze({
  retry: "loading",
  "retry-resolved": "ready",
  refresh: "refreshing",
  "refresh-resolved": "ready-refreshed",
  "load-more": "loading-more",
  "load-more-failed": "load-more-error",
  "retry-load-more": "loading-more",
  "load-more-resolved": "end",
});

export function cloneMyOrdersPreviewState(stateId: MyOrdersPreviewStateId): MyOrdersPreviewState {
  const source = MY_ORDERS_PREVIEW_STATES[stateId];
  return {
    ...source,
    orders: source.orders.map((order) => ({ ...order })),
  };
}

export function readMyOrdersPreviewState(value: unknown): MyOrdersPreviewStateId {
  return value === "loading" || value === "ready" || value === "empty" || value === "error"
    || value === "load-more-error"
    ? value
    : "ready";
}

export function transitionMyOrdersFixture(action: MyOrdersFixtureAction): MyOrdersPreviewState {
  return cloneMyOrdersPreviewState(TRANSITIONS[action]);
}

export const MY_ORDERS_MAP_FIXTURE = deepFreeze({
  searchCenterName: "天津奥林匹克中心体育馆南门附近超长地点名称",
  alternateSearchCenterName: "天津体育学院足球场东门附近超长搜索地点名称",
  filters: [
    { id: "distance", label: "距离最近" },
    { id: "online", label: "可在线预订" },
    { id: "district", label: "行政区" },
  ],
  venues: [
    {
      id: "7e68d7d8-4b7e-4f04-a5c5-3fe263e69c6f",
      name: "渤海元丰足球场",
      address: "天津市西青区利达路",
      meta: "距搜索中心 1.2 km · 可在线预订",
      route: "/pages/venue/index?venueId=7e68d7d8-4b7e-4f04-a5c5-3fe263e69c6f",
    },
    {
      id: "00000000-0000-4000-8000-000000000012",
      name: "天津市人民体育馆足球场",
      address: "天津市和平区贵州路33号",
      meta: "距搜索中心 4.8 km · 场馆目录",
      route: "/pages/venue/index?venueId=00000000-0000-4000-8000-000000000012",
    },
    {
      id: "00000000-0000-4000-8000-000000000013",
      name: "天津奥林匹克中心五人制足球场",
      address: "天津市南开区宾水西道1号",
      meta: "距搜索中心 6.4 km · 场馆目录",
      route: "/pages/venue/index?venueId=00000000-0000-4000-8000-000000000013",
    },
  ],
});
