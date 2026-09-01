/// <reference types="node" />
/* eslint-disable @typescript-eslint/no-explicit-any -- Mini Program Page harness */
import { beforeEach, expect, jest, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import type { CurrentVenueStaffInvitation, VenueStaffMembershipAccepted } from "../../domain/venue-staff";
import { VenueStaffApiError } from "../../services/http-venue-staff";
import type { VenueStaffAttemptStore, VenueStaffDataSource, VenueStaffMutationAttempt } from "../../services/venue-staff";
import { registerVenueStaffAttemptStore, registerVenueStaffDataSource, resetVenueStaffAttemptStoreForTesting, resetVenueStaffDataSourceForTesting } from "../../services/venue-staff";

const userId = "10000000-0000-4000-8000-000000000001";
const venueId = "20000000-0000-4000-8000-000000000001";
const invitationId = "30000000-0000-4000-8000-000000000001";
const token = "A".repeat(43);
const invitation: CurrentVenueStaffInvitation = { id: invitationId, venueId, venueName: "渤海元丰足球场", status: "ACTIVE", permissions: ["MANAGE_INVENTORY"], expiresAt: "2026-09-08T08:00:00Z" };
const accepted: VenueStaffMembershipAccepted = {
  venueId, venueName: invitation.venueName,
  membership: { id: userId, displayName: "场馆员工", avatarUrl: null, role: "STAFF", permissions: invitation.permissions, isSelf: true, isActive: true, version: 1 },
  workspacePath: "/pages/venue-access/index",
};

let definition: any; let stored: VenueStaffMutationAttempt | null = null;
const store: VenueStaffAttemptStore = {
  load: jest.fn(() => stored), begin: jest.fn((attempt: VenueStaffMutationAttempt) => ({ kind: "READY" as const, attempt })),
  resolveForUser: jest.fn((current: string) => stored ? current === stored.originatingUserId ? { kind: "READY" as const, attempt: stored } : { kind: "FOREIGN_ACCOUNT_PENDING" as const, attempt: stored } : null),
  clear: jest.fn(() => { stored = null; }),
};
function source(): jest.Mocked<VenueStaffDataSource> { return {
  login: jest.fn(async () => userId), currentUserId: jest.fn(() => userId), getOverview: jest.fn(), createInvitation: jest.fn(), updatePermissions: jest.fn(), removeMember: jest.fn(), revokeInvitation: jest.fn(),
  getCurrentInvitation: jest.fn(async () => invitation), acceptInvitation: jest.fn(async () => accepted),
}; }
function page() { if (!definition) { (globalThis as any).Page = (value: any) => { definition = value; }; jest.requireActual("./index"); } return { ...definition, data: structuredClone(definition.data), invitationToken: "", alive: true, requestRevision: 0, setData(patch: any) { Object.assign(this.data, patch); } }; }
beforeEach(() => {
  resetVenueStaffDataSourceForTesting(); resetVenueStaffAttemptStoreForTesting(); stored = null; jest.clearAllMocks(); registerVenueStaffAttemptStore(store);
  (globalThis as any).wx = { getWindowInfo: jest.fn(() => ({ windowWidth: 390, statusBarHeight: 44 })), getMenuButtonBoundingClientRect: jest.fn(() => ({ top: 48, left: 294, height: 32 })), hideShareMenu: jest.fn(), navigateBack: jest.fn(), reLaunch: jest.fn() };
});

test("loads the secret through the private header path without exposing it in render data", async () => {
  const api = source(); registerVenueStaffDataSource(api); const view = page(); await view.onLoad({ token });
  expect(api.getCurrentInvitation).toHaveBeenCalledWith(token); expect(view.data).toMatchObject({ mode: "ready", venueName: invitation.venueName });
  expect(JSON.stringify(view.data)).not.toContain(token); expect(view.invitationToken).toBe(token);
});

test("accepts with a token-free persisted attempt and opens the real returned workspace", async () => {
  const api = source(); registerVenueStaffDataSource(api); const view = page(); await view.onLoad({ token }); await view.onAcceptInvitation();
  expect(api.acceptInvitation).toHaveBeenCalledWith(token, expect.objectContaining({ kind: "acceptInvitation", originatingUserId: userId, invitationId }));
  expect(JSON.stringify(api.acceptInvitation.mock.calls[0][1])).not.toContain(token); expect(view.data).toMatchObject({ mode: "accepted", workspacePath: "/pages/venue-access/index" }); expect(view.invitationToken).toBe("");
  view.onOpenPortfolio(); expect(wx.reLaunch).toHaveBeenCalledWith({ url: "/pages/venue-access/index" });
});

test("shows unavailable without identity disclosure and lets the real retry run", async () => {
  const api = source(); api.getCurrentInvitation.mockRejectedValueOnce(new VenueStaffApiError("VENUE_STAFF_INVITATION_UNAVAILABLE")).mockResolvedValueOnce(invitation); registerVenueStaffDataSource(api);
  const view = page(); await view.onLoad({ token }); expect(view.data).toMatchObject({ mode: "unavailable", venueName: "" });
  await view.onRetry(); expect(view.data.mode).toBe("ready"); expect(api.getCurrentInvitation).toHaveBeenCalledTimes(2);
});

test("a malformed deep link offers a real return action instead of an inert retry", async () => {
  const api = source(); registerVenueStaffDataSource(api); const view = page();
  await view.onLoad({ token: "invalid" });
  expect(view.data).toMatchObject({ mode: "unavailable", retryAvailable: false });
  expect(api.login).not.toHaveBeenCalled(); expect(api.getCurrentInvitation).not.toHaveBeenCalled();
  view.onReturnToEntry();
  expect(wx.reLaunch).toHaveBeenCalledWith({ url: "/pages/intent-entry/index" });
  const markup = readFileSync("miniprogram/pages/venue-staff-invitation/index.wxml", "utf8");
  expect(markup).toMatch(/mode === 'unavailable' && !retryAvailable[^>]*bindtap="onReturnToEntry"[^>]*>返回首页<\/button>/);
});

test("replays an unknown accept with its original key", async () => {
  stored = { kind: "acceptInvitation", originatingUserId: userId, invitationId, idempotencyKey: "persisted-accept-key-001" }; const original = structuredClone(stored);
  const api = source(); registerVenueStaffDataSource(api); const view = page(); await view.onLoad({ token }); expect(view.data.unknownAttempt).toEqual(original);
  await view.onRetryUnknown(); expect(api.acceptInvitation).toHaveBeenCalledWith(token, original); expect(view.data.mode).toBe("accepted");
});

test("production invitation markup has real actions and no private contact field or fixture", () => {
  const markup = readFileSync("miniprogram/pages/venue-staff-invitation/index.wxml", "utf8");
  for (const handler of ["onHeaderBack", "onAcceptInvitation", "onRetry", "onRetryUnknown", "onOpenPortfolio", "onReturnToEntry"]) expect(markup).toContain(handler);
  expect(markup).not.toContain("邀请对象"); expect(markup).not.toContain("contactLabel"); expect(markup).not.toContain("模拟数据");
});
