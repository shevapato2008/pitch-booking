export const D1A_VENUE_INVITATION_FIXTURE_MARKER = "D1A_VENUE_INVITATION_FIXTURE";

export type D1aInvitationState = "ready" | "claimed" | "submitted" | "unavailable";

export interface D1aInvitationView {
  readonly state: D1aInvitationState;
  readonly statusLabel: string;
  readonly title: string;
  readonly description: string;
  readonly actionLabel: string;
  readonly actionKind: "accept" | "claim" | "applications" | "retry";
  readonly tone: "ready" | "success" | "muted";
}

const views: Readonly<Record<D1aInvitationState, D1aInvitationView>> = Object.freeze({
  ready: Object.freeze({
    state: "ready",
    statusLabel: "等待你接受",
    title: "邀请你认领这家场馆",
    description: "接受后仍需补充认领材料，并由平台人工审核。接受邀请不会直接获得管理权限。",
    actionLabel: "接受邀请并继续认领",
    actionKind: "accept",
    tone: "ready",
  }),
  claimed: Object.freeze({
    state: "claimed",
    statusLabel: "已绑定当前账号",
    title: "邀请已为你保留",
    description: "目标场馆不可修改。请补充管理授权与场馆外部照片，提交后进入平台人工审核。",
    actionLabel: "补充认领资料",
    actionKind: "claim",
    tone: "success",
  }),
  submitted: Object.freeze({
    state: "submitted",
    statusLabel: "认领申请待审核",
    title: "材料已经提交",
    description: "平台会核对场馆身份与授权材料。审核通过前，你不会获得场馆管理权限。",
    actionLabel: "查看我的场馆申请",
    actionKind: "applications",
    tone: "success",
  }),
  unavailable: Object.freeze({
    state: "unavailable",
    statusLabel: "邀请不可用",
    title: "这份邀请已失效",
    description: "邀请可能已过期、被撤销或绑定到其他账号。请联系发送邀请的平台工作人员。",
    actionLabel: "重新检查邀请",
    actionKind: "retry",
    tone: "muted",
  }),
});

export const D1A_INVITATION_FIXTURE = Object.freeze({
  marker: D1A_VENUE_INVITATION_FIXTURE_MARKER,
  notice: "D1a 开发预览 · 模拟数据",
  venueName: "天津海河东体育中心足球场",
  districtName: "河东区",
  address: "天津市河东区津塘路 156 号院内东侧",
  expiresAtLabel: "有效至 9月8日 23:59",
  contactLabel: "海河东场馆负责人",
});

export function readD1aInvitationView(value: unknown): D1aInvitationView {
  return views[value === "claimed" || value === "submitted" || value === "unavailable" ? value : "ready"];
}
