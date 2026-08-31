export const C2B_WAITLIST_MARKER = "C2B_WAITLIST_FIXTURE" as const;

export const C2B_WAITLIST_SCENARIOS = [
  "FULL_REVIEW",
  "WAITLISTED_FIRST",
  "PROMOTED",
  "WAITLIST_WITHDRAW_CONFIRM",
  "BLOCKED_SUSPENDED",
] as const;

export type C2bWaitlistScenario = typeof C2B_WAITLIST_SCENARIOS[number];
export type C2bRegistrationStatus = "APPLIED" | "WAITLISTED" | "JOINED" | "REJECTED" | "WITHDRAWN";
export type C2bGameState = "PUBLISHED" | "SUSPENDED";
export type C2bCaptainDecision = "WAITLIST" | "REJECT";
export type C2bOperationState = "IDLE" | "WITHDRAW_CONFIRMING";

export interface C2bWaitlistRegistration {
  readonly registrationId: string;
  readonly applicantName: string;
  readonly persistedStatus: C2bRegistrationStatus;
  readonly effectiveStatus: C2bRegistrationStatus;
  readonly statusLabel: string;
  readonly appliedAt: string;
  readonly waitlistSeq: number | null;
  readonly waitlistPosition: number | null;
  readonly promotedAt: string | null;
  readonly withdrawnAt: string | null;
  readonly withdrawalKind: "WAITLIST_WITHDRAWAL" | "GAME_EXIT" | null;
  readonly detailPath: string;
}

export interface C2bWaitlistGame {
  readonly gameId: string;
  readonly state: C2bGameState;
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
}

export interface C2bWaitlistSnapshot {
  readonly marker: typeof C2B_WAITLIST_MARKER;
  readonly notice: string;
  readonly scenario: C2bWaitlistScenario;
  readonly applicant: C2bWaitlistRegistration;
  readonly exitingMember: C2bWaitlistRegistration;
  readonly activeWaitlist: readonly C2bWaitlistRegistration[];
  readonly game: C2bWaitlistGame;
  readonly canWaitlist: boolean;
  readonly canReject: boolean;
  readonly captainPanel: C2bCaptainDecision | null;
  readonly operationState: C2bOperationState;
  readonly availableWithdrawalAction: "WITHDRAW_WAITLIST" | null;
  readonly selectedRegistrationId: string | null;
  readonly promotionEventRecorded: boolean;
  readonly listScrollTop: number;
}

export interface C2bWaitlistStore {
  current(): C2bWaitlistSnapshot;
  reset(scenario?: C2bWaitlistScenario): C2bWaitlistSnapshot;
  openCaptainDecision(decision: C2bCaptainDecision): C2bWaitlistSnapshot;
  closeCaptainDecision(): C2bWaitlistSnapshot;
  confirmCaptainDecision(): C2bWaitlistSnapshot;
  openWaitlistWithdrawal(registrationId: unknown): C2bWaitlistSnapshot;
  cancelWaitlistWithdrawal(): C2bWaitlistSnapshot;
  confirmWaitlistWithdrawal(): C2bWaitlistSnapshot;
  promoteAfterJoinedExit(): C2bWaitlistSnapshot;
  selectRegistration(registrationId: unknown): boolean;
  detail(registrationId: unknown): C2bWaitlistSnapshot | null;
  setListScrollTop(value: unknown): C2bWaitlistSnapshot;
}

const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value as Record<string, unknown>).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};

const NOTICE = "C2b 开发预览 · 模拟数据";
const APPLICANT_ID = "c2b-reg-applicant";
const OTHER_WAITLIST_ID = "c2b-reg-other";
const EXITING_MEMBER_ID = "c2b-reg-exiting";

const baseGame = {
  gameId: "c2b-open-game-20260906-1800",
  gameName: "奥体周日候补局",
  venue: "天津奥体足球场",
  pitch: "七人制 A 场",
  formatLabel: "七人制",
  dateLabel: "9月6日 周日",
  timeLabel: "18:00–20:00",
  plannedPlayers: 14,
  organizerName: "C1b验收队",
  intensityLabel: "轻松交流",
  positionLabel: "任意位置",
  estimatedAaLabel: "¥25.72 / 人",
  deadlineLabel: "9月6日 周日 16:00",
};

export const C2B_WAITLIST_FIXTURE = deepFreeze({
  marker: C2B_WAITLIST_MARKER,
  notice: NOTICE,
  deletionCondition: "remove C2B_WAITLIST_FIXTURE before production build or integration",
  game: baseGame,
});

interface MutableRegistration {
  registrationId: string;
  applicantName: string;
  persistedStatus: C2bRegistrationStatus;
  appliedAt: string;
  waitlistSeq: number | null;
  promotedAt: string | null;
  withdrawnAt: string | null;
  withdrawalKind: "WAITLIST_WITHDRAWAL" | "GAME_EXIT" | null;
}

const createRegistration = (
  registrationId: string,
  applicantName: string,
  persistedStatus: C2bRegistrationStatus,
  waitlistSeq: number | null,
): MutableRegistration => ({
  registrationId,
  applicantName,
  persistedStatus,
  appliedAt: "2026-08-30T19:20:00+08:00",
  waitlistSeq,
  promotedAt: null,
  withdrawnAt: null,
  withdrawalKind: null,
});

const normalizeScrollTop = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
};

const isScenario = (value: unknown): value is C2bWaitlistScenario => (
  typeof value === "string" && (C2B_WAITLIST_SCENARIOS as readonly string[]).includes(value)
);

export function createC2bWaitlistStore(
  initialScenario: C2bWaitlistScenario = "FULL_REVIEW",
): C2bWaitlistStore {
  let scenario: C2bWaitlistScenario = "FULL_REVIEW";
  let gameState: C2bGameState = "PUBLISHED";
  let currentPlayers = 14;
  let applicant = createRegistration(APPLICANT_ID, "林晓雨", "APPLIED", null);
  let otherWaitlist = createRegistration(OTHER_WAITLIST_ID, "赵一凡", "WAITLISTED", 41);
  let exitingMember = createRegistration(EXITING_MEMBER_ID, "陈浩", "JOINED", null);
  let captainPanel: C2bCaptainDecision | null = null;
  let operationState: C2bOperationState = "IDLE";
  let selectedRegistrationId: string | null = null;
  let promotionEventRecorded = false;
  let listScrollTop = 0;

  const applyScenario = (nextScenario: C2bWaitlistScenario): void => {
    scenario = nextScenario;
    gameState = nextScenario === "BLOCKED_SUSPENDED" ? "SUSPENDED" : "PUBLISHED";
    currentPlayers = 14;
    captainPanel = null;
    operationState = nextScenario === "WAITLIST_WITHDRAW_CONFIRM" ? "WITHDRAW_CONFIRMING" : "IDLE";
    selectedRegistrationId = nextScenario === "WAITLIST_WITHDRAW_CONFIRM" ? APPLICANT_ID : null;
    promotionEventRecorded = nextScenario === "PROMOTED";
    listScrollTop = 0;

    applicant = createRegistration(
      APPLICANT_ID,
      "林晓雨",
      nextScenario === "FULL_REVIEW" ? "APPLIED" : nextScenario === "PROMOTED" ? "JOINED" : "WAITLISTED",
      nextScenario === "FULL_REVIEW" ? null : 41,
    );
    otherWaitlist = createRegistration(
      OTHER_WAITLIST_ID,
      "赵一凡",
      "WAITLISTED",
      nextScenario === "FULL_REVIEW" ? 41 : 42,
    );
    exitingMember = createRegistration(
      EXITING_MEMBER_ID,
      "陈浩",
      nextScenario === "PROMOTED" ? "WITHDRAWN" : "JOINED",
      null,
    );
    if (nextScenario === "PROMOTED") {
      applicant.promotedAt = "2026-08-30T20:05:00+08:00";
      exitingMember.withdrawnAt = "2026-08-30T20:05:00+08:00";
      exitingMember.withdrawalKind = "GAME_EXIT";
    }
  };

  const activeRecords = (): MutableRegistration[] => [applicant, otherWaitlist]
    .filter((item) => item.persistedStatus === "WAITLISTED")
    .sort((left, right) => (left.waitlistSeq ?? 0) - (right.waitlistSeq ?? 0));

  const statusLabel = (item: MutableRegistration, waitlistPosition: number | null): string => {
    if (item.persistedStatus === "APPLIED") return "待队长审核";
    if (item.persistedStatus === "WAITLISTED") return `候补第 ${waitlistPosition} 位`;
    if (item.persistedStatus === "JOINED") return "已加入";
    if (item.persistedStatus === "REJECTED") return "未通过";
    return "已退出";
  };

  const projectRegistration = (
    item: MutableRegistration,
    positions: ReadonlyMap<string, number>,
  ): C2bWaitlistRegistration => {
    const waitlistPosition = positions.get(item.registrationId) ?? null;
    return {
      registrationId: item.registrationId,
      applicantName: item.applicantName,
      persistedStatus: item.persistedStatus,
      effectiveStatus: item.persistedStatus,
      statusLabel: statusLabel(item, waitlistPosition),
      appliedAt: item.appliedAt,
      waitlistSeq: item.waitlistSeq,
      waitlistPosition,
      promotedAt: item.promotedAt,
      withdrawnAt: item.withdrawnAt,
      withdrawalKind: item.withdrawalKind,
      detailPath: `/dev/pages/c2b-registration-detail/index?registrationId=${encodeURIComponent(item.registrationId)}`,
    };
  };

  const snapshot = (): C2bWaitlistSnapshot => {
    const active = activeRecords();
    const positions = new Map(active.map((item, index) => [item.registrationId, index + 1]));
    const projectedApplicant = projectRegistration(applicant, positions);
    const canReview = gameState === "PUBLISHED" && applicant.persistedStatus === "APPLIED";
    return deepFreeze({
      marker: C2B_WAITLIST_MARKER,
      notice: NOTICE,
      scenario,
      applicant: projectedApplicant,
      exitingMember: projectRegistration(exitingMember, positions),
      activeWaitlist: active.map((item) => projectRegistration(item, positions)),
      game: {
        ...baseGame,
        state: gameState,
        currentPlayers,
        remainingSpots: Math.max(0, baseGame.plannedPlayers - currentPlayers),
      },
      canWaitlist: canReview && currentPlayers >= baseGame.plannedPlayers,
      canReject: canReview,
      captainPanel,
      operationState,
      availableWithdrawalAction: applicant.persistedStatus === "WAITLISTED" ? "WITHDRAW_WAITLIST" : null,
      selectedRegistrationId,
      promotionEventRecorded,
      listScrollTop,
    });
  };

  const current = (): C2bWaitlistSnapshot => snapshot();

  applyScenario(isScenario(initialScenario) ? initialScenario : "FULL_REVIEW");

  return {
    current,

    reset(nextScenario: C2bWaitlistScenario = "FULL_REVIEW") {
      if (isScenario(nextScenario)) applyScenario(nextScenario);
      return current();
    },

    openCaptainDecision(decision: C2bCaptainDecision) {
      const state = current();
      if ((decision === "WAITLIST" && state.canWaitlist) || (decision === "REJECT" && state.canReject)) {
        captainPanel = decision;
      }
      return current();
    },

    closeCaptainDecision() {
      captainPanel = null;
      return current();
    },

    confirmCaptainDecision() {
      if (captainPanel === "WAITLIST" && current().canWaitlist) {
        const allocatedSeq = Math.max(
          0,
          ...[applicant, otherWaitlist]
            .map((item) => item.waitlistSeq)
            .filter((value): value is number => value !== null),
        ) + 1;
        applicant.persistedStatus = "WAITLISTED";
        applicant.waitlistSeq = allocatedSeq;
      } else if (captainPanel === "REJECT" && current().canReject) {
        applicant.persistedStatus = "REJECTED";
      }
      captainPanel = null;
      return current();
    },

    openWaitlistWithdrawal(registrationId: unknown) {
      if (registrationId === applicant.registrationId && applicant.persistedStatus === "WAITLISTED") {
        selectedRegistrationId = applicant.registrationId;
        operationState = "WITHDRAW_CONFIRMING";
      }
      return current();
    },

    cancelWaitlistWithdrawal() {
      operationState = "IDLE";
      return current();
    },

    confirmWaitlistWithdrawal() {
      if (
        operationState === "WITHDRAW_CONFIRMING"
        && selectedRegistrationId === applicant.registrationId
        && applicant.persistedStatus === "WAITLISTED"
      ) {
        applicant.persistedStatus = "WITHDRAWN";
        applicant.withdrawnAt = "2026-08-30T20:10:00+08:00";
        applicant.withdrawalKind = "WAITLIST_WITHDRAWAL";
      }
      operationState = "IDLE";
      return current();
    },

    promoteAfterJoinedExit() {
      if (gameState !== "PUBLISHED" || promotionEventRecorded || exitingMember.persistedStatus !== "JOINED") {
        return current();
      }
      const head = activeRecords()[0];
      if (!head) return current();
      exitingMember.persistedStatus = "WITHDRAWN";
      exitingMember.withdrawnAt = "2026-08-30T20:05:00+08:00";
      exitingMember.withdrawalKind = "GAME_EXIT";
      currentPlayers -= 1;
      head.persistedStatus = "JOINED";
      head.promotedAt = "2026-08-30T20:05:00+08:00";
      currentPlayers += 1;
      promotionEventRecorded = true;
      return current();
    },

    selectRegistration(registrationId: unknown) {
      if (registrationId !== applicant.registrationId) return false;
      selectedRegistrationId = applicant.registrationId;
      return true;
    },

    detail(registrationId: unknown) {
      return registrationId === applicant.registrationId ? current() : null;
    },

    setListScrollTop(value: unknown) {
      listScrollTop = normalizeScrollTop(value);
      return current();
    },
  };
}

export const c2bWaitlistStore = createC2bWaitlistStore();
