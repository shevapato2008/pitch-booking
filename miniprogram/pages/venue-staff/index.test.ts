/// <reference types="node" />
/* eslint-disable @typescript-eslint/no-explicit-any -- Mini Program Page harness */
import { beforeEach, expect, jest, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import type { VenueStaffOverview } from "../../domain/venue-staff";
import type { VenueStaffAttemptStore, VenueStaffDataSource, VenueStaffMutationAttempt } from "../../services/venue-staff";
import {
  registerVenueStaffAttemptStore,
  registerVenueStaffDataSource,
  resetVenueStaffAttemptStoreForTesting,
  resetVenueStaffDataSourceForTesting,
} from "../../services/venue-staff";

const userId = "10000000-0000-4000-8000-000000000001";
const venueId = "20000000-0000-4000-8000-000000000001";
const staffId = "10000000-0000-4000-8000-000000000002";
const invitationId = "30000000-0000-4000-8000-000000000001";
const allPermissions = ["MANAGE_PROFILE", "MANAGE_PITCHES", "MANAGE_INVENTORY", "FULFILL_ORDERS"] as const;
const overview: VenueStaffOverview = {
  venueId, venueName: "渤海元丰足球场", viewerRole: "OWNER", viewerPermissions: allPermissions, canManage: true,
  members: [
    { id: userId, displayName: "陈负责人", avatarUrl: null, role: "OWNER", permissions: allPermissions, isSelf: true, isActive: true, version: 2 },
    { id: staffId, displayName: "夜班员工", avatarUrl: null, role: "STAFF", permissions: ["MANAGE_INVENTORY"], isSelf: false, isActive: true, version: 3 },
  ],
  activeInvitations: [{ id: invitationId, contactLabel: "周末值班", status: "ACTIVE", permissions: ["FULFILL_ORDERS"], expiresAt: "2026-09-08T08:00:00Z", createdAt: "2026-09-01T08:00:00Z" }],
  recentAudits: [{ id: "40000000-0000-4000-8000-000000000001", action: "INVITATION_CREATED", targetDisplayName: "周末值班", createdAt: "2026-09-01T08:00:00Z" }],
};

let captured: any;
let stored: VenueStaffMutationAttempt | null = null;
const store: VenueStaffAttemptStore = {
  load: jest.fn(() => stored),
  begin: jest.fn((attempt: VenueStaffMutationAttempt) => ({ kind: "READY" as const, attempt })),
  resolveForUser: jest.fn((current) => stored ? current === stored.originatingUserId ? { kind: "READY" as const, attempt: stored } : { kind: "FOREIGN_ACCOUNT_PENDING" as const, attempt: stored } : null),
  clear: jest.fn(() => { stored = null; }),
};

function source(authority: VenueStaffOverview = overview): jest.Mocked<VenueStaffDataSource> {
  return {
    login: jest.fn(async () => userId), currentUserId: jest.fn(() => userId), getOverview: jest.fn(async () => authority),
    createInvitation: jest.fn(async () => ({ kind: "CREATED", invitation: { ...authority.activeInvitations[0], status: "ACTIVE", invitationPath: `/pages/venue-staff-invitation/index?token=${"A".repeat(43)}` } })),
    updatePermissions: jest.fn(async (attempt) => ({ ...authority.members[1], permissions: attempt.permissions, version: attempt.expectedVersion + 1 })),
    removeMember: jest.fn(async (attempt) => ({ ...authority.members[1], isActive: false, version: attempt.expectedVersion + 1 })),
    revokeInvitation: jest.fn(async () => ({ ...authority.activeInvitations[0], status: "REVOKED" })),
    getCurrentInvitation: jest.fn(), acceptInvitation: jest.fn(),
  };
}

function page() {
  if (!captured) { (globalThis as any).Page = (definition: any) => { captured = definition; }; jest.requireActual("./index"); }
  return { ...captured, data: structuredClone(captured.data), alive: true, requestRevision: 0, authority: null, setData(patch: any) { Object.assign(this.data, patch); } };
}

beforeEach(() => {
  resetVenueStaffDataSourceForTesting(); resetVenueStaffAttemptStoreForTesting(); stored = null; jest.clearAllMocks(); registerVenueStaffAttemptStore(store);
  (globalThis as any).wx = {
    getWindowInfo: jest.fn(() => ({ windowWidth: 390, statusBarHeight: 44 })),
    getMenuButtonBoundingClientRect: jest.fn(() => ({ top: 48, left: 294, height: 32 })),
    hideShareMenu: jest.fn(), navigateBack: jest.fn(), reLaunch: jest.fn(), stopPullDownRefresh: jest.fn(),
    setClipboardData: jest.fn(({ success }: any) => success?.()),
  };
});

test("loads server authority and completes every owner mutation with real calls", async () => {
  const api = source(); registerVenueStaffDataSource(api); const view = page(); await view.onLoad({ venue_id: venueId });
  expect(view.data).toMatchObject({
    mode: "ready",
    canManage: true,
    venueName: overview.venueName,
    viewerRoleLabel: "负责人",
    members: [
      expect.objectContaining({ role: "OWNER", roleLabel: "负责人" }),
      expect.objectContaining({ role: "STAFF", roleLabel: "员工" }),
    ],
  });

  view.onOpenCreate(); view.onContactInput({ detail: { value: " 新员工 " } }); await view.onCreateInvitation();
  expect(api.createInvitation).toHaveBeenCalledWith(expect.objectContaining({ originatingUserId: userId, venueId, contactLabel: "新员工", permissions: ["MANAGE_INVENTORY"] }));
  expect(view.data).toMatchObject({ sheet: "created", createdPath: expect.stringContaining("token=") });
  view.onCopyInvitation(); expect(wx.setClipboardData).toHaveBeenCalledWith(expect.objectContaining({ data: view.data.createdPath }));

  await view.refreshAuthority(); view.onOpenEdit({ currentTarget: { dataset: { membershipId: staffId } } });
  expect(view.data.selectedTargetLabel).toBe("夜班员工");
  view.onToggleDraftPermission({ currentTarget: { dataset: { permission: "MANAGE_PROFILE" } } }); await view.onSavePermissions();
  expect(api.updatePermissions).toHaveBeenCalledWith(expect.objectContaining({ membershipId: staffId, expectedVersion: 3, permissions: ["MANAGE_INVENTORY", "MANAGE_PROFILE"] }));

  await view.refreshAuthority(); view.onPrepareRemove({ currentTarget: { dataset: { membershipId: staffId } } });
  expect(view.data.selectedTargetLabel).toBe("夜班员工");
  view.onRemoveReasonInput({ detail: { value: " 已离职 " } }); await view.onConfirmRemove();
  expect(api.removeMember).toHaveBeenCalledWith(expect.objectContaining({ membershipId: staffId, expectedVersion: 3, reason: "已离职" }));

  await view.refreshAuthority(); view.onRevokeInvitation({ currentTarget: { dataset: { invitationId } } });
  expect(view.data.selectedTargetLabel).toBe("周末值班");
  await view.onConfirmRevoke();
  expect(api.revokeInvitation).toHaveBeenCalledWith(expect.objectContaining({ invitationId }));
});

test("renders staff read-only authority and suppresses owner actions", async () => {
  const staffOverview: VenueStaffOverview = { ...overview, viewerRole: "STAFF", viewerPermissions: ["MANAGE_INVENTORY"], canManage: false, members: [{ ...overview.members[1], isSelf: true }], activeInvitations: [], recentAudits: [] };
  const api = source(staffOverview); registerVenueStaffDataSource(api); const view = page(); await view.onLoad({ venue_id: venueId });
  expect(view.data).toMatchObject({ mode: "ready", canManage: false, viewerRoleLabel: "员工" });
  view.onOpenCreate(); view.onOpenEdit({ currentTarget: { dataset: { membershipId: staffId } } });
  expect(view.data.sheet).toBe("none"); expect(api.createInvitation).not.toHaveBeenCalled();
});

test("retains unresolved persisted work and replays its original key", async () => {
  stored = { kind: "revokeInvitation", originatingUserId: userId, venueId, invitationId, idempotencyKey: "persisted-venue-staff-key" };
  const original = structuredClone(stored);
  const api = source(); registerVenueStaffDataSource(api); const view = page(); await view.onLoad({ venue_id: venueId });
  expect(view.data.unknownAttempt).toEqual(original);
  await view.onRetryUnknown();
  expect(api.revokeInvitation).toHaveBeenCalledWith(original); expect(store.clear).toHaveBeenCalled();
});

test("production markup binds all business actions and excludes preview fixtures", () => {
  const markup = readFileSync("miniprogram/pages/venue-staff/index.wxml", "utf8");
  for (const handler of ["onRetry", "onOpenCreate", "onCreateInvitation", "onCopyInvitation", "onOpenEdit", "onSavePermissions", "onPrepareRemove", "onRemoveReasonInput", "onConfirmRemove", "onRevokeInvitation", "onConfirmRevoke", "onRetryUnknown"]) expect(markup).toContain(handler);
  expect(markup).toContain("{{viewerRoleLabel}}"); expect(markup).toContain("{{item.roleLabel}}");
  expect(markup).toContain("{{selectedTargetLabel}}");
  expect(markup).not.toContain("{{viewerRole}}"); expect(markup).not.toContain("{{item.role}}</text>");
  expect(markup).not.toContain("模拟数据"); expect(markup).not.toContain("D1b 开发预览");
});
