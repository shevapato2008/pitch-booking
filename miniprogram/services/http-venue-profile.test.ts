import { expect, jest, test } from "@jest/globals";
import { venueProfileWire } from "../domain/venue-profile.test";
import type { DeletingTransport, WeChatIdentityCapability } from "../runtime/interfaces";
import { createSessionStore } from "./session-store";
import { createHttpVenueProfileDataSource, VenueProfileApiError } from "./http-venue-profile";
import { createVenueProfileAttemptStore } from "./venue-profile-attempt-store";

function setup(initialSession = true) {
  const calls: { method: string; path: string; body?: unknown; headers?: Readonly<Record<string, string>> }[] = [];
  let response: unknown = venueProfileWire(); let failure: unknown;
  const invoke = async <T>(method: string, path: string, body?: unknown, headers?: Readonly<Record<string, string>>): Promise<T> => { calls.push({ method, path, body, headers }); if (failure) throw failure; return response as T; };
  const transport: DeletingTransport = {
    get: <T>(path: string, headers?: Readonly<Record<string, string>>) => invoke<T>("GET", path, undefined, headers),
    post: <T>(path: string, body: unknown, headers?: Readonly<Record<string, string>>) => invoke<T>("POST", path, body, headers),
    put: <T>(path: string, body: unknown, headers?: Readonly<Record<string, string>>) => invoke<T>("PUT", path, body, headers),
    delete: <T>(path: string, body: unknown, headers?: Readonly<Record<string, string>>) => invoke<T>("DELETE", path, body, headers),
  };
  const sessionValues = new Map<string, unknown>(initialSession ? [[
    "modelstella.pitch-booking.session.v2",
    { token: "token", expiresAt: "2099-01-01T00:00:00Z", userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
  ]] : []);
  const sessionStorage = {
    get: jest.fn((storageKey: string) => sessionValues.get(storageKey)),
    set: jest.fn((storageKey: string, value: unknown) => { sessionValues.set(storageKey, value); }),
    remove: jest.fn((storageKey: string) => { sessionValues.delete(storageKey); }),
  };
  const sessionStore = createSessionStore(sessionStorage);
  let attemptValue: unknown; const attemptStore = createVenueProfileAttemptStore({ get: () => attemptValue, set: (_key, value) => { attemptValue = value; }, remove: () => { attemptValue = undefined; } });
  const identity: WeChatIdentityCapability = { login: jest.fn(async () => ({ code: "login-code" })) };
  return { source: createHttpVenueProfileDataSource({ transport, identity, sessionStore, attemptStore }), calls, attemptStore, identity, sessionStorage, setResponse: (value: unknown) => { response = value; }, setFailure: (value: unknown) => { failure = value; } };
}
const key = "1234567890abcdef"; const venueId = "venue / one"; const imageId = "image / one";

test("maps bootstrap and every profile mutation to the frozen authenticated endpoints", async () => {
  const x = setup(); await x.source.get(venueId);
  await x.source.save({ kind: "save", venueId, scope: "description", idempotencyKey: key, body: { expectedFacilityVersion: 4, expectedRevisionVersion: 7, description: "介绍", facilities: ["PARKING"] } } as never);
  x.setResponse({ image_id: "c3195309-183b-46cc-81e6-2c0977223001", object_key: "private/key", signed_put_url: "https://uploads.example.com/object?signature=x", required_headers: { "Content-Type": "image/jpeg", "Content-Length": "8" }, maximum_bytes: 10485760, accepted_mime_types: ["image/jpeg", "image/png", "image/webp"] });
  await x.source.createUploadIntent({ kind: "uploadIntent", venueId, idempotencyKey: key, body: { expectedRevisionVersion: 7, filename: "field.jpg", mimeType: "image/jpeg", byteSize: 8 } });
  x.setResponse(venueProfileWire());
  await x.source.completeUpload({ kind: "complete", venueId, imageId, expectedRevisionVersion: 7, idempotencyKey: key });
  await x.source.deleteImage({ kind: "delete", venueId, imageId, expectedRevisionVersion: 7, idempotencyKey: key });
  await x.source.reorderImages({ kind: "reorder", venueId, imageIds: [imageId], expectedRevisionVersion: 7, idempotencyKey: key });
  await x.source.setCover({ kind: "cover", venueId, imageId, expectedRevisionVersion: 7, idempotencyKey: key });
  await x.source.retryModeration({ kind: "retry", venueId, itemId: imageId, expectedRevisionVersion: 7, idempotencyKey: key });
  expect(x.calls.map(({ method, path }) => `${method} ${path}`)).toEqual([
    "GET /api/v1/admin/venues/venue%20%2F%20one/profile", "PUT /api/v1/admin/venues/venue%20%2F%20one/profile",
    "POST /api/v1/admin/venues/venue%20%2F%20one/profile/images/upload-intents", "POST /api/v1/admin/venues/venue%20%2F%20one/profile/images/image%20%2F%20one/complete",
    "DELETE /api/v1/admin/venues/venue%20%2F%20one/profile/images/image%20%2F%20one", "PUT /api/v1/admin/venues/venue%20%2F%20one/profile/images/order",
    "PUT /api/v1/admin/venues/venue%20%2F%20one/profile/images/image%20%2F%20one/cover", "POST /api/v1/admin/venues/venue%20%2F%20one/profile/moderation/image%20%2F%20one/retry",
  ]);
  expect(x.calls.slice(1).every((call) => call.headers?.Authorization === "Bearer token" && call.headers["Idempotency-Key"] === key)).toBe(true);
  expect(x.calls[1].body).toEqual({ expected_facility_version: 4, expected_revision_version: 7, description: "介绍", facilities: ["PARKING"] });
});

test("logs in once on missing session and keeps unresolved writes for original-key retry", async () => {
  const loginUserId = "99999999-9999-4999-8999-999999999999";
  const login = setup(false); login.setResponse({ session_token: "x".repeat(43), expires_at: "2099-01-01T00:00:00Z", user: { id: loginUserId, masked_phone: null, last_contact_name: null } });
  await expect(login.source.login()).resolves.toBeUndefined(); expect(login.identity.login).toHaveBeenCalledTimes(1);
  expect(login.sessionStorage.set).toHaveBeenCalledWith("modelstella.pitch-booking.session.v2", {
    token: "x".repeat(43),
    expiresAt: "2099-01-01T00:00:00Z",
    userId: loginUserId,
  });

  const unknown = setup(); unknown.setFailure({ code: "REQUEST_TIMEOUT", errMsg: "timeout" });
  const attempt = { kind: "delete" as const, venueId, imageId, expectedRevisionVersion: 7, idempotencyKey: key };
  await expect(unknown.source.deleteImage(attempt)).rejects.toBeInstanceOf(VenueProfileApiError);
  expect(unknown.attemptStore.load()).toEqual(attempt);
});

test("keeps the attempt and maps malformed 2xx or unexpected mutation failures to unknown", async () => {
  const attempt = { kind: "delete" as const, venueId, imageId, expectedRevisionVersion: 7, idempotencyKey: key };
  const malformed = setup(); malformed.setResponse({ malformed: true });
  await expect(malformed.source.deleteImage(attempt)).rejects.toMatchObject({ code: "VENUE_PROFILE_RESULT_UNKNOWN" });
  expect(malformed.attemptStore.load()).toEqual(attempt);

  const unexpected = setup(); unexpected.setFailure(new Error("socket adapter exploded"));
  await expect(unexpected.source.deleteImage(attempt)).rejects.toMatchObject({ code: "VENUE_PROFILE_RESULT_UNKNOWN" });
  expect(unexpected.attemptStore.load()).toEqual(attempt);
});

test("does not replace an explicit venue-profile business failure with unknown", async () => {
  const x = setup(); x.setFailure({ code: "HTTP_ERROR", statusCode: 409, data: { error: { code: "VENUE_PROFILE_VERSION_CONFLICT", message: "stale", request_id: "request", details: {} } } });
  const attempt = { kind: "delete" as const, venueId, imageId, expectedRevisionVersion: 7, idempotencyKey: key };
  await expect(x.source.deleteImage(attempt)).rejects.toMatchObject({ code: "VENUE_PROFILE_VERSION_CONFLICT" });
  expect(x.attemptStore.load()).toBeNull();
});
