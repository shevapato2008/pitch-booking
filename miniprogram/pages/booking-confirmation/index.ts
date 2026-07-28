import type { CheckoutView, CreateOrderInput, PendingOrderView } from "../../domain/booking";
import { canSubmit, reduceBooking, validateContactName, type BookingPageState } from "../../presentation/booking";
import { formatPriceCents } from "../../presentation/availability";
import { AsyncGenerationGate, canRetryUnknownSubmission, isStrictUuid } from "../../presentation/lifecycle";
import { formatShanghaiDateLabel, formatShanghaiTimeRange } from "../../presentation/shanghai-time";
import { getBookingDataSource, getCreateOrderAttemptStore, getNeutralPhoneTapCode, type CreateOrderAttempt } from "../../services/booking";

type PhoneEvent = WechatMiniprogram.CustomEvent<{
  source: "tap" | "getphonenumber";
  code?: string;
  errMsg?: string;
}>;
type ValueEvent = WechatMiniprogram.CustomEvent<{ value: string }>;
type BookingError = Error & {
  code?: string;
  details?: {
    current_checkout?: CheckoutView;
    checkout?: CheckoutView;
  };
};

function requireUuid(value: string | undefined): string {
  if (!isStrictUuid(value)) throw new Error("INVALID_SLOT_ID");
  return value;
}
function priceText(cents: number): string { return formatPriceCents(cents); }
function checkoutLabels(checkout: CheckoutView | null) {
  if (!checkout) return { dateLabel: "", timeLabel: "", durationLabel: "", price: "" };
  const durationMinutes = checkout.durationMinutes;
  const durationLabel = durationMinutes % 60 === 0 ? `${durationMinutes / 60}小时` : `${durationMinutes}分钟`;
  return { dateLabel: formatShanghaiDateLabel(checkout.startsAt), timeLabel: formatShanghaiTimeRange(checkout.startsAt, checkout.endsAt), durationLabel, price: priceText(checkout.priceCents) };
}

const initialState: BookingPageState = { session: { status: "loading" }, checkout: { status: "loading" }, contactName: "", submission: { status: "idle" } };

Page({
  data: {
    state: initialState, slotId: "", checkout: null as CheckoutView | null, maskedPhone: "", contactError: "",
    loadError: "", actionError: "", navigationError: "", phoneMessage: "", dateLabel: "", timeLabel: "", durationLabel: "", price: "",
    canSubmit: false, submitting: false, reconciling: false, priceChanged: false, changedPrice: "", slotUnavailable: false, navigationInFlight: false,
  },
  loadGate: new AsyncGenerationGate(),
  phoneGate: new AsyncGenerationGate(),
  createGate: new AsyncGenerationGate(),
  navigationGate: new AsyncGenerationGate(),
  disposed: false,
  createInFlight: false,
  retryTimer: undefined as ReturnType<typeof setTimeout> | undefined,
  retryResolve: undefined as ((value: boolean) => void) | undefined,
  createdOrder: undefined as PendingOrderView | undefined,
  navigationInFlight: false,

  onLoad(options: Record<string, string | undefined>) {
    this.disposed = false;
    try { const slotId = requireUuid(options.slot_id); this.setData({ slotId }); void this.loadSessionThenCheckout(); }
    catch { this.setData({ loadError: "预订场次无效，请返回重新选择。" }); }
  },
  onUnload() { this.disposed = true; this.loadGate.cancel(); this.phoneGate.cancel(); this.createGate.cancel(); this.navigationGate.cancel(); this.cancelRetryDelay(); this.createInFlight = false; this.navigationInFlight = false; },
  isCurrent(gate: AsyncGenerationGate, generation: number) { return !this.disposed && gate.isCurrent(generation); },
  sync(state: BookingPageState, extras: Record<string, unknown> = {}) {
    if (this.disposed) return;
    const checkout = state.checkout.status === "ready" ? state.checkout.value : null;
    const labels = checkoutLabels(checkout);
    this.setData({ state, checkout, maskedPhone: state.session.status === "ready" ? (state.session.value.maskedPhone ?? "") : "", canSubmit: canSubmit(state), submitting: state.submission.status === "submitting", reconciling: state.submission.status === "result-reconciling", priceChanged: state.submission.status === "price-changed", changedPrice: state.submission.status === "price-changed" ? priceText(state.submission.checkout.priceCents) : "", slotUnavailable: state.submission.status === "slot-unavailable", ...labels, ...extras });
  },
  async loadSessionThenCheckout() {
    const generation = this.loadGate.begin();
    let state = reduceBooking(this.data.state, { type: "SESSION_LOADING" }); this.sync(state, { loadError: "" });
    try {
      const session = await getBookingDataSource().login(); if (!this.isCurrent(this.loadGate, generation)) return;
      state = reduceBooking(state, { type: "SESSION_READY", session }); this.sync(state);
    } catch {
      if (!this.isCurrent(this.loadGate, generation)) return;
      const message = "登录失败，请重试。";
      state = reduceBooking(state, { type: "SESSION_FAILED", message });
      this.sync(state, { loadError: message });
      return;
    }
    await this.loadCheckout(state, generation);
  },
  async loadCheckout(state: BookingPageState, generation: number) {
    let loading = reduceBooking(state, { type: "CHECKOUT_LOADING" }); this.sync(loading, { loadError: "" });
    try {
      const checkout = await getBookingDataSource().getCheckout(this.data.slotId); if (!this.isCurrent(this.loadGate, generation)) return;
      loading = reduceBooking(loading, { type: "CHECKOUT_READY", checkout }); this.sync(loading, { loadError: "" });
      this.resumeStoredAttempt();
    } catch {
      if (!this.isCurrent(this.loadGate, generation)) return;
      const message = "结算信息加载失败，请重试。";
      this.sync(reduceBooking(loading, { type: "CHECKOUT_FAILED", message }), { loadError: message });
    }
  },
  onRetryLoad() {
    const state = this.data.state;
    if (state.session.status === "ready" && state.checkout.status === "failed") {
      void this.loadCheckout(state, this.loadGate.begin());
      return;
    }
    void this.loadSessionThenCheckout();
  },
  async onAuthorizePhone(event: PhoneEvent) {
    if (this.data.state.submission.status !== "idle") return;
    const neutralCode = getNeutralPhoneTapCode();
    if (event.detail.source === "getphonenumber" && neutralCode !== undefined) return;
    const rawDetail = event.detail.source === "tap" ? neutralCode : event.detail;
    if (event.detail.source === "tap" && rawDetail === undefined) return;
    const generation = this.phoneGate.begin();
    try {
      const phone = await getBookingDataSource().authorizePhone(rawDetail); if (!this.isCurrent(this.phoneGate, generation)) return;
      const session = this.data.state.session;
      if (session.status === "ready") this.sync(reduceBooking(this.data.state, { type: "SESSION_READY", session: { ...session.value, maskedPhone: phone.maskedPhone } }), { phoneMessage: "" });
    } catch (caught) {
      if (!this.isCurrent(this.phoneGate, generation)) return;
      const unavailable = (caught as BookingError).code === "PHONE_CAPABILITY_UNAVAILABLE";
      this.setData({ phoneMessage: unavailable ? "当前账号暂不支持手机号授权。" : "手机号授权未完成，请重试。" });
    }
  },
  onContactInput(event: ValueEvent) { this.sync(reduceBooking(this.data.state, { type: "CONTACT_NAME_CHANGED", contactName: event.detail.value }), { contactError: "", actionError: "" }); },
  onContactBlur(event: ValueEvent) {
    const result = validateContactName(event.detail.value);
    const contactError = result.ok ? "" : result.reason === "too-short" ? "请输入至少 2 个字符" : result.reason === "too-long" ? "联系人姓名最多 30 个字符" : "联系人姓名包含不支持的字符";
    this.setData({ contactError });
  },
  async onSubmit() {
    if (this.createInFlight) return;
    const checkout = this.data.state.checkout; if (checkout.status !== "ready" || !canSubmit(this.data.state)) return;
    const validation = validateContactName(this.data.state.contactName); if (!validation.ok) { this.setData({ contactError: "请检查联系人姓名" }); return; }
    const request: CreateOrderInput = { slotId: checkout.value.slotId, checkoutVersion: checkout.value.version, contactName: validation.normalized };
    const attempt = { request, idempotencyKey: `booking-${Date.now()}-${Math.round(Math.random() * 1e9)}` };
    getCreateOrderAttemptStore()?.save(attempt);
    const state = reduceBooking(this.data.state, { type: "SUBMIT_STARTED", idempotencyKey: attempt.idempotencyKey, request }); this.sync(state, { actionError: "", navigationError: "" });
    this.cancelRetryDelay();
    await this.runCreateAttempt(attempt, this.createGate.begin());
  },
  async runCreateAttempt(attempt: CreateOrderAttempt, generation: number) {
    if (this.createInFlight) return;
    this.createInFlight = true;
    let unknownCount = 0;
    try {
      for (;;) {
        try {
          const order = await getBookingDataSource().createOrder(attempt); if (!this.isCurrent(this.createGate, generation)) return;
          getCreateOrderAttemptStore()?.clear();
          const state = reduceBooking(this.data.state, { type: "SUBMIT_SUCCEEDED", idempotencyKey: attempt.idempotencyKey, order });
          this.createdOrder = order; this.sync(state, { actionError: "" });
          await this.navigateCreatedOrder(order); return;
        } catch (caught) {
          if (!this.isCurrent(this.createGate, generation)) return;
          const error = caught as BookingError;
          if (error.code === "SUBMISSION_RESULT_UNKNOWN") {
            let state = reduceBooking(this.data.state, { type: "SUBMIT_UNKNOWN", idempotencyKey: attempt.idempotencyKey }); this.sync(state);
            if (!canRetryUnknownSubmission(unknownCount)) { this.sync(state, { actionError: "订单结果仍在确认中，请继续确认。" }); return; }
            unknownCount += 1;
            if (!(await this.waitForRetry(generation, 500))) return;
            state = reduceBooking(this.data.state, { type: "SUBMIT_RETRY", idempotencyKey: attempt.idempotencyKey }); this.sync(state); continue;
          }
          const currentCheckout = error.details?.current_checkout ?? error.details?.checkout;
          getCreateOrderAttemptStore()?.clear();
          if (error.code === "PRICE_CHANGED" && currentCheckout) { this.sync(reduceBooking(this.data.state, { type: "PRICE_CHANGED", idempotencyKey: attempt.idempotencyKey, checkout: currentCheckout })); return; }
          if (error.code === "SLOT_NOT_AVAILABLE") { this.sync(reduceBooking(this.data.state, { type: "SLOT_UNAVAILABLE", idempotencyKey: attempt.idempotencyKey, message: "该时段刚刚被预订，请返回重选。" })); return; }
          const editable = reduceBooking(this.data.state, { type: "SUBMIT_FAILED", idempotencyKey: attempt.idempotencyKey });
          const invalid = error.code === "INVALID_CONTACT";
          this.sync(editable, { actionError: invalid ? "联系人信息无效，请修改后重试。" : "下单失败，请重试。", contactError: invalid ? "请检查联系人姓名" : this.data.contactError }); return;
        }
      }
    } finally { this.createInFlight = false; }
  },
  waitForRetry(generation: number, milliseconds: number): Promise<boolean> {
    this.cancelRetryDelay();
    return new Promise((resolve) => {
      this.retryResolve = resolve;
      this.retryTimer = setTimeout(() => { this.retryTimer = undefined; this.retryResolve = undefined; resolve(this.isCurrent(this.createGate, generation)); }, milliseconds);
    });
  },
  cancelRetryDelay() { if (this.retryTimer !== undefined) clearTimeout(this.retryTimer); this.retryTimer = undefined; this.retryResolve?.(false); this.retryResolve = undefined; },
  resumeStoredAttempt() {
    if (this.createInFlight) return;
    const attempt = getCreateOrderAttemptStore()?.load();
    if (!attempt || attempt.request.slotId !== this.data.slotId) return;
    let state = reduceBooking(this.data.state, { type: "CONTACT_NAME_CHANGED", contactName: attempt.request.contactName });
    state = reduceBooking(state, { type: "SUBMIT_STARTED", idempotencyKey: attempt.idempotencyKey, request: attempt.request });
    this.sync(state, { actionError: "", navigationError: "" });
    void this.runCreateAttempt(attempt, this.createGate.begin());
  },
  onResumeUnknown() {
    const submission = this.data.state.submission;
    if (submission.status !== "result-reconciling" || this.createInFlight) return;
    const state = reduceBooking(this.data.state, { type: "SUBMIT_RETRY", idempotencyKey: submission.idempotencyKey }); this.sync(state, { actionError: "" });
    this.cancelRetryDelay();
    void this.runCreateAttempt({ request: submission.request, idempotencyKey: submission.idempotencyKey }, this.createGate.begin());
  },
  async navigateCreatedOrder(order: PendingOrderView) {
    if (this.disposed || this.navigationInFlight) return;
    const generation = this.navigationGate.begin();
    this.navigationInFlight = true;
    this.setData({ navigationError: "", navigationInFlight: true });
    try { await wx.navigateTo({ url: `/pages/order-detail/index?order_id=${encodeURIComponent(order.orderId)}` }); }
    catch { if (this.isCurrent(this.navigationGate, generation)) this.setData({ navigationError: "订单已创建，但页面打开失败。", actionError: "" }); }
    finally { if (this.navigationGate.isCurrent(generation)) { this.navigationInFlight = false; if (!this.disposed) this.setData({ navigationInFlight: false }); } }
  },
  onRetryNavigation() { if (this.createdOrder && !this.navigationInFlight) void this.navigateCreatedOrder(this.createdOrder); },
  onAcceptPriceChange() { const submission = this.data.state.submission; if (submission.status === "price-changed") this.sync(reduceBooking(this.data.state, { type: "PRICE_CHANGE_ACCEPTED", idempotencyKey: submission.idempotencyKey }), { actionError: "" }); },
});
