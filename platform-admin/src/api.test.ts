import { ApiError, PlatformApi, SessionExpiredError } from "./api";
import { describe, expect, jest, test } from "@jest/globals";

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("PlatformApi", () => {
  test("exchanges a staff token, restores the cookie session, and propagates CSRF", async () => {
    const fetcher = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({
        principal_id: "reviewer-1",
        display_name: "平台审核员",
        roles: ["ONBOARDING_REVIEWER"],
        csrf_token: "csrf-login",
        expires_at: "2026-08-18T02:00:00Z",
      }))
      .mockResolvedValueOnce(jsonResponse({
        principal_id: "reviewer-1",
        display_name: "平台审核员",
        roles: ["ONBOARDING_REVIEWER"],
        csrf_token: "csrf-restored",
        expires_at: "2026-08-18T02:00:00Z",
      }))
      .mockResolvedValueOnce(jsonResponse({
        application_id: "app-1",
        outcome: "APPROVED",
        reason: "材料一致",
        reviewer_principal_id: "reviewer-1",
        reviewed_at: "2026-08-17T10:00:00Z",
        approved_venue_id: "venue-1",
      }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const api = new PlatformApi(fetcher);

    await api.login("x".repeat(32));
    await api.restoreSession();
    await api.decide("app-1", "APPROVED", "材料一致");
    await api.logout();

    expect(fetcher).toHaveBeenNthCalledWith(1, "/platform-admin/api/v1/auth/session", expect.objectContaining({
      method: "POST",
      credentials: "same-origin",
      body: JSON.stringify({ access_token: "x".repeat(32) }),
    }));
    expect(fetcher).toHaveBeenNthCalledWith(2, "/platform-admin/api/v1/auth/session", expect.objectContaining({
      method: "GET",
      credentials: "same-origin",
    }));
    expect(fetcher).toHaveBeenNthCalledWith(3, "/platform-admin/api/v1/onboarding/applications/app-1/decisions", expect.objectContaining({
      method: "POST",
      credentials: "same-origin",
      headers: expect.objectContaining({ "X-CSRF-Token": "csrf-restored" }),
    }));
    expect(fetcher).toHaveBeenNthCalledWith(4, "/platform-admin/api/v1/auth/session", expect.objectContaining({
      method: "DELETE",
      headers: expect.objectContaining({ "X-CSRF-Token": "csrf-restored" }),
    }));
  });

  test("encodes queue filters, loads detail, and detects an already expired evidence link", async () => {
    const fetcher = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ items: [], next_cursor: null }))
      .mockResolvedValueOnce(jsonResponse({ application_id: "app-1" }))
      .mockResolvedValueOnce(jsonResponse({
        download_url: "/platform-admin/api/v1/onboarding/evidence/evidence-1/content?expires=1&signature=x",
        expires_at: "2026-08-17T09:59:59Z",
      }));
    const api = new PlatformApi(fetcher, () => new Date("2026-08-17T10:00:00Z"));

    await api.listApplications({ kind: "CREATE", status: "SUBMITTED", cursor: "next 1", limit: 10 });
    await api.getApplication("app-1");
    await expect(api.getEvidenceDownload("evidence-1")).rejects.toMatchObject({
      name: "ApiError",
      code: "EVIDENCE_LINK_EXPIRED",
      status: 410,
    });

    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "/platform-admin/api/v1/onboarding/applications?kind=CREATE&status=SUBMITTED&cursor=next+1&limit=10",
    );
    expect(fetcher.mock.calls[1]?.[0]).toBe(
      "/platform-admin/api/v1/onboarding/applications/app-1",
    );
  });

  test("turns a 401 into an explicit session-expired error", async () => {
    const fetcher = jest.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ error: { code: "PLATFORM_SESSION_INVALID", message: "登录已失效" } }, 401),
    );
    const api = new PlatformApi(fetcher);

    await expect(api.listApplications({})).rejects.toBeInstanceOf(SessionExpiredError);
    expect(ApiError).toBeDefined();
  });
});
