import { c1bGameDiscoveryStore } from "../../c1b-game-discovery-fixture";
import { readIntentHeaderLayout } from "../../intent-header-layout";

const scenarios = [
  { scenario: "READY", title: "默认列表", detail: "三场球局，默认包含已满场次" },
  { scenario: "FILTERED_NONEMPTY", title: "筛选后有结果", detail: "日期、人制与有名额组合筛选" },
  { scenario: "FILTER_NO_MATCH", title: "筛选无结果", detail: "可清除筛选恢复列表" },
  { scenario: "LOAD_ERROR", title: "加载失败", detail: "可重新加载恢复目录" },
  { scenario: "LOADING", title: "加载中", detail: "保留筛选结构与两张骨架卡" },
  { scenario: "SOURCE_EMPTY", title: "暂无公开球局", detail: "返回真实目的选择页" },
  { scenario: "SELECTED_DETAIL", title: "只读详情", detail: "进入与卡片一致的代表球局" },
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
    const snapshot = c1bGameDiscoveryStore.reset(scenario);
    if (scenario === "SELECTED_DETAIL" && snapshot.selectedGameId) {
      wx.navigateTo({ url: `/dev/pages/c1b-game-detail/index?gameId=${encodeURIComponent(snapshot.selectedGameId)}` });
      return;
    }
    wx.navigateTo({ url: "/dev/pages/c1b-game-discovery/index" });
  },

  onHeaderBack() { returnFromLauncher(); },
});
