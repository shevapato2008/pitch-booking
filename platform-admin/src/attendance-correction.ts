import {
  ApiError,
  PlatformApi,
  SessionExpiredError,
  type AttendanceCorrectionRequest,
  type AttendanceRegistrationDetail,
} from "./api";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AttendanceFeedback = {
  type: "success" | "warning" | "error" | "info";
  title: string;
  message: string;
  recovery?: boolean;
};

export type AttendancePendingAttempt = {
  registrationId: string;
  body: Readonly<AttendanceCorrectionRequest>;
  idempotencyKey: string;
  phase: "UNKNOWN" | "CONFIRMED" | "CONFLICT";
  replayed: boolean;
  authorityVersionBefore: number;
  authorityStatusBefore: AttendanceRegistrationDetail["attendance_status"];
};

export interface AttendanceCorrectionState {
  query: string;
  detail: AttendanceRegistrationDetail | null;
  loading: boolean;
  submitting: boolean;
  lookupError: string | null;
  reason: string;
  reasonError: string | null;
  confirmationOpen: boolean;
  pendingAttempt: AttendancePendingAttempt | null;
  feedback: AttendanceFeedback | null;
}

export type AttendanceActionResult =
  | { ok: true; kind?: "CONFIRMED" | "CONFIRMED_REFRESH_REQUIRED" | "AUTHORITY_UPDATED" }
  | { ok: false; error: string; refreshed?: boolean; refreshRequired?: boolean };

const emptyState = (): AttendanceCorrectionState => ({
  query: "",
  detail: null,
  loading: false,
  submitting: false,
  lookupError: null,
  reason: "",
  reasonError: null,
  confirmationOpen: false,
  pendingAttempt: null,
  feedback: null,
});

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "平台服务暂时不可用，请重试";

const isUnknownMutationResult = (error: unknown): boolean =>
  !(error instanceof ApiError) || error.status >= 500;

const defaultIdempotencyKey = (): string => {
  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `attendance-correction-${id}`;
};

export class AttendanceCorrectionController {
  state: AttendanceCorrectionState = emptyState();
  private generation = 0;

  constructor(
    private readonly api: PlatformApi,
    private readonly createIdempotencyKey: () => string = defaultIdempotencyKey,
  ) {}

  async lookup(input: string): Promise<AttendanceActionResult> {
    const normalized = input.trim().toLowerCase();
    const generation = ++this.generation;
    this.state = {
      ...this.state,
      query: normalized,
      detail: null,
      loading: false,
      submitting: false,
      lookupError: null,
      reason: "",
      reasonError: null,
      confirmationOpen: false,
      pendingAttempt: null,
      feedback: null,
    };
    if (!UUID_PATTERN.test(normalized)) {
      const error = "请输入完整的报名 UUID";
      this.state = { ...this.state, lookupError: error };
      return { ok: false, error };
    }

    this.state = { ...this.state, loading: true };
    try {
      const detail = await this.api.getAttendanceRegistration(normalized);
      if (generation !== this.generation) return { ok: false, error: "查询已取消" };
      this.state = { ...this.state, detail, loading: false, lookupError: null };
      return { ok: true };
    } catch (error) {
      if (error instanceof SessionExpiredError) throw error;
      if (generation !== this.generation) return { ok: false, error: "查询已取消" };
      const message = errorMessage(error);
      this.state = { ...this.state, loading: false, lookupError: message };
      return { ok: false, error: message };
    }
  }

  setQuery(value: string): void {
    this.state = { ...this.state, query: value, lookupError: null };
  }

  setReason(value: string): void {
    this.state = { ...this.state, reason: value, reasonError: null };
  }

  clear(): void {
    this.generation += 1;
    this.state = emptyState();
  }

  prepareCorrection(): AttendanceActionResult {
    const detail = this.state.detail;
    if (!detail) return this.failReason("请先查询报名");
    if (this.state.pendingAttempt) return this.failReason("请先刷新权威状态，确认上一操作结果");
    if (!detail.allowed_correction.target_status) {
      return this.failReason(blockedReasonLabel(detail.allowed_correction.blocked_reason));
    }
    const reason = this.state.reason.trim();
    if (!reason) return this.failReason("请填写纠正原因");
    if (Array.from(reason).length > 1000) return this.failReason("纠正原因不能超过 1000 个字符");
    this.state = {
      ...this.state,
      reason,
      reasonError: null,
      confirmationOpen: true,
      feedback: null,
    };
    return { ok: true };
  }

  cancelConfirmation(): void {
    if (this.state.submitting) return;
    this.state = { ...this.state, confirmationOpen: false };
  }

  async confirmCorrection(): Promise<AttendanceActionResult> {
    const detail = this.state.detail;
    const targetStatus = detail?.allowed_correction.target_status;
    if (!this.state.confirmationOpen || !detail || !targetStatus) {
      return { ok: false, error: "没有待确认的纠正" };
    }
    if (this.state.submitting || this.state.pendingAttempt) {
      return { ok: false, error: "纠正正在提交，请勿重复操作" };
    }

    const body = Object.freeze({
      attendance_status: targetStatus,
      expected_version: detail.version,
      reason: this.state.reason,
    });
    const attempt: AttendancePendingAttempt = {
      registrationId: detail.registration_id,
      body,
      idempotencyKey: this.createIdempotencyKey(),
      phase: "UNKNOWN",
      replayed: false,
      authorityVersionBefore: detail.version,
      authorityStatusBefore: detail.attendance_status,
    };
    const generation = this.generation;
    this.state = {
      ...this.state,
      confirmationOpen: false,
      submitting: true,
      pendingAttempt: attempt,
      feedback: null,
    };
    return this.submitAttempt(attempt, generation);
  }

  async refreshAuthority(): Promise<AttendanceActionResult> {
    const attempt = this.state.pendingAttempt;
    if (!attempt) return { ok: false, error: "当前没有待刷新的操作结果" };
    const generation = this.generation;
    this.state = { ...this.state, loading: true, feedback: null };
    if (attempt.phase === "UNKNOWN" && !attempt.replayed) {
      return this.reconcileUnknown(attempt, generation);
    }
    try {
      const authority = await this.api.getAttendanceRegistration(attempt.registrationId);
      if (generation !== this.generation) return { ok: false, error: "刷新已取消" };
      if (attempt.phase === "UNKNOWN" && !this.authorityChanged(attempt, authority)) {
        return this.markUnresolved(attempt, "权威状态仍未变化，请稍后再次刷新");
      }
      this.acceptAuthority(authority, attempt.phase === "CONFIRMED" ? "纠正已记录" : "权威状态已刷新");
      return { ok: true, kind: "AUTHORITY_UPDATED" };
    } catch (error) {
      if (error instanceof SessionExpiredError) throw error;
      if (generation !== this.generation) return { ok: false, error: "刷新已取消" };
      return this.markRefreshFailure(attempt, errorMessage(error));
    }
  }

  private async submitAttempt(
    attempt: AttendancePendingAttempt,
    generation: number,
  ): Promise<AttendanceActionResult> {
    try {
      await this.api.correctAttendanceRegistration(
        attempt.registrationId,
        attempt.body,
        attempt.idempotencyKey,
      );
      if (generation !== this.generation) return { ok: true, kind: "CONFIRMED_REFRESH_REQUIRED" };
      attempt.phase = "CONFIRMED";
      this.state = { ...this.state, pendingAttempt: attempt };
      return this.refreshAfterConfirmed(attempt, generation);
    } catch (error) {
      if (error instanceof SessionExpiredError) throw error;
      if (generation !== this.generation) return { ok: false, error: errorMessage(error), refreshRequired: true };
      if (error instanceof ApiError && error.status === 409) {
        attempt.phase = "CONFLICT";
        this.state = { ...this.state, pendingAttempt: attempt };
        return this.refreshAfterConflict(attempt, generation, error.message);
      }
      if (isUnknownMutationResult(error)) {
        attempt.phase = "UNKNOWN";
        this.state = { ...this.state, pendingAttempt: attempt };
        return this.reconcileUnknown(attempt, generation);
      }
      const message = errorMessage(error);
      this.state = {
        ...this.state,
        submitting: false,
        pendingAttempt: null,
        feedback: { type: "error", title: "纠正未提交", message },
      };
      return { ok: false, error: message };
    }
  }

  private async refreshAfterConfirmed(
    attempt: AttendancePendingAttempt,
    generation: number,
  ): Promise<AttendanceActionResult> {
    try {
      const authority = await this.api.getAttendanceRegistration(attempt.registrationId);
      if (generation !== this.generation) return { ok: true, kind: "CONFIRMED_REFRESH_REQUIRED" };
      this.acceptAuthority(authority, "纠正已记录");
      return { ok: true, kind: "CONFIRMED" };
    } catch (error) {
      if (error instanceof SessionExpiredError) throw error;
      if (generation !== this.generation) return { ok: true, kind: "CONFIRMED_REFRESH_REQUIRED" };
      this.state = {
        ...this.state,
        loading: false,
        submitting: false,
        pendingAttempt: attempt,
        feedback: {
          type: "warning",
          title: "纠正已提交，详情待刷新",
          message: "服务器已确认纠正，请只刷新权威状态，不要再次提交。",
          recovery: true,
        },
      };
      return { ok: true, kind: "CONFIRMED_REFRESH_REQUIRED" };
    }
  }

  private async refreshAfterConflict(
    attempt: AttendancePendingAttempt,
    generation: number,
    conflictMessage: string,
  ): Promise<AttendanceActionResult> {
    try {
      const authority = await this.api.getAttendanceRegistration(attempt.registrationId);
      if (generation !== this.generation) return { ok: false, error: conflictMessage, refreshRequired: true };
      this.state = {
        ...this.state,
        detail: authority,
        loading: false,
        submitting: false,
        pendingAttempt: null,
        feedback: {
          type: "warning",
          title: "状态已变化",
          message: "已刷新最新权威记录，请重新核对后再操作。",
        },
      };
      return { ok: false, error: conflictMessage, refreshed: true };
    } catch (error) {
      if (error instanceof SessionExpiredError) throw error;
      if (generation !== this.generation) return { ok: false, error: conflictMessage, refreshRequired: true };
      this.state = {
        ...this.state,
        loading: false,
        submitting: false,
        pendingAttempt: attempt,
        feedback: {
          type: "warning",
          title: "状态冲突，详情待刷新",
          message: "请刷新权威状态；本次操作不会自动重放。",
          recovery: true,
        },
      };
      return { ok: false, error: conflictMessage, refreshRequired: true };
    }
  }

  private async reconcileUnknown(
    attempt: AttendancePendingAttempt,
    generation: number,
  ): Promise<AttendanceActionResult> {
    let authority: AttendanceRegistrationDetail;
    try {
      authority = await this.api.getAttendanceRegistration(attempt.registrationId);
    } catch (error) {
      if (error instanceof SessionExpiredError) throw error;
      if (generation !== this.generation) return { ok: false, error: "刷新已取消", refreshRequired: true };
      return this.markUnresolved(attempt, "提交结果未知，暂时无法读取权威状态");
    }
    if (generation !== this.generation) return { ok: false, error: "刷新已取消", refreshRequired: true };
    if (this.authorityChanged(attempt, authority)) {
      this.acceptAuthority(authority, "权威状态已更新");
      return { ok: true, kind: "AUTHORITY_UPDATED" };
    }
    this.state = { ...this.state, detail: authority };
    if (attempt.replayed) return this.markUnresolved(attempt, "提交结果仍未知，请稍后再次刷新权威状态");

    attempt.replayed = true;
    this.state = { ...this.state, pendingAttempt: attempt };
    return this.submitAttempt(attempt, generation);
  }

  private authorityChanged(
    attempt: AttendancePendingAttempt,
    authority: AttendanceRegistrationDetail,
  ): boolean {
    return authority.version !== attempt.authorityVersionBefore
      || authority.attendance_status !== attempt.authorityStatusBefore;
  }

  private acceptAuthority(authority: AttendanceRegistrationDetail, title: string): void {
    this.state = {
      ...this.state,
      detail: authority,
      loading: false,
      submitting: false,
      reason: "",
      reasonError: null,
      pendingAttempt: null,
      feedback: {
        type: "success",
        title,
        message: "已重新读取服务器权威详情。",
      },
    };
  }

  private markUnresolved(attempt: AttendancePendingAttempt, message: string): AttendanceActionResult {
    this.state = {
      ...this.state,
      loading: false,
      submitting: false,
      pendingAttempt: attempt,
      feedback: {
        type: "warning",
        title: "提交结果未知",
        message,
        recovery: true,
      },
    };
    return { ok: false, error: message, refreshRequired: true };
  }

  private markRefreshFailure(attempt: AttendancePendingAttempt, detail: string): AttendanceActionResult {
    const message = `${detail}。请稍后再次刷新权威状态`;
    this.state = {
      ...this.state,
      loading: false,
      submitting: false,
      pendingAttempt: attempt,
      feedback: { type: "warning", title: "权威状态刷新失败", message, recovery: true },
    };
    return { ok: false, error: message, refreshRequired: true };
  }

  private failReason(error: string): AttendanceActionResult {
    this.state = { ...this.state, reasonError: error, confirmationOpen: false };
    return { ok: false, error };
  }
}

const blockedReasonLabel = (reason: AttendanceRegistrationDetail["allowed_correction"]["blocked_reason"]): string => {
  switch (reason) {
    case "GAME_NOT_COMPLETED": return "球局尚未完成，暂不可纠正";
    case "REGISTRATION_NOT_JOINED": return "只有已加入的散客报名可以纠正到场结果";
    case "ATTENDANCE_UNMARKED": return "队长尚未记录到场结果，平台不能代为标记";
    case "ATTENDANCE_AUDIT_INCOMPLETE": return "原始到场审计信息不完整，暂不可纠正";
    default: return "当前报名暂不可纠正";
  }
};
