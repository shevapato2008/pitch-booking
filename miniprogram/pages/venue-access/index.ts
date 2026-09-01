import type { ManagedVenue } from "../../domain/venue-access";
import { VENUE_STAFF_AUTHORIZATION_ENABLED } from "../../config/runtime";
import { VENUE_STAFF_PERMISSION_OPTIONS, type VenueStaffPermission } from "../../domain/venue-staff";
import { presentApplicationStatus, type VenueOnboardingApplication } from "../../domain/venue-onboarding";
import { readIntentHeaderLayout } from "../../presentation/intent-header-layout";
import { getVenueAccessDataSource } from "../../services/venue-access";
import { getVenueOnboardingDataSourceOrUndefined } from "../../services/venue-onboarding";

type VenueChooseEvent = { currentTarget?: { dataset?: { venueId?: unknown; applicationId?: unknown; permission?: unknown } } };
type PageError = { code?: unknown };
type WorkbenchAction = {
  readonly permission: VenueStaffPermission;
  readonly label: string;
  readonly route: string;
};
type ManagedVenueView = ManagedVenue & {
  readonly roleLabel: string;
  readonly permissionSummary: string;
  readonly workbenchActions: readonly WorkbenchAction[];
};

const permissionLabels = new Map(
  VENUE_STAFF_PERMISSION_OPTIONS.map(({ code, label }) => [code, label]),
);
const workbenchActions: readonly WorkbenchAction[] = [
  { permission: "MANAGE_PROFILE", label: "场馆资料", route: "/pages/venue-profile/index" },
  { permission: "MANAGE_PITCHES", label: "配置场地", route: "/pages/venue-pitch-setup/index" },
  { permission: "MANAGE_INVENTORY", label: "库存时段", route: "/pages/venue-inventory/index" },
  { permission: "FULFILL_ORDERS", label: "今日订单", route: "/pages/venue-fulfillment/index" },
];

function presentVenue(venue: ManagedVenue): ManagedVenueView {
  return {
    ...venue,
    roleLabel: venue.role === "OWNER" ? "场馆负责人" : "场馆员工",
    permissionSummary: venue.role === "OWNER"
      ? "全部工作权限"
      : venue.permissions.map((permission) => permissionLabels.get(permission)).join("、"),
    workbenchActions: workbenchActions.filter(({ permission }) =>
      venue.permissions.includes(permission)
    ),
  };
}

function workbenchUrl(
  venue: ManagedVenue,
  permission: VenueStaffPermission,
): string | undefined {
  if (!venue.permissions.includes(permission)) return undefined;
  const route = workbenchActions.find((item) => item.permission === permission)?.route;
  return route ? `${route}?venue_id=${encodeURIComponent(venue.id)}` : undefined;
}

Page({
  data: {
    title: "我的场馆",
    mode: "loading",
    venues: [] as ManagedVenueView[],
    applications: [] as readonly (VenueOnboardingApplication & { statusLabel: string; statusTone: string })[],
    applicationsError: "",
    retrying: false,
    errorMessage: "",
    headerTopPx: 0,
    headerRowHeightPx: 44,
    headerRightInsetPx: 0,
    staffAuthorizationEnabled: VENUE_STAFF_AUTHORIZATION_ENABLED,
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
          venues: venues.map(presentVenue),
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
    const permission = event.currentTarget?.dataset?.permission;
    const venue = typeof venueId === "string"
      ? this.data.venues.find((item: ManagedVenueView) => item.id === venueId)
      : undefined;
    if (
      !venue
      || typeof permission !== "string"
      || !workbenchActions.some((item) => item.permission === permission)
    ) return;
    this.enterWorkbench(venue, permission as VenueStaffPermission);
  },

  enterWorkbench(venue: ManagedVenue, permission: VenueStaffPermission) {
    if (this.redirected || this.disposed) return;
    const url = workbenchUrl(venue, permission);
    if (!url) return;
    this.redirected = true;
    wx.redirectTo({
      url,
      fail: () => {
        if (this.disposed) return;
        this.redirected = false;
        this.setData({ mode: "error", errorMessage: "进入场馆工作台失败，请重试" });
      },
    });
  },

  onOpenStaff(event: VenueChooseEvent) {
    if (!this.data.staffAuthorizationEnabled) return;
    const venueId = event.currentTarget?.dataset?.venueId;
    if (
      typeof venueId !== "string"
      || !this.data.venues.some((venue: ManagedVenueView) => venue.id === venueId)
    ) return;
    wx.navigateTo({
      url: `/pages/venue-staff/index?venue_id=${encodeURIComponent(venueId)}`,
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
