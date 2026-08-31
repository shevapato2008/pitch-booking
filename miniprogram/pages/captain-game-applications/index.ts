import type {
  CaptainOpenGameApplication,
  OpenGameApplicationDecisionResult,
  OpenGameApplicationQueue,
  OpenGameReviewActions,
} from "../../domain/open-game-registration";
import { formatOpenGameDateTime, openGamePositionLabel } from "../../presentation/open-game";
import { readIntentHeaderLayout } from "../../presentation/intent-header-layout";
import {
  OpenGameRegistrationApiError,
  type OpenGameRegistrationCapacityChangedDetails,
} from "../../services/http-open-game-registration";
import {
  classifyOpenGameRegistrationMutationResult,
  classifyOpenGameRegistrationPendingAttempt,
  getOpenGameRegistrationAttemptStore,
  getOpenGameRegistrationSource,
  type OpenGameRegistrationAttempt,
  type OpenGameRegistrationDecisionAttempt,
} from "../../services/open-game-registration";

interface PageOptions { game_id?: unknown; }

type ReviewStatus =
  | "LOADING"
  | "READY"
  | "DECIDING"
  | "AUTH_LOSS"
  | "RESULT_UNKNOWN"
  | "CAPACITY_CHANGED"
  | "LOAD_ERROR"
  | "NOT_FOUND"
  | "CONFLICT"
  | "OTHER_PENDING"
  | "FOREIGN_PENDING";

interface FrozenDecision {
  readonly applicationId: string;
  readonly expectedVersion: number;
  readonly decision: "ACCEPT" | "WAITLIST" | "REJECT";
}

type AttemptReconciliation =
  | { readonly kind: "CLEARED" }
  | { readonly kind: "MISSING" }
  | { readonly kind: "REPLACED"; readonly attempt: OpenGameRegistrationAttempt }
  | { readonly kind: "STORAGE_ERROR" };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let attemptSerial = 0;

function validUuid(value: string | null): value is string {
  return value !== null && UUID_PATTERN.test(value);
}

function currentPages(): readonly { route?: string }[] {
  return getCurrentPages() as unknown as readonly { route?: string }[];
}

function navigation(
  method: "navigateBack" | "redirectTo" | "reLaunch",
  value: { readonly delta: number } | { readonly url: string },
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = () => { if (!settled) { settled = true; resolve(); } };
    const fail = (error: unknown) => { if (!settled) { settled = true; reject(error); } };
    const options = { ...value, success: done, fail };
    const returned = method === "navigateBack"
      ? wx.navigateBack(options as WechatMiniprogram.NavigateBackOption)
      : method === "redirectTo"
        ? wx.redirectTo(options as WechatMiniprogram.RedirectToOption)
        : wx.reLaunch(options as WechatMiniprogram.ReLaunchOption);
    const thenable = returned as unknown as {
      then?: (yes: () => void, no: (error: unknown) => void) => void;
    };
    if (typeof thenable?.then === "function") thenable.then(done, fail);
  });
}

function headerData() {
  const header = readIntentHeaderLayout();
  return { headerTopPx: header.topPx, headerRowHeightPx: header.rowHeightPx };
}

function appliedAtLabel(value: string): string {
  return formatOpenGameDateTime(value, "Asia/Shanghai");
}

function blockerMessage(actions: OpenGameReviewActions): string {
  if (actions.canWaitlist) return "";
  const reason = actions.acceptBlockedReason ?? actions.waitlistBlockedReason
    ?? actions.rejectBlockedReason;
  switch (reason) {
    case "APPLICATION_NOT_PENDING": return "这条申请已不在待审核状态。";
    case "GAME_SUSPENDED": return "球局当前暂停，暂时不能处理申请。";
    case "GAME_CANCELLED": return "球局已取消，不能继续处理申请。";
    case "GAME_COMPLETED": return "球局已结束，不能继续处理申请。";
    case "GAME_STARTED": return "球局已经开始，不能继续处理申请。";
    case "GAME_FULL": return "当前名额已满，仍可婉拒这条申请。";
    default: return "";
  }
}

function cloneActions(actions: OpenGameReviewActions): OpenGameReviewActions {
  return {
    canAccept: actions.canAccept,
    acceptBlockedReason: actions.acceptBlockedReason,
    canWaitlist: actions.canWaitlist,
    waitlistBlockedReason: actions.waitlistBlockedReason,
    canReject: actions.canReject,
    rejectBlockedReason: actions.rejectBlockedReason,
  };
}

function projectApplication(application: CaptainOpenGameApplication | null) {
  if (application === null) return null;
  return {
    id: application.id,
    displayName: application.displayName,
    position: application.position,
    note: application.note,
    appliedAt: application.appliedAt,
    version: application.version,
    allowedActions: cloneActions(application.allowedActions),
  };
}

function blankData() {
  return {
    status: "LOADING" as ReviewStatus,
    pendingCount: 0,
    remainingSpots: 0,
    hasPending: false,
    empty: false,
    application: null as ReturnType<typeof projectApplication>,
    positionLabel: "",
    appliedAtLabel: "",
    canAccept: false,
    acceptBlockedReason: null as OpenGameReviewActions["acceptBlockedReason"],
    canWaitlist: false,
    waitlistBlockedReason: null as OpenGameReviewActions["waitlistBlockedReason"],
    canReject: false,
    rejectBlockedReason: null as OpenGameReviewActions["rejectBlockedReason"],
    fullWaitlist: false,
    blockerMessage: "",
    panel: null as "ACCEPT" | "WAITLIST" | "REJECT" | null,
    decisionTitle: "",
    decisionCopy: "",
    decisionButton: "",
    errorMessage: "",
    noticeMessage: "",
    navigationError: "",
    pendingRoute: "",
    headerTopPx: 0,
    headerRowHeightPx: 44,
  };
}

function sameDecisionAttempt(
  left: OpenGameRegistrationDecisionAttempt,
  right: OpenGameRegistrationDecisionAttempt,
): boolean {
  return left.originatingUserId === right.originatingUserId
    && left.gameId === right.gameId
    && left.applicationId === right.applicationId
    && left.decision === right.decision
    && left.expectedVersion === right.expectedVersion
    && left.idempotencyKey === right.idempotencyKey;
}

function decisionResultMatches(
  attempt: OpenGameRegistrationDecisionAttempt,
  result: OpenGameApplicationDecisionResult,
): boolean {
  const expectedVersion = attempt.expectedVersion + 1;
  return Number.isSafeInteger(expectedVersion)
    && result.applicationId === attempt.applicationId
    && result.status === (attempt.decision === "ACCEPT"
      ? "JOINED"
      : attempt.decision === "WAITLIST"
        ? "WAITLISTED"
        : "REJECTED")
    && result.version === expectedVersion;
}

Page({
  data: blankData(),
  loadGeneration: 0,
  visible: true,
  skipNextShow: false,
  routeGameId: "",
  currentQueue: null as OpenGameApplicationQueue | null,
  firstApplication: null as CaptainOpenGameApplication | null,
  authorityUserId: null as string | null,
  panelSelection: null as FrozenDecision | null,
  unknownAttempt: null as OpenGameRegistrationDecisionAttempt | null,
  pendingRoute: "",
  readInFlight: null as Promise<void> | null,
  mutationInFlight: null as Promise<void> | null,
  navigationInFlight: null as Promise<void> | null,

  onLoad(options: PageOptions = {}) {
    this.visible = true;
    this.skipNextShow = true;
    this.currentQueue = null;
    this.firstApplication = null;
    this.authorityUserId = null;
    this.panelSelection = null;
    this.unknownAttempt = null;
    this.pendingRoute = "";
    this.readInFlight = null;
    this.mutationInFlight = null;
    this.navigationInFlight = null;
    const header = headerData();
    if (Object.keys(options).length !== 1
      || typeof options.game_id !== "string"
      || !UUID_PATTERN.test(options.game_id)) {
      this.routeGameId = "";
      this.setData({
        ...blankData(),
        ...header,
        status: "NOT_FOUND",
        errorMessage: "没有找到这场球局。",
      });
      return;
    }
    this.routeGameId = options.game_id;
    this.setData({ ...blankData(), ...header });
    void this.loadAuthority();
  },

  onShow() {
    if (this.skipNextShow) {
      this.skipNextShow = false;
      return;
    }
    this.visible = true;
    if (this.routeGameId) void this.loadAuthority();
  },

  onHide() {
    this.visible = false;
    this.loadGeneration += 1;
    this.readInFlight = null;
    this.panelSelection = null;
    this.setData({ panel: null });
  },

  onUnload() {
    this.visible = false;
    this.loadGeneration += 1;
    this.readInFlight = null;
    this.panelSelection = null;
  },

  active(generation: number): boolean {
    return this.visible && generation === this.loadGeneration;
  },

  currentUserId(): string | null {
    try {
      return getOpenGameRegistrationSource().currentUserId();
    } catch {
      return null;
    }
  },

  loadAuthority(noticeMessage = ""): Promise<void> {
    if (!this.routeGameId) return Promise.resolve();
    if (this.readInFlight !== null) return this.readInFlight;
    const generation = ++this.loadGeneration;
    this.setData({
      status: "LOADING",
      errorMessage: "",
      navigationError: "",
      noticeMessage,
      panel: null,
    });
    this.panelSelection = null;
    const promise = (async () => {
      try {
        const authority = await getOpenGameRegistrationSource().getPending(this.routeGameId);
        if (!this.active(generation)) return;
        this.applyAuthority(authority, noticeMessage);
      } catch (caught) {
        if (!this.active(generation)) return;
        this.handleReadError(caught);
      }
    })().finally(() => {
      if (this.readInFlight === promise) this.readInFlight = null;
    });
    this.readInFlight = promise;
    return promise;
  },

  projectQueue(queue: OpenGameApplicationQueue) {
    this.currentQueue = queue;
    const first = queue.applications[0] ?? null;
    this.firstApplication = first;
    const actions = first?.allowedActions ?? {
      canAccept: false,
      acceptBlockedReason: null,
      canWaitlist: false,
      waitlistBlockedReason: null,
      canReject: false,
      rejectBlockedReason: null,
    };
    this.setData({
      pendingCount: queue.pendingCount,
      remainingSpots: queue.remainingSpots,
      hasPending: first !== null,
      empty: first === null,
      application: projectApplication(first),
      positionLabel: first === null ? "" : openGamePositionLabel(first.position),
      appliedAtLabel: first === null ? "" : appliedAtLabel(first.appliedAt),
      canAccept: actions.canAccept,
      acceptBlockedReason: actions.acceptBlockedReason,
      canWaitlist: actions.canWaitlist,
      waitlistBlockedReason: actions.waitlistBlockedReason,
      canReject: actions.canReject,
      rejectBlockedReason: actions.rejectBlockedReason,
      fullWaitlist: actions.canWaitlist,
      blockerMessage: blockerMessage(actions),
      panel: null,
    });
    this.panelSelection = null;
  },

  applyAuthority(queue: OpenGameApplicationQueue, noticeMessage = "") {
    this.projectQueue(queue);
    const userId = this.currentUserId();
    this.authorityUserId = validUuid(userId) ? userId : null;
    let pending: OpenGameRegistrationAttempt | null;
    try {
      pending = getOpenGameRegistrationAttemptStore().load();
    } catch {
      this.setData({
        status: "LOAD_ERROR",
        errorMessage: "本机审核记录暂时无法读取，没有发送新的操作。",
      });
      return;
    }
    if (pending !== null) {
      this.presentPendingAttempt(pending, this.authorityUserId);
      return;
    }
    this.unknownAttempt = null;
    if (this.authorityUserId === null) {
      this.setData({
        status: "AUTH_LOSS",
        errorMessage: "登录状态需要恢复，页面不会处理任何申请。",
      });
      return;
    }
    this.setData({
      status: "READY",
      errorMessage: "",
      noticeMessage,
      pendingRoute: "",
    });
  },

  handleReadError(caught: unknown) {
    if (caught instanceof OpenGameRegistrationApiError && caught.code === "AUTH_REQUIRED") {
      this.setData({
        status: "AUTH_LOSS",
        errorMessage: "登录状态已失效；未确认的审核记录仍保留。",
      });
      return;
    }
    if (caught instanceof OpenGameRegistrationApiError && caught.code === "OPEN_GAME_NOT_FOUND") {
      this.clearOwnedCurrentAttempt();
      this.setData({
        status: "NOT_FOUND",
        errorMessage: "没有找到这场球局，或你无权查看。",
      });
      return;
    }
    this.setData({
      status: "LOAD_ERROR",
      errorMessage: "报名列表暂时没有加载出来，请稍后重试。",
    });
  },

  presentPendingAttempt(attempt: OpenGameRegistrationAttempt, userId: string | null) {
    const decision = classifyOpenGameRegistrationPendingAttempt(
      attempt,
      userId,
      { kind: "decision", gameId: this.routeGameId },
    );
    this.panelSelection = null;
    this.setData({ panel: null });
    if (decision.kind === "PRESERVE_LOGIN_COMPARE_ACCOUNT") {
      this.setData({
        status: "AUTH_LOSS",
        errorMessage: "请恢复原账号后确认上一项审核。",
      });
      return;
    }
    if (decision.kind === "FOREIGN_ACCOUNT_PENDING") {
      this.unknownAttempt = null;
      this.setData({
        status: "FOREIGN_PENDING",
        errorMessage: "本机有另一账号尚未确认的操作，绝不会用当前账号重放。",
      });
      return;
    }
    if (decision.kind === "PRESERVE_AND_NAVIGATE") {
      this.unknownAttempt = null;
      this.pendingRoute = decision.route;
      this.setData({
        status: "OTHER_PENDING",
        pendingRoute: decision.route,
        errorMessage: "请先确认本机上一项操作，再处理新的申请。",
      });
      return;
    }
    if (decision.attempt.kind !== "decision") return;
    this.unknownAttempt = decision.attempt;
    this.setData({
      status: "RESULT_UNKNOWN",
      errorMessage: "检测到原审核结果尚未确认，请复用原记录确认结果。",
    });
  },

  reconcileAttempt(attempt: OpenGameRegistrationDecisionAttempt): AttemptReconciliation {
    try {
      const current = getOpenGameRegistrationAttemptStore().load();
      if (current === null) return { kind: "MISSING" };
      if (current.kind !== "decision" || !sameDecisionAttempt(current, attempt)) {
        return { kind: "REPLACED", attempt: current };
      }
      getOpenGameRegistrationAttemptStore().clear();
      return { kind: "CLEARED" };
    } catch {
      return { kind: "STORAGE_ERROR" };
    }
  },

  clearOwnedCurrentAttempt() {
    let current: OpenGameRegistrationAttempt | null;
    try {
      current = getOpenGameRegistrationAttemptStore().load();
    } catch {
      return;
    }
    const userId = this.currentUserId();
    if (current?.kind === "decision"
      && current.gameId === this.routeGameId
      && userId === current.originatingUserId) {
      try {
        getOpenGameRegistrationAttemptStore().clear();
      } catch {
        // The not-found authority remains valid; a retained local record can be cleared later.
      }
    }
  },

  openPanel(decision: "ACCEPT" | "WAITLIST" | "REJECT") {
    if (this.data.status !== "READY" || this.mutationInFlight !== null) return;
    const application = this.firstApplication;
    if (application === null) return;
    const allowed = decision === "ACCEPT"
      ? application.allowedActions.canAccept
      : decision === "WAITLIST"
        ? application.allowedActions.canWaitlist
        : application.allowedActions.canReject;
    if (!allowed) return;
    this.panelSelection = {
      applicationId: application.id,
      expectedVersion: application.version,
      decision,
    };
    this.setData({
      panel: decision,
      decisionTitle: decision === "ACCEPT"
        ? "确认接受加入？"
        : decision === "WAITLIST"
          ? "确认加入候补？"
          : "确认婉拒申请？",
      decisionCopy: decision === "ACCEPT"
        ? "接受后，申请人会在同一球局详情看到已加入结果。"
        : decision === "WAITLIST"
          ? "确认后将按本场不可复用的先后顺序排入候补，当前不会增加已加入人数。"
          : "婉拒仅代表本场决定，申请人会在同一详情看到结果。",
      decisionButton: decision === "ACCEPT"
        ? "确认接受"
        : decision === "WAITLIST"
          ? "确认加入候补"
          : "确认婉拒",
      navigationError: "",
    });
  },

  onAccept() {
    this.openPanel("ACCEPT");
  },

  onWaitlist() {
    this.openPanel("WAITLIST");
  },

  onReject() {
    this.openPanel("REJECT");
  },

  onClosePanel() {
    if (this.mutationInFlight !== null) return;
    this.panelSelection = null;
    this.setData({ panel: null });
  },

  onConfirmDecision() {
    if (this.mutationInFlight !== null) return this.mutationInFlight;
    const frozen = this.panelSelection;
    const application = this.firstApplication;
    if (frozen === null
      || application === null
      || this.data.status !== "READY"
      || application.id !== frozen.applicationId
      || application.version !== frozen.expectedVersion
      || (frozen.decision === "ACCEPT" && !application.allowedActions.canAccept)
      || (frozen.decision === "WAITLIST" && !application.allowedActions.canWaitlist)
      || (frozen.decision === "REJECT" && !application.allowedActions.canReject)) {
      this.panelSelection = null;
      this.setData({
        panel: null,
        noticeMessage: "待审核首项或允许动作已变化，请以当前列表为准。",
      });
      return Promise.resolve();
    }
    const userId = this.currentUserId();
    if (!validUuid(userId) || userId !== this.authorityUserId) {
      this.panelSelection = null;
      this.setData({
        panel: null,
        status: "AUTH_LOSS",
        errorMessage: "登录账号已变化，请重新登录并读取队列。",
      });
      return Promise.resolve();
    }
    const requested: OpenGameRegistrationDecisionAttempt = {
      kind: "decision",
      originatingUserId: userId,
      gameId: this.routeGameId,
      applicationId: frozen.applicationId,
      decision: frozen.decision,
      expectedVersion: frozen.expectedVersion,
      idempotencyKey: `captain-decision-${Date.now()}-${++attemptSerial}`,
    };
    let availability;
    try {
      availability = getOpenGameRegistrationAttemptStore().begin(requested);
    } catch {
      this.panelSelection = null;
      this.setData({
        panel: null,
        status: "LOAD_ERROR",
        errorMessage: "无法安全保存审核记录，本次操作尚未发送。",
      });
      return Promise.resolve();
    }
    this.panelSelection = null;
    this.setData({ panel: null });
    if (availability.kind !== "READY") {
      this.presentPendingAttempt(availability.attempt, userId);
      return Promise.resolve();
    }
    if (availability.attempt.kind !== "decision") return Promise.resolve();
    this.unknownAttempt = availability.attempt;
    const promise = this.executeDecision(availability.attempt).finally(() => {
      if (this.mutationInFlight === promise) this.mutationInFlight = null;
    });
    this.mutationInFlight = promise;
    return promise;
  },

  async executeDecision(attempt: OpenGameRegistrationDecisionAttempt) {
    const generation = this.loadGeneration;
    this.setData({
      status: "DECIDING",
      errorMessage: "正在提交审核，请勿重复操作。",
      navigationError: "",
      panel: null,
    });
    try {
      const result = await getOpenGameRegistrationSource().decide(attempt);
      if (!this.active(generation)) return;
      if (!decisionResultMatches(attempt, result)) {
        this.setUnknownResult(attempt, "审核响应尚不能确认，请复用原记录确认结果。");
        return;
      }
      const reconciliation = this.reconcileAttempt(attempt);
      if (reconciliation.kind === "STORAGE_ERROR") {
        this.setUnknownResult(attempt, "审核已返回，但本机确认记录暂时无法读取，请再次确认。");
        return;
      }
      if (reconciliation.kind === "REPLACED") {
        this.presentPendingAttempt(reconciliation.attempt, this.currentUserId());
        return;
      }
      if (reconciliation.kind === "MISSING") {
        this.setData({
          status: "CONFLICT",
          errorMessage: "本机待确认记录已变化，没有改动新的记录。",
        });
        return;
      }
      this.unknownAttempt = null;
      const notice = result.status === "JOINED"
        ? "已接受上一条申请，并读取最新待审核列表。"
        : result.status === "WAITLISTED"
          ? "已将上一条申请加入候补，并读取最新待审核列表。"
          : "已婉拒上一条申请，并读取最新待审核列表。";
      await this.loadAuthority(notice);
    } catch (caught) {
      if (!this.active(generation)) return;
      await this.handleMutationError(attempt, caught);
    }
  },

  setUnknownResult(attempt: OpenGameRegistrationDecisionAttempt, message: string) {
    this.unknownAttempt = attempt;
    this.setData({
      status: "RESULT_UNKNOWN",
      panel: null,
      errorMessage: message,
    });
  },

  async handleMutationError(
    attempt: OpenGameRegistrationDecisionAttempt,
    caught: unknown,
  ) {
    if (!(caught instanceof OpenGameRegistrationApiError)) {
      this.setUnknownResult(attempt, "审核结果暂时未知，请确认后再继续。");
      return;
    }
    const recovery = classifyOpenGameRegistrationMutationResult(caught.code);
    if (recovery.kind === "PRESERVE_LOGIN_COMPARE_ACCOUNT") {
      this.setUnknownResult(attempt, "登录状态需要恢复，原审核记录已保留。");
      this.setData({ status: "AUTH_LOSS" });
      return;
    }
    if (recovery.kind === "PRESERVE_APPLICATION_RESULT_UNKNOWN"
      || recovery.kind === "RETRY_READ") {
      this.setUnknownResult(attempt, "审核结果暂时未知，请复用原记录确认结果。");
      return;
    }
    if (recovery.clearAttempt) {
      const reconciliation = this.reconcileAttempt(attempt);
      if (reconciliation.kind === "STORAGE_ERROR") {
        this.setUnknownResult(attempt, "暂时无法安全更新本机审核记录，请再次确认结果。");
        return;
      }
      if (reconciliation.kind === "REPLACED") {
        this.presentPendingAttempt(reconciliation.attempt, this.currentUserId());
        return;
      }
      if (reconciliation.kind === "MISSING") {
        this.unknownAttempt = null;
        await this.loadAuthority("本机待确认记录已变化，已读取最新队列。");
        return;
      }
    }
    this.unknownAttempt = null;
    if (recovery.kind === "CLEAR_AND_REFRESH_QUEUE") {
      if (caught.code === "APPLICATION_CAPACITY_CHANGED") {
        this.applyCapacityConflict(caught);
        return;
      }
      await this.loadAuthority("申请状态已变化，已读取最新队列。");
      return;
    }
    if (recovery.kind === "CLEAR_AND_CORRECT_OR_REFRESH") {
      await this.loadAuthority("审核参数已变化，已读取最新队列。");
      return;
    }
    if (recovery.kind === "CLEAR_AND_RETURN") {
      this.setData({
        status: "NOT_FOUND",
        errorMessage: "球局或这条申请已不可用，本次审核没有确认成功。",
      });
      return;
    }
    if (recovery.kind === "CLEAR_AND_SHOW_CONFLICT") {
      this.setData({
        status: "CONFLICT",
        errorMessage: "本次审核记录发生冲突，请返回球局管理后重新进入。",
      });
      return;
    }
    this.setUnknownResult(attempt, "审核结果暂时未知，请稍后确认。");
  },

  applyCapacityConflict(error: OpenGameRegistrationApiError) {
    const details = error.details as OpenGameRegistrationCapacityChangedDetails | undefined;
    const application = this.firstApplication;
    if (details !== undefined && application !== null) {
      const updated: CaptainOpenGameApplication = {
        ...application,
        allowedActions: cloneActions(details.allowedActions),
      };
      this.firstApplication = updated;
      this.setData({
        remainingSpots: details.remainingSpots,
        application: projectApplication(updated),
        canAccept: details.allowedActions.canAccept,
        acceptBlockedReason: details.allowedActions.acceptBlockedReason,
        canWaitlist: details.allowedActions.canWaitlist,
        waitlistBlockedReason: details.allowedActions.waitlistBlockedReason,
        canReject: details.allowedActions.canReject,
        rejectBlockedReason: details.allowedActions.rejectBlockedReason,
        fullWaitlist: details.allowedActions.canWaitlist,
        blockerMessage: blockerMessage(details.allowedActions),
      });
    }
    this.setData({
      status: "CAPACITY_CHANGED",
      errorMessage: "名额状态已变化；申请仍在原位置，没有被自动接受。",
    });
  },

  onConfirmDecisionResult() {
    if (this.mutationInFlight !== null) return this.mutationInFlight;
    let durable: OpenGameRegistrationAttempt | null;
    try {
      durable = getOpenGameRegistrationAttemptStore().load();
    } catch {
      this.setData({
        status: "LOAD_ERROR",
        errorMessage: "本机审核记录暂时无法读取，没有发送新的操作。",
      });
      return Promise.resolve();
    }
    if (durable === null) return this.loadAuthority();
    const userId = this.currentUserId();
    const classification = classifyOpenGameRegistrationPendingAttempt(
      durable,
      userId,
      { kind: "decision", gameId: this.routeGameId },
    );
    if (classification.kind !== "READY" || classification.attempt.kind !== "decision") {
      this.presentPendingAttempt(durable, userId);
      return Promise.resolve();
    }
    if (this.unknownAttempt !== null
      && !sameDecisionAttempt(classification.attempt, this.unknownAttempt)) {
      this.presentPendingAttempt(classification.attempt, userId);
      return Promise.resolve();
    }
    const originalAttempt = classification.attempt;
    this.unknownAttempt = originalAttempt;
    const promise = (async () => {
      await this.loadAuthority("已读取最新待审核列表，正在确认原审核。");
      if (this.data.status !== "RESULT_UNKNOWN"
        || this.unknownAttempt === null
        || !sameDecisionAttempt(this.unknownAttempt, originalAttempt)) return;
      let refreshed: OpenGameRegistrationAttempt | null;
      try {
        refreshed = getOpenGameRegistrationAttemptStore().load();
      } catch {
        this.setData({
          status: "LOAD_ERROR",
          errorMessage: "本机审核记录暂时无法读取，没有发送新的操作。",
        });
        return;
      }
      if (refreshed === null) return;
      const refreshedClassification = classifyOpenGameRegistrationPendingAttempt(
        refreshed,
        this.currentUserId(),
        { kind: "decision", gameId: this.routeGameId },
      );
      if (refreshedClassification.kind !== "READY"
        || refreshedClassification.attempt.kind !== "decision"
        || !sameDecisionAttempt(refreshedClassification.attempt, originalAttempt)) {
        this.presentPendingAttempt(refreshed, this.currentUserId());
        return;
      }
      await this.executeDecision(refreshedClassification.attempt);
    })().finally(() => {
      if (this.mutationInFlight === promise) this.mutationInFlight = null;
    });
    this.mutationInFlight = promise;
    return promise;
  },

  onLogin() {
    if (this.mutationInFlight !== null) return this.mutationInFlight;
    const generation = this.loadGeneration;
    const promise = (async () => {
      try {
        const userId = await getOpenGameRegistrationSource().login();
        if (!this.active(generation)) return;
        const pending = getOpenGameRegistrationAttemptStore().load();
        if (pending !== null && pending.originatingUserId !== userId) {
          this.unknownAttempt = null;
          this.setData({
            status: "FOREIGN_PENDING",
            errorMessage: "登录账号与原操作账号不同，绝不会重放原审核。",
          });
          return;
        }
        await this.loadAuthority();
      } catch {
        if (!this.active(generation)) return;
        this.setData({
          status: "AUTH_LOSS",
          errorMessage: "登录失败，请重试；原审核记录仍保留。",
        });
      }
    })().finally(() => {
      if (this.mutationInFlight === promise) this.mutationInFlight = null;
    });
    this.mutationInFlight = promise;
    return promise;
  },

  onReload() {
    this.visible = true;
    return this.loadAuthority();
  },

  onRefreshApplications() {
    this.visible = true;
    return this.loadAuthority();
  },

  onClearPending() {
    if (this.data.status !== "FOREIGN_PENDING") return Promise.resolve();
    if (this.mutationInFlight !== null) return this.mutationInFlight;
    const promise = (async () => {
      let durable: OpenGameRegistrationAttempt | null;
      try {
        durable = getOpenGameRegistrationAttemptStore().load();
      } catch {
        this.setData({
          status: "LOAD_ERROR",
          errorMessage: "本机待确认记录暂时无法读取，没有清除任何内容。",
        });
        return;
      }
      if (durable === null) {
        await this.loadAuthority();
        return;
      }
      const userId = this.currentUserId();
      const classification = classifyOpenGameRegistrationPendingAttempt(
        durable,
        userId,
        { kind: "decision", gameId: this.routeGameId },
      );
      if (classification.kind !== "FOREIGN_ACCOUNT_PENDING") {
        this.presentPendingAttempt(durable, userId);
        return;
      }
      getOpenGameRegistrationAttemptStore().clear();
      this.unknownAttempt = null;
      this.pendingRoute = "";
      this.setData({
        pendingRoute: "",
        errorMessage: "已清除本机待确认记录，正在读取当前账号。",
      });
      await this.loadAuthority();
    })().finally(() => {
      if (this.mutationInFlight === promise) this.mutationInFlight = null;
    });
    this.mutationInFlight = promise;
    return promise;
  },

  runNavigation(task: () => Promise<void>, failureMessage: string): Promise<void> {
    if (this.navigationInFlight !== null) return this.navigationInFlight;
    this.setData({ navigationError: "" });
    const promise = task().catch(() => {
      if (this.visible) this.setData({ navigationError: failureMessage });
    }).finally(() => {
      if (this.navigationInFlight === promise) this.navigationInFlight = null;
    });
    this.navigationInFlight = promise;
    return promise;
  },

  returnToManage(): Promise<void> {
    return this.runNavigation(async () => {
      if (currentPages().length > 1) {
        try {
          await navigation("navigateBack", { delta: 1 });
          return;
        } catch {
          // A deterministic owner route remains available when native history fails.
        }
      }
      if (!this.routeGameId) {
        await navigation("reLaunch", { url: "/pages/intent-entry/index" });
        return;
      }
      await navigation("redirectTo", {
        url: `/pages/captain-game-manage/index?game_id=${this.routeGameId}`,
      });
    }, "暂时无法返回球局管理，请重试。");
  },

  returnFromNotFound(): Promise<void> {
    return this.runNavigation(async () => {
      if (currentPages().length > 1) {
        try {
          await navigation("navigateBack", { delta: 1 });
          return;
        } catch {
          // Deep-link intent entry is the final recovery route.
        }
      }
      await navigation("reLaunch", { url: "/pages/intent-entry/index" });
    }, "暂时无法返回，请重试。");
  },

  onHeaderBack() {
    return this.data.status === "NOT_FOUND" ? this.returnFromNotFound() : this.returnToManage();
  },

  onReturnManage() {
    return this.returnToManage();
  },

  onReturnNotFound() {
    return this.returnFromNotFound();
  },

  onCloseUnknown() {
    return this.returnToManage();
  },

  onGoPending() {
    if (this.data.status !== "OTHER_PENDING" || !this.pendingRoute) return Promise.resolve();
    return this.runNavigation(async () => {
      try {
        await navigation("redirectTo", { url: this.pendingRoute });
      } catch {
        await navigation("reLaunch", { url: this.pendingRoute });
      }
    }, "暂时无法前往确认，请重试。");
  },
});
