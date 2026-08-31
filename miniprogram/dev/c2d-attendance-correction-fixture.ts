export const C2D_ATTENDANCE_CORRECTION_FIXTURE_MARKER = "C2D_ATTENDANCE_CORRECTION_FIXTURE";

export type C2dAttendanceStatus = "PRESENT" | "NO_SHOW";
export type C2dCopyFeedbackKind = "success" | "error";

export interface C2dCopyFeedback {
  readonly kind: C2dCopyFeedbackKind;
  readonly message: string;
}

export interface C2dGameReadback {
  readonly gameName: string;
  readonly venueName: string;
  readonly pitchName: string;
  readonly startsAtLabel: string;
}

export interface C2dAttendanceReadback {
  readonly registrationId: string;
  readonly currentAttendanceStatus: C2dAttendanceStatus;
  readonly currentAttendanceLabel: string;
  readonly originalAttendanceLabel: string;
  readonly originalRecordedAtLabel: string;
  readonly correctedAtLabel: string;
}

export interface C2dCaptainRosterRow extends C2dAttendanceReadback {
  readonly perGameName: string;
  readonly positionLabel: string;
}

const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value as Record<string, unknown>).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};

const NOTICE = "C2d 开发预览 · 模拟数据";

export const C2D_ATTENDANCE_CORRECTION_FIXTURE = deepFreeze({
  marker: C2D_ATTENDANCE_CORRECTION_FIXTURE_MARKER,
  notice: NOTICE,
  deletionCondition: "remove C2D_ATTENDANCE_CORRECTION_FIXTURE before production build or integration",
});

export const C2D_GAME_READBACK = deepFreeze<C2dGameReadback>({
  gameName: "C1b 预发布验收局",
  venueName: "测试环境·渤海元丰足球场",
  pitchName: "七人制 A 场",
  startsAtLabel: "8月31日 周一 · 09:00–10:00",
});

const correctedPlayer = {
  registrationId: "8ed324a4-56cb-4d73-9a77-0b4605ac3b17",
  perGameName: "林知远（右边锋，也可以客串中场）",
  positionLabel: "前锋",
  currentAttendanceStatus: "NO_SHOW",
  currentAttendanceLabel: "未到场",
  originalAttendanceLabel: "已到场",
  originalRecordedAtLabel: "8月31日 10:06",
  correctedAtLabel: "8月31日 14:18",
} as const;

export const C2D_CAPTAIN_READBACK = deepFreeze({
  game: C2D_GAME_READBACK,
  roster: [
    correctedPlayer,
  ] satisfies readonly C2dCaptainRosterRow[],
});

export const C2D_PLAYER_READBACK = deepFreeze<C2dAttendanceReadback & {
  readonly game: C2dGameReadback;
}>({
  game: C2D_GAME_READBACK,
  registrationId: correctedPlayer.registrationId,
  currentAttendanceStatus: correctedPlayer.currentAttendanceStatus,
  currentAttendanceLabel: correctedPlayer.currentAttendanceLabel,
  originalAttendanceLabel: correctedPlayer.originalAttendanceLabel,
  originalRecordedAtLabel: correctedPlayer.originalRecordedAtLabel,
  correctedAtLabel: correctedPlayer.correctedAtLabel,
});

const REGISTRATION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function copyC2dRegistrationId(
  registrationId: unknown,
  report: (feedback: C2dCopyFeedback) => void,
): void {
  if (typeof registrationId !== "string" || !REGISTRATION_ID_PATTERN.test(registrationId)) {
    report({ kind: "error", message: "复制失败，请重试" });
    return;
  }
  wx.setClipboardData({
    data: registrationId,
    success: () => report({ kind: "success", message: "报名编号已复制" }),
    fail: () => report({ kind: "error", message: "复制失败，请重试" }),
  });
}
