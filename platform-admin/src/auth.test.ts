import { describe, expect, jest, test } from "@jest/globals";

import { ApiError, SessionExpiredError, type PlatformApi, type PlatformSession } from "./api";
import { AuthController, consumeAccessToken } from "./auth";

const session: PlatformSession = {
  principal_id: "reviewer-1",
  display_name: "平台审核员",
  roles: ["ONBOARDING_REVIEWER"],
  csrf_token: "csrf",
  expires_at: "2026-08-18T02:00:00Z",
};

describe("AuthController", () => {
  test("restores an existing cookie session without exposing a token", async () => {
    const api = { restoreSession: jest.fn<() => Promise<PlatformSession>>().mockResolvedValue(session) } as unknown as PlatformApi;
    const controller = new AuthController(api);

    await controller.bootstrap();

    expect(controller.state).toEqual({ status: "authenticated", session, error: null });
  });

  test("returns to the login screen when the server session expires", async () => {
    const api = { restoreSession: jest.fn<() => Promise<PlatformSession>>().mockRejectedValue(new SessionExpiredError("登录已失效")) } as unknown as PlatformApi;
    const controller = new AuthController(api);

    await controller.bootstrap();

    expect(controller.state).toEqual({ status: "anonymous", session: null, error: null });
  });

  test("blocks an empty login token before making a request", async () => {
    const api = { login: jest.fn() } as unknown as PlatformApi;
    const controller = new AuthController(api);

    await expect(controller.login("  ")).resolves.toBe(false);

    expect(api.login).not.toHaveBeenCalled();
    expect(controller.state).toEqual({ status: "anonymous", session: null, error: "请输入工作人员访问令牌" });
  });

  test("expires the session at expires_at and invokes the sensitive-state cleanup", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-08-17T10:00:00Z"));
    const expiring = { ...session, expires_at: "2026-08-17T10:00:01Z" };
    const api = { restoreSession: jest.fn<() => Promise<PlatformSession>>().mockResolvedValue(expiring) } as unknown as PlatformApi;
    const cleanup = jest.fn();
    const controller = new AuthController(api);
    controller.setExpiryHandler(cleanup);

    await controller.bootstrap();
    jest.advanceTimersByTime(1001);

    expect(controller.state.status).toBe("anonymous");
    expect(cleanup).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  test("rechecks expires_at when focus or visibility returns", async () => {
    let now = new Date("2026-08-17T10:00:00Z").getTime();
    const expiring = { ...session, expires_at: "2026-08-17T10:00:01Z" };
    const api = { restoreSession: jest.fn<() => Promise<PlatformSession>>().mockResolvedValue(expiring) } as unknown as PlatformApi;
    const controller = new AuthController(api, {
      now: () => now,
      setTimer: () => 0 as unknown as ReturnType<typeof setTimeout>,
    });
    await controller.bootstrap();

    now = new Date("2026-08-17T10:00:02Z").getTime();

    expect(controller.checkExpiry()).toBe(true);
    expect(controller.state.status).toBe("anonymous");
  });

  test("preserves the authenticated state when logout has a network or 5xx failure", async () => {
    const api = { logout: jest.fn<() => Promise<void>>().mockRejectedValue(new ApiError(503, "SERVICE_UNAVAILABLE", "退出失败")) } as unknown as PlatformApi;
    const controller = new AuthController(api);
    controller.state = { status: "authenticated", session, error: null };

    await expect(controller.logout()).resolves.toBe(false);

    expect(controller.state).toEqual({ status: "authenticated", session, error: "退出失败" });
  });

  test("clears local state when logout confirms the session is already unauthorized", async () => {
    const api = { logout: jest.fn<() => Promise<void>>().mockRejectedValue(new SessionExpiredError()) } as unknown as PlatformApi;
    const controller = new AuthController(api);
    controller.state = { status: "authenticated", session, error: null };

    await expect(controller.logout()).resolves.toBe(true);

    expect(controller.state.status).toBe("anonymous");
  });

  test("consumes and immediately clears the secret input before asynchronous login", () => {
    const input = { value: "staff-secret" };

    expect(consumeAccessToken(input)).toBe("staff-secret");
    expect(input.value).toBe("");
  });
});
