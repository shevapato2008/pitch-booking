export const C2A_REGISTRATION_WITHDRAWAL_MARKER = "C2A_REGISTRATION_WITHDRAWAL_FIXTURE" as const;

export type C2aRegistrationWithdrawalScenario =
  | "APPLIED"
  | "JOINED_EARLY"
  | "JOINED_LATE"
  | "WITHDRAWN"
  | "RESULT_UNKNOWN";

export type C2aRegistrationEffectiveStatus = "APPLIED" | "JOINED" | "WITHDRAWN";
export type C2aWithdrawalOperationState =
  | "IDLE"
  | "CONFIRMING"
  | "SUBMITTING"
  | "RESULT_UNKNOWN"
  | "ERROR";
export type C2aWithdrawalAction = "WITHDRAW_APPLICATION" | "LEAVE_GAME";
export type C2aWithdrawalOutcome = "CONFIRMED" | "UNKNOWN" | "ERROR";
export type C2aWithdrawalKind = "APPLICATION_WITHDRAWAL" | "GAME_EXIT";

export interface C2aWithdrawalAttempt {
  readonly key: string;
  readonly kind: C2aWithdrawalAction;
}

export interface C2aRegistrationWithdrawalRegistration {
  readonly registrationId: string;
  readonly effectiveStatus: C2aRegistrationEffectiveStatus;
  readonly statusLabel: string;
  readonly appliedAt: string;
  readonly withdrawnAt: string | null;
  readonly withdrawalKind: C2aWithdrawalKind | null;
  readonly lateExitRecorded: boolean;
  readonly detailPath: string;
}

export interface C2aRegistrationWithdrawalGame {
  readonly gameId: string;
  readonly gameName: string;
  readonly venue: string;
  readonly pitch: string;
  readonly formatLabel: string;
  readonly dateLabel: string;
  readonly timeLabel: string;
  readonly plannedPlayers: number;
  readonly currentPlayers: number;
  readonly remainingSpots: number;
  readonly organizerName: string;
  readonly intensityLabel: string;
  readonly positionLabel: string;
  readonly estimatedAaLabel: string;
  readonly deadlineLabel: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly timeZone: "Asia/Shanghai";
}

export interface C2aRegistrationWithdrawalSnapshot {
  readonly marker: typeof C2A_REGISTRATION_WITHDRAWAL_MARKER;
  readonly notice: string;
  readonly scenario: C2aRegistrationWithdrawalScenario;
  readonly authoritativeNow: string;
  readonly operationState: C2aWithdrawalOperationState;
  readonly selectedRegistrationId: string | null;
  readonly listScrollTop: number;
  readonly registration: C2aRegistrationWithdrawalRegistration;
  readonly game: C2aRegistrationWithdrawalGame;
  readonly withdrawalAttempt: C2aWithdrawalAttempt | null;
  readonly errorMessage: string | null;
  readonly availableAction: C2aWithdrawalAction | null;
  readonly isLateExit: boolean;
}

export interface C2aRegistrationWithdrawalStore {
  current(): C2aRegistrationWithdrawalSnapshot;
  reset(scenario?: C2aRegistrationWithdrawalScenario): C2aRegistrationWithdrawalSnapshot;
  detail(registrationId: unknown): C2aRegistrationWithdrawalSnapshot | null;
  selectRegistration(registrationId: unknown): boolean;
  setListScrollTop(value: unknown): C2aRegistrationWithdrawalSnapshot;
  openConfirmation(registrationId: unknown): C2aRegistrationWithdrawalSnapshot;
  cancelConfirmation(): C2aRegistrationWithdrawalSnapshot;
  beginWithdrawal(): C2aRegistrationWithdrawalSnapshot;
  resolveWithdrawal(outcome?: C2aWithdrawalOutcome): C2aRegistrationWithdrawalSnapshot;
  confirmWithdrawalResult(): C2aRegistrationWithdrawalSnapshot;
  dismissError(): C2aRegistrationWithdrawalSnapshot;
}

export interface C2aRegistrationWithdrawalStoreOptions {
  readonly authoritativeNow?: string;
  readonly startsAt?: string;
}

const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value as Record<string, unknown>).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const DEFAULT_AUTHORITATIVE_NOW = "2026-09-06T13:00:00+08:00";

export function isLateWithdrawal(startsAt: string, authoritativeNow: string): boolean {
  const start = Date.parse(startsAt);
  const now = Date.parse(authoritativeNow);
  if (!Number.isFinite(start) || !Number.isFinite(now)) return false;
  const remaining = start - now;
  return remaining > 0 && remaining < SIX_HOURS_MS;
}

const baseGame = {
  gameId: "c2a-open-game-20260906-1800",
  gameName: "奥体周日傍晚局",
  venue: "天津奥体足球场",
  pitch: "七人制 A 场",
  formatLabel: "七人制",
  dateLabel: "9月6日 周日",
  timeLabel: "18:00–20:00",
  plannedPlayers: 14,
  currentPlayers: 10,
  organizerName: "C1b验收队",
  intensityLabel: "轻松交流",
  positionLabel: "任意位置",
  estimatedAaLabel: "¥25.72 / 人",
  deadlineLabel: "9月6日 周日 16:00",
  startsAt: "2026-09-06T18:00:00+08:00",
  endsAt: "2026-09-06T20:00:00+08:00",
  timeZone: "Asia/Shanghai" as const,
};

export const C2A_REGISTRATION_WITHDRAWAL_FIXTURE = deepFreeze({
  marker: C2A_REGISTRATION_WITHDRAWAL_MARKER,
  notice: "C2a 开发预览 · 模拟数据",
  authoritativeNow: DEFAULT_AUTHORITATIVE_NOW,
  game: baseGame,
  deletionCondition: "remove C2A_REGISTRATION_WITHDRAWAL_FIXTURE before production integration",
});

interface ScenarioSeed {
  readonly registrationId: string;
  readonly effectiveStatus: C2aRegistrationEffectiveStatus;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly dateLabel: string;
  readonly timeLabel: string;
  readonly currentPlayers: number;
  readonly remainingSpots: number;
  readonly withdrawnAt: string | null;
  readonly withdrawalKind: C2aWithdrawalKind | null;
  readonly lateExitRecorded: boolean;
}

const scenarioSeeds: Readonly<Record<C2aRegistrationWithdrawalScenario, ScenarioSeed>> = deepFreeze({
  APPLIED: {
    registrationId: "c2a-reg-applied",
    effectiveStatus: "APPLIED",
    startsAt: "2026-09-12T09:00:00+08:00",
    endsAt: "2026-09-12T10:30:00+08:00",
    dateLabel: "9月12日 周六",
    timeLabel: "09:00–10:30",
    currentPlayers: 10,
    remainingSpots: 4,
    withdrawnAt: null,
    withdrawalKind: null,
    lateExitRecorded: false,
  },
  JOINED_EARLY: {
    registrationId: "c2a-reg-joined-early",
    effectiveStatus: "JOINED",
    startsAt: "2026-09-13T18:00:00+08:00",
    endsAt: "2026-09-13T20:00:00+08:00",
    dateLabel: "9月13日 周日",
    timeLabel: "18:00–20:00",
    currentPlayers: 10,
    remainingSpots: 4,
    withdrawnAt: null,
    withdrawalKind: null,
    lateExitRecorded: false,
  },
  JOINED_LATE: {
    registrationId: "c2a-reg-joined-late",
    effectiveStatus: "JOINED",
    startsAt: "2026-09-06T18:00:00+08:00",
    endsAt: "2026-09-06T20:00:00+08:00",
    dateLabel: "9月6日 周日",
    timeLabel: "18:00–20:00",
    currentPlayers: 10,
    remainingSpots: 4,
    withdrawnAt: null,
    withdrawalKind: null,
    lateExitRecorded: false,
  },
  WITHDRAWN: {
    registrationId: "c2a-reg-withdrawn",
    effectiveStatus: "WITHDRAWN",
    startsAt: "2026-09-13T18:00:00+08:00",
    endsAt: "2026-09-13T20:00:00+08:00",
    dateLabel: "9月13日 周日",
    timeLabel: "18:00–20:00",
    currentPlayers: 9,
    remainingSpots: 5,
    withdrawnAt: "2026-09-06T12:00:00+08:00",
    withdrawalKind: "GAME_EXIT",
    lateExitRecorded: false,
  },
  RESULT_UNKNOWN: {
    registrationId: "c2a-reg-result-unknown",
    effectiveStatus: "JOINED",
    startsAt: "2026-09-06T18:00:00+08:00",
    endsAt: "2026-09-06T20:00:00+08:00",
    dateLabel: "9月6日 周日",
    timeLabel: "18:00–20:00",
    currentPlayers: 10,
    remainingSpots: 4,
    withdrawnAt: null,
    withdrawalKind: null,
    lateExitRecorded: false,
  },
});

const statusLabel = (status: C2aRegistrationEffectiveStatus): string => {
  if (status === "APPLIED") return "待队长审核";
  if (status === "JOINED") return "已加入";
  return "已退出";
};

const normalizeScrollTop = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
};

export function createC2aRegistrationWithdrawalStore(
  initialScenario: C2aRegistrationWithdrawalScenario = "APPLIED",
  options: C2aRegistrationWithdrawalStoreOptions = {},
): C2aRegistrationWithdrawalStore {
  const authoritativeNow = options.authoritativeNow ?? DEFAULT_AUTHORITATIVE_NOW;
  let scenario: C2aRegistrationWithdrawalScenario;
  let operationState: C2aWithdrawalOperationState;
  let selectedRegistrationId: string | null;
  let listScrollTop: number;
  let registration: C2aRegistrationWithdrawalRegistration;
  let startsAt: string;
  let endsAt: string;
  let dateLabel: string;
  let timeLabel: string;
  let currentPlayers: number;
  let remainingSpots: number;
  let withdrawalAttempt: C2aWithdrawalAttempt | null;
  let errorMessage: string | null;
  let attemptSequence: number;

  const applyScenario = (nextScenario: C2aRegistrationWithdrawalScenario): void => {
    const seed = scenarioSeeds[nextScenario];
    scenario = nextScenario;
    operationState = nextScenario === "RESULT_UNKNOWN" ? "RESULT_UNKNOWN" : "IDLE";
    selectedRegistrationId = null;
    listScrollTop = 0;
    startsAt = options.startsAt ?? seed.startsAt;
    endsAt = seed.endsAt;
    dateLabel = seed.dateLabel;
    timeLabel = seed.timeLabel;
    currentPlayers = seed.currentPlayers;
    remainingSpots = seed.remainingSpots;
    registration = deepFreeze({
      registrationId: seed.registrationId,
      effectiveStatus: seed.effectiveStatus,
      statusLabel: statusLabel(seed.effectiveStatus),
      appliedAt: "2026-08-29T09:30:00+08:00",
      withdrawnAt: seed.withdrawnAt,
      withdrawalKind: seed.withdrawalKind,
      lateExitRecorded: seed.lateExitRecorded,
      detailPath: `/dev/pages/c2a-registration-detail/index?registrationId=${seed.registrationId}`,
    });
    withdrawalAttempt = nextScenario === "RESULT_UNKNOWN"
      ? deepFreeze({ key: "c2a-result-unknown-withdraw-0001", kind: "LEAVE_GAME" })
      : null;
    errorMessage = null;
    attemptSequence = nextScenario === "RESULT_UNKNOWN" ? 2 : 1;
  };

  applyScenario(initialScenario);

  const currentAction = (): C2aWithdrawalAction | null => {
    if ((operationState !== "IDLE" && operationState !== "CONFIRMING")
      || Date.parse(startsAt) <= Date.parse(authoritativeNow)) return null;
    if (registration.effectiveStatus === "APPLIED") return "WITHDRAW_APPLICATION";
    if (registration.effectiveStatus === "JOINED") return "LEAVE_GAME";
    return null;
  };

  const snapshot = (): C2aRegistrationWithdrawalSnapshot => deepFreeze({
    marker: C2A_REGISTRATION_WITHDRAWAL_MARKER,
    notice: C2A_REGISTRATION_WITHDRAWAL_FIXTURE.notice,
    scenario,
    authoritativeNow,
    operationState,
    selectedRegistrationId,
    listScrollTop,
    registration: { ...registration },
    game: {
      ...C2A_REGISTRATION_WITHDRAWAL_FIXTURE.game,
      startsAt,
      endsAt,
      dateLabel,
      timeLabel,
      currentPlayers,
      remainingSpots,
    },
    withdrawalAttempt: withdrawalAttempt ? { ...withdrawalAttempt } : null,
    errorMessage,
    availableAction: currentAction(),
    isLateExit: isLateWithdrawal(startsAt, authoritativeNow),
  });

  const hasExactRegistration = (registrationId: unknown): registrationId is string => (
    typeof registrationId === "string" && registrationId === registration.registrationId
  );

  const commitWithdrawal = (): void => {
    if (!withdrawalAttempt || registration.effectiveStatus === "WITHDRAWN") return;
    const wasJoined = withdrawalAttempt.kind === "LEAVE_GAME" && registration.effectiveStatus === "JOINED";
    const lateExitRecorded = wasJoined && isLateWithdrawal(startsAt, authoritativeNow);
    registration = deepFreeze({
      ...registration,
      effectiveStatus: "WITHDRAWN",
      statusLabel: "已退出",
      withdrawnAt: authoritativeNow,
      withdrawalKind: wasJoined ? "GAME_EXIT" : "APPLICATION_WITHDRAWAL",
      lateExitRecorded,
    });
    if (wasJoined) {
      currentPlayers = Math.max(0, currentPlayers - 1);
      remainingSpots += 1;
    }
    operationState = "IDLE";
    errorMessage = null;
  };

  return {
    current: snapshot,
    reset(nextScenario = "APPLIED") {
      applyScenario(nextScenario);
      return snapshot();
    },
    detail(registrationId) {
      return hasExactRegistration(registrationId) ? snapshot() : null;
    },
    selectRegistration(registrationId) {
      if (!hasExactRegistration(registrationId)) return false;
      selectedRegistrationId = registrationId;
      return true;
    },
    setListScrollTop(value) {
      listScrollTop = normalizeScrollTop(value);
      return snapshot();
    },
    openConfirmation(registrationId) {
      if (hasExactRegistration(registrationId) && currentAction() !== null) {
        selectedRegistrationId = registrationId;
        operationState = "CONFIRMING";
      }
      return snapshot();
    },
    cancelConfirmation() {
      if (operationState === "CONFIRMING") operationState = "IDLE";
      return snapshot();
    },
    beginWithdrawal() {
      if (operationState !== "CONFIRMING") return snapshot();
      const action = registration.effectiveStatus === "APPLIED"
        ? "WITHDRAW_APPLICATION"
        : registration.effectiveStatus === "JOINED"
          ? "LEAVE_GAME"
          : null;
      if (!action) return snapshot();
      const ordinal = String(attemptSequence).padStart(4, "0");
      attemptSequence += 1;
      withdrawalAttempt = deepFreeze({
        key: `c2a-${scenario.toLowerCase().replace(/_/g, "-")}-withdraw-${ordinal}`,
        kind: action,
      });
      operationState = "SUBMITTING";
      errorMessage = null;
      return snapshot();
    },
    resolveWithdrawal(outcome = "CONFIRMED") {
      if (operationState !== "SUBMITTING" || !withdrawalAttempt) return snapshot();
      if (outcome === "UNKNOWN") {
        operationState = "RESULT_UNKNOWN";
      } else if (outcome === "ERROR") {
        operationState = "ERROR";
        errorMessage = "退出失败，请稍后重试。";
      } else {
        commitWithdrawal();
      }
      return snapshot();
    },
    confirmWithdrawalResult() {
      if (operationState === "RESULT_UNKNOWN" && withdrawalAttempt) commitWithdrawal();
      return snapshot();
    },
    dismissError() {
      if (operationState === "ERROR") {
        operationState = "IDLE";
        withdrawalAttempt = null;
        errorMessage = null;
      }
      return snapshot();
    },
  };
}

export const c2aRegistrationWithdrawalStore = createC2aRegistrationWithdrawalStore();
