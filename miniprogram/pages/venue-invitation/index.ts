import type { VenueRecruitmentInvitation } from "../../domain/venue-recruitment-invitation";
import { readIntentHeaderLayout } from "../../presentation/intent-header-layout";
import {
  createOnboardingIdempotencyKey,
  getVenueOnboardingDataSource,
} from "../../services/venue-onboarding";

interface InvitationOptions { token?: unknown }

type ViewMode = "loading" | "ready" | "claimed" | "submitted" | "unavailable" | "error";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

Page({
  data: {
    mode: "loading" as ViewMode,
    title: "正在读取邀请",
    description: "请稍候，正在核对这份平台招商邀请。",
    statusLabel: "加载中",
    actionLabel: "重新检查邀请",
    actionKind: "retry" as "accept" | "claim" | "applications" | "retry",
    tone: "muted" as "ready" | "success" | "muted",
    venue: null as VenueRecruitmentInvitation["venue"] | null,
    expiresAtLabel: "",
    busy: false,
    headerTopPx: 0,
    headerRowHeightPx: 44,
  },

  token: "",
  disposed: false,
  acceptAttempt: undefined as string | undefined,

  async onLoad(options: InvitationOptions = {}) {
    this.disposed = false;
    const header = readIntentHeaderLayout();
    wx.hideShareMenu();
    this.setData({ headerTopPx: header.topPx, headerRowHeightPx: header.rowHeightPx });
    this.token = typeof options.token === "string" ? options.token : "";
    if (!TOKEN_PATTERN.test(this.token)) {
      this.showUnavailable();
      return;
    }
    await this.loadInvitation();
  },

  onUnload() { this.disposed = true; },

  async loadInvitation() {
    if (this.data.busy) return;
    this.setData({ busy: true });
    try {
      const source = getVenueOnboardingDataSource();
      if (!source.readInvitation) throw new Error("VENUE_INVITATION_DATA_SOURCE_NOT_CONFIGURED");
      const invitation = await source.readInvitation(this.token);
      if (!this.disposed) this.applyInvitation(invitation);
    } catch (caught) {
      if (this.disposed) return;
      const code = errorCode(caught);
      if (code === "VENUE_INVITATION_NOT_FOUND" || code === "VENUE_INVITATION_UNAVAILABLE") {
        this.showUnavailable();
      } else {
        this.setView("error");
      }
    } finally {
      if (!this.disposed) this.setData({ busy: false });
    }
  },

  async onPrimaryAction() {
    if (this.data.busy) return;
    if (this.data.actionKind === "retry") {
      await this.loadInvitation();
      return;
    }
    if (this.data.actionKind === "applications") {
      wx.navigateTo({ url: "/pages/venue-access/index" });
      return;
    }
    if (this.data.actionKind === "claim") {
      this.openLockedClaim();
      return;
    }
    this.setData({ busy: true });
    this.acceptAttempt ??= createOnboardingIdempotencyKey("venue-invitation-accept");
    try {
      const source = getVenueOnboardingDataSource();
      if (!source.acceptInvitation) throw new Error("VENUE_INVITATION_DATA_SOURCE_NOT_CONFIGURED");
      const invitation = await source.acceptInvitation(this.token, this.acceptAttempt);
      if (this.disposed) return;
      this.applyInvitation(invitation);
      this.openLockedClaim();
    } catch (caught) {
      if (this.disposed) return;
      const code = errorCode(caught);
      if (code === "VENUE_INVITATION_NOT_FOUND" || code === "VENUE_INVITATION_UNAVAILABLE") {
        this.showUnavailable();
      } else {
        this.setView("error");
      }
    } finally {
      if (!this.disposed) this.setData({ busy: false });
    }
  },

  applyInvitation(invitation: VenueRecruitmentInvitation) {
    this.setData({
      venue: invitation.venue,
      expiresAtLabel: formatExpiry(invitation.expiresAt),
    });
    if (invitation.viewerState === "AVAILABLE") this.setView("ready");
    else if (invitation.viewerState === "CLAIMED_BY_VIEWER") this.setView("claimed");
    else this.setView("submitted");
  },

  setView(mode: ViewMode) {
    this.setData({ mode, ...VIEWS[mode] });
  },

  showUnavailable() { this.setView("unavailable"); },

  openLockedClaim() {
    const venue = this.data.venue;
    if (!venue) return;
    wx.navigateTo({
      url: `/pages/venue-claim/index?invitation_token=${encodeURIComponent(this.token)}`,
    });
  },

  onHeaderBack() {
    if (getCurrentPages().length > 1) wx.navigateBack({ delta: 1 });
    else wx.reLaunch({ url: "/pages/intent-entry/index" });
  },
});

const VIEWS: Readonly<Record<ViewMode, {
  title: string;
  description: string;
  statusLabel: string;
  actionLabel: string;
  actionKind: "accept" | "claim" | "applications" | "retry";
  tone: "ready" | "success" | "muted";
}>> = {
  loading: { title: "正在读取邀请", description: "请稍候，正在核对这份平台招商邀请。", statusLabel: "加载中", actionLabel: "重新检查邀请", actionKind: "retry", tone: "muted" },
  ready: { title: "邀请你认领这家场馆", description: "接受后仍需补充认领材料，并由平台人工审核。接受邀请不会直接获得管理权限。", statusLabel: "等待你接受", actionLabel: "接受邀请并继续认领", actionKind: "accept", tone: "ready" },
  claimed: { title: "邀请已为你保留", description: "目标场馆不可修改。请补充管理授权与场馆外部照片，提交后进入平台人工审核。", statusLabel: "已绑定当前账号", actionLabel: "补充认领资料", actionKind: "claim", tone: "success" },
  submitted: { title: "材料已经提交", description: "平台会核对场馆身份与授权材料。审核通过前，你不会获得场馆管理权限。", statusLabel: "认领申请待审核", actionLabel: "查看我的场馆申请", actionKind: "applications", tone: "success" },
  unavailable: { title: "这份邀请已失效", description: "邀请可能已过期、被撤销或绑定到其他账号。请联系发送邀请的平台工作人员。", statusLabel: "邀请不可用", actionLabel: "重新检查邀请", actionKind: "retry", tone: "muted" },
  error: { title: "暂时无法读取邀请", description: "网络开了个小差。请重新检查邀请，结果以服务端返回为准。", statusLabel: "加载失败", actionLabel: "重新检查邀请", actionKind: "retry", tone: "muted" },
};

function errorCode(caught: unknown): string {
  return typeof caught === "object" && caught !== null && "code" in caught
    && typeof (caught as { code?: unknown }).code === "string"
    ? (caught as { code: string }).code
    : "UNKNOWN";
}

function formatExpiry(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "以服务端为准";
  const china = new Date(timestamp + 8 * 60 * 60 * 1000);
  const month = china.getUTCMonth() + 1;
  const day = china.getUTCDate();
  const hour = String(china.getUTCHours()).padStart(2, "0");
  const minute = String(china.getUTCMinutes()).padStart(2, "0");
  return `有效至 ${month}月${day}日 ${hour}:${minute}`;
}
