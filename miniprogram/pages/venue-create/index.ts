import {
  createEvidenceItems,
  submissionBlocker,
  type VenueCreateLocation,
  type VenueOnboardingApplication,
  type VenueOnboardingCandidate,
  type VenueOnboardingEvidenceItem,
  type VenueOnboardingEvidenceKind,
} from "../../domain/venue-onboarding";
import { readIntentHeaderLayout } from "../../presentation/intent-header-layout";
import { getPoiSearchCapability, type PoiSearchResult } from "../../services/poi-search";
import {
  createOnboardingIdempotencyKey,
  getVenueOnboardingDataSource,
  getVenueOnboardingEvidenceCapability,
  getVenueOnboardingEvidenceCapabilityOrUndefined,
  type VenueOnboardingLocalEvidence,
} from "../../services/venue-onboarding";

interface CreateOptions { application_id?: unknown }
interface DatasetEvent { currentTarget?: { dataset?: { evidenceKind?: unknown } } }
interface TextInputEvent { detail?: { value?: unknown } }

Page({
  data: {
    title: "创建新场馆",
    mode: "editing",
    venueName: "",
    address: "",
    district: "尚未选择地图地点",
    location: null as VenueCreateLocation | null,
    contactName: "",
    maskedPhone: null as string | null,
    evidence: createEvidenceItems("CREATE") as readonly VenueOnboardingEvidenceItem[],
    submitDisabled: true,
    submitDisabledReason: "请填写场馆名称",
    notice: "",
    application: null as VenueOnboardingApplication | null,
    duplicateCandidate: null as VenueOnboardingCandidate | null,
    headerTopPx: 0,
    headerRowHeightPx: 44,
    headerRightInsetPx: 0,
  },

  disposed: false,
  writeInFlight: false,
  evidenceFiles: {} as Partial<Record<VenueOnboardingEvidenceKind, VenueOnboardingLocalEvidence>>,
  evidenceAttempts: {} as Partial<Record<VenueOnboardingEvidenceKind, { intentKey: string; completeKey: string }>>,
  submissionAttempt: undefined as string | undefined,

  async onLoad(options: CreateOptions = {}) {
    this.disposed = false;
    const layout = readIntentHeaderLayout();
    this.setData({ headerTopPx: layout.topPx, headerRowHeightPx: layout.rowHeightPx, headerRightInsetPx: layout.rightInsetPx });
    try {
      const source = getVenueOnboardingDataSource();
      const identity = await source.login();
      if (this.disposed) return;
      this.setData({ contactName: identity.contactName ?? "", maskedPhone: identity.maskedPhone });
      if (typeof options.application_id === "string") {
        const applicationId = decodeURIComponent(options.application_id);
        const application = (await source.listApplications()).items.find((item) => item.applicationId === applicationId);
        if (application?.kind === "CREATE" && application.status === "REJECTED") {
          this.setData({ mode: "rejected", application, venueName: application.venue.name, address: application.venue.address });
        }
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

  onVenueNameInput(event: TextInputEvent) {
    this.setData({ venueName: textValue(event), notice: "" });
    this.submissionAttempt = undefined;
    this.refreshSubmitState();
  },

  onAddressInput(event: TextInputEvent) {
    this.setData({ address: textValue(event), location: null, district: "地址已修改，请重新选择地图地点", notice: "" });
    this.submissionAttempt = undefined;
    this.refreshSubmitState();
  },

  onApplicantInput(event: TextInputEvent) {
    this.setData({ contactName: textValue(event), notice: "" });
    this.submissionAttempt = undefined;
    this.refreshSubmitState();
  },

  async onChooseMapLocation() {
    const query = (this.data.address || this.data.venueName).trim();
    if ([...query.replace(/\s/g, "")].length < 2) {
      this.setData({ notice: "请先输入至少两个字的场馆名称或地址" });
      return;
    }
    this.setData({ notice: "正在查询腾讯地图" });
    try {
      const results = await getPoiSearchCapability().suggest(query);
      if (!results.length) { this.setData({ notice: "腾讯地图未找到该地点，请修改关键词" }); return; }
      const selected = results.length === 1 ? results[0] : await choosePoi(results);
      if (!selected || this.disposed) return;
      this.setData({
        venueName: this.data.venueName.trim() || selected.name,
        address: selected.address,
        district: `${selected.city} · ${selected.district}`,
        location: { districtCode: selected.adcode, districtName: selected.district, latitude: selected.latitude, longitude: selected.longitude },
        notice: "已选择腾讯地图地点",
      });
      this.submissionAttempt = undefined;
      this.refreshSubmitState();
    } catch {
      if (!this.disposed) this.setData({ notice: "地图地点暂时无法查询，请重试" });
    }
  },

  async onAuthorizePhone(event: unknown) {
    try {
      const verified = await getVenueOnboardingDataSource().authorizePhone(eventDetail(event));
      if (this.disposed) return;
      this.setData({ maskedPhone: verified.maskedPhone, notice: "联系电话已验证" });
      this.refreshSubmitState();
    } catch { if (!this.disposed) this.setData({ notice: "联系电话验证失败，请重试" }); }
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
    const location = this.data.location;
    if (!location) return;
    this.writeInFlight = true;
    this.setData({ notice: "正在提交申请" });
    this.submissionAttempt ??= createOnboardingIdempotencyKey("create-application");
    try {
      const application = await getVenueOnboardingDataSource().submitCreate({
        name: this.data.venueName.trim(), address: this.data.address.trim(), ...location,
        contactName: this.data.contactName.trim(), evidence: evidenceRecord(this.data.evidence),
      }, this.submissionAttempt);
      if (!this.disposed) this.setData({ mode: "submitted", application, notice: "" });
    } catch (caught) {
      const error = caught as { code?: unknown; duplicateCandidate?: VenueOnboardingCandidate };
      if (error.code === "POSSIBLE_DUPLICATE_VENUE" && error.duplicateCandidate) {
        this.setData({ mode: "duplicate", duplicateCandidate: error.duplicateCandidate, notice: "" });
      } else {
        const unknown = error.code === "SUBMISSION_RESULT_UNKNOWN";
        this.setData({ notice: unknown ? "提交结果暂未确认，请使用相同申请重试" : error.code === "POSSIBLE_DUPLICATE_VENUE" ? "可能存在重复场馆，请联系平台核验" : "申请提交失败，请检查后重试" });
        if (!unknown) this.submissionAttempt = undefined;
      }
    } finally { this.writeInFlight = false; }
  },

  onConvertToClaim() {
    const candidate = this.data.duplicateCandidate;
    if (!candidate) return;
    wx.redirectTo({ url: `/pages/venue-claim/index?candidate_id=${encodeURIComponent(candidate.venueId)}&name=${encodeURIComponent(candidate.name)}&district=${encodeURIComponent(candidate.districtName)}&address=${encodeURIComponent(candidate.address)}` });
  },

  onEditRejected() {
    this.evidenceFiles = {};
    this.evidenceAttempts = {};
    this.submissionAttempt = undefined;
    this.setData({
      mode: "editing",
      location: null,
      district: "请重新选择腾讯地图地点",
      evidence: createEvidenceItems("CREATE"),
      application: null,
      notice: "请重新选择准确地点并上传全套新材料",
    });
    this.refreshSubmitState();
  },

  onReturnPortfolio() { returnToPortfolio(); },

  refreshSubmitState() {
    const reason = submissionBlocker({ venueName: this.data.venueName, address: this.data.address, location: this.data.location, contactName: this.data.contactName, maskedPhone: this.data.maskedPhone, evidence: this.data.evidence });
    this.setData({ submitDisabled: reason !== null, submitDisabledReason: reason ?? "" });
  },

  patchEvidence(kind: VenueOnboardingEvidenceKind, patch: Partial<VenueOnboardingEvidenceItem>) {
    this.setData({ evidence: this.data.evidence.map((item: VenueOnboardingEvidenceItem) => item.kind === kind ? { ...item, ...patch } : item) });
    this.submissionAttempt = undefined;
    this.refreshSubmitState();
  },
  markEvidenceError(kind: VenueOnboardingEvidenceKind, message: string, retryMode: "retry" | "restart" | "reselect") { this.patchEvidence(kind, { status: "error", errorMessage: message, retryMode }); },
  evidenceLabel(kind: VenueOnboardingEvidenceKind): string { return this.data.evidence.find((item: VenueOnboardingEvidenceItem) => item.kind === kind)?.label ?? "材料"; },
});

function textValue(event: TextInputEvent): string { return typeof event.detail?.value === "string" ? event.detail.value : ""; }
function evidenceKind(event: DatasetEvent): VenueOnboardingEvidenceKind | null {
  const kind = event.currentTarget?.dataset?.evidenceKind;
  return typeof kind === "string" && ["BUSINESS_LICENSE", "MANAGEMENT_AUTHORIZATION", "VENUE_EXTERIOR", "VENUE_INTERIOR"].includes(kind) ? kind as VenueOnboardingEvidenceKind : null;
}
function evidenceRecord(items: readonly VenueOnboardingEvidenceItem[]): Record<VenueOnboardingEvidenceKind, string> {
  return Object.fromEntries(items.map((item) => [item.kind, item.evidenceId ?? ""])) as Record<VenueOnboardingEvidenceKind, string>;
}
function choosePoi(results: readonly PoiSearchResult[]): Promise<PoiSearchResult | null> {
  return new Promise((resolve) => wx.showActionSheet({
    itemList: results.slice(0, 6).map((item) => `${item.name} · ${item.district}`),
    success: ({ tapIndex }) => resolve(results[tapIndex] ?? null),
    fail: () => resolve(null),
  }));
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
