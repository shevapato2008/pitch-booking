import {
  DEV_LAST_INTENT_KEY,
  INTENT_ENTRY_VISUAL_FIXTURE,
  RETURNING_HOME_VISUAL_FIXTURE,
  type IntentId,
} from "../../intent-entry-fixture";

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
  },

  onLoad(query: IntentQuery = {}) {
    const queryIntent = query.intent;
    const storedIntent = isIntentId(queryIntent)
      ? undefined
      : wx.getStorageSync(DEV_LAST_INTENT_KEY);
    const activeIntent = isIntentId(queryIntent)
      ? queryIntent
      : isIntentId(storedIntent)
        ? storedIntent
        : "BOOK";

    this.setData({ activeIntent });
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
