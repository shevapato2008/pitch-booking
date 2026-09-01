import { VENUE_STAFF_PERMISSION_OPTIONS, type CurrentVenueStaffInvitation } from "../../domain/venue-staff";
import { readInventoryHeaderLayout } from "../../presentation/inventory-layout";
import { VenueStaffApiError } from "../../services/http-venue-staff";
import { getVenueStaffAttemptStore, getVenueStaffDataSource, type AcceptVenueStaffInvitationAttempt } from "../../services/venue-staff";

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const attemptKey = () => `venue-staff-accept-${Date.now()}-${Math.round(Math.random() * 1e9)}`;
const codeOf = (caught: unknown) => caught instanceof VenueStaffApiError ? caught.code : "";
function dateLabel(timestamp: string): string {
  const value = new Date(new Date(timestamp).getTime() + 8 * 60 * 60 * 1000);
  if (!Number.isFinite(value.getTime())) return "";
  return `${value.getUTCMonth() + 1}月${value.getUTCDate()}日 ${String(value.getUTCHours()).padStart(2, "0")}:${String(value.getUTCMinutes()).padStart(2, "0")}`;
}

Page({
  data: {
    mode: "loading", tone: "ready", eyebrow: "场馆员工邀请", title: "正在检查邀请", description: "请稍候。",
    venueName: "", expiresAtLabel: "", permissionViews: [] as unknown[], busy: false, workspacePath: "",
    retryAvailable: false,
    feedback: "", unknownAttempt: null as AcceptVenueStaffInvitationAttempt | null, foreignAttemptPending: false,
    headerTopPx: 0, headerRowHeightPx: 44, headerRightInsetPx: 0,
  },
  invitationToken: "",
  invitation: null as CurrentVenueStaffInvitation | null,
  boundUserId: "",
  alive: true,
  requestRevision: 0,

  async onLoad(options: Record<string, string | undefined> = {}) {
    this.alive = true;
    wx.hideShareMenu();
    const layout = readInventoryHeaderLayout();
    this.setData({ headerTopPx: layout.topPx, headerRowHeightPx: layout.rowHeightPx, headerRightInsetPx: layout.rightInsetPx });
    const invitationToken = options.token ?? "";
    if (!TOKEN.test(invitationToken)) { this.showUnavailable(false); return; }
    this.invitationToken = invitationToken;
    try {
      this.boundUserId = await getVenueStaffDataSource().login();
      await this.readInvitation();
      if (this.alive) this.recoverAttempt();
    } catch (caught) { if (this.alive) this.handleReadError(caught); }
  },
  onUnload() { this.alive = false; this.requestRevision += 1; this.invitationToken = ""; this.invitation = null; },

  async readInvitation() {
    if (!this.invitationToken) throw new VenueStaffApiError("VENUE_STAFF_INVITATION_UNAVAILABLE");
    const revision = ++this.requestRevision;
    const invitation = await getVenueStaffDataSource().getCurrentInvitation(this.invitationToken);
    if (!this.alive || revision !== this.requestRevision) return;
    this.invitation = invitation;
    this.setData({
      mode: "ready", tone: "ready", eyebrow: "场馆员工邀请", title: "邀请你加入场馆团队",
      description: "接受后只获得下列工作权限，不会成为场馆负责人。", venueName: invitation.venueName,
      expiresAtLabel: `${dateLabel(invitation.expiresAt)} 前有效`,
      permissionViews: VENUE_STAFF_PERMISSION_OPTIONS.filter((item) => invitation.permissions.includes(item.code)),
      feedback: "", workspacePath: "", retryAvailable: true,
    });
  },
  handleReadError(caught: unknown) {
    const code = codeOf(caught);
    if (code === "VENUE_STAFF_INVITATION_UNAVAILABLE") { this.showUnavailable(); return; }
    this.setData({ mode: "read-error", tone: "muted", eyebrow: "暂时无法检查", title: "邀请加载失败", description: code === "VENUE_STAFF_AUTHORIZATION_DISABLED" ? "员工权限功能尚未启用，请稍后再试。" : "请检查网络后重新检查这份邀请。", venueName: "", expiresAtLabel: "", permissionViews: [], feedback: "" });
  },
  showUnavailable(retryAvailable = true) {
    this.invitation = null;
    this.setData({ mode: "unavailable", tone: "muted", eyebrow: "邀请不可用", title: "这份邀请已失效", description: "邀请可能已过期、撤销或被其他账号接受。不会显示其他账号信息。", venueName: "", expiresAtLabel: "", permissionViews: [], feedback: "", unknownAttempt: null, retryAvailable });
  },
  recoverAttempt() {
    const resolution = getVenueStaffAttemptStore().resolveForUser(this.boundUserId);
    if (!resolution) { this.setData({ unknownAttempt: null, foreignAttemptPending: false }); return; }
    if (resolution.kind === "FOREIGN_ACCOUNT_PENDING") { this.setData({ unknownAttempt: null, foreignAttemptPending: true, feedback: "另一个账号有员工权限操作等待核对，请切回原账号处理。" }); return; }
    const attempt = resolution.attempt;
    if (attempt.kind !== "acceptInvitation" || attempt.invitationId !== this.invitation?.id) {
      this.setData({ unknownAttempt: null, foreignAttemptPending: true, feedback: "其他员工权限页面有操作等待核对，请先返回对应页面处理。" }); return;
    }
    this.setData({ unknownAttempt: attempt, foreignAttemptPending: false, feedback: "上次接受结果尚未确认，请使用原操作凭据继续核对。" });
  },

  async onAcceptInvitation() {
    if (this.data.mode !== "ready" || !this.invitation || !this.invitationToken || this.data.busy || this.data.unknownAttempt || this.data.foreignAttemptPending) return;
    const attempt: AcceptVenueStaffInvitationAttempt = {
      kind: "acceptInvitation",
      originatingUserId: this.boundUserId,
      invitationId: this.invitation.id,
      venueId: this.invitation.venueId,
      permissions: [...this.invitation.permissions],
      idempotencyKey: attemptKey(),
    };
    await this.accept(attempt);
  },
  async accept(attempt: AcceptVenueStaffInvitationAttempt) {
    if (!this.invitationToken || this.data.busy) return;
    this.setData({ busy: true, feedback: "" });
    try {
      const accepted = await getVenueStaffDataSource().acceptInvitation(this.invitationToken, attempt);
      if (!this.alive) return;
      getVenueStaffAttemptStore().clear();
      this.invitationToken = "";
      this.invitation = null;
      this.setData({ mode: "accepted", tone: "success", eyebrow: "邀请已接受", title: "员工权限已开通", description: "你已加入该场馆；每次操作仍以服务端当前权限为准。", venueName: accepted.venueName, permissionViews: VENUE_STAFF_PERMISSION_OPTIONS.filter((item) => accepted.membership.permissions.includes(item.code)), expiresAtLabel: "", workspacePath: accepted.workspacePath, unknownAttempt: null, foreignAttemptPending: false, feedback: "" });
    } catch (caught) { if (this.alive) this.handleAcceptError(caught, attempt); }
    finally { if (this.alive) this.setData({ busy: false }); }
  },
  handleAcceptError(caught: unknown, attempt: AcceptVenueStaffInvitationAttempt) {
    const code = codeOf(caught);
    if (code === "VENUE_STAFF_RESULT_UNKNOWN" || code === "REQUEST_IN_PROGRESS") { this.setData({ unknownAttempt: getVenueStaffAttemptStore().load() as AcceptVenueStaffInvitationAttempt | null ?? attempt, feedback: "接受结果尚未确认，请使用原操作凭据重试。" }); return; }
    if (code === "VENUE_STAFF_INVITATION_UNAVAILABLE") { this.showUnavailable(); return; }
    if (code === "VENUE_STAFF_ACCOUNT_CHANGED") { this.setData({ feedback: "登录账号已变化，请切回发起操作的账号后重试。" }); return; }
    if (code === "OWNER_TRANSFER_REQUIRED") { this.setData({ feedback: "当前账号是该场馆负责人，不能接受员工邀请。" }); return; }
    this.setData({ feedback: "接受邀请失败，请重试。" });
  },
  async onRetryUnknown() {
    const attempt = this.data.unknownAttempt as AcceptVenueStaffInvitationAttempt | null;
    if (attempt) await this.accept(attempt);
  },
  async onRetry() {
    if (!this.invitationToken || this.data.busy) return;
    this.setData({ mode: "loading", title: "正在检查邀请", description: "请稍候。", feedback: "" });
    try { await this.readInvitation(); if (this.alive) this.recoverAttempt(); } catch (caught) { if (this.alive) this.handleReadError(caught); }
  },
  onOpenPortfolio() { if (this.data.mode === "accepted" && this.data.workspacePath) wx.reLaunch({ url: this.data.workspacePath }); },
  onReturnToEntry() { wx.reLaunch({ url: "/pages/intent-entry/index" }); },
  onHeaderBack() {
    this.invitationToken = "";
    if (getCurrentPages().length > 1) wx.navigateBack({ delta: 1 }); else wx.reLaunch({ url: "/pages/intent-entry/index" });
  },
});
