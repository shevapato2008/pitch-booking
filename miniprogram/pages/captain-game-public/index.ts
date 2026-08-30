import type { OpenGamePublic } from "../../domain/open-game";
import type {
  OpenGameApplyBlockedReason,
  OpenGameRegistrationContext,
  OpenGameRegistrationEffectiveStatus,
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
import { readIntentHeaderLayout } from "../../presentation/intent-header-layout";
import { OpenGameRegistrationApiError } from "../../services/http-open-game-registration";
import { OpenGameApiError } from "../../services/http-open-game";
import {
  classifyOpenGameRegistrationMutationResult,
  classifyOpenGameRegistrationPendingAttempt,
  classifyOpenGameRegistrationUnknownResult,
  getOpenGameRegistrationAttemptStore,
  getOpenGameRegistrationSource,
  type OpenGameRegistrationApplyAttempt,
  type OpenGameRegistrationAttempt,
  type OpenGameRegistrationAttemptTarget,
  type OpenGameRegistrationWithdrawAttempt,
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
  | "CANCELLED";
type StatusTone = "anonymous" | "available" | "pending" | "joined" | "rejected" | "withdrawn";
type WithdrawalOperationState = "IDLE" | "CONFIRMING" | "SUBMITTING" | "RESULT_UNKNOWN";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32}$/;

interface RegistrationListPage {
  readonly route?: string;
  applyRegistrationAuthority?(patch: {
    readonly originatingUserId: string;
    readonly registrationId: string;
    readonly effectiveStatus: OpenGameRegistrationEffectiveStatus;
  }): boolean;
}

function currentPages(): readonly RegistrationListPage[] {
  return getCurrentPages() as unknown as readonly RegistrationListPage[];
}

function hideShare(): void {
  try { void wx.hideShareMenu(); } catch { /* platform unavailable during teardown */ }
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

function sameApplyAttempt(
  left: OpenGameRegistrationApplyAttempt,
  right: OpenGameRegistrationApplyAttempt,
): boolean {
  return left.originatingUserId === right.originatingUserId
    && left.shareToken === right.shareToken
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

function sameAttempt(
  left: OpenGameRegistrationAttempt,
  right: OpenGameRegistrationAttempt,
): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "apply" && right.kind === "apply") return sameApplyAttempt(left, right);
  if (left.kind === "withdraw" && right.kind === "withdraw") return sameWithdrawAttempt(left, right);
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
  return attempt.kind === "withdraw"
    ? { kind: "withdraw", shareToken }
    : { kind: "apply", shareToken };
}

function withdrawalLabel(action: OpenGameRegistrationWithdrawalAction | null): string {
  if (action === "WITHDRAW_APPLICATION") return "撤回申请";
  if (action === "LEAVE_GAME") return "退出球局";
  return "";
}

let withdrawalAttemptSerial = 0;

function blockerPresentation(reason: OpenGameApplyBlockedReason): {
  readonly heading: string;
  readonly description: string;
  readonly tone: StatusTone;
  readonly action: PrimaryAction;
} {
  switch (reason) {
    case "AUTH_REQUIRED":
      return {
        heading: "登录后可提交申请",
        description: "提交后由队长审核，结果回到本页查看。",
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
    return {
      registrationStatus: "WAITLISTED",
      heading: "候补中",
      description: position === null || position === undefined
        ? "候补顺位暂时无法读取，请刷新后重试。"
        : `当前候补第 ${position} 位，请等待空位。`,
      tone: "pending",
      action: null,
    };
  }
  if (effectiveStatus === "JOINED") {
    return {
      registrationStatus: "JOINED",
      heading: "已加入本场球局",
      description: "队长已接受申请；AA 到场线下结算。",
      tone: "joined",
      action: context.viewerRegistration?.availableWithdrawalAction === "LEAVE_GAME"
        ? "WITHDRAW"
        : null,
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
        ? "本次申请已撤回；本场不可再次申请。"
        : waitlistWithdrawal
          ? "你已退出本场候补队列；本场不可再次申请。"
          : "你已退出本场球局；本场不可再次申请。",
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
  if (context.allowedActions.canApply) {
    return {
      registrationStatus: "NONE",
      heading: "可以申请加入",
      description: "填写本场信息后提交，队长审核结果回到本页查看。",
      tone: "available",
      action: "APPLY",
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
    withdrawalKind: null as "APPLICATION_WITHDRAWAL" | "GAME_EXIT" | null,
    lateExitWillBeRecorded: false,
    withdrawalConfirmationTitle: "",
    withdrawalConfirmationCopy: "",
    withdrawalConfirmationActionLabel: "",
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

  onLoad(options: PageOptions = {}) {
    this.visible = true;
    this.skipNextShow = true;
    this.pendingRoute = "";
    this.boundRegistrationUserId = null;
    this.mutationInFlight = null;
    hideShare();
    const header = readHeaderData();
    const optionKeys = Object.keys(options);
    const shared = optionKeys.length === 1
      && typeof options.token === "string"
      && TOKEN_PATTERN.test(options.token);
    const owner = optionKeys.length === 2
      && typeof options.game_id === "string"
      && UUID_PATTERN.test(options.game_id)
      && options.preview === "1";
    if (shared === owner) {
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
      this.routeGameId = "";
      this.setData({ ...blankData(), ...header, mode: "shared" });
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
  },

  onUnload() {
    this.visible = false;
    this.loadGeneration += 1;
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
        const context = await getOpenGameRegistrationSource().getContext(this.routeToken);
        if (!this.activeShared(generation, registrationUserId)) return;
        this.applySharedContext(context);
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

  applySharedContext(context: OpenGameRegistrationContext) {
    this.applyPublic(context.game);
    const pending = getOpenGameRegistrationAttemptStore().load();
    if (pending === null) {
      this.applySharedPresentation(context);
      return;
    }
    const decision = classifyOpenGameRegistrationPendingAttempt(
      pending,
      this.currentRegistrationUserId(),
      targetForAttempt(pending, this.routeToken),
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
    if (decision.attempt.kind !== "apply") {
      this.presentPendingAttempt(pending);
      return;
    }
    if (context.viewerRegistration !== null) {
      if (!this.clearAttemptIfCurrent(decision.attempt)) {
        this.presentDurableAttempt(context);
        return;
      }
      this.applySharedPresentation(context);
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
    this.applyPublic(context.game);
    const presentation = registrationPresentation(context);
    const registration = context.viewerRegistration;
    const availableAction = registration?.availableWithdrawalAction ?? null;
    const action: OpenGameRegistrationWithdrawalAction | null =
      availableAction === "WITHDRAW_APPLICATION" || availableAction === "LEAVE_GAME"
        ? availableAction
        : null;
    const applicationWithdrawal = action === "WITHDRAW_APPLICATION";
    this.pendingRoute = "";
    this.setData({
      status: "READY",
      primaryAction: presentation.action,
      registrationStatus: presentation.registrationStatus,
      remainingSpots: context.remainingSpots,
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
      withdrawalKind: registration?.withdrawalKind === "WAITLIST_WITHDRAWAL"
        ? null
        : registration?.withdrawalKind ?? null,
      lateExitWillBeRecorded: registration?.lateExitWillBeRecorded ?? false,
      withdrawalConfirmationTitle: applicationWithdrawal ? "确认撤回申请？" : "确认退出球局？",
      withdrawalConfirmationCopy: applicationWithdrawal
        ? "撤回后队长无需再审核，已开放名额不变；本场不可再次申请。"
        : "退出后会立即释放 1 个公开名额；本场不可再次申请。",
      withdrawalConfirmationActionLabel: applicationWithdrawal ? "确认撤回" : "确认退出",
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
      const generation = this.loadGeneration;
      try {
        await navigation(
          "navigateTo",
          "/pages/player-game-application/index?token=" + this.routeToken,
        );
      } catch {
        if (this.active(generation)) {
          this.setData({ navigationError: "暂时无法打开申请表，请重试。" });
        }
      }
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
      const context = await getOpenGameRegistrationSource().getContext(
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
      const result = await getOpenGameRegistrationSource().apply(
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

  async resolveAlreadyExists(
    attempt: OpenGameRegistrationApplyAttempt,
    generation: number,
  ) {
    try {
      const context = await getOpenGameRegistrationSource().getContext(attempt.shareToken);
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
        const context = await getOpenGameRegistrationSource().withdraw(attempt);
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
      const context = await getOpenGameRegistrationSource().getContext(attempt.shareToken);
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
      const result = await getOpenGameRegistrationSource().withdraw(current);
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
