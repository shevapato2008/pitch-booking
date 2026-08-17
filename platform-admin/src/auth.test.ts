import { describe, expect, jest, test } from "@jest/globals";

import { AuthController } from "./auth";
import { SessionExpiredError, type PlatformApi, type PlatformSession } from "./api";

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
});
