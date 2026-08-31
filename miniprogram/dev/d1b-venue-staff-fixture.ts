export const D1B_VENUE_STAFF_AUTHORIZATION_FIXTURE_MARKER = "D1B_VENUE_STAFF_AUTHORIZATION_FIXTURE";

export const D1B_PERMISSIONS = Object.freeze([
  Object.freeze({ code: "MANAGE_PROFILE", label: "场馆资料", description: "编辑介绍、图片与公开资料" }),
  Object.freeze({ code: "MANAGE_PITCHES", label: "物理场地", description: "维护场地名称、规格与启停" }),
  Object.freeze({ code: "MANAGE_INVENTORY", label: "可订库存", description: "配置日期、价格与可订时段" }),
  Object.freeze({ code: "FULFILL_ORDERS", label: "订单履约", description: "处理签到、完成与授权退款" }),
] as const);

export type D1bPermission = typeof D1B_PERMISSIONS[number]["code"];
export type D1bRole = "OWNER" | "STAFF";

export interface D1bMember {
  readonly id: string;
  readonly displayName: string;
  readonly initials: string;
  readonly role: D1bRole;
  readonly permissions: readonly D1bPermission[];
  readonly joinedAtLabel: string;
}

export interface D1bInvitation {
  readonly id: string;
  readonly contactLabel: string;
  readonly status: "ACTIVE" | "REVOKED";
  readonly permissions: readonly D1bPermission[];
  readonly expiresAtLabel: string;
}

const allPermissions = D1B_PERMISSIONS.map(({ code }) => code);

export const D1B_VENUE_STAFF_FIXTURE = Object.freeze({
  marker: D1B_VENUE_STAFF_AUTHORIZATION_FIXTURE_MARKER,
  deletionCondition: "remove D1B_VENUE_STAFF_AUTHORIZATION_FIXTURE before production build or integration",
  venue: Object.freeze({
    id: "10000000-0000-4000-8000-000000000001",
    name: "测试环境·渤海元丰足球场",
    location: "天津滨海新区 · 七人制 A 场",
  }),
  members: Object.freeze<D1bMember[]>([
    Object.freeze({
      id: "membership-owner",
      displayName: "陈负责人",
      initials: "陈",
      role: "OWNER",
      permissions: Object.freeze([...allPermissions]),
      joinedAtLabel: "负责人 · 2026/8/18 加入",
    }),
    Object.freeze({
      id: "membership-staff",
      displayName: "夜班运营",
      initials: "夜",
      role: "STAFF",
      permissions: Object.freeze<D1bPermission[]>(["MANAGE_INVENTORY"]),
      joinedAtLabel: "员工 · 2026/8/26 加入",
    }),
  ]),
  invitations: Object.freeze<D1bInvitation[]>([
    Object.freeze({
      id: "invitation-active",
      contactLabel: "周末值班经理",
      status: "ACTIVE",
      permissions: Object.freeze<D1bPermission[]>(["MANAGE_INVENTORY", "FULFILL_ORDERS"]),
      expiresAtLabel: "9月8日 22:00 前有效",
    }),
  ]),
  invitationPath: "pages/venue-staff-invitation/index?token=Qw7Er9Ty2Ui4Op6As8Df0Gh1Jk3Lz5Xc7Vb9Nm2Qw4E",
});

export type D1bInvitationViewState = "invitation" | "accepted" | "unavailable";

export function readD1bInvitationView(state: string | undefined) {
  if (state === "accepted") return Object.freeze({
    state: "accepted", tone: "success", eyebrow: "邀请已接受", title: "员工权限已开通",
    description: "你已加入该场馆；每次操作仍以服务端当前权限为准。", actionKind: "portfolio", actionLabel: "查看我的场馆",
  });
  if (state === "unavailable") return Object.freeze({
    state: "unavailable", tone: "muted", eyebrow: "邀请不可用", title: "这份邀请已失效",
    description: "邀请可能已过期、撤销或被其他账号接受。不会显示其他账号信息。", actionKind: "retry", actionLabel: "重新检查",
  });
  return Object.freeze({
    state: "invitation", tone: "ready", eyebrow: "场馆员工邀请", title: "邀请你加入场馆团队",
    description: "接受后只获得下列工作权限，不会成为场馆负责人。", actionKind: "accept", actionLabel: "接受邀请",
  });
}

