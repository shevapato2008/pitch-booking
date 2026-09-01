import { describe, expect, jest, test } from "@jest/globals";

import type { Transport, WeChatIdentityCapability } from "../runtime/interfaces";
import type { SessionStore, StoredSession } from "./session-store";
import { createHttpVenueAccessDataSource, VenueAccessApiError } from "./http-venue-access";

const tokenResponse = {
  session_token: "wxsess_7jX9Qp2Lm8Vn4Rt6Yw3Kc5Hd1Bs0Fa9Eu7Gi2No6Zx4",
  expires_at: "2099-01-01T00:00:00Z",
  user: {
    id: "66666666-6666-4666-8666-666666666666",
    masked_phone: null,
    last_contact_name: null,
  },
};

const response = {
  venues: [{
    id: "00000000-0000-4000-8000-000000000010",
    name: "渤海元丰足球场",
    district_name: "西青区",
    address: "天津市西青区利达路",
    role: "STAFF",
    permissions: ["MANAGE_INVENTORY", "FULFILL_ORDERS"],
  }],
};

const unauthorized = {
  code: "HTTP_ERROR" as const,
  statusCode: 401,
  data: { error: { code: "AUTH_REQUIRED", message: "expired", request_id: "request-1", details: {} } },
};

describe("HTTP venue access data source", () => {
  test("lists managed venues with the stored bearer token", async () => {
    const harness = createHarness();
    harness.get.mockResolvedValueOnce(response);

    await expect(harness.source.listManagedVenues()).resolves.toEqual([{
      id: response.venues[0].id,
      name: response.venues[0].name,
      districtName: response.venues[0].district_name,
      address: response.venues[0].address,
      role: "STAFF",
      permissions: ["MANAGE_INVENTORY", "FULFILL_ORDERS"],
    }]);
    expect(harness.get).toHaveBeenCalledWith("/api/v1/admin/venues", {
      Authorization: "Bearer old-token",
    });
    expect(harness.identity.login).not.toHaveBeenCalled();
  });

  test("logs in once before listing when the session is missing", async () => {
    const harness = createHarness("missing");
    harness.post.mockResolvedValueOnce(tokenResponse);
    harness.get.mockResolvedValueOnce(response);

    await expect(harness.source.listManagedVenues()).resolves.toHaveLength(1);
    expect(harness.identity.login).toHaveBeenCalledTimes(1);
    expect(harness.sessionStore.save).toHaveBeenCalledWith({
      token: tokenResponse.session_token,
      expiresAt: tokenResponse.expires_at,
      userId: tokenResponse.user.id,
    });
    expect(harness.post).toHaveBeenCalledWith("/api/v1/auth/wechat/session", { code: "wx-login-code" });
    expect(harness.get).toHaveBeenCalledWith("/api/v1/admin/venues", {
      Authorization: `Bearer ${tokenResponse.session_token}`,
    });
  });

  test("automatically re-logs in only once after a 401", async () => {
    const harness = createHarness();
    harness.get.mockRejectedValueOnce(unauthorized).mockResolvedValueOnce(response);
    harness.post.mockResolvedValueOnce(tokenResponse);

    await expect(harness.source.listManagedVenues()).resolves.toHaveLength(1);
    expect(harness.identity.login).toHaveBeenCalledTimes(1);
    expect(harness.get).toHaveBeenCalledTimes(2);
    expect(harness.get.mock.calls[1]?.[1]).toEqual({
      Authorization: `Bearer ${tokenResponse.session_token}`,
    });
  });

  test("does not perform a second login when the request after recovery returns 401", async () => {
    const harness = createHarness();
    harness.get.mockRejectedValueOnce(unauthorized).mockRejectedValueOnce(unauthorized);
    harness.post.mockResolvedValueOnce(tokenResponse);

    await expect(harness.source.listManagedVenues())
      .rejects.toEqual(new VenueAccessApiError("LOGIN_FAILED"));
    expect(harness.identity.login).toHaveBeenCalledTimes(1);
    expect(harness.get).toHaveBeenCalledTimes(2);
  });

  test("maps identity and session exchange failures to LOGIN_FAILED", async () => {
    const identityFailure = createHarness("missing");
    identityFailure.identity.login.mockRejectedValueOnce(new Error("wx unavailable"));
    await expect(identityFailure.source.login())
      .rejects.toEqual(new VenueAccessApiError("LOGIN_FAILED"));

    const exchangeFailure = createHarness("missing");
    exchangeFailure.post.mockRejectedValueOnce({ code: "NETWORK_ERROR", errMsg: "offline" });
    await expect(exchangeFailure.source.listManagedVenues())
      .rejects.toEqual(new VenueAccessApiError("LOGIN_FAILED"));
  });

  test.each([
    ["network failure", { code: "NETWORK_ERROR", errMsg: "offline" }],
    ["server failure", { code: "HTTP_ERROR", statusCode: 500, data: { unexpected: true } }],
    ["unexpected transport rejection", null],
  ])("maps %s to VENUE_ACCESS_UNAVAILABLE", async (_label, failure) => {
    const harness = createHarness();
    harness.get.mockRejectedValueOnce(failure);
    await expect(harness.source.listManagedVenues())
      .rejects.toEqual(new VenueAccessApiError("VENUE_ACCESS_UNAVAILABLE"));
  });

  test("maps a malformed success response to VENUE_ACCESS_UNAVAILABLE", async () => {
    const harness = createHarness();
    harness.get.mockResolvedValueOnce({ venues: [{ ...response.venues[0], extra: true }] });
    await expect(harness.source.listManagedVenues())
      .rejects.toEqual(new VenueAccessApiError("VENUE_ACCESS_UNAVAILABLE"));
  });
});

function createHarness(initialSession: "present" | "missing" = "present") {
  let stored = initialSession === "present"
    ? { token: "old-token", expiresAt: "2099-01-01T00:00:00Z", userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }
    : null as StoredSession | null;
  const get = jest.fn(async (_path: string, _headers?: Readonly<Record<string, string>>) => {
    void _path;
    void _headers;
    return undefined as unknown;
  });
  const post = jest.fn(async (_path: string, _body: unknown) => {
    void _path;
    void _body;
    return undefined as unknown;
  });
  const transport: Transport = {
    get: <T>(path: string, headers?: Readonly<Record<string, string>>) => get(path, headers) as Promise<T>,
    post: <T>(path: string, body: unknown) => post(path, body) as Promise<T>,
    put: async <T>() => undefined as T,
  };
  const identity: WeChatIdentityCapability & { login: jest.MockedFunction<WeChatIdentityCapability["login"]> } = {
    login: jest.fn(async () => ({ code: "wx-login-code" })),
  };
  const save = jest.fn((session: StoredSession) => { stored = session; });
  const sessionStore: SessionStore = {
    load: () => stored,
    save,
    clear: () => { stored = null; },
  };
  return {
    get,
    post,
    identity,
    sessionStore,
    source: createHttpVenueAccessDataSource({ transport, identity, sessionStore }),
  };
}
