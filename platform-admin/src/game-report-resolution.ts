import {
  ApiError,
  PlatformApi,
  SessionExpiredError,
  type OpenGameReportResolutionOutcome,
  type OpenGameReportStatus,
  type PlatformGameReportDetail,
  type PlatformGameReportQueueItem,
  type PlatformGameReportResolutionRequest,
} from "./api";

export type ResolutionNoteValidation =
  | { ok: true; value: string; codePoints: number }
  | { ok: false; error: string };

const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const SENSITIVE_CONTENT = [
  /(?:^|[^\w.+-])[\w.+-]+@[\w-]+(?:\.[\w-]+)+/i,
  /(?:^|[^0-9])(?:\+?86[\s-]?)?1[3-9](?:[\s-]?[0-9]){9}(?:$|[^0-9])/,
  /(?:^|[^0-9])0[1-9][0-9]{1,2}[\s-]?[1-9][0-9]{6,7}(?:$|[^0-9])/,
  /https?:\/\/|www\.|(?:^|\s)[a-z0-9-]+\.(?:com|cn|net|org)(?:[/\s]|$)/i,
  /微信(?:号|账号)|联系账号|wechat|(?:^|[^a-z0-9])(?:vx|wx|qq)(?:[^a-z0-9]|$)/i,
];

export function validateResolutionNote(input: string): ResolutionNoteValidation {
  const value = input.replace(/\r\n?/g, "\n").normalize("NFC").trim();
  const codePoints = Array.from(value).length;
  if (codePoints === 0) return { ok: false, error: "请填写处置说明" };
  if (codePoints > 500) return { ok: false, error: "处置说明不能超过 500 个字符" };
  if (CONTROL_CHARACTERS.test(value)) return { ok: false, error: "处置说明包含不可用字符" };
  if (SENSITIVE_CONTENT.some((pattern) => pattern.test(value))) {
    return { ok: false, error: "请删除手机号、微信号、邮箱、链接或其他联系方式" };
  }
  return { ok: true, value, codePoints };
}

export type GameReportFeedback = {
  type: "success" | "warning" | "error" | "info";
  title: string;
  message: string;
  recovery?: boolean;
};

export type GameReportPendingAttempt = {
  reportId: string;
  body: Readonly<PlatformGameReportResolutionRequest>;
  idempotencyKey: string;
  phase: "UNKNOWN" | "CONFIRMED";
  replayed: boolean;
};

export interface GameReportResolutionState {
  filter: OpenGameReportStatus;
  items: PlatformGameReportQueueItem[];
  nextCursor: string | null;
  selected: PlatformGameReportDetail | null;
  loading: boolean;
  loadingMore: boolean;
  resolving: boolean;
  error: string | null;
  selectedOutcome: OpenGameReportResolutionOutcome | null;
  note: string;
  noteError: string | null;
  confirmationOpen: boolean;
  pendingAttempt: GameReportPendingAttempt | null;
  feedback: GameReportFeedback | null;
}

export type GameReportActionResult =
  | { ok: true; kind?: "CONFIRMED" | "AUTHORITY_UPDATED" | "CONFIRMED_REFRESH_REQUIRED" }
  | { ok: false; error: string; refreshed?: boolean; refreshRequired?: boolean };

const initialState = (): GameReportResolutionState => ({
  filter: "PENDING",
  items: [],
  nextCursor: null,
  selected: null,
  loading: false,
  loadingMore: false,
  resolving: false,
  error: null,
  selectedOutcome: null,
  note: "",
  noteError: null,
  confirmationOpen: false,
  pendingAttempt: null,
  feedback: null,
});

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "平台服务暂时不可用，请重试";

const unknownMutationResult = (error: unknown): boolean =>
  !(error instanceof ApiError) || error.status >= 500;

const defaultIdempotencyKey = (): string => {
  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `game-report-resolution-${id}`;
};

export class GameReportResolutionController {
  state: GameReportResolutionState = initialState();
  private generation = 0;

  constructor(
    private readonly api: PlatformApi,
    private readonly createIdempotencyKey: () => string = defaultIdempotencyKey,
  ) {}

  async load(filter: OpenGameReportStatus = this.state.filter): Promise<GameReportActionResult> {
    if (this.state.pendingAttempt) return this.recoveryBlocked();
    const generation = ++this.generation;
    const previousId = filter === this.state.filter ? this.state.selected?.report_id : null;
    this.state = {
      ...this.state,
      filter,
      items: [],
      nextCursor: null,
      selected: null,
      loading: true,
      loadingMore: false,
      error: null,
      selectedOutcome: null,
      note: "",
      noteError: null,
      confirmationOpen: false,
      feedback: null,
    };
    try {
      const page = await this.api.listGameReports({ state: filter, limit: 20 });
      if (generation !== this.generation) return { ok: false, error: "加载已取消" };
      this.state = {
        ...this.state,
        items: page.items,
        nextCursor: page.next_cursor,
        loading: false,
      };
      const selectedId = page.items.some((item) => item.report_id === previousId)
        ? previousId
        : page.items[0]?.report_id;
      if (selectedId) return this.select(selectedId, generation);
      return { ok: true };
    } catch (error) {
      if (generation !== this.generation) return { ok: false, error: "加载已取消" };
      if (error instanceof SessionExpiredError) throw error;
      const message = errorMessage(error);
      this.state = { ...this.state, loading: false, error: message };
      return { ok: false, error: message };
    }
  }

  setFilter(filter: OpenGameReportStatus): Promise<GameReportActionResult> {
    if (this.state.pendingAttempt) return Promise.resolve(this.recoveryBlocked());
    return this.load(filter);
  }

  async loadMore(): Promise<GameReportActionResult> {
    if (this.state.pendingAttempt) return this.recoveryBlocked();
    if (!this.state.nextCursor || this.state.loadingMore) return { ok: true };
    const generation = this.generation;
    const cursor = this.state.nextCursor;
    this.state = { ...this.state, loadingMore: true, error: null };
    try {
      const page = await this.api.listGameReports({
        state: this.state.filter,
        cursor,
        limit: 20,
      });
      if (generation !== this.generation) return { ok: false, error: "加载已取消" };
      const known = new Set(this.state.items.map((item) => item.report_id));
      this.state = {
        ...this.state,
        items: [...this.state.items, ...page.items.filter((item) => !known.has(item.report_id))],
        nextCursor: page.next_cursor,
        loadingMore: false,
      };
      return { ok: true };
    } catch (error) {
      if (generation !== this.generation) return { ok: false, error: "加载已取消" };
      if (error instanceof SessionExpiredError) throw error;
      const message = errorMessage(error);
      this.state = { ...this.state, loadingMore: false, error: message };
      return { ok: false, error: message };
    }
  }

  async select(reportId: string, expectedGeneration = this.generation): Promise<GameReportActionResult> {
    if (this.state.pendingAttempt) return this.recoveryBlocked();
    this.state = {
      ...this.state,
      loading: true,
      error: null,
      selectedOutcome: null,
      note: "",
      noteError: null,
      confirmationOpen: false,
      feedback: null,
    };
    try {
      const detail = await this.api.getGameReport(reportId);
      if (expectedGeneration !== this.generation) return { ok: false, error: "加载已取消" };
      this.state = { ...this.state, selected: detail, loading: false };
      return { ok: true };
    } catch (error) {
      if (expectedGeneration !== this.generation) return { ok: false, error: "加载已取消" };
      if (error instanceof SessionExpiredError) throw error;
      const message = errorMessage(error);
      this.state = { ...this.state, selected: null, loading: false, error: message };
      return { ok: false, error: message };
    }
  }

  async refresh(): Promise<GameReportActionResult> {
    return this.load(this.state.filter);
  }

  setOutcome(outcome: OpenGameReportResolutionOutcome): GameReportActionResult {
    if (this.state.pendingAttempt) return this.recoveryBlocked();
    const detail = this.state.selected;
    if (!detail || detail.status !== "PENDING") return this.failNote("这条举报已经处置");
    if (!detail.allowed_outcomes.includes(outcome)) return this.failNote("当前球局不能选择这个结论");
    this.state = { ...this.state, selectedOutcome: outcome, noteError: null, feedback: null };
    return { ok: true };
  }

  setNote(value: string): void {
    if (this.state.pendingAttempt) return;
    this.state = { ...this.state, note: value, noteError: null, feedback: null };
  }

  prepareResolution(): GameReportActionResult {
    if (this.state.pendingAttempt) return this.recoveryBlocked();
    const detail = this.state.selected;
    if (!detail || detail.status !== "PENDING") return this.failNote("这条举报已经处置");
    const outcome = this.state.selectedOutcome;
    if (!outcome || !detail.allowed_outcomes.includes(outcome)) return this.failNote("请选择处置结论");
    const validation = validateResolutionNote(this.state.note);
    if (!validation.ok) return this.failNote(validation.error);
    this.state = {
      ...this.state,
      note: validation.value,
      noteError: null,
      confirmationOpen: true,
      feedback: null,
    };
    return { ok: true };
  }

  cancelConfirmation(): void {
    if (this.state.resolving) return;
    this.state = { ...this.state, confirmationOpen: false };
  }

  async confirmResolution(): Promise<GameReportActionResult> {
    const detail = this.state.selected;
    const outcome = this.state.selectedOutcome;
    if (!this.state.confirmationOpen || !detail || !outcome) {
      return { ok: false, error: "没有待确认的处置" };
    }
    if (this.state.resolving || this.state.pendingAttempt) {
      return { ok: false, error: "处置正在提交，请勿重复操作" };
    }
    const attempt: GameReportPendingAttempt = {
      reportId: detail.report_id,
      body: Object.freeze({ outcome, resolution_note: this.state.note }),
      idempotencyKey: this.createIdempotencyKey(),
      phase: "UNKNOWN",
      replayed: false,
    };
    this.state = {
      ...this.state,
      confirmationOpen: false,
      resolving: true,
      pendingAttempt: attempt,
      feedback: null,
    };
    return this.submit(attempt);
  }

  async recoverAuthority(): Promise<GameReportActionResult> {
    const attempt = this.state.pendingAttempt;
    if (!attempt) return { ok: false, error: "当前没有待确认的处置结果" };
    this.state = { ...this.state, loading: true, feedback: null };
    try {
      const authority = await this.api.getGameReport(attempt.reportId);
      if (authority.status === "RESOLVED") {
        this.acceptAuthority(authority, "处置结果已确认");
        return { ok: true, kind: "AUTHORITY_UPDATED" };
      }
      this.state = { ...this.state, selected: authority, loading: false };
      if (attempt.phase === "CONFIRMED") {
        return this.markUnknown(attempt, "处置已提交，权威详情暂未更新，请稍后再次确认");
      }
      if (attempt.replayed) {
        return this.markUnknown(attempt, "提交结果仍未知，请稍后再次确认原处置结果");
      }
      attempt.replayed = true;
      this.state = { ...this.state, pendingAttempt: attempt, resolving: true };
      return this.submit(attempt);
    } catch (error) {
      if (error instanceof SessionExpiredError) throw error;
      return this.markUnknown(attempt, `${errorMessage(error)}。请稍后再次确认原处置结果`);
    }
  }

  clearForSessionEnd(): void {
    this.generation += 1;
    this.state = initialState();
  }

  reportOperationFailure(title: string, message: string): void {
    this.state = { ...this.state, feedback: { type: "error", title, message } };
  }

  private async submit(attempt: GameReportPendingAttempt): Promise<GameReportActionResult> {
    try {
      await this.api.resolveGameReport(attempt.reportId, attempt.body, attempt.idempotencyKey);
      attempt.phase = "CONFIRMED";
      this.state = { ...this.state, pendingAttempt: attempt };
      try {
        const authority = await this.api.getGameReport(attempt.reportId);
        this.acceptAuthority(authority, "处置已记录");
        return { ok: true, kind: "CONFIRMED" };
      } catch (error) {
        if (error instanceof SessionExpiredError) throw error;
        this.state = {
          ...this.state,
          loading: false,
          resolving: false,
          pendingAttempt: attempt,
          feedback: {
            type: "warning",
            title: "处置已提交，详情待刷新",
            message: "服务器已确认处置，请只确认原处置结果，不要再次提交。",
            recovery: true,
          },
        };
        return { ok: true, kind: "CONFIRMED_REFRESH_REQUIRED" };
      }
    } catch (error) {
      if (error instanceof SessionExpiredError) throw error;
      if (error instanceof ApiError && error.status === 409) {
        try {
          const authority = await this.api.getGameReport(attempt.reportId);
          this.state = {
            ...this.state,
            selected: authority,
            loading: false,
            resolving: false,
            pendingAttempt: null,
            selectedOutcome: null,
            feedback: {
              type: "warning",
              title: "权威状态已变化",
              message: "已刷新最新举报与球局状态，请重新核对后再操作。",
            },
          };
          return { ok: false, error: error.message, refreshed: true };
        } catch (refreshError) {
          if (refreshError instanceof SessionExpiredError) throw refreshError;
          return this.markUnknown(attempt, "状态已变化但详情刷新失败，请确认原处置结果");
        }
      }
      if (unknownMutationResult(error)) {
        return this.markUnknown(attempt, "网络中断，处置结果未知；请确认原处置结果");
      }
      const message = errorMessage(error);
      this.state = {
        ...this.state,
        loading: false,
        resolving: false,
        pendingAttempt: null,
        feedback: { type: "error", title: "处置未提交", message },
      };
      return { ok: false, error: message };
    }
  }

  private acceptAuthority(authority: PlatformGameReportDetail, title: string): void {
    const items = this.state.items
      .map((item) => item.report_id === authority.report_id
        ? { ...item, status: authority.status }
        : item)
      .filter((item) => item.status === this.state.filter);
    this.state = {
      ...this.state,
      items,
      selected: authority,
      loading: false,
      resolving: false,
      pendingAttempt: null,
      selectedOutcome: null,
      note: "",
      noteError: null,
      feedback: { type: "success", title, message: "已重新读取服务器权威详情。" },
    };
  }

  private markUnknown(attempt: GameReportPendingAttempt, message: string): GameReportActionResult {
    this.state = {
      ...this.state,
      loading: false,
      resolving: false,
      pendingAttempt: attempt,
      feedback: {
        type: "warning",
        title: "处置结果未知",
        message,
        recovery: true,
      },
    };
    return { ok: false, error: message, refreshRequired: true };
  }

  private failNote(error: string): GameReportActionResult {
    this.state = { ...this.state, noteError: error, confirmationOpen: false };
    return { ok: false, error };
  }

  private recoveryBlocked(): GameReportActionResult {
    return {
      ok: false,
      error: "请先确认原处置结果，暂不能切换或重复提交",
      refreshRequired: true,
    };
  }
}
