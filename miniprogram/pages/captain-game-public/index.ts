import type { OpenGamePublic } from "../../domain/open-game";
import type {
  OpenGameApplyBlockedReason,
  OpenGameRegistrationContext,
  OpenGameRegistrationEffectiveStatus,
  OpenGamePublicProfile,
  OpenGamePublicRosterMember,
  OpenGamePublicWaitlistedMember,
  OpenGameRegistrationWithdrawalAction,
} from "../../domain/open-game-registration";
import {
  formatCents,
  formatOpenGameDateTime,
  formatOpenGameRange,
  openGameIntensityLabel,
  openGamePositionLabel,
  openGameStateLabel,
  openGameStateReasonLabel,
  presentOpenGamePublic,
} from "../../presentation/open-game";
import { presentMyGameSelfAttendance } from "../../presentation/my-game-registrations";
import { readIntentHeaderLayout } from "../../presentation/intent-header-layout";
import { OpenGameRegistrationApiError } from "../../services/http-open-game-registration";
import { OpenGameApiError } from "../../services/http-open-game";
import {
  classifyOpenGameRegistrationMutationResult,
  classifyOpenGameRegistrationPendingAttempt,
  classifyOpenGameRegistrationUnknownResult,
  classifyOpenGameRosterManagementUnknownResult,
  getOpenGameRegistrationAttemptStore,
  getOpenGameRegistrationSource,
  type OpenGameRegistrationApplyAttempt,
  type OpenGameRegistrationAttempt,
  type OpenGameRegistrationAttemptTarget,
  type OpenGameRegistrationWithdrawAttempt,
  type OpenGameAllowMemberReapplyAttempt,
  type OpenGameMemberRemoveAttempt,
  type OpenGameRosterManagementAttempt,
} from "../../services/open-game-registration";
import { getOpenGameSource } from "../../services/open-game";

interface PageOptions { token?: unknown; game_id?: unknown; preview?: unknown; }
type PublicStatus =
  | "LOADING"
  | "READY"
  | "LOAD_ERROR"
  | "AUTH_LOSS"
  | "NOT_FOUND"
  | "RESULT_UNKNOWN"
  | "OTHER_PENDING"
  | "FOREIGN_PENDING";
type PrimaryAction =
  | "LOGIN"
  | "APPLY"
  | "REFRESH"
  | "WITHDRAW"
  | "CONFIRM_RESULT"
  | "CONFIRM_WITHDRAW_RESULT"
  | "GO_PENDING"
  | "CLEAR_PENDING"
  | null;
type RegistrationStatus =
  | "NONE"
  | "APPLIED"
  | "WAITLISTED"
  | "JOINED"
  | "REJECTED"
  | "WITHDRAWN"
  | "REMOVED"
  | "CANCELLED";
type StatusTone =
  | "anonymous"
  | "available"
  | "pending"
  | "waitlisted"
  | "blocked"
  | "joined"
  | "rejected"
  | "withdrawn";
type WithdrawalOperationState = "IDLE" | "CONFIRMING" | "SUBMITTING" | "RESULT_UNKNOWN";
type ProfileSheetState = "CLOSED" | "EDITING" | "SUBMITTING";
type ProfilePurpose = "SIGNUP" | "UPDATE";
type SignupConfirmations = {
  readonly adultConfirmed: true;
  readonly riskConfirmed: true;
};

interface RosterRow {
  readonly nickname: string;
  readonly avatarUrl: string;
  readonly avatarFallback: string;
  readonly waitlistPosition?: number;
  readonly registrationId: string;
  readonly version: number;
  readonly canRemove: boolean;
  readonly canAllowReapply: boolean;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32}$/;

interface RegistrationListPage {
  readonly route?: string;
  applyRegistrationAuthority?(patch: {
    readonly originatingUserId: string;
    readonly registrationId: string;
    readonly effectiveStatus: OpenGameRegistrationEffectiveStatus;
    readonly waitlistPosition: number | null;
    readonly waitlistedAt: string | null;
    readonly promotedAt: string | null;
    readonly attendanceStatus: "UNMARKED" | "PRESENT" | "NO_SHOW" | null;
    readonly attendanceRecordedAt: string | null;
    readonly attendanceCorrectedAt: string | null;
  }): boolean;
}

function currentPages(): readonly RegistrationListPage[] {
  return getCurrentPages() as unknown as readonly RegistrationListPage[];
}

function navigation(
  method: "navigateTo" | "redirectTo" | "reLaunch",
  url: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = () => { if (!settled) { settled = true; resolve(); } };
    const fail = (error: unknown) => { if (!settled) { settled = true; reject(error); } };
    const options = { url, success: done, fail };
    const returned = method === "navigateTo"
      ? wx.navigateTo(options)
      : method === "redirectTo" ? wx.redirectTo(options) : wx.reLaunch(options);
    const thenable = returned as unknown as {
      then?: (yes: () => void, no: (error: unknown) => void) => void;
    };
    if (typeof thenable?.then === "function") thenable.then(done, fail);
  });
}

function confirmAction(
  title: string,
  content: string,
  confirmText: string,
): Promise<boolean> {
  return new Promise((resolve) => {
    wx.showModal({
      title,
      content,
      confirmText,
      cancelText: "取消",
      success: ({ confirm }) => resolve(Boolean(confirm)),
      fail: () => resolve(false),
    });
  });
}

function rosterFallback(nickname: string): string {
  return Array.from(nickname.trim())[0] ?? "球";
}

function presentRosterMember(
  member: OpenGamePublicRosterMember | OpenGamePublicWaitlistedMember,
): RosterRow {
  const management = member.management;
  return Object.freeze({
    nickname: member.nickname,
    avatarUrl: member.avatarUrl ?? "",
    avatarFallback: rosterFallback(member.nickname),
    ...("waitlistPosition" in member ? { waitlistPosition: member.waitlistPosition } : {}),
    registrationId: management?.registrationId ?? "",
    version: management?.version ?? 0,
    canRemove: management?.canRemove ?? false,
    canAllowReapply: management?.canAllowReapply ?? false,
  });
}

function readHeaderData() {
  const header = readIntentHeaderLayout();
  return {
    headerTopPx: header.topPx,
    headerRowHeightPx: header.rowHeightPx,
    headerHeightPx: header.topPx + header.rowHeightPx,
    headerLeftInsetPx: header.rightInsetPx,
    headerRightInsetPx: header.rightInsetPx,
  };
}

function attendanceAuthorityTimeLabel(
  prefix: string,
  value: string | null | undefined,
  timeZone: string,
): string {
  return value == null ? "" : `${prefix} ${formatOpenGameDateTime(value, timeZone)}`;
}

function sameApplyAttempt(
  left: OpenGameRegistrationApplyAttempt,
  right: OpenGameRegistrationApplyAttempt,
): boolean {
  return left.originatingUserId === right.originatingUserId
    && left.shareToken === right.shareToken
    && left.submissionMode === right.submissionMode
    && left.idempotencyKey === right.idempotencyKey
    && left.body.displayName === right.body.displayName
    && left.body.position === right.body.position
    && left.body.note === right.body.note
    && left.body.adultConfirmed === right.body.adultConfirmed
    && left.body.riskConfirmed === right.body.riskConfirmed;
}

function sameWithdrawAttempt(
  left: OpenGameRegistrationWithdrawAttempt,
  right: OpenGameRegistrationWithdrawAttempt,
): boolean {
  return left.originatingUserId === right.originatingUserId
    && left.shareToken === right.shareToken
    && left.applicationId === right.applicationId
    && left.action === right.action
    && left.expectedVersion === right.expectedVersion
    && left.idempotencyKey === right.idempotencyKey;
}

function sameRosterManagementAttempt(
  left: OpenGameRosterManagementAttempt,
  right: OpenGameRosterManagementAttempt,
): boolean {
  return left.kind === right.kind
    && left.originatingUserId === right.originatingUserId
    && left.gameId === right.gameId
    && left.registrationId === right.registrationId
    && left.expectedVersion === right.expectedVersion
    && left.idempotencyKey === right.idempotencyKey
    && (left.kind !== "allow-reapply"
      || (right.kind === "allow-reapply" && left.shareToken === right.shareToken))
    && (left.kind !== "remove-member"
      || (right.kind === "remove-member" && left.reason === right.reason));
}

function sameAttempt(
  left: OpenGameRegistrationAttempt,
  right: OpenGameRegistrationAttempt,
): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "apply" && right.kind === "apply") return sameApplyAttempt(left, right);
  if (left.kind === "withdraw" && right.kind === "withdraw") return sameWithdrawAttempt(left, right);
  if ((left.kind === "remove-member" || left.kind === "allow-reapply")
    && (right.kind === "remove-member" || right.kind === "allow-reapply")) {
    return sameRosterManagementAttempt(left, right);
  }
  if (left.kind === "decision" && right.kind === "decision") {
    return left.originatingUserId === right.originatingUserId
      && left.gameId === right.gameId
      && left.applicationId === right.applicationId
      && left.decision === right.decision
      && left.expectedVersion === right.expectedVersion
      && left.idempotencyKey === right.idempotencyKey;
  }
  return false;
}

function targetForAttempt(
  attempt: OpenGameRegistrationAttempt,
  shareToken: string,
): OpenGameRegistrationAttemptTarget {
  if (attempt.kind === "withdraw") return { kind: "withdraw", shareToken };
  if (attempt.kind === "allow-reapply") {
    return { kind: "allow-reapply", shareToken, gameId: attempt.gameId };
  }
  return { kind: "apply", shareToken };
}

function readSignupContext(shareToken: string): Promise<OpenGameRegistrationContext> {
  const source = getOpenGameRegistrationSource();
  return source.getSignupContext?.(shareToken) ?? source.getContext(shareToken);
}

function createSignupRegistration(
  attempt: OpenGameRegistrationApplyAttempt,
): Promise<OpenGameRegistrationContext> {
  const source = getOpenGameRegistrationSource();
  return source.createRegistration?.(attempt) ?? source.apply(attempt);
}

function withdrawSignupRegistration(
  attempt: OpenGameRegistrationWithdrawAttempt,
): Promise<OpenGameRegistrationContext> {
  const source = getOpenGameRegistrationSource();
  return source.withdrawRegistration?.(attempt) ?? source.withdraw(attempt);
}

function withdrawalLabel(action: OpenGameRegistrationWithdrawalAction | null): string {
  if (action === "WITHDRAW_APPLICATION") return "撤回申请";
  if (action === "WITHDRAW_WAITLIST") return "退出候补";
  if (action === "LEAVE_GAME") return "退出球局";
  return "";
}

let withdrawalAttemptSerial = 0;
let signupAttemptSerial = 0;
let managementAttemptSerial = 0;

function blockerPresentation(reason: OpenGameApplyBlockedReason): {
  readonly heading: string;
  readonly description: string;
  readonly tone: StatusTone;
  readonly action: PrimaryAction;
} {
  switch (reason) {
    case "AUTH_REQUIRED":
      return {
        heading: "登录后即可报名",
        description: "登录后可查看名单，并按实时名额进入正式名单或候补。",
        tone: "anonymous",
        action: "LOGIN",
      };
    case "OWNER_CANNOT_APPLY":
      return {
        heading: "队长不能申请自己组织的球局",
        description: "你仍可查看公开球局信息。",
        tone: "rejected",
        action: null,
      };
    case "ALREADY_APPLIED":
      return {
        heading: "你已经申请过这场球局",
        description: "请以本页读取到的权威申请结果为准。",
        tone: "pending",
        action: null,
      };
    case "REMOVED_BY_CAPTAIN":
      return {
        heading: "暂不能重新报名",
        description: "你已被队长移出；需要队长允许后才能重新报名。",
        tone: "rejected",
        action: null,
      };
    case "GAME_NOT_PUBLISHED":
      return {
        heading: "球局暂未开放申请",
        description: "当前没有可执行的申请动作。",
        tone: "rejected",
        action: null,
      };
    case "REGISTRATION_DEADLINE_PASSED":
      return {
        heading: "报名已经截止",
        description: "当前不提供候补或逾期申请。",
        tone: "rejected",
        action: null,
      };
    case "GAME_SUSPENDED":
      return {
        heading: "球局暂时停止报名",
        description: "请以球局恢复后的权威状态为准。",
        tone: "rejected",
        action: null,
      };
    case "GAME_CANCELLED":
      return {
        heading: "球局已取消",
        description: "本场不再接受申请。",
        tone: "rejected",
        action: null,
      };
    case "GAME_COMPLETED":
      return {
        heading: "球局已结束",
        description: "本场不再接受申请。",
        tone: "rejected",
        action: null,
      };
    case "GAME_STARTED":
      return {
        heading: "球局已经开始",
        description: "本场不再接受申请。",
        tone: "rejected",
        action: null,
      };
  }
}

function registrationPresentation(context: OpenGameRegistrationContext): {
  readonly registrationStatus: RegistrationStatus;
  readonly heading: string;
  readonly description: string;
  readonly tone: StatusTone;
  readonly action: PrimaryAction;
} {
  const effectiveStatus = context.viewerRegistration?.effectiveStatus;
  if (effectiveStatus === "APPLIED") {
    return {
      registrationStatus: "APPLIED",
      heading: "等待队长审核",
      description: "申请已记录，正在等待队长审核。",
      tone: "pending",
      action: context.viewerRegistration?.availableWithdrawalAction === "WITHDRAW_APPLICATION"
        ? "WITHDRAW"
        : null,
    };
  }
  if (effectiveStatus === "WAITLISTED") {
    const position = context.viewerRegistration?.waitlistPosition;
    const suspended = context.game.state === "SUSPENDED";
    return {
      registrationStatus: "WAITLISTED",
      heading: suspended
        ? "球局暂停中"
        : position === null || position === undefined
          ? "候补中"
          : `候补中 · 当前第 ${position} 位`,
      description: suspended
        ? "暂停期间不会自动递补；你仍可随时退出候补。"
        : "位置会随前方候补退出或正式名额释放而更新。",
      tone: suspended ? "blocked" : "waitlisted",
      action: context.viewerRegistration?.availableWithdrawalAction === "WITHDRAW_WAITLIST"
        ? "WITHDRAW"
        : null,
    };
  }
  if (effectiveStatus === "JOINED") {
    const attendanceStatus = context.viewerRegistration?.attendanceStatus ?? null;
    if (attendanceStatus !== null) {
      const attendance = presentMyGameSelfAttendance(
        attendanceStatus,
        context.viewerRegistration?.attendanceRecordedAt ?? null,
        context.game.timeZone,
      );
      const unmarked = attendanceStatus === "UNMARKED";
      return {
        registrationStatus: "JOINED",
        heading: attendance.attendanceLabel ?? "待队长记录",
        description: unmarked
          ? "本场已结束，队长尚未记录你的到场结果。"
          : `队长已于 ${attendance.attendanceRecordedAtLabel}。`,
        tone: unmarked ? "pending" : attendanceStatus === "PRESENT" ? "joined" : "rejected",
        action: null,
      };
    }
    const promoted = context.viewerRegistration?.promotedAt !== null
      && context.viewerRegistration?.promotedAt !== undefined;
    return {
      registrationStatus: "JOINED",
      heading: "已加入本场球局",
      description: promoted
        ? "你已按候补顺序转为正式成员，请以当前权威状态为准。"
        : "你已进入正式名单；AA 到场线下结算。",
      tone: "joined",
      action: context.viewerRegistration?.availableWithdrawalAction === "LEAVE_GAME"
        ? "WITHDRAW"
        : null,
    };
  }
  if (context.allowedActions.canApply) {
    const reapply = effectiveStatus === "WITHDRAWN" || effectiveStatus === "REMOVED";
    const waitlist = context.remainingSpots === 0;
    return {
      registrationStatus: (effectiveStatus ?? "NONE") as RegistrationStatus,
      heading: reapply
        ? "已撤销，可重新报名"
        : waitlist ? "正式名额已满，可加入候补" : "可以立即报名",
      description: reapply
        ? "重新报名将按提交时的实时名额进入正式名单或候补队尾。"
        : waitlist
          ? "提交后会按 FIFO 顺序加入候补队尾。"
          : "提交后将以服务端实时名额确认正式或候补状态。",
      tone: "available",
      action: "APPLY",
    };
  }
  if (effectiveStatus === "REJECTED") {
    return {
      registrationStatus: "REJECTED",
      heading: "本次申请未被接受",
      description: "这是本场决定，不影响之后参加其他球局。",
      tone: "rejected",
      action: null,
    };
  }
  if (effectiveStatus === "WITHDRAWN") {
    const applicationWithdrawal = context.viewerRegistration?.withdrawalKind
      === "APPLICATION_WITHDRAWAL";
    const waitlistWithdrawal = context.viewerRegistration?.withdrawalKind
      === "WAITLIST_WITHDRAWAL";
    return {
      registrationStatus: "WITHDRAWN",
      heading: applicationWithdrawal
        ? "申请已撤回"
        : waitlistWithdrawal ? "已退出候补" : "已退出球局",
      description: applicationWithdrawal
        ? "本次报名已撤销，可按实时名额重新报名。"
        : waitlistWithdrawal
          ? "你已退出本场候补队列，可重新报名并排到候补队尾。"
          : "你已退出本场球局，可按实时名额重新报名。",
      tone: "withdrawn",
      action: null,
    };
  }
  if (effectiveStatus === "REMOVED") {
    if (context.allowedActions.applyBlockedReason === "REMOVED_BY_CAPTAIN") {
      return {
        registrationStatus: "REMOVED",
        ...blockerPresentation("REMOVED_BY_CAPTAIN"),
      };
    }
    return {
      registrationStatus: "REMOVED",
      heading: "已被队长移出",
      description: "你已不再是本场正式成员；本状态以服务端记录为准。",
      tone: "withdrawn",
      action: null,
    };
  }
  if (effectiveStatus === "CANCELLED") {
    return {
      registrationStatus: "CANCELLED",
      heading: "球局已取消",
      description: "原申请记录保留，但本场已不再进行。",
      tone: "rejected",
      action: null,
    };
  }
  const blocker = blockerPresentation(context.allowedActions.applyBlockedReason as OpenGameApplyBlockedReason);
  return { registrationStatus: "NONE", ...blocker };
}

function blankData() {
  return {
    status: "LOADING" as PublicStatus,
    mode: "shared" as "shared" | "owner",
    state: "",
    stateLabel: "",
    stateReasonText: "",
    showReturnManage: false,
    showLogin: false,
    primaryAction: null as PrimaryAction,
    registrationStatus: "NONE" as RegistrationStatus,
    remainingSpots: 0,
    viewerAuthenticated: false,
    joinedCount: 0,
    waitlistCount: 0,
    publicOpenSpots: 0,
    totalPlayers: 0,
    fixedPlayers: 0,
    signupProgressLabel: "",
    waitlistCountLabel: "",
    planCountLabel: "",
    signupActionLabel: "确认报名",
    signupSubmitting: false,
    rosterPrivate: true,
    joinedMembers: [] as readonly RosterRow[],
    waitlistedMembers: [] as readonly RosterRow[],
    blockedMembers: [] as readonly RosterRow[],
    managementGameId: "",
    isCaptain: false,
    managementActionInFlight: false,
    managementError: "",
    profileActionVisible: false,
    profileSheetState: "CLOSED" as ProfileSheetState,
    profilePurpose: "SIGNUP" as ProfilePurpose,
    profileSheetTitle: "确认报名",
    profileSubmitLabel: "确认报名",
    profileNickname: "",
    profileAvatarPreview: "",
    profileAvatarFallback: "微",
    profileAvatarTempPath: "",
    profileExistingAvatarUrl: "",
    profileError: "",
    adultConfirmed: false,
    riskConfirmed: false,
    applyBlockedReason: null as OpenGameApplyBlockedReason | null,
    statusHeading: "",
    statusDescription: "",
    statusTone: "available" as StatusTone,
    errorMessage: "",
    navigationError: "",
    pendingRoute: "",
    withdrawalOperationState: "IDLE" as WithdrawalOperationState,
    withdrawalAction: null as OpenGameRegistrationWithdrawalAction | null,
    withdrawalActionLabel: "",
    withdrawalApplicationId: "",
    withdrawalExpectedVersion: 0,
    withdrawalKind: null as "APPLICATION_WITHDRAWAL" | "WAITLIST_WITHDRAWAL" | "GAME_EXIT" | null,
    lateExitWillBeRecorded: false,
    withdrawalConfirmationTitle: "",
    withdrawalConfirmationCopy: "",
    withdrawalConfirmationActionLabel: "",
    withdrawalCancelLabel: "保留报名",
    publicGame: null as OpenGamePublic | null,
    name: "",
    teamName: "",
    venueName: "",
    pitchSummary: "",
    orderRange: "",
    peopleSummary: "",
    capacityLabel: "",
    intensityLabel: "",
    experienceLabel: "",
    positionsLabel: "",
    aaLabel: "",
    aaSummaryLabel: "",
    deadlineLabel: "",
    notes: "",
    visibilityLabel: "",
    headerTopPx: 0,
    headerRowHeightPx: 44,
    headerHeightPx: 44,
    headerLeftInsetPx: 0,
    headerRightInsetPx: 0,
    viewerRegistrationId: "",
    reportGameId: "",
    attendanceRecordedAtLabel: "",
    attendanceCorrectedAtLabel: "",
    copyFeedbackMessage: "",
    copyFeedbackKind: "" as "" | "pending" | "success" | "error",
  };
}

Page({
  data: blankData(),
  loadGeneration: 0,
  visible: true,
  routeToken: "",
  routeGameId: "",
  boundRegistrationUserId: null as string | null,
  skipNextShow: false,
  pendingRoute: "",
  mutationInFlight: null as Promise<void> | null,
  copyGeneration: 0,

  onLoad(options: PageOptions = {}) {
    this.visible = true;
    this.skipNextShow = true;
    this.pendingRoute = "";
    this.boundRegistrationUserId = null;
    this.mutationInFlight = null;
    this.copyGeneration += 1;
    const header = readHeaderData();
    const optionKeys = Object.keys(options);
    const publicShared = optionKeys.length === 1
      && typeof options.token === "string"
      && TOKEN_PATTERN.test(options.token);
    const selfShared = optionKeys.length === 2
      && typeof options.token === "string"
      && TOKEN_PATTERN.test(options.token)
      && typeof options.game_id === "string"
      && UUID_PATTERN.test(options.game_id);
    const shared = publicShared || selfShared;
    const owner = optionKeys.length === 2
      && typeof options.game_id === "string"
      && UUID_PATTERN.test(options.game_id)
      && options.preview === "1";
    if (!shared && !owner) {
      this.routeToken = "";
      this.routeGameId = "";
      this.setData({
        ...blankData(),
        ...header,
        status: "NOT_FOUND",
        errorMessage: "链接不存在或已失效。",
      });
      return;
    }
    if (shared) {
      this.routeToken = options.token as string;
      this.routeGameId = selfShared ? options.game_id as string : "";
      this.setData({
        ...blankData(),
        ...header,
        mode: "shared",
        reportGameId: this.routeGameId,
      });
    } else {
      this.routeGameId = options.game_id as string;
      this.routeToken = "";
      this.setData({
        ...blankData(),
        ...header,
        mode: "owner",
        showReturnManage: true,
      });
    }
    void this.loadPublic();
  },

  onShow() {
    if (this.skipNextShow) {
      this.skipNextShow = false;
      return;
    }
    this.visible = true;
    if (this.routeToken || this.routeGameId) void this.loadPublic();
  },

  onHide() {
    this.visible = false;
    this.loadGeneration += 1;
    this.copyGeneration += 1;
  },

  onUnload() {
    this.visible = false;
    this.loadGeneration += 1;
    this.copyGeneration += 1;
  },

  active(generation: number): boolean {
    return this.visible && generation === this.loadGeneration;
  },

  activeShared(generation: number, userId: string | null): boolean {
    return this.active(generation)
      && this.boundRegistrationUserId === userId
      && this.currentRegistrationUserId() === userId;
  },

  async activeSharedOrResynchronize(generation: number, userId: string): Promise<boolean> {
    if (this.activeShared(generation, userId)) return true;
    if (this.active(generation)
      && this.boundRegistrationUserId === userId
      && this.currentRegistrationUserId() !== userId) await this.loadPublic();
    return false;
  },

  currentRegistrationUserId(): string | null {
    try { return getOpenGameRegistrationSource().currentUserId(); }
    catch { return null; }
  },

  async loadPublic() {
    const generation = ++this.loadGeneration;
    const registrationUserId = this.data.mode === "shared"
      ? this.currentRegistrationUserId()
      : null;
    if (this.data.mode === "shared") this.boundRegistrationUserId = registrationUserId;
    this.setData({
      status: "LOADING",
      errorMessage: "",
      navigationError: "",
      showLogin: false,
      primaryAction: null,
      pendingRoute: "",
      withdrawalOperationState: "IDLE",
    });
    try {
      if (this.data.mode === "shared") {
        const context = await readSignupContext(this.routeToken);
        if (!this.activeShared(generation, registrationUserId)) return;
        await this.applySharedContext(context);
      } else {
        const game = (await getOpenGameSource().getOwnedGame(this.routeGameId)).publicView;
        if (!this.active(generation)) return;
        this.applyPublic(game);
      }
    } catch (caught) {
      if (!this.active(generation)) return;
      if (this.data.mode === "shared"
        && (this.boundRegistrationUserId !== registrationUserId
          || (this.currentRegistrationUserId() !== registrationUserId
            && this.currentRegistrationUserId() !== null))) return;
      this.handleReadError(caught);
    }
  },

  async applySharedContext(context: OpenGameRegistrationContext) {
    this.applyPublic(context.game);
    const pending = getOpenGameRegistrationAttemptStore().load();
    if (pending === null) {
      this.applySharedPresentation(context);
      return;
    }
    const target = pending.kind === "remove-member"
      && context.managementGameId === pending.gameId
      ? { kind: "remove-member" as const, gameId: pending.gameId }
      : targetForAttempt(pending, this.routeToken);
    const decision = classifyOpenGameRegistrationPendingAttempt(
      pending,
      this.currentRegistrationUserId(),
      target,
    );
    if (decision.kind !== "READY") {
      this.presentPendingAttempt(pending);
      return;
    }
    if (decision.attempt.kind === "withdraw") {
      const recovery = classifyOpenGameRegistrationUnknownResult(decision.attempt, context);
      if (recovery.kind === "ACCEPT_AUTHORITY_AND_CLEAR") {
        if (!this.clearAttemptIfCurrent(decision.attempt)) {
          this.presentDurableAttempt(context);
          return;
        }
        this.applySharedPresentation(recovery.authority);
      } else {
        this.presentWithdrawalUnknown(context, "上次操作没有返回结果，请读取权威状态确认。");
      }
      return;
    }
    if (decision.attempt.kind === "remove-member"
      || decision.attempt.kind === "allow-reapply") {
      await this.recoverRosterManagementAttempt(decision.attempt, context, true);
      return;
    }
    if (decision.attempt.kind !== "apply") {
      this.presentPendingAttempt(pending);
      return;
    }
    const recovery = classifyOpenGameRegistrationUnknownResult(decision.attempt, context);
    if (recovery.kind === "ACCEPT_AUTHORITY_AND_CLEAR") {
      if (!this.clearAttemptIfCurrent(decision.attempt)) {
        this.presentDurableAttempt(context);
        return;
      }
      this.applySharedPresentation(recovery.authority);
      return;
    }
    this.setData({
      status: "RESULT_UNKNOWN",
      primaryAction: "CONFIRM_RESULT",
      statusHeading: "申请结果暂时未知",
      statusDescription: "请使用原提交记录继续确认，不会生成第二次申请。",
      statusTone: "pending",
      errorMessage: "检测到原申请结果尚未确认。",
    });
  },

  applySharedPresentation(context: OpenGameRegistrationContext) {
    this.copyGeneration += 1;
    this.applyPublic(context.game);
    const presentation = registrationPresentation(context);
    const registration = context.viewerRegistration;
    const availableAction = registration?.availableWithdrawalAction ?? null;
    const action: OpenGameRegistrationWithdrawalAction | null = registration?.effectiveStatus === "APPLIED"
      && availableAction === "WITHDRAW_APPLICATION"
      ? availableAction
      : registration?.effectiveStatus === "WAITLISTED"
        && availableAction === "WITHDRAW_WAITLIST"
        ? availableAction
        : registration?.effectiveStatus === "JOINED" && availableAction === "LEAVE_GAME"
          ? availableAction
          : null;
    const applicationWithdrawal = action === "WITHDRAW_APPLICATION";
    const waitlistWithdrawal = action === "WITHDRAW_WAITLIST";
    const joinedCount = context.joinedCount
      ?? Math.max(0, context.game.openSpots - context.remainingSpots);
    const waitlistCount = context.waitlistCount ?? 0;
    const joinedMembers = context.joinedMembers ?? [];
    const waitlistedMembers = context.waitlistedMembers ?? [];
    const blockedMembers = context.blockedMembers ?? [];
    const managementGameId = context.managementGameId ?? "";
    const rosterPrivate = !context.viewerAuthenticated
      || context.joinedMembers === null
      || context.waitlistedMembers === null;
    this.pendingRoute = "";
    this.setData({
      status: "READY",
      primaryAction: presentation.action,
      registrationStatus: presentation.registrationStatus,
      remainingSpots: context.remainingSpots,
      viewerAuthenticated: context.viewerAuthenticated,
      joinedCount,
      waitlistCount,
      publicOpenSpots: context.game.openSpots,
      totalPlayers: context.game.totalPlayers,
      fixedPlayers: context.game.fixedPlayers,
      signupProgressLabel: `公开报名 ${joinedCount} / ${context.game.openSpots}`,
      waitlistCountLabel: `候补 ${waitlistCount} 人`,
      planCountLabel: `计划 ${context.game.totalPlayers} 人，其中固定队员 ${context.game.fixedPlayers} 人`,
      signupActionLabel: context.remainingSpots === 0 ? "加入候补" : "确认报名",
      signupSubmitting: false,
      rosterPrivate,
      joinedMembers: rosterPrivate ? [] : joinedMembers.map(presentRosterMember),
      waitlistedMembers: rosterPrivate ? [] : waitlistedMembers.map(presentRosterMember),
      blockedMembers: managementGameId
        ? blockedMembers.map(presentRosterMember)
        : [],
      managementGameId,
      isCaptain: Boolean(managementGameId),
      managementActionInFlight: false,
      managementError: "",
      profileActionVisible: context.viewerAuthenticated,
      profileSheetState: "CLOSED",
      profileAvatarTempPath: "",
      profileError: "",
      applyBlockedReason: context.allowedActions.applyBlockedReason,
      statusHeading: presentation.heading,
      statusDescription: presentation.description,
      statusTone: presentation.tone,
      showLogin: presentation.action === "LOGIN",
      showReturnManage: false,
      pendingRoute: "",
      errorMessage: "",
      withdrawalOperationState: "IDLE",
      withdrawalAction: action,
      withdrawalActionLabel: withdrawalLabel(action),
      withdrawalApplicationId: registration?.id ?? "",
      withdrawalExpectedVersion: registration?.version ?? 0,
      withdrawalKind: registration?.withdrawalKind ?? null,
      lateExitWillBeRecorded: registration?.lateExitWillBeRecorded ?? false,
      viewerRegistrationId: registration?.id ?? "",
      reportGameId: registration !== null && UUID_PATTERN.test(this.routeGameId)
        ? this.routeGameId
        : "",
      attendanceRecordedAtLabel: attendanceAuthorityTimeLabel(
        "原记录 ·",
        registration?.attendanceRecordedAt,
        context.game.timeZone,
      ),
      attendanceCorrectedAtLabel: attendanceAuthorityTimeLabel(
        "平台已纠正于",
        registration?.attendanceCorrectedAt,
        context.game.timeZone,
      ),
      copyFeedbackMessage: "",
      copyFeedbackKind: "",
      withdrawalConfirmationTitle: applicationWithdrawal
        ? "确认撤回申请？"
        : waitlistWithdrawal ? "确认退出候补？" : "确认退出球局？",
      withdrawalConfirmationCopy: applicationWithdrawal
        ? "撤回后队长无需再审核；重新报名将按提交时的实时名额进入正式名单或候补队尾。"
        : waitlistWithdrawal
          ? "退出后将从当前候补队列移除；重新报名会排到候补队尾。"
          : "退出后会释放你的正式席位；如有候补，将按 FIFO 顺序自动递补。之后仍可重新报名。",
      withdrawalConfirmationActionLabel: applicationWithdrawal ? "确认撤回" : "确认退出",
      withdrawalCancelLabel: waitlistWithdrawal ? "继续候补" : "保留报名",
    });
    this.writeBackRegistration(context);
  },

  presentWithdrawalUnknown(context: OpenGameRegistrationContext, message: string) {
    this.applySharedPresentation(context);
    this.setData({
      status: "READY",
      primaryAction: "CONFIRM_WITHDRAW_RESULT",
      withdrawalOperationState: "RESULT_UNKNOWN",
      statusHeading: "退出结果待确认",
      statusDescription: message,
      statusTone: "pending",
      errorMessage: message,
    });
  },

  writeBackRegistration(context: OpenGameRegistrationContext) {
    const userId = this.boundRegistrationUserId;
    const registration = context.viewerRegistration;
    if (userId === null
      || registration === null
      || this.currentRegistrationUserId() !== userId) return;
    const pages = currentPages();
    const previous = pages[pages.length - 2];
    if (previous?.route !== "pages/my-game-registrations/index"
      || typeof previous.applyRegistrationAuthority !== "function") return;
    previous.applyRegistrationAuthority({
      originatingUserId: userId,
      registrationId: registration.id,
      effectiveStatus: registration.effectiveStatus,
      waitlistPosition: registration.waitlistPosition,
      waitlistedAt: registration.waitlistedAt,
      promotedAt: registration.promotedAt,
      attendanceStatus: registration.attendanceStatus,
      attendanceRecordedAt: registration.attendanceRecordedAt,
      attendanceCorrectedAt: registration.attendanceCorrectedAt,
    });
  },

  onCopyRegistrationId() {
    const registrationId = this.data.viewerRegistrationId;
    if (this.data.mode !== "shared"
      || typeof registrationId !== "string"
      || !UUID_PATTERN.test(registrationId)) return;
    const generation = ++this.copyGeneration;
    this.setData({ copyFeedbackMessage: "正在复制…", copyFeedbackKind: "pending" });
    const settle = (message: string, kind: "success" | "error") => {
      if (!this.visible
        || generation !== this.copyGeneration
        || this.data.viewerRegistrationId !== registrationId) return;
      this.setData({ copyFeedbackMessage: message, copyFeedbackKind: kind });
    };
    try {
      wx.setClipboardData({
        data: registrationId,
        success: () => settle("报名编号已复制", "success"),
        fail: () => settle("复制失败，请重试", "error"),
      });
    } catch {
      settle("复制失败，请重试", "error");
    }
  },

  onOpenGameReport() {
    const gameId = this.data.reportGameId;
    if (this.data.mode !== "shared"
      || typeof this.data.viewerRegistrationId !== "string"
      || !UUID_PATTERN.test(this.data.viewerRegistrationId)
      || typeof gameId !== "string"
      || !UUID_PATTERN.test(gameId)) return Promise.resolve();
    this.setData({ navigationError: "" });
    return navigation("navigateTo", `/pages/open-game-report/index?game_id=${gameId}`)
      .catch(() => {
        if (!this.visible || this.data.reportGameId !== gameId) return;
        this.setData({ navigationError: "暂时无法打开举报页，请重试。" });
      });
  },

  applyPublic(game: OpenGamePublic) {
    const publicGame = presentOpenGamePublic(game);
    this.setData({
      status: "READY",
      state: publicGame.state,
      stateLabel: openGameStateLabel(publicGame.state),
      stateReasonText: openGameStateReasonLabel(publicGame.stateReason),
      publicGame,
      publicOpenSpots: publicGame.openSpots,
      totalPlayers: publicGame.totalPlayers,
      fixedPlayers: publicGame.fixedPlayers,
      showLogin: false,
      showReturnManage: this.data.mode === "owner",
      errorMessage: "",
      name: publicGame.name,
      teamName: publicGame.teamName,
      venueName: publicGame.venueName,
      pitchSummary: publicGame.pitchName + " · " + publicGame.pitchSpecification,
      orderRange: formatOpenGameRange(
        publicGame.startsAt,
        publicGame.endsAt,
        publicGame.timeZone,
      ),
      peopleSummary: "计划 " + publicGame.totalPlayers + " 人 · 固定 "
        + publicGame.fixedPlayers + " 人 · 开放 " + publicGame.openSpots + " 人",
      capacityLabel: "计划 " + publicGame.totalPlayers + " 人",
      intensityLabel: openGameIntensityLabel(publicGame.intensity),
      experienceLabel: publicGame.minimumExperience || "无最低经验要求",
      positionsLabel: publicGame.positions.map(openGamePositionLabel).join("、"),
      aaLabel: formatCents(publicGame.aaCents),
      aaSummaryLabel: "预计 " + formatCents(publicGame.aaCents) + " / 人",
      deadlineLabel: formatOpenGameDateTime(
        publicGame.registrationDeadline,
        publicGame.timeZone,
      ),
      notes: publicGame.equipmentAndArrivalNotes || "无额外说明",
      visibilityLabel: publicGame.visibility === "PUBLIC" ? "公开可见" : "仅链接可见",
    });
  },

  handleReadError(caught: unknown) {
    if (this.data.mode === "shared") {
      if (caught instanceof OpenGameRegistrationApiError
        && caught.code === "OPEN_GAME_NOT_FOUND") {
        this.clearOwnedRouteAttempt();
        this.setData({
          status: "NOT_FOUND",
          primaryAction: null,
          showLogin: false,
          errorMessage: "链接不存在或已失效。",
        });
      } else if (caught instanceof OpenGameRegistrationApiError
        && caught.code === "AUTH_REQUIRED") {
        this.setData({
          status: "AUTH_LOSS",
          primaryAction: "LOGIN",
          showLogin: true,
          errorMessage: "登录状态已失效，请重新登录并读取同一球局。",
        });
      } else {
        this.setData({
          status: "LOAD_ERROR",
          primaryAction: null,
          showLogin: false,
          errorMessage: "暂时无法加载球局，请稍后重试。",
        });
      }
      return;
    }
    if (caught instanceof OpenGameApiError && caught.code === "OPEN_GAME_NOT_FOUND") {
      this.setData({
        status: "NOT_FOUND",
        showLogin: false,
        errorMessage: "链接不存在或已失效。",
      });
    } else if (caught instanceof OpenGameApiError && caught.code === "AUTH_REQUIRED") {
      this.setData({
        status: "AUTH_LOSS",
        showLogin: true,
        errorMessage: "登录状态已失效，请重新登录。",
      });
    } else {
      this.setData({
        status: "LOAD_ERROR",
        showLogin: false,
        errorMessage: "暂时无法加载球局，请稍后重试。",
      });
    }
  },

  clearOwnedRouteAttempt() {
    try {
      const attempt = getOpenGameRegistrationAttemptStore().load();
      const userId = this.currentRegistrationUserId();
      if (attempt?.kind === "apply"
        && attempt.shareToken === this.routeToken
        && attempt.originatingUserId === userId) {
        getOpenGameRegistrationAttemptStore().clear();
      }
    } catch {
      // A local cleanup failure must not replace the definitive server 404.
    }
  },

  runSingleFlight(action: () => Promise<void>): Promise<void> {
    if (this.mutationInFlight !== null) return this.mutationInFlight;
    const promise = action().finally(() => {
      if (this.mutationInFlight === promise) this.mutationInFlight = null;
    });
    this.mutationInFlight = promise;
    return promise;
  },

  onRetry() {
    return this.runSingleFlight(async () => {
      this.visible = true;
      await this.loadPublic();
    });
  },

  onLogin() {
    return this.runSingleFlight(async () => {
      const generation = this.loadGeneration;
      try {
        if (this.data.mode === "owner") {
          await getOpenGameSource().login();
        } else {
          const userId = await getOpenGameRegistrationSource().login();
          if (!this.active(generation)) return;
          const pending = getOpenGameRegistrationAttemptStore().load();
          if (pending !== null && pending.originatingUserId !== userId) {
            this.setData({
              status: "FOREIGN_PENDING",
              primaryAction: "CLEAR_PENDING",
              showLogin: false,
              errorMessage: "登录账号与原操作账号不同，绝不会重放原操作。",
            });
            return;
          }
        }
        if (this.active(generation)) await this.loadPublic();
      } catch {
        if (!this.active(generation)) return;
        this.setData({
          status: "AUTH_LOSS",
          primaryAction: this.data.mode === "shared" ? "LOGIN" : null,
          showLogin: true,
          errorMessage: "登录失败，请重试；本机待确认记录仍保留。",
        });
      }
    });
  },

  onApply() {
    if (this.data.mode !== "shared" || this.data.primaryAction !== "APPLY") {
      return Promise.resolve();
    }
    return this.runSingleFlight(async () => {
      const source = getOpenGameRegistrationSource();
      if (typeof source.getPublicProfile !== "function") {
        this.setData({ navigationError: "当前版本暂不支持报名资料，请稍后重试。" });
        return;
      }
      try {
        const profile = await source.getPublicProfile();
        this.openProfileSheet("SIGNUP", profile);
      } catch {
        this.setData({ navigationError: "暂时无法读取公开资料，请重试。" });
      }
    });
  },

  openProfileSheet(purpose: ProfilePurpose, profile: OpenGamePublicProfile | null) {
    const signupLabel = this.data.remainingSpots === 0 ? "加入候补" : "确认报名";
    const nickname = profile?.nickname ?? "微信用户";
    this.setData({
      profileSheetState: "EDITING",
      profilePurpose: purpose,
      profileSheetTitle: purpose === "SIGNUP" ? "确认报名" : "更新公开资料",
      profileSubmitLabel: purpose === "SIGNUP" ? signupLabel : "保存资料",
      profileNickname: nickname,
      profileAvatarPreview: profile?.avatarUrl ?? "",
      profileAvatarFallback: rosterFallback(nickname),
      profileExistingAvatarUrl: profile?.avatarUrl ?? "",
      profileAvatarTempPath: "",
      profileError: "",
      adultConfirmed: false,
      riskConfirmed: false,
      navigationError: "",
    });
  },

  onEditProfile() {
    if (this.data.mode !== "shared" || !this.data.profileActionVisible) {
      return Promise.resolve();
    }
    return this.runSingleFlight(async () => {
      const source = getOpenGameRegistrationSource();
      if (typeof source.getPublicProfile !== "function") {
        this.setData({ navigationError: "当前版本暂不支持更新公开资料。" });
        return;
      }
      try {
        this.openProfileSheet("UPDATE", await source.getPublicProfile());
      } catch {
        this.setData({ navigationError: "暂时无法读取公开资料，请重试。" });
      }
    });
  },

  onProfileAvatarChosen(event: { readonly detail?: { readonly avatarUrl?: unknown } }) {
    if (this.data.profileSheetState !== "EDITING") return;
    const tempFilePath = event?.detail?.avatarUrl;
    if (typeof tempFilePath !== "string" || tempFilePath.length === 0) {
      this.setData({ profileError: "没有读取到头像，请重新选择。" });
      return;
    }
    this.setData({
      profileAvatarTempPath: tempFilePath,
      profileAvatarPreview: tempFilePath,
      profileError: "",
    });
  },

  onProfileNicknameInput(event: { readonly detail?: { readonly value?: unknown } }) {
    if (this.data.profileSheetState !== "EDITING") return;
    const value = event?.detail?.value;
    const nickname = typeof value === "string" ? value : "";
    this.setData({
      profileNickname: nickname,
      profileAvatarFallback: rosterFallback(nickname),
      profileError: "",
    });
  },

  onSignupConfirmationsChange(event: {
    readonly detail?: { readonly value?: unknown };
  }) {
    if (this.data.profileSheetState !== "EDITING" || this.data.profilePurpose !== "SIGNUP") {
      return;
    }
    const values = Array.isArray(event?.detail?.value)
      ? event.detail.value.filter((value): value is string => typeof value === "string")
      : [];
    this.setData({
      adultConfirmed: values.includes("adult"),
      riskConfirmed: values.includes("risk"),
      profileError: "",
    });
  },

  onCancelProfile() {
    if (this.data.profileSheetState !== "EDITING") return;
    this.setData({
      profileSheetState: "CLOSED",
      profileError: "",
      adultConfirmed: false,
      riskConfirmed: false,
    });
  },

  onConfirmProfile() {
    if (this.mutationInFlight !== null) return this.mutationInFlight;
    if (this.data.mode !== "shared" || this.data.profileSheetState !== "EDITING") {
      return Promise.resolve();
    }
    return this.runSingleFlight(async () => {
      const purpose = this.data.profilePurpose;
      let signupConfirmations: SignupConfirmations | null = null;
      if (purpose === "SIGNUP") {
        const adultConfirmed = this.data.adultConfirmed === true;
        const riskConfirmed = this.data.riskConfirmed === true;
        if (!adultConfirmed || !riskConfirmed) {
          this.setData({ profileError: "请先完成成人与运动风险确认。" });
          return;
        }
        signupConfirmations = { adultConfirmed, riskConfirmed };
      }
      const nickname = this.data.profileNickname.trim();
      const nicknameLength = Array.from(nickname).length;
      if (nicknameLength < 1 || nicknameLength > 24) {
        this.setData({ profileError: "昵称需为 1–24 个字符。" });
        return;
      }
      const source = getOpenGameRegistrationSource();
      const selectedAvatarTempPath = this.data.profileAvatarTempPath;
      const uploadAvatar = source.uploadPublicProfileAvatar;
      if (typeof source.savePublicProfile !== "function"
        || (selectedAvatarTempPath && typeof uploadAvatar !== "function")) {
        this.setData({ profileError: "当前版本暂不支持保存公开资料。" });
        return;
      }
      this.setData({ profileSheetState: "SUBMITTING", profileError: "" });
      try {
        const uploaded = selectedAvatarTempPath
          ? await uploadAvatar!(selectedAvatarTempPath)
          : null;
        const profile = await source.savePublicProfile({
          nickname,
          avatarObjectKey: uploaded?.objectKey ?? null,
        });
        this.setData({
          profileNickname: profile.nickname,
          profileAvatarPreview: signupConfirmations !== null && selectedAvatarTempPath
            ? selectedAvatarTempPath
            : profile.avatarUrl ?? "",
          profileAvatarFallback: rosterFallback(profile.nickname),
          profileExistingAvatarUrl: profile.avatarUrl ?? "",
          profileAvatarTempPath: signupConfirmations !== null ? selectedAvatarTempPath : "",
          profileSheetState: "CLOSED",
        });
        if (signupConfirmations !== null) {
          await this.submitSignup(profile.nickname, signupConfirmations);
        }
        else await this.loadPublic();
      } catch {
        this.setData({
          profileSheetState: "EDITING",
          profileError: "资料保存失败，请检查网络后重试。",
        });
      }
    });
  },

  async submitSignup(nickname: string, confirmations: SignupConfirmations) {
    const userId = this.boundRegistrationUserId;
    if (userId === null || this.currentRegistrationUserId() !== userId) {
      await this.loadPublic();
      return;
    }
    const requested: OpenGameRegistrationApplyAttempt = {
      kind: "apply",
      originatingUserId: userId,
      shareToken: this.routeToken,
      submissionMode: "DIRECT_REGISTRATION",
      body: {
        displayName: nickname,
        position: "ANY",
        note: null,
        adultConfirmed: confirmations.adultConfirmed,
        riskConfirmed: confirmations.riskConfirmed,
      },
      idempotencyKey: `signup-${Date.now()}-${String(++signupAttemptSerial).padStart(6, "0")}`,
    };
    let availability;
    try {
      availability = getOpenGameRegistrationAttemptStore().begin(requested);
    } catch {
      this.setData({ navigationError: "无法安全保存报名记录，本次报名尚未发送。" });
      return;
    }
    if (availability.kind !== "READY" || availability.attempt.kind !== "apply") {
      this.presentPendingAttempt(availability.attempt);
      return;
    }
    const attempt = availability.attempt;
    const generation = this.loadGeneration;
    this.setData({ signupSubmitting: true, primaryAction: "APPLY", navigationError: "" });
    try {
      const context = await createSignupRegistration(attempt);
      if (!await this.activeSharedOrResynchronize(generation, userId)) return;
      if (!this.clearAttemptIfCurrent(attempt)) {
        this.presentDurableAttempt(context);
        return;
      }
      this.applySharedPresentation(context);
    } catch (caught) {
      if (!this.active(generation)) return;
      await this.handleRecoveryError(attempt, caught, generation);
    }
  },

  onRosterAvatarError(event: {
    readonly currentTarget?: { readonly dataset?: { readonly group?: unknown; readonly index?: unknown } };
  }) {
    const group = event?.currentTarget?.dataset?.group;
    const index = Number(event?.currentTarget?.dataset?.index);
    if ((group !== "joinedMembers" && group !== "waitlistedMembers" && group !== "blockedMembers")
      || !Number.isSafeInteger(index) || index < 0) return;
    const rows = [...(this.data[group] as readonly RosterRow[])];
    if (!rows[index]) return;
    rows[index] = { ...rows[index], avatarUrl: "" };
    this.setData({ [group]: rows });
  },

  onRemoveRosterMember(event: {
    readonly currentTarget?: { readonly dataset?: Record<string, unknown> };
  }) {
    if (this.data.mode !== "shared" || !this.data.isCaptain) return Promise.resolve();
    const dataset = event?.currentTarget?.dataset ?? {};
    const registrationId = dataset.registrationId;
    const version = Number(dataset.version);
    const nickname = typeof dataset.nickname === "string" ? dataset.nickname : "该成员";
    if (typeof registrationId !== "string" || !UUID_PATTERN.test(registrationId)
      || !Number.isSafeInteger(version) || version < 1) return Promise.resolve();
    return this.runSingleFlight(async () => {
      const confirmed = await confirmAction(
        `确认移除${nickname}？`,
        "移除后该成员将不能自动重新报名；如需恢复，请在已移除名单中另行允许。",
        "确认移除",
      );
      if (!confirmed) return;
      const userId = this.boundRegistrationUserId;
      const gameId = this.data.managementGameId;
      if (userId === null || this.currentRegistrationUserId() !== userId
        || typeof gameId !== "string" || !UUID_PATTERN.test(gameId)) {
        await this.loadPublic();
        return;
      }
      const attempt: OpenGameMemberRemoveAttempt = {
        kind: "remove-member",
        originatingUserId: userId,
        gameId,
        registrationId,
        expectedVersion: version,
        reason: "队长在报名接龙中移除",
        idempotencyKey: `roster-remove-${Date.now()}-${++managementAttemptSerial}`,
      };
      let availability;
      try {
        availability = getOpenGameRegistrationAttemptStore().begin(attempt);
      } catch {
        this.setData({
          managementActionInFlight: false,
          managementError: "无法安全保存移除记录，本次操作尚未发送。",
        });
        return;
      }
      if (availability.kind !== "READY" || availability.attempt.kind !== "remove-member") {
        this.presentPendingAttempt(availability.attempt);
        return;
      }
      await this.executeRosterManagementAttempt(availability.attempt, true);
    });
  },

  onAllowMemberReapply(event: {
    readonly currentTarget?: { readonly dataset?: Record<string, unknown> };
  }) {
    if (this.data.mode !== "shared" || !this.data.isCaptain) return Promise.resolve();
    const dataset = event?.currentTarget?.dataset ?? {};
    const registrationId = dataset.registrationId;
    const version = Number(dataset.version);
    const nickname = typeof dataset.nickname === "string" ? dataset.nickname : "该成员";
    if (typeof registrationId !== "string" || !UUID_PATTERN.test(registrationId)
      || !Number.isSafeInteger(version) || version < 1) return Promise.resolve();
    return this.runSingleFlight(async () => {
      const confirmed = await confirmAction(
        `允许${nickname}重新报名？`,
        "此操作只解除报名限制，不会自动把该成员加入正式名单或候补。",
        "允许重报",
      );
      if (!confirmed) return;
      const userId = this.boundRegistrationUserId;
      const gameId = this.data.managementGameId;
      const source = getOpenGameRegistrationSource();
      if (userId === null || this.currentRegistrationUserId() !== userId
        || typeof gameId !== "string" || !UUID_PATTERN.test(gameId)
        || typeof source.allowMemberReapply !== "function") {
        this.setData({ managementError: "当前状态不支持解除报名限制。" });
        return;
      }
      const requested: OpenGameAllowMemberReapplyAttempt = {
        kind: "allow-reapply",
        originatingUserId: userId,
        shareToken: this.routeToken,
        gameId,
        registrationId,
        expectedVersion: version,
        idempotencyKey: `allow-reapply-${Date.now()}-${++managementAttemptSerial}`,
      };
      let availability;
      try {
        availability = getOpenGameRegistrationAttemptStore().begin(requested);
      } catch {
        this.setData({
          managementActionInFlight: false,
          managementError: "无法安全保存解除限制记录，本次操作尚未发送。",
        });
        return;
      }
      if (availability.kind !== "READY" || availability.attempt.kind !== "allow-reapply") {
        this.presentPendingAttempt(availability.attempt);
        return;
      }
      await this.executeRosterManagementAttempt(availability.attempt, true);
    });
  },

  async executeRosterManagementAttempt(
    attempt: OpenGameRosterManagementAttempt,
    recoverUnknown: boolean,
    authority?: OpenGameRegistrationContext,
  ) {
    const userId = this.boundRegistrationUserId;
    if (userId !== attempt.originatingUserId || this.currentRegistrationUserId() !== userId) {
      await this.loadPublic();
      return;
    }
    const source = getOpenGameRegistrationSource();
    if (attempt.kind === "allow-reapply" && typeof source.allowMemberReapply !== "function") {
      this.presentRosterManagementUnknown(
        authority,
        "当前版本暂不能确认解除限制结果，原操作记录已保留。",
      );
      return;
    }
    this.setData({ managementActionInFlight: true, managementError: "" });
    try {
      if (attempt.kind === "remove-member") await source.removeMember(attempt);
      else await source.allowMemberReapply!(attempt);
      if (this.currentRegistrationUserId() !== attempt.originatingUserId) {
        await this.loadPublic();
        return;
      }
      if (!this.clearAttemptIfCurrent(attempt)) {
        this.presentDurableAttempt();
        return;
      }
      await this.loadPublic();
    } catch (caught) {
      const unknown = !(caught instanceof OpenGameRegistrationApiError)
        || caught.code === "APPLICATION_RESULT_UNKNOWN"
        || caught.code === "SERVICE_UNAVAILABLE";
      if (unknown) {
        if (recoverUnknown) await this.recoverRosterManagementAttempt(attempt, undefined, true);
        else this.presentRosterManagementUnknown(
          authority,
          "操作结果待确认，原操作记录已保留；刷新页面会先核对名单。",
        );
        return;
      }
      if (caught.code === "AUTH_REQUIRED" || caught.code === "LOGIN_FAILED") {
        this.presentRosterManagementUnknown(
          authority,
          "登录状态需要恢复，原操作记录已保留。",
        );
        return;
      }
      if (!this.clearAttemptIfCurrent(attempt)) {
        this.presentDurableAttempt();
        return;
      }
      await this.loadPublic();
    }
  },

  async recoverRosterManagementAttempt(
    attempt: OpenGameRosterManagementAttempt,
    knownAuthority?: OpenGameRegistrationContext,
    replayUnchanged = true,
  ) {
    let authority = knownAuthority;
    if (authority === undefined) {
      const generation = this.loadGeneration;
      try {
        authority = await readSignupContext(this.routeToken);
      } catch {
        this.presentRosterManagementUnknown(
          undefined,
          "暂时无法读取权威名单，原操作结果待确认。",
        );
        return;
      }
      if (!this.activeShared(generation, attempt.originatingUserId)) return;
    }
    const recovery = classifyOpenGameRosterManagementUnknownResult(attempt, authority);
    if (recovery.kind === "ACCEPT_AUTHORITY_AND_CLEAR") {
      if (!this.clearAttemptIfCurrent(attempt)) {
        this.presentDurableAttempt(authority);
        return;
      }
      this.applySharedPresentation(recovery.authority);
      return;
    }
    if (recovery.kind === "REPLAY_SAME_ATTEMPT" && replayUnchanged) {
      await this.executeRosterManagementAttempt(recovery.attempt, false, authority);
      return;
    }
    this.presentRosterManagementUnknown(
      authority,
      "操作结果待确认，原操作记录已保留；刷新页面会先核对名单。",
    );
  },

  presentRosterManagementUnknown(
    authority: OpenGameRegistrationContext | undefined,
    message: string,
  ) {
    if (authority !== undefined) this.applySharedPresentation(authority);
    this.setData({
      managementActionInFlight: false,
      managementError: message,
    });
  },

  onRefresh() {
    if (this.data.mode !== "shared" || this.data.primaryAction !== "REFRESH") {
      return Promise.resolve();
    }
    return this.runSingleFlight(async () => { await this.loadPublic(); });
  },

  onConfirmResult() {
    if (this.data.mode !== "shared") return Promise.resolve();
    return this.runSingleFlight(async () => { await this.confirmResult(); });
  },

  async confirmResult() {
    let attempt: OpenGameRegistrationAttempt | null;
    try {
      attempt = getOpenGameRegistrationAttemptStore().load();
    } catch {
      this.setData({
        status: "RESULT_UNKNOWN",
        primaryAction: "CONFIRM_RESULT",
        errorMessage: "暂时无法读取本机待确认记录，请稍后重试。",
      });
      return;
    }
    if (attempt === null) {
      await this.loadPublic();
      return;
    }
    const pending = classifyOpenGameRegistrationPendingAttempt(
      attempt,
      this.currentRegistrationUserId(),
      { kind: "apply", shareToken: this.routeToken },
    );
    if (pending.kind !== "READY" || pending.attempt.kind !== "apply") {
      this.presentPendingAttempt(attempt);
      return;
    }
    const generation = this.loadGeneration;
    this.setData({
      status: "RESULT_UNKNOWN",
      primaryAction: null,
      errorMessage: "正在读取权威申请结果…",
    });
    try {
      const context = await readSignupContext(
        pending.attempt.shareToken,
      );
      if (!this.active(generation)) return;
      const durable = getOpenGameRegistrationAttemptStore().load();
      if (durable === null) {
        if (context.viewerRegistration !== null) {
          this.applySharedPresentation(context);
        } else {
          this.applyPublic(context.game);
          this.setData({
            status: "RESULT_UNKNOWN",
            primaryAction: null,
            registrationStatus: "NONE",
            errorMessage: "本机待确认记录已变化，没有发送新的申请。",
          });
        }
        return;
      }
      const durableDecision = classifyOpenGameRegistrationPendingAttempt(
        durable,
        this.currentRegistrationUserId(),
        { kind: "apply", shareToken: this.routeToken },
      );
      if (durableDecision.kind !== "READY"
        || durableDecision.attempt.kind !== "apply"
        || !sameApplyAttempt(durableDecision.attempt, pending.attempt)) {
        this.presentPendingAttempt(durable);
        return;
      }
      const recovery = classifyOpenGameRegistrationUnknownResult(
        durableDecision.attempt,
        context,
      );
      if (recovery.kind === "ACCEPT_AUTHORITY_AND_CLEAR") {
        if (!this.clearAttemptIfCurrent(durableDecision.attempt)) {
          this.presentDurableAttempt(context);
          return;
        }
        this.applySharedPresentation(recovery.authority);
        return;
      }
      const result = await createSignupRegistration(
        recovery.attempt as OpenGameRegistrationApplyAttempt,
      );
      if (!this.active(generation)) return;
      if (!this.clearAttemptIfCurrent(durableDecision.attempt)) {
        this.presentDurableAttempt(result);
        return;
      }
      this.applySharedPresentation(result);
    } catch (caught) {
      if (!this.active(generation)) return;
      await this.handleRecoveryError(pending.attempt, caught, generation);
    }
  },

  async handleRecoveryError(
    attempt: OpenGameRegistrationApplyAttempt,
    caught: unknown,
    generation: number,
  ) {
    if (!(caught instanceof OpenGameRegistrationApiError)) {
      this.setData({
        status: "RESULT_UNKNOWN",
        primaryAction: "CONFIRM_RESULT",
        errorMessage: "申请结果暂时未知，请稍后继续确认。",
      });
      return;
    }
    const decision = classifyOpenGameRegistrationMutationResult(caught.code);
    if (decision.kind === "PRESERVE_LOGIN_COMPARE_ACCOUNT") {
      this.setData({
        status: "AUTH_LOSS",
        primaryAction: "LOGIN",
        showLogin: true,
        errorMessage: "请恢复原账号后继续确认申请结果。",
      });
      return;
    }
    if (decision.kind === "PRESERVE_READ_CONTEXT_THEN_CLEAR") {
      await this.resolveAlreadyExists(attempt, generation);
      return;
    }
    if (!decision.clearAttempt) {
      this.setData({
        status: "RESULT_UNKNOWN",
        primaryAction: "CONFIRM_RESULT",
        errorMessage: "申请结果暂时未知，请稍后继续确认。",
      });
      return;
    }
    if (!this.clearAttemptIfCurrent(attempt)) {
      this.presentDurableAttempt();
      return;
    }
    if (decision.kind === "CLEAR_AND_REOPEN_PROFILE") {
      await this.refreshAndReopenSignupProfile(caught.code);
      return;
    }
    if (decision.kind === "CLEAR_AND_RETURN") {
      this.setData({
        status: "NOT_FOUND",
        primaryAction: null,
        errorMessage: "球局已不可用，本次申请无法继续确认。",
      });
      return;
    }
    if (decision.kind === "CLEAR_AND_REFRESH_CONTEXT") {
      await this.loadPublic();
      return;
    }
    this.setData({
      status: "LOAD_ERROR",
      primaryAction: null,
      errorMessage: "本机待确认记录已失效，请重新读取球局。",
    });
  },

  async refreshAndReopenSignupProfile(
    reason: "PUBLIC_PROFILE_REQUIRED" | "PUBLIC_PROFILE_CHANGED",
  ) {
    const userId = this.boundRegistrationUserId;
    const localNickname = this.data.profileNickname;
    const localAvatarTempPath = this.data.profileAvatarTempPath;
    const localAvatarPreview = this.data.profileAvatarPreview;
    await this.loadPublic();
    if (userId === null
      || !this.visible
      || this.data.mode !== "shared"
      || this.boundRegistrationUserId !== userId
      || this.currentRegistrationUserId() !== userId
      || this.data.status !== "READY"
      || this.data.primaryAction !== "APPLY") return;
    const source = getOpenGameRegistrationSource();
    if (typeof source.getPublicProfile !== "function") {
      this.setData({ navigationError: "当前版本暂不支持刷新公开资料。" });
      return;
    }
    try {
      const profile = await source.getPublicProfile();
      if (!this.visible
        || this.boundRegistrationUserId !== userId
        || this.currentRegistrationUserId() !== userId) return;
      this.openProfileSheet("SIGNUP", profile);
      this.setData({
        profileNickname: localNickname,
        profileAvatarFallback: rosterFallback(localNickname),
        ...(localAvatarTempPath
          ? {
            profileAvatarTempPath: localAvatarTempPath,
            profileAvatarPreview: localAvatarPreview,
          }
          : {}),
        profileError: reason === "PUBLIC_PROFILE_CHANGED"
          ? "公开资料已在其他设备更新，请重新确认后报名。"
          : "公开资料不完整，请重新确认后报名。",
      });
    } catch {
      this.setData({ navigationError: "暂时无法刷新公开资料，请稍后重新报名。" });
    }
  },

  async resolveAlreadyExists(
    attempt: OpenGameRegistrationApplyAttempt,
    generation: number,
  ) {
    try {
      const context = await readSignupContext(attempt.shareToken);
      if (!this.active(generation)) return;
      const durable = getOpenGameRegistrationAttemptStore().load();
      if (durable === null) {
        if (context.viewerRegistration !== null) this.applySharedPresentation(context);
        else {
          this.applyPublic(context.game);
          this.setData({
            status: "RESULT_UNKNOWN",
            primaryAction: null,
            registrationStatus: "NONE",
            errorMessage: "本机待确认记录已变化，没有发送新的申请。",
          });
        }
        return;
      }
      const pending = classifyOpenGameRegistrationPendingAttempt(
        durable,
        this.currentRegistrationUserId(),
        { kind: "apply", shareToken: this.routeToken },
      );
      if (pending.kind !== "READY"
        || pending.attempt.kind !== "apply"
        || !sameApplyAttempt(pending.attempt, attempt)) {
        this.presentPendingAttempt(durable);
        return;
      }
      const recovery = classifyOpenGameRegistrationUnknownResult(pending.attempt, context);
      if (recovery.kind === "ACCEPT_AUTHORITY_AND_CLEAR") {
        if (!this.clearAttemptIfCurrent(pending.attempt)) {
          this.presentDurableAttempt(context);
          return;
        }
        this.applySharedPresentation(recovery.authority);
        return;
      }
      this.setData({
        status: "RESULT_UNKNOWN",
        primaryAction: "CONFIRM_RESULT",
        errorMessage: "仍未读取到申请结果，请稍后再次确认。",
      });
    } catch (caught) {
      if (!this.active(generation)) return;
      if (caught instanceof OpenGameRegistrationApiError
        && caught.code === "AUTH_REQUIRED") {
        this.setData({
          status: "AUTH_LOSS",
          primaryAction: "LOGIN",
          showLogin: true,
          errorMessage: "请恢复原账号后继续确认申请结果。",
        });
      } else if (caught instanceof OpenGameRegistrationApiError
        && caught.code === "OPEN_GAME_NOT_FOUND") {
        if (this.clearAttemptIfCurrent(attempt)) {
          this.setData({
            status: "NOT_FOUND",
            primaryAction: null,
            errorMessage: "球局已不可用，本次申请无法继续确认。",
          });
        } else {
          this.presentDurableAttempt();
        }
      } else {
        this.setData({
          status: "RESULT_UNKNOWN",
          primaryAction: "CONFIRM_RESULT",
          errorMessage: "暂时无法确认申请结果，请稍后重试。",
        });
      }
    }
  },

  presentDurableAttempt(context?: OpenGameRegistrationContext) {
    try {
      const durable = getOpenGameRegistrationAttemptStore().load();
      if (durable === null) {
        if (context !== undefined) this.applySharedPresentation(context);
        else void this.loadPublic();
        return;
      }
      this.presentPendingAttempt(durable);
    } catch {
      this.setData({
        status: "RESULT_UNKNOWN",
        primaryAction: "CONFIRM_RESULT",
        errorMessage: "暂时无法读取本机待确认记录，请稍后重试。",
      });
    }
  },

  presentPendingAttempt(attempt: OpenGameRegistrationAttempt) {
    const decision = classifyOpenGameRegistrationPendingAttempt(
      attempt,
      this.currentRegistrationUserId(),
      targetForAttempt(attempt, this.routeToken),
    );
    if (decision.kind === "PRESERVE_LOGIN_COMPARE_ACCOUNT") {
      this.setData({
        status: "AUTH_LOSS",
        primaryAction: "LOGIN",
        showLogin: true,
        errorMessage: "登录状态需要恢复，原提交记录已保留。",
      });
      return;
    }
    if (decision.kind === "FOREIGN_ACCOUNT_PENDING") {
      this.setData({
        status: "FOREIGN_PENDING",
        primaryAction: "CLEAR_PENDING",
        showLogin: false,
        errorMessage: "本机有另一账号尚未确认的操作，绝不会用当前账号重放。",
      });
      return;
    }
    if (decision.kind === "PRESERVE_AND_NAVIGATE") {
      this.pendingRoute = decision.route;
      this.setData({
        status: "OTHER_PENDING",
        primaryAction: "GO_PENDING",
        pendingRoute: decision.route,
        errorMessage: "请先确认本机上一项操作，再继续当前球局。",
      });
      return;
    }
    if (attempt.kind === "withdraw") {
      this.setData({
        status: "READY",
        withdrawalOperationState: "RESULT_UNKNOWN",
        primaryAction: "CONFIRM_WITHDRAW_RESULT",
        statusHeading: "退出结果待确认",
        statusDescription: "检测到原退出结果尚未确认。",
        errorMessage: "检测到原退出结果尚未确认。",
      });
    } else {
      this.setData({
        status: "RESULT_UNKNOWN",
        primaryAction: "CONFIRM_RESULT",
        errorMessage: "检测到原申请结果尚未确认。",
      });
    }
  },

  clearAttemptIfCurrent(attempt: OpenGameRegistrationAttempt): boolean {
    if (this.currentRegistrationUserId() !== attempt.originatingUserId) return false;
    const current = getOpenGameRegistrationAttemptStore().load();
    if (current === null) return true;
    if (!sameAttempt(current, attempt)) return false;
    getOpenGameRegistrationAttemptStore().clear();
    return true;
  },

  onOpenWithdrawalConfirm() {
    if (this.data.mode !== "shared"
      || this.data.status !== "READY"
      || this.data.primaryAction !== "WITHDRAW"
      || this.data.withdrawalOperationState !== "IDLE"
      || this.data.withdrawalAction === null) return;
    const userId = this.boundRegistrationUserId;
    if (userId === null || this.currentRegistrationUserId() !== userId) {
      void this.loadPublic();
      return;
    }
    this.setData({ withdrawalOperationState: "CONFIRMING" });
  },

  onCancelWithdrawal() {
    if (this.data.withdrawalOperationState !== "CONFIRMING") return;
    this.setData({ withdrawalOperationState: "IDLE" });
  },

  onConfirmWithdrawal() {
    if (this.mutationInFlight !== null) return this.mutationInFlight;
    if (this.data.mode !== "shared"
      || this.data.status !== "READY"
      || this.data.withdrawalOperationState !== "CONFIRMING"
      || this.data.withdrawalAction === null
      || !this.data.withdrawalApplicationId
      || this.data.withdrawalExpectedVersion < 1) return Promise.resolve();
    return this.runSingleFlight(async () => {
      const userId = this.boundRegistrationUserId;
      if (userId === null || this.currentRegistrationUserId() !== userId) {
        this.setData({ withdrawalOperationState: "IDLE" });
        await this.loadPublic();
        return;
      }
      const requested: OpenGameRegistrationWithdrawAttempt = {
        kind: "withdraw",
        originatingUserId: userId,
        shareToken: this.routeToken,
        applicationId: this.data.withdrawalApplicationId,
        action: this.data.withdrawalAction as OpenGameRegistrationWithdrawalAction,
        expectedVersion: this.data.withdrawalExpectedVersion,
        idempotencyKey: `withdraw-${Date.now()}-${++withdrawalAttemptSerial}`,
      };
      let availability;
      try {
        availability = getOpenGameRegistrationAttemptStore().begin(requested);
      } catch {
        this.setData({
          withdrawalOperationState: "IDLE",
          statusDescription: "无法安全保存操作记录，本次操作尚未发送，请稍后重试。",
          errorMessage: "无法安全保存操作记录，本次操作尚未发送。",
        });
        return;
      }
      if (availability.kind !== "READY" || availability.attempt.kind !== "withdraw") {
        this.setData({ withdrawalOperationState: "IDLE" });
        this.presentPendingAttempt(availability.attempt);
        return;
      }
      const attempt = availability.attempt;
      const generation = this.loadGeneration;
      this.setData({ withdrawalOperationState: "SUBMITTING", primaryAction: null });
      try {
        const context = await withdrawSignupRegistration(attempt);
        if (!await this.activeSharedOrResynchronize(generation, userId)) return;
        if (!this.clearAttemptIfCurrent(attempt)) {
          this.presentDurableAttempt(context);
          return;
        }
        this.applySharedPresentation(context);
      } catch (caught) {
        await this.handleWithdrawalMutationError(attempt, caught, generation);
      }
    });
  },

  onConfirmWithdrawalResult() {
    if (this.mutationInFlight !== null) return this.mutationInFlight;
    if (this.data.mode !== "shared"
      || this.data.primaryAction !== "CONFIRM_WITHDRAW_RESULT") return Promise.resolve();
    return this.runSingleFlight(async () => { await this.confirmWithdrawalResult(); });
  },

  async confirmWithdrawalResult() {
    let durable: OpenGameRegistrationAttempt | null;
    try { durable = getOpenGameRegistrationAttemptStore().load(); }
    catch {
      this.setData({
        status: "READY",
        withdrawalOperationState: "RESULT_UNKNOWN",
        primaryAction: "CONFIRM_WITHDRAW_RESULT",
        errorMessage: "暂时无法读取本机待确认记录，请稍后重试。",
      });
      return;
    }
    if (durable === null) {
      await this.loadPublic();
      return;
    }
    const pending = classifyOpenGameRegistrationPendingAttempt(
      durable,
      this.currentRegistrationUserId(),
      targetForAttempt(durable, this.routeToken),
    );
    if (pending.kind !== "READY" || pending.attempt.kind !== "withdraw") {
      this.presentPendingAttempt(durable);
      return;
    }
    const attempt = pending.attempt;
    const userId = attempt.originatingUserId;
    const generation = this.loadGeneration;
    this.setData({
      status: "READY",
      withdrawalOperationState: "RESULT_UNKNOWN",
      primaryAction: null,
      statusHeading: "正在确认退出结果",
      statusDescription: "正在读取服务端权威状态…",
    });
    let mutationSent = false;
    try {
      const context = await readSignupContext(attempt.shareToken);
      if (!await this.activeSharedOrResynchronize(generation, userId)) return;
      const current = getOpenGameRegistrationAttemptStore().load();
      if (current === null) {
        this.applySharedPresentation(context);
        return;
      }
      if (current.kind !== "withdraw" || !sameWithdrawAttempt(current, attempt)) {
        this.presentPendingAttempt(current);
        return;
      }
      const recovery = classifyOpenGameRegistrationUnknownResult(current, context);
      if (recovery.kind === "ACCEPT_AUTHORITY_AND_CLEAR") {
        if (!this.clearAttemptIfCurrent(current)) {
          this.presentDurableAttempt(context);
          return;
        }
        this.applySharedPresentation(recovery.authority);
        return;
      }
      mutationSent = true;
      const result = await withdrawSignupRegistration(current);
      if (!await this.activeSharedOrResynchronize(generation, userId)) return;
      if (!this.clearAttemptIfCurrent(current)) {
        this.presentDurableAttempt(result);
        return;
      }
      this.applySharedPresentation(result);
    } catch (caught) {
      if (mutationSent) await this.handleWithdrawalMutationError(attempt, caught, generation);
      else await this.handleWithdrawalReadError(attempt, caught, generation);
    }
  },

  async handleWithdrawalReadError(
    attempt: OpenGameRegistrationWithdrawAttempt,
    caught: unknown,
    generation: number,
  ) {
    if (!this.active(generation)
      || this.boundRegistrationUserId !== attempt.originatingUserId) return;
    const currentUserId = this.currentRegistrationUserId();
    if (currentUserId !== attempt.originatingUserId) {
      if (currentUserId !== null) await this.loadPublic();
      else this.setData({
        status: "AUTH_LOSS",
        withdrawalOperationState: "RESULT_UNKNOWN",
        primaryAction: "LOGIN",
        showLogin: true,
        errorMessage: "请恢复原账号后继续确认退出结果。",
      });
      return;
    }
    if (caught instanceof OpenGameRegistrationApiError
      && (caught.code === "AUTH_REQUIRED" || caught.code === "LOGIN_FAILED")) {
      this.setData({
        status: "AUTH_LOSS",
        withdrawalOperationState: "RESULT_UNKNOWN",
        primaryAction: "LOGIN",
        showLogin: true,
        errorMessage: "请恢复原账号后继续确认退出结果。",
      });
      return;
    }
    this.presentWithdrawalUnknownWithoutContext();
  },

  async handleWithdrawalMutationError(
    attempt: OpenGameRegistrationWithdrawAttempt,
    caught: unknown,
    generation: number,
  ) {
    if (!this.active(generation)
      || this.boundRegistrationUserId !== attempt.originatingUserId) return;
    const currentUserId = this.currentRegistrationUserId();
    if (currentUserId !== attempt.originatingUserId) {
      if (currentUserId !== null) await this.loadPublic();
      else this.setData({
        status: "AUTH_LOSS",
        withdrawalOperationState: "RESULT_UNKNOWN",
        primaryAction: "LOGIN",
        showLogin: true,
        errorMessage: "请恢复原账号后继续确认退出结果。",
      });
      return;
    }
    if (caught instanceof OpenGameRegistrationApiError
      && (caught.code === "AUTH_REQUIRED" || caught.code === "LOGIN_FAILED")) {
      this.setData({
        status: "AUTH_LOSS",
        withdrawalOperationState: "RESULT_UNKNOWN",
        primaryAction: "LOGIN",
        showLogin: true,
        errorMessage: "请恢复原账号后继续确认退出结果。",
      });
      return;
    }
    if (!(caught instanceof OpenGameRegistrationApiError)) {
      this.presentWithdrawalUnknownWithoutContext();
      return;
    }
    const decision = classifyOpenGameRegistrationMutationResult(caught.code);
    if (!decision.clearAttempt) {
      this.presentWithdrawalUnknownWithoutContext();
      return;
    }
    if (!this.clearAttemptIfCurrent(attempt)) {
      this.presentDurableAttempt();
      return;
    }
    await this.loadPublic();
  },

  presentWithdrawalUnknownWithoutContext() {
    this.setData({
      status: "READY",
      withdrawalOperationState: "RESULT_UNKNOWN",
      primaryAction: "CONFIRM_WITHDRAW_RESULT",
      statusHeading: "退出结果待确认",
      statusDescription: "上次操作没有返回结果，请读取权威状态确认。",
      statusTone: "pending",
      errorMessage: "退出结果暂时未知，请稍后继续确认。",
    });
  },

  onBlockTouchMove() {},

  onGoPending() {
    if (this.data.mode !== "shared"
      || this.data.status !== "OTHER_PENDING"
      || !this.pendingRoute) return Promise.resolve();
    return this.runSingleFlight(async () => {
      const generation = this.loadGeneration;
      const route = this.pendingRoute;
      try {
        await navigation("redirectTo", route);
      } catch {
        if (!this.active(generation)
          || this.data.status !== "OTHER_PENDING"
          || this.pendingRoute !== route
          || this.data.pendingRoute !== route) return;
        try {
          await navigation("reLaunch", route);
        } catch {
          if (this.active(generation)
            && this.data.status === "OTHER_PENDING"
            && this.pendingRoute === route
            && this.data.pendingRoute === route) {
            this.setData({ navigationError: "暂时无法前往确认，请重试。" });
          }
        }
      }
    });
  },

  onClearPending() {
    if (this.data.mode !== "shared" || this.data.status !== "FOREIGN_PENDING") {
      return Promise.resolve();
    }
    return this.runSingleFlight(async () => {
      try {
        const durable = getOpenGameRegistrationAttemptStore().load();
        if (durable === null) {
          await this.loadPublic();
          return;
        }
        const decision = classifyOpenGameRegistrationPendingAttempt(
          durable,
          this.currentRegistrationUserId(),
          targetForAttempt(durable, this.routeToken),
        );
        if (decision.kind !== "FOREIGN_ACCOUNT_PENDING") {
          this.presentPendingAttempt(durable);
          return;
        }
        getOpenGameRegistrationAttemptStore().clear();
        this.pendingRoute = "";
        this.setData({
          pendingRoute: "",
          primaryAction: null,
          errorMessage: "已清除本机待确认记录，正在读取当前账号。",
        });
        await this.loadPublic();
      } catch {
        this.setData({
          status: "LOAD_ERROR",
          primaryAction: null,
          errorMessage: "暂时无法清除本机待确认记录，请稍后重试。",
        });
      }
    });
  },

  onShareAppMessage() {
    if (this.data.mode !== "shared" || !TOKEN_PATTERN.test(this.routeToken)) {
      return { title: "逐光约场", path: "/pages/intent-entry/index" };
    }
    return {
      title: `${this.data.name || "逐光约场"} · 分享报名接龙`,
      path: `/pages/captain-game-public/index?token=${this.routeToken}`,
    };
  },

  onHeaderBack() {
    if (this.data.mode === "owner") {
      void this.returnManage();
      return;
    }
    if (currentPages().length > 1) wx.navigateBack({ delta: 1 });
    else wx.reLaunch({ url: "/pages/intent-entry/index" });
  },

  onReturnManage() {
    if (this.data.mode === "owner") return this.returnManage();
    return Promise.resolve();
  },

  async returnManage() {
    const previous = currentPages()[currentPages().length - 2];
    if (previous?.route === "pages/captain-game-manage/index") {
      wx.navigateBack({ delta: 1 });
      return;
    }
    const url = "/pages/captain-game-manage/index?game_id=" + this.routeGameId;
    try {
      await navigation("redirectTo", url);
    } catch {
      try {
        await navigation("reLaunch", url);
      } catch {
        this.setData({ navigationError: "暂时无法返回管理页，请重试。" });
      }
    }
  },
});
