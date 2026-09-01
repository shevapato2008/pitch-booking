import { expect, jest, test } from "@jest/globals";
import type { StatusTransport, WeChatIdentityCapability } from "../runtime/interfaces";
import { staffInvitationWire, staffMemberWire, staffOverviewWire } from "../domain/venue-staff.test";
import { createSessionStore, type SessionStorage } from "./session-store";
import { createVenueStaffAttemptStore } from "./venue-staff-attempt-store";
import { createHttpVenueStaffDataSource, VenueStaffApiError } from "./http-venue-staff";

const userId = "10000000-0000-4000-8000-000000000001";
const otherUserId = "10000000-0000-4000-8000-000000000002";
const venueId = "20000000-0000-4000-8000-000000000001";
const membershipId = "10000000-0000-4000-8000-000000000002";
const invitationId = "30000000-0000-4000-8000-000000000001";
const invitationToken = "A".repeat(43);
const key = "venue-staff-key-00000001";

function setup(initialSession = true) {
  const calls: { method: string; path: string; body: unknown; headers?: Readonly<Record<string, string>> }[] = [];
  const responses: ({ statusCode: number; data: unknown } | { failure: unknown })[] = [];
  const transport: StatusTransport = {
    get: async () => { throw new Error("UNEXPECTED_DIRECT_GET"); },
    post: async () => { throw new Error("UNEXPECTED_DIRECT_POST"); },
    put: async () => { throw new Error("UNEXPECTED_DIRECT_PUT"); },
    requestWithStatus: async <T>(method: "GET" | "POST" | "PUT", path: string, body: unknown, headers?: Readonly<Record<string, string>>) => {
      calls.push({ method, path, body, headers });
      const next = responses.shift();
      if (!next) throw new Error("MISSING_RESPONSE");
      if ("failure" in next) throw next.failure;
      return next as { statusCode: number; data: T };
    },
  };
  const values = new Map<string, unknown>(initialSession ? [[
    "modelstella.pitch-booking.session.v2",
    { token: "session-token", expiresAt: "2099-01-01T00:00:00Z", userId },
  ]] : []);
  const storage: SessionStorage = {
    get: jest.fn((storageKey: string) => values.get(storageKey)),
    set: jest.fn((storageKey: string, value: unknown) => { values.set(storageKey, value); }),
    remove: jest.fn((storageKey: string) => { values.delete(storageKey); }),
  };
  const sessionStore = createSessionStore(storage);
  const attemptStore = createVenueStaffAttemptStore(storage);
  const identity: WeChatIdentityCapability = { login: jest.fn(async () => ({ code: "login-code" })) };
  const source = createHttpVenueStaffDataSource({ transport, identity, sessionStore, attemptStore });
  return {
    source, calls, responses, attemptStore, storage,
    enqueue(statusCode: number, data: unknown) { responses.push({ statusCode, data }); },
    fail(failure: unknown) { responses.push({ failure }); },
  };
}

test("logs in and reads the closed authority overview", async () => {
  const x = setup(false);
  x.enqueue(200, { session_token: "S".repeat(43), expires_at: "2099-01-01T00:00:00Z", user: { id: userId, masked_phone: null, last_contact_name: null } });
  await expect(x.source.login()).resolves.toBe(userId);
  expect(x.source.currentUserId()).toBe(userId);
  x.enqueue(200, staffOverviewWire());
  await expect(x.source.getOverview(venueId)).resolves.toMatchObject({ venueId, canManage: true });
  expect(x.calls.map(({ method, path }) => `${method} ${path}`)).toEqual([
    "POST /api/v1/auth/wechat/session",
    `GET /api/v1/admin/venues/${venueId}/staff`,
  ]);
  expect(x.calls[1].headers).toEqual({ Authorization: "Bearer " + "S".repeat(43) });
});

test("maps all owner mutations and distinguishes first 201 from safe 200 replay", async () => {
  const x = setup();
  const create = { kind: "createInvitation" as const, originatingUserId: userId, venueId, contactLabel: "夜班员工", permissions: ["MANAGE_INVENTORY" as const], idempotencyKey: key };
  x.enqueue(201, { ...staffInvitationWire(), invitation_path: `/pages/venue-staff-invitation/index?token=${invitationToken}` });
  await expect(x.source.createInvitation(create)).resolves.toMatchObject({ kind: "CREATED", invitation: { invitationPath: expect.stringContaining(invitationToken) } });
  x.enqueue(200, staffInvitationWire());
  await expect(x.source.createInvitation(create)).resolves.toMatchObject({ kind: "REPLAYED", invitation: { id: invitationId } });

  x.enqueue(200, staffMemberWire({ permissions: ["MANAGE_PROFILE"] }));
  await x.source.updatePermissions({ kind: "updatePermissions", originatingUserId: userId, venueId, membershipId, expectedVersion: 3, permissions: ["MANAGE_PROFILE"], idempotencyKey: key });
  x.enqueue(200, staffMemberWire({ is_active: false, version: 4 }));
  await x.source.removeMember({ kind: "removeMember", originatingUserId: userId, venueId, membershipId, expectedVersion: 3, reason: "已离职", idempotencyKey: key });
  x.enqueue(200, staffInvitationWire({ status: "REVOKED" }));
  await x.source.revokeInvitation({ kind: "revokeInvitation", originatingUserId: userId, venueId, invitationId, idempotencyKey: key });

  expect(x.calls.slice(0, 5).map(({ method, path, body }) => ({ method, path, body }))).toEqual([
    { method: "POST", path: `/api/v1/admin/venues/${venueId}/staff-invitations`, body: { contact_label: "夜班员工", permissions: ["MANAGE_INVENTORY"] } },
    { method: "POST", path: `/api/v1/admin/venues/${venueId}/staff-invitations`, body: { contact_label: "夜班员工", permissions: ["MANAGE_INVENTORY"] } },
    { method: "PUT", path: `/api/v1/admin/venues/${venueId}/staff/${membershipId}`, body: { expected_version: 3, permissions: ["MANAGE_PROFILE"] } },
    { method: "POST", path: `/api/v1/admin/venues/${venueId}/staff/${membershipId}/remove`, body: { expected_version: 3, reason: "已离职" } },
    { method: "POST", path: `/api/v1/admin/venues/${venueId}/staff-invitations/${invitationId}/revoke`, body: {} },
  ]);
  expect(x.calls.every((call) => call.headers?.["Idempotency-Key"] === key)).toBe(true);
});

test("sends invitation secret only in its redacted header and never persists it", async () => {
  const x = setup();
  x.enqueue(200, { id: invitationId, venue_id: venueId, venue_name: "渤海元丰足球场", status: "ACTIVE", permissions: ["MANAGE_INVENTORY"], expires_at: "2026-09-08T08:00:00Z" });
  await x.source.getCurrentInvitation(invitationToken);
  x.enqueue(200, { venue_id: venueId, venue_name: "渤海元丰足球场", membership: staffMemberWire({ is_self: true }), workspace_path: "/pages/venue-access/index" });
  await x.source.acceptInvitation(invitationToken, { kind: "acceptInvitation", originatingUserId: userId, invitationId, idempotencyKey: key });
  for (const call of x.calls) {
    expect(call.path).not.toContain(invitationToken);
    expect(JSON.stringify(call.body ?? null)).not.toContain(invitationToken);
    expect(call.headers?.["X-Venue-Staff-Invitation-Token"]).toBe(invitationToken);
  }
  expect(JSON.stringify(x.attemptStore.load())).not.toContain(invitationToken);
  expect(x.attemptStore.load()).toBeNull();
});

test("keeps unknown writes for same-key recovery and clears definitive conflicts", async () => {
  const attempt = { kind: "revokeInvitation" as const, originatingUserId: userId, venueId, invitationId, idempotencyKey: key };
  const unknown = setup(); unknown.fail({ code: "REQUEST_TIMEOUT", errMsg: "timeout" });
  await expect(unknown.source.revokeInvitation(attempt)).rejects.toMatchObject({ code: "VENUE_STAFF_RESULT_UNKNOWN" });
  expect(unknown.attemptStore.load()).toEqual(attempt);

  const conflict = setup(); conflict.fail({ code: "HTTP_ERROR", statusCode: 409, data: { error: { code: "VENUE_STAFF_STATE_CHANGED", message: "changed", request_id: "request", details: {} } } });
  await expect(conflict.source.revokeInvitation(attempt)).rejects.toMatchObject({ code: "VENUE_STAFF_STATE_CHANGED" });
  expect(conflict.attemptStore.load()).toBeNull();
});

test("re-authenticates once but refuses to send a persisted mutation as another account", async () => {
  const x = setup(false);
  x.enqueue(200, { session_token: "T".repeat(43), expires_at: "2099-01-01T00:00:00Z", user: { id: otherUserId, masked_phone: null, last_contact_name: null } });
  const attempt = { kind: "acceptInvitation" as const, originatingUserId: userId, invitationId, idempotencyKey: key };
  await expect(x.source.acceptInvitation(invitationToken, attempt)).rejects.toBeInstanceOf(VenueStaffApiError);
  await expect(x.source.acceptInvitation(invitationToken, attempt)).rejects.toMatchObject({ code: "VENUE_STAFF_ACCOUNT_CHANGED" });
  expect(x.calls).toHaveLength(1);
  expect(x.attemptStore.load()).toEqual(attempt);
});
