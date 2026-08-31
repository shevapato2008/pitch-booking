import type {
  OpenGameMemberRemovalBlockedReason,
  OpenGameMemberRemovalResult,
  OpenGameMemberRoster,
} from "../../domain/open-game-registration";
import { validateOpenGameMemberRemovalReason } from "../../domain/open-game-registration-decoder";
import { formatOpenGameRange, openGamePositionLabel } from "../../presentation/open-game";
import { readIntentHeaderLayout } from "../../presentation/intent-header-layout";
import { OpenGameRegistrationApiError } from "../../services/http-open-game-registration";
import {
  classifyOpenGameMemberRemovalUnknownResult,
  classifyOpenGameRegistrationPendingAttempt,
  getOpenGameRegistrationAttemptStore,
  getOpenGameRegistrationSource,
  type OpenGameMemberRemoveAttempt,
  type OpenGameRegistrationAttempt,
} from "../../services/open-game-registration";

interface PageOptions { game_id?: unknown; }
interface MemberEvent { currentTarget?: { dataset?: { registrationId?: unknown } }; }
interface ReasonEvent { detail?: { value?: unknown }; }

type MemberPageStatus =
  | "LOADING"
  | "READY"
  | "REMOVING"
  | "LOAD_ERROR"
  | "AUTH_LOSS"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RESULT_UNKNOWN"
  | "OTHER_PENDING"
  | "FOREIGN_PENDING";

interface FrozenRemoval {
  readonly registrationId: string;
  readonly displayName: string;
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

function blockedLabel(reason: OpenGameMemberRemovalBlockedReason | null): string {
  if (reason === "ATTENDANCE_RECORDED") return "已记录到场，不能移除";
  if (reason === "ORDER_AUTHORITY_UNHEALTHY") return "订单状态暂不支持";
  if (reason === "GAME_STARTED") return "已到开场时间";
  if (reason === "GAME_SUSPENDED") return "球局已暂停";
  if (reason === "GAME_CANCELLED") return "球局已取消";
  if (reason === "GAME_COMPLETED") return "球局已结束";
  if (reason === "GAME_NOT_PUBLISHED") return "球局尚未发布";
  return "当前不能移除";
}

function joinedTimeLabel(value: string, timeZone: string): string {
  const label = formatOpenGameRange(value, value, timeZone);
  const match = label.match(/^(.*) · (\d{2}:\d{2})–/);
  return match ? `${match[1]} ${match[2]} 加入` : "加入时间待确认";
}

function projectMembers(roster: OpenGameMemberRoster, canManage: boolean) {
  return roster.members.map((member) => ({
    registrationId: member.registrationId,
    displayName: member.displayName,
    positionLabel: openGamePositionLabel(member.position),
    sourceLabel: member.promotedFromWaitlist ? "候补递补加入" : "审核通过加入",
    joinedTimeLabel: joinedTimeLabel(member.joinedAt, roster.game.timeZone),
    version: member.version,
    canRemove: canManage && member.allowedActions.canRemove,
    blockedLabel: member.allowedActions.canRemove
      ? ""
      : blockedLabel(member.allowedActions.removeBlockedReason),
  }));
}

function projectGame(roster: OpenGameMemberRoster) {
  return {
    gameName: roster.game.name,
    dateTimeLabel: formatOpenGameRange(
      roster.game.startsAt,
      roster.game.endsAt,
      roster.game.timeZone,
    ),
    placeLabel: `${roster.game.venueName} · ${roster.game.pitchName}`,
    state: roster.game.state,
  };
}

function blankData() {
  return {
    status: "LOADING" as MemberPageStatus,
    gameId: "",
    game: null as ReturnType<typeof projectGame> | null,
    members: [] as ReturnType<typeof projectMembers>,
    summaryLabel: "已加入 0 人 · 空缺 0 人 · 候补 0 人",
    isEmpty: false,
    errorMessage: "",
    noticeMessage: "",
    navigationError: "",
    pendingRoute: "",
    removalPanel: null as { readonly registrationId: string } | null,
    removalMemberName: "",
    reasonInput: "",
    reasonCount: 0,
    reasonError: "",
    confirmDisabled: true,
    confirmButtonLabel: "确认移除",
    headerTopPx: 0,
    headerRowHeightPx: 44,
  };
}

function sameRemovalAttempt(
  left: OpenGameMemberRemoveAttempt,
  right: OpenGameMemberRemoveAttempt,
): boolean {
  return left.originatingUserId === right.originatingUserId
    && left.gameId === right.gameId
    && left.registrationId === right.registrationId
    && left.expectedVersion === right.expectedVersion
    && left.reason === right.reason
    && left.idempotencyKey === right.idempotencyKey;
}

function removalResultMatches(
  attempt: OpenGameMemberRemoveAttempt,
  result: OpenGameMemberRemovalResult,
): boolean {
  const expectedVersion = attempt.expectedVersion + 1;
  return Number.isSafeInteger(expectedVersion)
    && result.removedRegistrationId === attempt.registrationId
    && result.status === "REMOVED"
    && result.version === expectedVersion;
}

function successMessage(result: OpenGameMemberRemovalResult): string {
  const outcome = result.promotedMember === null
    ? "本场新增 1 个空缺名额。"
    : `候补第 1 位${result.promotedMember.displayName}已加入。`;
  return `已移除${result.removedDisplayName}；${outcome}`;
}

Page({
  data: blankData(),
  loadGeneration: 0,
  visible: true,
  skipNextShow: false,
  routeGameId: "",
  currentRoster: null as OpenGameMemberRoster | null,
  authorityUserId: null as string | null,
  removalSelection: null as FrozenRemoval | null,
  unknownAttempt: null as OpenGameMemberRemoveAttempt | null,
  pendingRoute: "",
  readInFlight: null as Promise<void> | null,
  mutationInFlight: null as Promise<void> | null,
  navigationInFlight: null as Promise<void> | null,

  onLoad(options: PageOptions = {}) {
    this.visible = true;
    this.skipNextShow = true;
    this.loadGeneration += 1;
    this.currentRoster = null;
    this.authorityUserId = null;
    this.removalSelection = null;
    this.unknownAttempt = null;
    this.pendingRoute = "";
    this.readInFlight = null;
    this.mutationInFlight = null;
    this.navigationInFlight = null;
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
    if (this.skipNextShow) { this.skipNextShow = false; return; }
    this.visible = true;
    if (this.routeGameId) void this.loadAuthority();
  },

  onHide() {
    this.visible = false;
    this.loadGeneration += 1;
    this.readInFlight = null;
    this.removalSelection = null;
    this.setData({ removalPanel: null });
  },

  onUnload() {
    this.visible = false;
    this.loadGeneration += 1;
    this.readInFlight = null;
    this.removalSelection = null;
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
    roster: OpenGameMemberRoster,
    status: MemberPageStatus = "READY",
    errorMessage = "",
    noticeMessage = "",
  ) {
    this.currentRoster = roster;
    this.removalSelection = null;
    this.setData({
      status,
      gameId: roster.game.id,
      game: projectGame(roster),
      members: projectMembers(roster, status === "READY"),
      summaryLabel: `已加入 ${roster.joinedCount} 人 · 空缺 ${roster.remainingSpots} 人 · 候补 ${roster.waitlistCount} 人`,
      isEmpty: roster.members.length === 0,
      errorMessage,
      noticeMessage,
      navigationError: "",
      pendingRoute: "",
      removalPanel: null,
      removalMemberName: "",
      reasonInput: "",
      reasonCount: 0,
      reasonError: "",
      confirmDisabled: true,
      confirmButtonLabel: "确认移除",
    });
  },

  setStatus(status: MemberPageStatus, errorMessage: string) {
    const patch: Record<string, unknown> = {
      status,
      errorMessage,
      confirmDisabled: status !== "READY",
      confirmButtonLabel: status === "REMOVING" ? "正在移除…" : "确认移除",
    };
    if (this.currentRoster !== null) {
      patch.members = projectMembers(this.currentRoster, status === "READY");
    }
    this.setData(patch);
  },

  loadAuthority(noticeMessage = ""): Promise<void> {
    if (!this.routeGameId) return Promise.resolve();
    if (this.readInFlight !== null) return this.readInFlight;
    const generation = ++this.loadGeneration;
    this.setStatus("LOADING", "");
    this.setData({ noticeMessage, navigationError: "", removalPanel: null });
    this.removalSelection = null;
    const promise = (async () => {
      try {
        const roster = await getOpenGameRegistrationSource().getMembers(this.routeGameId);
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
      this.setStatus("LOAD_ERROR", "本机移除记录暂时无法读取，没有发送新的操作。");
      return;
    }
    if (pending !== null) {
      this.presentPendingAttempt(pending, userId);
      return;
    }
    this.unknownAttempt = null;
    if (userId === null) {
      this.setStatus("AUTH_LOSS", "登录状态需要恢复，页面不会发送移除操作。");
      return;
    }
    if (this.currentRoster !== null) {
      this.applyRoster(this.currentRoster, "READY", "", this.data.noticeMessage);
    }
  },

  handleReadError(caught: unknown) {
    if (caught instanceof OpenGameRegistrationApiError && caught.code === "AUTH_REQUIRED") {
      this.setStatus("AUTH_LOSS", "登录状态已失效；未确认的移除操作仍会保留。");
      return;
    }
    if (caught instanceof OpenGameRegistrationApiError && caught.code === "OPEN_GAME_NOT_FOUND") {
      this.clearOwnedAttemptForMissingGame();
      this.setStatus("NOT_FOUND", "没有找到这场球局，或你无权查看。");
      return;
    }
    this.setStatus("LOAD_ERROR", "成员名单暂时没有加载出来，请稍后重试。");
  },

  clearOwnedAttemptForMissingGame() {
    try {
      const pending = getOpenGameRegistrationAttemptStore().load();
      const userId = this.currentUserId();
      if (pending?.kind === "remove-member"
        && pending.gameId === this.routeGameId
        && pending.originatingUserId === userId) {
        getOpenGameRegistrationAttemptStore().clear();
      }
    } catch { /* clear on a later visit */ }
  },

  presentPendingAttempt(attempt: OpenGameRegistrationAttempt, userId: string | null) {
    const decision = classifyOpenGameRegistrationPendingAttempt(
      attempt,
      userId,
      { kind: "remove-member", gameId: this.routeGameId },
    );
    this.removalSelection = null;
    this.setData({ removalPanel: null });
    if (decision.kind === "PRESERVE_LOGIN_COMPARE_ACCOUNT") {
      this.setStatus("AUTH_LOSS", "请恢复原账号后确认上一项移除操作。");
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
      this.setStatus("OTHER_PENDING", "请先确认本机上一项操作，再管理本场成员。");
      this.setData({ pendingRoute: decision.route });
      return;
    }
    if (decision.attempt.kind !== "remove-member") return;
    this.unknownAttempt = decision.attempt;
    this.setStatus("RESULT_UNKNOWN", "检测到原移除结果尚未确认，请复用原操作确认结果。");
  },

  onOpenRemoval(event: MemberEvent) {
    const registrationId = event.currentTarget?.dataset?.registrationId;
    if (this.data.status !== "READY" || this.mutationInFlight !== null
      || !validUuid(registrationId) || this.currentRoster === null) return;
    const member = this.currentRoster.members.find(
      (candidate) => candidate.registrationId === registrationId,
    );
    if (!member?.allowedActions.canRemove) return;
    this.removalSelection = {
      registrationId,
      displayName: member.displayName,
      expectedVersion: member.version,
    };
    this.setData({
      removalPanel: { registrationId },
      removalMemberName: member.displayName,
      reasonInput: "",
      reasonCount: 0,
      reasonError: "",
      confirmDisabled: true,
      confirmButtonLabel: "确认移除",
      navigationError: "",
    });
  },

  onReasonInput(event: ReasonEvent) {
    if (this.removalSelection === null || this.mutationInFlight !== null) return;
    const value = typeof event.detail?.value === "string" ? event.detail.value : "";
    const validation = validateOpenGameMemberRemovalReason(value);
    this.setData({
      reasonInput: value,
      reasonCount: Array.from(value).length,
      reasonError: validation.valid || value.length === 0 ? "" : validation.error,
      confirmDisabled: !validation.valid,
    });
  },

  onCloseRemoval() {
    if (this.mutationInFlight !== null) return;
    this.removalSelection = null;
    this.setData({
      removalPanel: null,
      removalMemberName: "",
      reasonInput: "",
      reasonCount: 0,
      reasonError: "",
      confirmDisabled: true,
    });
  },

  onConfirmRemoval() {
    if (this.mutationInFlight !== null) return this.mutationInFlight;
    const frozen = this.removalSelection;
    const member = frozen === null || this.currentRoster === null
      ? undefined
      : this.currentRoster.members.find(
        (candidate) => candidate.registrationId === frozen.registrationId,
      );
    const validation = validateOpenGameMemberRemovalReason(this.data.reasonInput);
    if (!validation.valid) {
      this.setData({ reasonError: validation.error, confirmDisabled: true });
      return Promise.resolve();
    }
    if (frozen === null
      || member === undefined
      || member.version !== frozen.expectedVersion
      || !member.allowedActions.canRemove
      || this.data.status !== "READY") {
      this.removalSelection = null;
      this.setData({
        removalPanel: null,
        noticeMessage: "名单或允许操作已变化，请以当前名单为准。",
      });
      return Promise.resolve();
    }
    const userId = this.currentUserId();
    if (userId === null || userId !== this.authorityUserId) {
      this.removalSelection = null;
      this.setData({ removalPanel: null });
      this.setStatus("AUTH_LOSS", "登录账号已变化，请重新登录并读取名单。");
      return Promise.resolve();
    }
    const requested: OpenGameMemberRemoveAttempt = {
      kind: "remove-member",
      originatingUserId: userId,
      gameId: this.routeGameId,
      registrationId: frozen.registrationId,
      expectedVersion: frozen.expectedVersion,
      reason: validation.reason,
      idempotencyKey: `remove-member-${Date.now()}-${String(++attemptSerial).padStart(6, "0")}`,
    };
    let availability;
    try {
      availability = getOpenGameRegistrationAttemptStore().begin(requested);
    } catch {
      this.removalSelection = null;
      this.setData({ removalPanel: null });
      this.setStatus("LOAD_ERROR", "无法安全保存移除操作，本次操作尚未发送。");
      return Promise.resolve();
    }
    if (availability.kind !== "READY") {
      this.presentPendingAttempt(availability.attempt, userId);
      return Promise.resolve();
    }
    if (availability.attempt.kind !== "remove-member") return Promise.resolve();
    this.unknownAttempt = availability.attempt;
    const promise = this.executeRemoval(availability.attempt).finally(() => {
      if (this.mutationInFlight === promise) this.mutationInFlight = null;
    });
    this.mutationInFlight = promise;
    return promise;
  },

  async executeRemoval(attempt: OpenGameMemberRemoveAttempt) {
    const generation = this.loadGeneration;
    this.setStatus("REMOVING", "正在移除成员，请勿重复操作。");
    try {
      const result = await getOpenGameRegistrationSource().removeMember(attempt);
      if (!this.active(generation)) return;
      if (!removalResultMatches(attempt, result)) {
        this.setUnknownResult(attempt, "移除响应尚不能确认，请复用原操作确认结果。");
        return;
      }
      let authority: OpenGameMemberRoster;
      try {
        authority = await getOpenGameRegistrationSource().getMembers(this.routeGameId);
      } catch {
        if (!this.active(generation)) return;
        this.setUnknownResult(attempt, "移除已返回，最新名单暂未确认，请再次确认结果。");
        return;
      }
      if (!this.active(generation)) return;
      const recovery = classifyOpenGameMemberRemovalUnknownResult(attempt, authority);
      if (recovery.kind !== "ACCEPT_AUTHORITY_AND_CLEAR") {
        this.applyRoster(
          authority,
          "RESULT_UNKNOWN",
          "移除已返回，但权威名单尚未体现结果，请再次确认。",
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
      this.applyRoster(authority, "READY", "", successMessage(result));
    } catch (caught) {
      if (!this.active(generation)) return;
      await this.handleMutationError(attempt, caught);
    }
  },

  setUnknownResult(attempt: OpenGameMemberRemoveAttempt, message: string) {
    this.unknownAttempt = attempt;
    this.removalSelection = null;
    this.setData({ removalPanel: null });
    this.setStatus("RESULT_UNKNOWN", message);
  },

  reconcileAttempt(attempt: OpenGameMemberRemoveAttempt): AttemptReconciliation {
    try {
      const current = getOpenGameRegistrationAttemptStore().load();
      if (current === null) return { kind: "MISSING" };
      if (current.kind !== "remove-member" || !sameRemovalAttempt(current, attempt)) {
        return { kind: "REPLACED", attempt: current };
      }
      getOpenGameRegistrationAttemptStore().clear();
      return { kind: "CLEARED" };
    } catch {
      return { kind: "STORAGE_ERROR" };
    }
  },

  async handleMutationError(attempt: OpenGameMemberRemoveAttempt, caught: unknown) {
    if (!(caught instanceof OpenGameRegistrationApiError)) {
      this.setUnknownResult(attempt, "移除结果暂时未知，请确认后再继续。");
      return;
    }
    if (caught.code === "AUTH_REQUIRED" || caught.code === "LOGIN_FAILED") {
      this.setUnknownResult(attempt, "登录状态需要恢复，原移除操作已保留。");
      this.setStatus("AUTH_LOSS", "登录状态需要恢复，原移除操作已保留。");
      return;
    }
    if (caught.code === "APPLICATION_RESULT_UNKNOWN" || caught.code === "SERVICE_UNAVAILABLE") {
      this.setUnknownResult(attempt, "移除结果暂时未知，请复用原操作确认结果。");
      return;
    }
    const reconciliation = this.reconcileAttempt(attempt);
    if (reconciliation.kind === "STORAGE_ERROR") {
      this.setUnknownResult(attempt, "暂时无法安全更新本机记录，请再次确认结果。");
      return;
    }
    if (reconciliation.kind === "REPLACED") {
      this.presentPendingAttempt(reconciliation.attempt, this.currentUserId());
      return;
    }
    this.unknownAttempt = null;
    this.removalSelection = null;
    this.setData({ removalPanel: null });
    if (caught.code === "OPEN_GAME_NOT_FOUND") {
      this.setStatus("NOT_FOUND", "球局已不可用，本次移除没有确认成功。");
      return;
    }
    if (caught.code === "APPLICATION_NOT_FOUND") {
      await this.refreshConflict("这位成员已不在当前名单中，请确认最新名单。");
      return;
    }
    if (caught.code === "INVALID_ARGUMENT") {
      await this.loadAuthority("移除原因没有通过校验，请重新填写。");
      return;
    }
    await this.refreshConflict("名单或球局状态已变化，请确认最新名单。");
  },

  async refreshConflict(message: string) {
    const generation = ++this.loadGeneration;
    try {
      const authority = await getOpenGameRegistrationSource().getMembers(this.routeGameId);
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
      this.setStatus("LOAD_ERROR", "本机移除记录暂时无法读取，没有发送新的操作。");
      return Promise.resolve();
    }
    if (durable === null) return this.loadAuthority();
    const userId = this.currentUserId();
    const classification = classifyOpenGameRegistrationPendingAttempt(
      durable,
      userId,
      { kind: "remove-member", gameId: this.routeGameId },
    );
    if (classification.kind !== "READY" || classification.attempt.kind !== "remove-member") {
      this.presentPendingAttempt(durable, userId);
      return Promise.resolve();
    }
    const attempt = classification.attempt;
    if (this.unknownAttempt !== null && !sameRemovalAttempt(this.unknownAttempt, attempt)) {
      this.presentPendingAttempt(durable, userId);
      return Promise.resolve();
    }
    const generation = this.loadGeneration;
    const promise = (async () => {
      let authority: OpenGameMemberRoster;
      try {
        authority = await getOpenGameRegistrationSource().getMembers(this.routeGameId);
      } catch (caught) {
        if (!this.active(generation)) return;
        this.handleReadError(caught);
        if (this.data.status === "LOAD_ERROR") {
          this.setUnknownResult(attempt, "暂时无法读取权威名单，请稍后确认原操作。");
        }
        return;
      }
      if (!this.active(generation)) return;
      const decision = classifyOpenGameMemberRemovalUnknownResult(attempt, authority);
      if (decision.kind === "REPLAY_SAME_ATTEMPT") {
        this.currentRoster = authority;
        await this.executeRemoval(decision.attempt);
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
      this.applyRoster(authority, "READY", "", "已按权威名单确认原移除结果。");
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
          this.setStatus("FOREIGN_PENDING", "登录账号与原操作账号不同，绝不会重放原移除操作。");
          return;
        }
        await this.loadAuthority();
      } catch {
        if (!this.active(generation)) return;
        this.setStatus("AUTH_LOSS", "登录失败，请重试；原移除操作仍会保留。");
      }
    })().finally(() => {
      if (this.mutationInFlight === promise) this.mutationInFlight = null;
    });
    this.mutationInFlight = promise;
    return promise;
  },

  onRetryLoad() { this.visible = true; return this.loadAuthority(); },
  onResolveConflict() { this.visible = true; return this.loadAuthority("已读取最新名单。"); },

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
        } catch { /* deterministic fallback below */ }
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

  onHeaderBack() { return this.returnToManage(); },
  onReturnManage() { return this.returnToManage(); },

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
