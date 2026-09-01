import { describe, expect, test } from "@jest/globals";
import { ApiResponseError } from "./contracts";
import {
  decodeCurrentVenueStaffInvitation,
  decodeVenueStaffInvitation,
  decodeVenueStaffInvitationCreated,
  decodeVenueStaffMembershipAccepted,
  decodeVenueStaffMember,
  decodeVenueStaffOverview,
  summarizeVenueStaffPermissions,
} from "./venue-staff";

const ownerId = "10000000-0000-4000-8000-000000000001";
const staffId = "10000000-0000-4000-8000-000000000002";
const venueId = "20000000-0000-4000-8000-000000000001";
const invitationId = "30000000-0000-4000-8000-000000000001";
const auditId = "40000000-0000-4000-8000-000000000001";
const allPermissions = ["MANAGE_PROFILE", "MANAGE_PITCHES", "MANAGE_INVENTORY", "FULFILL_ORDERS"];

export const staffMemberWire = (overrides: Record<string, unknown> = {}) => ({
  id: staffId,
  display_name: "夜班员工",
  avatar_url: null,
  role: "STAFF",
  permissions: ["MANAGE_INVENTORY"],
  is_self: false,
  is_active: true,
  version: 3,
  ...overrides,
});

export const staffInvitationWire = (overrides: Record<string, unknown> = {}) => ({
  id: invitationId,
  contact_label: "周末值班",
  status: "ACTIVE",
  permissions: ["MANAGE_INVENTORY", "FULFILL_ORDERS"],
  expires_at: "2026-09-08T08:00:00Z",
  created_at: "2026-09-01T08:00:00Z",
  ...overrides,
});

export const staffOverviewWire = (overrides: Record<string, unknown> = {}) => ({
  venue_id: venueId,
  venue_name: "渤海元丰足球场",
  viewer_role: "OWNER",
  viewer_permissions: allPermissions,
  can_manage: true,
  members: [
    staffMemberWire({ id: ownerId, display_name: "陈负责人", role: "OWNER", permissions: allPermissions, is_self: true, version: 2 }),
    staffMemberWire(),
  ],
  active_invitations: [staffInvitationWire()],
  recent_audits: [{
    id: auditId,
    action: "INVITATION_CREATED",
    target_display_name: "周末值班",
    created_at: "2026-09-01T08:00:00Z",
  }],
  ...overrides,
});

describe("venue staff wire decoders", () => {
  test("decode the closed owner overview and preserve authoritative versions", () => {
    expect(decodeVenueStaffOverview(staffOverviewWire())).toEqual({
      venueId,
      venueName: "渤海元丰足球场",
      viewerRole: "OWNER",
      viewerPermissions: allPermissions,
      canManage: true,
      members: [
        { id: ownerId, displayName: "陈负责人", avatarUrl: null, role: "OWNER", permissions: allPermissions, isSelf: true, isActive: true, version: 2 },
        { id: staffId, displayName: "夜班员工", avatarUrl: null, role: "STAFF", permissions: ["MANAGE_INVENTORY"], isSelf: false, isActive: true, version: 3 },
      ],
      activeInvitations: [{
        id: invitationId,
        contactLabel: "周末值班",
        status: "ACTIVE",
        permissions: ["MANAGE_INVENTORY", "FULFILL_ORDERS"],
        expiresAt: "2026-09-08T08:00:00Z",
        createdAt: "2026-09-01T08:00:00Z",
      }],
      recentAudits: [{ id: auditId, action: "INVITATION_CREATED", targetDisplayName: "周末值班", createdAt: "2026-09-01T08:00:00Z" }],
    });
  });

  test("enforces owner/staff projection invariants and rejects leaked identity or secrets", () => {
    expect(() => decodeVenueStaffMember(staffMemberWire({ role: "OWNER" }))).toThrow(ApiResponseError);
    expect(() => decodeVenueStaffOverview(staffOverviewWire({ can_manage: false }))).toThrow(ApiResponseError);
    expect(() => decodeVenueStaffOverview(staffOverviewWire({ viewer_role: "STAFF", viewer_permissions: ["MANAGE_INVENTORY"], can_manage: false }))).toThrow(ApiResponseError);
    expect(() => decodeVenueStaffInvitation({ ...staffInvitationWire(), token: "secret" })).toThrow(ApiResponseError);
    expect(() => decodeCurrentVenueStaffInvitation({
      id: invitationId, venue_id: venueId, venue_name: "渤海元丰足球场", status: "ACTIVE",
      permissions: ["MANAGE_INVENTORY"], expires_at: "2026-09-08T08:00:00Z", wechat_openid: "leak",
    })).toThrow(ApiResponseError);
  });

  test("distinguishes the first 201 secret-bearing result from safe replay metadata", () => {
    const safe = decodeVenueStaffInvitation(staffInvitationWire());
    expect(safe).not.toHaveProperty("invitationPath");
    const created = decodeVenueStaffInvitationCreated({
      ...staffInvitationWire(),
      invitation_path: `/pages/venue-staff-invitation/index?token=${"A".repeat(43)}`,
    });
    expect(created.invitationPath).toBe(`/pages/venue-staff-invitation/index?token=${"A".repeat(43)}`);
    expect(() => decodeVenueStaffInvitationCreated({ ...staffInvitationWire(), invitation_path: "/pages/venue-staff-invitation/index?token=short" })).toThrow(ApiResponseError);
  });

  test("decodes invitation landing and acceptance without a contact label", () => {
    expect(decodeCurrentVenueStaffInvitation({
      id: invitationId, venue_id: venueId, venue_name: "渤海元丰足球场", status: "ACTIVE",
      permissions: ["MANAGE_PROFILE"], expires_at: "2026-09-08T08:00:00Z",
    })).toEqual({ id: invitationId, venueId, venueName: "渤海元丰足球场", status: "ACTIVE", permissions: ["MANAGE_PROFILE"], expiresAt: "2026-09-08T08:00:00Z" });
    expect(decodeVenueStaffMembershipAccepted({
      venue_id: venueId,
      venue_name: "渤海元丰足球场",
      membership: staffMemberWire({ is_self: true }),
      workspace_path: "/pages/venue-access/index",
    })).toMatchObject({ venueId, workspacePath: "/pages/venue-access/index", membership: { role: "STAFF", isSelf: true } });
  });
});

test("permission summaries use the reviewed Chinese labels", () => {
  expect(summarizeVenueStaffPermissions(["MANAGE_PROFILE", "FULFILL_ORDERS"])).toBe("场馆资料、订单履约");
});
