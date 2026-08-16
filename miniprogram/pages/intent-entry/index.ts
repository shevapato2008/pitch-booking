import { readIntentHeaderLayout } from "../../presentation/intent-header-layout";

type IntentId = "HOST" | "BOOK" | "PLAY";

const INTENTS = Object.freeze([
  Object.freeze({ id: "HOST" as const, title: "我要出租场地", subtitle: "进入已授权的场馆工作台", icon: "venue", disabled: false, status: "" }),
  Object.freeze({ id: "BOOK" as const, title: "我要租赁场地", subtitle: "查找时间、价格和可订整场", icon: "calendar", disabled: false, status: "" }),
  Object.freeze({ id: "PLAY" as const, title: "我要找球踢", subtitle: "加入开放球局", icon: "football", disabled: true, status: "即将开放" }),
]);

function intentIdFrom(event: { currentTarget?: { dataset?: { intentId?: unknown } } }): IntentId | undefined {
  const value = event.currentTarget?.dataset?.intentId;
  return value === "HOST" || value === "BOOK" || value === "PLAY" ? value : undefined;
}

Page({
  data: {
    intents: INTENTS,
    note: "这里选择的是当下目的，不是永久身份。",
    headerTopPx: 0,
    headerRowHeightPx: 44,
    headerRightInsetPx: 0,
    isCityPickerOpen: false,
    currentCityName: "天津",
    currentStatus: "当前 · 已开放",
    otherCityName: "其他城市",
    otherStatus: "敬请期待",
  },

  navigationInFlight: false,

  onLoad(options: { cityPicker?: unknown } = {}) {
    const layout = readIntentHeaderLayout();
    this.setData({
      headerTopPx: layout.topPx,
      headerRowHeightPx: layout.rowHeightPx,
      headerRightInsetPx: layout.rightInsetPx,
      isCityPickerOpen: options.cityPicker === "open",
    });
  },

  onShow() { this.navigationInFlight = false; },

  onOpenCityPicker() { this.setData({ isCityPickerOpen: true }); },
  onCloseCityPicker() { this.setData({ isCityPickerOpen: false }); },
  onSelectCurrentCity() { this.setData({ isCityPickerOpen: false }); },

  onChooseIntent(event: { currentTarget?: { dataset?: { intentId?: unknown } } }) {
    const intentId = intentIdFrom(event);
    if (!intentId || intentId === "PLAY" || this.navigationInFlight) return;
    this.navigationInFlight = true;
    const fail = () => { this.navigationInFlight = false; };
    if (intentId === "BOOK") {
      wx.reLaunch({ url: "/pages/venue-map/index", fail });
    } else {
      wx.navigateTo({ url: "/pages/venue-access/index", fail });
    }
  },
});
