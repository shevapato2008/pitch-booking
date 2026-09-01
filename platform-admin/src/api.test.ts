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

  test("loads an exact attendance registration and posts a typed correction with CSRF and one idempotency key", async () => {
    const detail = {
      registration_id: "8ed324a4-56cb-4d73-9a77-0b4605ac3b17",
      registration_status: "JOINED",
      player_display_name: "林知远（右边锋）",
      intended_position: "FORWARD",
      game_name: "周末轻松局",
      game_status: "COMPLETED",
      venue_name: "渤海元丰足球场",
      pitch_name: "七人制 A 场",
      starts_at: "2026-08-31T09:00:00+08:00",
      ends_at: "2026-08-31T10:00:00+08:00",
      time_zone: "Asia/Shanghai",
      original_attendance_status: "PRESENT",
      attendance_recorded_at: "2026-08-31T10:06:00+08:00",
      attendance_status: "PRESENT",
      version: 3,
      corrections: [],
      allowed_correction: { target_status: "NO_SHOW", blocked_reason: null },
    };
    const event = {
      id: "a52df333-a813-4a99-97d6-780db998ce3a",
      registration_id: detail.registration_id,
      from_status: "PRESENT",
      to_status: "NO_SHOW",
      reason: "现场记录核验有误",
      corrected_by_principal_id: "platform-admin-1",
      corrected_at: "2026-08-31T14:18:00+08:00",
      registration_version_before: 3,
      registration_version_after: 4,
    };
    const fetcher = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({
        principal_id: "platform-admin-1",
        display_name: "平台管理员",
        roles: ["PLATFORM_ADMIN"],
        csrf_token: "a".repeat(64),
        expires_at: "2026-09-02T02:00:00Z",
      }))
      .mockResolvedValueOnce(jsonResponse(detail))
      .mockResolvedValueOnce(jsonResponse(event));
    const api = new PlatformApi(fetcher);

    await api.restoreSession();
    await expect(api.getAttendanceRegistration(detail.registration_id)).resolves.toEqual(detail);
    await expect(api.correctAttendanceRegistration(
      detail.registration_id,
      { attendance_status: "NO_SHOW", expected_version: 3, reason: "现场记录核验有误" },
      "attendance-key-123456",
    )).resolves.toEqual(event);

    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      `/platform-admin/api/v1/attendance/registrations/${detail.registration_id}`,
      expect.objectContaining({ method: "GET", credentials: "same-origin" }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      3,
      `/platform-admin/api/v1/attendance/registrations/${detail.registration_id}/corrections`,
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        headers: expect.objectContaining({
          "X-CSRF-Token": "a".repeat(64),
          "Idempotency-Key": "attendance-key-123456",
        }),
        body: JSON.stringify({
          attendance_status: "NO_SHOW",
          expected_version: 3,
          reason: "现场记录核验有误",
        }),
      }),
    );
    expect((fetcher.mock.calls[2]?.[1]?.headers as Record<string, string>).Origin).toBeUndefined();
  });

  test("creates a recruitment invitation with a one-time 201 secret and keeps 200 replay safe", async () => {
    const invitation = {
      id: "10000000-0000-4000-8000-000000000001",
      venue: { venue_id: "20000000-0000-4000-8000-000000000002", name: "海河东足球场", district_name: "河东区", address: "津塘路156号" },
      status: "ACTIVE",
      contact_label: "场馆负责人",
      expires_at: "2026-09-08T13:18:00Z",
      created_at: "2026-09-01T13:18:00Z",
      claimed_at: null,
      application_id: null,
      revoked_at: null,
      revocation_reason: null,
      version: 1,
    };
    const secret = { invitation, token: "Wm8Lk3R6uQ2pV9sH7xTa4bNcE5fG1jK0dZyR3qP6uQx", invitation_path: "pages/venue-invitation/index?token=Wm8Lk3R6uQ2pV9sH7xTa4bNcE5fG1jK0dZyR3qP6uQx" };
    const fetcher = jest.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ principal_id: "reviewer", display_name: "审核员", roles: ["ONBOARDING_REVIEWER"], csrf_token: "a".repeat(64), expires_at: "2099-01-01T00:00:00Z" }))
      .mockResolvedValueOnce(jsonResponse(secret, 201))
      .mockResolvedValueOnce(jsonResponse(invitation, 200))
      .mockResolvedValueOnce(jsonResponse(invitation, 200));
    const api = new PlatformApi(fetcher);
    await api.restoreSession();
    await expect(api.createRecruitmentInvitation({ venue_id: invitation.venue.venue_id, contact_label: "场馆负责人" }, "create-invite-key-001"))
      .resolves.toEqual({ created: true, result: secret });
    await expect(api.createRecruitmentInvitation({ venue_id: invitation.venue.venue_id, contact_label: "场馆负责人" }, "create-invite-key-001"))
      .resolves.toEqual({ created: false, invitation });
    await api.revokeRecruitmentInvitation(invitation.id, "不再合作", "revoke-invite-key-01");
    expect(fetcher).toHaveBeenNthCalledWith(2, "/platform-admin/api/v1/recruitment-invitations", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ "X-CSRF-Token": "a".repeat(64), "Idempotency-Key": "create-invite-key-001" }),
    }));
    expect(fetcher).toHaveBeenNthCalledWith(4, `/platform-admin/api/v1/recruitment-invitations/${invitation.id}/revoke`, expect.objectContaining({
      body: JSON.stringify({ reason: "不再合作" }),
      headers: expect.objectContaining({ "Idempotency-Key": "revoke-invite-key-01" }),
    }));
  });
});
