import {
  ApiError,
  PlatformApi,
  type ApplicationKind,
  type ApplicationStatus,
  type DecisionOutcome,
  type QueueItem,
  type ReviewApplicationDetail,
  type ReviewDecision,
  SessionExpiredError,
} from "./api";

export interface ReviewFilters {
  kind?: ApplicationKind;
  status?: ApplicationStatus;
}

export interface ReviewState {
  filters: ReviewFilters;
  items: QueueItem[];
  selected: ReviewApplicationDetail | null;
  nextCursor: string | null;
  loading: boolean;
  loadingMore: boolean;
  deciding: boolean;
  decisionUncertain: boolean;
  error: string | null;
}

export type DecisionResult =
  | {
      ok: true;
      decision: ReviewDecision;
      refreshError?: string;
      sessionExpired?: boolean;
    }
  | { ok: false; error: string; refreshRequired?: boolean };

export class ReviewController {
  private generation = 0;
  private queryRevision = 0;
  private selectionRevision = 0;

  state: ReviewState = {
    filters: {},
    items: [],
    selected: null,
    nextCursor: null,
    loading: false,
    loadingMore: false,
    deciding: false,
    decisionUncertain: false,
    error: null,
  };

  constructor(private readonly api: PlatformApi) {}

  async load(filters: ReviewFilters = this.state.filters): Promise<void> {
    const generation = this.generation;
    const queryRevision = ++this.queryRevision;
    const selectionRevision = ++this.selectionRevision;
    const queryFilters = { ...filters };
    this.state = {
      ...this.state,
      filters: queryFilters,
      loading: true,
      loadingMore: false,
      error: null,
    };
    try {
      const queue = await this.api.listApplications(queryFilters);
      if (generation !== this.generation || queryRevision !== this.queryRevision) return;
      const selectedId = queue.items.some((item) => item.application_id === this.state.selected?.application_id)
        ? this.state.selected?.application_id
        : queue.items[0]?.application_id;
      const selected = selectedId ? await this.api.getApplication(selectedId) : null;
      if (
        generation !== this.generation
        || queryRevision !== this.queryRevision
        || selectionRevision !== this.selectionRevision
      ) return;
      this.state = {
        ...this.state,
        items: queue.items,
        selected,
        nextCursor: queue.next_cursor,
        loading: false,
        decisionUncertain: false,
        error: null,
      };
    } catch (error) {
      if (generation !== this.generation || queryRevision !== this.queryRevision) return;
      this.state = { ...this.state, loading: false, error: messageOf(error) };
      throw error;
    }
  }

  async loadMore(): Promise<void> {
    const cursor = this.state.nextCursor;
    if (!cursor || this.state.loadingMore) return;
    const generation = this.generation;
    const queryRevision = this.queryRevision;
    const queryFilters = { ...this.state.filters };
    this.state = { ...this.state, loadingMore: true, error: null };
    try {
      const queue = await this.api.listApplications({ ...queryFilters, cursor });
      if (generation !== this.generation || queryRevision !== this.queryRevision) return;
      const items = [...this.state.items];
      const known = new Set(items.map((item) => item.application_id));
      for (const item of queue.items) {
        if (!known.has(item.application_id)) {
          items.push(item);
          known.add(item.application_id);
        }
      }
      this.state = {
        ...this.state,
        items,
        nextCursor: queue.next_cursor,
        loadingMore: false,
        error: null,
      };
    } catch (error) {
      if (generation !== this.generation || queryRevision !== this.queryRevision) return;
      this.state = { ...this.state, loadingMore: false, error: messageOf(error) };
      throw error;
    }
  }

  async select(applicationId: string): Promise<void> {
    const generation = this.generation;
    const queryRevision = this.queryRevision;
    const selectionRevision = ++this.selectionRevision;
    this.state = { ...this.state, loading: true, error: null };
    try {
      const selected = await this.api.getApplication(applicationId);
      if (
        generation !== this.generation
        || queryRevision !== this.queryRevision
        || selectionRevision !== this.selectionRevision
        || selected.application_id !== applicationId
      ) return;
      this.state = {
        ...this.state,
        selected,
        loading: false,
        decisionUncertain: false,
      };
    } catch (error) {
      if (
        generation !== this.generation
        || queryRevision !== this.queryRevision
        || selectionRevision !== this.selectionRevision
      ) return;
      this.state = { ...this.state, loading: false, error: messageOf(error) };
      throw error;
    }
  }

  async decide(outcome: DecisionOutcome, reason: string): Promise<DecisionResult> {
    const normalized = reason.trim();
    if (!normalized) return { ok: false, error: "请填写审核理由" };
    if (this.state.deciding) return { ok: false, error: "审核决定正在提交，请勿重复操作" };
    const selected = this.state.selected;
    if (!selected) return { ok: false, error: "请先选择一条申请" };
    if (selected.decision || selected.status !== "SUBMITTED") {
      return { ok: false, error: "申请已有审核结果" };
    }
    if (this.state.decisionUncertain) {
      return { ok: false, error: "请先刷新申请详情，确认上一操作结果" };
    }

    const generation = this.generation;
    const applicationId = selected.application_id;
    this.state = { ...this.state, deciding: true, error: null };
    try {
      const decision = await this.api.decide(applicationId, outcome, normalized);
      if (generation !== this.generation) return { ok: true, decision };
      this.applyDecision(decision, applicationId);
      try {
        await this.load(this.state.filters);
        return { ok: true, decision };
      } catch (error) {
        return {
          ok: true,
          decision,
          refreshError: "决定已保存但刷新失败，请刷新详情或队列。",
          sessionExpired: error instanceof SessionExpiredError,
        };
      }
    } catch (error) {
      if (generation !== this.generation) {
        if (error instanceof SessionExpiredError) throw error;
        return { ok: false, error: messageOf(error), refreshRequired: true };
      }
      this.state = {
        ...this.state,
        error: messageOf(error),
        decisionUncertain: true,
      };
      if (error instanceof SessionExpiredError) throw error;
      return { ok: false, error: messageOf(error), refreshRequired: true };
    } finally {
      if (generation === this.generation) this.state = { ...this.state, deciding: false };
    }
  }

  async evidenceDownload(evidenceId: string): Promise<string> {
    const generation = this.generation;
    const evidence = await this.api.getEvidenceDownload(evidenceId);
    if (generation !== this.generation) throw new SessionExpiredError();
    return evidence.download_url;
  }

  clear(): void {
    this.generation += 1;
    this.queryRevision += 1;
    this.selectionRevision += 1;
    this.state = {
      filters: {},
      items: [],
      selected: null,
      nextCursor: null,
      loading: false,
      loadingMore: false,
      deciding: false,
      decisionUncertain: false,
      error: null,
    };
  }

  private applyDecision(decision: ReviewDecision, applicationId: string): void {
    const selected = this.state.selected;
    this.state = {
      ...this.state,
      selected: selected?.application_id === applicationId
        ? { ...selected, status: decision.outcome, decision }
        : selected,
      items: this.state.items.map((item) => item.application_id === applicationId
        ? { ...item, status: decision.outcome, reviewed_at: decision.reviewed_at }
        : item),
      decisionUncertain: false,
      error: null,
    };
  }
}

const messageOf = (error: unknown): string =>
  error instanceof ApiError || error instanceof Error ? error.message : "平台服务暂时不可用，请重试";
