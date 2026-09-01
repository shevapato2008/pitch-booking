import {
  VENUE_STAFF_PERMISSION_OPTIONS,
  summarizeVenueStaffPermissions,
  type VenueStaffAuditAction,
  type VenueStaffMember,
  type VenueStaffOverview,
  type VenueStaffPermission,
} from "../../domain/venue-staff";
import { readInventoryHeaderLayout } from "../../presentation/inventory-layout";
import { VenueStaffApiError } from "../../services/http-venue-staff";
import {
  getVenueStaffAttemptStore,
  getVenueStaffDataSource,
  type VenueStaffMutationAttempt,
} from "../../services/venue-staff";

type Sheet = "none" | "create" | "created" | "edit" | "remove" | "revoke";
type DatasetEvent = { currentTarget?: { dataset?: Record<string, unknown> } };
type InputEvent = { detail?: { value?: unknown } };
type PermissionChoice = typeof VENUE_STAFF_PERMISSION_OPTIONS[number] & { readonly selected: boolean };

const defaultPermissions: readonly VenueStaffPermission[] = ["MANAGE_INVENTORY"];
const auditLabels: Readonly<Record<VenueStaffAuditAction, string>> = {
  INVITATION_CREATED: "员工邀请已创建",
  INVITATION_ACCEPTED: "员工已加入",
  INVITATION_REVOKED: "员工邀请已撤销",
  PERMISSIONS_UPDATED: "员工权限已更新",
  MEMBER_REMOVED: "员工已停用",
  OWNER_TRANSFERRED: "场馆负责人已转移",
};
const mutationKey = (kind: string) => `venue-staff-${kind}-${Date.now()}-${Math.round(Math.random() * 1e9)}`;
const errorCode = (caught: unknown) => caught instanceof VenueStaffApiError ? caught.code : "";

function choices(selected: readonly VenueStaffPermission[]): readonly PermissionChoice[] {
  return VENUE_STAFF_PERMISSION_OPTIONS.map((item) => ({ ...item, selected: selected.includes(item.code) }));
}
function initial(displayName: string): string { return Array.from(displayName.trim())[0] ?? "员"; }
function dateLabel(timestamp: string): string {
  const value = new Date(new Date(timestamp).getTime() + 8 * 60 * 60 * 1000);
  if (!Number.isFinite(value.getTime())) return "";
  return `${value.getUTCMonth() + 1}月${value.getUTCDate()}日 ${String(value.getUTCHours()).padStart(2, "0")}:${String(value.getUTCMinutes()).padStart(2, "0")}`;
}
function memberView(member: VenueStaffMember) {
  return {
    ...member,
    roleLabel: member.role === "OWNER" ? "负责人" : "员工",
    initials: initial(member.displayName),
    permissionSummary: summarizeVenueStaffPermissions(member.permissions),
    joinedAtLabel: `${member.role === "OWNER" ? "负责人" : "员工"} · 权限版本 ${member.version}`,
  };
}
function authorityApplied(attempt: VenueStaffMutationAttempt, authority: VenueStaffOverview): boolean {
  if (attempt.kind === "updatePermissions") {
    const member = authority.members.find((item) => item.id === attempt.membershipId);
    return Boolean(member && member.version > attempt.expectedVersion
      && member.permissions.length === attempt.permissions.length
      && attempt.permissions.every((permission) => member.permissions.includes(permission)));
  }
  if (attempt.kind === "removeMember") return !authority.members.some((item) => item.id === attempt.membershipId);
  if (attempt.kind === "revokeInvitation") return !authority.activeInvitations.some((item) => item.id === attempt.invitationId);
  return false;
}

Page({
  data: {
    venueId: "", venueName: "", viewerRole: "STAFF", viewerRoleLabel: "员工", canManage: false, mode: "loading", readError: "",
    members: [] as unknown[], selfMember: null as unknown, activeInvitations: [] as unknown[], audits: [] as unknown[],
    permissions: VENUE_STAFF_PERMISSION_OPTIONS, sheet: "none" as Sheet, busy: false,
    draftContact: "", draftPermissions: [...defaultPermissions] as VenueStaffPermission[], permissionChoices: choices(defaultPermissions),
    selectedMembershipId: "", selectedMembershipVersion: 0, selectedInvitationId: "", removeReason: "",
    createdPath: "", createdPathRecoverable: false, feedback: "", unknownAttempt: null as VenueStaffMutationAttempt | null, foreignAttemptPending: false,
    headerTopPx: 0, headerRowHeightPx: 44, headerRightInsetPx: 0,
  },
  authority: null as VenueStaffOverview | null,
  boundUserId: "",
  requestRevision: 0,
  alive: true,

  async onLoad(options: Record<string, string | undefined> = {}) {
    this.alive = true;
    wx.hideShareMenu();
    const layout = readInventoryHeaderLayout();
    const venueId = options.venue_id ?? "";
    this.setData({ venueId, headerTopPx: layout.topPx, headerRowHeightPx: layout.rowHeightPx, headerRightInsetPx: layout.rightInsetPx });
    if (!venueId) { this.setData({ mode: "read-error", readError: "场馆信息无效，请返回后重试。" }); return; }
    try {
      this.boundUserId = await getVenueStaffDataSource().login();
      await this.refreshAuthority();
      if (this.alive) this.recoverAttempt();
    } catch (caught) { if (this.alive) this.handleReadError(caught); }
  },
  onUnload() { this.alive = false; this.requestRevision += 1; this.setData({ createdPath: "", createdPathRecoverable: false }); },

  async refreshAuthority() {
    const revision = ++this.requestRevision;
    const authority = await getVenueStaffDataSource().getOverview(this.data.venueId);
    if (!this.alive || revision !== this.requestRevision) return;
    this.applyAuthority(authority);
  },
  applyAuthority(authority: VenueStaffOverview) {
    this.authority = authority;
    const members = authority.members.map(memberView);
    const selfMember = members.find((member) => member.isSelf) ?? null;
    this.setData({
      venueName: authority.venueName,
      viewerRole: authority.viewerRole,
      viewerRoleLabel: authority.viewerRole === "OWNER" ? "负责人" : "员工",
      canManage: authority.canManage,
      members,
      selfMember,
      activeInvitations: authority.activeInvitations.map((invitation) => ({ ...invitation, expiresAtLabel: `${dateLabel(invitation.expiresAt)} 前有效`, permissionSummary: summarizeVenueStaffPermissions(invitation.permissions) })),
      audits: authority.recentAudits.map((audit) => ({ ...audit, summary: auditLabels[audit.action], detail: `${audit.targetDisplayName} · ${dateLabel(audit.createdAt)}` })),
      mode: "ready", readError: "",
    });
  },
  handleReadError(caught: unknown) {
    const code = errorCode(caught);
    const permission = code === "AUTH_REQUIRED" || code === "VENUE_STAFF_NOT_FOUND";
    this.setData({ mode: permission ? "permission-error" : "read-error", readError: permission ? "当前账号没有该场馆的有效工作权限。" : code === "VENUE_STAFF_AUTHORIZATION_DISABLED" ? "员工权限功能尚未启用。" : "员工权限加载失败，请重试。" });
  },
  async onRetry() {
    if (this.data.mode === "loading") return;
    this.setData({ mode: "loading", readError: "" });
    try { await this.refreshAuthority(); if (this.alive) this.recoverAttempt(); } catch (caught) { if (this.alive) this.handleReadError(caught); }
  },
  async onPullDownRefresh() { try { await this.refreshAuthority(); if (this.alive) this.recoverAttempt(); } catch (caught) { if (this.alive) this.handleReadError(caught); } finally { wx.stopPullDownRefresh(); } },

  recoverAttempt() {
    const resolved = getVenueStaffAttemptStore().resolveForUser(this.boundUserId);
    if (!resolved) { this.setData({ unknownAttempt: null, foreignAttemptPending: false }); return; }
    if (resolved.kind === "FOREIGN_ACCOUNT_PENDING") {
      this.setData({ unknownAttempt: null, foreignAttemptPending: true, feedback: "另一个账号有员工权限操作等待核对，请切回原账号处理。" }); return;
    }
    const attempt = resolved.attempt;
    const belongsHere = attempt.kind === "acceptInvitation" ? false : attempt.venueId === this.data.venueId;
    if (!belongsHere) {
      this.setData({ unknownAttempt: null, foreignAttemptPending: true, feedback: "其他员工权限页面有操作等待核对，请先返回对应页面处理。" }); return;
    }
    if (this.authority && authorityApplied(attempt, this.authority)) {
      getVenueStaffAttemptStore().clear();
      this.setData({ unknownAttempt: null, foreignAttemptPending: false, feedback: "上次操作已由服务端确认。" }); return;
    }
    this.setData({ unknownAttempt: attempt, foreignAttemptPending: false, feedback: "上次操作结果尚未确认，请使用原操作凭据继续核对。" });
  },
  mutationBlocked() { return this.data.busy || this.data.unknownAttempt !== null || this.data.foreignAttemptPending; },

  onOpenCreate() {
    if (!this.data.canManage || this.mutationBlocked()) return;
    this.setData({ sheet: "create", draftContact: "", draftPermissions: [...defaultPermissions], permissionChoices: choices(defaultPermissions), feedback: "" });
  },
  onContactInput(event: InputEvent) { this.setData({ draftContact: typeof event.detail?.value === "string" ? event.detail.value : "", feedback: "" }); },
  onToggleDraftPermission(event: DatasetEvent) {
    if (!this.data.canManage || this.data.busy) return;
    const permission = event.currentTarget?.dataset?.permission;
    if (typeof permission !== "string" || !VENUE_STAFF_PERMISSION_OPTIONS.some((item) => item.code === permission)) return;
    const typed = permission as VenueStaffPermission;
    const draftPermissions = this.data.draftPermissions.includes(typed)
      ? this.data.draftPermissions.filter((item: VenueStaffPermission) => item !== typed)
      : [...this.data.draftPermissions, typed];
    this.setData({ draftPermissions, permissionChoices: choices(draftPermissions), feedback: "" });
  },
  async onCreateInvitation() {
    if (!this.data.canManage || this.data.sheet !== "create" || this.data.busy || this.data.foreignAttemptPending) return;
    const contactLabel = this.data.draftContact.trim();
    if (!contactLabel || Array.from(contactLabel).length > 40 || this.data.draftPermissions.length < 1) { this.setData({ feedback: "请填写 40 字以内的内部称呼，并至少选择一项权限。" }); return; }
    const attempt = { kind: "createInvitation" as const, originatingUserId: this.boundUserId, venueId: this.data.venueId, contactLabel, permissions: [...this.data.draftPermissions], idempotencyKey: mutationKey("invite") };
    this.setData({ busy: true, feedback: "" });
    try {
      const result = await getVenueStaffDataSource().createInvitation(attempt);
      if (!this.alive) return;
      if (result.kind === "CREATED") this.setData({ sheet: "created", createdPath: result.invitation.invitationPath, createdPathRecoverable: true, feedback: "原始邀请路径只展示这一次，请立即复制。" });
      else this.setData({ sheet: "created", createdPath: "", createdPathRecoverable: false, feedback: "邀请已由服务端确认；原始路径不会在重放时再次返回。如未保存，请撤销后重新创建。" });
    } catch (caught) { if (this.alive) this.handleMutationError(caught); }
    finally { if (this.alive) this.setData({ busy: false }); }
  },
  onCopyInvitation() {
    if (!this.data.createdPath) return;
    wx.setClipboardData({ data: this.data.createdPath, success: () => { if (this.alive) this.setData({ feedback: "邀请路径已复制。" }); } });
  },

  onOpenEdit(event: DatasetEvent) {
    if (!this.data.canManage || this.mutationBlocked()) return;
    const membershipId = event.currentTarget?.dataset?.membershipId;
    const member = typeof membershipId === "string" ? this.authority?.members.find((item) => item.id === membershipId) : undefined;
    if (!member || member.role !== "STAFF" || !member.isActive) return;
    this.setData({ sheet: "edit", selectedMembershipId: member.id, selectedMembershipVersion: member.version, draftPermissions: [...member.permissions], permissionChoices: choices(member.permissions), feedback: "" });
  },
  async onSavePermissions() {
    if (!this.data.canManage || this.data.sheet !== "edit" || this.data.busy || this.data.draftPermissions.length < 1) { if (this.data.draftPermissions.length < 1) this.setData({ feedback: "员工至少需要一项工作权限。" }); return; }
    const attempt = { kind: "updatePermissions" as const, originatingUserId: this.boundUserId, venueId: this.data.venueId, membershipId: this.data.selectedMembershipId, expectedVersion: this.data.selectedMembershipVersion, permissions: [...this.data.draftPermissions], idempotencyKey: mutationKey("permissions") };
    await this.runAndRefresh(attempt, () => getVenueStaffDataSource().updatePermissions(attempt), "权限已更新。", true);
  },
  onPrepareRemove(event: DatasetEvent) {
    if (!this.data.canManage || this.data.busy) return;
    const membershipId = event.currentTarget?.dataset?.membershipId ?? this.data.selectedMembershipId;
    const member = typeof membershipId === "string" ? this.authority?.members.find((item) => item.id === membershipId) : undefined;
    if (!member || member.role !== "STAFF" || !member.isActive) return;
    this.setData({ sheet: "remove", selectedMembershipId: member.id, selectedMembershipVersion: member.version, removeReason: "", feedback: "" });
  },
  onRemoveReasonInput(event: InputEvent) { this.setData({ removeReason: typeof event.detail?.value === "string" ? event.detail.value : "", feedback: "" }); },
  async onConfirmRemove() {
    const reason = this.data.removeReason.trim();
    if (!this.data.canManage || this.data.sheet !== "remove" || this.data.busy) return;
    if (!reason || Array.from(reason).length > 200) { this.setData({ feedback: "请填写 200 字以内的停用原因。" }); return; }
    const attempt = { kind: "removeMember" as const, originatingUserId: this.boundUserId, venueId: this.data.venueId, membershipId: this.data.selectedMembershipId, expectedVersion: this.data.selectedMembershipVersion, reason, idempotencyKey: mutationKey("remove") };
    await this.runAndRefresh(attempt, () => getVenueStaffDataSource().removeMember(attempt), "员工已停用，历史审计记录仍保留。", true);
  },
  onRevokeInvitation(event: DatasetEvent) {
    if (!this.data.canManage || this.mutationBlocked()) return;
    const invitationId = event.currentTarget?.dataset?.invitationId;
    if (typeof invitationId !== "string" || !this.authority?.activeInvitations.some((item) => item.id === invitationId)) return;
    this.setData({ sheet: "revoke", selectedInvitationId: invitationId, feedback: "" });
  },
  async onConfirmRevoke() {
    if (!this.data.canManage || this.data.sheet !== "revoke" || this.data.busy) return;
    const attempt = { kind: "revokeInvitation" as const, originatingUserId: this.boundUserId, venueId: this.data.venueId, invitationId: this.data.selectedInvitationId, idempotencyKey: mutationKey("revoke") };
    await this.runAndRefresh(attempt, () => getVenueStaffDataSource().revokeInvitation(attempt), "邀请已撤销，审计记录已保留。", true);
  },
  async runAndRefresh(attempt: VenueStaffMutationAttempt, operation: () => Promise<unknown>, success: string, closeSheet: boolean) {
    if (this.data.busy || this.data.foreignAttemptPending) return;
    this.setData({ busy: true, feedback: "" });
    try {
      await operation();
      if (!this.alive) return;
      getVenueStaffAttemptStore().clear();
      if (closeSheet) this.setData({ sheet: "none", selectedMembershipId: "", selectedInvitationId: "", removeReason: "" });
      await this.refreshAuthority();
      if (this.alive) this.setData({ unknownAttempt: null, feedback: success });
    } catch (caught) { if (this.alive) this.handleMutationError(caught, attempt); }
    finally { if (this.alive) this.setData({ busy: false }); }
  },
  handleMutationError(caught: unknown, attempted?: VenueStaffMutationAttempt) {
    const code = errorCode(caught);
    if (code === "VENUE_STAFF_RESULT_UNKNOWN" || code === "REQUEST_IN_PROGRESS") {
      this.setData({ unknownAttempt: getVenueStaffAttemptStore().load() ?? attempted ?? null, feedback: "操作结果尚未确认，请核对后使用原操作凭据重试。" }); return;
    }
    if (code === "VENUE_STAFF_ACCOUNT_CHANGED") { this.setData({ feedback: "登录账号已变化，请切回发起操作的账号后重试。" }); return; }
    if (code === "VENUE_STAFF_PENDING_ATTEMPT") { this.recoverAttempt(); return; }
    if (code === "VENUE_STAFF_STATE_CHANGED") { this.setData({ sheet: "none", feedback: "成员或邀请状态已变化，正在刷新。" }); void this.refreshAuthority().catch(() => this.setData({ mode: "read-error", readError: "刷新失败，请重试。" })); return; }
    this.setData({ feedback: code === "OWNER_TRANSFER_REQUIRED" ? "负责人身份只能由平台管理员转移。" : code === "INVALID_ARGUMENT" ? "提交内容不符合要求，请检查后重试。" : "操作失败，请重试。" });
  },
  async onRetryUnknown() {
    const attempt = this.data.unknownAttempt as VenueStaffMutationAttempt | null;
    if (!attempt || this.data.busy) return;
    if (attempt.kind === "acceptInvitation") { this.setData({ feedback: "请返回员工邀请页面继续核对。" }); return; }
    const source = getVenueStaffDataSource();
    const operation = attempt.kind === "createInvitation" ? () => source.createInvitation(attempt)
      : attempt.kind === "updatePermissions" ? () => source.updatePermissions(attempt)
        : attempt.kind === "removeMember" ? () => source.removeMember(attempt)
          : () => source.revokeInvitation(attempt);
    await this.runAndRefresh(attempt, operation, attempt.kind === "createInvitation" ? "邀请创建结果已确认；原始路径不会再次返回。" : "上次操作结果已确认。", true);
  },
  onCloseSheet() {
    const created = this.data.sheet === "created";
    this.setData({ sheet: "none", selectedMembershipId: "", selectedInvitationId: "", removeReason: "", createdPath: "", createdPathRecoverable: false, feedback: "" });
    if (created) void this.refreshAuthority().catch(() => { if (this.alive) this.setData({ mode: "read-error", readError: "刷新失败，请重试。" }); });
  },
  onHeaderBack() {
    this.setData({ createdPath: "", createdPathRecoverable: false });
    if (getCurrentPages().length > 1) wx.navigateBack({ delta: 1 }); else wx.reLaunch({ url: "/pages/venue-access/index" });
  },
});
