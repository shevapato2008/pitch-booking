/// <reference types="node" />

import { describe, expect, jest, test } from "@jest/globals";

import {
  ApiError,
  SessionExpiredError,
  type AttendanceCorrectionEvent,
  type AttendanceRegistrationDetail,
  type PlatformApi,
} from "./api";
import { AttendanceCorrectionController, formatAttendanceTime } from "./attendance-correction";

const registrationId = "8ed324a4-56cb-4d73-9a77-0b4605ac3b17";
const detail = (patch: Partial<AttendanceRegistrationDetail> = {}): AttendanceRegistrationDetail => ({
  registration_id: registrationId,
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
  ...patch,
});
const correction: AttendanceCorrectionEvent = {
  id: "a52df333-a813-4a99-97d6-780db998ce3a",
  registration_id: registrationId,
  from_status: "PRESENT",
  to_status: "NO_SHOW",
  reason: "现场记录核验有误",
  corrected_by_principal_id: "platform-admin-1",
  corrected_at: "2026-08-31T14:18:00+08:00",
  registration_version_before: 3,
  registration_version_after: 4,
};
const corrected = () => detail({
  attendance_status: "NO_SHOW",
  version: 4,
  corrections: [correction],
  allowed_correction: { target_status: "PRESENT", blocked_reason: null },
});
const harness = (api: Partial<PlatformApi>) => new AttendanceCorrectionController(
  api as PlatformApi,
  () => "attendance-key-123456",
);

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
};

describe("AttendanceCorrectionController", () => {
  test("requires a complete UUID, normalizes it, queries exact authority, and clears all sensitive state", async () => {
    const api = { getAttendanceRegistration: jest.fn<PlatformApi["getAttendanceRegistration"]>().mockResolvedValue(detail()) };
    const controller = harness(api);

    await expect(controller.lookup(`  ${registrationId.toUpperCase()}  `)).resolves.toEqual({ ok: true });
    expect(api.getAttendanceRegistration).toHaveBeenCalledWith(registrationId);
    expect(controller.state).toMatchObject({ query: registrationId, detail: detail(), lookupError: null });

    controller.setReason("private reason");
    controller.clear();
    expect(controller.state).toMatchObject({ query: "", detail: null, reason: "", confirmationOpen: false });

    await expect(controller.lookup("not-a-uuid")).resolves.toEqual({ ok: false, error: "请输入完整的报名 UUID" });
    expect(api.getAttendanceRegistration).toHaveBeenCalledTimes(1);
  });

  test("trims a 1..1000 Unicode-code-point reason before opening a real confirmation", async () => {
    const controller = harness({ getAttendanceRegistration: jest.fn<PlatformApi["getAttendanceRegistration"]>().mockResolvedValue(detail()) });
    await controller.lookup(registrationId);

    controller.setReason("   ");
    expect(controller.prepareCorrection()).toEqual({ ok: false, error: "请填写纠正原因" });
    controller.setReason(`${"误".repeat(1000)} `);
    expect(controller.prepareCorrection()).toEqual({ ok: true });
    expect(controller.state.reason).toBe("误".repeat(1000));
    expect(controller.state.confirmationOpen).toBe(true);
    controller.cancelConfirmation();
    controller.setReason("误".repeat(1001));
    expect(controller.prepareCorrection()).toEqual({ ok: false, error: "纠正原因不能超过 1000 个字符" });
  });

  test("submits one frozen key/body and accepts only the following GET authority", async () => {
    const api = {
      getAttendanceRegistration: jest.fn<PlatformApi["getAttendanceRegistration"]>()
        .mockResolvedValueOnce(detail())
        .mockResolvedValueOnce(corrected()),
      correctAttendanceRegistration: jest.fn<PlatformApi["correctAttendanceRegistration"]>().mockResolvedValue(correction),
    };
    const controller = harness(api);
    await controller.lookup(registrationId);
    controller.setReason("  现场记录核验有误  ");
    controller.prepareCorrection();

    await expect(controller.confirmCorrection()).resolves.toEqual({ ok: true, kind: "CONFIRMED" });

    expect(api.correctAttendanceRegistration).toHaveBeenCalledWith(
      registrationId,
      { attendance_status: "NO_SHOW", expected_version: 3, reason: "现场记录核验有误" },
      "attendance-key-123456",
    );
    expect(controller.state.detail).toEqual(corrected());
    expect(controller.state.pendingAttempt).toBeNull();
    expect(controller.state.feedback?.type).toBe("success");
  });

  test("never reposts after POST is confirmed even when its first authority GET fails", async () => {
    const api = {
      getAttendanceRegistration: jest.fn<PlatformApi["getAttendanceRegistration"]>()
        .mockResolvedValueOnce(detail())
        .mockRejectedValueOnce(new ApiError(503, "SERVICE_UNAVAILABLE", "刷新失败"))
        .mockResolvedValueOnce(corrected()),
      correctAttendanceRegistration: jest.fn<PlatformApi["correctAttendanceRegistration"]>().mockResolvedValue(correction),
    };
    const controller = harness(api);
    await controller.lookup(registrationId);
    controller.setReason("现场记录核验有误");
    controller.prepareCorrection();

    await expect(controller.confirmCorrection()).resolves.toEqual({
      ok: true,
      kind: "CONFIRMED_REFRESH_REQUIRED",
    });
    expect(controller.state.pendingAttempt?.phase).toBe("CONFIRMED");

    await expect(controller.refreshAuthority()).resolves.toEqual({ ok: true, kind: "AUTHORITY_UPDATED" });
    expect(api.correctAttendanceRegistration).toHaveBeenCalledTimes(1);
    expect(api.getAttendanceRegistration).toHaveBeenCalledTimes(3);
  });

  test("resolves an unknown 5xx by GET then replays the exact key/body once only when authority is unchanged", async () => {
    const api = {
      getAttendanceRegistration: jest.fn<PlatformApi["getAttendanceRegistration"]>()
        .mockResolvedValueOnce(detail())
        .mockResolvedValueOnce(detail())
        .mockResolvedValueOnce(corrected()),
      correctAttendanceRegistration: jest.fn<PlatformApi["correctAttendanceRegistration"]>()
        .mockRejectedValueOnce(new ApiError(503, "SERVICE_UNAVAILABLE", "提交结果未知"))
        .mockResolvedValueOnce(correction),
    };
    const controller = harness(api);
    await controller.lookup(registrationId);
    controller.setReason("现场记录核验有误");
    controller.prepareCorrection();

    await expect(controller.confirmCorrection()).resolves.toEqual({ ok: true, kind: "CONFIRMED" });
    expect(api.correctAttendanceRegistration).toHaveBeenCalledTimes(2);
    expect(api.correctAttendanceRegistration.mock.calls[1]).toEqual(api.correctAttendanceRegistration.mock.calls[0]);
    expect(controller.state.detail).toEqual(corrected());
  });

  test("accepts changed authority after an unknown result without replaying", async () => {
    const api = {
      getAttendanceRegistration: jest.fn<PlatformApi["getAttendanceRegistration"]>()
        .mockResolvedValueOnce(detail())
        .mockResolvedValueOnce(corrected()),
      correctAttendanceRegistration: jest.fn<PlatformApi["correctAttendanceRegistration"]>()
        .mockRejectedValue(new TypeError("network failed")),
    };
    const controller = harness(api);
    await controller.lookup(registrationId);
    controller.setReason("现场记录核验有误");
    controller.prepareCorrection();

    await expect(controller.confirmCorrection()).resolves.toEqual({ ok: true, kind: "AUTHORITY_UPDATED" });
    expect(api.correctAttendanceRegistration).toHaveBeenCalledTimes(1);
    expect(controller.state.detail).toEqual(corrected());
  });

  test("refreshes authority on 409 and does not replay the conflicting mutation", async () => {
    const conflict = detail({ version: 4, attendance_status: "NO_SHOW", allowed_correction: { target_status: "PRESENT", blocked_reason: null } });
    const api = {
      getAttendanceRegistration: jest.fn<PlatformApi["getAttendanceRegistration"]>()
        .mockResolvedValueOnce(detail())
        .mockResolvedValueOnce(conflict),
      correctAttendanceRegistration: jest.fn<PlatformApi["correctAttendanceRegistration"]>()
        .mockRejectedValue(new ApiError(409, "ATTENDANCE_CORRECTION_CONFLICT", "状态已变化")),
    };
    const controller = harness(api);
    await controller.lookup(registrationId);
    controller.setReason("现场记录核验有误");
    controller.prepareCorrection();

    await expect(controller.confirmCorrection()).resolves.toEqual({ ok: false, error: "状态已变化", refreshed: true });
    expect(api.correctAttendanceRegistration).toHaveBeenCalledTimes(1);
    expect(controller.state.detail).toEqual(conflict);
  });

  test("never replays more than once after repeated unknown responses", async () => {
    const api = {
      getAttendanceRegistration: jest.fn<PlatformApi["getAttendanceRegistration"]>()
        .mockResolvedValue(detail()),
      correctAttendanceRegistration: jest.fn<PlatformApi["correctAttendanceRegistration"]>()
        .mockRejectedValue(new ApiError(503, "SERVICE_UNAVAILABLE", "提交结果未知")),
    };
    const controller = harness(api);
    await controller.lookup(registrationId);
    controller.setReason("现场记录核验有误");
    controller.prepareCorrection();

    await expect(controller.confirmCorrection()).resolves.toMatchObject({ ok: false, refreshRequired: true });
    await expect(controller.refreshAuthority()).resolves.toMatchObject({ ok: false, refreshRequired: true });
    expect(api.correctAttendanceRegistration).toHaveBeenCalledTimes(2);
  });

  test("preserves the frozen recovery attempt when lookup input, lookup, or clear is requested", async () => {
    const otherRegistrationId = "7c734b99-7f40-4cbe-83c2-496cc22da2e2";
    const createKey = jest.fn(() => "attendance-key-123456");
    const api = {
      getAttendanceRegistration: jest.fn<PlatformApi["getAttendanceRegistration"]>()
        .mockResolvedValueOnce(detail())
        .mockRejectedValueOnce(new ApiError(503, "SERVICE_UNAVAILABLE", "刷新失败")),
      correctAttendanceRegistration: jest.fn<PlatformApi["correctAttendanceRegistration"]>()
        .mockRejectedValue(new TypeError("network failed")),
    };
    const controller = new AttendanceCorrectionController(api as unknown as PlatformApi, createKey);
    await controller.lookup(registrationId);
    controller.setReason("现场记录核验有误");
    controller.prepareCorrection();
    await expect(controller.confirmCorrection()).resolves.toMatchObject({ ok: false, refreshRequired: true });
    const frozenAttempt = controller.state.pendingAttempt;

    expect(controller.setQuery(otherRegistrationId)).toBe(false);
    await expect(controller.lookup(otherRegistrationId)).resolves.toEqual({
      ok: false,
      error: "请先刷新权威状态，确认上一操作结果",
      refreshRequired: true,
    });
    expect(controller.clear()).toEqual({
      ok: false,
      error: "请先刷新权威状态，确认上一操作结果",
      refreshRequired: true,
    });

    expect(controller.state.query).toBe(registrationId);
    expect(controller.state.pendingAttempt).toBe(frozenAttempt);
    expect(createKey).toHaveBeenCalledTimes(1);
    expect(api.getAttendanceRegistration).toHaveBeenCalledTimes(2);
  });

  test("coalesces concurrent authority refreshes for the original pending attempt", async () => {
    const slowAuthority = deferred<AttendanceRegistrationDetail>();
    const api = {
      getAttendanceRegistration: jest.fn<PlatformApi["getAttendanceRegistration"]>()
        .mockResolvedValueOnce(detail())
        .mockRejectedValueOnce(new ApiError(503, "SERVICE_UNAVAILABLE", "刷新失败"))
        .mockImplementationOnce(() => slowAuthority.promise)
        .mockResolvedValue(corrected()),
      correctAttendanceRegistration: jest.fn<PlatformApi["correctAttendanceRegistration"]>()
        .mockRejectedValue(new TypeError("network failed")),
    };
    const controller = harness(api);
    await controller.lookup(registrationId);
    controller.setReason("现场记录核验有误");
    controller.prepareCorrection();
    await controller.confirmCorrection();

    const first = controller.refreshAuthority();
    const second = controller.refreshAuthority();
    slowAuthority.resolve(corrected());

    await expect(first).resolves.toEqual({ ok: true, kind: "AUTHORITY_UPDATED" });
    await expect(second).resolves.toEqual({ ok: true, kind: "AUTHORITY_UPDATED" });
    expect(api.getAttendanceRegistration).toHaveBeenCalledTimes(3);
    expect(api.correctAttendanceRegistration).toHaveBeenCalledTimes(1);
    expect(controller.state.detail).toEqual(corrected());
    expect(controller.state.pendingAttempt).toBeNull();
  });

  test("ignores a slow refresh 401 after a new session lifecycle replaces its attempt", async () => {
    const slowAuthority = deferred<AttendanceRegistrationDetail>();
    const otherRegistrationId = "7c734b99-7f40-4cbe-83c2-496cc22da2e2";
    const replacement = detail({ registration_id: otherRegistrationId, player_display_name: "新会话球员" });
    const api = {
      getAttendanceRegistration: jest.fn<PlatformApi["getAttendanceRegistration"]>()
        .mockResolvedValueOnce(detail())
        .mockRejectedValueOnce(new ApiError(503, "SERVICE_UNAVAILABLE", "刷新失败"))
        .mockImplementationOnce(() => slowAuthority.promise)
        .mockResolvedValueOnce(replacement),
      correctAttendanceRegistration: jest.fn<PlatformApi["correctAttendanceRegistration"]>()
        .mockRejectedValue(new TypeError("network failed")),
    };
    const controller = harness(api);
    await controller.lookup(registrationId);
    controller.setReason("现场记录核验有误");
    controller.prepareCorrection();
    await controller.confirmCorrection();

    const staleRefresh = controller.refreshAuthority();
    controller.clearForSessionEnd();
    await controller.lookup(otherRegistrationId);
    slowAuthority.reject(new SessionExpiredError("旧会话已失效"));

    await expect(staleRefresh).resolves.toMatchObject({ ok: false, refreshRequired: true });
    expect(controller.state.detail).toEqual(replacement);
    expect(controller.state.pendingAttempt).toBeNull();
  });

  test("does not bubble a delayed mutation 401 from an expired lifecycle into the replacement session", async () => {
    const slowMutation = deferred<AttendanceCorrectionEvent>();
    const otherRegistrationId = "7c734b99-7f40-4cbe-83c2-496cc22da2e2";
    const replacement = detail({ registration_id: otherRegistrationId, player_display_name: "新会话球员" });
    const api = {
      getAttendanceRegistration: jest.fn<PlatformApi["getAttendanceRegistration"]>()
        .mockResolvedValueOnce(detail())
        .mockResolvedValueOnce(replacement),
      correctAttendanceRegistration: jest.fn<PlatformApi["correctAttendanceRegistration"]>()
        .mockImplementationOnce(() => slowMutation.promise),
    };
    const controller = harness(api);
    await controller.lookup(registrationId);
    controller.setReason("现场记录核验有误");
    controller.prepareCorrection();

    const staleMutation = controller.confirmCorrection();
    controller.clearForSessionEnd();
    await controller.lookup(otherRegistrationId);
    slowMutation.reject(new SessionExpiredError("旧会话已失效"));

    await expect(staleMutation).resolves.toMatchObject({ ok: false, refreshRequired: true });
    expect(controller.state.detail).toEqual(replacement);
    expect(controller.state.pendingAttempt).toBeNull();
  });

  test("unlocks lookup after an unknown same-key replay receives a deterministic 4xx", async () => {
    const api = {
      getAttendanceRegistration: jest.fn<PlatformApi["getAttendanceRegistration"]>()
        .mockResolvedValueOnce(detail())
        .mockRejectedValueOnce(new ApiError(503, "SERVICE_UNAVAILABLE", "刷新失败"))
        .mockResolvedValueOnce(detail()),
      correctAttendanceRegistration: jest.fn<PlatformApi["correctAttendanceRegistration"]>()
        .mockRejectedValueOnce(new TypeError("network failed"))
        .mockRejectedValueOnce(new ApiError(422, "INVALID_ATTENDANCE_CORRECTION", "纠正请求无效")),
    };
    const controller = harness(api);
    await controller.lookup(registrationId);
    controller.setReason("现场记录核验有误");
    controller.prepareCorrection();
    await controller.confirmCorrection();

    await expect(controller.refreshAuthority()).resolves.toEqual({ ok: false, error: "纠正请求无效" });
    expect(controller.state).toMatchObject({ loading: false, submitting: false, pendingAttempt: null });
    expect(controller.state.feedback).toEqual({
      type: "error",
      title: "纠正未提交",
      message: "纠正请求无效",
    });
    expect(controller.setQuery(registrationId)).toBe(true);
    expect(controller.clear()).toEqual({ ok: true });
  });

  test("keeps attendance detail while exposing a logout failure in the active module", async () => {
    const controller = harness({
      getAttendanceRegistration: jest.fn<PlatformApi["getAttendanceRegistration"]>().mockResolvedValue(detail()),
    });
    await controller.lookup(registrationId);

    controller.reportOperationFailure("退出登录失败", "网络异常，请重试");

    expect(controller.state.detail).toEqual(detail());
    expect(controller.state.feedback).toEqual({
      type: "error",
      title: "退出登录失败",
      message: "网络异常，请重试",
    });
  });

  test("formats every attendance timestamp in the authority Asia/Shanghai zone regardless of host zone", () => {
    const originalTimeZone = process.env.TZ;
    try {
      process.env.TZ = "UTC";
      const fromUtcHost = formatAttendanceTime("2026-08-31T01:00:00Z", "Asia/Shanghai");
      process.env.TZ = "America/Los_Angeles";
      const fromPacificHost = formatAttendanceTime("2026-08-31T01:00:00Z", "Asia/Shanghai");

      expect(fromUtcHost).toBe("2026/8/31 09:00");
      expect(fromPacificHost).toBe(fromUtcHost);
      expect(formatAttendanceTime(null, "Asia/Shanghai")).toBe("—");
    } finally {
      if (originalTimeZone === undefined) delete process.env.TZ;
      else process.env.TZ = originalTimeZone;
    }
  });

  test("propagates session expiry and ignores a stale lookup that resolves after clear", async () => {
    let resolve!: (value: AttendanceRegistrationDetail) => void;
    const api = {
      getAttendanceRegistration: jest.fn<PlatformApi["getAttendanceRegistration"]>()
        .mockImplementationOnce(() => new Promise((done) => { resolve = done; }))
        .mockRejectedValueOnce(new SessionExpiredError()),
    };
    const controller = harness(api);
    const stale = controller.lookup(registrationId);
    controller.clear();
    resolve(detail());
    await stale;
    expect(controller.state.detail).toBeNull();

    await expect(controller.lookup(registrationId)).rejects.toBeInstanceOf(SessionExpiredError);
  });
});
