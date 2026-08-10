import {
  DEV_LAST_INTENT_KEY,
  INTENT_ENTRY_VISUAL_FIXTURE,
  type IntentId,
} from "../../intent-entry-fixture";

interface IntentChooseEvent {
  currentTarget?: {
    dataset?: {
      intentId?: unknown;
    };
  };
}

function isIntentId(value: unknown): value is IntentId {
  return value === "HOST" || value === "BOOK" || value === "PLAY";
}

Page({
  data: {
    intents: INTENT_ENTRY_VISUAL_FIXTURE.intents,
    note: INTENT_ENTRY_VISUAL_FIXTURE.note,
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
