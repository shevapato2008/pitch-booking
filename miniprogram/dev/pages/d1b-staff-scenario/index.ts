import { readIntentHeaderLayout } from "../../intent-header-layout";

const scenarios = Object.freeze([
  Object.freeze({ key: "owner", title: "负责人管理", description: "成员、邀请、权限编辑与移除确认", url: "/dev/pages/d1b-venue-staff/index?state=owner" }),
  Object.freeze({ key: "staff", title: "员工只读", description: "只显示自己的权限，不提供管理动作", url: "/dev/pages/d1b-venue-staff/index?state=staff" }),
  Object.freeze({ key: "invitation", title: "员工邀请", description: "查看授权范围并显式接受", url: "/dev/pages/d1b-staff-invitation/index?state=invitation" }),
  Object.freeze({ key: "unavailable", title: "邀请不可用", description: "过期、撤销或已被接受的统一恢复状态", url: "/dev/pages/d1b-staff-invitation/index?state=unavailable" }),
]);

function goBack(): void {
  if (getCurrentPages().length > 1) wx.navigateBack({ delta: 1 });
  else wx.reLaunch({ url: "/pages/intent-entry/index" });
}

Page({
  data: { scenarios, headerTopPx: 0, headerRowHeightPx: 44 },
  onLoad() {
    const header = readIntentHeaderLayout();
    wx.hideShareMenu();
    this.setData({ headerTopPx: header.topPx, headerRowHeightPx: header.rowHeightPx });
  },
  onOpenScenario(event: WechatMiniprogram.TouchEvent) {
    const url = String(event.currentTarget.dataset.url ?? "");
    if (url) wx.navigateTo({ url });
  },
  onHeaderBack() { goBack(); },
});
