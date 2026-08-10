import {
  VENUE_INVENTORY_VISUAL_FIXTURE,
  resolveVenueInventoryVisualState,
  type VenueInventoryVisualState,
} from "../../venue-inventory-fixture";
import { readIntentHeaderLayout } from "../../intent-header-layout";

interface VenueInventoryOptions {
  state?: unknown;
}

interface VenueInventorySlotEvent {
  currentTarget?: {
    dataset?: {
      slotId?: unknown;
    };
  };
}

function visualStatePatch(visualState: VenueInventoryVisualState) {
  return {
    visualState,
    isPanelOpen: visualState !== "day-ready",
    isCreatePanel: visualState === "create-slot-open"
      || visualState === "save-result-unknown"
      || visualState === "create-slot-overlap",
    isEditPanel: visualState === "edit-slot-open",
    isSavingUnknown: visualState === "save-result-unknown",
    isOverlap: visualState === "create-slot-overlap",
  };
}

Page({
  data: {
    ...VENUE_INVENTORY_VISUAL_FIXTURE,
    ...visualStatePatch("day-ready"),
    headerTopPx: 0,
    headerRowHeightPx: 44,
    headerRightInsetPx: 0,
    headerContentHeightPx: 88,
  },

  onLoad(options: VenueInventoryOptions = {}) {
    const headerLayout = readIntentHeaderLayout();
    const visualState = resolveVenueInventoryVisualState(options.state);
    this.setData({
      ...visualStatePatch(visualState),
      headerTopPx: headerLayout.topPx,
      headerRowHeightPx: headerLayout.rowHeightPx,
      headerRightInsetPx: headerLayout.rightInsetPx,
    });
  },

  onOpenCreate() {
    this.setData(visualStatePatch("create-slot-open"));
  },

  onSlotTap(event: VenueInventorySlotEvent) {
    const slotId = event.currentTarget?.dataset?.slotId;
    const slot = VENUE_INVENTORY_VISUAL_FIXTURE.slots.find(({ id }) => id === slotId);
    if (!slot?.editable) return;
    this.setData(visualStatePatch("edit-slot-open"));
  },

  onClosePanel() {
    if (this.data.isSavingUnknown) return;
    this.setData(visualStatePatch("day-ready"));
  },

  onCancelPanel() {
    this.onClosePanel();
  },

  onPreviewSave() {
    if (this.data.isSavingUnknown) return;
    this.setData(visualStatePatch("save-result-unknown"));
  },

  onPreviewFieldTap() {
    wx.showToast({ title: "仅视觉预览，未写入库存", icon: "none" });
  },
});
