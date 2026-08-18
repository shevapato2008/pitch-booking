import type { VenueFulfillmentOrder, VenueFulfillmentPage } from "../../domain/venue-fulfillment";
import { readInventoryHeaderLayout } from "../../presentation/inventory-layout";
import {
  presentSelectedServiceDate,
  presentVenueFulfillmentOrder,
  presentVenueServiceDates,
} from "../../presentation/venue-fulfillment";
import { VenueFulfillmentApiError } from "../../services/http-venue-fulfillment";
import { getVenueFulfillmentAttemptStore } from "../../services/venue-fulfillment-attempt-store";
import {
  getVenueFulfillmentDataSource,
  type VenueFulfillmentMutationAttempt,
} from "../../services/venue-fulfillment";

type DatasetEvent = { currentTarget?: { dataset?: Record<string, unknown> } };
type InputEvent = { detail?: { value?: unknown } };
type MutationKind = VenueFulfillmentMutationAttempt["kind"];

const attemptKey = (kind: MutationKind) => `venue-fulfillment-${kind}-${Date.now()}-${Math.round(Math.random() * 1e9)}`;
const codeOf = (caught: unknown) => caught instanceof VenueFulfillmentApiError ? caught.code : "";
const ACTION_ERRORS: Readonly<Record<string, string>> = {
  ORDER_STATE_CHANGED: "订单状态已变化，请刷新后重试",
  IDEMPOTENCY_KEY_REUSED: "本次操作凭据已失效，请刷新后重试",
  REFUND_IN_PROGRESS: "该订单的退款已在处理中",
  INVALID_ARGUMENT: "提交内容不符合要求，请检查后重试",
  ORDER_NOT_FOUND: "订单不存在或已不可操作",
  AUTH_REQUIRED: "登录状态已失效，请重新进入页面",
};
const actionError = (caught: unknown) => ACTION_ERRORS[codeOf(caught)] ?? "操作失败，请重试";

Page({
  data: {
    venueId: "", venueName: "", mode: "loading", serviceDate: "", selectedDateLabel: "", dates: [] as unknown[], orders: [] as unknown[], nextCursor: null as string | null,
    refreshing: false, loadingMore: false, loadMoreError: false, refreshErrorText: "", actionError: "", mutatingOrderId: "", mutatingKind: "",
    unknownAttempt: null as VenueFulfillmentMutationAttempt | null, recoveryBusy: false,
    sheetOpen: false, refundOrderId: "", refundOrderNumber: "", refundReason: "", refundReasonValid: false, refundError: "", refundBusy: false,
    headerTopPx: 0, headerRowHeightPx: 44, headerRightInsetPx: 0,
  },
  requestRevision: 0,
  alive: true,
  confirmingOrderId: "",
  authorityOrders: [] as VenueFulfillmentOrder[],

  async onLoad(options: Record<string, string | undefined> = {}) {
    this.alive = true;
    const venueId = options.venue_id ?? "";
    const layout = readInventoryHeaderLayout();
    this.setData({ venueId, headerTopPx: layout.topPx, headerRowHeightPx: layout.rowHeightPx, headerRightInsetPx: layout.rightInsetPx });
    if (!venueId) { this.setData({ mode: "read-error" }); return; }
    try {
      await getVenueFulfillmentDataSource().login();
      await this.readOrders(undefined, undefined, false, true);
    } catch { if (this.alive) this.setData({ mode: "read-error" }); }
  },

  onUnload() { this.alive = false; this.requestRevision += 1; },

  async readOrders(serviceDate?: string, cursor?: string, append = false, initial = false) {
    const revision = ++this.requestRevision;
    if (initial) this.setData({ mode: "loading", refreshErrorText: "", loadMoreError: false });
    const page = await getVenueFulfillmentDataSource().listOrders(this.data.venueId, serviceDate, cursor);
    if (!this.alive || revision !== this.requestRevision) return null;
    this.applyPage(page, append);
    return page;
  },

  applyPage(page: VenueFulfillmentPage, append: boolean) {
    const merged = append ? [...this.authorityOrders, ...page.orders] : [...page.orders];
    const seen = new Set<string>();
    this.authorityOrders = merged.filter((order) => !seen.has(order.orderId) && Boolean(seen.add(order.orderId)));
    this.setData({
      venueName: page.venue.name,
      serviceDate: page.serviceDate,
      selectedDateLabel: presentSelectedServiceDate(page.serviceDate),
      dates: [...presentVenueServiceDates(page.serviceDate)],
      orders: this.authorityOrders.map(presentVenueFulfillmentOrder),
      nextCursor: page.nextCursor,
      mode: this.authorityOrders.length === 0 ? "empty" : "ready",
      refreshErrorText: "", loadMoreError: false,
    });
  },

  async onSelectDate(event: DatasetEvent) {
    const serviceDate = event.currentTarget?.dataset?.serviceDate;
    if (typeof serviceDate !== "string" || serviceDate === this.data.serviceDate) return;
    this.setData({ mode: "loading", refreshErrorText: "", actionError: "" });
    try { await this.readOrders(serviceDate, undefined, false); } catch { if (this.alive) this.setData({ mode: "read-error" }); }
  },

  async onRetry() {
    this.setData({ mode: "loading", actionError: "" });
    try { await this.readOrders(this.data.serviceDate || undefined, undefined, false); } catch { if (this.alive) this.setData({ mode: "read-error" }); }
  },

  async onPullDownRefresh() {
    this.setData({ refreshing: true, refreshErrorText: "" });
    try { await this.readOrders(this.data.serviceDate || undefined, undefined, false); }
    catch { if (this.alive) this.setData({ refreshErrorText: "刷新失败，请重试" }); }
    finally { if (this.alive) this.setData({ refreshing: false }); wx.stopPullDownRefresh(); }
  },

  async onLoadMore() {
    if (!this.data.nextCursor || this.data.loadingMore) return;
    this.setData({ loadingMore: true, loadMoreError: false });
    try { await this.readOrders(this.data.serviceDate, this.data.nextCursor, true); }
    catch { if (this.alive) this.setData({ loadMoreError: true }); }
    finally { if (this.alive) this.setData({ loadingMore: false }); }
  },
  onRetryLoadMore() { return this.onLoadMore(); },

  onBack() {
    wx.navigateBack({ delta: 1, fail: () => wx.reLaunch({ url: `/pages/venue-profile/index?venue_id=${encodeURIComponent(this.data.venueId)}` }) });
  },

  orderFor(event: DatasetEvent): VenueFulfillmentOrder | undefined {
    const orderId = event.currentTarget?.dataset?.orderId;
    return typeof orderId === "string" ? this.authorityOrders.find((order) => order.orderId === orderId) : undefined;
  },

  confirm(title: string, content: string): Promise<boolean> {
    return new Promise((resolve) => wx.showModal({ title, content, confirmText: "确认", success: (result) => resolve(Boolean(result.confirm)), fail: () => resolve(false) }));
  },

  async onCheckIn(event: DatasetEvent) {
    const order = this.orderFor(event);
    if (!order?.allowedActions.canCheckIn || this.data.mutatingOrderId || this.data.unknownAttempt || this.confirmingOrderId) return;
    this.confirmingOrderId = order.orderId;
    const confirmed = await this.confirm("确认签到", `确认订单 ${order.orderNumber} 的用户已到场？`);
    this.confirmingOrderId = "";
    if (!confirmed) return;
    await this.runAttempt({ kind: "checkIn", venueId: this.data.venueId, orderId: order.orderId, idempotencyKey: attemptKey("checkIn") });
  },

  async onComplete(event: DatasetEvent) {
    const order = this.orderFor(event);
    if (!order?.allowedActions.canComplete || this.data.mutatingOrderId || this.data.unknownAttempt || this.confirmingOrderId) return;
    this.confirmingOrderId = order.orderId;
    const confirmed = await this.confirm("完成服务", `确认订单 ${order.orderNumber} 已完成服务？`);
    this.confirmingOrderId = "";
    if (!confirmed) return;
    await this.runAttempt({ kind: "complete", venueId: this.data.venueId, orderId: order.orderId, idempotencyKey: attemptKey("complete") });
  },

  onOpenRefund(event: DatasetEvent) {
    const order = this.orderFor(event);
    if (!order?.allowedActions.canRefund || this.data.mutatingOrderId || this.data.unknownAttempt || this.confirmingOrderId) return;
    this.setData({ sheetOpen: true, refundOrderId: order.orderId, refundOrderNumber: order.orderNumber, refundReason: "", refundReasonValid: false, refundError: "" });
  },
  onRefundReasonInput(event: InputEvent) {
    const value = typeof event.detail?.value === "string" ? event.detail.value : "";
    this.setData({ refundReason: value, refundReasonValid: value.trim().length > 0, refundError: "" });
  },
  onCancelRefund() { if (!this.data.refundBusy) this.setData({ sheetOpen: false, refundError: "" }); },

  async onConfirmRefund() {
    const reason = this.data.refundReason.trim();
    if (!reason) { this.setData({ refundError: "请填写退款原因" }); return; }
    const order = this.authorityOrders.find((item) => item.orderId === this.data.refundOrderId);
    if (!order?.allowedActions.canRefund || this.data.refundBusy || this.data.unknownAttempt) return;
    this.setData({ refundBusy: true, actionError: "" });
    const attempt = { kind: "refund", venueId: this.data.venueId, orderId: order.orderId, reason, idempotencyKey: attemptKey("refund") } as const;
    try {
      const stable = getVenueFulfillmentAttemptStore()?.begin(attempt) ?? attempt;
      if (stable.kind !== "refund") throw new Error("REFUND_ATTEMPT_CONFLICT");
      await getVenueFulfillmentDataSource().refund(stable);
      getVenueFulfillmentAttemptStore()?.clear();
      this.setData({ sheetOpen: false, unknownAttempt: null });
      try { await this.readOrders(this.data.serviceDate, undefined, false); }
      catch { if (this.alive) this.setData({ refreshErrorText: "退款已提交，订单刷新失败，请下拉重试" }); }
    } catch (caught) {
      if (codeOf(caught) === "FULFILLMENT_RESULT_UNKNOWN") await this.reconcileUnknown(attempt);
      else { getVenueFulfillmentAttemptStore()?.clear(); this.setData({ unknownAttempt: null, refundError: actionError(caught) }); }
    } finally { if (this.alive) this.setData({ refundBusy: false }); }
  },

  async runAttempt(attempt: VenueFulfillmentMutationAttempt) {
    if (this.data.mutatingOrderId) return;
    this.setData({ mutatingOrderId: attempt.orderId, mutatingKind: attempt.kind, actionError: "" });
    try {
      const stable = getVenueFulfillmentAttemptStore()?.begin(attempt) ?? attempt;
      const order = stable.kind === "checkIn"
        ? await getVenueFulfillmentDataSource().checkIn(stable)
        : stable.kind === "complete"
          ? await getVenueFulfillmentDataSource().complete(stable)
          : null;
      if (order) this.replaceOrder(order);
      getVenueFulfillmentAttemptStore()?.clear();
      this.setData({ unknownAttempt: null });
    } catch (caught) {
      if (codeOf(caught) === "FULFILLMENT_RESULT_UNKNOWN") await this.reconcileUnknown(attempt);
      else { getVenueFulfillmentAttemptStore()?.clear(); this.setData({ unknownAttempt: null, actionError: actionError(caught) }); }
    } finally { if (this.alive) this.setData({ mutatingOrderId: "", mutatingKind: "" }); }
  },

  replaceOrder(order: VenueFulfillmentOrder) {
    this.authorityOrders = this.authorityOrders.map((item) => item.orderId === order.orderId ? order : item);
    this.setData({ orders: this.authorityOrders.map(presentVenueFulfillmentOrder) });
  },

  applied(attempt: VenueFulfillmentMutationAttempt): boolean {
    const order = this.authorityOrders.find((item) => item.orderId === attempt.orderId);
    if (!order) return false;
    if (attempt.kind === "checkIn") return order.checkedInAt !== null;
    if (attempt.kind === "complete") return order.status === "COMPLETED";
    return order.status === "REFUND_PENDING" || order.status === "REFUNDED";
  },

  async reconcileUnknown(attempt: VenueFulfillmentMutationAttempt) {
    try {
      await this.readOrders(this.data.serviceDate || undefined, undefined, false);
      if (this.applied(attempt)) {
        getVenueFulfillmentAttemptStore()?.clear();
        this.setData({ unknownAttempt: null, sheetOpen: false });
      } else this.setData({ unknownAttempt: attempt, actionError: "操作结果尚未确认，请重试核对" });
    } catch { this.setData({ unknownAttempt: attempt, actionError: "操作结果尚未确认，请重试核对" }); }
  },

  async onRetryUnknown() {
    if (this.data.recoveryBusy) return;
    const attempt = getVenueFulfillmentAttemptStore()?.load() ?? this.data.unknownAttempt;
    if (!attempt) return;
    this.setData({ recoveryBusy: true, actionError: "" });
    try {
      if (attempt.kind === "refund") {
        await getVenueFulfillmentDataSource().refund(attempt);
        getVenueFulfillmentAttemptStore()?.clear();
        this.setData({ unknownAttempt: null, sheetOpen: false });
        try { await this.readOrders(this.data.serviceDate, undefined, false); }
        catch { if (this.alive) this.setData({ refreshErrorText: "退款已提交，订单刷新失败，请下拉重试" }); }
      } else await this.runAttempt(attempt);
    } catch (caught) {
      if (codeOf(caught) === "FULFILLMENT_RESULT_UNKNOWN") await this.reconcileUnknown(attempt);
      else { getVenueFulfillmentAttemptStore()?.clear(); this.setData({ unknownAttempt: null, actionError: actionError(caught) }); }
    }
    finally { if (this.alive) this.setData({ recoveryBusy: false }); }
  },
});
