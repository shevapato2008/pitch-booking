import {
  arrayAt,
  enumAt,
  exactObject,
  httpsUrlAt,
  integerAt,
  invalid,
  rfc3339At,
  stringAt,
  uuidAt,
} from "./decoder-primitives";

export const VENUE_STAFF_PERMISSIONS = [
  "MANAGE_PROFILE",
  "MANAGE_PITCHES",
  "MANAGE_INVENTORY",
  "FULFILL_ORDERS",
] as const;
export type VenueStaffPermission = typeof VENUE_STAFF_PERMISSIONS[number];

export const VENUE_STAFF_PERMISSION_OPTIONS = Object.freeze([
  Object.freeze({ code: "MANAGE_PROFILE" as const, label: "场馆资料", description: "编辑介绍、图片与公开资料" }),
  Object.freeze({ code: "MANAGE_PITCHES" as const, label: "物理场地", description: "维护场地名称、规格与启停" }),
  Object.freeze({ code: "MANAGE_INVENTORY" as const, label: "可订库存", description: "配置日期、价格与可订时段" }),
  Object.freeze({ code: "FULFILL_ORDERS" as const, label: "订单履约", description: "处理签到、完成与授权退款" }),
]);

export type VenueStaffRole = "OWNER" | "STAFF";
export type VenueStaffInvitationStatus = "ACTIVE" | "ACCEPTED" | "REVOKED" | "EXPIRED";
export type VenueStaffAuditAction =
  | "INVITATION_CREATED"
  | "INVITATION_ACCEPTED"
  | "INVITATION_REVOKED"
  | "PERMISSIONS_UPDATED"
  | "MEMBER_REMOVED"
  | "OWNER_TRANSFERRED";

export interface VenueStaffMember {
  readonly id: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
  readonly role: VenueStaffRole;
  readonly permissions: readonly VenueStaffPermission[];
  readonly isSelf: boolean;
  readonly isActive: boolean;
  readonly version: number;
}

export interface VenueStaffInvitation {
  readonly id: string;
  readonly contactLabel: string;
  readonly status: VenueStaffInvitationStatus;
  readonly permissions: readonly VenueStaffPermission[];
  readonly expiresAt: string;
  readonly createdAt: string;
}

export interface VenueStaffInvitationCreated extends VenueStaffInvitation {
  readonly status: "ACTIVE";
  readonly invitationPath: string;
}

export interface CurrentVenueStaffInvitation {
  readonly id: string;
  readonly venueId: string;
  readonly venueName: string;
  readonly status: "ACTIVE";
  readonly permissions: readonly VenueStaffPermission[];
  readonly expiresAt: string;
}

export interface VenueStaffAuditSummary {
  readonly id: string;
  readonly action: VenueStaffAuditAction;
  readonly targetDisplayName: string;
  readonly createdAt: string;
}

export interface VenueStaffOverview {
  readonly venueId: string;
  readonly venueName: string;
  readonly viewerRole: VenueStaffRole;
  readonly viewerPermissions: readonly VenueStaffPermission[];
  readonly canManage: boolean;
  readonly members: readonly VenueStaffMember[];
  readonly activeInvitations: readonly VenueStaffInvitation[];
  readonly recentAudits: readonly VenueStaffAuditSummary[];
}

export interface VenueStaffMembershipAccepted {
  readonly venueId: string;
  readonly venueName: string;
  readonly membership: VenueStaffMember;
  readonly workspacePath: "/pages/venue-access/index";
}

const ROLES = ["OWNER", "STAFF"] as const;
const INVITATION_STATUSES = ["ACTIVE", "ACCEPTED", "REVOKED", "EXPIRED"] as const;
const AUDIT_ACTIONS = [
  "INVITATION_CREATED", "INVITATION_ACCEPTED", "INVITATION_REVOKED",
  "PERMISSIONS_UPDATED", "MEMBER_REMOVED", "OWNER_TRANSFERRED",
] as const;
const INVITATION_PATH = /^\/pages\/venue-staff-invitation\/index\?token=[A-Za-z0-9_-]{43}$/;
const permissionLabels = new Map(VENUE_STAFF_PERMISSION_OPTIONS.map((item) => [item.code, item.label]));

function booleanAt(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") invalid(path);
  return value;
}

function boundedString(value: unknown, path: string, maximum: number): string {
  const result = stringAt(value, path);
  if ([...result].length > maximum) invalid(path);
  return result;
}

function permissionsAt(value: unknown, path: string): readonly VenueStaffPermission[] {
  const values = arrayAt(value, path, 1);
  if (values.length > VENUE_STAFF_PERMISSIONS.length) invalid(path);
  const decoded = values.map((item, index) => enumAt(item, VENUE_STAFF_PERMISSIONS, `${path}[${index}]`));
  if (new Set(decoded).size !== decoded.length) invalid(path);
  return decoded;
}

function samePermissions(left: readonly VenueStaffPermission[], right: readonly VenueStaffPermission[]): boolean {
  return left.length === right.length && left.every((permission) => right.includes(permission));
}

export function summarizeVenueStaffPermissions(permissions: readonly VenueStaffPermission[]): string {
  return permissions.map((permission) => permissionLabels.get(permission) ?? permission).join("、");
}

export function decodeVenueStaffMember(value: unknown, path = "$"): VenueStaffMember {
  const object = exactObject(value, [
    "id", "display_name", "avatar_url", "role", "permissions", "is_self", "is_active", "version",
  ], path);
  const role = enumAt(object.role, ROLES, `${path}.role`);
  const permissions = permissionsAt(object.permissions, `${path}.permissions`);
  const isActive = booleanAt(object.is_active, `${path}.is_active`);
  if (role === "OWNER" && (!isActive || !samePermissions(permissions, VENUE_STAFF_PERMISSIONS))) invalid(`${path}.permissions`);
  return {
    id: uuidAt(object.id, `${path}.id`),
    displayName: boundedString(object.display_name, `${path}.display_name`, 40),
    avatarUrl: object.avatar_url === null ? null : httpsUrlAt(object.avatar_url, `${path}.avatar_url`),
    role,
    permissions,
    isSelf: booleanAt(object.is_self, `${path}.is_self`),
    isActive,
    version: integerAt(object.version, `${path}.version`, 1),
  };
}

export function decodeVenueStaffInvitation(value: unknown, path = "$"): VenueStaffInvitation {
  const object = exactObject(value, ["id", "contact_label", "status", "permissions", "expires_at", "created_at"], path);
  return {
    id: uuidAt(object.id, `${path}.id`),
    contactLabel: boundedString(object.contact_label, `${path}.contact_label`, 40),
    status: enumAt(object.status, INVITATION_STATUSES, `${path}.status`),
    permissions: permissionsAt(object.permissions, `${path}.permissions`),
    expiresAt: rfc3339At(object.expires_at, `${path}.expires_at`),
    createdAt: rfc3339At(object.created_at, `${path}.created_at`),
  };
}

export function decodeVenueStaffInvitationCreated(value: unknown): VenueStaffInvitationCreated {
  const object = exactObject(value, ["id", "contact_label", "status", "permissions", "expires_at", "created_at", "invitation_path"], "$");
  const invitation = decodeVenueStaffInvitation({
    id: object.id,
    contact_label: object.contact_label,
    status: object.status,
    permissions: object.permissions,
    expires_at: object.expires_at,
    created_at: object.created_at,
  });
  if (invitation.status !== "ACTIVE") invalid("$.status");
  const invitationPath = stringAt(object.invitation_path, "$.invitation_path");
  if (!INVITATION_PATH.test(invitationPath)) invalid("$.invitation_path");
  return { ...invitation, status: "ACTIVE", invitationPath };
}

export function decodeCurrentVenueStaffInvitation(value: unknown): CurrentVenueStaffInvitation {
  const object = exactObject(value, ["id", "venue_id", "venue_name", "status", "permissions", "expires_at"], "$");
  if (object.status !== "ACTIVE") invalid("$.status");
  return {
    id: uuidAt(object.id, "$.id"),
    venueId: uuidAt(object.venue_id, "$.venue_id"),
    venueName: boundedString(object.venue_name, "$.venue_name", 200),
    status: "ACTIVE",
    permissions: permissionsAt(object.permissions, "$.permissions"),
    expiresAt: rfc3339At(object.expires_at, "$.expires_at"),
  };
}

function decodeAudit(value: unknown, path: string): VenueStaffAuditSummary {
  const object = exactObject(value, ["id", "action", "target_display_name", "created_at"], path);
  return {
    id: uuidAt(object.id, `${path}.id`),
    action: enumAt(object.action, AUDIT_ACTIONS, `${path}.action`),
    targetDisplayName: boundedString(object.target_display_name, `${path}.target_display_name`, 40),
    createdAt: rfc3339At(object.created_at, `${path}.created_at`),
  };
}

export function decodeVenueStaffOverview(value: unknown): VenueStaffOverview {
  const object = exactObject(value, [
    "venue_id", "venue_name", "viewer_role", "viewer_permissions", "can_manage",
    "members", "active_invitations", "recent_audits",
  ], "$");
  const viewerRole = enumAt(object.viewer_role, ROLES, "$.viewer_role");
  const viewerPermissions = permissionsAt(object.viewer_permissions, "$.viewer_permissions");
  const canManage = booleanAt(object.can_manage, "$.can_manage");
  const members = arrayAt(object.members, "$.members", 1).map((item, index) => decodeVenueStaffMember(item, `$.members[${index}]`));
  const activeInvitations = arrayAt(object.active_invitations, "$.active_invitations").map((item, index) => decodeVenueStaffInvitation(item, `$.active_invitations[${index}]`));
  const audits = arrayAt(object.recent_audits, "$.recent_audits");
  if (audits.length > 20) invalid("$.recent_audits");
  const recentAudits = audits.map((item, index) => decodeAudit(item, `$.recent_audits[${index}]`));
  const self = members.filter((member) => member.isSelf);
  if (self.length !== 1 || !self[0].isActive || self[0].role !== viewerRole || !samePermissions(self[0].permissions, viewerPermissions)) invalid("$.members");
  if ((viewerRole === "OWNER") !== canManage) invalid("$.can_manage");
  if (members.some((member) => !member.isActive)) invalid("$.members");
  if (new Set(members.map((member) => member.id)).size !== members.length) invalid("$.members");
  if (new Set(activeInvitations.map((invitation) => invitation.id)).size !== activeInvitations.length) invalid("$.active_invitations");
  if (activeInvitations.some((invitation) => invitation.status !== "ACTIVE")) invalid("$.active_invitations");
  if (viewerRole === "OWNER") {
    if (!samePermissions(viewerPermissions, VENUE_STAFF_PERMISSIONS)
      || members.filter((member) => member.role === "OWNER").length !== 1) invalid("$.viewer_permissions");
  } else if (members.length !== 1 || activeInvitations.length !== 0 || recentAudits.length !== 0) {
    invalid("$.members");
  }
  return {
    venueId: uuidAt(object.venue_id, "$.venue_id"),
    venueName: boundedString(object.venue_name, "$.venue_name", 200),
    viewerRole,
    viewerPermissions,
    canManage,
    members,
    activeInvitations,
    recentAudits,
  };
}

export function decodeVenueStaffMembershipAccepted(value: unknown): VenueStaffMembershipAccepted {
  const object = exactObject(value, ["venue_id", "venue_name", "membership", "workspace_path"], "$");
  const membership = decodeVenueStaffMember(object.membership, "$.membership");
  if (membership.role !== "STAFF" || !membership.isSelf || !membership.isActive) invalid("$.membership");
  if (object.workspace_path !== "/pages/venue-access/index") invalid("$.workspace_path");
  return {
    venueId: uuidAt(object.venue_id, "$.venue_id"),
    venueName: boundedString(object.venue_name, "$.venue_name", 200),
    membership,
    workspacePath: "/pages/venue-access/index",
  };
}
