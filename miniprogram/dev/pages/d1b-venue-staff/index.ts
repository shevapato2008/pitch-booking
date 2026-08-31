import { readIntentHeaderLayout } from "../../intent-header-layout";
import {
  D1B_PERMISSIONS,
  D1B_VENUE_STAFF_FIXTURE,
  type D1bInvitation,
  type D1bMember,
  type D1bPermission,
} from "../../d1b-venue-staff-fixture";

type Sheet = "none" | "create" | "created" | "edit" | "remove";

interface Options { state?: string }
interface PermissionChoice { code: D1bPermission; label: string; description: string; selected: boolean }
interface MemberView extends D1bMember { permissionSummary: string }
interface InvitationView extends D1bInvitation { permissionSummary: string }

const permissionLabel = new Map(D1B_PERMISSIONS.map((item) => [item.code, item.label]));
const summarize = (permissions: readonly D1bPermission[]) => permissions.map((code) => permissionLabel.get(code) ?? code).join("、");
const cloneMembers = (): MemberView[] => D1B_VENUE_STAFF_FIXTURE.members.map((member) => ({ ...member, permissions: [...member.permissions], permissionSummary: summarize(member.permissions) }));
const cloneInvitations = (): InvitationView[] => D1B_VENUE_STAFF_FIXTURE.invitations.map((invitation) => ({ ...invitation, permissions: [...invitation.permissions], permissionSummary: summarize(invitation.permissions) }));
const choices = (selected: readonly D1bPermission[]): PermissionChoice[] => D1B_PERMISSIONS.map((item) => ({ ...item, selected: selected.includes(item.code) }));

function goBack(): void {
  if (getCurrentPages().length > 1) wx.navigateBack({ delta: 1 });
  else wx.reLaunch({ url: "/pages/venue-access/index" });
}

Page({
  data: {
    fixture: D1B_VENUE_STAFF_FIXTURE,
    permissions: D1B_PERMISSIONS,
    members: cloneMembers(),
    invitations: cloneInvitations(),
    selfMember: cloneMembers()[1],
    canManage: true,
    sheet: "none" as Sheet,
    draftContact: "",
    draftPermissions: ["MANAGE_INVENTORY"] as D1bPermission[],
    permissionChoices: choices(["MANAGE_INVENTORY"]),
    selectedMembershipId: "",
    createdPath: "",
    feedback: "",
    headerTopPx: 0,
    headerRowHeightPx: 44,
  },

  onLoad(options: Options = {}) {
    const header = readIntentHeaderLayout();
    const canManage = options.state !== "staff";
    wx.hideShareMenu();
    this.setData({
      canManage,
      sheet: "none",
      feedback: "",
      headerTopPx: header.topPx,
      headerRowHeightPx: header.rowHeightPx,
    });
  },

  onOpenCreate() {
    if (!this.data.canManage) return;
    const draftPermissions: D1bPermission[] = ["MANAGE_INVENTORY"];
    this.setData({ sheet: "create", draftContact: "", draftPermissions, permissionChoices: choices(draftPermissions), feedback: "" });
  },

  onContactInput(event: WechatMiniprogram.Input) {
    this.setData({ draftContact: event.detail.value });
  },

  onToggleDraftPermission(event: WechatMiniprogram.TouchEvent) {
    if (!this.data.canManage) return;
    const permission = String(event.currentTarget.dataset.permission ?? "") as D1bPermission;
    if (!D1B_PERMISSIONS.some((item) => item.code === permission)) return;
    const current = [...this.data.draftPermissions] as D1bPermission[];
    const draftPermissions = current.includes(permission) ? current.filter((item) => item !== permission) : [...current, permission];
    this.setData({ draftPermissions, permissionChoices: choices(draftPermissions), feedback: "" });
  },

  onCreateInvitation() {
    if (!this.data.canManage || this.data.sheet !== "create") return;
    const contactLabel = this.data.draftContact.trim();
    if (!contactLabel || this.data.draftPermissions.length < 1) {
      this.setData({ feedback: "请填写内部称呼，并至少选择一项权限。" });
      return;
    }
    const invitation: InvitationView = {
      id: `invitation-${this.data.invitations.length + 1}`,
      contactLabel,
      status: "ACTIVE",
      permissions: [...this.data.draftPermissions],
      permissionSummary: summarize(this.data.draftPermissions),
      expiresAtLabel: "9月8日 22:00 前有效",
    };
    this.setData({
      invitations: [invitation, ...this.data.invitations],
      createdPath: D1B_VENUE_STAFF_FIXTURE.invitationPath,
      sheet: "created",
      feedback: "原始邀请路径只展示这一次，请立即复制。",
    });
  },

  onCopyInvitation() {
    if (!this.data.createdPath) return;
    wx.setClipboardData({ data: this.data.createdPath, success: () => this.setData({ feedback: "邀请路径已复制。" }) });
  },

  onOpenEdit(event: WechatMiniprogram.TouchEvent) {
    if (!this.data.canManage) return;
    const membershipId = String(event.currentTarget.dataset.membershipId ?? "");
    const member = this.data.members.find((item) => item.id === membershipId);
    if (!member || member.role !== "STAFF") return;
    const draftPermissions = [...member.permissions] as D1bPermission[];
    this.setData({ selectedMembershipId: membershipId, draftPermissions, permissionChoices: choices(draftPermissions), sheet: "edit", feedback: "" });
  },

  onSavePermissions() {
    if (!this.data.canManage || this.data.sheet !== "edit") return;
    if (this.data.draftPermissions.length < 1) {
      this.setData({ feedback: "员工至少需要一项工作权限。" });
      return;
    }
    const members = this.data.members.map((member) => member.id === this.data.selectedMembershipId
      ? { ...member, permissions: [...this.data.draftPermissions], permissionSummary: summarize(this.data.draftPermissions) }
      : member);
    this.setData({ members, sheet: "none", feedback: "权限已更新（模拟结果）。" });
  },

  onPrepareRemove(event: WechatMiniprogram.TouchEvent) {
    if (!this.data.canManage) return;
    const membershipId = String(event.currentTarget.dataset.membershipId ?? this.data.selectedMembershipId);
    const member = this.data.members.find((item) => item.id === membershipId);
    if (!member || member.role !== "STAFF") return;
    this.setData({ selectedMembershipId: membershipId, sheet: "remove", feedback: "" });
  },

  onConfirmRemove() {
    if (!this.data.canManage || this.data.sheet !== "remove") return;
    this.setData({
      members: this.data.members.filter((member) => member.id !== this.data.selectedMembershipId),
      sheet: "none",
      selectedMembershipId: "",
      feedback: "员工已停用，后续操作将重新校验权限。",
    });
  },

  onRevokeInvitation(event: WechatMiniprogram.TouchEvent) {
    if (!this.data.canManage) return;
    const invitationId = String(event.currentTarget.dataset.invitationId ?? "");
    const invitations = this.data.invitations.map((invitation) => invitation.id === invitationId
      ? { ...invitation, status: "REVOKED" as const }
      : invitation);
    this.setData({ invitations, createdPath: "", feedback: "邀请已撤销，审计记录已保留。" });
  },

  onCloseSheet() { this.setData({ sheet: "none", createdPath: "", feedback: "" }); },
  onHeaderBack() { goBack(); },
});
