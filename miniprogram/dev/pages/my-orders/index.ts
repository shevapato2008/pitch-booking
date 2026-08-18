import {
  cloneMyOrdersPreviewState,
  readMyOrdersPreviewState,
  transitionMyOrdersFixture,
  type MyOrdersFixtureAction,
  type MyOrdersPreviewState,
} from "../../my-orders-fixture";

interface MyOrdersPageOptions {
  readonly state?: unknown;
}

interface OrderTapEvent {
  readonly currentTarget?: { readonly dataset?: { readonly orderId?: unknown } };
}

const TRANSITION_DELAY_MS = 180;

Page({
  data: cloneMyOrdersPreviewState("ready"),
  transitionTimer: undefined as ReturnType<typeof setTimeout> | undefined,

  onLoad(options: MyOrdersPageOptions = {}) {
    this.clearTransition();
    this.applyPreview(cloneMyOrdersPreviewState(readMyOrdersPreviewState(options.state)));
  },

  applyPreview(state: MyOrdersPreviewState) {
    this.setData(state);
  },

  scheduleTransition(action: MyOrdersFixtureAction, after?: () => void) {
    this.clearTransition();
    this.transitionTimer = setTimeout(() => {
      this.transitionTimer = undefined;
      this.applyPreview(transitionMyOrdersFixture(action));
      after?.();
    }, TRANSITION_DELAY_MS);
  },

  clearTransition() {
    if (this.transitionTimer !== undefined) clearTimeout(this.transitionTimer);
    this.transitionTimer = undefined;
  },

  onOpenOrder(event: OrderTapEvent) {
    const orderId = event.currentTarget?.dataset?.orderId;
    if (typeof orderId !== "string") return;
    const order = this.data.orders.find((candidate) => candidate.orderId === orderId);
    if (order) wx.navigateTo({ url: order.route });
  },

  onGoSelectVenue() {
    wx.navigateBack({
      delta: 1,
      fail: () => wx.reLaunch({ url: "/pages/venue-map/index" }),
    });
  },

  onRetry() {
    this.applyPreview(transitionMyOrdersFixture("retry"));
    this.scheduleTransition("retry-resolved");
  },

  onPullDownRefresh() {
    this.applyPreview(transitionMyOrdersFixture("refresh"));
    this.scheduleTransition("refresh-resolved", () => wx.stopPullDownRefresh());
  },

  onLoadMore() {
    if (!this.data.hasMore || this.data.loadingMore) return;
    this.applyPreview(transitionMyOrdersFixture("load-more"));
    this.scheduleTransition("load-more-failed");
  },

  onRetryLoadMore() {
    if (!this.data.loadMoreError) return;
    this.applyPreview(transitionMyOrdersFixture("retry-load-more"));
    this.scheduleTransition("load-more-resolved");
  },

  onUnload() {
    this.clearTransition();
  },
});
