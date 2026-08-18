import { presentMyOrder, type MyOrderCardViewModel } from "../../presentation/my-orders";
import { getBookingDataSource } from "../../services/booking";

interface OrderTapEvent {
  readonly currentTarget?: { readonly dataset?: { readonly orderId?: unknown } };
}

Page({
  data: {
    orders: [] as readonly MyOrderCardViewModel[],
    nextCursor: null as string | null,
    loading: true,
    refreshing: false,
    loadingMore: false,
    loadMoreError: false,
    errorText: "",
    refreshErrorText: "",
    end: false,
  },
  requestRevision: 0,
  alive: true,

  onLoad() {
    this.alive = true;
    return this.loadFirstPage(false);
  },

  onUnload() {
    this.alive = false;
    this.requestRevision += 1;
  },

  beginRequest() {
    this.requestRevision += 1;
    return this.requestRevision;
  },

  isCurrent(revision: number) {
    return this.alive && revision === this.requestRevision;
  },

  async loadFirstPage(refreshing: boolean) {
    const revision = this.beginRequest();
    const preservesExistingOrders = refreshing && this.data.orders.length > 0;
    this.setData(preservesExistingOrders
      ? {
          loading: false, refreshing: true, loadingMore: false,
          loadMoreError: false, errorText: "", refreshErrorText: "",
        }
      : {
          loading: true, refreshing: false, errorText: "", refreshErrorText: "",
          loadingMore: false, loadMoreError: false,
        });
    try {
      const source = getBookingDataSource();
      if (!source.listOrders) throw new Error("ORDER_LIST_DATA_SOURCE_NOT_CONFIGURED");
      const response = await source.listOrders();
      if (!this.isCurrent(revision)) return;
      const orders = response.orders.map(presentMyOrder);
      this.setData({
        orders,
        nextCursor: response.nextCursor,
        loading: false,
        refreshing: false,
        errorText: "",
        refreshErrorText: "",
        end: orders.length > 0 && response.nextCursor === null,
      });
    } catch {
      if (!this.isCurrent(revision)) return;
      if (preservesExistingOrders) {
        this.setData({ refreshing: false, refreshErrorText: "刷新失败，请下拉重试" });
      } else {
        this.setData({
          loading: false,
          refreshing: false,
          errorText: "订单暂时无法加载",
          refreshErrorText: "",
        });
      }
    }
  },

  onRetry() {
    return this.loadFirstPage(false);
  },

  async onPullDownRefresh() {
    try {
      await this.loadFirstPage(true);
    } finally {
      wx.stopPullDownRefresh();
    }
  },

  onLoadMore() {
    return this.loadMore();
  },

  onRetryLoadMore() {
    if (!this.data.loadMoreError) return;
    return this.loadMore();
  },

  async loadMore() {
    const cursor = this.data.nextCursor;
    if (!cursor || this.data.loading || this.data.refreshing || this.data.loadingMore) return;
    const revision = this.beginRequest();
    this.setData({ loadingMore: true, loadMoreError: false });
    try {
      const source = getBookingDataSource();
      if (!source.listOrders) throw new Error("ORDER_LIST_DATA_SOURCE_NOT_CONFIGURED");
      const response = await source.listOrders(cursor);
      if (!this.isCurrent(revision)) return;
      const existingIds = new Set(this.data.orders.map(({ orderId }) => orderId));
      const additional = response.orders.filter(({ orderId }) => !existingIds.has(orderId)).map(presentMyOrder);
      this.setData({
        orders: [...this.data.orders, ...additional],
        nextCursor: response.nextCursor,
        loadingMore: false,
        loadMoreError: false,
        end: response.nextCursor === null,
      });
    } catch {
      if (this.isCurrent(revision)) this.setData({ loadingMore: false, loadMoreError: true });
    }
  },

  onOpenOrder(event: OrderTapEvent) {
    const orderId = event.currentTarget?.dataset?.orderId;
    if (typeof orderId !== "string") return;
    const order = this.data.orders.find((candidate) => candidate.orderId === orderId);
    if (order) wx.navigateTo({ url: order.detailRoute });
  },

  onGoSelectVenue() {
    const pages = getCurrentPages();
    const previousPage = pages.length > 1 ? pages[pages.length - 2] : undefined;
    if (previousPage?.route === "pages/venue-map/index") {
      wx.navigateBack({
        delta: 1,
        fail: () => wx.reLaunch({ url: "/pages/venue-map/index" }),
      });
      return;
    }
    wx.reLaunch({ url: "/pages/venue-map/index" });
  },
});
