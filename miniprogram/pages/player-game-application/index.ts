import {
  validateOpenGameApplicationDraft,
} from "../../domain/open-game-registration-decoder";
import type {
  OpenGameApplicationDraft,
  OpenGameApplicationDraftValidation,
  OpenGameRegistrationContext,
} from "../../domain/open-game-registration";
import { readIntentHeaderLayout } from "../../presentation/intent-header-layout";
import { OpenGameRegistrationApiError } from "../../services/http-open-game-registration";
import {
  classifyOpenGameRegistrationMutationResult,
  classifyOpenGameRegistrationPendingAttempt,
  classifyOpenGameRegistrationUnknownResult,
  getOpenGameRegistrationAttemptStore,
  getOpenGameRegistrationSource,
  type OpenGameRegistrationApplyAttempt,
  type OpenGameRegistrationAttempt,
} from "../../services/open-game-registration";

interface PageOptions { token?: unknown; }
interface TextInputEvent { detail?: { value?: unknown }; }
interface PositionEvent { currentTarget?: { dataset?: { position?: unknown } }; }
interface CheckboxEvent { detail?: { value?: unknown }; }

type ApplicationStatus =
  | "LOADING"
  | "READY"
  | "SUBMITTING"
  | "AUTH_LOSS"
  | "RESULT_UNKNOWN"
  | "LOAD_ERROR"
  | "NOT_FOUND"
  | "AUTHORITY_CHANGED"
  | "CONFLICT"
  | "OTHER_PENDING"
  | "FOREIGN_PENDING"
  | "SUBMITTED_NAV_ERROR";

type DraftField = keyof OpenGameApplicationDraft;
type ServerErrors = Partial<Record<DraftField, string>>;

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const POSITIONS = [
  { value: "GOALKEEPER", label: "门将" },
  { value: "DEFENDER", label: "后卫" },
  { value: "MIDFIELDER", label: "中场" },
  { value: "FORWARD", label: "前锋" },
  { value: "ANY", label: "不限" },
] as const;
const POSITION_VALUES = new Set(POSITIONS.map((position) => position.value));
const FIELD_NAMES: Readonly<Partial<Record<string, DraftField>>> = {
  display_name: "displayName",
  position: "position",
  note: "note",
  adult_confirmed: "adultConfirmed",
  risk_confirmed: "riskConfirmed",
};
let attemptSerial = 0;

function emptyDraft(): OpenGameApplicationDraft {
  return {
    displayName: "",
    position: null,
    note: "",
    adultConfirmed: false,
    riskConfirmed: false,
  };
}

function isChecked(value: unknown): boolean {
  return Array.isArray(value) ? value.length > 0 : value === true;
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

async function navigateToSharedDetail(token: string): Promise<void> {
  const url = `/pages/captain-game-public/index?token=${token}`;
  const previous = currentPages()[currentPages().length - 2];
  if (previous?.route === "pages/captain-game-public/index") {
    try {
      await navigation("navigateBack", { delta: 1 });
      return;
    } catch {
      // Fall through to the deterministic route when native back fails.
    }
  }
  try {
    await navigation("redirectTo", { url });
  } catch {
    await navigation("reLaunch", { url });
  }
}

async function navigateToPending(route: string): Promise<void> {
  try {
    await navigation("redirectTo", { url: route });
  } catch {
    await navigation("reLaunch", { url: route });
  }
}

function readHeaderData() {
  const header = readIntentHeaderLayout();
  return {
    headerTopPx: header.topPx,
    headerRowHeightPx: header.rowHeightPx,
  };
}

function mergeValidation(
  draft: OpenGameApplicationDraft,
  serverErrors: ServerErrors,
): OpenGameApplicationDraftValidation {
  const base = validateOpenGameApplicationDraft(draft);
  const errors = Object.freeze({ ...base.errors, ...serverErrors });
  if (Object.values(errors).some((error) => error !== null && error !== undefined)) {
    return Object.freeze({ valid: false, errors });
  }
  return base;
}

function blankData() {
  const draft = emptyDraft();
  return {
    status: "LOADING" as ApplicationStatus,
    draft,
    validation: validateOpenGameApplicationDraft(draft),
    positions: POSITIONS.map((position) => ({ ...position, selected: false })),
    noteLength: 0,
    attempted: false,
    canSubmit: false,
    errorMessage: "",
    navigationError: "",
    pendingRoute: "",
    headerTopPx: 0,
    headerRowHeightPx: 44,
  };
}

function validUserId(value: string | null): value is string {
  return value !== null && UUID_PATTERN.test(value);
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

function errorMessageForAuthority(context: OpenGameRegistrationContext): string {
  switch (context.allowedActions.applyBlockedReason) {
    case "AUTH_REQUIRED": return "请先登录，再继续申请。";
    case "OWNER_CANNOT_APPLY": return "队长不能申请自己组织的球局。";
    case "ALREADY_APPLIED": return "你已经申请过这场球局，请返回详情查看结果。";
    case "GAME_NOT_PUBLISHED": return "这场球局暂未开放申请。";
    case "REGISTRATION_DEADLINE_PASSED": return "报名已经截止。";
    case "GAME_SUSPENDED": return "球局暂时停止报名。";
    case "GAME_CANCELLED": return "球局已取消。";
    case "GAME_COMPLETED": return "球局已结束。";
    case "GAME_STARTED": return "球局已经开始。";
    default: return "当前状态暂时不能申请。";
  }
}

Page({
  data: blankData(),
  loadGeneration: 0,
  visible: true,
  skipNextShow: false,
  routeToken: "",
  authority: null as OpenGameRegistrationContext | null,
  authorityUserId: null as string | null,
  mutationInFlight: null as Promise<void> | null,
  pendingRoute: "",
  serverErrors: {} as ServerErrors,

  onLoad(options: PageOptions = {}) {
    this.visible = true;
    this.skipNextShow = true;
    this.authority = null;
    this.authorityUserId = null;
    this.mutationInFlight = null;
    this.pendingRoute = "";
    this.serverErrors = {};
    const header = readHeaderData();
    if (Object.keys(options).length !== 1
      || typeof options.token !== "string"
      || !TOKEN_PATTERN.test(options.token)) {
      this.routeToken = "";
      this.setData({
        ...blankData(),
        ...header,
        status: "NOT_FOUND",
        errorMessage: "链接不存在或已失效。",
      });
      return;
    }
    this.routeToken = options.token;
    this.setData({ ...blankData(), ...header });
    void this.loadAuthority();
  },

  onShow() {
    if (this.skipNextShow) {
      this.skipNextShow = false;
      return;
    }
    this.visible = true;
    if (this.routeToken) void this.loadAuthority();
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

  currentUserId(): string | null {
    try {
      return getOpenGameRegistrationSource().currentUserId();
    } catch {
      return null;
    }
  },

  async loadAuthority() {
    if (!this.routeToken) return;
    const generation = ++this.loadGeneration;
    this.setData({ status: "LOADING", errorMessage: "", navigationError: "", canSubmit: false });
    try {
      const context = await getOpenGameRegistrationSource().getContext(this.routeToken);
      if (!this.active(generation)) return;
      await this.applyAuthority(context, generation);
    } catch (caught) {
      if (!this.active(generation)) return;
      this.handleReadError(caught);
    }
  },

  async applyAuthority(context: OpenGameRegistrationContext, generation: number) {
    this.authority = context;
    const userId = this.currentUserId();
    this.authorityUserId = validUserId(userId) ? userId : null;
    const pending = getOpenGameRegistrationAttemptStore().load();
    if (pending !== null) {
      const decision = classifyOpenGameRegistrationPendingAttempt(
        pending,
        this.authorityUserId,
        { kind: "apply", shareToken: this.routeToken },
      );
      if (decision.kind === "PRESERVE_LOGIN_COMPARE_ACCOUNT") {
        this.setData({
          status: "AUTH_LOSS",
          errorMessage: "登录状态需要恢复，原提交记录已保留。",
          canSubmit: false,
        });
        return;
      }
      if (decision.kind === "FOREIGN_ACCOUNT_PENDING") {
        this.setData({
          status: "FOREIGN_PENDING",
          errorMessage: "本机有另一账号尚未确认的操作，绝不会用当前账号重放。",
          canSubmit: false,
        });
        return;
      }
      if (decision.kind === "PRESERVE_AND_NAVIGATE") {
        this.pendingRoute = decision.route;
        this.setData({
          status: "OTHER_PENDING",
          pendingRoute: decision.route,
          errorMessage: "请先确认本机上一项操作，再开始新的申请。",
          canSubmit: false,
        });
        return;
      }
      if (decision.attempt.kind !== "apply") return;
      this.restoreAttemptDraft(decision.attempt);
      if (context.viewerRegistration !== null) {
        const recovery = classifyOpenGameRegistrationUnknownResult(decision.attempt, context);
        if (recovery.kind === "ACCEPT_AUTHORITY_AND_CLEAR") {
          this.clearAttemptIfCurrent(decision.attempt);
          if (!this.active(generation)) return;
          this.setData({
            status: "AUTHORITY_CHANGED",
            errorMessage: "申请已提交，正在返回球局详情。",
            canSubmit: false,
          });
          await this.returnToGame(false);
        }
        return;
      }
      this.setData({
        status: "RESULT_UNKNOWN",
        errorMessage: "检测到原申请结果尚未确认，请先确认申请结果。",
        canSubmit: false,
      });
      return;
    }
    if (!context.viewerAuthenticated || this.authorityUserId === null) {
      this.setData({
        status: "AUTH_LOSS",
        errorMessage: "请重新登录并读取这场球局。",
        canSubmit: false,
      });
      return;
    }
    if (context.viewerRegistration !== null || !context.allowedActions.canApply) {
      this.setData({
        status: "AUTHORITY_CHANGED",
        errorMessage: context.viewerRegistration === null
          ? errorMessageForAuthority(context)
          : "你已有本场申请，请返回详情查看结果。",
        canSubmit: false,
      });
      return;
    }
    this.setData({ status: "READY", errorMessage: "", navigationError: "" });
    this.syncDraft();
  },

  handleReadError(caught: unknown) {
    if (caught instanceof OpenGameRegistrationApiError && caught.code === "AUTH_REQUIRED") {
      this.setData({
        status: "AUTH_LOSS",
        errorMessage: "登录状态已失效，当前输入和原提交记录仍保留。",
        canSubmit: false,
      });
      return;
    }
    if (caught instanceof OpenGameRegistrationApiError && caught.code === "OPEN_GAME_NOT_FOUND") {
      this.clearOwnedCurrentAttempt();
      this.setData({
        status: "NOT_FOUND",
        errorMessage: "链接不存在或已失效。",
        canSubmit: false,
      });
      return;
    }
    this.setData({
      status: "LOAD_ERROR",
      errorMessage: "暂时无法读取申请信息，请稍后重试。",
      canSubmit: false,
    });
  },

  clearOwnedCurrentAttempt() {
    const attempt = getOpenGameRegistrationAttemptStore().load();
    const userId = this.currentUserId();
    if (attempt?.kind === "apply"
      && attempt.shareToken === this.routeToken
      && userId === attempt.originatingUserId) {
      getOpenGameRegistrationAttemptStore().clear();
    }
  },

  clearAttemptIfCurrent(attempt: OpenGameRegistrationApplyAttempt) {
    const current = getOpenGameRegistrationAttemptStore().load();
    if (current?.kind === "apply" && sameApplyAttempt(current, attempt)) {
      getOpenGameRegistrationAttemptStore().clear();
    }
  },

  restoreAttemptDraft(attempt: OpenGameRegistrationApplyAttempt) {
    this.serverErrors = {};
    this.setData({
      draft: {
        displayName: attempt.body.displayName,
        position: attempt.body.position,
        note: attempt.body.note ?? "",
        adultConfirmed: true,
        riskConfirmed: true,
      },
      attempted: true,
    });
    this.syncDraft();
  },

  syncDraft() {
    const draft = this.data.draft as OpenGameApplicationDraft;
    const validation = mergeValidation(draft, this.serverErrors);
    const currentUserId = this.currentUserId();
    const canSubmit = this.data.status === "READY"
      && validation.valid
      && this.authority?.viewerAuthenticated === true
      && this.authority.allowedActions.canApply
      && validUserId(currentUserId)
      && currentUserId === this.authorityUserId
      && getOpenGameRegistrationAttemptStore().load() === null;
    this.setData({
      validation,
      canSubmit,
      noteLength: Array.from(draft.note).length,
      positions: POSITIONS.map((position) => ({
        ...position,
        selected: draft.position === position.value,
      })),
    });
  },

  updateDraft(next: Partial<OpenGameApplicationDraft>, clearedField: DraftField) {
    if (this.data.status !== "READY") return;
    const draft = { ...(this.data.draft as OpenGameApplicationDraft), ...next };
    delete this.serverErrors[clearedField];
    this.setData({ draft, errorMessage: "" });
    this.syncDraft();
  },

  onDisplayNameInput(event: TextInputEvent) {
    this.updateDraft(
      { displayName: typeof event.detail?.value === "string" ? event.detail.value : "" },
      "displayName",
    );
  },

  onPositionTap(event: PositionEvent) {
    const value = event.currentTarget?.dataset?.position;
    if (typeof value === "string" && POSITION_VALUES.has(value as typeof POSITIONS[number]["value"])) {
      this.updateDraft({ position: value as typeof POSITIONS[number]["value"] }, "position");
    }
  },

  onNoteInput(event: TextInputEvent) {
    this.updateDraft(
      { note: typeof event.detail?.value === "string" ? event.detail.value : "" },
      "note",
    );
  },

  onAdultChange(event: CheckboxEvent) {
    this.updateDraft({ adultConfirmed: isChecked(event.detail?.value) }, "adultConfirmed");
  },

  onRiskChange(event: CheckboxEvent) {
    this.updateDraft({ riskConfirmed: isChecked(event.detail?.value) }, "riskConfirmed");
  },

  onSubmit() {
    if (this.mutationInFlight !== null) return this.mutationInFlight;
    this.setData({ attempted: true, navigationError: "" });
    this.syncDraft();
    const local = validateOpenGameApplicationDraft(this.data.draft as OpenGameApplicationDraft);
    if (this.data.status !== "READY" || !local.valid || Object.keys(this.serverErrors).length > 0) {
      return Promise.resolve();
    }
    const userId = this.currentUserId();
    if (!validUserId(userId)
      || !this.authority?.viewerAuthenticated
      || !this.authority.allowedActions.canApply
      || userId !== this.authorityUserId) {
      this.setData({
        status: "AUTH_LOSS",
        errorMessage: "登录账号或球局权限已变化，请重新登录并读取。",
        canSubmit: false,
      });
      return Promise.resolve();
    }
    const requested: OpenGameRegistrationApplyAttempt = {
      kind: "apply",
      originatingUserId: userId,
      shareToken: this.routeToken,
      body: local.submission,
      idempotencyKey: `application-${Date.now()}-${++attemptSerial}`,
    };
    let availability;
    try {
      availability = getOpenGameRegistrationAttemptStore().begin(requested);
    } catch {
      this.setData({
        status: "LOAD_ERROR",
        errorMessage: "无法安全保存提交记录，本次申请尚未发送。",
        canSubmit: false,
      });
      return Promise.resolve();
    }
    if (availability.kind !== "READY") {
      this.presentPendingAttempt(availability.attempt, userId);
      return Promise.resolve();
    }
    if (availability.attempt.kind !== "apply") return Promise.resolve();
    const promise = this.executeApply(availability.attempt).finally(() => {
      this.mutationInFlight = null;
    });
    this.mutationInFlight = promise;
    return promise;
  },

  presentPendingAttempt(attempt: OpenGameRegistrationAttempt, userId: string | null) {
    const decision = classifyOpenGameRegistrationPendingAttempt(
      attempt,
      userId,
      { kind: "apply", shareToken: this.routeToken },
    );
    if (decision.kind === "FOREIGN_ACCOUNT_PENDING") {
      this.setData({
        status: "FOREIGN_PENDING",
        errorMessage: "本机有另一账号尚未确认的操作，绝不会用当前账号重放。",
        canSubmit: false,
      });
      return;
    }
    if (decision.kind === "PRESERVE_AND_NAVIGATE") {
      this.pendingRoute = decision.route;
      this.setData({
        status: "OTHER_PENDING",
        pendingRoute: decision.route,
        errorMessage: "请先确认本机上一项操作，再开始新的申请。",
        canSubmit: false,
      });
      return;
    }
    if (decision.kind === "PRESERVE_LOGIN_COMPARE_ACCOUNT") {
      this.setData({
        status: "AUTH_LOSS",
        errorMessage: "请恢复原账号后确认上一项操作。",
        canSubmit: false,
      });
      return;
    }
    if (decision.attempt.kind === "apply") this.restoreAttemptDraft(decision.attempt);
    this.setData({
      status: "RESULT_UNKNOWN",
      errorMessage: "检测到原申请结果尚未确认，请先确认申请结果。",
      canSubmit: false,
    });
  },

  async executeApply(attempt: OpenGameRegistrationApplyAttempt) {
    const generation = this.loadGeneration;
    this.setData({
      status: "SUBMITTING",
      errorMessage: "正在提交申请，请勿重复操作。",
      canSubmit: false,
    });
    try {
      const context = await getOpenGameRegistrationSource().apply(attempt);
      if (!this.active(generation)) return;
      const decision = classifyOpenGameRegistrationMutationResult("SUCCESS");
      if (decision.clearAttempt) this.clearAttemptIfCurrent(attempt);
      this.authority = context;
      this.setData({ errorMessage: "申请已提交，正在返回球局详情。" });
      await this.returnToGame(true);
    } catch (caught) {
      if (!this.active(generation)) return;
      await this.handleMutationError(attempt, caught, generation);
    }
  },

  async handleMutationError(
    attempt: OpenGameRegistrationApplyAttempt,
    caught: unknown,
    generation: number,
  ) {
    if (!(caught instanceof OpenGameRegistrationApiError)) {
      this.setData({
        status: "RESULT_UNKNOWN",
        errorMessage: "申请结果暂时未知，请确认后再继续。",
        canSubmit: false,
      });
      return;
    }
    const decision = classifyOpenGameRegistrationMutationResult(caught.code);
    if (decision.kind === "PRESERVE_LOGIN_COMPARE_ACCOUNT") {
      this.setData({
        status: "AUTH_LOSS",
        errorMessage: "登录状态需要恢复，当前输入和原提交记录已保留。",
        canSubmit: false,
      });
      return;
    }
    if (decision.kind === "PRESERVE_APPLICATION_RESULT_UNKNOWN"
      || decision.kind === "RETRY_READ") {
      this.setData({
        status: "RESULT_UNKNOWN",
        errorMessage: "申请结果暂时未知，请确认后再继续。",
        canSubmit: false,
      });
      return;
    }
    if (decision.kind === "PRESERVE_READ_CONTEXT_THEN_CLEAR") {
      await this.resolveUnknown(attempt, generation, false);
      return;
    }
    if (decision.clearAttempt) this.clearAttemptIfCurrent(attempt);
    if (decision.kind === "CLEAR_AND_CORRECT_OR_REFRESH") {
      this.applyServerErrors(caught);
      return;
    }
    if (decision.kind === "CLEAR_AND_REFRESH_CONTEXT") {
      await this.refreshAfterDefinitiveChange(generation);
      return;
    }
    if (decision.kind === "CLEAR_AND_RETURN") {
      this.setData({
        status: "NOT_FOUND",
        errorMessage: "球局已不可用，本次申请没有确认成功。",
        canSubmit: false,
      });
      return;
    }
    this.setData({
      status: decision.kind === "CLEAR_AND_SHOW_CONFLICT" ? "CONFLICT" : "AUTHORITY_CHANGED",
      errorMessage: decision.kind === "CLEAR_AND_SHOW_CONFLICT"
        ? "本次提交记录发生冲突，请返回球局详情后重新进入。"
        : "球局状态已变化，请返回详情查看最新结果。",
      canSubmit: false,
    });
  },

  applyServerErrors(error: OpenGameRegistrationApiError) {
    const details = error.details as { readonly fields?: readonly { field: string; message: string }[] };
    const next: ServerErrors = {};
    for (const fieldError of details?.fields ?? []) {
      const field = FIELD_NAMES[fieldError.field];
      if (field !== undefined) next[field] = fieldError.message;
    }
    if (Object.keys(next).length === 0) {
      this.setData({
        status: "CONFLICT",
        errorMessage: "提交内容未通过服务端校验，请返回详情后重试。",
        canSubmit: false,
      });
      return;
    }
    this.serverErrors = next;
    this.setData({
      status: "READY",
      attempted: true,
      errorMessage: "请按提示修正申请信息。",
    });
    this.syncDraft();
  },

  async refreshAfterDefinitiveChange(generation: number) {
    try {
      const context = await getOpenGameRegistrationSource().getContext(this.routeToken);
      if (!this.active(generation)) return;
      this.authority = context;
      this.setData({
        status: "AUTHORITY_CHANGED",
        errorMessage: errorMessageForAuthority(context),
        canSubmit: false,
      });
      await this.returnToGame(false);
    } catch (caught) {
      if (!this.active(generation)) return;
      this.handleReadError(caught);
    }
  },

  onConfirmResult() {
    if (this.mutationInFlight !== null) return this.mutationInFlight;
    const attempt = getOpenGameRegistrationAttemptStore().load();
    const userId = this.currentUserId();
    if (attempt === null) {
      return this.loadAuthority();
    }
    const decision = classifyOpenGameRegistrationPendingAttempt(
      attempt,
      userId,
      { kind: "apply", shareToken: this.routeToken },
    );
    if (decision.kind !== "READY" || decision.attempt.kind !== "apply") {
      this.presentPendingAttempt(attempt, userId);
      return Promise.resolve();
    }
    const generation = this.loadGeneration;
    const promise = this.resolveUnknown(decision.attempt, generation, true).finally(() => {
      this.mutationInFlight = null;
    });
    this.mutationInFlight = promise;
    return promise;
  },

  async resolveUnknown(
    attempt: OpenGameRegistrationApplyAttempt,
    generation: number,
    allowReplay: boolean,
  ) {
    this.setData({
      status: "RESULT_UNKNOWN",
      errorMessage: "正在读取权威申请结果…",
      canSubmit: false,
    });
    try {
      const context = await getOpenGameRegistrationSource().getContext(attempt.shareToken);
      if (!this.active(generation)) return;
      const userId = this.currentUserId();
      const durable = getOpenGameRegistrationAttemptStore().load();
      if (durable === null) {
        this.setData({
          status: "CONFLICT",
          errorMessage: "本机待确认记录已变化，没有发送新的申请。",
          canSubmit: false,
        });
        return;
      }
      const pending = classifyOpenGameRegistrationPendingAttempt(
        durable,
        userId,
        { kind: "apply", shareToken: this.routeToken },
      );
      if (pending.kind !== "READY" || pending.attempt.kind !== "apply") {
        this.presentPendingAttempt(durable, userId);
        return;
      }
      if (!sameApplyAttempt(pending.attempt, attempt)) {
        this.presentPendingAttempt(pending.attempt, userId);
        return;
      }
      const recovery = classifyOpenGameRegistrationUnknownResult(pending.attempt, context);
      if (recovery.kind === "ACCEPT_AUTHORITY_AND_CLEAR") {
        this.clearAttemptIfCurrent(pending.attempt);
        this.authority = recovery.authority;
        this.setData({ errorMessage: "申请已提交，正在返回球局详情。" });
        await this.returnToGame(true);
        return;
      }
      if (allowReplay) {
        await this.executeApply(recovery.attempt as OpenGameRegistrationApplyAttempt);
        return;
      }
      this.setData({
        status: "RESULT_UNKNOWN",
        errorMessage: "仍未读取到申请结果，请稍后再次确认。",
        canSubmit: false,
      });
    } catch (caught) {
      if (!this.active(generation)) return;
      if (caught instanceof OpenGameRegistrationApiError && caught.code === "AUTH_REQUIRED") {
        this.setData({
          status: "AUTH_LOSS",
          errorMessage: "请恢复原账号后继续确认申请结果。",
          canSubmit: false,
        });
      } else if (caught instanceof OpenGameRegistrationApiError
        && caught.code === "OPEN_GAME_NOT_FOUND") {
        this.clearOwnedCurrentAttempt();
        this.setData({
          status: "NOT_FOUND",
          errorMessage: "球局已不可用，本次申请无法继续确认。",
          canSubmit: false,
        });
      } else {
        this.setData({
          status: "RESULT_UNKNOWN",
          errorMessage: "暂时无法确认申请结果，请稍后重试。",
          canSubmit: false,
        });
      }
    }
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
          this.setData({
            status: "FOREIGN_PENDING",
            errorMessage: "登录账号与原操作账号不同，绝不会重放原操作。",
            canSubmit: false,
          });
          return;
        }
        await this.loadAuthority();
      } catch {
        if (!this.active(generation)) return;
        this.setData({
          status: "AUTH_LOSS",
          errorMessage: "登录失败，请重试；当前输入和原提交记录仍保留。",
          canSubmit: false,
        });
      }
    })().finally(() => { this.mutationInFlight = null; });
    this.mutationInFlight = promise;
    return promise;
  },

  onReload() {
    this.visible = true;
    return this.loadAuthority();
  },

  async onGoPending() {
    if (this.data.status !== "OTHER_PENDING" || !this.pendingRoute) return;
    try {
      await navigateToPending(this.pendingRoute);
    } catch {
      if (this.visible) this.setData({ navigationError: "暂时无法前往确认，请重试。" });
    }
  },

  onClearPending() {
    if (this.data.status !== "FOREIGN_PENDING") return Promise.resolve();
    getOpenGameRegistrationAttemptStore().clear();
    this.pendingRoute = "";
    this.setData({ pendingRoute: "", errorMessage: "已清除本机待确认记录，正在读取当前账号。" });
    return this.loadAuthority();
  },

  resetLocalDraft() {
    if (getOpenGameRegistrationAttemptStore().load() !== null) return;
    const draft = emptyDraft();
    this.serverErrors = {};
    this.setData({
      draft,
      validation: validateOpenGameApplicationDraft(draft),
      positions: POSITIONS.map((position) => ({ ...position, selected: false })),
      noteLength: 0,
      attempted: false,
      canSubmit: false,
    });
  },

  async returnToGame(submitted: boolean) {
    if (!this.routeToken) {
      try {
        if (currentPages().length > 1) await navigation("navigateBack", { delta: 1 });
        else await navigation("reLaunch", { url: "/pages/intent-entry/index" });
      } catch {
        if (this.visible) this.setData({ navigationError: "暂时无法返回，请重试。" });
      }
      return;
    }
    try {
      await navigateToSharedDetail(this.routeToken);
    } catch {
      if (!this.visible) return;
      this.setData({
        status: submitted ? "SUBMITTED_NAV_ERROR" : this.data.status,
        navigationError: submitted
          ? "申请已经提交，但暂时无法返回球局详情。"
          : "暂时无法返回球局详情，请重试。",
        canSubmit: false,
      });
    }
  },

  onCancel() {
    this.resetLocalDraft();
    return this.returnToGame(false);
  },

  onHeaderBack() {
    this.resetLocalDraft();
    return this.returnToGame(false);
  },

  onReturnGame() {
    return this.returnToGame(false);
  },
});
