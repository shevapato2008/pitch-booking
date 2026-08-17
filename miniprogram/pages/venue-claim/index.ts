import {
  createEvidenceItems,
  submissionBlocker,
  type VenueOnboardingCandidate,
  type VenueOnboardingEvidenceItem,
  type VenueOnboardingEvidenceKind,
} from "../../domain/venue-onboarding";
import { readIntentHeaderLayout } from "../../presentation/intent-header-layout";
import {
  createOnboardingIdempotencyKey,
  getVenueOnboardingDataSource,
  getVenueOnboardingEvidenceCapability,
  getVenueOnboardingEvidenceCapabilityOrUndefined,
  type VenueOnboardingLocalEvidence,
} from "../../services/venue-onboarding";

interface ClaimOptions { candidate_id?: unknown; name?: unknown; district?: unknown; address?: unknown; application_id?: unknown }
interface DatasetEvent { currentTarget?: { dataset?: { candidateId?: unknown; evidenceKind?: unknown } } }
interface TextInputEvent { detail?: { value?: unknown } }

Page({
  data: {
    title: "认领已有场馆",
    mode: "editing",
    searchQuery: "",
    searching: false,
    candidates: [] as readonly (VenueOnboardingCandidate & { selected: boolean })[],
    selectedVenueId: null as string | null,
    contactName: "",
    maskedPhone: null as string | null,
    evidence: createEvidenceItems("CLAIM") as readonly VenueOnboardingEvidenceItem[],
    submitDisabled: true,
    submitDisabledReason: "请先选择要认领的场馆",
    notice: "",
    application: null as unknown,
    headerTopPx: 0,
    headerRowHeightPx: 44,
    headerRightInsetPx: 0,
  },

  disposed: false,
  writeInFlight: false,
  evidenceFiles: {} as Partial<Record<VenueOnboardingEvidenceKind, VenueOnboardingLocalEvidence>>,
  evidenceAttempts: {} as Partial<Record<VenueOnboardingEvidenceKind, { intentKey: string; completeKey: string }>>,
  submissionAttempt: undefined as string | undefined,

  async onLoad(options: ClaimOptions = {}) {
    this.disposed = false;
    const layout = readIntentHeaderLayout();
    const candidate = decodeCandidateOptions(options);
    this.setData({
      headerTopPx: layout.topPx,
      headerRowHeightPx: layout.rowHeightPx,
      headerRightInsetPx: layout.rightInsetPx,
      candidates: candidate ? [{ ...candidate, selected: true }] : [],
      selectedVenueId: candidate?.venueId ?? null,
    });
    try {
      const identity = await getVenueOnboardingDataSource().login();
      if (this.disposed) return;
      this.setData({ contactName: identity.contactName ?? "", maskedPhone: identity.maskedPhone });
      if (typeof options.application_id === "string") {
        const applicationId = safeDecode(options.application_id);
        const rejected = (await getVenueOnboardingDataSource().listApplications()).items
          .find((item) => item.applicationId === applicationId && item.kind === "CLAIM" && item.status === "REJECTED");
        if (rejected) this.setData({ searchQuery: rejected.venue.name, selectedVenueId: null, candidates: [], notice: `上次申请未通过：${rejected.rejectionReason}。请重新搜索场馆并上传新材料。` });
      }
      this.refreshSubmitState();
    } catch {
      if (!this.disposed) this.setData({ notice: "微信登录失败，请返回后重试" });
    }
  },

  onUnload() {
    this.disposed = true;
    getVenueOnboardingEvidenceCapabilityOrUndefined()?.abortAll?.();
  },
  onBack() { returnToPortfolio(); },

  onSearchInput(event: TextInputEvent) {
    this.setData({ searchQuery: textValue(event), notice: "" });
  },

  async onSearch() {
    const query = this.data.searchQuery.trim();
    if ([...query.replace(/\s/g, "")].length < 2 || this.data.searching) {
      this.setData({ notice: "请输入至少两个字再搜索" });
      return;
    }
    this.setData({ searching: true, notice: "" });
    try {
      const result = await getVenueOnboardingDataSource().searchCandidates(query);
      if (this.disposed) return;
      this.setData({
        candidates: result.items.map((item) => ({ ...item, selected: item.venueId === this.data.selectedVenueId })),
        notice: result.items.length ? "" : "未找到公开场馆，可以返回创建新场馆",
      });
    } catch {
      if (!this.disposed) this.setData({ notice: "场馆搜索失败，请重试" });
    } finally {
      if (!this.disposed) this.setData({ searching: false });
    }
  },

  onSelectCandidate(event: DatasetEvent) {
    const candidateId = event.currentTarget?.dataset?.candidateId;
    if (typeof candidateId !== "string" || !this.data.candidates.some((item: VenueOnboardingCandidate) => item.venueId === candidateId)) return;
    this.setData({
      selectedVenueId: candidateId,
      candidates: this.data.candidates.map((item: VenueOnboardingCandidate) => ({ ...item, selected: item.venueId === candidateId })),
      notice: "",
    });
    this.submissionAttempt = undefined;
    this.refreshSubmitState();
  },

  onApplicantInput(event: TextInputEvent) {
    this.setData({ contactName: textValue(event), notice: "" });
    this.submissionAttempt = undefined;
    this.refreshSubmitState();
  },

  async onAuthorizePhone(event: unknown) {
    try {
      const verified = await getVenueOnboardingDataSource().authorizePhone(eventDetail(event));
      if (this.disposed) return;
      this.setData({ maskedPhone: verified.maskedPhone, notice: "联系电话已验证" });
      this.refreshSubmitState();
    } catch {
      if (!this.disposed) this.setData({ notice: "联系电话验证失败，请重试" });
    }
  },

  async onChooseEvidence(event: DatasetEvent) {
    const kind = evidenceKind(event);
    if (!kind) return;
    try {
      const file = await getVenueOnboardingEvidenceCapability().choose(kind);
      this.evidenceFiles[kind] = file;
      this.evidenceAttempts[kind] = {
        intentKey: createOnboardingIdempotencyKey(`evidence-${kind.toLowerCase()}`),
        completeKey: createOnboardingIdempotencyKey(`complete-${kind.toLowerCase()}`),
      };
      await this.uploadEvidence(kind);
    } catch {
      if (this.disposed) return;
      if (this.evidenceFiles[kind]) this.setData({ notice: "未选择新材料，原材料保持不变" });
      else this.markEvidenceError(kind, "未选择材料，请重新选择", "reselect");
    }
  },

  async onRetryEvidence(event: DatasetEvent) {
    const kind = evidenceKind(event);
    if (!kind) return;
    const row = this.data.evidence.find((item: VenueOnboardingEvidenceItem) => item.kind === kind);
    if (!this.evidenceFiles[kind] || row?.retryMode === "reselect") { await this.onChooseEvidence(event); return; }
    if (row?.retryMode === "restart") {
      this.evidenceAttempts[kind] = {
        intentKey: createOnboardingIdempotencyKey(`evidence-${kind.toLowerCase()}`),
        completeKey: createOnboardingIdempotencyKey(`complete-${kind.toLowerCase()}`),
      };
    }
    await this.uploadEvidence(kind);
  },

  async uploadEvidence(kind: VenueOnboardingEvidenceKind) {
    const file = this.evidenceFiles[kind];
    const attempt = this.evidenceAttempts[kind];
    if (!file || !attempt) return;
    this.patchEvidence(kind, { status: "uploading", fileName: file.filename, errorMessage: undefined, evidenceId: undefined });
    try {
      const source = getVenueOnboardingDataSource();
      const intent = await source.createUploadIntent(kind, attempt.intentKey);
      if (this.disposed) return;
      if (!intent.acceptedMimeTypes.includes(file.mimeType)) throw new Error("INVALID_MIME");
      if (file.byteSize > intent.maximumBytes) throw new Error("TOO_LARGE");
      if (Date.parse(intent.postPolicy.expiresAt) <= Date.now()) throw new Error("POLICY_EXPIRED");
      await getVenueOnboardingEvidenceCapability().upload(file, intent);
      if (this.disposed) return;
      await source.completeEvidence(intent.evidenceId, attempt.completeKey);
      if (this.disposed) return;
      this.patchEvidence(kind, { status: "completed", fileName: file.filename, evidenceId: intent.evidenceId, errorMessage: undefined, retryMode: undefined });
      this.setData({ notice: `${this.evidenceLabel(kind)}已上传` });
    } catch (caught) {
      if (this.disposed) return;
      const code = evidenceErrorCode(caught);
      if (code === "INVALID_MIME" || code === "TOO_LARGE" || code === "ONBOARDING_EVIDENCE_INVALID") {
        delete this.evidenceFiles[kind];
        delete this.evidenceAttempts[kind];
        this.markEvidenceError(kind,
          code === "INVALID_MIME" ? "文件格式不支持，请重新选择 JPG 或 PNG 图片"
            : code === "TOO_LARGE" ? "文件过大，请压缩后重新选择"
              : "材料内容无法校验，请重新选择文件",
          "reselect");
      } else if (isRestartEvidenceError(code)) {
        this.markEvidenceError(kind, "上传凭证已失效，请重新上传", "restart");
      } else this.markEvidenceError(kind, code === "OSS_UPLOAD_TIMEOUT" ? "上传超时，请重试" : "上传失败，请重试", "retry");
    }
  },

  async onSubmit() {
    if (this.data.mode !== "editing") return;
    this.refreshSubmitState();
    if (this.data.submitDisabled || this.writeInFlight) {
      if (this.data.submitDisabledReason) this.setData({ notice: this.data.submitDisabledReason });
      return;
    }
    this.writeInFlight = true;
    this.setData({ notice: "正在提交申请" });
    this.submissionAttempt ??= createOnboardingIdempotencyKey("claim-application");
    try {
      const venueId = this.data.selectedVenueId;
      if (!venueId) return;
      const evidence = evidenceRecord(this.data.evidence);
      const application = await getVenueOnboardingDataSource().submitClaim({
        venueId,
        contactName: this.data.contactName.trim(),
        evidence: {
          MANAGEMENT_AUTHORIZATION: evidence.MANAGEMENT_AUTHORIZATION,
          VENUE_EXTERIOR: evidence.VENUE_EXTERIOR,
        },
      }, this.submissionAttempt);
      if (!this.disposed) this.setData({ mode: "submitted", application, notice: "" });
    } catch (caught) {
      const unknown = (caught as { code?: unknown }).code === "SUBMISSION_RESULT_UNKNOWN";
      if (!this.disposed) this.setData({ notice: unknown ? "提交结果暂未确认，请使用相同申请重试" : "申请提交失败，请检查后重试" });
      if (!unknown) this.submissionAttempt = undefined;
    } finally { this.writeInFlight = false; }
  },

  onReturnPortfolio() { returnToPortfolio(); },

  refreshSubmitState() {
    const reason = submissionBlocker({
      selectedVenueId: this.data.selectedVenueId,
      contactName: this.data.contactName,
      maskedPhone: this.data.maskedPhone,
      evidence: this.data.evidence,
    });
    this.setData({ submitDisabled: reason !== null, submitDisabledReason: reason ?? "" });
  },

  patchEvidence(kind: VenueOnboardingEvidenceKind, patch: Partial<VenueOnboardingEvidenceItem>) {
    this.setData({ evidence: this.data.evidence.map((item: VenueOnboardingEvidenceItem) => item.kind === kind ? { ...item, ...patch } : item) });
    this.submissionAttempt = undefined;
    this.refreshSubmitState();
  },

  markEvidenceError(kind: VenueOnboardingEvidenceKind, message: string, retryMode: "retry" | "restart" | "reselect") {
    this.patchEvidence(kind, { status: "error", errorMessage: message, retryMode });
  },

  evidenceLabel(kind: VenueOnboardingEvidenceKind): string {
    return this.data.evidence.find((item: VenueOnboardingEvidenceItem) => item.kind === kind)?.label ?? "材料";
  },
});

function textValue(event: TextInputEvent): string { return typeof event.detail?.value === "string" ? event.detail.value : ""; }

function evidenceKind(event: DatasetEvent): VenueOnboardingEvidenceKind | null {
  const kind = event.currentTarget?.dataset?.evidenceKind;
  return typeof kind === "string" && ["BUSINESS_LICENSE", "MANAGEMENT_AUTHORIZATION", "VENUE_EXTERIOR", "VENUE_INTERIOR"].includes(kind)
    ? kind as VenueOnboardingEvidenceKind : null;
}

function evidenceRecord(items: readonly VenueOnboardingEvidenceItem[]): Record<VenueOnboardingEvidenceKind, string> {
  return Object.fromEntries(items.map((item) => [item.kind, item.evidenceId ?? ""])) as Record<VenueOnboardingEvidenceKind, string>;
}

function decodeCandidateOptions(options: ClaimOptions): VenueOnboardingCandidate | null {
  if (typeof options.candidate_id !== "string" || typeof options.name !== "string"
    || typeof options.district !== "string" || typeof options.address !== "string") return null;
  try {
    return {
      venueId: safeDecode(options.candidate_id),
      name: safeDecode(options.name),
      districtName: safeDecode(options.district),
      address: safeDecode(options.address),
    };
  } catch { return null; }
}

function safeDecode(value: string): string {
  try { return decodeURIComponent(value); } catch { return value; }
}

function eventDetail(event: unknown): unknown {
  return typeof event === "object" && event !== null && "detail" in event ? (event as { detail: unknown }).detail : event;
}

function evidenceErrorCode(caught: unknown): string {
  if (typeof caught === "object" && caught !== null && "code" in caught && typeof (caught as { code?: unknown }).code === "string") {
    return (caught as { code: string }).code;
  }
  return caught instanceof Error ? caught.message : "UNKNOWN";
}

function isRestartEvidenceError(code: string): boolean {
  return [
    "POLICY_EXPIRED",
    "OSS_UPLOAD_REJECTED",
    "ONBOARDING_APPLICATION_NOT_FOUND",
    "ONBOARDING_APPLICATION_STATE_CHANGED",
    "IDEMPOTENCY_KEY_REUSED",
  ].includes(code);
}

function returnToPortfolio(): void {
  wx.navigateBack({
    delta: 1,
    fail: () => wx.redirectTo({ url: "/pages/venue-access/index" }),
  });
}
