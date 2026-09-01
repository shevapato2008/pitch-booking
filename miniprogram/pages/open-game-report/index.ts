import {
  OPEN_GAME_REPORT_CATEGORIES,
  openGameReportCategoryLabel,
  type OpenGameReportCategory,
  type OpenGameReportContext,
  type OpenGameReportForReporter,
} from "../../domain/open-game-report";
import { validateOpenGameReportFacts } from "../../domain/open-game-report-decoder";
import { readIntentHeaderLayout } from "../../presentation/intent-header-layout";
import { formatOpenGameDateTime, formatOpenGameRange } from "../../presentation/open-game";
import { OpenGameReportApiError } from "../../services/http-open-game-report";
import {
  getOpenGameReportAttemptStore,
  getOpenGameReportSource,
  type OpenGameReportAttempt,
} from "../../services/open-game-report";

interface PageOptions { game_id?: unknown; }
interface CategoryEvent { currentTarget?: { dataset?: { category?: unknown } }; }
interface FactsEvent { detail?: { value?: unknown }; }
type PageStatus =
  | "LOADING"
  | "READY"
  | "LOAD_ERROR"
  | "AUTH_LOSS"
  | "NOT_FOUND"
  | "RESULT_UNKNOWN"
  | "OTHER_PENDING"
  | "FOREIGN_PENDING";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const categories = OPEN_GAME_REPORT_CATEGORIES.map((value) => ({
  value,
  label: openGameReportCategoryLabel(value),
}));
let attemptSerial = 0;

function hideShare(): void {
  try { void wx.hideShareMenu(); } catch { /* platform unavailable during teardown */ }
}

function navigation(
  method: "navigateBack" | "redirectTo" | "navigateTo",
  url?: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = () => { if (!settled) { settled = true; resolve(); } };
    const fail = (error: unknown) => { if (!settled) { settled = true; reject(error); } };
    const returned = method === "navigateBack"
      ? wx.navigateBack({ delta: 1, success: done, fail })
      : method === "navigateTo"
        ? wx.navigateTo({ url: url as string, success: done, fail })
        : wx.redirectTo({ url: url as string, success: done, fail });
    const thenable = returned as unknown as {
      then?: (yes: () => void, no: (error: unknown) => void) => void;
    };
    if (typeof thenable?.then === "function") thenable.then(done, fail);
  });
}

function reportPresentation(report: OpenGameReportForReporter, timeZone: string) {
  return {
    ...report,
    categoryLabel: openGameReportCategoryLabel(report.category),
    submittedAtLabel: formatOpenGameDateTime(report.submittedAt, timeZone),
  };
}

function blankData() {
  return {
    status: "LOADING" as PageStatus,
    categories,
    gameName: "",
    teamName: "",
    venueName: "",
    pitchName: "",
    startsAtLabel: "",
    targetLabel: "本场球局及组织者",
    reportDeadlineLabel: "",
    submissionAllowed: false,
    submissionBlocker: null as string | null,
    report: null as ReturnType<typeof reportPresentation> | null,
    selectedCategory: null as OpenGameReportCategory | null,
    selectedCategoryLabel: "",
    facts: "",
    factsCount: 0,
    categoryError: "",
    factsError: "",
    confirmationOpen: false,
    submitting: false,
    resultUnknown: false,
    feedbackKind: "idle" as "idle" | "success" | "warning" | "info" | "error",
    feedback: "",
    errorMessage: "",
    pendingGameId: "",
    headerTopPx: 0,
    headerRowHeightPx: 44,
  };
}

function sameAttempt(left: OpenGameReportAttempt, right: OpenGameReportAttempt): boolean {
  return left.originatingUserId === right.originatingUserId
    && left.gameId === right.gameId
    && left.body.category === right.body.category
    && left.body.facts === right.body.facts
    && left.idempotencyKey === right.idempotencyKey;
}

Page({
  data: blankData(),
  loadGeneration: 0,
  visible: true,
  skipNextShow: false,
  routeGameId: "",
  mutationInFlight: null as Promise<void> | null,

  onLoad(options: PageOptions = {}) {
    this.visible = true;
    this.skipNextShow = true;
    this.mutationInFlight = null;
    hideShare();
    const header = readIntentHeaderLayout();
    const valid = Object.keys(options).length === 1
      && typeof options.game_id === "string"
      && UUID_PATTERN.test(options.game_id);
    if (!valid) {
      this.routeGameId = "";
      this.setData({
        ...blankData(),
        headerTopPx: header.topPx,
        headerRowHeightPx: header.rowHeightPx,
        status: "NOT_FOUND",
        errorMessage: "没有找到可举报的球局报名。",
      });
      return;
    }
    this.routeGameId = options.game_id as string;
    this.setData({
      ...blankData(),
      headerTopPx: header.topPx,
      headerRowHeightPx: header.rowHeightPx,
    });
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
  },

  onUnload() {
    this.visible = false;
    this.loadGeneration += 1;
  },

  active(generation: number): boolean {
    return this.visible && generation === this.loadGeneration;
  },

  runSingleFlight(action: () => Promise<void>): Promise<void> {
    if (this.mutationInFlight !== null) return this.mutationInFlight;
    const promise = action().finally(() => {
      if (this.mutationInFlight === promise) this.mutationInFlight = null;
    });
    this.mutationInFlight = promise;
    return promise;
  },

  async loadAuthority() {
    const generation = ++this.loadGeneration;
    this.setData({
      status: "LOADING",
      resultUnknown: false,
      confirmationOpen: false,
      feedback: "",
      errorMessage: "",
      submitting: false,
    });
    try {
      const context = await getOpenGameReportSource().getMyReport(this.routeGameId);
      if (!this.active(generation)) return;
      this.applyAuthorityWithAttempt(context);
    } catch (caught) {
      if (!this.active(generation)) return;
      this.handleReadError(caught);
    }
  },

  applyAuthorityWithAttempt(context: OpenGameReportContext) {
    let pending: OpenGameReportAttempt | null = null;
    try { pending = getOpenGameReportAttemptStore().load(); }
    catch {
      this.setData({
        status: "LOAD_ERROR",
        errorMessage: "暂时无法读取本机待确认记录，请稍后重试。",
      });
      return;
    }
    if (pending === null) {
      this.applyContext(context);
      return;
    }
    const userId = getOpenGameReportSource().currentUserId();
    if (userId === null || pending.originatingUserId !== userId) {
      this.applyContext(context);
      this.setData({
        status: "FOREIGN_PENDING",
        submissionAllowed: false,
        resultUnknown: false,
        pendingGameId: "",
        errorMessage: "另一账号有举报提交待确认，绝不会在当前账号重放。",
      });
      return;
    }
    if (pending.gameId !== this.routeGameId) {
      this.applyContext(context);
      this.setData({
        status: "OTHER_PENDING",
        submissionAllowed: false,
        resultUnknown: false,
        pendingGameId: pending.gameId,
        errorMessage: "另一场球局有举报提交待确认，请先完成原操作。",
      });
      return;
    }
    if (context.report !== null || !context.submissionAllowed) {
      getOpenGameReportAttemptStore().clearIfCurrent(pending);
      this.applyContext(context);
      return;
    }
    this.applyContext(context);
    this.presentUnknown("检测到原举报提交结果尚未确认。", pending.replayed);
  },

  applyContext(context: OpenGameReportContext) {
    const target = context.target;
    this.setData({
      status: "READY",
      gameName: target.gameName,
      teamName: target.organizerTeamName,
      venueName: target.venueName,
      pitchName: target.pitchName,
      startsAtLabel: formatOpenGameRange(target.startsAt, target.endsAt, target.timeZone),
      targetLabel: "本场球局及组织者",
      reportDeadlineLabel: formatOpenGameDateTime(context.reportDeadline, target.timeZone),
      submissionAllowed: context.submissionAllowed,
      submissionBlocker: context.submissionBlocker,
      report: context.report === null ? null : reportPresentation(context.report, target.timeZone),
      resultUnknown: false,
      confirmationOpen: false,
      submitting: false,
      feedback: "",
      feedbackKind: "idle",
      errorMessage: "",
      pendingGameId: "",
    });
  },

  presentUnknown(message: string, replayed: boolean) {
    this.setData({
      status: "RESULT_UNKNOWN",
      submissionAllowed: false,
      resultUnknown: true,
      confirmationOpen: false,
      submitting: false,
      feedbackKind: "warning",
      feedback: replayed
        ? "已使用原提交记录重试一次；后续只读取权威结果，不会再次提交。"
        : "提交结果暂时未知，不会生成第二条举报。",
      errorMessage: message,
    });
  },

  handleReadError(caught: unknown) {
    if (caught instanceof OpenGameReportApiError && caught.code === "AUTH_REQUIRED") {
      this.setData({
        status: "AUTH_LOSS",
        submissionAllowed: false,
        errorMessage: "登录状态已失效，请恢复原账号后继续。",
      });
      return;
    }
    if (caught instanceof OpenGameReportApiError && caught.code === "REPORT_CONTEXT_NOT_FOUND") {
      this.setData({
        status: "NOT_FOUND",
        submissionAllowed: false,
        errorMessage: "没有找到可举报的球局报名。",
      });
      return;
    }
    this.setData({
      status: "LOAD_ERROR",
      submissionAllowed: false,
      errorMessage: "举报信息暂时没有加载出来，请稍后重试。",
    });
  },

  onSelectCategory(event: CategoryEvent) {
    if (this.data.status !== "READY" || !this.data.submissionAllowed) return;
    const category = event.currentTarget?.dataset?.category;
    if (typeof category !== "string"
      || !OPEN_GAME_REPORT_CATEGORIES.includes(category as OpenGameReportCategory)) return;
    this.setData({
      selectedCategory: category as OpenGameReportCategory,
      selectedCategoryLabel: openGameReportCategoryLabel(category as OpenGameReportCategory),
      categoryError: "",
      feedback: "",
    });
  },

  onFactsInput(event: FactsEvent) {
    if (this.data.status !== "READY" || !this.data.submissionAllowed) return;
    const raw = typeof event.detail?.value === "string" ? event.detail.value : "";
    const normalized = raw.replace(/\r\n?/g, "\n").normalize("NFC");
    this.setData({
      facts: normalized,
      factsCount: Array.from(normalized.trim()).length,
      factsError: "",
      feedback: "",
    });
  },

  onPrepareSubmit() {
    if (this.data.status !== "READY" || !this.data.submissionAllowed || this.data.report) return;
    const categoryError = this.data.selectedCategory === null ? "请选择举报类别" : "";
    const validation = validateOpenGameReportFacts(this.data.facts);
    const factsError = validation.valid ? "" : validation.error;
    this.setData({ categoryError, factsError, confirmationOpen: !categoryError && validation.valid });
  },

  onCancelSubmit() {
    if (this.data.submitting) return;
    this.setData({ confirmationOpen: false });
  },

  onConfirmSubmit() {
    return this.runSingleFlight(async () => { await this.submitNew(); });
  },

  async submitNew() {
    if (!this.data.confirmationOpen
      || this.data.status !== "READY"
      || !this.data.submissionAllowed
      || this.data.selectedCategory === null) return;
    const validation = validateOpenGameReportFacts(this.data.facts);
    if (!validation.valid) {
      this.setData({ confirmationOpen: false, factsError: validation.error });
      return;
    }
    const userId = getOpenGameReportSource().currentUserId();
    if (userId === null) {
      this.setData({
        confirmationOpen: false,
        status: "AUTH_LOSS",
        submissionAllowed: false,
        errorMessage: "登录状态已失效，请恢复原账号后继续。",
      });
      return;
    }
    const requested: OpenGameReportAttempt = {
      originatingUserId: userId,
      gameId: this.routeGameId,
      body: { category: this.data.selectedCategory, facts: validation.facts },
      idempotencyKey: `game-report-${Date.now()}-${String(++attemptSerial).padStart(6, "0")}`,
      replayed: false,
    };
    let availability;
    try { availability = getOpenGameReportAttemptStore().begin(requested); }
    catch {
      this.setData({ confirmationOpen: false, feedbackKind: "error", feedback: "本机暂时无法保存提交记录，请重试。" });
      return;
    }
    if (availability.kind !== "READY") {
      this.setData({ confirmationOpen: false });
      this.presentPendingAttempt(availability.attempt);
      return;
    }
    const attempt = availability.attempt;
    const generation = this.loadGeneration;
    this.setData({ confirmationOpen: false, submitting: true, feedback: "正在提交举报…", feedbackKind: "info" });
    try {
      const report = await getOpenGameReportSource().submit(attempt);
      if (!this.active(generation)) return;
      if (!getOpenGameReportAttemptStore().clearIfCurrent(attempt)) {
        this.presentUnknown("本机待确认记录已变化，请重新读取权威结果。", attempt.replayed);
        return;
      }
      this.setData({
        status: "READY",
        submissionAllowed: false,
        submissionBlocker: "REPORT_ALREADY_EXISTS",
        report: reportPresentation(report, "Asia/Shanghai"),
        resultUnknown: false,
        submitting: false,
        feedbackKind: "success",
        feedback: "举报已提交，平台处理结果会回到本页。",
      });
    } catch (caught) {
      if (!this.active(generation)) return;
      await this.handleSubmitError(attempt, caught);
    }
  },

  presentPendingAttempt(pending: OpenGameReportAttempt) {
    const userId = getOpenGameReportSource().currentUserId();
    if (pending.originatingUserId !== userId) {
      this.setData({
        status: "FOREIGN_PENDING",
        submissionAllowed: false,
        resultUnknown: false,
        pendingGameId: "",
        errorMessage: "另一账号有举报提交待确认，绝不会在当前账号重放。",
      });
    } else if (pending.gameId !== this.routeGameId) {
      this.setData({
        status: "OTHER_PENDING",
        submissionAllowed: false,
        resultUnknown: false,
        pendingGameId: pending.gameId,
        errorMessage: "另一场球局有举报提交待确认，请先完成原操作。",
      });
    } else {
      this.presentUnknown("检测到原举报提交结果尚未确认。", pending.replayed);
    }
  },

  async handleSubmitError(attempt: OpenGameReportAttempt, caught: unknown) {
    if (!(caught instanceof OpenGameReportApiError)) {
      this.presentUnknown("举报提交结果暂时未知，请稍后确认。", attempt.replayed);
      return;
    }
    if (caught.code === "REPORT_RESULT_UNKNOWN" || caught.code === "SERVICE_UNAVAILABLE") {
      this.presentUnknown("举报提交结果暂时未知，请稍后确认。", attempt.replayed);
      return;
    }
    if (caught.code === "AUTH_REQUIRED" || caught.code === "LOGIN_FAILED") {
      this.setData({
        status: "AUTH_LOSS",
        submissionAllowed: false,
        submitting: false,
        errorMessage: "请恢复原账号后继续确认举报结果。",
      });
      return;
    }
    if (caught.code === "REPORT_ALREADY_EXISTS") {
      await this.recoverAlreadyExists(attempt);
      return;
    }
    getOpenGameReportAttemptStore().clearIfCurrent(attempt);
    if (caught.code === "REPORT_CONTEXT_NOT_FOUND") {
      this.setData({ status: "NOT_FOUND", submissionAllowed: false, submitting: false, errorMessage: "没有找到可举报的球局报名。" });
    } else if (caught.code === "REPORTING_WINDOW_CLOSED") {
      await this.loadAuthority();
    } else if (caught.code === "SENSITIVE_CONTENT_NOT_ALLOWED") {
      this.setData({ status: "READY", submitting: false, submissionAllowed: true, factsError: "请删除联系方式、链接或不可用字符", feedback: "" });
    } else if (caught.code === "INVALID_ARGUMENT") {
      this.setData({ status: "READY", submitting: false, submissionAllowed: true, factsError: "请检查事实说明后重试", feedback: "" });
    } else {
      this.setData({ status: "READY", submitting: false, submissionAllowed: true, feedbackKind: "error", feedback: "原提交记录与服务端不一致，请重新检查后提交。" });
    }
  },

  async recoverAlreadyExists(attempt: OpenGameReportAttempt) {
    try {
      const context = await getOpenGameReportSource().getMyReport(attempt.gameId);
      if (context.report === null) {
        this.presentUnknown("服务端提示已有举报，但暂时未读到结果，请稍后确认。", attempt.replayed);
        return;
      }
      getOpenGameReportAttemptStore().clearIfCurrent(attempt);
      this.applyContext(context);
    } catch {
      this.presentUnknown("举报结果暂时无法读取，请稍后确认。", attempt.replayed);
    }
  },

  onRecoverUnknownResult() {
    return this.runSingleFlight(async () => { await this.recoverUnknownResult(); });
  },

  async recoverUnknownResult() {
    let pending: OpenGameReportAttempt | null;
    try { pending = getOpenGameReportAttemptStore().load(); }
    catch {
      this.presentUnknown("暂时无法读取本机待确认记录，请稍后重试。", true);
      return;
    }
    if (pending === null) {
      await this.loadAuthority();
      return;
    }
    const userId = getOpenGameReportSource().currentUserId();
    if (pending.originatingUserId !== userId || pending.gameId !== this.routeGameId) {
      this.presentPendingAttempt(pending);
      return;
    }
    const generation = this.loadGeneration;
    this.setData({ submitting: true, feedbackKind: "info", feedback: "正在读取权威举报结果…" });
    try {
      const context = await getOpenGameReportSource().getMyReport(pending.gameId);
      if (!this.active(generation)) return;
      const durable = getOpenGameReportAttemptStore().load();
      if (durable === null || !sameAttempt(durable, pending)) {
        if (context.report !== null) this.applyContext(context);
        else this.presentUnknown("本机待确认记录已变化，没有发送新的举报。", true);
        return;
      }
      if (context.report !== null || !context.submissionAllowed) {
        getOpenGameReportAttemptStore().clearIfCurrent(durable);
        this.applyContext(context);
        return;
      }
      if (durable.replayed) {
        this.applyContext(context);
        this.presentUnknown("权威结果暂未出现，请稍后再次读取；不会再次提交。", true);
        return;
      }
      const replay = getOpenGameReportAttemptStore().markReplayed(durable);
      if (replay === null) {
        this.presentUnknown("本机待确认记录已变化，没有发送新的举报。", true);
        return;
      }
      try {
        const report = await getOpenGameReportSource().submit(replay);
        if (!this.active(generation)) return;
        if (!getOpenGameReportAttemptStore().clearIfCurrent(replay)) {
          this.presentUnknown("本机待确认记录已变化，请重新读取权威结果。", true);
          return;
        }
        this.setData({
          status: "READY",
          submissionAllowed: false,
          submissionBlocker: "REPORT_ALREADY_EXISTS",
          report: reportPresentation(report, context.target.timeZone),
          resultUnknown: false,
          submitting: false,
          feedbackKind: "success",
          feedback: "已确认原举报提交成功。",
        });
      } catch (caught) {
        if (!this.active(generation)) return;
        await this.handleSubmitError(replay, caught);
      }
    } catch (caught) {
      if (!this.active(generation)) return;
      if (caught instanceof OpenGameReportApiError && caught.code === "AUTH_REQUIRED") {
        this.setData({ status: "AUTH_LOSS", submissionAllowed: false, submitting: false, errorMessage: "请恢复原账号后继续确认举报结果。" });
      } else if (caught instanceof OpenGameReportApiError && caught.code === "REPORT_CONTEXT_NOT_FOUND") {
        getOpenGameReportAttemptStore().clearIfCurrent(pending);
        this.setData({ status: "NOT_FOUND", submissionAllowed: false, submitting: false, errorMessage: "没有找到可举报的球局报名。" });
      } else {
        this.presentUnknown("举报结果暂时无法读取，请稍后确认。", pending.replayed);
      }
    }
  },

  onReload() {
    return this.runSingleFlight(async () => { await this.loadAuthority(); });
  },

  onLogin() {
    return this.runSingleFlight(async () => {
      try {
        const userId = await getOpenGameReportSource().login();
        const pending = getOpenGameReportAttemptStore().load();
        if (pending !== null && pending.originatingUserId !== userId) {
          this.presentPendingAttempt(pending);
          return;
        }
        await this.loadAuthority();
      } catch {
        this.setData({ status: "AUTH_LOSS", submissionAllowed: false, errorMessage: "登录失败，请重试；本机待确认记录仍保留。" });
      }
    });
  },

  onGoPending() {
    if (!UUID_PATTERN.test(this.data.pendingGameId)) return Promise.resolve();
    return navigation("redirectTo", `/pages/open-game-report/index?game_id=${this.data.pendingGameId}`)
      .catch(() => { this.setData({ errorMessage: "暂时无法打开原举报，请重试。" }); });
  },

  onClearPending() {
    try { getOpenGameReportAttemptStore().clear(); }
    catch {
      this.setData({ errorMessage: "暂时无法清除本机记录，请重试。" });
      return Promise.resolve();
    }
    return this.runSingleFlight(async () => { await this.loadAuthority(); });
  },

  onHeaderBack() {
    const pages = getCurrentPages();
    return (pages.length > 1
      ? navigation("navigateBack")
      : navigation("redirectTo", "/pages/my-game-registrations/index"))
      .catch(() => { this.setData({ errorMessage: "暂时无法返回，请重试。" }); });
  },
});
