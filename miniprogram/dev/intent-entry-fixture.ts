export type IntentId = "HOST" | "BOOK" | "PLAY";

export const DEV_LAST_INTENT_KEY = "DEV_ONLY_LAST_INTENT";

export const INTENT_ENTRY_VISUAL_FIXTURE = Object.freeze({
  intents: Object.freeze([
    Object.freeze({
      id: "HOST" as const,
      title: "我要出租场地",
      subtitle: "申请合作，或进入已授权的场馆工作台",
      icon: "venue" as const,
    }),
    Object.freeze({
      id: "BOOK" as const,
      title: "我要租赁场地",
      subtitle: "为球队查找时间、价格和可订整场",
      icon: "calendar" as const,
    }),
    Object.freeze({
      id: "PLAY" as const,
      title: "我要找球踢",
      subtitle: "没有球队，也能加入已锁定场地的开放球局",
      icon: "football" as const,
    }),
  ]),
  note: "这里选择的是当下目的，不是永久身份。",
});

export const RETURNING_HOME_VISUAL_FIXTURE = Object.freeze({
  recentVenueName: "渤海元丰足球场",
  recentSummary: "查看未来 14 天可订时段",
  pendingOrderSummary: "1 个待支付订单",
  pendingOrderDetail: "请在剩余时间内完成支付",
});

export const CITY_ENTRY_VISUAL_FIXTURE = Object.freeze({
  currentCityName: "天津",
  currentStatus: "当前 · 已开放",
  otherCityName: "其他城市",
  otherStatus: "敬请期待",
});
