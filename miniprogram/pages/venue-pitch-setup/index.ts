import type { ConfiguredPitch, PitchCapability, PitchCapabilities, PitchConfiguration, PitchConfigurationStatus } from "../../domain/pitch-configuration";
import { readInventoryHeaderLayout } from "../../presentation/inventory-layout";
import { getPitchConfigurationDataSource, type PitchConfigurationChange, type SavePitchConfigurationAttempt } from "../../services/pitch-configuration";
import { getPitchConfigurationAttemptStore } from "../../services/pitch-configuration-attempt-store";

type DatasetEvent = { currentTarget?: { dataset?: { pitchId?: unknown; format?: unknown } } };
type InputEvent = { detail?: { value?: unknown } };
type PageError = { code?: string; details?: Record<string, unknown> };
interface DraftPitch extends Omit<ConfiguredPitch, "id"> { readonly id?: string; readonly clientRef?: string; readonly renderKey: string; readonly nameSource?: string; readonly draftStatus?: string }
interface Editor {
  readonly title: string; readonly pitchId?: string; readonly clientRef?: string; readonly selectedFormat: number | "其他";
  readonly formatOptions: readonly Readonly<{ value: number | "其他"; label: string; selected: boolean; disabled: boolean }>[];
  readonly customInput: boolean; readonly formatEditable: boolean; readonly formatReason?: string; readonly fieldError?: string;
  readonly completeLabel: string; readonly completeDisabled: boolean; readonly lifecycleLabel?: string; readonly lifecycleDisabled?: boolean;
  readonly deleteLabel?: string; readonly deleteDisabled?: boolean;
  readonly blockerMessage?: string; readonly futureBlockers?: PitchCapabilities["futureBlockers"];
  readonly confirmation?: Readonly<{ message: string }>;
  readonly namePlaceholder: string;
}
const FORMATS = [5, 7, 8, 11, "其他"] as const;
const allow = (): PitchCapability => ({ allowed: true, reason: null });
const deny = (reason: PitchCapability["reason"]): PitchCapability => ({ allowed: false, reason });
const draftCapabilities = (): PitchCapabilities => ({ editFormat: allow(), delete: allow(), deactivate: allow(), reactivate: deny("PITCH_ALREADY_ACTIVE"), futureBlockers: { AVAILABLE: 0, LOCKED: 0, BOOKED: 0 } });
const formatOptions = (players: number, editable: boolean) => FORMATS.map((value) => ({ value, label: value === "其他" ? value : `${value}人制`, selected: value === players || (value === "其他" && ![5, 7, 8, 11].includes(players)), disabled: !editable }));
const key = () => `pitch-configuration-${Date.now()}-${Math.round(Math.random() * 1e9)}`;
const clientRef = () => `draft-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
const matchesEditor = (pitch: DraftPitch, editor: Editor) => Boolean(
  (editor.pitchId && pitch.id === editor.pitchId) ||
  (editor.clientRef && pitch.clientRef === editor.clientRef),
);

Page({
  data: {
    venueId: "", venueName: "", configurationVersion: 0, baselinePitchCount: 0,
    pitches: [] as readonly DraftPitch[], changes: [] as readonly PitchConfigurationChange[], configuredCount: null as number | null,
    mode: "loading", statusMessage: "正在读取场地配置", bannerKind: "info", footerNotice: "修改保存后立即生效",
    pageAction: { label: "保存更改", disabled: true }, editor: null as Editor | null, dialog: null as null | { title: string; message: string; confirmLabel: string; cancelLabel: string },
    isSheetOpen: false, duplicateSaveDisabled: false, draftName: "", draftPlayersInput: "7", draftPlayersPreview: "预览：7人制", isDraftPlayersValid: true,
    headerTopPx: 0, headerRowHeightPx: 44, headerRightInsetPx: 0,
  },
  disposed: false, saveInFlight: false,
  async onLoad(options: Record<string, string | undefined> = {}) {
    this.disposed = false; const layout = readInventoryHeaderLayout();
    this.setData({ headerTopPx: layout.topPx, headerRowHeightPx: layout.rowHeightPx, headerRightInsetPx: layout.rightInsetPx });
    if (!options.venue_id) { this.setData({ mode: "error", statusMessage: "场馆信息无效，请返回重试", bannerKind: "error" }); return; }
    this.setData({ venueId: options.venue_id }); await this.loadConfiguration();
    const pending = getPitchConfigurationAttemptStore()?.load();
    if (pending?.venueId === options.venue_id && !this.saveInFlight) await this.runSave(pending);
  },
  onUnload() { this.disposed = true; },
  async loadConfiguration() {
    this.setData({ mode: "loading", statusMessage: "正在读取场地配置", bannerKind: "info", configuredCount: null, pageAction: { label: "保存更改", disabled: true } });
    try {
      const source = getPitchConfigurationDataSource(); await source.login(); const value = await source.get(this.data.venueId); if (this.disposed) return;
      const pitches = value.pitches.map((pitch) => ({ ...pitch, renderKey: pitch.id, nameSource: pitch.customName ? "自定义名称" : "系统生成名称" }));
      this.setData({ venueName: value.venue.name, configurationVersion: value.configurationVersion, baselinePitchCount: value.pitches.length, pitches, changes: [], configuredCount: pitches.length, mode: pitches.length ? (pitches.some(({ status }) => status === "ACTIVE") ? "list" : "inactive-only") : "empty", statusMessage: "", bannerKind: "info", pageAction: { label: pitches.length ? "保存更改" : "保存并设置时段", disabled: true } });
    } catch (caught) { this.handleLoadError(caught); }
  },
  handleLoadError(caught: unknown) { const code = (caught as PageError).code; this.setData({ mode: "error", statusMessage: code === "INVENTORY_FORBIDDEN" ? "当前账号没有该场馆的库存管理权限" : "场地配置加载失败，请重新加载", bannerKind: "error", pageAction: { label: "保存更改", disabled: true } }); },
  onRecovery() { return this.loadConfiguration(); },
  onOpenAdd() { if (this.saveInFlight || this.data.mode === "save-result-unknown" || this.data.mode === "error" || this.data.mode === "loading") return; this.openEditor(undefined); },
  onPitchTap(event: DatasetEvent) { const pitchId = event.currentTarget?.dataset?.pitchId; if (typeof pitchId !== "string" || this.saveInFlight || this.data.mode === "save-result-unknown") return; const pitch = this.data.pitches.find((item: DraftPitch) => item.id === pitchId || item.clientRef === pitchId); if (pitch) this.openEditor(pitch); },
  openEditor(pitch?: DraftPitch) {
    const players = pitch?.playersPerSide ?? 7; const editable = pitch?.capabilities.editFormat.allowed ?? true;
    const lifecycle = pitch ? pitch.status === "ACTIVE" ? "停用场地" : "恢复使用" : undefined;
    const capability = pitch ? pitch.status === "ACTIVE" ? pitch.capabilities.deactivate : pitch.capabilities.reactivate : undefined;
    this.setData({
      draftName: pitch?.customName ?? "", draftPlayersInput: String(players), draftPlayersPreview: `预览：${players}人制`, isDraftPlayersValid: true,
      editor: { title: pitch ? "编辑场地" : "添加一块场地", pitchId: pitch?.id, clientRef: pitch?.clientRef, selectedFormat: [5, 7, 8, 11].includes(players) ? players : "其他", formatOptions: formatOptions(players, editable), customInput: ![5, 7, 8, 11].includes(players), formatEditable: editable, formatReason: editable ? undefined : pitch?.capabilities.editFormat.reason ?? undefined, completeLabel: "完成", completeDisabled: false, lifecycleLabel: pitch?.clientRef ? undefined : lifecycle, lifecycleDisabled: capability ? !capability.allowed : false, deleteLabel: pitch ? "删除场地" : undefined, deleteDisabled: pitch ? !pitch.capabilities.delete.allowed || (pitch.status === "ACTIVE" && this.data.pitches.filter((item: DraftPitch) => item.status === "ACTIVE").length <= 1) : false, blockerMessage: capability?.reason === "PITCH_DEACTIVATE_BLOCKED" ? "未来库存尚未处理，暂不能停用" : undefined, futureBlockers: pitch?.capabilities.futureBlockers, namePlaceholder: pitch ? `当前名称：${pitch.displayName}` : "保存后可使用系统名称" },
      dialog: null, isSheetOpen: true,
    });
  },
  onNameInput(event: InputEvent) { if (!this.data.editor) return; this.setData({ draftName: typeof event.detail?.value === "string" ? event.detail.value : "", editor: { ...this.data.editor, fieldError: undefined } }); },
  onSelectFormat(event: DatasetEvent) {
    const editor = this.data.editor; if (!editor?.formatEditable) return; const raw = event.currentTarget?.dataset?.format; const selected: number | "其他" = raw === "other" || raw === "其他" ? "其他" : Number(raw);
    if (selected !== "其他" && ![5, 7, 8, 11].includes(selected)) return; const players = selected === "其他" ? this.data.draftPlayersInput : String(selected);
    this.setData({ editor: { ...editor, selectedFormat: selected, customInput: selected === "其他", formatOptions: editor.formatOptions.map((option) => ({ ...option, selected: option.value === selected })) }, draftPlayersInput: players, draftPlayersPreview: `预览：${players}人制`, isDraftPlayersValid: /^\d+$/.test(players) && Number(players) >= 1 && Number(players) <= 99 });
  },
  onPlayersInput(event: InputEvent) { const value = typeof event.detail?.value === "string" ? event.detail.value : ""; const numeric = Number(value); const numberLike = /^\d+(?:\.\d+)?$/.test(value); this.setData({ draftPlayersInput: value, draftPlayersPreview: numberLike ? `预览：${value}人制` : "请输入 1–99 的整数", isDraftPlayersValid: /^\d+$/.test(value) && numeric >= 1 && numeric <= 99 }); },
  onCompleteEditor() {
    const editor = this.data.editor; if (!editor) return; const customName = this.data.draftName.trim() || null;
    if (editor.customInput && !this.data.isDraftPlayersValid) return;
    if ((customName?.length ?? 0) > 30) { this.setData({ editor: { ...editor, fieldError: "场地名称需为 1–30 个字符" } }); return; }
    const playersPerSide = editor.selectedFormat === "其他" ? Number(this.data.draftPlayersInput) : editor.selectedFormat;
    if (!editor.pitchId && !editor.clientRef) {
      const ref = clientRef(); const next: DraftPitch = { clientRef: ref, renderKey: ref, customName, systemName: "", displayName: customName || `新建的 ${playersPerSide} 人制场地`, playersPerSide, sequence: 1, status: "ACTIVE", capabilities: draftCapabilities(), nameSource: customName ? "自定义名称" : "保存后生成正式名称", draftStatus: "ACTIVE · 待保存" };
      this.commitDraft([...this.data.pitches, next], [...this.data.changes, { operation: "CREATE", clientRef: ref, customName, playersPerSide }]); return;
    }
    const target = this.data.pitches.find((pitch: DraftPitch) => matchesEditor(pitch, editor)); if (!target) return;
    const updated = { ...target, customName, displayName: customName || target.systemName || target.displayName, playersPerSide, nameSource: customName ? "自定义名称" : "系统生成名称", draftStatus: `${target.status} · 待保存` };
    const pitches = this.data.pitches.map((pitch: DraftPitch) => pitch === target ? updated : pitch);
    if (target.clientRef) this.commitDraft(pitches, this.data.changes.map((change: PitchConfigurationChange) => change.operation === "CREATE" && change.clientRef === target.clientRef ? { ...change, customName, playersPerSide } : change));
    else this.commitDraft(pitches, this.upsertUpdate(updated));
  },
  upsertUpdate(pitch: DraftPitch, status: PitchConfigurationStatus = pitch.status) { const changes = this.data.changes.filter((change: PitchConfigurationChange) => !(change.operation === "UPDATE" && change.pitchId === pitch.id)); return [...changes, { operation: "UPDATE" as const, pitchId: pitch.id!, customName: pitch.customName, playersPerSide: pitch.playersPerSide, status }]; },
  commitDraft(pitches: readonly DraftPitch[], changes: readonly PitchConfigurationChange[]) { this.setData({ pitches, changes, configuredCount: pitches.length, mode: "draft", statusMessage: "变更已写入页面草稿 · 待保存", bannerKind: "info", pageAction: { label: this.data.baselinePitchCount === 0 ? "保存并设置时段" : "保存更改", disabled: false }, editor: null, dialog: null, isSheetOpen: false }); },
  onDeletePitch() { const editor = this.data.editor; if (!editor?.pitchId && !editor?.clientRef) return; const target = this.data.pitches.find((pitch: DraftPitch) => matchesEditor(pitch, editor)); if (!target) return; const lastActive = target.status === "ACTIVE" && this.data.pitches.filter((pitch: DraftPitch) => pitch.status === "ACTIVE").length <= 1; if (!target.capabilities.delete.allowed || lastActive) { this.setData({ editor: { ...editor, fieldError: lastActive ? "至少需要保留一块使用中的场地" : "已有业务记录的场地不能删除" } }); return; } this.setData({ editor: { ...editor, confirmation: { message: "删除将在保存整页配置后生效。" } } }); },
  onConfirmDelete() { const editor = this.data.editor; if (!editor) return; const target = this.data.pitches.find((pitch: DraftPitch) => matchesEditor(pitch, editor)); if (!target) return; const pitches = this.data.pitches.filter((pitch: DraftPitch) => pitch !== target); const changes = target.clientRef ? this.data.changes.filter((change: PitchConfigurationChange) => !(change.operation === "CREATE" && change.clientRef === target.clientRef)) : [...this.data.changes.filter((change: PitchConfigurationChange) => !(change.operation === "UPDATE" && change.pitchId === target.id)), { operation: "DELETE" as const, pitchId: target.id! }]; this.commitDraft(pitches, changes); },
  onLifecycleAction() { const editor = this.data.editor; if (!editor) return; const target = this.data.pitches.find((pitch: DraftPitch) => matchesEditor(pitch, editor)); if (!target) return; const capability = target.status === "ACTIVE" ? target.capabilities.deactivate : target.capabilities.reactivate; if (!capability.allowed) return; const status: PitchConfigurationStatus = target.status === "ACTIVE" ? "INACTIVE" : "ACTIVE"; const updated = { ...target, status, draftStatus: `${status} · 待保存` }; const pitches = this.data.pitches.map((pitch: DraftPitch) => pitch === target ? updated : pitch); if (target.clientRef) this.commitDraft(pitches, this.data.changes.map((change: PitchConfigurationChange) => change.operation === "CREATE" && change.clientRef === target.clientRef ? change : change)); else this.commitDraft(pitches, this.upsertUpdate(updated, status)); },
  onReactivatePitch() { const pitch = this.data.pitches.find((item: DraftPitch) => item.status === "INACTIVE"); if (pitch?.id) { this.openEditor(pitch); this.onLifecycleAction(); } },
  onCloseSheet() { if (!this.saveInFlight) this.setData({ editor: null, dialog: null, isSheetOpen: false }); },
  onCancelSheet() { this.onCloseSheet(); },
  onBack() { if (this.saveInFlight || this.data.mode === "save-result-unknown") return; if (this.data.changes.length) this.setData({ editor: null, dialog: { title: "放弃本次修改？", message: "尚未保存的场地变更将不会生效。", confirmLabel: "放弃修改", cancelLabel: "继续编辑" }, isSheetOpen: true }); else void wx.navigateBack(); },
  onConfirmLeave() { this.setData({ changes: [], editor: null, dialog: null, isSheetOpen: false }); void wx.navigateBack(); },
  async onPageAction() { if (this.saveInFlight) return; const stored = getPitchConfigurationAttemptStore()?.load(); if (this.data.mode === "save-result-unknown" && stored?.venueId === this.data.venueId) return this.runSave(stored); if (!this.data.changes.length || this.data.pageAction.disabled) return; const attempt: SavePitchConfigurationAttempt = { venueId: this.data.venueId, expectedVersion: this.data.configurationVersion, changes: this.data.changes, idempotencyKey: key() }; getPitchConfigurationAttemptStore()?.save(attempt); return this.runSave(attempt); },
  async runSave(attempt: SavePitchConfigurationAttempt) {
    if (this.saveInFlight) return; this.saveInFlight = true; this.setData({ mode: "saving", duplicateSaveDisabled: true, statusMessage: "正在保存场地配置", bannerKind: "info", pageAction: { label: "正在保存", disabled: true }, editor: null, dialog: null, isSheetOpen: false });
    try {
      const saved = await getPitchConfigurationDataSource().save(attempt); getPitchConfigurationAttemptStore()?.clear(); if (this.disposed) return;
      const wasFirstSave = this.data.baselinePitchCount === 0; const first = saved.createdPitchMappings[0]; this.applySaved(saved);
      if (wasFirstSave && first) void wx.redirectTo({ url: `/pages/venue-inventory/index?venue_id=${encodeURIComponent(this.data.venueId)}&pitch_id=${encodeURIComponent(first.pitchId)}` });
    } catch (caught) {
      const code = (caught as PageError).code;
      if (code === "PITCH_CONFIGURATION_RESULT_UNKNOWN" || code === "REQUEST_IN_PROGRESS") this.setData({ mode: "save-result-unknown", statusMessage: "保存结果待确认，请使用原操作重试", bannerKind: "warning", pageAction: { label: "使用原操作重试", disabled: false } });
      else if (code === "CONFIGURATION_CHANGED") { getPitchConfigurationAttemptStore()?.clear(); await this.loadConfiguration(); this.setData({ statusMessage: "场地配置已被更新，请基于最新内容重新修改", bannerKind: "warning" }); }
      else if (code === "INVENTORY_FORBIDDEN") { getPitchConfigurationAttemptStore()?.clear(); this.handleLoadError(caught); }
      else { getPitchConfigurationAttemptStore()?.clear(); this.setData({ mode: "save-error", statusMessage: code === "PITCH_NAME_CONFLICT" ? "场地名称已被使用，请修改后重试" : "保存失败，请重试", bannerKind: "error", pageAction: { label: "重新保存", disabled: false } }); }
    } finally { this.saveInFlight = false; this.setData({ duplicateSaveDisabled: this.data.mode === "save-result-unknown" }); }
  },
  applySaved(saved: PitchConfiguration) { const existingKeys = new Map(this.data.pitches.flatMap((pitch: DraftPitch) => pitch.id ? [[pitch.id, pitch.renderKey] as const] : [])); const createdKeys = new Map(saved.createdPitchMappings.map((mapping) => [mapping.pitchId, mapping.clientRef] as const)); const pitches = saved.pitches.map((pitch) => ({ ...pitch, renderKey: existingKeys.get(pitch.id) ?? createdKeys.get(pitch.id) ?? pitch.id, nameSource: pitch.customName ? "自定义名称" : "系统生成名称" })); this.setData({ venueName: saved.venue.name, configurationVersion: saved.configurationVersion, baselinePitchCount: pitches.length, pitches, changes: [], configuredCount: pitches.length, mode: pitches.some(({ status }) => status === "ACTIVE") ? "list" : pitches.length ? "inactive-only" : "empty", statusMessage: "场地配置已保存", bannerKind: "success", pageAction: { label: "保存更改", disabled: true } }); },
});
