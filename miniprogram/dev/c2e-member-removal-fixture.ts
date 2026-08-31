import { validateOpenGameMemberRemovalReason } from "../domain/open-game-registration-decoder";

export const C2E_MEMBER_REMOVAL_FIXTURE_MARKER = "C2E_MEMBER_REMOVAL_FIXTURE";

export const C2E_MEMBER_REMOVAL_SCENARIOS = [
  "READY",
  "VALIDATION",
  "FULL_FIFO",
  "OPEN_SPOT",
  "BLOCKED",
  "UNKNOWN_RESULT",
] as const;

export type C2eMemberRemovalScenario = typeof C2E_MEMBER_REMOVAL_SCENARIOS[number];
export type C2eMemberRemovalPreviewState = "READY" | "BLOCKED" | "UNKNOWN_RESULT";

export interface C2eMemberRemovalMember {
  readonly registrationId: string;
  readonly displayName: string;
  readonly positionLabel: string;
  readonly sourceLabel: string;
  readonly joinedTimeLabel: string;
  readonly promotedFromWaitlist: boolean;
  readonly canRemove: boolean;
  readonly blockedLabel: string;
}

export interface C2eMemberRemovalSnapshot {
  readonly marker: typeof C2E_MEMBER_REMOVAL_FIXTURE_MARKER;
  readonly fixtureNotice: string;
  readonly scenario: C2eMemberRemovalScenario;
  readonly previewState: C2eMemberRemovalPreviewState;
  readonly previewMessage: string;
  readonly game: {
    readonly gameName: string;
    readonly dateTimeLabel: string;
    readonly placeLabel: string;
  };
  readonly members: readonly C2eMemberRemovalMember[];
  readonly joinedCount: number;
  readonly remainingSpots: number;
  readonly waitlistCount: number;
  readonly removalPanel: { readonly registrationId: string } | null;
  readonly removalMemberName: string;
  readonly reason: string;
  readonly reasonCount: number;
  readonly reasonError: string;
  readonly canConfirm: boolean;
  readonly notice: string;
  readonly pendingIdempotencyKey: string | null;
  readonly replayedIdempotencyKey: string | null;
}

export interface C2eMemberRemovalStore {
  current(): C2eMemberRemovalSnapshot;
  reset(scenario?: C2eMemberRemovalScenario): C2eMemberRemovalSnapshot;
  openRemoval(registrationId: unknown): C2eMemberRemovalSnapshot;
  closeRemoval(): C2eMemberRemovalSnapshot;
  setReason(reason: unknown): C2eMemberRemovalSnapshot;
  confirmRemoval(): C2eMemberRemovalSnapshot;
  resolveBlocker(): C2eMemberRemovalSnapshot;
  confirmUnknownResult(): C2eMemberRemovalSnapshot;
}

const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value as Record<string, unknown>).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};

const FIXTURE_NOTICE = "C2e 开发预览 · 模拟数据";
const UNKNOWN_KEY = "c2e-remove-member-unknown-key-0001";
const GAME = {
  gameName: "海河周六轻松局",
  dateTimeLabel: "9月5日 周六 · 09:00–10:30",
  placeLabel: "天津河东体育中心 · 笼式五人制 2 号场",
} as const;

export const C2E_MEMBER_REMOVAL_FIXTURE = deepFreeze({
  marker: C2E_MEMBER_REMOVAL_FIXTURE_MARKER,
  notice: FIXTURE_NOTICE,
  deletionCondition: "remove C2E_MEMBER_REMOVAL_FIXTURE before production build or integration",
});

interface MutableMember {
  registrationId: string;
  displayName: string;
  positionLabel: string;
  sourceLabel: string;
  joinedTimeLabel: string;
  promotedFromWaitlist: boolean;
  canRemove: boolean;
  blockedLabel: string;
}

const member = (
  registrationId: string,
  displayName: string,
  positionLabel: string,
  options: Partial<MutableMember> = {},
): MutableMember => ({
  registrationId,
  displayName,
  positionLabel,
  sourceLabel: "审核通过加入",
  joinedTimeLabel: "9月1日 周二 10:00 加入",
  promotedFromWaitlist: false,
  canRemove: true,
  blockedLabel: "",
  ...options,
});

const removableRoster = (): MutableMember[] => [
  member("c2e-reg-left-wing", "左边锋小王", "前锋"),
  member("c2e-reg-goalkeeper", "海河门将阿哲", "门将"),
];

const fullRoster = (): MutableMember[] => [
  ...removableRoster(),
  member("c2e-reg-defender", "奥体后卫小周", "后卫"),
];

const promotedMember = (): MutableMember => member(
  "c2e-reg-waitlist-first",
  "候补小林",
  "后卫",
  {
    sourceLabel: "候补递补加入",
    joinedTimeLabel: "9月1日 周二 11:00 加入",
    promotedFromWaitlist: true,
  },
);

function isScenario(value: unknown): value is C2eMemberRemovalScenario {
  return typeof value === "string"
    && (C2E_MEMBER_REMOVAL_SCENARIOS as readonly string[]).includes(value);
}

export function createC2eMemberRemovalStore(
  initialScenario: C2eMemberRemovalScenario = "READY",
): C2eMemberRemovalStore {
  let scenario: C2eMemberRemovalScenario = "READY";
  let previewState: C2eMemberRemovalPreviewState = "READY";
  let previewMessage = "";
  let members: MutableMember[] = [];
  let joinedCount = 0;
  let remainingSpots = 0;
  let waitlistCount = 0;
  let removalPanel: { registrationId: string } | null = null;
  let reason = "";
  let reasonError = "";
  let notice = "";
  let pendingIdempotencyKey: string | null = null;
  let replayedIdempotencyKey: string | null = null;

  const applyScenario = (next: C2eMemberRemovalScenario): void => {
    scenario = next;
    previewState = "READY";
    previewMessage = "";
    members = removableRoster();
    joinedCount = members.length;
    remainingSpots = 2;
    waitlistCount = 1;
    removalPanel = null;
    reason = "";
    reasonError = "";
    notice = "";
    pendingIdempotencyKey = null;
    replayedIdempotencyKey = null;

    if (next === "VALIDATION") {
      removalPanel = { registrationId: "c2e-reg-left-wing" };
      return;
    }
    if (next === "FULL_FIFO" || next === "UNKNOWN_RESULT") {
      members = fullRoster();
      joinedCount = members.length;
      remainingSpots = 0;
      waitlistCount = 2;
      if (next === "UNKNOWN_RESULT") {
        previewState = "UNKNOWN_RESULT";
        previewMessage = "原移除结果尚未确认；预览将复用同一操作 key。";
        pendingIdempotencyKey = UNKNOWN_KEY;
      }
      return;
    }
    if (next === "OPEN_SPOT") {
      remainingSpots = 2;
      waitlistCount = 2;
      return;
    }
    if (next === "BLOCKED") {
      previewState = "BLOCKED";
      previewMessage = "已开场或订单权威异常时，名单只能查看。";
      members = [
        member("c2e-reg-started", "开场后成员小王", "前锋", {
          canRemove: false,
          blockedLabel: "已到开场时间",
        }),
        member("c2e-reg-order-blocked", "订单待确认成员阿杰", "中场", {
          canRemove: false,
          blockedLabel: "订单状态暂不支持",
        }),
      ];
      joinedCount = members.length;
      remainingSpots = 0;
      waitlistCount = 0;
    }
  };

  const snapshot = (): C2eMemberRemovalSnapshot => {
    const selected = removalPanel === null
      ? undefined
      : members.find((item) => item.registrationId === removalPanel?.registrationId);
    const validation = validateOpenGameMemberRemovalReason(reason);
    return deepFreeze({
      marker: C2E_MEMBER_REMOVAL_FIXTURE_MARKER,
      fixtureNotice: FIXTURE_NOTICE,
      scenario,
      previewState,
      previewMessage,
      game: { ...GAME },
      members: members.map((item) => ({ ...item })),
      joinedCount,
      remainingSpots,
      waitlistCount,
      removalPanel: removalPanel ? { ...removalPanel } : null,
      removalMemberName: selected?.displayName ?? "",
      reason,
      reasonCount: Array.from(reason).length,
      reasonError,
      canConfirm: removalPanel !== null && validation.valid,
      notice,
      pendingIdempotencyKey,
      replayedIdempotencyKey,
    });
  };

  const applyRemoval = (prefix = ""): void => {
    const selected = removalPanel === null
      ? members.find((item) => item.registrationId === "c2e-reg-left-wing")
      : members.find((item) => item.registrationId === removalPanel?.registrationId);
    if (!selected) return;
    const wasFull = remainingSpots === 0;
    members = members.filter((item) => item.registrationId !== selected.registrationId);
    if (wasFull && waitlistCount > 0) {
      members.push(promotedMember());
      waitlistCount -= 1;
      notice = `${prefix}已移除${selected.displayName}；候补第 1 位候补小林已加入。`;
    } else {
      joinedCount -= 1;
      remainingSpots += 1;
      notice = `${prefix}已移除${selected.displayName}；本场新增 1 个空缺名额。`;
    }
    removalPanel = null;
    reason = "";
    reasonError = "";
  };

  applyScenario(isScenario(initialScenario) ? initialScenario : "READY");

  return {
    current: snapshot,

    reset(next: C2eMemberRemovalScenario = "READY") {
      if (isScenario(next)) applyScenario(next);
      return snapshot();
    },

    openRemoval(registrationId: unknown) {
      const selected = members.find((item) => item.registrationId === registrationId);
      if (previewState === "READY" && selected?.canRemove) {
        removalPanel = { registrationId: selected.registrationId };
        reason = "";
        reasonError = "";
      }
      return snapshot();
    },

    closeRemoval() {
      removalPanel = null;
      reason = "";
      reasonError = "";
      return snapshot();
    },

    setReason(value: unknown) {
      if (removalPanel === null) return snapshot();
      reason = typeof value === "string" ? value : "";
      const validation = validateOpenGameMemberRemovalReason(reason);
      reasonError = validation.valid || reason.length === 0 ? "" : validation.error;
      return snapshot();
    },

    confirmRemoval() {
      if (previewState !== "READY" || removalPanel === null) return snapshot();
      const validation = validateOpenGameMemberRemovalReason(reason);
      if (!validation.valid) {
        reasonError = validation.error;
        return snapshot();
      }
      applyRemoval();
      return snapshot();
    },

    resolveBlocker() {
      if (previewState === "BLOCKED") applyScenario("READY");
      return snapshot();
    },

    confirmUnknownResult() {
      if (previewState !== "UNKNOWN_RESULT" || pendingIdempotencyKey === null) return snapshot();
      replayedIdempotencyKey = pendingIdempotencyKey;
      pendingIdempotencyKey = null;
      previewState = "READY";
      previewMessage = "";
      applyRemoval("已按原操作确认：");
      return snapshot();
    },
  };
}

export const c2eMemberRemovalStore = createC2eMemberRemovalStore();
