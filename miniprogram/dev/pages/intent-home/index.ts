import {
  CITY_ENTRY_VISUAL_FIXTURE,
  DEV_LAST_INTENT_KEY,
  INTENT_ENTRY_VISUAL_FIXTURE,
  RETURNING_HOME_VISUAL_FIXTURE,
  type IntentId,
} from "../../intent-entry-fixture";
import { readIntentHeaderLayout } from "../../intent-header-layout";

interface IntentOpenEvent {
  currentTarget?: {
    dataset?: {
      intentId?: unknown;
    };
  };
}

interface IntentQuery {
  intent?: unknown;
}

function isIntentId(value: unknown): value is IntentId {
  return value === "HOST" || value === "BOOK" || value === "PLAY";
}

function previewToast() {
  wx.showToast({ title: "仅视觉预览，当前未开放", icon: "none" });
}

Page({
  data: {
    intents: INTENT_ENTRY_VISUAL_FIXTURE.intents.map((intent) => ({
      id: intent.id,
      title: intent.title.replace("我要", ""),
    })),
    activeIntent: "BOOK" as IntentId,
    recentVenueName: RETURNING_HOME_VISUAL_FIXTURE.recentVenueName,
    recentSummary: RETURNING_HOME_VISUAL_FIXTURE.recentSummary,
    pendingOrderSummary: RETURNING_HOME_VISUAL_FIXTURE.pendingOrderSummary,
    pendingOrderDetail: RETURNING_HOME_VISUAL_FIXTURE.pendingOrderDetail,
    headerTopPx: 0,
    headerRowHeightPx: 44,
    headerRightInsetPx: 0,
    isCityPickerOpen: false,
    currentCityName: CITY_ENTRY_VISUAL_FIXTURE.currentCityName,
    currentStatus: CITY_ENTRY_VISUAL_FIXTURE.currentStatus,
    otherCityName: CITY_ENTRY_VISUAL_FIXTURE.otherCityName,
    otherStatus: CITY_ENTRY_VISUAL_FIXTURE.otherStatus,
  },

  onLoad(query: IntentQuery = {}) {
    const headerLayout = readIntentHeaderLayout();
    const queryIntent = query.intent;
    const storedIntent = isIntentId(queryIntent)
      ? undefined
      : wx.getStorageSync(DEV_LAST_INTENT_KEY);
    const activeIntent = isIntentId(queryIntent)
      ? queryIntent
      : isIntentId(storedIntent)
        ? storedIntent
        : "BOOK";

    this.setData({
      activeIntent,
      headerTopPx: headerLayout.topPx,
      headerRowHeightPx: headerLayout.rowHeightPx,
      headerRightInsetPx: headerLayout.rightInsetPx,
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

  onOpenIntent(event: IntentOpenEvent) {
    const intentId = event.currentTarget?.dataset?.intentId;
    if (!isIntentId(intentId)) return;

    this.setData({ activeIntent: intentId });

    if (intentId === "BOOK") {
      wx.reLaunch({ url: "/pages/venue-map/index" });
      return;
    }

    previewToast();
  },

  onContinueLast() {
    wx.reLaunch({ url: "/pages/venue-map/index" });
  },

  onOpenMy() {
    previewToast();
  },
});
