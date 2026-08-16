import { readIntentHeaderLayout } from "../../presentation/intent-header-layout";
import { getVenueAccessDataSource } from "../../services/venue-access";
import type { ManagedVenue } from "../../domain/venue-access";

type VenueChooseEvent = { currentTarget?: { dataset?: { venueId?: unknown } } };
type PageError = { code?: unknown };

const workbenchUrl = (venueId: string) => `/pages/venue-profile/index?venue_id=${encodeURIComponent(venueId)}`;

Page({
  data: {
    title: "场馆管理",
    mode: "loading",
    venues: [] as ManagedVenue[],
    retrying: false,
    errorMessage: "",
    headerTopPx: 0,
    headerRowHeightPx: 44,
    headerRightInsetPx: 0,
  },

  disposed: false,
  redirected: false,
  requestInFlight: undefined as Promise<void> | undefined,

  async onLoad() {
    this.disposed = false;
    const layout = readIntentHeaderLayout();
    this.setData({
      headerTopPx: layout.topPx,
      headerRowHeightPx: layout.rowHeightPx,
      headerRightInsetPx: layout.rightInsetPx,
    });
    await this.loadManagedVenues();
  },

  onUnload() { this.disposed = true; },

  loadManagedVenues(): Promise<void> {
    if (this.redirected) return Promise.resolve();
    if (this.requestInFlight) return this.requestInFlight;
    this.setData({ mode: "loading", errorMessage: "" });
    const request = (async () => {
      try {
        const source = getVenueAccessDataSource();
        await source.login();
        const venues = await source.listManagedVenues();
        if (this.disposed) return;
        if (venues.length === 1) {
          this.enterWorkbench(venues[0].id);
          return;
        }
        this.setData({
          title: venues.length === 0 ? "场馆管理" : "选择管理场馆",
          mode: venues.length === 0 ? "empty" : "multiple",
          venues: [...venues],
        });
      } catch (caught) {
        if (this.disposed) return;
        const code = (caught as PageError)?.code;
        this.setData({
          mode: "error",
          venues: [],
          errorMessage: code === "LOGIN_FAILED" ? "微信登录失败，请重试" : "场馆权限暂时无法读取，请重试",
        });
      } finally {
        this.requestInFlight = undefined;
      }
    })();
    this.requestInFlight = request;
    return request;
  },

  async onRetry() {
    if (this.data.retrying || this.redirected) return;
    this.setData({ retrying: true });
    await this.loadManagedVenues();
    if (!this.disposed) this.setData({ retrying: false });
  },

  onChooseVenue(event: VenueChooseEvent) {
    const venueId = event.currentTarget?.dataset?.venueId;
    if (typeof venueId !== "string" || !this.data.venues.some((venue: { id: string }) => venue.id === venueId)) return;
    this.enterWorkbench(venueId);
  },

  enterWorkbench(venueId: string) {
    if (this.redirected || this.disposed) return;
    this.redirected = true;
    this.setData({ mode: "redirecting" });
    wx.redirectTo({
      url: workbenchUrl(venueId),
      fail: () => {
        if (this.disposed) return;
        this.redirected = false;
        this.setData({ mode: "error", errorMessage: "进入场馆工作台失败，请重试" });
      },
    });
  },

  onBackToEntry() {
    wx.reLaunch({ url: "/pages/intent-entry/index" });
  },
});
