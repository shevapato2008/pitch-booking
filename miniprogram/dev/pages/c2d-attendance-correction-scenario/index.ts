import { readIntentHeaderLayout } from "../../intent-header-layout";

type C2dReadbackScreen = "captain" | "player";

interface ReadbackEvent {
  currentTarget?: { dataset?: { screen?: unknown } };
}

const screens: ReadonlyArray<{
  readonly screen: C2dReadbackScreen;
  readonly title: string;
  readonly detail: string;
  readonly route: string;
}> = [
  {
    screen: "captain",
    title: "队长到场记录",
    detail: "查看散客当前结果与最新平台纠正时间",
    route: "/dev/pages/c2d-captain-roster/index",
  },
  {
    screen: "player",
    title: "球员报名详情",
    detail: "查看本人当前到场结果并复制报名编号",
    route: "/dev/pages/c2d-player-result/index",
  },
];

function returnFromScenario(): void {
  if (getCurrentPages().length > 1) wx.navigateBack({ delta: 1 });
  else wx.reLaunch({ url: "/pages/intent-entry/index" });
}

Page({
  data: {
    screens,
    previewNotice: "C2d 开发预览 · 模拟数据",
    headerTopPx: 0,
    headerRowHeightPx: 44,
  },

  onLoad() {
    const header = readIntentHeaderLayout();
    wx.hideShareMenu();
    this.setData({
      headerTopPx: header.topPx,
      headerRowHeightPx: header.rowHeightPx,
    });
  },

  onOpenReadback(event: ReadbackEvent) {
    const screen = event.currentTarget?.dataset?.screen;
    const target = screens.find((item) => item.screen === screen);
    if (target) wx.navigateTo({ url: target.route });
  },

  onHeaderBack() { returnFromScenario(); },
});
