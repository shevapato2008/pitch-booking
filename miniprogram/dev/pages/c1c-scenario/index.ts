import { c1bGameDiscoveryStore } from "../../c1b-game-discovery-fixture";
import { c1cMyGameRegistrationsStore } from "../../c1c-my-game-registrations-fixture";
import { readIntentHeaderLayout } from "../../intent-header-layout";

const scenarios = [
  { scenario: "ENTRY", title: "找球局入口", detail: "检查我的报名入口与公开球局筛选" },
  { scenario: "READY", title: "报名列表", detail: "四种状态、两页稳定加载与精确详情" },
  { scenario: "EMPTY", title: "暂无报名", detail: "返回找球局或刷新空列表" },
  { scenario: "LOAD_ERROR", title: "加载失败", detail: "重新加载恢复报名列表" },
] as const;

type Scenario = typeof scenarios[number]["scenario"];

interface ScenarioEvent {
  currentTarget?: { dataset?: { scenario?: unknown } };
}

const isScenario = (value: unknown): value is Scenario => scenarios.some(({ scenario }) => scenario === value);

const returnFromLauncher = () => {
  if (getCurrentPages().length > 1) wx.navigateBack({ delta: 1 });
  else wx.reLaunch({ url: "/pages/intent-entry/index" });
};

Page({
  data: {
    scenarios,
    previewNotice: "C1c 开发预览 · 模拟数据",
    headerTopPx: 0,
    headerRowHeightPx: 44,
  },

  onLoad() {
    const header = readIntentHeaderLayout();
    this.setData({ headerTopPx: header.topPx, headerRowHeightPx: header.rowHeightPx });
  },

  onOpenScenario(event: ScenarioEvent) {
    const scenario = event.currentTarget?.dataset?.scenario;
    if (!isScenario(scenario)) return;

    if (scenario === "ENTRY") {
      c1bGameDiscoveryStore.reset("READY");
      c1cMyGameRegistrationsStore.reset("READY");
      wx.navigateTo({ url: "/dev/pages/c1c-discovery-entry/index" });
      return;
    }

    c1cMyGameRegistrationsStore.reset(scenario);
    wx.navigateTo({ url: "/dev/pages/c1c-my-registrations/index" });
  },

  onHeaderBack() { returnFromLauncher(); },
});
