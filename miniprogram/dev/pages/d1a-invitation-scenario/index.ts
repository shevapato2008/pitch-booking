import { readIntentHeaderLayout } from "../../intent-header-layout";
import type { D1aInvitationState } from "../../d1a-venue-invitation-fixture";

interface ScenarioTapEvent {
  currentTarget?: { dataset?: { state?: unknown } };
}

const scenarios: ReadonlyArray<{
  readonly state: D1aInvitationState;
  readonly title: string;
  readonly detail: string;
}> = Object.freeze([
  { state: "ready", title: "待接受邀请", detail: "首次打开，可显式接受并绑定当前账号" },
  { state: "claimed", title: "已绑定邀请", detail: "继续补充锁定场馆的认领材料" },
  { state: "submitted", title: "申请已提交", detail: "读取真实含义的待人工审核状态" },
  { state: "unavailable", title: "邀请不可用", detail: "过期、撤销或已绑定其他账号" },
]);

function goBack(): void {
  if (getCurrentPages().length > 1) wx.navigateBack({ delta: 1 });
  else wx.reLaunch({ url: "/pages/intent-entry/index" });
}

Page({
  data: {
    scenarios,
    headerTopPx: 0,
    headerRowHeightPx: 44,
  },

  onLoad() {
    const header = readIntentHeaderLayout();
    wx.hideShareMenu();
    this.setData({ headerTopPx: header.topPx, headerRowHeightPx: header.rowHeightPx });
  },

  onOpenScenario(event: ScenarioTapEvent) {
    const state = event.currentTarget?.dataset?.state;
    if (!scenarios.some((item) => item.state === state)) return;
    wx.navigateTo({ url: `/dev/pages/d1a-venue-invitation/index?state=${String(state)}` });
  },

  onHeaderBack() { goBack(); },
});
