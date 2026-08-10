import {
  CITY_ENTRY_VISUAL_FIXTURE,
  DEV_LAST_INTENT_KEY,
  INTENT_ENTRY_VISUAL_FIXTURE,
  type IntentId,
} from "../../intent-entry-fixture";
import { readIntentHeaderLayout } from "../../intent-header-layout";

interface IntentChooseEvent {
  currentTarget?: {
    dataset?: {
      intentId?: unknown;
    };
  };
}

interface IntentEntryOptions {
  cityPicker?: unknown;
}

function isIntentId(value: unknown): value is IntentId {
  return value === "HOST" || value === "BOOK" || value === "PLAY";
}

Page({
  data: {
    intents: INTENT_ENTRY_VISUAL_FIXTURE.intents,
    note: INTENT_ENTRY_VISUAL_FIXTURE.note,
    headerTopPx: 0,
    headerRowHeightPx: 44,
    headerRightInsetPx: 0,
    isCityPickerOpen: false,
    currentCityName: CITY_ENTRY_VISUAL_FIXTURE.currentCityName,
    currentStatus: CITY_ENTRY_VISUAL_FIXTURE.currentStatus,
    otherCityName: CITY_ENTRY_VISUAL_FIXTURE.otherCityName,
    otherStatus: CITY_ENTRY_VISUAL_FIXTURE.otherStatus,
  },

  onLoad(options: IntentEntryOptions = {}) {
    const headerLayout = readIntentHeaderLayout();
    this.setData({
      headerTopPx: headerLayout.topPx,
      headerRowHeightPx: headerLayout.rowHeightPx,
      headerRightInsetPx: headerLayout.rightInsetPx,
      isCityPickerOpen: options.cityPicker === "open",
    });
  },

  onOpenCityPicker() {
    this.setData({ isCityPickerOpen: true });
  },

  onCloseCityPicker() {
    this.setData({ isCityPickerOpen: false });
  },

  onSelectCurrentCity() {
    this.setData({ isCityPickerOpen: false });
  },

  onChooseIntent(event: IntentChooseEvent) {
    const intentId = event.currentTarget?.dataset?.intentId;
    if (!isIntentId(intentId)) return;

    wx.setStorageSync(DEV_LAST_INTENT_KEY, intentId);

    if (intentId === "BOOK") {
      wx.reLaunch({ url: "/pages/venue-map/index" });
      return;
    }

    wx.showToast({ title: "仅视觉预览，当前未开放", icon: "none" });
  },
});
