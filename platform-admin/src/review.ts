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
  loading: boolean;
  deciding: boolean;
  error: string | null;
}

export type DecisionResult = { ok: true; decision: ReviewDecision | void } | { ok: false; error: string };

export class ReviewController {
  state: ReviewState = {
    filters: {},
    items: [],
    selected: null,
    loading: false,
    deciding: false,
    error: null,
  };

  constructor(private readonly api: PlatformApi) {}

  async load(filters: ReviewFilters = this.state.filters): Promise<void> {
    this.state = { ...this.state, filters, loading: true, error: null };
    try {
      const queue = await this.api.listApplications(filters);
      const selectedId = queue.items.some((item) => item.application_id === this.state.selected?.application_id)
        ? this.state.selected?.application_id
        : queue.items[0]?.application_id;
      const selected = selectedId ? await this.api.getApplication(selectedId) : null;
      this.state = { ...this.state, items: queue.items, selected, loading: false, error: null };
    } catch (error) {
      this.state = { ...this.state, loading: false, error: messageOf(error) };
      throw error;
    }
  }

  async select(applicationId: string): Promise<void> {
    this.state = { ...this.state, loading: true, error: null };
    try {
      const selected = await this.api.getApplication(applicationId);
      this.state = { ...this.state, selected, loading: false };
    } catch (error) {
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

    this.state = { ...this.state, deciding: true, error: null };
    try {
      const decision = await this.api.decide(selected.application_id, outcome, normalized);
      await this.load(this.state.filters);
      return { ok: true, decision };
    } catch (error) {
      this.state = { ...this.state, error: messageOf(error) };
      if (error instanceof SessionExpiredError) throw error;
      return { ok: false, error: messageOf(error) };
    } finally {
      this.state = { ...this.state, deciding: false };
    }
  }

  async evidenceDownload(evidenceId: string): Promise<string> {
    return (await this.api.getEvidenceDownload(evidenceId)).download_url;
  }
}

const messageOf = (error: unknown): string =>
  error instanceof ApiError || error instanceof Error ? error.message : "平台服务暂时不可用，请重试";
