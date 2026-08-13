import { FACILITY_CODES, FACILITY_LABELS, REASON_LABELS, type AdminVenueProfile, type VenueProfileFacilityCode, type VenueProfileItemState, type VenueProfileUploadIntent } from "../../domain/venue-profile";
import { readInventoryHeaderLayout } from "../../presentation/inventory-layout";
import { getVenueProfileAttemptStore } from "../../services/venue-profile-attempt-store";
import { getVenueProfileDataSource, getVenueProfileMediaCapability, type ChosenVenueProfileImage, type VenueProfileMutationAttempt } from "../../services/venue-profile";

type DatasetEvent = { currentTarget?: { dataset?: Record<string, unknown> } };
type InputEvent = { detail?: { value?: unknown } };
type PageError = { code?: string };
type ImageView = { id: string; cover: boolean; state: VenueProfileItemState };
const MAX_IMAGES = 8;
const GROUPS: readonly { title: string; codes: readonly VenueProfileFacilityCode[] }[] = [
  { title: "基础设施", codes: ["PARKING", "TOILET", "CHANGING_ROOM", "SHOWER", "LOCKERS"] },
  { title: "补给服务", codes: ["DRINKING_WATER", "BEVERAGE_SALES", "EQUIPMENT_RENTAL"] },
  { title: "观赛与安全", codes: ["REST_AREA", "FIRST_AID", "AED"] },
  { title: "场地环境", codes: ["INDOOR", "OUTDOOR", "COVERED", "LIGHTING"] },
  { title: "草皮类型", codes: ["ARTIFICIAL_TURF", "NATURAL_GRASS"] },
];
const key = (kind: string) => `venue-profile-${kind}-${Date.now()}-${Math.round(Math.random() * 1e9)}`;
const codePoints = (value: string) => Array.from(value);
const errorCode = (caught: unknown) => (caught as PageError)?.code ?? "";

Page({
  data: {
    venueId: "", venueName: "", mode: "loading", status: "正在读取场馆资料", statusDetail: "", tone: "loading",
    profile: null as AdminVenueProfile | null, description: "", descriptionCount: 0, facilities: [] as VenueProfileFacilityCode[], facilityGroups: [] as unknown[],
    images: [] as ImageView[], imageCount: 0, maxImages: MAX_IMAGES, rejectionLabels: [] as string[], dirty: false, editable: false,
    imageActionsEnabled: false, busyItemId: "", operationBusy: false, message: "", headerTopPx: 0, headerRowHeightPx: 44, headerRightInsetPx: 0,
  },
  requestSequence: 0, disposed: false, loaded: false, lastPollAt: 0,

  async onLoad(options: Record<string, string | undefined> = {}) {
    this.disposed = false; const layout = readInventoryHeaderLayout(); const venueId = options.venue_id ?? "";
    this.setData({ venueId, headerTopPx: layout.topPx, headerRowHeightPx: layout.rowHeightPx, headerRightInsetPx: layout.rightInsetPx });
    if (!venueId) { this.failRead("场馆信息无效，请返回重试"); return; }
    try { await getVenueProfileDataSource().login(); await this.loadProfile(); } catch (caught) { this.handleError(caught, true); }
  },
  onUnload() { this.disposed = true; this.requestSequence += 1; },
  onShow() {
    if (!this.loaded || !this.data.profile || this.data.operationBusy || Date.now() - this.lastPollAt < 1000) return;
    const state = this.data.profile.currentRevision.summaryState;
    if (state === "REVIEWING" || state === "PENDING_MANUAL") { this.lastPollAt = Date.now(); void this.loadProfile(true); }
  },
  async loadProfile(preserveDraft = false) {
    const sequence = ++this.requestSequence; this.setData({ mode: preserveDraft ? this.data.mode : "loading", message: "" });
    const profile = await getVenueProfileDataSource().get(this.data.venueId);
    if (this.disposed || sequence !== this.requestSequence) return;
    this.loaded = true; this.applyProfile(profile, preserveDraft);
    const pending = getVenueProfileAttemptStore()?.load();
    if (pending?.venueId === this.data.venueId) this.setData({ mode: "save-unknown", editable: false, imageActionsEnabled: false, status: "正在核对操作结果", statusDetail: "请使用原提交继续核对，不要重复创建操作", tone: "warning" });
  },
  applyProfile(profile: AdminVenueProfile, preserveDraft = false) {
    const revision = profile.currentRevision; const description = preserveDraft && this.data.dirty ? this.data.description : revision.description;
    const facilities = preserveDraft && this.data.dirty ? this.data.facilities : [...revision.facilities];
    const publishedByOrder = new Map(profile.published.images.map((image) => [image.sortOrder, image.url]));
    const images = [...revision.images].sort((a, b) => a.sortOrder - b.sortOrder).map((image) => ({ ...image, cover: image.role === "COVER", url: publishedByOrder.get(image.sortOrder) ?? "", stateLabel: this.itemStateLabel(image.state), reasonLabel: image.reasonCode ? REASON_LABELS[image.reasonCode] : "" }));
    const reasons = [revision.descriptionReasonCode, ...revision.images.map(({ reasonCode }) => reasonCode)].filter((value): value is NonNullable<typeof value> => value !== null).map((value) => REASON_LABELS[value]);
    const summary = this.summaryFor(profile); const editable = summary.mode === "ready" || summary.mode === "rejected";
    this.setData({ profile, venueName: profile.venue.name, description, descriptionCount: codePoints(description).length, facilities, facilityGroups: this.groupsFor(facilities), images, imageCount: images.length, rejectionLabels: [...new Set(reasons)], dirty: preserveDraft ? this.data.dirty : false, editable, imageActionsEnabled: editable, busyItemId: "", operationBusy: false, message: "", ...summary });
  },
  summaryFor(profile: AdminVenueProfile) {
    const revision = profile.currentRevision;
    if (revision.summaryState === "PENDING_MANUAL") return { mode: "pending-manual", status: "等待人工审核", statusDetail: "系统暂时无法确认结果，公开页继续显示上一版资料", tone: "warning" };
    if (revision.summaryState === "REVIEWING") return { mode: "reviewing", status: "资料已提交，正在审核", statusDetail: "整版通过前，公开页继续显示上一版资料", tone: "review" };
    if (revision.summaryState === "REJECTED") return { mode: "rejected", status: "部分内容未通过审核", statusDetail: "请按固定原因修改或重新上传", tone: "error" };
    return { mode: "ready", status: revision.summaryState === "PUBLISHED" ? "场馆资料已发布" : "资料已载入，可继续编辑", statusDetail: "图片操作立即提交；保存只提交介绍与设施", tone: "info" };
  },
  itemStateLabel(state: VenueProfileItemState) { return ({ UPLOADING: "上传中", REVIEWING: "审核中", APPROVED: "已通过", REJECTED: "未通过", PENDING_MANUAL: "人工审核" } as const)[state]; },
  groupsFor(selected: readonly VenueProfileFacilityCode[]) { return GROUPS.map((group) => ({ title: group.title, items: group.codes.map((code) => ({ code, label: FACILITY_LABELS[code], selected: selected.includes(code) })) })); },

  onDescriptionInput(event: InputEvent) { if (!this.data.editable) return; const value = typeof event.detail?.value === "string" ? event.detail.value : ""; const description = codePoints(value).slice(0, 300).join(""); this.setData({ description, descriptionCount: codePoints(description).length, dirty: true }); },
  onToggleFacility(event: DatasetEvent) { const code = event.currentTarget?.dataset?.facilityCode; if (!this.data.editable || typeof code !== "string" || !FACILITY_CODES.includes(code as VenueProfileFacilityCode)) return; const typed = code as VenueProfileFacilityCode; const facilities = this.data.facilities.includes(typed) ? this.data.facilities.filter((item) => item !== typed) : [...this.data.facilities, typed]; this.setData({ facilities, facilityGroups: this.groupsFor(facilities), dirty: true }); },
  async onSave() {
    if (!this.data.editable || this.data.operationBusy || !this.data.profile) return;
    const attempt = { kind: "save" as const, venueId: this.data.venueId, body: { expectedFacilityVersion: this.data.profile.facilityVersion, expectedRevisionVersion: this.data.profile.revisionVersion, description: this.data.description, facilities: this.data.facilities }, idempotencyKey: key("save") };
    return this.runAttempt(attempt, (stable) => getVenueProfileDataSource().save(stable as typeof attempt));
  },
  async onRefreshReviewStatus() {
    if ((this.data.mode !== "reviewing" && this.data.mode !== "pending-manual") || this.data.operationBusy || !this.data.profile) return;
    this.setData({ operationBusy: true, message: "" });
    try { await this.loadProfile(true); } catch (caught) { this.handleError(caught, false, "审核状态刷新失败，请重试"); }
  },
  async onChooseImage() {
    if (!this.data.imageActionsEnabled || this.data.operationBusy || !this.data.profile || this.data.imageCount >= MAX_IMAGES) return;
    try {
      this.setData({ operationBusy: true, mode: "uploading", status: "图片正在上传", statusDetail: "上传完成后将自动提交审核", tone: "loading", message: "" });
      const image = await getVenueProfileMediaCapability().chooseImage();
      const intentAttempt = { kind: "uploadIntent" as const, venueId: this.data.venueId, body: { expectedRevisionVersion: this.data.profile.revisionVersion, filename: image.filename, mimeType: image.mimeType, byteSize: image.byteSize }, idempotencyKey: key("upload") };
      const stable = getVenueProfileAttemptStore()?.begin(intentAttempt) as typeof intentAttempt | undefined ?? intentAttempt;
      const intent = await getVenueProfileDataSource().createUploadIntent(stable); await this.finishUpload(stable, intent, image);
    } catch (caught) { this.handleUploadError(caught); }
  },
  onRetryUpload() { return getVenueProfileAttemptStore()?.load()?.kind === "uploadIntent" ? this.onRetryUnknown() : this.onChooseImage(); },
  async finishUpload(attempt: Extract<VenueProfileMutationAttempt, { kind: "uploadIntent" }>, intent: VenueProfileUploadIntent, selected?: ChosenVenueProfileImage) {
    const store = getVenueProfileAttemptStore(); store?.clear(); store?.begin(attempt);
    const image = selected ?? await getVenueProfileMediaCapability().chooseImage();
    if (image.filename !== attempt.body.filename || image.mimeType !== attempt.body.mimeType || image.byteSize !== attempt.body.byteSize) throw Object.assign(new Error("MEDIA_FILE_MISMATCH"), { code: "MEDIA_FILE_MISMATCH" });
    await getVenueProfileMediaCapability().upload(intent.signedPutUrl, image.bytes, intent.requiredHeaders); store?.clear();
    const complete = { kind: "complete" as const, venueId: this.data.venueId, imageId: intent.imageId, expectedRevisionVersion: attempt.body.expectedRevisionVersion, idempotencyKey: key("complete") };
    const stableComplete = store?.begin(complete) as typeof complete | undefined ?? complete;
    const profile = await getVenueProfileDataSource().completeUpload(stableComplete); store?.clear(); this.applyProfile(profile, true);
  },
  handleUploadError(caught: unknown) {
    const code = errorCode(caught); if (code === "VENUE_PROFILE_RESULT_UNKNOWN") { this.handleError(caught, false); return; }
    if (this.data.profile) this.applyProfile(this.data.profile, true);
    this.setData({ mode: "upload-error", message: code === "MEDIA_FILE_MISMATCH" ? "请选择与原上传一致的图片" : code === "MEDIA_PICK_CANCELLED" ? "已取消选择，可稍后继续上传" : "图片上传失败，请重试" });
  },
  async onSetCover(event: DatasetEvent) { const imageId = this.imageId(event); if (!imageId) return; return this.runImage(imageId, "cover", (attempt) => getVenueProfileDataSource().setCover(attempt as Extract<VenueProfileMutationAttempt, { kind: "cover" }>)); },
  async onRemoveImage(event: DatasetEvent) { const imageId = this.imageId(event); if (!imageId || this.data.images.find((item) => item.id === imageId)?.cover) return; return this.runImage(imageId, "delete", (attempt) => getVenueProfileDataSource().deleteImage(attempt as Extract<VenueProfileMutationAttempt, { kind: "delete" }>)); },
  async onReorderImage(event: DatasetEvent) {
    const imageId = this.imageId(event); const direction = Number(event.currentTarget?.dataset?.direction); if (!imageId || !this.data.profile || !Number.isInteger(direction)) return;
    const ids = this.data.images.map((image) => image.id); const from = ids.indexOf(imageId); const to = Math.max(1, Math.min(ids.length - 1, from + direction)); if (from < 1 || from === to) return; [ids[from], ids[to]] = [ids[to], ids[from]];
    const attempt = { kind: "reorder" as const, venueId: this.data.venueId, imageIds: ids, expectedRevisionVersion: this.data.profile.revisionVersion, idempotencyKey: key("reorder") }; return this.runAttempt(attempt, (stable) => getVenueProfileDataSource().reorderImages(stable as typeof attempt), imageId);
  },
  async onRetryModeration(event: DatasetEvent) { const itemId = event.currentTarget?.dataset?.itemId; if (typeof itemId !== "string" || !this.data.profile) return; const attempt = { kind: "retry" as const, venueId: this.data.venueId, itemId, expectedRevisionVersion: this.data.profile.revisionVersion, idempotencyKey: key("retry") }; return this.runAttempt(attempt, (stable) => getVenueProfileDataSource().retryModeration(stable as typeof attempt), itemId); },
  imageId(event: DatasetEvent) { const imageId = event.currentTarget?.dataset?.imageId; return this.data.imageActionsEnabled && !this.data.operationBusy && typeof imageId === "string" ? imageId : ""; },
  async runImage(imageId: string, kind: "cover" | "delete", call: (attempt: VenueProfileMutationAttempt) => Promise<AdminVenueProfile>) { if (!this.data.profile) return; const attempt = { kind, venueId: this.data.venueId, imageId, expectedRevisionVersion: this.data.profile.revisionVersion, idempotencyKey: key(kind) } as VenueProfileMutationAttempt; return this.runAttempt(attempt, call, imageId); },
  async runAttempt(attempt: VenueProfileMutationAttempt, call: (stable: VenueProfileMutationAttempt) => Promise<AdminVenueProfile>, busyItemId = "") {
    if (this.data.operationBusy) return; const stable = getVenueProfileAttemptStore()?.begin(attempt) ?? attempt; this.setData({ operationBusy: true, busyItemId, message: "" });
    try { const profile = await call(stable); getVenueProfileAttemptStore()?.clear(); this.applyProfile(profile, attempt.kind !== "save"); if (attempt.kind === "save") this.setData({ dirty: false }); }
    catch (caught) { this.handleError(caught, false); }
  },
  async onRetryUnknown() {
    const attempt = getVenueProfileAttemptStore()?.load(); if (!attempt || attempt.venueId !== this.data.venueId) { await this.loadProfile(true); return; }
    const source = getVenueProfileDataSource(); const calls = { save: source.save, complete: source.completeUpload, delete: source.deleteImage, cover: source.setCover, reorder: source.reorderImages, retry: source.retryModeration };
    if (attempt.kind === "uploadIntent") {
      this.setData({ operationBusy: true, mode: "uploading", status: "正在核对图片上传", statusDetail: "请重新选择同一张图片以继续上传", tone: "warning", message: "" });
      try { const intent = await source.createUploadIntent(attempt); await this.finishUpload(attempt, intent); } catch (caught) { this.handleUploadError(caught); }
      return;
    }
    return this.runAttempt(attempt, (stable) => (calls[stable.kind as keyof typeof calls] as (value: never) => Promise<AdminVenueProfile>)(stable as never));
  },
  async onReload() { try { await this.loadProfile(false); } catch (caught) { this.handleError(caught, true); } },
  handleError(caught: unknown, initial: boolean, fallback = "操作失败，请重试") {
    const code = errorCode(caught); this.setData({ operationBusy: false, busyItemId: "" });
    if (code === "VENUE_PROFILE_RESULT_UNKNOWN") { this.setData({ mode: "save-unknown", editable: false, imageActionsEnabled: false, status: "正在核对操作结果", statusDetail: "请使用同一次提交继续核对", tone: "warning", message: "" }); return; }
    if (code === "VENUE_PROFILE_VERSION_CONFLICT") { this.setData({ message: "资料已被其他工作人员更新，正在刷新" }); void this.onReload(); return; }
    if (code === "VENUE_PROFILE_FORBIDDEN" || code === "AUTH_REQUIRED") { this.setData({ mode: "permission-error", editable: false, imageActionsEnabled: false, status: "当前账号无权管理该场馆", statusDetail: "请联系场馆管理员确认权限", tone: "error", message: "" }); return; }
    if (initial) { this.failRead("场馆资料加载失败，请重试"); return; }
    if (this.data.profile) this.applyProfile(this.data.profile, true); this.setData({ message: fallback });
  },
  failRead(message: string) { this.setData({ mode: "load-error", editable: false, imageActionsEnabled: false, status: message, statusDetail: "上一版公开资料不受影响", tone: "error", profile: null, message: "" }); },
  onNavigateWorkbench(event: DatasetEvent) { const target = event.currentTarget?.dataset?.target; const suffix = `?venue_id=${encodeURIComponent(this.data.venueId)}`; if (target === "profile") { void wx.redirectTo({ url: `/pages/venue-profile/index${suffix}` }); return; } if (target === "pitches") void wx.navigateTo({ url: `/pages/venue-pitch-setup/index${suffix}` }); if (target === "inventory") void wx.navigateTo({ url: `/pages/venue-inventory/index${suffix}` }); },
  onBack() { if (!this.data.dirty) { void wx.navigateBack(); return; } wx.showModal({ title: "放弃未保存修改？", content: "场馆介绍和设施尚未保存。", confirmText: "放弃", success: ({ confirm }) => { if (confirm) void wx.navigateBack(); } }); },
});
