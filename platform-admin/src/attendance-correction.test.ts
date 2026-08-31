import { describe, expect, jest, test } from "@jest/globals";

import {
  ApiError,
  SessionExpiredError,
  type AttendanceCorrectionEvent,
  type AttendanceRegistrationDetail,
  type PlatformApi,
} from "./api";
import { AttendanceCorrectionController } from "./attendance-correction";

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
