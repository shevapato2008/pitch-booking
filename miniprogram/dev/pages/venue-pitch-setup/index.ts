import {
  VENUE_PITCH_SETUP_FIXTURE,
  buildVenuePitchSetupView,
  resolveVenuePitchSetupVisualState,
  type VenuePitchSetupVisualState,
} from "../../venue-pitch-setup-fixture";
import { readIntentHeaderLayout } from "../../intent-header-layout";

interface SetupOptions { state?: unknown }
interface DatasetEvent { currentTarget?: { dataset?: { pitchId?: unknown; state?: unknown; format?: unknown } } }
interface InputEvent { detail?: { value?: unknown } }

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

Page({
  data: {
    ...VENUE_PITCH_SETUP_FIXTURE,
    ...buildVenuePitchSetupView("six-pitch-list"),
    ...inputPatch("six-pitch-list"),
    underlyingState: "six-pitch-list" as VenuePitchSetupVisualState,
    headerTopPx: 0,
    headerRowHeightPx: 44,
    headerRightInsetPx: 0,
  },

  transition(state: VenuePitchSetupVisualState, underlyingState?: VenuePitchSetupVisualState) {
    this.setData({
      ...buildVenuePitchSetupView(state),
      ...inputPatch(state),
      underlyingState: underlyingState ?? underlyingFor(state),
    });
  },

  onLoad(options: SetupOptions = {}) {
    const layout = readIntentHeaderLayout();
    const state = resolveVenuePitchSetupVisualState(options.state);
    this.setData({
      ...buildVenuePitchSetupView(state),
      ...inputPatch(state),
      underlyingState: underlyingFor(state),
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
    if (!VENUE_PITCH_SETUP_FIXTURE.pitches.some(({ id }) => id === pitchId)) return;
    this.transition(pitchId === "pitch-7-001" ? "edit-preset-open" : "edit-custom-open", this.data.visualState);
  },

  onNameInput(event: InputEvent) {
    this.setData({ draftName: typeof event.detail?.value === "string" ? event.detail.value : "" });
  },

  onSelectFormat(event: DatasetEvent) {
    const format = event.currentTarget?.dataset?.format;
    if (format === "other") this.transition("edit-custom-open", this.data.underlyingState);
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
    if (this.data.visualState === "add-first-open") return this.transition("first-pitch-draft");
    if (this.data.visualState === "edit-custom-open" && !this.data.isDraftPlayersValid) return this.transition("field-validation", this.data.underlyingState);
    const next = this.data.editor?.completeNextState;
    if (next) this.transition(next);
  },

  onDeletePitch() { this.transition("unused-delete-confirm", "six-pitch-list"); },
  onConfirmDelete() { this.transition("unused-deleted-draft"); },
  onDeactivatePitch() { this.transition("deactivated-draft"); },
  onReactivatePitch() { this.transition("reactivated-draft"); },

  onCloseSheet() {
    if (this.data.duplicateSaveDisabled || !this.data.isSheetOpen) return;
    this.transition(this.data.underlyingState);
  },

  onCancelSheet() { this.onCloseSheet(); },

  onBack() {
    if (this.data.mode === "draft" && this.data.visualState !== "unsaved-leave-confirm") {
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
