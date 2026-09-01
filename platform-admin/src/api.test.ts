import { ApiError, PlatformApi, SessionExpiredError } from "./api";
import { describe, expect, jest, test } from "@jest/globals";

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const reportId = "66000000-0000-4000-8000-000000000001";
const target = {
  game_id: "55000000-0000-4000-8000-000000000001",
  game_name: "周末轻松局",
  organizer_team_name: "海河周末队",
  venue_name: "渤海元丰足球场",
  pitch_name: "七人制 A 场",
  starts_at: "2026-09-06T09:00:00+08:00",
  ends_at: "2026-09-06T10:00:00+08:00",
  time_zone: "Asia/Shanghai",
};
const queueItem = {
  report_id: reportId,
  category: "FALSE_INFORMATION",
  status: "PENDING",
  target,
  submitted_at: "2026-09-01T08:00:00+08:00",
};
const pendingDetail = {
  ...queueItem,
  facts: "公开页面写有照明，现场实际没有照明。",
  reporter_display_name: "周末小翼",
  reporter_registration_status: "JOINED",
  authority: {
    persisted_status: "PUBLISHED",
    effective_status: "PUBLISHED",
    cancellation_source: null,
    version: 4,
    cancellation_allowed: true,
    cancellation_blocker: null,
  },
  allowed_outcomes: ["DISMISSED", "CONFIRMED_RECORDED", "CONFIRMED_GAME_CANCELLED"],
  resolution: null,
};
const recordedResolution = {
  resolution_id: "77000000-0000-4000-8000-000000000001",
  outcome: "CONFIRMED_RECORDED",
  resolution_note: "已核实并记录。",
  resolved_by_principal_id: "platform-admin-1",
  resolved_at: "2026-09-01T09:00:00+08:00",
  game_version_before: null,
  game_version_after: null,
};
const cancelledResolution = {
  ...recordedResolution,
  outcome: "CONFIRMED_GAME_CANCELLED",
  game_version_before: 4,
  game_version_after: 5,
};
const resolvedDetail = {
  ...pendingDetail,
  status: "RESOLVED",
  authority: {
    ...pendingDetail.authority,
    persisted_status: "CANCELLED",
    effective_status: "CANCELLED",
    cancellation_source: "PLATFORM_REPORT",
    version: 5,
    cancellation_allowed: false,
    cancellation_blocker: "REPORT_ALREADY_RESOLVED",
  },
  allowed_outcomes: [],
  resolution: cancelledResolution,
};
const clone = <T>(value: T): T => structuredClone(value);
const invalidResponse = { name: "ApiError", status: 502, code: "PLATFORM_RESPONSE_INVALID" };

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

  test("loads the report queue and detail then posts a resolution with CSRF and one idempotency key", async () => {
    const fetcher = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({
        principal_id: "platform-admin-1",
        display_name: "平台管理员",
        roles: ["PLATFORM_ADMIN"],
        csrf_token: "b".repeat(64),
        expires_at: "2026-09-02T02:00:00Z",
      }))
      .mockResolvedValueOnce(jsonResponse({ items: [queueItem], next_cursor: "opaque-next-page" }))
      .mockResolvedValueOnce(jsonResponse(pendingDetail))
      .mockResolvedValueOnce(jsonResponse(recordedResolution));
    const api = new PlatformApi(fetcher);

    await api.restoreSession();
    await expect(api.listGameReports({ state: "PENDING", cursor: "opaque next", limit: 20 }))
      .resolves.toEqual({ items: [queueItem], next_cursor: "opaque-next-page" });
    await expect(api.getGameReport(reportId)).resolves.toEqual(pendingDetail);
    await expect(api.resolveGameReport(
      reportId,
      { outcome: "CONFIRMED_RECORDED", resolution_note: "已核实并记录。" },
      "game-report-resolution-key-000001",
    )).resolves.toEqual(recordedResolution);

    expect(fetcher.mock.calls[1]?.[0]).toBe(
      "/platform-admin/api/v1/game-reports?state=PENDING&cursor=opaque+next&limit=20",
    );
    expect(fetcher.mock.calls[2]?.[0]).toBe(
      `/platform-admin/api/v1/game-reports/${reportId}`,
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      4,
      `/platform-admin/api/v1/game-reports/${reportId}/resolution`,
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        headers: expect.objectContaining({
          "X-CSRF-Token": "b".repeat(64),
          "Idempotency-Key": "game-report-resolution-key-000001",
        }),
        body: JSON.stringify({
          outcome: "CONFIRMED_RECORDED",
          resolution_note: "已核实并记录。",
        }),
      }),
    );
  });

  test("fails closed for non-closed, malformed, or out-of-enum report list responses", async () => {
    const cases: unknown[] = [
      { items: [queueItem], next_cursor: null, extra: true },
      { items: [{ ...queueItem, extra: true }], next_cursor: null },
      { items: [{ ...queueItem, target: { ...target, order_id: "private" } }], next_cursor: null },
      { items: [{ ...queueItem, category: "OTHER" }], next_cursor: null },
      { items: [{ ...queueItem, status: "OPEN" }], next_cursor: null },
      { items: [{ ...queueItem, submitted_at: "2026-09-01 08:00:00" }], next_cursor: null },
      { items: [queueItem], next_cursor: "" },
      { items: [queueItem], next_cursor: "x".repeat(1025) },
    ];
    for (const body of cases) {
      const api = new PlatformApi(jest.fn<typeof fetch>().mockResolvedValue(jsonResponse(body)));
      await expect(api.listGameReports({ state: "PENDING" })).rejects.toMatchObject(invalidResponse);
    }
  });

  test("fails closed for malformed detail fields and contradictory status truth-table branches", async () => {
    const pendingWithResolution = { ...pendingDetail, resolution: recordedResolution };
    const resolvedWithoutResolution = { ...resolvedDetail, resolution: null };
    const resolvedWithOutcomes = { ...resolvedDetail, allowed_outcomes: ["DISMISSED"] };
    const invalidAuthorityPair = clone(pendingDetail);
    invalidAuthorityPair.authority.cancellation_allowed = false;
    const cases: unknown[] = [
      { ...pendingDetail, private_user_id: "private" },
      { ...pendingDetail, target: { ...target, extra: true } },
      { ...pendingDetail, authority: { ...pendingDetail.authority, extra: true } },
      { ...pendingDetail, reporter_registration_status: "CANCELLED" },
      { ...pendingDetail, authority: { ...pendingDetail.authority, persisted_status: "SUSPENDED" } },
      { ...pendingDetail, authority: { ...pendingDetail.authority, effective_status: "STARTED" } },
      { ...pendingDetail, authority: { ...pendingDetail.authority, cancellation_source: "SYSTEM" } },
      { ...pendingDetail, authority: { ...pendingDetail.authority, version: 0 } },
      invalidAuthorityPair,
      { ...pendingDetail, allowed_outcomes: ["DISMISSED", "DISMISSED"] },
      pendingWithResolution,
      resolvedWithoutResolution,
      resolvedWithOutcomes,
      { ...resolvedDetail, resolution: { ...cancelledResolution, game_version_after: 6 } },
    ];
    for (const body of cases) {
      const api = new PlatformApi(jest.fn<typeof fetch>().mockResolvedValue(jsonResponse(body)));
      await expect(api.getGameReport(reportId)).rejects.toMatchObject(invalidResponse);
    }
  });

  test.each([
    [
      "omits the cancellation outcome while authority allows it",
      { ...pendingDetail, allowed_outcomes: ["DISMISSED", "CONFIRMED_RECORDED"] },
    ],
    [
      "offers the cancellation outcome while authority blocks it",
      {
        ...pendingDetail,
        authority: {
          ...pendingDetail.authority,
          cancellation_allowed: false,
          cancellation_blocker: "GAME_ALREADY_STARTED",
        },
      },
    ],
    [
      "omits a mandatory non-cancelling outcome",
      { ...pendingDetail, allowed_outcomes: ["DISMISSED", "CONFIRMED_GAME_CANCELLED"] },
    ],
  ])("fails closed when a pending report %s", async (_label, body) => {
    const api = new PlatformApi(jest.fn<typeof fetch>().mockResolvedValue(jsonResponse(body)));
    await expect(api.getGameReport(reportId)).rejects.toMatchObject(invalidResponse);
  });

  test("fails closed for malformed resolution fields, enums, instants, counts, and version pairs", async () => {
    const cases: unknown[] = [
      { ...recordedResolution, extra: true },
      { ...recordedResolution, outcome: "WARNED" },
      { ...recordedResolution, resolved_at: "2026-09-01" },
      { ...recordedResolution, resolution_note: "" },
      { ...recordedResolution, resolution_note: "😀".repeat(501) },
      { ...recordedResolution, game_version_before: 4, game_version_after: 5 },
      { ...cancelledResolution, game_version_before: 0 },
      { ...cancelledResolution, game_version_after: 4 },
    ];
    for (const body of cases) {
      const fetcher = jest
        .fn<typeof fetch>()
        .mockResolvedValueOnce(jsonResponse({
          principal_id: "platform-admin-1",
          display_name: "平台管理员",
          roles: ["PLATFORM_ADMIN"],
          csrf_token: "b".repeat(64),
          expires_at: "2026-09-02T02:00:00Z",
        }))
        .mockResolvedValueOnce(jsonResponse(body));
      const api = new PlatformApi(fetcher);
      await api.restoreSession();
      await expect(api.resolveGameReport(
        reportId,
        { outcome: "CONFIRMED_RECORDED", resolution_note: "已核实并记录。" },
        "game-report-resolution-key-000001",
      )).rejects.toMatchObject(invalidResponse);
    }
  });
});
