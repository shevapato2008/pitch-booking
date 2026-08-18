import {
  VENUE_PITCH_SETUP_FIXTURE,
  buildVenuePitchSetupView,
  resolveVenuePitchSetupVisualState,
  type VenuePitch,
  type VenuePitchSetupVisualState,
} from "../../venue-pitch-setup-fixture";
import { readIntentHeaderLayout } from "../../intent-header-layout";

interface SetupOptions { state?: unknown }
interface DatasetEvent { currentTarget?: { dataset?: { pitchId?: unknown; state?: unknown; format?: unknown } } }
interface InputEvent { detail?: { value?: unknown } }
interface DraftSnapshot {
  readonly pitches: readonly VenuePitch[];
  readonly configuredCount: number | null;
  readonly draftName: string;
  readonly draftPlayersInput: string;
  readonly draftPlayersPreview: string;
  readonly isDraftPlayersValid: boolean;
}
type EditorOrigin = "add" | "edit" | null;

const saveStates = new Set<VenuePitchSetupVisualState>([
  "save-in-progress", "save-failed", "configuration-changed", "save-result-unknown",
]);
const pageDraftStates = new Set<VenuePitchSetupVisualState>([
  "first-pitch-draft", "unnamed-pitch-draft", "unused-deleted-draft", "deactivated-draft", "reactivated-draft",
]);

const editorOriginFor = (state: VenuePitchSetupVisualState): EditorOrigin => {
  if (state === "add-first-open") return "add";
  return buildVenuePitchSetupView(state).editor ? "edit" : null;
};

const underlyingFor = (state: VenuePitchSetupVisualState): VenuePitchSetupVisualState => {
  if (state === "add-first-open") return "first-entry-empty";
  if (state === "unsaved-leave-confirm") return "deactivated-draft";
  return "six-pitch-list";
};

const inputPatch = (state: VenuePitchSetupVisualState) => {
  const view = buildVenuePitchSetupView(state);
  const players = view.editor?.playersPerSide ?? VENUE_PITCH_SETUP_FIXTURE.customPlayersPerSide;
  return {
    draftName: view.editor?.nameValue ?? "",
    draftPlayersInput: String(players),
    draftPlayersPreview: `预览：${players}人制`,
    isDraftPlayersValid: true,
  };
};

const snapshotOf = (source: {
  pitches: readonly VenuePitch[];
  configuredCount: number | null;
  draftName: string;
  draftPlayersInput: string;
  draftPlayersPreview: string;
  isDraftPlayersValid: boolean;
}): DraftSnapshot => ({
  pitches: source.pitches,
  configuredCount: source.configuredCount,
  draftName: source.draftName,
  draftPlayersInput: source.draftPlayersInput,
  draftPlayersPreview: source.draftPlayersPreview,
  isDraftPlayersValid: source.isDraftPlayersValid,
});

Page({
  data: {
    ...VENUE_PITCH_SETUP_FIXTURE,
    ...buildVenuePitchSetupView("six-pitch-list"),
    ...inputPatch("six-pitch-list"),
    underlyingState: "six-pitch-list" as VenuePitchSetupVisualState,
    editorOrigin: null as EditorOrigin,
    draftSnapshot: null as DraftSnapshot | null,
    headerTopPx: 0,
    headerRowHeightPx: 44,
    headerRightInsetPx: 0,
  },

  transition(state: VenuePitchSetupVisualState, underlyingState?: VenuePitchSetupVisualState, suppliedSnapshot?: DraftSnapshot) {
    const built = buildVenuePitchSetupView(state);
    const inputs = inputPatch(state);
    const returnsToUnderlying = this.data.isSheetOpen && state === this.data.underlyingState;
    const preservesDraft = saveStates.has(state)
      || state === "unsaved-leave-confirm"
      || (returnsToUnderlying && Boolean(this.data.draftSnapshot));
    const renderedSnapshot = suppliedSnapshot
      ?? (preservesDraft ? this.data.draftSnapshot ?? snapshotOf(this.data) : null)
      ?? (pageDraftStates.has(state) ? snapshotOf({ ...built, ...inputs }) : null);
    this.setData({
      ...built,
      ...inputs,
      ...(renderedSnapshot ?? {}),
      underlyingState: underlyingState ?? underlyingFor(state),
      editorOrigin: editorOriginFor(state),
      draftSnapshot: renderedSnapshot,
    });
  },

  onLoad(options: SetupOptions = {}) {
    const layout = readIntentHeaderLayout();
    const state = resolveVenuePitchSetupVisualState(options.state);
    const built = buildVenuePitchSetupView(state);
    const inputs = inputPatch(state);
    this.setData({
      ...built,
      ...inputs,
      underlyingState: underlyingFor(state),
      editorOrigin: editorOriginFor(state),
      draftSnapshot: saveStates.has(state) || pageDraftStates.has(state) ? snapshotOf({ ...built, ...inputs }) : null,
      headerTopPx: layout.topPx,
      headerRowHeightPx: layout.rowHeightPx,
      headerRightInsetPx: layout.rightInsetPx,
    });
  },

  onOpenAdd() {
    const underlying = this.data.visualState === "first-entry-empty" ? "first-entry-empty" : "six-pitch-list";
    this.transition("add-first-open", underlying);
  },

  onPitchTap(event: DatasetEvent) {
    const pitchId = event.currentTarget?.dataset?.pitchId;
    if (typeof pitchId !== "string") return;
    const next = this.data.cardNextStates[pitchId];
    if (next) this.transition(next, this.data.visualState);
  },

  onNameInput(event: InputEvent) {
    this.setData({ draftName: typeof event.detail?.value === "string" ? event.detail.value : "" });
  },

  onSelectFormat(event: DatasetEvent) {
    if (!this.data.editor?.formatEditable) return;
    const raw = event.currentTarget?.dataset?.format;
    const format = raw === "other" || raw === "其他" ? "其他" : Number(raw);
    if (format !== "其他" && ![5, 7, 8, 11].includes(format)) return;
    const customInput = format === "其他";
    const players = customInput ? this.data.draftPlayersInput : String(format);
    this.setData({
      editor: {
        ...this.data.editor,
        selectedFormat: format,
        customInput,
        formatOptions: this.data.editor.formatOptions.map((option) => ({ ...option, selected: option.value === format })),
      },
      draftPlayersInput: players,
      draftPlayersPreview: `预览：${players}人制`,
      isDraftPlayersValid: /^\d+$/.test(players) && Number(players) >= 1 && Number(players) <= 99,
    });
  },

  onPlayersInput(event: InputEvent) {
    const value = typeof event.detail?.value === "string" ? event.detail.value : "";
    const numberLike = /^\d+(?:\.\d+)?$/.test(value);
    const numeric = Number(value);
    this.setData({
      draftPlayersInput: value,
      draftPlayersPreview: numberLike ? `预览：${value}人制` : "请输入 1–99 的整数",
      isDraftPlayersValid: /^\d+$/.test(value) && numeric >= 1 && numeric <= 99,
    });
  },

  onCompleteEditor() {
    if (!this.data.editor) return;
    if (this.data.editor.customInput && !this.data.isDraftPlayersValid) {
      if (this.data.editorOrigin === "edit") this.transition("field-validation", this.data.underlyingState);
      return;
    }
    if (this.data.editorOrigin === "add") {
      const name = this.data.draftName.trim();
      const playersPerSide = this.data.editor.selectedFormat === "其他"
        ? Number(this.data.draftPlayersInput)
        : Number(this.data.editor.selectedFormat);
      const pitch: VenuePitch = name
        ? { clientRef: "draft-pitch-1", customName: name, systemName: null, displayName: name, playersPerSide, sequence: null, status: "ACTIVE", nameSource: "自定义名称", draftStatus: "ACTIVE · 待保存" }
        : { clientRef: "draft-pitch-unnamed-1", customName: null, systemName: null, displayName: `新建的 ${playersPerSide} 人制场地 1`, playersPerSide, sequence: null, status: "ACTIVE", nameSource: "保存后生成正式名称", draftStatus: "ACTIVE · 待保存" };
      this.transition(name ? "first-pitch-draft" : "unnamed-pitch-draft", undefined, snapshotOf({
        ...this.data,
        pitches: [pitch],
        configuredCount: 1,
      }));
      return;
    }
    const pitchId = this.data.editor.pitchId;
    const name = this.data.draftName.trim();
    const playersPerSide = this.data.editor.formatEditable
      ? this.data.editor.selectedFormat === "其他" ? Number(this.data.draftPlayersInput) : Number(this.data.editor.selectedFormat)
      : null;
    const pitches = this.data.pitches.map((pitch: VenuePitch) => pitch.id === pitchId ? {
      ...pitch,
      customName: name || null,
      displayName: name || pitch.systemName || pitch.displayName,
      playersPerSide: playersPerSide ?? pitch.playersPerSide,
      draftStatus: `${pitch.status} · 待保存`,
    } : pitch);
    this.transition(this.data.underlyingState, undefined, snapshotOf({ ...this.data, pitches }));
  },

  onDeletePitch() {
    const next = this.data.editor?.lifecycleNextState;
    if (next) this.transition(next, this.data.underlyingState);
  },
  onConfirmDelete() {
    const next = this.data.editor?.confirmation?.nextState;
    if (next) this.transition(next);
  },
  onReactivatePitch() {
    const next = this.data.recoveryNextState;
    if (next) this.transition(next);
  },
  onLifecycleAction() {
    const next = this.data.editor?.lifecycleNextState;
    if (next) this.transition(next);
  },

  onCloseSheet() {
    if (this.data.duplicateSaveDisabled || !this.data.isSheetOpen) return;
    this.transition(this.data.underlyingState);
  },

  onCancelSheet() { this.onCloseSheet(); },

  onBack() {
    if (!this.data.duplicateSaveDisabled && (this.data.mode === "draft" || this.data.draftSnapshot) && this.data.visualState !== "unsaved-leave-confirm") {
      this.transition("unsaved-leave-confirm", this.data.visualState);
    }
  },

  onRecovery() {
    const next = this.data.recoveryNextState;
    if (next) this.transition(next);
  },

  onPageAction() {
    if (this.data.pageAction.disabled || this.data.duplicateSaveDisabled) return;
    if (this.data.visualState === "first-save-success") {
      wx.showToast({ title: VENUE_PITCH_SETUP_FIXTURE.fixtureNotice, icon: "none" });
      return;
    }
    const next = this.data.pageAction.nextState;
    if (next) this.transition(next);
  },

  onConfirmLeave() {
    wx.showToast({ title: VENUE_PITCH_SETUP_FIXTURE.fixtureNotice, icon: "none" });
  },
});
