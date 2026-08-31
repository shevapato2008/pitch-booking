import type {
  OpenGameAttendanceMarkResult,
  OpenGameAttendanceRoster,
  OpenGameAttendanceRosterItem,
  OpenGameAttendanceMarkStatus,
} from "../../domain/open-game-registration";
import {
  formatOpenGameDateTime,
  formatOpenGameRange,
  openGamePositionLabel,
} from "../../presentation/open-game";
import { readIntentHeaderLayout } from "../../presentation/intent-header-layout";
import { OpenGameRegistrationApiError } from "../../services/http-open-game-registration";
import {
  classifyOpenGameAttendanceUnknownResult,
  classifyOpenGameRegistrationMutationResult,
  classifyOpenGameRegistrationPendingAttempt,
  getOpenGameRegistrationAttemptStore,
  getOpenGameRegistrationSource,
  type OpenGameAttendanceMarkAttempt,
  type OpenGameRegistrationAttempt,
} from "../../services/open-game-registration";

interface PageOptions { game_id?: unknown; }
interface AttendanceEvent {
  currentTarget?: { dataset?: { registrationId?: unknown } };
}

type AttendancePageStatus =
  | "LOADING"
  | "READY"
  | "MARKING"
  | "LOAD_ERROR"
  | "AUTH_LOSS"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RESULT_UNKNOWN"
  | "OTHER_PENDING"
  | "FOREIGN_PENDING";

interface FrozenAttendanceDecision {
  readonly registrationId: string;
  readonly attendanceStatus: OpenGameAttendanceMarkStatus;
  readonly expectedVersion: number;
}

type AttemptReconciliation =
  | { readonly kind: "CLEARED" }
  | { readonly kind: "MISSING" }
  | { readonly kind: "REPLACED"; readonly attempt: OpenGameRegistrationAttempt }
  | { readonly kind: "STORAGE_ERROR" };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let attemptSerial = 0;

function validUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function hideShare(): void {
  try { void wx.hideShareMenu(); } catch { /* platform unavailable during teardown */ }
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

function attendanceLabel(value: OpenGameAttendanceRosterItem["attendanceStatus"]): string {
  if (value === "PRESENT") return "已到场";
  if (value === "NO_SHOW") return "未到场";
  return "待记录";
}

function recordedTimeLabel(value: string | null, timeZone: string): string {
  return value === null ? "" : `${formatOpenGameDateTime(value, timeZone)} 记录`;
}

function correctedTimeLabel(value: string | null, timeZone: string): string {
  return value === null ? "" : `平台已纠正 · ${formatOpenGameDateTime(value, timeZone)}`;
}

function projectRegistrations(roster: OpenGameAttendanceRoster, canManage: boolean) {
  return roster.registrations.map((registration) => ({
    registrationId: registration.registrationId,
    displayName: registration.displayName,
    positionLabel: openGamePositionLabel(registration.position),
    attendanceStatus: registration.attendanceStatus,
    attendanceRecordedAt: registration.attendanceRecordedAt,
    attendanceCorrectedAt: registration.attendanceCorrectedAt,
    version: registration.version,
    isUnmarked: registration.attendanceStatus === "UNMARKED",
    canMark: canManage && registration.attendanceStatus === "UNMARKED",
    resultLabel: attendanceLabel(registration.attendanceStatus),
    recordedTimeLabel: recordedTimeLabel(
      registration.attendanceRecordedAt,
      roster.game.timeZone,
    ),
    correctedTimeLabel: correctedTimeLabel(
      registration.attendanceCorrectedAt,
      roster.game.timeZone,
    ),
  }));
}

function projectGame(roster: OpenGameAttendanceRoster) {
  return {
    gameName: roster.game.name,
    dateTimeLabel: formatOpenGameRange(
      roster.game.startsAt,
      roster.game.endsAt,
      roster.game.timeZone,
    ),
    placeLabel: `${roster.game.venueName} · ${roster.game.pitchName}`,
  };
}

function blankData() {
  return {
    status: "LOADING" as AttendancePageStatus,
    gameId: "",
    game: null as ReturnType<typeof projectGame> | null,
    roster: [] as ReturnType<typeof projectRegistrations>,
    progressLabel: "已记录 0 / 0",
    isEmpty: false,
    isComplete: false,
    completionMessage: "本场散客到场记录已完成",
    emptyMessage: "本场没有需要记录的散客",
    errorMessage: "",
    noticeMessage: "",
    navigationError: "",
    copyFeedbackRegistrationId: "",
    copyFeedbackMessage: "",
    copyFeedbackKind: "" as "" | "pending" | "success" | "error",
    pendingRoute: "",
    decisionPanel: null as {
      readonly registrationId: string;
      readonly attendanceStatus: OpenGameAttendanceMarkStatus;
    } | null,
    decisionTitle: "",
    decisionPlayerName: "",
    decisionWarning: "确认后本页不能自行修改。",
    confirmButtonLabel: "",
    headerTopPx: 0,
    headerRowHeightPx: 44,
  };
}

function sameAttendanceAttempt(
  left: OpenGameAttendanceMarkAttempt,
  right: OpenGameAttendanceMarkAttempt,
): boolean {
  return left.originatingUserId === right.originatingUserId
    && left.gameId === right.gameId
    && left.registrationId === right.registrationId
    && left.attendanceStatus === right.attendanceStatus
    && left.expectedVersion === right.expectedVersion
    && left.idempotencyKey === right.idempotencyKey;
}

function markResultMatches(
  attempt: OpenGameAttendanceMarkAttempt,
  result: OpenGameAttendanceMarkResult,
): boolean {
  const expectedVersion = attempt.expectedVersion + 1;
  return Number.isSafeInteger(expectedVersion)
    && result.registrationId === attempt.registrationId
    && result.attendanceStatus === attempt.attendanceStatus
    && result.version === expectedVersion;
}

Page({
  data: blankData(),
  loadGeneration: 0,
  visible: true,
  skipNextShow: false,
  routeGameId: "",
  currentRoster: null as OpenGameAttendanceRoster | null,
  authorityUserId: null as string | null,
  decisionSelection: null as FrozenAttendanceDecision | null,
  unknownAttempt: null as OpenGameAttendanceMarkAttempt | null,
  pendingRoute: "",
  readInFlight: null as Promise<void> | null,
  mutationInFlight: null as Promise<void> | null,
  navigationInFlight: null as Promise<void> | null,
  copyGeneration: 0,

  onLoad(options: PageOptions = {}) {
    this.visible = true;
    this.skipNextShow = true;
    this.currentRoster = null;
    this.authorityUserId = null;
    this.decisionSelection = null;
    this.unknownAttempt = null;
    this.pendingRoute = "";
    this.readInFlight = null;
    this.mutationInFlight = null;
    this.navigationInFlight = null;
    this.copyGeneration += 1;
    hideShare();
    const header = headerData();
    if (Object.keys(options).length !== 1 || !validUuid(options.game_id)) {
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
    this.setData({ ...blankData(), ...header, gameId: options.game_id });
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
    this.copyGeneration += 1;
    this.readInFlight = null;
    this.decisionSelection = null;
    this.setData({ decisionPanel: null });
  },

  onUnload() {
    this.visible = false;
    this.loadGeneration += 1;
    this.copyGeneration += 1;
    this.readInFlight = null;
    this.decisionSelection = null;
  },

  active(generation: number): boolean {
    return this.visible && generation === this.loadGeneration;
  },

  currentUserId(): string | null {
    try {
      const userId = getOpenGameRegistrationSource().currentUserId();
      return validUuid(userId) ? userId : null;
    } catch {
      return null;
    }
  },

  applyRoster(
    roster: OpenGameAttendanceRoster,
    status: AttendancePageStatus,
    errorMessage = "",
    noticeMessage = "",
  ) {
    this.copyGeneration += 1;
    this.currentRoster = roster;
    this.decisionSelection = null;
    this.setData({
      status,
      gameId: roster.game.id,
      game: projectGame(roster),
      roster: projectRegistrations(roster, status === "READY"),
      progressLabel: `已记录 ${roster.recordedCount} / ${roster.totalCount}`,
      isEmpty: roster.totalCount === 0,
      isComplete: roster.totalCount > 0 && roster.attendanceComplete,
      errorMessage,
      noticeMessage,
      pendingRoute: "",
      decisionPanel: null,
    });
  },

  setStatus(status: AttendancePageStatus, errorMessage: string) {
    const patch: Record<string, unknown> = { status, errorMessage, decisionPanel: null };
    if (this.currentRoster !== null) {
      patch.roster = projectRegistrations(this.currentRoster, status === "READY");
      patch.isEmpty = this.currentRoster.totalCount === 0;
      patch.isComplete = this.currentRoster.totalCount > 0
        && this.currentRoster.attendanceComplete;
    }
    this.setData(patch);
  },

  loadAuthority(noticeMessage = ""): Promise<void> {
    if (!this.routeGameId) return Promise.resolve();
    if (this.readInFlight !== null) return this.readInFlight;
    const generation = ++this.loadGeneration;
    this.decisionSelection = null;
    this.setStatus("LOADING", "");
    this.setData({ noticeMessage, navigationError: "" });
    const promise = (async () => {
      try {
        const roster = await getOpenGameRegistrationSource()
          .getAttendanceRoster(this.routeGameId);
        if (!this.active(generation)) return;
        this.applyRoster(roster, "READY", "", noticeMessage);
        this.inspectPendingAttempt();
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

  inspectPendingAttempt() {
    const userId = this.currentUserId();
    this.authorityUserId = userId;
    let pending: OpenGameRegistrationAttempt | null;
    try {
      pending = getOpenGameRegistrationAttemptStore().load();
    } catch {
      this.setStatus("LOAD_ERROR", "本机到场记录暂时无法读取，没有发送新的操作。");
      return;
    }
    if (pending !== null) {
      this.presentPendingAttempt(pending, userId);
      return;
    }
    this.unknownAttempt = null;
    if (userId === null) {
      this.setStatus("AUTH_LOSS", "登录状态需要恢复，页面不会记录任何到场结果。");
      return;
    }
    if (this.currentRoster !== null) {
      this.applyRoster(this.currentRoster, "READY", "", this.data.noticeMessage);
    }
  },

  handleReadError(caught: unknown) {
    if (this.presentBlockingPendingAttemptAfterReadFailure()) return;
    if (caught instanceof OpenGameRegistrationApiError && caught.code === "AUTH_REQUIRED") {
      this.setStatus("AUTH_LOSS", "登录状态已失效；未确认的到场记录仍会保留。");
      return;
    }
    if (caught instanceof OpenGameRegistrationApiError && caught.code === "OPEN_GAME_NOT_FOUND") {
      this.clearOwnedAttemptForMissingGame();
      this.setStatus("NOT_FOUND", "没有找到这场球局，或你无权查看。");
      return;
    }
    this.setStatus("LOAD_ERROR", "散客名单暂时没有加载出来，请稍后重试。");
  },

  presentBlockingPendingAttemptAfterReadFailure(): boolean {
    let pending: OpenGameRegistrationAttempt | null;
    try {
      pending = getOpenGameRegistrationAttemptStore().load();
    } catch {
      this.setStatus("LOAD_ERROR", "本机到场记录暂时无法读取，没有发送新的操作。");
      return true;
    }
    if (pending === null) return false;
    const userId = this.currentUserId();
    const decision = classifyOpenGameRegistrationPendingAttempt(
      pending,
      userId,
      { kind: "attendance", gameId: this.routeGameId },
    );
    if (decision.kind === "READY") return false;
    this.presentPendingAttempt(pending, userId);
    return true;
  },

  clearOwnedAttemptForMissingGame() {
    let pending: OpenGameRegistrationAttempt | null;
    try {
      pending = getOpenGameRegistrationAttemptStore().load();
    } catch {
      return;
    }
    const userId = this.currentUserId();
    if (pending?.kind === "attendance"
      && pending.gameId === this.routeGameId
      && pending.originatingUserId === userId) {
      try { getOpenGameRegistrationAttemptStore().clear(); } catch { /* clear on a later visit */ }
    }
  },

  presentPendingAttempt(attempt: OpenGameRegistrationAttempt, userId: string | null) {
    const decision = classifyOpenGameRegistrationPendingAttempt(
      attempt,
      userId,
      { kind: "attendance", gameId: this.routeGameId },
    );
    this.decisionSelection = null;
    this.setData({ decisionPanel: null });
    if (decision.kind === "PRESERVE_LOGIN_COMPARE_ACCOUNT") {
      this.setStatus("AUTH_LOSS", "请恢复原账号后确认上一项到场记录。");
      return;
    }
    if (decision.kind === "FOREIGN_ACCOUNT_PENDING") {
      this.unknownAttempt = null;
      this.setStatus("FOREIGN_PENDING", "本机有另一账号尚未确认的操作，绝不会用当前账号重放。");
      return;
    }
    if (decision.kind === "PRESERVE_AND_NAVIGATE") {
      this.unknownAttempt = null;
      this.pendingRoute = decision.route;
      this.setStatus("OTHER_PENDING", "请先确认本机上一项操作，再记录本场名单。");
      this.setData({ pendingRoute: decision.route });
      return;
    }
    if (decision.attempt.kind !== "attendance") return;
    this.unknownAttempt = decision.attempt;
    this.setStatus("RESULT_UNKNOWN", "检测到原记录结果尚未确认，请复用原记录确认结果。");
  },

  openDecision(registrationId: unknown, attendanceStatus: OpenGameAttendanceMarkStatus) {
    if (this.data.status !== "READY" || this.mutationInFlight !== null
      || !validUuid(registrationId) || this.currentRoster === null) return;
    const registration = this.currentRoster.registrations.find(
      (item) => item.registrationId === registrationId,
    );
    if (registration?.attendanceStatus !== "UNMARKED") return;
    this.decisionSelection = {
      registrationId,
      attendanceStatus,
      expectedVersion: registration.version,
    };
    this.setData({
      decisionPanel: { registrationId, attendanceStatus },
      decisionTitle: attendanceStatus === "PRESENT" ? "确认已到场？" : "确认未到场？",
      decisionPlayerName: registration.displayName,
      decisionWarning: "确认后本页不能自行修改。",
      confirmButtonLabel: attendanceStatus === "PRESENT" ? "确认到场" : "确认未到场",
      navigationError: "",
    });
  },

  onMarkPresent(event: AttendanceEvent) {
    this.openDecision(event.currentTarget?.dataset?.registrationId, "PRESENT");
  },

  onMarkNoShow(event: AttendanceEvent) {
    this.openDecision(event.currentTarget?.dataset?.registrationId, "NO_SHOW");
  },

  onCopyRegistrationId(event: AttendanceEvent) {
    const registrationId = event.currentTarget?.dataset?.registrationId;
    if (!validUuid(registrationId)
      || !this.data.roster.some((item) => item.registrationId === registrationId)) return;
    const generation = ++this.copyGeneration;
    this.setData({
      copyFeedbackRegistrationId: registrationId,
      copyFeedbackMessage: "正在复制…",
      copyFeedbackKind: "pending",
    });
    const settle = (message: string, kind: "success" | "error") => {
      if (!this.visible || generation !== this.copyGeneration) return;
      this.setData({
        copyFeedbackRegistrationId: registrationId,
        copyFeedbackMessage: message,
        copyFeedbackKind: kind,
      });
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

  onCloseDecision() {
    if (this.mutationInFlight !== null) return;
    this.decisionSelection = null;
    this.setData({ decisionPanel: null });
  },

  onConfirmDecision() {
    if (this.mutationInFlight !== null) return this.mutationInFlight;
    const frozen = this.decisionSelection;
    const registration = frozen === null || this.currentRoster === null
      ? undefined
      : this.currentRoster.registrations.find(
        (item) => item.registrationId === frozen.registrationId,
      );
    if (frozen === null
      || registration?.attendanceStatus !== "UNMARKED"
      || registration.version !== frozen.expectedVersion
      || this.data.status !== "READY") {
      this.decisionSelection = null;
      this.setData({
        decisionPanel: null,
        noticeMessage: "名单或允许操作已变化，请以当前名单为准。",
      });
      return Promise.resolve();
    }
    const userId = this.currentUserId();
    if (userId === null || userId !== this.authorityUserId) {
      this.decisionSelection = null;
      this.setStatus("AUTH_LOSS", "登录账号已变化，请重新登录并读取名单。");
      return Promise.resolve();
    }
    const requested: OpenGameAttendanceMarkAttempt = {
      kind: "attendance",
      originatingUserId: userId,
      gameId: this.routeGameId,
      registrationId: frozen.registrationId,
      attendanceStatus: frozen.attendanceStatus,
      expectedVersion: frozen.expectedVersion,
      idempotencyKey: `attendance-${Date.now()}-${String(++attemptSerial).padStart(6, "0")}`,
    };
    let availability;
    try {
      availability = getOpenGameRegistrationAttemptStore().begin(requested);
    } catch {
      this.decisionSelection = null;
      this.setStatus("LOAD_ERROR", "无法安全保存到场记录，本次操作尚未发送。");
      return Promise.resolve();
    }
    this.decisionSelection = null;
    this.setData({ decisionPanel: null });
    if (availability.kind !== "READY") {
      this.presentPendingAttempt(availability.attempt, userId);
      return Promise.resolve();
    }
    if (availability.attempt.kind !== "attendance") return Promise.resolve();
    this.unknownAttempt = availability.attempt;
    const promise = this.executeAttendance(availability.attempt).finally(() => {
      if (this.mutationInFlight === promise) this.mutationInFlight = null;
    });
    this.mutationInFlight = promise;
    return promise;
  },

  async executeAttendance(attempt: OpenGameAttendanceMarkAttempt) {
    const generation = this.loadGeneration;
    this.setStatus("MARKING", "正在保存到场记录，请勿重复操作。");
    try {
      const result = await getOpenGameRegistrationSource().markAttendance(attempt);
      if (!this.active(generation)) return;
      if (!markResultMatches(attempt, result)) {
        this.setUnknownResult(attempt, "记录响应尚不能确认，请复用原记录确认结果。");
        return;
      }
      let authority: OpenGameAttendanceRoster;
      try {
        authority = await getOpenGameRegistrationSource()
          .getAttendanceRoster(this.routeGameId);
      } catch {
        if (!this.active(generation)) return;
        this.setUnknownResult(attempt, "记录已返回，最新名单暂未确认，请再次确认结果。");
        return;
      }
      if (!this.active(generation)) return;
      const recovery = classifyOpenGameAttendanceUnknownResult(attempt, authority);
      if (recovery.kind !== "ACCEPT_AUTHORITY_AND_CLEAR") {
        this.applyRoster(
          authority,
          "RESULT_UNKNOWN",
          "记录已返回，但权威名单尚未体现结果，请再次确认。",
        );
        this.unknownAttempt = attempt;
        return;
      }
      const reconciliation = this.reconcileAttempt(attempt);
      if (reconciliation.kind === "STORAGE_ERROR") {
        this.applyRoster(authority, "RESULT_UNKNOWN", "本机确认记录暂时无法更新，请再次确认。");
        this.unknownAttempt = attempt;
        return;
      }
      if (reconciliation.kind === "REPLACED") {
        this.applyRoster(authority, "READY");
        this.presentPendingAttempt(reconciliation.attempt, this.currentUserId());
        return;
      }
      this.unknownAttempt = null;
      this.applyRoster(authority, "READY", "", "已保存到场记录并读取最新名单。");
    } catch (caught) {
      if (!this.active(generation)) return;
      await this.handleMutationError(attempt, caught);
    }
  },

  setUnknownResult(attempt: OpenGameAttendanceMarkAttempt, message: string) {
    this.unknownAttempt = attempt;
    this.setStatus("RESULT_UNKNOWN", message);
  },

  reconcileAttempt(attempt: OpenGameAttendanceMarkAttempt): AttemptReconciliation {
    try {
      const current = getOpenGameRegistrationAttemptStore().load();
      if (current === null) return { kind: "MISSING" };
      if (current.kind !== "attendance" || !sameAttendanceAttempt(current, attempt)) {
        return { kind: "REPLACED", attempt: current };
      }
      getOpenGameRegistrationAttemptStore().clear();
      return { kind: "CLEARED" };
    } catch {
      return { kind: "STORAGE_ERROR" };
    }
  },

  async handleMutationError(attempt: OpenGameAttendanceMarkAttempt, caught: unknown) {
    if (!(caught instanceof OpenGameRegistrationApiError)) {
      this.setUnknownResult(attempt, "记录结果暂时未知，请确认后再继续。");
      return;
    }
    const recovery = classifyOpenGameRegistrationMutationResult(caught.code);
    if (recovery.kind === "PRESERVE_LOGIN_COMPARE_ACCOUNT") {
      this.setUnknownResult(attempt, "登录状态需要恢复，原记录已保留。");
      this.setStatus("AUTH_LOSS", "登录状态需要恢复，原记录已保留。");
      return;
    }
    if (recovery.kind === "PRESERVE_APPLICATION_RESULT_UNKNOWN"
      || recovery.kind === "RETRY_READ") {
      this.setUnknownResult(attempt, "记录结果暂时未知，请复用原记录确认结果。");
      return;
    }
    if (recovery.clearAttempt) {
      const reconciliation = this.reconcileAttempt(attempt);
      if (reconciliation.kind === "STORAGE_ERROR") {
        this.setUnknownResult(attempt, "暂时无法安全更新本机记录，请再次确认结果。");
        return;
      }
      if (reconciliation.kind === "REPLACED") {
        this.presentPendingAttempt(reconciliation.attempt, this.currentUserId());
        return;
      }
    }
    this.unknownAttempt = null;
    if (recovery.kind === "CLEAR_AND_REFRESH_ROSTER") {
      await this.refreshConflict("名单状态已变化，请确认最新名单。");
      return;
    }
    if (recovery.kind === "CLEAR_AND_CORRECT_OR_REFRESH") {
      await this.loadAuthority("记录参数已变化，已读取最新名单。");
      return;
    }
    if (recovery.kind === "CLEAR_AND_RETURN") {
      if (caught.code === "APPLICATION_NOT_FOUND") {
        await this.loadAuthority("这位球员已不在当前散客名单中。");
      } else {
        this.setStatus("NOT_FOUND", "球局已不可用，本次记录没有确认成功。");
      }
      return;
    }
    if (recovery.kind === "CLEAR_AND_SHOW_CONFLICT") {
      await this.refreshConflict("本次记录发生冲突，请确认最新名单。");
      return;
    }
    this.setUnknownResult(attempt, "记录结果暂时未知，请稍后确认。");
  },

  async refreshConflict(message: string) {
    const generation = ++this.loadGeneration;
    try {
      const authority = await getOpenGameRegistrationSource()
        .getAttendanceRoster(this.routeGameId);
      if (!this.active(generation)) return;
      this.applyRoster(authority, "CONFLICT", message);
    } catch (caught) {
      if (!this.active(generation)) return;
      this.handleReadError(caught);
    }
  },

  onConfirmUnknownResult() {
    if (this.mutationInFlight !== null) return this.mutationInFlight;
    let durable: OpenGameRegistrationAttempt | null;
    try {
      durable = getOpenGameRegistrationAttemptStore().load();
    } catch {
      this.setStatus("LOAD_ERROR", "本机到场记录暂时无法读取，没有发送新的操作。");
      return Promise.resolve();
    }
    if (durable === null) return this.loadAuthority();
    const userId = this.currentUserId();
    const classification = classifyOpenGameRegistrationPendingAttempt(
      durable,
      userId,
      { kind: "attendance", gameId: this.routeGameId },
    );
    if (classification.kind !== "READY" || classification.attempt.kind !== "attendance") {
      this.presentPendingAttempt(durable, userId);
      return Promise.resolve();
    }
    const attempt = classification.attempt;
    if (this.unknownAttempt !== null && !sameAttendanceAttempt(this.unknownAttempt, attempt)) {
      this.presentPendingAttempt(durable, userId);
      return Promise.resolve();
    }
    const generation = this.loadGeneration;
    const promise = (async () => {
      let authority: OpenGameAttendanceRoster;
      try {
        authority = await getOpenGameRegistrationSource()
          .getAttendanceRoster(this.routeGameId);
      } catch (caught) {
        if (!this.active(generation)) return;
        this.handleReadError(caught);
        if (this.data.status === "LOAD_ERROR") {
          this.setUnknownResult(attempt, "暂时无法读取权威名单，请稍后确认原记录。");
        }
        return;
      }
      if (!this.active(generation)) return;
      const decision = classifyOpenGameAttendanceUnknownResult(attempt, authority);
      if (decision.kind === "REPLAY_SAME_ATTEMPT") {
        this.currentRoster = authority;
        await this.executeAttendance(decision.attempt);
        return;
      }
      const reconciliation = this.reconcileAttempt(attempt);
      if (reconciliation.kind === "STORAGE_ERROR") {
        this.applyRoster(authority, "RESULT_UNKNOWN", "本机确认记录暂时无法更新，请再次确认。");
        this.unknownAttempt = attempt;
        return;
      }
      if (reconciliation.kind === "REPLACED") {
        this.applyRoster(authority, "READY");
        this.presentPendingAttempt(reconciliation.attempt, userId);
        return;
      }
      this.unknownAttempt = null;
      this.applyRoster(authority, "READY", "", "已按权威名单确认原记录。");
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
          this.setStatus("FOREIGN_PENDING", "登录账号与原操作账号不同，绝不会重放原记录。");
          return;
        }
        await this.loadAuthority();
      } catch {
        if (!this.active(generation)) return;
        this.setStatus("AUTH_LOSS", "登录失败，请重试；原记录仍会保留。");
      }
    })().finally(() => {
      if (this.mutationInFlight === promise) this.mutationInFlight = null;
    });
    this.mutationInFlight = promise;
    return promise;
  },

  onRetryLoad() {
    this.visible = true;
    return this.loadAuthority();
  },

  onResolveConflict() {
    this.visible = true;
    return this.loadAuthority("已读取最新名单。");
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
          // The deterministic manage route remains available below.
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

  onHeaderBack() {
    return this.returnToManage();
  },

  onReturnManage() {
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

  onBlockTouchMove() {},
});
