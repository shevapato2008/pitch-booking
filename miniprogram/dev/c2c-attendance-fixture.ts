export const C2C_ATTENDANCE_FIXTURE_MARKER = "C2C_ATTENDANCE_FIXTURE";

export const C2C_ATTENDANCE_SCENARIOS = [
  "MIXED",
  "COMPLETE",
  "EMPTY",
  "LOAD_ERROR",
  "CONFLICT",
  "UNKNOWN_RESULT",
] as const;

export type C2cAttendanceScenario = typeof C2C_ATTENDANCE_SCENARIOS[number];
export type C2cAttendanceResult = "UNMARKED" | "PRESENT" | "NO_SHOW";
export type C2cAttendanceDecision = Exclude<C2cAttendanceResult, "UNMARKED">;
export type C2cAttendancePreviewState = "READY" | "LOAD_ERROR" | "CONFLICT" | "UNKNOWN_RESULT";

export interface C2cAttendanceGameSummary {
  readonly gameId: string;
  readonly gameName: string;
  readonly venue: string;
  readonly pitch: string;
  readonly state: "COMPLETED";
  readonly dateLabel: string;
  readonly timeLabel: string;
}

export interface C2cAttendancePlayer {
  readonly registrationId: string;
  readonly perGameName: string;
  readonly intendedPosition: string;
  readonly attendanceResult: C2cAttendanceResult;
  readonly recordedAt: string | null;
}

export interface C2cAttendanceDecisionPanel {
  readonly registrationId: string;
  readonly attendanceResult: C2cAttendanceDecision;
}

export interface C2cAttendanceSnapshot {
  readonly marker: typeof C2C_ATTENDANCE_FIXTURE_MARKER;
  readonly notice: string;
  readonly scenario: C2cAttendanceScenario;
  readonly previewState: C2cAttendancePreviewState;
  readonly previewMessage: string | null;
  readonly game: C2cAttendanceGameSummary;
  readonly roster: readonly C2cAttendancePlayer[];
  readonly recorded: number;
  readonly total: number;
  readonly attendanceComplete: boolean;
  readonly decisionPanel: C2cAttendanceDecisionPanel | null;
}

export interface C2cAttendanceStore {
  current(): C2cAttendanceSnapshot;
  reset(scenario?: C2cAttendanceScenario): C2cAttendanceSnapshot;
  openDecision(registrationId: unknown, attendanceResult: unknown): C2cAttendanceSnapshot;
  closeDecision(): C2cAttendanceSnapshot;
  confirmDecision(): C2cAttendanceSnapshot;
  retryLoad(): C2cAttendanceSnapshot;
  resolveConflict(): C2cAttendanceSnapshot;
  confirmUnknownResult(): C2cAttendanceSnapshot;
}

const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value as Record<string, unknown>).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};

const NOTICE = "C2c 开发预览 · 模拟数据";
const RECORDED_AT = "2026-08-30T20:30:00+08:00";
const GAME_SUMMARY: C2cAttendanceGameSummary = {
  gameId: "c2c-open-game-20260830-1830",
  gameName: "奥体周日傍晚局",
  venue: "天津奥体足球场",
  pitch: "七人制 A 场",
  state: "COMPLETED",
  dateLabel: "8月30日 周日",
  timeLabel: "18:30–20:30",
};

export const C2C_ATTENDANCE_FIXTURE = deepFreeze({
  marker: C2C_ATTENDANCE_FIXTURE_MARKER,
  notice: NOTICE,
  deletionCondition: "remove C2C_ATTENDANCE_FIXTURE before production build or integration",
  game: GAME_SUMMARY,
});

interface MutableAttendancePlayer {
  registrationId: string;
  perGameName: string;
  intendedPosition: string;
  attendanceResult: C2cAttendanceResult;
  recordedAt: string | null;
}

const createPlayer = (
  registrationId: string,
  perGameName: string,
  intendedPosition: string,
  attendanceResult: C2cAttendanceResult,
  recordedAt: string | null,
): MutableAttendancePlayer => ({
  registrationId,
  perGameName,
  intendedPosition,
  attendanceResult,
  recordedAt,
});

const createMixedRoster = (): MutableAttendancePlayer[] => [
  createPlayer("c2c-reg-unmarked", "天津周末左边锋小王", "左边锋", "UNMARKED", null),
  createPlayer("c2c-reg-present", "阿哲", "门将", "PRESENT", "2026-08-30T20:12:00+08:00"),
  createPlayer("c2c-reg-no-show", "十一", "中场", "NO_SHOW", "2026-08-30T20:14:00+08:00"),
];

const createCompleteRoster = (): MutableAttendancePlayer[] => [
  createPlayer("c2c-reg-unmarked", "天津周末左边锋小王", "左边锋", "PRESENT", RECORDED_AT),
  createPlayer("c2c-reg-present", "阿哲", "门将", "PRESENT", "2026-08-30T20:12:00+08:00"),
  createPlayer("c2c-reg-no-show", "十一", "中场", "NO_SHOW", "2026-08-30T20:14:00+08:00"),
];

const isScenario = (value: unknown): value is C2cAttendanceScenario => (
  typeof value === "string" && (C2C_ATTENDANCE_SCENARIOS as readonly string[]).includes(value)
);

const isDecision = (value: unknown): value is C2cAttendanceDecision => (
  value === "PRESENT" || value === "NO_SHOW"
);

export function createC2cAttendanceStore(
  initialScenario: C2cAttendanceScenario = "MIXED",
): C2cAttendanceStore {
  let scenario: C2cAttendanceScenario = "MIXED";
  let previewState: C2cAttendancePreviewState = "READY";
  let previewMessage: string | null = null;
  let roster: MutableAttendancePlayer[] = [];
  let decisionPanel: C2cAttendanceDecisionPanel | null = null;

  const applyScenario = (nextScenario: C2cAttendanceScenario): void => {
    scenario = nextScenario;
    decisionPanel = null;
    previewMessage = null;

    if (nextScenario === "EMPTY") {
      previewState = "READY";
      roster = [];
      return;
    }
    if (nextScenario === "LOAD_ERROR") {
      previewState = "LOAD_ERROR";
      previewMessage = "名单加载失败，请重新加载";
      roster = [];
      return;
    }

    roster = nextScenario === "COMPLETE" ? createCompleteRoster() : createMixedRoster();
    if (nextScenario === "CONFLICT") {
      previewState = "CONFLICT";
      previewMessage = "名单状态已变化，请确认最新名单";
      return;
    }
    if (nextScenario === "UNKNOWN_RESULT") {
      previewState = "UNKNOWN_RESULT";
      previewMessage = "记录结果尚未确认，请读取权威结果";
      return;
    }
    previewState = "READY";
  };

  const snapshot = (): C2cAttendanceSnapshot => {
    const projectedRoster = roster.map((player) => ({ ...player }));
    const recorded = projectedRoster.filter((player) => player.attendanceResult !== "UNMARKED").length;
    const total = projectedRoster.length;
    return deepFreeze({
      marker: C2C_ATTENDANCE_FIXTURE_MARKER,
      notice: NOTICE,
      scenario,
      previewState,
      previewMessage,
      game: { ...GAME_SUMMARY },
      roster: projectedRoster,
      recorded,
      total,
      attendanceComplete: previewState === "READY" && recorded === total,
      decisionPanel: decisionPanel ? { ...decisionPanel } : null,
    });
  };

  const current = (): C2cAttendanceSnapshot => snapshot();

  applyScenario(isScenario(initialScenario) ? initialScenario : "MIXED");

  return {
    current,

    reset(nextScenario: C2cAttendanceScenario = "MIXED") {
      if (isScenario(nextScenario)) applyScenario(nextScenario);
      return current();
    },

    openDecision(registrationId: unknown, attendanceResult: unknown) {
      const player = roster.find((item) => item.registrationId === registrationId);
      if (previewState === "READY" && player?.attendanceResult === "UNMARKED" && isDecision(attendanceResult)) {
        decisionPanel = { registrationId: player.registrationId, attendanceResult };
      }
      return current();
    },

    closeDecision() {
      decisionPanel = null;
      return current();
    },

    confirmDecision() {
      if (previewState === "READY" && decisionPanel) {
        const player = roster.find((item) => item.registrationId === decisionPanel?.registrationId);
        if (player?.attendanceResult === "UNMARKED") {
          player.attendanceResult = decisionPanel.attendanceResult;
          player.recordedAt = RECORDED_AT;
        }
      }
      decisionPanel = null;
      return current();
    },

    retryLoad() {
      if (previewState === "LOAD_ERROR") applyScenario("MIXED");
      return current();
    },

    resolveConflict() {
      if (previewState === "CONFLICT") applyScenario("MIXED");
      return current();
    },

    confirmUnknownResult() {
      if (previewState === "UNKNOWN_RESULT") applyScenario("COMPLETE");
      return current();
    },
  };
}

export const c2cAttendanceStore = createC2cAttendanceStore();
