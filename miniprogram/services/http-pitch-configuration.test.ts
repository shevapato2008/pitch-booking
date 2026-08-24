import { expect, jest, test } from "@jest/globals";

import type { Transport, WeChatIdentityCapability } from "../runtime/interfaces";
import { configurationResponse } from "../domain/pitch-configuration.test";
import { createSessionStore } from "./session-store";
import { createHttpPitchConfigurationDataSource } from "./http-pitch-configuration";

const tokenResponse = { session_token: "wxsess_7jX9Qp2Lm8Vn4Rt6Yw3Kc5Hd1Bs0Fa9Eu7Gi2No6Zx4", expires_at: "2099-01-01T00:00:00Z", user: { id: "55555555-5555-4555-8555-555555555555", masked_phone: null, last_contact_name: null } };

test("loads and atomically saves configuration with bearer and stable key", async () => {
  const harness = createHarness();
  harness.post.mockResolvedValueOnce(tokenResponse); harness.get.mockResolvedValueOnce(configurationResponse);
  harness.put.mockResolvedValueOnce({ ...configurationResponse, configuration_version: 4 });
  await harness.source.login();
  expect(harness.storage.set).toHaveBeenCalledWith("modelstella.pitch-booking.session.v2", {
    token: tokenResponse.session_token,
    expiresAt: tokenResponse.expires_at,
    userId: tokenResponse.user.id,
  });
  await expect(harness.source.get(configurationResponse.venue.id)).resolves.toMatchObject({ configurationVersion: 3 });
  const attempt = { venueId: configurationResponse.venue.id, expectedVersion: 3, changes: [{ operation: "UPDATE" as const, pitchId: configurationResponse.pitches[0].id, customName: "北场", playersPerSide: 7, status: "ACTIVE" as const }], idempotencyKey: "pitch-configuration-key-1" };
  await harness.source.save(attempt);
  const auth = { Authorization: `Bearer ${tokenResponse.session_token}` };
  expect(harness.get).toHaveBeenCalledWith(`/api/v1/admin/venues/${configurationResponse.venue.id}/pitch-configuration`, auth);
  expect(harness.put).toHaveBeenCalledWith(`/api/v1/admin/venues/${configurationResponse.venue.id}/pitch-configuration`, {
    expected_version: 3, changes: [{ operation: "UPDATE", pitch_id: configurationResponse.pitches[0].id, custom_name: "北场", players_per_side: 7, status: "ACTIVE" }],
  }, { ...auth, "Idempotency-Key": "pitch-configuration-key-1" });
});

test("maps an interrupted write to unknown without changing the attempt", async () => {
  const harness = createHarness(); harness.post.mockResolvedValueOnce(tokenResponse); await harness.source.login();
  harness.put.mockRejectedValueOnce({ code: "NETWORK_ERROR", errMsg: "lost" });
  await expect(harness.source.save({ venueId: configurationResponse.venue.id, expectedVersion: 3, changes: [], idempotencyKey: "pitch-configuration-key-2" })).rejects.toMatchObject({ code: "PITCH_CONFIGURATION_RESULT_UNKNOWN" });
});

function createHarness() {
  const values = new Map<string, unknown>();
  const storage = { get: jest.fn((key: string) => values.get(key)), set: jest.fn((key: string, next: unknown) => { values.set(key, next); }), remove: jest.fn((key: string) => { values.delete(key); }) };
  const get = jest.fn(async (path: string, headers?: Readonly<Record<string,string>>) => { void path; void headers; return undefined as unknown; });
  const post = jest.fn(async (path: string, body: unknown, headers?: Readonly<Record<string,string>>) => { void path; void body; void headers; return undefined as unknown; });
  const put = jest.fn(async (path: string, body: unknown, headers?: Readonly<Record<string,string>>) => { void path; void body; void headers; return undefined as unknown; });
  const transport: Transport = { get: <T>(p: string, h?: Readonly<Record<string,string>>) => get(p,h) as Promise<T>, post: <T>(p:string,b:unknown,h?:Readonly<Record<string,string>>) => post(p,b,h) as Promise<T>, put: <T>(p:string,b:unknown,h?:Readonly<Record<string,string>>) => put(p,b,h) as Promise<T> };
  const identity: WeChatIdentityCapability = { login: jest.fn(async () => ({ code: "wx-code" })) };
  return { source: createHttpPitchConfigurationDataSource({ transport, identity, sessionStore: createSessionStore(storage, () => Date.parse("2026-08-11T00:00:00Z")) }), get, post, put, storage };
}
