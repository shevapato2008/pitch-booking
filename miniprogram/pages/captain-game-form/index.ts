import type { OpenGameEntry, OpenGameOwner } from "../../domain/open-game";
import {
  applyOpenGameStepper,
  centsToYuan,
  createOpenGameForm,
  formatOpenGameRange,
  mapOpenGameFieldErrors,
  normalizePositionSelection,
  validateOpenGameField,
  validateOpenGameForm,
  type OpenGameFormField,
  type OpenGameFormValue,
} from "../../presentation/open-game";
import { readIntentHeaderLayout } from "../../presentation/intent-header-layout";
import { OpenGameApiError } from "../../services/http-open-game";
import {
  classifyOpenGameDefinitiveRecovery,
  classifyOpenGameUnknownRecovery,
  getOpenGameMutationAttemptStore,
  getOpenGameSource,
  type OpenGameMutationAttempt,
} from "../../services/open-game";

interface PageOptions { order_id?: unknown; game_id?: unknown; }
interface InputEvent { currentTarget?: { dataset?: { field?: unknown; delta?: unknown } }; detail?: { value?: unknown }; }
type FormStatus = "LOADING" | "READY" | "INELIGIBLE" | "LOAD_ERROR" | "AUTH_LOSS" | "SAVING" | "SAVE_ERROR" | "SAVE_UNKNOWN" | "FOREIGN_PENDING" | "SAVE_SUCCEEDED";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let attemptSerial = 0;

const POSITION_OPTIONS = [
  { value: "GOALKEEPER", label: "门将" },
  { value: "DEFENDER", label: "后卫" },
  { value: "MIDFIELDER", label: "中场" },
  { value: "FORWARD", label: "前锋" },
  { value: "ANY", label: "任意位置" },
] as const;

function isUuid(value: unknown): value is string { return typeof value === "string" && UUID_PATTERN.test(value); }
function valueOf(event: InputEvent): string { return typeof event.detail?.value === "string" ? event.detail.value : ""; }
function pages(): readonly { route?: string }[] { return getCurrentPages() as unknown as readonly { route?: string }[]; }
function canEdit(status: FormStatus): boolean { return status === "READY" || status === "SAVE_ERROR"; }
function positionOptions(selected: OpenGameFormValue["positions"] = []) {
  return POSITION_OPTIONS.map((position) => ({ ...position, checked: selected.includes(position.value) }));
}
function readHeaderData() {
  const header = readIntentHeaderLayout();
  return { headerTopPx: header.topPx, headerRowHeightPx: header.rowHeightPx, headerHeightPx: header.topPx + header.rowHeightPx, headerLeftInsetPx: header.rightInsetPx, headerRightInsetPx: header.rightInsetPx };
}

function navigation(method: "navigateTo" | "redirectTo" | "reLaunch", url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = () => { if (!settled) { settled = true; resolve(); } };
    const fail = (error: unknown) => { if (!settled) { settled = true; reject(error); } };
    const options = { url, success: done, fail };
    const returned = method === "navigateTo" ? wx.navigateTo(options)
      : method === "redirectTo" ? wx.redirectTo(options)
        : wx.reLaunch(options);
    const thenable = returned as unknown as { then?: (yes: () => void, no: (error: unknown) => void) => void };
    if (typeof thenable?.then === "function") thenable.then(done, fail);
  });
}

function backOr(url: string): void {
  if (pages().length > 1) wx.navigateBack({ delta: 1 });
  else wx.reLaunch({ url });
}

function blankData() {
  return {
    status: "LOADING" as FormStatus,
    mode: "create" as "create" | "edit",
    pageTitle: "创建球局",
    saveLabel: "保存草稿",
    canSave: false,
    orderId: "",
    gameId: "",
    order: null as OpenGameOwner["order"] | null,
    orderRange: "",
    form: null as OpenGameFormValue | null,
    fieldErrors: {} as Record<string, string>,
    errorSummary: "",
    errorMessage: "",
    navigationError: "",
    authoritativeGameId: "",
    stepperError: "",
    pendingKind: "",
    headerTopPx: 0,
    headerRowHeightPx: 44,
    headerHeightPx: 44,
    headerLeftInsetPx: 0,
    headerRightInsetPx: 0,
    intensities: [
      { value: "BEGINNER_FRIENDLY", label: "新手友好" },
      { value: "CASUAL", label: "轻松交流" },
      { value: "COMPETITIVE", label: "认真对抗" },
    ],
    positions: positionOptions(),
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

  onLoad(options: PageOptions = {}) {
    this.visible = true;
    const header = readHeaderData();
    const hasOrder = isUuid(options.order_id);
    const hasGame = isUuid(options.game_id);
    if (hasOrder === hasGame) {
      this.setData({ ...blankData(), ...header, status: "INELIGIBLE", canSave: false, errorMessage: "页面参数无效，请返回订单后重试。" });
      return;
    }
    if (hasOrder) {
      this.setData({ ...blankData(), ...header, orderId: options.order_id as string, mode: "create", pageTitle: "创建球局", saveLabel: "保存草稿" });
      void this.loadCreate(options.order_id as string);
      return;
    }
    this.setData({ ...blankData(), ...header, gameId: options.game_id as string, mode: "edit", pageTitle: "编辑球局", saveLabel: "保存修改" });
    void this.loadEdit(options.game_id as string);
  },

  onUnload() { this.visible = false; this.loadGeneration += 1; },

  async loadCreate(orderId: string) {
    const generation = ++this.loadGeneration;
    this.setData({ status: "LOADING", canSave: false, errorMessage: "" });
    try {
      const entry = await getOpenGameSource().getEntry(orderId);
      if (!this.visible || generation !== this.loadGeneration) return;
      if (entry.entry === "MANAGE") {
        this.setData({ gameId: entry.gameId, authoritativeGameId: entry.gameId });
        if (this.restorePersistedAttempt()) return;
        try { await navigation("redirectTo", `/pages/captain-game-manage/index?game_id=${entry.gameId}`); }
        catch { this.setData({ status: "SAVE_SUCCEEDED", navigationError: "球局已存在，请重新打开管理页。" }); }
        return;
      }
      if (entry.entry === "NONE") {
        this.setData({ status: "INELIGIBLE", canSave: false, errorMessage: "该订单当前不符合创建球局条件。" });
        this.restorePersistedAttempt();
        return;
      }
      const form = createOpenGameForm(entry.order);
      this.setData({ status: "READY", canSave: true, order: entry.order, orderRange: formatOpenGameRange(entry.order.startsAt, entry.order.endsAt, entry.order.timeZone), form, positions: positionOptions(form.positions), fieldErrors: {}, errorSummary: "" });
      this.restorePersistedAttempt();
    } catch (caught) {
      if (!this.visible || generation !== this.loadGeneration) return;
      this.clearCurrentAttemptForDefinitiveLoadError(caught);
      this.handleLoadError(caught);
    }
  },

  async loadEdit(gameId: string) {
    const generation = ++this.loadGeneration;
    this.setData({ status: "LOADING", canSave: false, errorMessage: "" });
    try {
      const owner = await getOpenGameSource().getOwnedGame(gameId);
      if (!this.visible || generation !== this.loadGeneration) return;
      this.owner = owner;
      if (!owner.allowedActions.canEdit) {
        this.setData({ status: "INELIGIBLE", canSave: false, authoritativeGameId: owner.id, errorMessage: "当前状态不可编辑，请返回管理页查看。" });
        this.restorePersistedAttempt();
        return;
      }
      const form = createOpenGameForm(owner.order, owner);
      this.setData({ status: "READY", canSave: true, orderId: owner.orderId, gameId: owner.id, order: owner.order, orderRange: formatOpenGameRange(owner.order.startsAt, owner.order.endsAt, owner.order.timeZone), form, positions: positionOptions(form.positions), fieldErrors: {}, errorSummary: "" });
      this.restorePersistedAttempt();
    } catch (caught) {
      if (!this.visible || generation !== this.loadGeneration) return;
      this.clearCurrentAttemptForDefinitiveLoadError(caught);
      this.handleLoadError(caught);
    }
  },

  clearCurrentAttemptForDefinitiveLoadError(caught: unknown) {
    if (!(caught instanceof OpenGameApiError)
      || (caught.code !== "AUTH_REQUIRED" && caught.code !== "ORDER_NOT_FOUND" && caught.code !== "OPEN_GAME_NOT_FOUND")) return;
    const attempt = getOpenGameMutationAttemptStore().load();
    if (!attempt) return;
    const currentTarget = this.data.mode === "create"
      ? attempt.kind === "create" && attempt.orderId === this.data.orderId
      : attempt.kind !== "create" && attempt.gameId === this.data.gameId;
    if (!currentTarget) return;
    getOpenGameMutationAttemptStore().clear();
    this.currentAttempt = null; this.foreignAttempt = null;
  },

  handleLoadError(caught: unknown) {
    if (caught instanceof OpenGameApiError && caught.code === "AUTH_REQUIRED") {
      this.setData({ status: "AUTH_LOSS", canSave: false, errorMessage: "登录状态已失效，请重新登录。" });
    } else if (caught instanceof OpenGameApiError && (caught.code === "ORDER_NOT_FOUND" || caught.code === "OPEN_GAME_NOT_FOUND")) {
      this.setData({ status: "INELIGIBLE", canSave: false, errorMessage: "未找到可管理的球局。" });
    } else {
      this.setData({ status: "LOAD_ERROR", canSave: false, errorMessage: "加载失败，请稍后重试。" });
    }
  },

  restorePersistedAttempt(): boolean {
    const attempt = getOpenGameMutationAttemptStore().load();
    if (!attempt) {
      this.currentAttempt = null; this.foreignAttempt = null;
      this.setData({ pendingKind: "" });
      return false;
    }
    const current = this.data.mode === "create"
      ? attempt.kind === "create" && attempt.orderId === this.data.orderId
      : attempt.kind === "update" && attempt.gameId === this.data.gameId;
    this.currentAttempt = current ? attempt : null;
    this.foreignAttempt = current ? null : attempt;
    this.setData({
      status: current ? "SAVE_UNKNOWN" : "FOREIGN_PENDING",
      canSave: false,
      pendingKind: attempt.kind,
      errorMessage: current ? "检测到上次保存结果尚未确认，请先确认结果。" : "检测到上次操作尚未确认，请先确认其结果。",
    });
    return true;
  },

  onRetry() {
    if (this.data.mode === "edit" && this.data.gameId) void this.loadEdit(this.data.gameId);
    else if (this.data.orderId) void this.loadCreate(this.data.orderId);
  },

  async onLogin() {
    try {
      await getOpenGameSource().login();
      this.onRetry();
    } catch { this.setData({ status: "AUTH_LOSS", errorMessage: "登录失败，请重试。" }); }
  },

  updateForm(patch: Partial<OpenGameFormValue>) {
    if (!this.data.form || !canEdit(this.data.status)) return;
    const form = { ...this.data.form, ...patch };
    this.setData({ form, ...(patch.positions === undefined ? {} : { positions: positionOptions(form.positions) }) });
  },

  onTextInput(event: InputEvent) {
    const field = event.currentTarget?.dataset?.field;
    if (field !== "name" && field !== "teamName" && field !== "minimumExperience") return;
    this.updateForm({ [field]: valueOf(event) });
  },

  onFieldBlur(event: InputEvent) {
    if (!this.data.form) return;
    const field = event.currentTarget?.dataset?.field as OpenGameFormField;
    const error = validateOpenGameField(this.data.form, field);
    const errors = { ...this.data.fieldErrors };
    if (error) errors[field] = error; else delete errors[field];
    this.setData({ fieldErrors: errors });
  },

  onStepper(event: InputEvent) {
    if (!this.data.form || !this.data.order || !canEdit(this.data.status)) return;
    const field = event.currentTarget?.dataset?.field;
    const rawDelta = event.currentTarget?.dataset?.delta;
    if ((field !== "totalPlayers" && field !== "fixedPlayers" && field !== "openSpots") || (rawDelta !== 1 && rawDelta !== -1 && rawDelta !== "1" && rawDelta !== "-1")) return;
    const changed = applyOpenGameStepper(this.data.form, field, Number(rawDelta), this.data.order);
    const fieldErrors = { ...this.data.fieldErrors };
    if (changed.error) fieldErrors[field] = changed.error; else delete fieldErrors[field];
    this.setData({ form: changed.form, stepperError: changed.error, fieldErrors });
  },

  onIntensityChange(event: InputEvent) {
    const value = valueOf(event);
    if (value === "BEGINNER_FRIENDLY" || value === "CASUAL" || value === "COMPETITIVE") this.updateForm({ intensity: value });
  },

  onPositionsChange(event: InputEvent) {
    if (!this.data.form) return;
    const value = Array.isArray(event.detail?.value) ? event.detail?.value.filter((item): item is string => typeof item === "string") : [];
    this.updateForm({ positions: normalizePositionSelection(value, this.data.form.positions) });
  },

  onAaInput(event: InputEvent) { this.updateForm({ aaYuan: valueOf(event) }); },
  updateDeadline(patch: Pick<OpenGameFormValue, "deadlineDate" | "deadlineTouched"> | Pick<OpenGameFormValue, "deadlineTime" | "deadlineTouched">) {
    if (!this.data.form || !this.data.order || !canEdit(this.data.status)) return;
    const form = { ...this.data.form, ...patch };
    const validation = validateOpenGameForm(form, this.data.order, new Date().toISOString());
    const fieldErrors = { ...this.data.fieldErrors };
    const error = validation.ok ? undefined : validation.errors.registrationDeadline;
    if (error) fieldErrors.registrationDeadline = error; else delete fieldErrors.registrationDeadline;
    this.setData({ form, fieldErrors });
  },
  onDeadlineDateChange(event: InputEvent) { this.updateDeadline({ deadlineDate: valueOf(event), deadlineTouched: true }); },
  onDeadlineTimeChange(event: InputEvent) { this.updateDeadline({ deadlineTime: valueOf(event), deadlineTouched: true }); },
  onNotesInput(event: InputEvent) { this.updateForm({ equipmentAndArrivalNotes: valueOf(event) }); },
  onVisibilityChange(event: InputEvent) {
    const value = valueOf(event);
    if (value === "PUBLIC" || value === "LINK_ONLY") this.updateForm({ visibility: value });
  },

  onSave() {
    if (this.mutationInFlight) return this.mutationInFlight;
    const promise = this.save().finally(() => { this.mutationInFlight = null; });
    this.mutationInFlight = promise;
    return promise;
  },

  async save() {
    if (!this.data.canSave || !canEdit(this.data.status) || !this.data.form || !this.data.order) return;
    const validated = validateOpenGameForm(this.data.form, this.data.order, new Date().toISOString());
    if (!validated.ok) {
      this.setData({ status: "READY", fieldErrors: validated.errors, errorSummary: validated.summary });
      return;
    }
    const idempotencyKey = `open-game-${Date.now()}-${++attemptSerial}`;
    const requested: OpenGameMutationAttempt = this.data.mode === "create"
      ? { kind: "create", orderId: this.data.orderId, body: validated.body, idempotencyKey }
      : { kind: "update", gameId: this.data.gameId, body: { ...validated.body, expectedVersion: this.owner?.version ?? 0 }, idempotencyKey };
    const resolution = getOpenGameMutationAttemptStore().begin(requested);
    if (resolution.kind === "FOREIGN_PENDING") {
      this.foreignAttempt = resolution.attempt;
      this.setData({ status: "FOREIGN_PENDING", canSave: false, pendingKind: resolution.attempt.kind, errorMessage: "检测到上次操作尚未确认，请先确认其结果。" });
      return;
    }
    this.currentAttempt = resolution.attempt;
    await this.executeAttempt(resolution.attempt, false);
  },

  async executeAttempt(attempt: OpenGameMutationAttempt, foreign: boolean) {
    const generation = this.loadGeneration;
    this.setData({ status: "SAVING", canSave: false, errorSummary: "", errorMessage: "" });
    try {
      const source = getOpenGameSource();
      const owner = attempt.kind === "create" ? await source.create(attempt)
        : attempt.kind === "update" ? await source.update(attempt)
          : attempt.kind === "publish"
            ? await source.publish({ ...attempt, kind: "publish" })
            : await source.cancel({ ...attempt, kind: "cancel" });
      if (!this.visible || generation !== this.loadGeneration) return;
      getOpenGameMutationAttemptStore().clear();
      this.currentAttempt = null; this.foreignAttempt = null;
      if (foreign) await this.reloadCurrentForm();
      else await this.acceptOwner(owner);
    } catch (caught) {
      if (!this.visible || generation !== this.loadGeneration) return;
      await this.handleMutationError(attempt, caught, foreign);
    }
  },

  reloadCurrentForm(): Promise<void> {
    return this.data.mode === "edit" && this.data.gameId
      ? this.loadEdit(this.data.gameId)
      : this.loadCreate(this.data.orderId);
  },

  async acceptOwner(owner: OpenGameOwner) {
    this.owner = owner;
    this.setData({ status: "SAVE_SUCCEEDED", authoritativeGameId: owner.id, gameId: owner.id, canSave: false, navigationError: "" });
    try { await navigation("redirectTo", `/pages/captain-game-manage/index?game_id=${owner.id}`); }
    catch { this.setData({ navigationError: "球局已保存，请重新打开管理页。" }); }
  },

  async handleMutationError(attempt: OpenGameMutationAttempt, caught: unknown, foreign: boolean) {
    if (!(caught instanceof OpenGameApiError)) {
      this.setData({ status: foreign ? "FOREIGN_PENDING" : "SAVE_UNKNOWN", canSave: false, errorMessage: "保存结果暂不确定，请确认后再操作。" });
      return;
    }
    if (caught.code === "OPEN_GAME_RESULT_UNKNOWN") {
      this.setData({ status: foreign ? "FOREIGN_PENDING" : "SAVE_UNKNOWN", canSave: false, errorMessage: "保存结果暂不确定，请确认后再操作。" });
      return;
    }
    if (caught.code === "SERVICE_UNAVAILABLE") {
      this.setData({ status: foreign ? "FOREIGN_PENDING" : "SAVE_ERROR", canSave: !foreign, errorMessage: "服务暂不可用，请稍后重试。" });
      return;
    }
    await this.recoverDefinitive(attempt, caught, foreign);
  },

  async recoverDefinitive(attempt: OpenGameMutationAttempt, error: OpenGameApiError, foreign: boolean) {
    const generation = this.loadGeneration;
    const supported = ["OPEN_GAME_ALREADY_EXISTS", "ORDER_NOT_ELIGIBLE", "OPEN_GAME_STATE_CHANGED", "IDEMPOTENCY_KEY_REUSED", "INVALID_ARGUMENT", "ORDER_NOT_FOUND", "OPEN_GAME_NOT_FOUND", "AUTH_REQUIRED"] as const;
    if (!supported.includes(error.code as typeof supported[number])) {
      this.setData({ status: foreign ? "FOREIGN_PENDING" : "SAVE_ERROR", canSave: !foreign, errorMessage: "保存失败，请重试。" });
      return;
    }
    let decision = classifyOpenGameDefinitiveRecovery(attempt, error.code as typeof supported[number]);
    if (decision.kind === "REFRESH_ENTRY" || decision.kind === "REFRESH_OWNER") {
      try {
        const authority = decision.kind === "REFRESH_ENTRY"
          ? await getOpenGameSource().getEntry(attempt.kind === "create" ? attempt.orderId : this.data.orderId)
          : await getOpenGameSource().getOwnedGame(attempt.kind === "create" ? this.data.gameId : attempt.gameId);
        decision = classifyOpenGameDefinitiveRecovery(attempt, error.code as typeof supported[number], authority);
        if (!this.visible || generation !== this.loadGeneration) return;
      } catch (caught) {
        if (!this.visible || generation !== this.loadGeneration) return;
        if (await this.handleAuthorityReadFailure(caught, foreign)) return;
        this.setData({ status: foreign ? "FOREIGN_PENDING" : "SAVE_UNKNOWN", canSave: false, errorMessage: "暂时无法确认上次操作，请稍后重试。" });
        return;
      }
    }
    if (decision.clearAttempt) { getOpenGameMutationAttemptStore().clear(); this.currentAttempt = null; this.foreignAttempt = null; }
    if (foreign && decision.kind !== "LOGIN") {
      await this.reloadCurrentForm();
      return;
    }
    if (decision.kind === "NAVIGATE") {
      this.setData({ authoritativeGameId: decision.gameId });
      await this.onOpenManager();
    } else if (decision.kind === "CLAMP") {
      await this.applyClampedAuthority(decision.authority);
    } else if (decision.kind === "CORRECT") {
      const fieldErrors = mapOpenGameFieldErrors(error.fields);
      this.setData({ status: "SAVE_ERROR", canSave: true, fieldErrors, errorSummary: `请检查 ${Math.max(1, Object.keys(fieldErrors).length)} 个字段后再保存`, errorMessage: "请修正表单中的问题。" });
    } else if (decision.kind === "LOGIN") {
      this.setData({ status: "AUTH_LOSS", canSave: false, errorMessage: "登录状态已失效，请重新登录。" });
    } else if (decision.kind === "NOT_FOUND") {
      this.setData({ status: "INELIGIBLE", canSave: false, errorMessage: "未找到可管理的球局。" });
    } else {
      this.setData({ status: "SAVE_ERROR", canSave: true, errorMessage: "操作冲突，请重新加载后再试。" });
    }
  },

  async applyClampedAuthority(authority: OpenGameEntry | OpenGameOwner) {
    if ("entry" in authority) {
      if (authority.entry === "CREATE") {
        const form = createOpenGameForm(authority.order);
        this.setData({ status: "READY", canSave: true, order: authority.order, form, positions: positionOptions(form.positions), errorMessage: "已按最新状态重新加载。" });
      } else if (authority.entry === "MANAGE") {
        this.setData({ status: "SAVE_SUCCEEDED", canSave: false, authoritativeGameId: authority.gameId, errorMessage: "已确认球局存在。" });
        await this.onOpenManager();
      } else this.setData({ status: "INELIGIBLE", canSave: false, errorMessage: "该订单当前不符合创建球局条件。" });
      return;
    }
    this.owner = authority;
    if (authority.allowedActions.canEdit) {
      const form = createOpenGameForm(authority.order, authority);
      this.setData({ status: "READY", canSave: true, gameId: authority.id, order: authority.order, form, positions: positionOptions(form.positions), errorMessage: "已按最新状态重新加载。" });
    } else {
      this.setData({ status: "INELIGIBLE", canSave: false, authoritativeGameId: authority.id, errorMessage: "状态已变化，请返回管理页查看。" });
    }
  },

  async authorityFor(attempt: OpenGameMutationAttempt): Promise<OpenGameEntry | OpenGameOwner> {
    return attempt.kind === "create"
      ? getOpenGameSource().getEntry(attempt.orderId)
      : getOpenGameSource().getOwnedGame(attempt.gameId);
  },

  async onConfirmSaveResult() {
    const attempt = this.currentAttempt ?? getOpenGameMutationAttemptStore().load();
    if (!attempt || this.mutationInFlight) return;
    const promise = this.confirmAttempt(attempt, false).finally(() => { this.mutationInFlight = null; });
    this.mutationInFlight = promise;
    return promise;
  },

  async onConfirmPreviousOperation() {
    const attempt = this.foreignAttempt ?? getOpenGameMutationAttemptStore().load();
    if (!attempt || this.mutationInFlight) return;
    const promise = this.confirmAttempt(attempt, true).finally(() => { this.mutationInFlight = null; });
    this.mutationInFlight = promise;
    return promise;
  },

  async confirmAttempt(attempt: OpenGameMutationAttempt, foreign: boolean) {
    const generation = this.loadGeneration;
    try {
      const authority = await this.authorityFor(attempt);
      if (!this.visible || generation !== this.loadGeneration) return;
      const decision = classifyOpenGameUnknownRecovery(attempt, authority);
      if (decision.kind === "REPLAY") { await this.executeAttempt(decision.attempt, foreign); return; }
      if (decision.clearAttempt) getOpenGameMutationAttemptStore().clear();
      this.currentAttempt = null; this.foreignAttempt = null;
      if (foreign) {
        await this.reloadCurrentForm();
      } else if (decision.kind === "NAVIGATE") {
        this.setData({ authoritativeGameId: decision.gameId });
        await this.onOpenManager();
      } else if (decision.kind === "ACCEPT") {
        await this.acceptOwner(decision.owner);
      } else {
        await this.applyClampedAuthority(decision.authority);
      }
    } catch (caught) {
      if (!this.visible || generation !== this.loadGeneration) return;
      if (await this.handleAuthorityReadFailure(caught, foreign)) return;
      this.setData({ status: foreign ? "FOREIGN_PENDING" : "SAVE_UNKNOWN", canSave: false, errorMessage: "暂时无法确认上次操作，请稍后重试。" });
    }
  },

  async handleAuthorityReadFailure(caught: unknown, foreign: boolean): Promise<boolean> {
    if (!(caught instanceof OpenGameApiError)) return false;
    if (caught.code !== "AUTH_REQUIRED" && caught.code !== "ORDER_NOT_FOUND" && caught.code !== "OPEN_GAME_NOT_FOUND") return false;
    getOpenGameMutationAttemptStore().clear();
    this.currentAttempt = null; this.foreignAttempt = null;
    if (caught.code === "AUTH_REQUIRED") {
      this.setData({ status: "AUTH_LOSS", canSave: false, errorMessage: "登录状态已失效，请重新登录。" });
    } else if (foreign) {
      await this.reloadCurrentForm();
    } else {
      this.setData({ status: "INELIGIBLE", canSave: false, errorMessage: "未找到可管理的球局。" });
    }
    return true;
  },

  async onOpenManager() {
    const gameId = this.data.authoritativeGameId || this.data.gameId;
    if (!gameId) return;
    try { await navigation("redirectTo", `/pages/captain-game-manage/index?game_id=${gameId}`); }
    catch { this.setData({ status: "SAVE_SUCCEEDED", navigationError: "球局已保存，请重新打开管理页。" }); }
  },

  onReturnOrder() {
    if (this.data.mode === "edit" && (this.data.gameId || this.data.authoritativeGameId)) {
      const gameId = this.data.authoritativeGameId || this.data.gameId;
      if (pages().length > 1) wx.navigateBack({ delta: 1 });
      else wx.redirectTo({ url: `/pages/captain-game-manage/index?game_id=${gameId}` });
      return;
    }
    backOr(this.data.orderId ? `/pages/order-detail/index?order_id=${this.data.orderId}` : "/pages/my-orders/index");
  },
  onHeaderBack() { this.onReturnOrder(); },
});
