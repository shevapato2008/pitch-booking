import type { ManagedVenue } from "../../domain/venue-access";
import { presentApplicationStatus, type VenueOnboardingApplication } from "../../domain/venue-onboarding";
import { readIntentHeaderLayout } from "../../presentation/intent-header-layout";
import { getVenueAccessDataSource } from "../../services/venue-access";
import { getVenueOnboardingDataSourceOrUndefined } from "../../services/venue-onboarding";

type VenueChooseEvent = { currentTarget?: { dataset?: { venueId?: unknown; applicationId?: unknown } } };
type PageError = { code?: unknown };

const workbenchUrl = (venueId: string) => `/pages/venue-profile/index?venue_id=${encodeURIComponent(venueId)}`;

Page({
  data: {
    title: "我的场馆",
    mode: "loading",
    venues: [] as ManagedVenue[],
    applications: [] as readonly (VenueOnboardingApplication & { statusLabel: string; statusTone: string })[],
    applicationsError: "",
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

  onShow() {
    if (this.data.mode !== "loading" && !this.requestInFlight) void this.loadManagedVenues();
  },

  onUnload() { this.disposed = true; },

  loadManagedVenues(): Promise<void> {
    if (this.requestInFlight) return this.requestInFlight;
    this.setData({ mode: "loading", errorMessage: "" });
    const request = (async () => {
      try {
        const source = getVenueAccessDataSource();
        await source.login();
        const venues = await source.listManagedVenues();
        const onboarding = getVenueOnboardingDataSourceOrUndefined();
        let applications: readonly VenueOnboardingApplication[] = [];
        let applicationsError = "";
        if (onboarding) {
          try { applications = (await onboarding.listApplications()).items; } catch { applicationsError = "申请状态暂时无法读取，请重试"; }
        }
        if (this.disposed) return;
        this.setData({
          title: "我的场馆",
          mode: venues.length === 0 ? "empty" : "ready",
          venues: [...venues],
          applications: applications.map((application) => ({
            ...application,
            statusLabel: presentApplicationStatus(application.status).label,
            statusTone: presentApplicationStatus(application.status).tone,
          })),
          applicationsError,
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
    if (this.data.retrying) return;
    this.setData({ retrying: true });
    await this.loadManagedVenues();
    if (!this.disposed) this.setData({ retrying: false });
  },

  onChooseVenue(event: VenueChooseEvent) {
    const venueId = event.currentTarget?.dataset?.venueId;
    if (typeof venueId !== "string" || !this.data.venues.some((venue: ManagedVenue) => venue.id === venueId)) return;
    this.enterWorkbench(venueId);
  },

  enterWorkbench(venueId: string) {
    if (this.redirected || this.disposed) return;
    this.redirected = true;
    wx.redirectTo({
      url: workbenchUrl(venueId),
      fail: () => {
        if (this.disposed) return;
        this.redirected = false;
        this.setData({ mode: "error", errorMessage: "进入场馆工作台失败，请重试" });
      },
    });
  },

  onOpenClaim() { wx.navigateTo({ url: "/pages/venue-claim/index" }); },
  onOpenCreate() { wx.navigateTo({ url: "/pages/venue-create/index" }); },
  onOpenApplication(event: VenueChooseEvent) {
    const { applicationId, kind, status } = event.currentTarget?.dataset as { applicationId?: unknown; kind?: unknown; status?: unknown } ?? {};
    if (typeof applicationId !== "string" || status !== "REJECTED" || (kind !== "CLAIM" && kind !== "CREATE")) return;
    const route = kind === "CLAIM" ? "venue-claim" : "venue-create";
    wx.navigateTo({ url: `/pages/${route}/index?application_id=${encodeURIComponent(applicationId)}` });
  },
  onBackToEntry() { wx.reLaunch({ url: "/pages/intent-entry/index" }); },
});
