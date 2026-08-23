import type { OpenGameEntry, OpenGameOwner } from "../../domain/open-game";
import {
  formatCents,
  formatOpenGameDateTime,
  formatOpenGameRange,
  openGameIntensityLabel,
  openGamePositionLabel,
  openGameStateLabel,
  openGameStateReasonLabel,
} from "../../presentation/open-game";
import { OpenGameApiError } from "../../services/http-open-game";
import {
  classifyOpenGameDefinitiveRecovery,
  classifyOpenGameUnknownRecovery,
  getOpenGameMutationAttemptStore,
  getOpenGameSource,
  type OpenGameMutationAttempt,
} from "../../services/open-game";

interface PageOptions { game_id?: unknown; }
type ManageStatus = "LOADING" | "READY" | "LOAD_ERROR" | "AUTH_LOSS" | "NOT_FOUND" | "MUTATING" | "MUTATION_UNKNOWN" | "FOREIGN_PENDING";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let attemptSerial = 0;

function isUuid(value: unknown): value is string { return typeof value === "string" && UUID_PATTERN.test(value); }
function currentPages(): readonly { route?: string }[] { return getCurrentPages() as unknown as readonly { route?: string }[]; }

function navigation(method: "navigateTo" | "redirectTo" | "reLaunch", url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = () => { if (!settled) { settled = true; resolve(); } };
    const fail = (error: unknown) => { if (!settled) { settled = true; reject(error); } };
    const options = { url, success: done, fail };
    const returned = method === "navigateTo" ? wx.navigateTo(options)
      : method === "redirectTo" ? wx.redirectTo(options) : wx.reLaunch(options);
    const thenable = returned as unknown as { then?: (yes: () => void, no: (error: unknown) => void) => void };
    if (typeof thenable?.then === "function") thenable.then(done, fail);
  });
}

function hideShare(): void { try { void wx.hideShareMenu(); } catch { /* platform unavailable during teardown */ } }
function blankData() {
  return {
    status: "LOADING" as ManageStatus,
    gameId: "",
    orderId: "",
    state: "",
    stateLabel: "",
    stateDescription: "",
    stateReasonText: "",
    panel: "" as "" | "publish" | "cancel",
    errorMessage: "",
    navigationError: "",
    shareError: "",
    pendingKind: "",
    canEdit: false,
    canPublish: false,
    canShare: false,
    canCancel: false,
    canPreview: false,
    share: null as OpenGameOwner["share"],
    order: null as OpenGameOwner["order"] | null,
    orderRange: "",
    name: "",
    teamName: "",
    peopleSummary: "",
    intensityLabel: "",
    positionsLabel: "",
    aaLabel: "",
    deadlineLabel: "",
    visibilityLabel: "",
    notes: "",
  };
}

Page({
  data: blankData(),
  loadGeneration: 0,
  mutationInFlight: null as Promise<void> | null,
  currentAttempt: null as OpenGameMutationAttempt | null,
  foreignAttempt: null as OpenGameMutationAttempt | null,
  owner: null as OpenGameOwner | null,
  visible: true,
  skipNextShow: false,

  onLoad(options: PageOptions = {}) {
    this.visible = true;
    this.skipNextShow = true;
    hideShare();
    if (!isUuid(options.game_id)) {
      this.setData({ ...blankData(), status: "NOT_FOUND", errorMessage: "球局不存在或你无权查看。" });
      return;
    }
    this.setData({ ...blankData(), gameId: options.game_id });
    void this.loadOwner(options.game_id);
  },

  onShow() {
    if (this.skipNextShow) { this.skipNextShow = false; return; }
    this.visible = true;
    if (this.data.gameId) void this.loadOwner(this.data.gameId);
  },
  onHide() { this.visible = false; this.loadGeneration += 1; },
  onUnload() { this.visible = false; this.loadGeneration += 1; },

  async loadOwner(gameId: string) {
    const generation = ++this.loadGeneration;
    this.setData({ status: "LOADING", errorMessage: "", navigationError: "" });
    try {
      const owner = await getOpenGameSource().getOwnedGame(gameId);
      if (!this.visible || generation !== this.loadGeneration) return;
      this.applyOwner(owner);
      this.restorePersistedAttempt();
    } catch (caught) {
      if (!this.visible || generation !== this.loadGeneration) return;
      this.clearCurrentAttemptForDefinitiveLoadError(caught);
      if (caught instanceof OpenGameApiError && caught.code === "AUTH_REQUIRED") this.setData({ status: "AUTH_LOSS", errorMessage: "登录状态已失效，请重新登录。" });
      else if (caught instanceof OpenGameApiError && caught.code === "OPEN_GAME_NOT_FOUND") this.setData({ status: "NOT_FOUND", errorMessage: "球局不存在或你无权查看。" });
      else this.setData({ status: "LOAD_ERROR", errorMessage: "加载失败，请稍后重试。" });
    }
  },

  clearCurrentAttemptForDefinitiveLoadError(caught: unknown) {
    if (!(caught instanceof OpenGameApiError)
      || (caught.code !== "AUTH_REQUIRED" && caught.code !== "ORDER_NOT_FOUND" && caught.code !== "OPEN_GAME_NOT_FOUND")) return;
    const attempt = getOpenGameMutationAttemptStore().load();
    if (!attempt || attempt.kind === "create" || attempt.gameId !== this.data.gameId) return;
    getOpenGameMutationAttemptStore().clear();
    this.currentAttempt = null; this.foreignAttempt = null;
  },

  applyOwner(owner: OpenGameOwner, message = "") {
    this.owner = owner;
    const stateDescription = owner.state === "DRAFT" ? "仅你可见，尚未公开或分享。"
      : owner.state === "PUBLISHED" ? "公开详情已可查看；申请加入功能尚未开放。"
        : owner.state === "SUSPENDED" ? "订单状态变化，球局已暂停招募。"
          : owner.state === "CANCELLED" ? "本次开放球局已取消；真实订场及订单状态未改变。"
            : "本场球局已结束，可查看公开详情。";
    this.setData({
      status: "READY", gameId: owner.id, orderId: owner.orderId, state: owner.state,
      stateLabel: openGameStateLabel(owner.state), stateDescription,
      stateReasonText: openGameStateReasonLabel(owner.stateReason),
      panel: "", errorMessage: message, pendingKind: "",
      canEdit: owner.allowedActions.canEdit,
      canPublish: owner.allowedActions.canPublish,
      canShare: owner.allowedActions.canShare && owner.share !== null,
      canCancel: owner.allowedActions.canCancel,
      canPreview: owner.allowedActions.canPreview,
      share: owner.allowedActions.canShare ? owner.share : null,
      order: owner.order, orderRange: formatOpenGameRange(owner.order.startsAt, owner.order.endsAt, owner.order.timeZone),
      name: owner.name, teamName: owner.team.name,
      peopleSummary: `计划 ${owner.totalPlayers} 人 · 固定 ${owner.fixedPlayers} 人 · 开放 ${owner.openSpots} 人`,
      intensityLabel: openGameIntensityLabel(owner.intensity),
      positionsLabel: owner.positions.map(openGamePositionLabel).join("、"),
      aaLabel: formatCents(owner.aaCents),
      deadlineLabel: formatOpenGameDateTime(owner.registrationDeadline, owner.order.timeZone),
      visibilityLabel: owner.visibility === "PUBLIC" ? "公开可见" : "仅链接可见",
      notes: owner.equipmentAndArrivalNotes ?? "无额外说明",
    });
    if (owner.allowedActions.canShare && owner.share) {
      try { void wx.showShareMenu({ menus: ["shareAppMessage"] }); } catch { this.setData({ shareError: "暂时无法分享" }); }
    } else hideShare();
  },

  restorePersistedAttempt(): boolean {
    const attempt = getOpenGameMutationAttemptStore().load();
    if (!attempt) {
      this.currentAttempt = null; this.foreignAttempt = null;
      return false;
    }
    const current = (attempt.kind === "publish" || attempt.kind === "cancel") && attempt.gameId === this.data.gameId;
    this.currentAttempt = current ? attempt : null;
    this.foreignAttempt = current ? null : attempt;
    hideShare();
    this.setData({
      status: current ? "MUTATION_UNKNOWN" : "FOREIGN_PENDING",
      panel: "",
      pendingKind: attempt.kind,
      errorMessage: current ? "检测到上次操作结果尚未确认，请先确认结果。" : "检测到上次操作尚未确认，请先确认其结果。",
    });
    return true;
  },

  onReload() { if (this.data.gameId) { this.visible = true; void this.loadOwner(this.data.gameId); } },
  async onLogin() {
    try { await getOpenGameSource().login(); this.onReload(); }
    catch { this.setData({ status: "AUTH_LOSS", errorMessage: "登录失败，请重试。" }); }
  },

  onOpenPublish() { if (this.data.status === "READY" && this.data.canPublish) this.setData({ panel: "publish" }); },
  onOpenCancel() { if (this.data.status === "READY" && this.data.canCancel) this.setData({ panel: "cancel" }); },
  onClosePanel() { this.setData({ panel: "" }); },
  onConfirmPublish() { return this.startMutation("publish"); },
  onConfirmCancel() { return this.startMutation("cancel"); },

  startMutation(kind: "publish" | "cancel") {
    if (this.mutationInFlight) return this.mutationInFlight;
    if (!this.owner || this.data.status !== "READY" || (kind === "publish" ? !this.data.canPublish : !this.data.canCancel)) return Promise.resolve();
    const attempt: OpenGameMutationAttempt = {
      kind, gameId: this.owner.id, expectedVersion: this.owner.version,
      idempotencyKey: `open-game-${Date.now()}-${++attemptSerial}`,
    };
    const resolution = getOpenGameMutationAttemptStore().begin(attempt);
    if (resolution.kind === "FOREIGN_PENDING") {
      this.foreignAttempt = resolution.attempt;
      this.setData({ status: "FOREIGN_PENDING", panel: "", pendingKind: resolution.attempt.kind, errorMessage: "检测到上次操作尚未确认，请先确认其结果。" });
      return Promise.resolve();
    }
    this.currentAttempt = resolution.attempt;
    const promise = this.executeAttempt(resolution.attempt, false).finally(() => { this.mutationInFlight = null; });
    this.mutationInFlight = promise;
    return promise;
  },

  async executeAttempt(attempt: OpenGameMutationAttempt, foreign: boolean) {
    const generation = this.loadGeneration;
    hideShare();
    this.setData({ status: "MUTATING", panel: "", errorMessage: "" });
    try {
      const source = getOpenGameSource();
      const result = attempt.kind === "create" ? await source.create(attempt)
        : attempt.kind === "update" ? await source.update(attempt)
          : attempt.kind === "publish" ? await source.publish({ ...attempt, kind: "publish" })
            : await source.cancel({ ...attempt, kind: "cancel" });
      if (!this.visible || generation !== this.loadGeneration) return;
      getOpenGameMutationAttemptStore().clear(); this.currentAttempt = null; this.foreignAttempt = null;
      if (foreign && result.id !== this.data.gameId) await this.loadOwner(this.data.gameId);
      else this.applyOwner(result);
    } catch (caught) {
      if (!this.visible || generation !== this.loadGeneration) return;
      await this.handleMutationError(attempt, caught, foreign);
    }
  },

  async handleMutationError(attempt: OpenGameMutationAttempt, caught: unknown, foreign: boolean) {
    if (!(caught instanceof OpenGameApiError) || caught.code === "OPEN_GAME_RESULT_UNKNOWN") {
      this.setData({ status: foreign ? "FOREIGN_PENDING" : "MUTATION_UNKNOWN", errorMessage: "操作结果暂不确定，请确认后再继续。" });
      return;
    }
    if (caught.code === "SERVICE_UNAVAILABLE") {
      this.setData({ status: foreign ? "FOREIGN_PENDING" : "READY", errorMessage: "服务暂不可用，请稍后重试。" });
      return;
    }
    await this.recoverDefinitive(attempt, caught, foreign);
  },

  async recoverDefinitive(attempt: OpenGameMutationAttempt, error: OpenGameApiError, foreign: boolean) {
    const generation = this.loadGeneration;
    const supported = ["OPEN_GAME_ALREADY_EXISTS", "ORDER_NOT_ELIGIBLE", "OPEN_GAME_STATE_CHANGED", "IDEMPOTENCY_KEY_REUSED", "INVALID_ARGUMENT", "ORDER_NOT_FOUND", "OPEN_GAME_NOT_FOUND", "AUTH_REQUIRED"] as const;
    if (!supported.includes(error.code as typeof supported[number])) {
      this.setData({ status: foreign ? "FOREIGN_PENDING" : "READY", errorMessage: "操作失败，请重试。" }); return;
    }
    let decision = classifyOpenGameDefinitiveRecovery(attempt, error.code as typeof supported[number]);
    if (decision.kind === "REFRESH_ENTRY" || decision.kind === "REFRESH_OWNER") {
      try {
        const authority = decision.kind === "REFRESH_ENTRY" && attempt.kind === "create"
          ? await getOpenGameSource().getEntry(attempt.orderId)
          : await getOpenGameSource().getOwnedGame(attempt.kind === "create" ? this.data.gameId : attempt.gameId);
        decision = classifyOpenGameDefinitiveRecovery(attempt, error.code as typeof supported[number], authority);
        if (!this.visible || generation !== this.loadGeneration) return;
      } catch (caught) {
        if (!this.visible || generation !== this.loadGeneration) return;
        if (await this.handleAuthorityReadFailure(caught, foreign)) return;
        this.setData({ status: foreign ? "FOREIGN_PENDING" : "MUTATION_UNKNOWN", errorMessage: "暂时无法确认操作结果，请稍后重试。" }); return;
      }
    }
    if (decision.clearAttempt) getOpenGameMutationAttemptStore().clear();
    if (foreign) { this.foreignAttempt = null; await this.loadOwner(this.data.gameId); return; }
    if (decision.kind === "CLAMP") this.applyAuthority(decision.authority, "状态已更新，请按当前允许操作继续。");
    else if (decision.kind === "NAVIGATE") { this.setData({ gameId: decision.gameId }); await this.loadOwner(decision.gameId); }
    else if (decision.kind === "LOGIN") this.setData({ status: "AUTH_LOSS", errorMessage: "登录状态已失效，请重新登录。" });
    else if (decision.kind === "NOT_FOUND") this.setData({ status: "NOT_FOUND", errorMessage: "球局不存在或你无权查看。" });
    else this.setData({ status: "READY", errorMessage: decision.kind === "CORRECT" ? "当前操作参数无效，请刷新后重试。" : "操作冲突，请刷新后重试。" });
  },

  applyAuthority(authority: OpenGameEntry | OpenGameOwner, message: string) {
    if ("entry" in authority) { this.setData({ status: "NOT_FOUND", errorMessage: message }); return; }
    if (authority.id !== this.data.gameId) { void this.loadOwner(this.data.gameId); return; }
    this.applyOwner(authority, message);
  },

  authorityFor(attempt: OpenGameMutationAttempt): Promise<OpenGameEntry | OpenGameOwner> {
    return attempt.kind === "create" ? getOpenGameSource().getEntry(attempt.orderId) : getOpenGameSource().getOwnedGame(attempt.gameId);
  },

  onConfirmUnknown() {
    const attempt = this.currentAttempt ?? getOpenGameMutationAttemptStore().load();
    return this.confirmAttempt(attempt, false);
  },
  onConfirmPreviousOperation() {
    const attempt = this.foreignAttempt ?? getOpenGameMutationAttemptStore().load();
    return this.confirmAttempt(attempt, true);
  },

  confirmAttempt(attempt: OpenGameMutationAttempt | null, foreign: boolean) {
    if (!attempt || this.mutationInFlight) return Promise.resolve();
    const promise = this.resolveAttempt(attempt, foreign).finally(() => { this.mutationInFlight = null; });
    this.mutationInFlight = promise;
    return promise;
  },

  async resolveAttempt(attempt: OpenGameMutationAttempt, foreign: boolean) {
    const generation = this.loadGeneration;
    try {
      const authority = await this.authorityFor(attempt);
      if (!this.visible || generation !== this.loadGeneration) return;
      const decision = classifyOpenGameUnknownRecovery(attempt, authority);
      if (decision.kind === "REPLAY") { await this.executeAttempt(decision.attempt, foreign); return; }
      if (decision.clearAttempt) getOpenGameMutationAttemptStore().clear();
      this.currentAttempt = null; this.foreignAttempt = null;
      if (foreign) { await this.loadOwner(this.data.gameId); return; }
      if (decision.kind === "ACCEPT") this.applyOwner(decision.owner);
      else if (decision.kind === "NAVIGATE") { this.setData({ gameId: decision.gameId }); await this.loadOwner(decision.gameId); }
      else this.applyAuthority(decision.authority, "已按权威状态更新。");
    } catch (caught) {
      if (!this.visible || generation !== this.loadGeneration) return;
      if (await this.handleAuthorityReadFailure(caught, foreign)) return;
      this.setData({ status: foreign ? "FOREIGN_PENDING" : "MUTATION_UNKNOWN", errorMessage: "暂时无法确认操作结果，请稍后重试。" });
    }
  },

  async handleAuthorityReadFailure(caught: unknown, foreign: boolean): Promise<boolean> {
    if (!(caught instanceof OpenGameApiError)) return false;
    if (caught.code !== "AUTH_REQUIRED" && caught.code !== "ORDER_NOT_FOUND" && caught.code !== "OPEN_GAME_NOT_FOUND") return false;
    getOpenGameMutationAttemptStore().clear();
    this.currentAttempt = null; this.foreignAttempt = null;
    if (caught.code === "AUTH_REQUIRED") {
      this.setData({ status: "AUTH_LOSS", errorMessage: "登录状态已失效，请重新登录。" });
    } else if (foreign && this.data.gameId) {
      await this.loadOwner(this.data.gameId);
    } else {
      this.setData({ status: "NOT_FOUND", errorMessage: "球局不存在或你无权查看。" });
    }
    return true;
  },

  onShareAppMessage() {
    const share = this.data.status === "READY" && this.data.canShare ? this.data.share : null;
    if (!share) return { title: "逐光约场", path: "/pages/intent-entry/index" };
    return { title: share.title, path: share.path, ...(share.imageUrl ? { imageUrl: share.imageUrl } : {}) };
  },
  onShareFailure() { if (this.data.status === "READY" && this.data.state === "PUBLISHED") this.setData({ shareError: "暂时无法分享" }); },

  async onEdit() {
    if (this.data.status !== "READY" || !this.data.canEdit) return;
    try { await navigation("navigateTo", `/pages/captain-game-form/index?game_id=${this.data.gameId}`); }
    catch { this.setData({ navigationError: "暂时无法打开编辑页，请重试。" }); }
  },
  async onPreview() {
    if (this.data.status !== "READY" || !this.data.canPreview) return;
    try { await navigation("navigateTo", `/pages/captain-game-public/index?game_id=${this.data.gameId}&preview=1`); }
    catch { this.setData({ navigationError: "暂时无法打开预览，请重试。" }); }
  },
  onReturnOrder() {
    if (currentPages().length > 1) wx.navigateBack({ delta: 1 });
    else wx.reLaunch({ url: this.data.orderId
      ? `/pages/order-detail/index?order_id=${this.data.orderId}`
      : "/pages/my-orders/index" });
  },
  onHeaderBack() { this.onReturnOrder(); },
});
