import {
  c2aRegistrationWithdrawalStore,
  type C2aRegistrationWithdrawalScenario,
} from "../../c2a-registration-withdrawal-fixture";
import { readIntentHeaderLayout } from "../../intent-header-layout";

const scenarios = [
  { scenario: "APPLIED", title: "待审核申请", detail: "撤回申请，公开名额保持不变" },
  { scenario: "JOINED_EARLY", title: "提前退出球局", detail: "退出后释放 1 个公开名额" },
  { scenario: "JOINED_LATE", title: "临时退出确认", detail: "不足 6 小时，只记录、不封禁扣款" },
  { scenario: "WITHDRAWN", title: "已退出终态", detail: "没有退出或再次申请动作" },
  { scenario: "RESULT_UNKNOWN", title: "退出结果待确认", detail: "只读取权威结果，不重复提交" },
] as const;

interface ScenarioEvent { currentTarget?: { dataset?: { scenario?: unknown } }; }

const isScenario = (value: unknown): value is C2aRegistrationWithdrawalScenario => (
  scenarios.some(({ scenario }) => scenario === value)
);

const returnFromLauncher = () => {
  if (getCurrentPages().length > 1) wx.navigateBack({ delta: 1 });
  else wx.reLaunch({ url: "/pages/intent-entry/index" });
};

Page({
  data: {
    scenarios,
    previewNotice: "C2a 开发预览 · 模拟数据",
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
    c2aRegistrationWithdrawalStore.reset(scenario);
    wx.navigateTo({ url: "/dev/pages/c2a-my-registrations/index" });
  },

  onHeaderBack() { returnFromLauncher(); },
});
