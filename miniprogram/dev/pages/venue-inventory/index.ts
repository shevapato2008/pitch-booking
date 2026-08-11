import {
  VENUE_INVENTORY_VISUAL_FIXTURE,
  buildVenueInventoryView,
  resolveVenueInventoryVisualState,
  type VenueInventoryVisualState,
} from "../../venue-inventory-fixture";
import { readIntentHeaderLayout } from "../../intent-header-layout";

interface Options { state?: unknown }
interface DatasetEvent { currentTarget?: { dataset?: { pitchId?: unknown; date?: unknown; slotId?: unknown } } }

const dateLabel = (iso: string | null) => {
  if (!iso) return "日期待加载";
  const date = new Date(`${iso}T00:00:00Z`);
  const names = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  return `${date.getUTCMonth() + 1}月${date.getUTCDate()}日 ${names[date.getUTCDay()]}`;
};

const runtimePatch = (state: VenueInventoryVisualState) => {
  const view = buildVenueInventoryView(state);
  return {
    ...view,
    sheet: view.sheet ?? null,
    editor: view.editor ?? null,
    statusMessage: view.statusMessage ?? "",
    recoveryLabel: view.recoveryLabel ?? "",
    recoveryNextState: view.recoveryNextState ?? null,
    duplicateSaveDisabled: Boolean(view.duplicateSaveDisabled),
    writeControlsDisabled: Boolean(view.writeControlsDisabled),
    selectedDateLabel: dateLabel(view.selectedDate),
    pendingDate: view.sheet?.pendingDate ?? "",
  };
};

Page({
  data: {
    ...VENUE_INVENTORY_VISUAL_FIXTURE,
    ...runtimePatch("day-ready"),
    headerTopPx: 0,
    headerRowHeightPx: 44,
    headerRightInsetPx: 0,
  },

  transition(state: VenueInventoryVisualState, patch: Record<string, unknown> = {}) {
    this.setData({ ...runtimePatch(state), ...patch });
  },

  onLoad(options: Options = {}) {
    const layout = readIntentHeaderLayout();
    this.setData({
      ...runtimePatch(resolveVenueInventoryVisualState(options.state)),
      headerTopPx: layout.topPx,
      headerRowHeightPx: layout.rowHeightPx,
      headerRightInsetPx: layout.rightInsetPx,
    });
  },

  onOpenCreate() { this.transition("create-slot-open"); },
  onOpenPitchPicker() { this.transition("pitch-picker-open"); },
  onOpenCalendar() { this.transition("calendar-open"); },

  onSelectPitch(event: DatasetEvent) {
    const pitchId = event.currentTarget?.dataset?.pitchId;
    const pitch = VENUE_INVENTORY_VISUAL_FIXTURE.pitchGroups.flatMap(({ pitches }) => pitches).find(({ id }) => id === pitchId);
    if (!pitch) return;
    const date = this.data.selectedDate || "2026-08-11";
    this.transition("pitch-refreshing", {
      selectedPitch: pitch,
      selectedDate: date,
      selectedDateLabel: dateLabel(date),
      requestSequence: Number(this.data.requestSequence) + 1,
    });
  },

  onSelectDate(event: DatasetEvent) {
    const date = event.currentTarget?.dataset?.date;
    if (typeof date !== "string") return;
    const sheet = this.data.sheet;
    if (this.data.visualState === "calendar-open" && sheet?.kind === "calendar" && sheet.days) {
      this.setData({
        pendingDate: date,
        sheet: {
          ...sheet,
          pendingDate: date,
          pendingLabel: dateLabel(date),
          days: sheet.days.map((day) => ({ ...day, selected: day.iso === date })),
        },
      });
      return;
    }
    this.transition("date-refreshing", { selectedDate: date, selectedDateLabel: dateLabel(date) });
  },

  onConfirmDate() {
    const date = this.data.pendingDate;
    if (!date) return;
    const selectedPitch = this.data.selectedPitch;
    this.transition("date-refreshing", {
      selectedDate: date,
      selectedDateLabel: dateLabel(date),
      selectedPitch,
      requestSequence: Number(this.data.requestSequence) + 1,
    });
  },

  onSlotTap(event: DatasetEvent) {
    const slotId = event.currentTarget?.dataset?.slotId;
    const slot = VENUE_INVENTORY_VISUAL_FIXTURE.slots.find(({ id }) => id === slotId);
    if (slot?.editable && !this.data.writeControlsDisabled) this.transition("edit-slot-open");
  },

  onCloseOverlay() {
    if (this.data.duplicateSaveDisabled) return;
    this.transition(this.data.selectedDate === "2026-08-23" ? "cross-week-ready" : "day-ready");
  },
  onRecovery() {
    if (this.data.recoveryNextState) this.transition(this.data.recoveryNextState);
  },
  onPreviewSave() {
    if (!this.data.duplicateSaveDisabled) this.transition("save-in-progress");
  },
  onPreviewFieldTap() {
    wx.showToast({ title: "仅视觉预览，未写入库存", icon: "none" });
  },
});
