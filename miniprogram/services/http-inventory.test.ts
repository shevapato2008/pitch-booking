import { expect, jest, test } from "@jest/globals";

import type { Transport, WeChatIdentityCapability } from "../runtime/interfaces";
import { createSessionStore } from "./session-store";
import { createHttpInventoryDataSource } from "./http-inventory";

const tokenResponse = {
  session_token: "wxsess_7jX9Qp2Lm8Vn4Rt6Yw3Kc5Hd1Bs0Fa9Eu7Gi2No6Zx4",
  expires_at: "2099-01-01T00:00:00Z",
  user: { id: "22222222-2222-4222-8222-222222222222", masked_phone: null, last_contact_name: null },
};
const slot = {
  id: "00000000-0000-4000-8000-000000000030", pitch_id: "00000000-0000-4000-8000-000000000020",
  starts_at: "2026-08-11T09:30:00+08:00", ends_at: "2026-08-11T11:00:00+08:00",
  start_time: "09:30", end_time: "11:00", price_cents: 20000, status: "AVAILABLE",
  checkout_version: 1, editable: true, read_only_reason: null,
};
const inventory = {
  venue: { id: "00000000-0000-4000-8000-000000000010", name: "渤海元丰足球场", timezone: "Asia/Shanghai" },
  local_date: "2026-08-11", availability_window: { start_date: "2026-08-10", end_date: "2026-08-23" },
  pitches: [{ id: slot.pitch_id, name: "七人制 A 场", display_name: "A场", pitch_type: "SEVEN_A_SIDE", players_per_side: 7 }],
  selected_pitch_id: slot.pitch_id, slots: [slot], generated_at: "2026-08-11T06:00:00Z",
};

test("reads a day and writes create/update with bearer and stable idempotency headers", async () => {
  const harness = createHarness();
  harness.post.mockResolvedValueOnce(tokenResponse).mockResolvedValueOnce(slot);
  harness.get.mockResolvedValueOnce(inventory);
  harness.put.mockResolvedValueOnce({ ...slot, price_cents: 28000, status: "CLOSED", checkout_version: 2 });
  await harness.source.login();
  expect(harness.storage.set).toHaveBeenCalledWith("modelstella.pitch-booking.session.v2", {
    token: tokenResponse.session_token,
    expiresAt: tokenResponse.expires_at,
    userId: tokenResponse.user.id,
  });
  await expect(harness.source.getDay(inventory.venue.id, slot.pitch_id, "2026-08-11")).resolves.toMatchObject({ localDate: "2026-08-11" });
  await harness.source.createSlot({
    venueId: inventory.venue.id, body: { pitchId: slot.pitch_id, localDate: "2026-08-11", startTime: "09:30", endTime: "11:00", priceCents: 20000 },
    idempotencyKey: "inventory-create-stable-key",
  });
  await harness.source.updateSlot({
    venueId: inventory.venue.id, slotId: slot.id,
    body: { expectedCheckoutVersion: 1, priceCents: 28000, status: "CLOSED" },
    idempotencyKey: "inventory-update-stable-key",
  });

  const auth = { Authorization: `Bearer ${tokenResponse.session_token}` };
  expect(harness.get).toHaveBeenCalledWith(
    `/api/v1/admin/venues/${inventory.venue.id}/inventory?pitch_id=${slot.pitch_id}&local_date=2026-08-11`, auth,
  );
  expect(harness.post).toHaveBeenLastCalledWith(`/api/v1/admin/venues/${inventory.venue.id}/inventory/slots`, {
    pitch_id: slot.pitch_id, local_date: "2026-08-11", start_time: "09:30", end_time: "11:00", price_cents: 20000,
  }, { ...auth, "Idempotency-Key": "inventory-create-stable-key" });
  expect(harness.put).toHaveBeenCalledWith(`/api/v1/admin/venues/${inventory.venue.id}/inventory/slots/${slot.id}`, {
    expected_checkout_version: 1, price_cents: 28000, status: "CLOSED",
  }, { ...auth, "Idempotency-Key": "inventory-update-stable-key" });
});

test("refreshes one 401 and preserves the mutation key and body", async () => {
  const harness = createHarness();
  harness.post.mockResolvedValueOnce(tokenResponse);
  await harness.source.login();
  const authRequired = { code: "HTTP_ERROR", statusCode: 401, data: { error: { code: "AUTH_REQUIRED", message: "expired", request_id: "req", details: {} } } };
  harness.put.mockRejectedValueOnce(authRequired).mockResolvedValueOnce(slot);
  harness.post.mockResolvedValueOnce(tokenResponse);
  const attempt = {
    venueId: inventory.venue.id, slotId: slot.id,
    body: { expectedCheckoutVersion: 1, priceCents: 20000, status: "AVAILABLE" as const },
    idempotencyKey: "same-key-after-login",
  };
  await expect(harness.source.updateSlot(attempt)).resolves.toMatchObject({ id: slot.id });
  expect(harness.put.mock.calls[1]).toEqual(harness.put.mock.calls[0]);
  expect(harness.identity.login).toHaveBeenCalledTimes(2);
});

test.each(["NETWORK_ERROR", "REQUEST_TIMEOUT"] as const)("maps write %s to unknown result", async (code) => {
  const harness = createHarness();
  harness.post.mockResolvedValueOnce(tokenResponse);
  await harness.source.login();
  harness.post.mockRejectedValueOnce({ code, errMsg: "lost" });
  await expect(harness.source.createSlot({
    venueId: inventory.venue.id,
    body: { pitchId: slot.pitch_id, localDate: "2026-08-11", startTime: "09:30", endTime: "11:00", priceCents: 20000 },
    idempotencyKey: "unknown-write-key",
  })).rejects.toMatchObject({ code: "INVENTORY_RESULT_UNKNOWN" });
});

function createHarness() {
  const persisted = new Map<string, unknown>();
  const storage = { get: jest.fn((key: string) => persisted.get(key)), set: jest.fn((key: string, value: unknown) => { persisted.set(key, value); }), remove: jest.fn((key: string) => { persisted.delete(key); }) };
  const get = jest.fn(async (path: string, headers?: Readonly<Record<string, string>>) => { void path; void headers; return undefined as unknown; });
  const post = jest.fn(async (path: string, body: unknown, headers?: Readonly<Record<string, string>>) => { void path; void body; void headers; return undefined as unknown; });
  const put = jest.fn(async (path: string, body: unknown, headers?: Readonly<Record<string, string>>) => { void path; void body; void headers; return undefined as unknown; });
  const transport: Transport = {
    get: <T>(path: string, headers?: Readonly<Record<string, string>>) => get(path, headers) as Promise<T>,
    post: <T>(path: string, body: unknown, headers?: Readonly<Record<string, string>>) => post(path, body, headers) as Promise<T>,
    put: <T>(path: string, body: unknown, headers?: Readonly<Record<string, string>>) => put(path, body, headers) as Promise<T>,
  };
  const identity: WeChatIdentityCapability = { login: jest.fn(async () => ({ code: "wx-login-code" })) };
  const source = createHttpInventoryDataSource({ transport, identity, sessionStore: createSessionStore(storage, () => Date.parse("2026-08-11T00:00:00Z")) });
  return { source, get, post, put, identity, storage };
}
