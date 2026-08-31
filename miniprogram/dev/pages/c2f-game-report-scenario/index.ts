import type { C2fPreviewScenario } from "../../c2f-game-report-fixture";
import { readIntentHeaderLayout } from "../../intent-header-layout";

interface ScenarioEvent {
  currentTarget?: { dataset?: { scenario?: unknown } };
}

const screens: ReadonlyArray<{
  readonly scenario: C2fPreviewScenario;
  readonly title: string;
  readonly detail: string;
}> = [
  { scenario: "form", title: "填写举报", detail: "五类原因、事实说明与提交确认" },
  { scenario: "pending", title: "待平台处理", detail: "读取本人已提交的举报" },
  { scenario: "resolved-dismissed", title: "结论：举报驳回", detail: "查看准确且克制的结果文案" },
  { scenario: "resolved-recorded", title: "结论：成立已记录", detail: "不暗示处罚、封禁或费用处理" },
  { scenario: "resolved-cancelled", title: "结论：球局已取消", detail: "只说明公开球局已取消" },
  { scenario: "expired", title: "提交期限已过", detail: "不显示无效的提交按钮" },
  { scenario: "unknown", title: "提交结果未知", detail: "先读取权威结果，再决定是否重放" },
];

function returnFromScenario(): void {
  if (getCurrentPages().length > 1) wx.navigateBack({ delta: 1 });
  else wx.reLaunch({ url: "/pages/intent-entry/index" });
}

Page({
  data: {
    screens,
    previewNotice: "C2f 开发预览 · 模拟数据，不会提交或修改生产数据",
    headerTopPx: 0,
    headerRowHeightPx: 44,
  },

  onLoad() {
    const header = readIntentHeaderLayout();
    wx.hideShareMenu();
    this.setData({ headerTopPx: header.topPx, headerRowHeightPx: header.rowHeightPx });
  },

  onOpenScenario(event: ScenarioEvent) {
    const scenario = event.currentTarget?.dataset?.scenario;
    const target = screens.find((item) => item.scenario === scenario);
    if (target) {
      wx.navigateTo({ url: `/dev/pages/c2f-game-report/index?scenario=${target.scenario}` });
    }
  },

  onHeaderBack() { returnFromScenario(); },
});
