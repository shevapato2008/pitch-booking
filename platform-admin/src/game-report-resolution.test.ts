import { describe, expect, jest, test } from "@jest/globals";

import {
  GameReportResolutionController,
  validateResolutionNote,
} from "./game-report-resolution";
import {
  ApiError,
  type PlatformApi,
  type PlatformGameReportDetail,
  type PlatformGameReportList,
  type PlatformGameReportResolution,
} from "./api";

const reportId = "66000000-0000-4000-8000-000000000001";
const otherReportId = "66000000-0000-4000-8000-000000000002";

const detail = (
  overrides: Partial<PlatformGameReportDetail> = {},
): PlatformGameReportDetail => ({
  report_id: reportId,
  category: "FALSE_INFORMATION",
  status: "PENDING",
  facts: "公开页面写有照明，现场实际没有照明。",
  submitted_at: "2026-09-01T08:00:00+08:00",
  reporter_display_name: "周末小翼",
  reporter_registration_status: "JOINED",
  target: {
    game_id: "55000000-0000-4000-8000-000000000001",
    game_name: "周末轻松局",
    organizer_team_name: "海河周末队",
    venue_name: "渤海元丰足球场",
    pitch_name: "七人制 A 场",
    starts_at: "2026-08-31T09:00:00+08:00",
    ends_at: "2026-08-31T10:00:00+08:00",
    time_zone: "Asia/Shanghai",
  },
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
  ...overrides,
});

const resolved = (): PlatformGameReportDetail => ({
  ...detail(),
  status: "RESOLVED",
  authority: {
    ...detail().authority,
    persisted_status: "CANCELLED",
    effective_status: "CANCELLED",
    cancellation_source: "PLATFORM_REPORT",
    version: 5,
    cancellation_allowed: false,
    cancellation_blocker: "REPORT_ALREADY_RESOLVED",
  },
  allowed_outcomes: [],
  resolution: {
    resolution_id: "77000000-0000-4000-8000-000000000001",
    outcome: "CONFIRMED_GAME_CANCELLED",
    resolution_note: "经核实信息与现场不符，取消公开球局。",
    resolved_by_principal_id: "platform-admin-1",
    resolved_at: "2026-09-01T09:00:00+08:00",
    game_version_before: 4,
    game_version_after: 5,
  },
});

const queue = (nextCursor: string | null = "next-page"): PlatformGameReportList => ({
  items: [
    {
      report_id: reportId,
      category: "FALSE_INFORMATION",
      status: "PENDING",
      target: detail().target,
      submitted_at: "2026-09-01T08:00:00+08:00",
    },
  ],
  next_cursor: nextCursor,
});

const harness = (api: Partial<PlatformApi>) => new GameReportResolutionController(
  api as PlatformApi,
  () => "game-report-resolution-key-000001",
);

describe("resolution note policy", () => {
  test("normalizes NFC and rejects empty, overlong, URL, phone, email and contact ids", () => {
    expect(validateResolutionNote("  e\u0301  ")).toEqual({ ok: true, value: "é", codePoints: 1 });
    expect(validateResolutionNote("   ")).toMatchObject({ ok: false });
    expect(validateResolutionNote("😀".repeat(501))).toMatchObject({ ok: false });
    for (const value of [
      "证据见 https://example.com",
      "联系 13800138000",
      "邮件 admin@example.com",
      "微信号: player_123",
      "加 vx 沟通",
      "详情见 example.com/report",
      "联系 +86 138-0013-8000",
    ]) expect(validateResolutionNote(value)).toMatchObject({ ok: false });
  });
});

describe("GameReportResolutionController", () => {
  test("loads the pending queue, first detail, changes filters and appends an opaque page", async () => {
    const api = {
      listGameReports: jest.fn<PlatformApi["listGameReports"]>()
        .mockResolvedValueOnce(queue())
        .mockResolvedValueOnce({
          items: [{ ...queue(null).items[0]!, report_id: otherReportId }],
          next_cursor: null,
        })
        .mockResolvedValueOnce({ items: [], next_cursor: null }),
      getGameReport: jest.fn<PlatformApi["getGameReport"]>().mockResolvedValue(detail()),
    };
    const controller = harness(api);

    await expect(controller.load()).resolves.toEqual({ ok: true });
    expect(controller.state.selected?.report_id).toBe(reportId);
    await expect(controller.loadMore()).resolves.toEqual({ ok: true });
    expect(controller.state.items.map((item) => item.report_id)).toEqual([reportId, otherReportId]);
    expect(api.listGameReports).toHaveBeenNthCalledWith(2, {
      state: "PENDING",
      cursor: "next-page",
      limit: 20,
    });

    await expect(controller.setFilter("RESOLVED")).resolves.toEqual({ ok: true });
    expect(controller.state.filter).toBe("RESOLVED");
    expect(controller.state.selected).toBeNull();
  });

  test("validates dynamic allowed outcomes and only opens confirmation for a valid note", async () => {
    const api = {
      listGameReports: jest.fn<PlatformApi["listGameReports"]>().mockResolvedValue(queue(null)),
      getGameReport: jest.fn<PlatformApi["getGameReport"]>().mockResolvedValue(
        detail({ allowed_outcomes: ["DISMISSED", "CONFIRMED_RECORDED"] }),
      ),
    };
    const controller = harness(api);
    await controller.load();

    expect(controller.setOutcome("CONFIRMED_GAME_CANCELLED")).toEqual({
      ok: false,
      error: "当前球局不能选择这个结论",
    });
    expect(controller.prepareResolution()).toMatchObject({ ok: false });
    expect(controller.setOutcome("CONFIRMED_RECORDED")).toEqual({ ok: true });
    controller.setNote("已核对现场记录与双方陈述，举报成立并记录。\r\n");
    expect(controller.prepareResolution()).toEqual({ ok: true });
    expect(controller.state.confirmationOpen).toBe(true);
    expect(controller.state.note).toBe("已核对现场记录与双方陈述，举报成立并记录。");

    controller.cancelConfirmation();
    expect(controller.state.confirmationOpen).toBe(false);
  });

  test("posts one immutable resolution with a stable key and refreshes authority", async () => {
    const resolution = resolved().resolution as PlatformGameReportResolution;
    const api = {
      listGameReports: jest.fn<PlatformApi["listGameReports"]>().mockResolvedValue(queue(null)),
      getGameReport: jest.fn<PlatformApi["getGameReport"]>()
        .mockResolvedValueOnce(detail())
        .mockResolvedValueOnce(resolved()),
      resolveGameReport: jest.fn<PlatformApi["resolveGameReport"]>().mockResolvedValue(resolution),
    };
    const controller = harness(api);
    await controller.load();
    controller.setOutcome("CONFIRMED_GAME_CANCELLED");
    controller.setNote("经核实信息与现场不符，取消公开球局。");
    controller.prepareResolution();

    await expect(controller.confirmResolution()).resolves.toEqual({ ok: true, kind: "CONFIRMED" });
    expect(api.resolveGameReport).toHaveBeenCalledWith(
      reportId,
      {
        outcome: "CONFIRMED_GAME_CANCELLED",
        resolution_note: "经核实信息与现场不符，取消公开球局。",
      },
      "game-report-resolution-key-000001",
    );
    expect(controller.state.selected).toEqual(resolved());
    expect(controller.state.pendingAttempt).toBeNull();
  });

  test("locks navigation after an unknown mutation and recovers through GET then one replay", async () => {
    const resolution = resolved().resolution as PlatformGameReportResolution;
    const api = {
      listGameReports: jest.fn<PlatformApi["listGameReports"]>().mockResolvedValue(queue(null)),
      getGameReport: jest.fn<PlatformApi["getGameReport"]>()
        .mockResolvedValueOnce(detail())
        .mockResolvedValueOnce(detail())
        .mockResolvedValueOnce(resolved()),
      resolveGameReport: jest.fn<PlatformApi["resolveGameReport"]>()
        .mockRejectedValueOnce(new TypeError("network failed"))
        .mockResolvedValueOnce(resolution),
    };
    const controller = harness(api);
    await controller.load();
    controller.setOutcome("CONFIRMED_RECORDED");
    controller.setNote("已核对现场记录与双方陈述，举报成立并记录。");
    controller.prepareResolution();

    await expect(controller.confirmResolution()).resolves.toMatchObject({ ok: false, refreshRequired: true });
    expect(controller.state.pendingAttempt?.replayed).toBe(false);
    await expect(controller.setFilter("RESOLVED")).resolves.toMatchObject({ ok: false, refreshRequired: true });
    await expect(controller.select(otherReportId)).resolves.toMatchObject({ ok: false, refreshRequired: true });

    await expect(controller.recoverAuthority()).resolves.toEqual({ ok: true, kind: "CONFIRMED" });
    expect(api.resolveGameReport).toHaveBeenCalledTimes(2);
    expect(api.resolveGameReport.mock.calls[1]).toEqual(api.resolveGameReport.mock.calls[0]);
    expect(controller.state.selected).toEqual(resolved());
  });

  test("refreshes authority on a definitive conflict without replaying", async () => {
    const changed = detail({
      authority: {
        ...detail().authority,
        cancellation_allowed: false,
        cancellation_blocker: "GAME_ALREADY_STARTED",
      },
      allowed_outcomes: ["DISMISSED", "CONFIRMED_RECORDED"],
    });
    const api = {
      listGameReports: jest.fn<PlatformApi["listGameReports"]>().mockResolvedValue(queue(null)),
      getGameReport: jest.fn<PlatformApi["getGameReport"]>()
        .mockResolvedValueOnce(detail())
        .mockResolvedValueOnce(changed),
      resolveGameReport: jest.fn<PlatformApi["resolveGameReport"]>()
        .mockRejectedValue(new ApiError(409, "REPORT_STATE_CHANGED", "球局状态已变化")),
    };
    const controller = harness(api);
    await controller.load();
    controller.setOutcome("CONFIRMED_GAME_CANCELLED");
    controller.setNote("经核实信息与现场不符，取消公开球局。");
    controller.prepareResolution();

    await expect(controller.confirmResolution()).resolves.toMatchObject({ ok: false, refreshed: true });
    expect(api.resolveGameReport).toHaveBeenCalledTimes(1);
    expect(controller.state.selected).toEqual(changed);
    expect(controller.state.pendingAttempt).toBeNull();
  });
});
