import {
  C2E_MEMBER_REMOVAL_SCENARIOS,
  c2eMemberRemovalStore,
  type C2eMemberRemovalScenario,
} from "../../c2e-member-removal-fixture";
import { readIntentHeaderLayout } from "../../intent-header-layout";

interface ScenarioEvent { currentTarget?: { dataset?: { scenario?: unknown } }; }

const scenarios: ReadonlyArray<{
  readonly scenario: C2eMemberRemovalScenario;
  readonly title: string;
  readonly detail: string;
}> = [
  { scenario: "READY", title: "可移除成员", detail: "正式成员行、来源、加入时间与真实移除入口" },
  { scenario: "VALIDATION", title: "原因校验", detail: "空白、超长与隐私信息在本地阻止提交" },
  { scenario: "FULL_FIFO", title: "满员 FIFO 递补", detail: "移除后只递补候补队列第一位" },
  { scenario: "OPEN_SPOT", title: "未满员不递补", detail: "移除后新增空缺，候补名单保持不变" },
  { scenario: "BLOCKED", title: "只读 blocker", detail: "已开场与订单权威异常时不提供移除按钮" },
  { scenario: "UNKNOWN_RESULT", title: "未知结果恢复", detail: "复用原操作 key 后读取最新成员名单" },
];

function isScenario(value: unknown): value is C2eMemberRemovalScenario {
  return typeof value === "string"
    && (C2E_MEMBER_REMOVAL_SCENARIOS as readonly string[]).includes(value);
}

function returnFromLauncher(): void {
  if (getCurrentPages().length > 1) wx.navigateBack({ delta: 1 });
  else wx.reLaunch({ url: "/pages/intent-entry/index" });
}

Page({
  data: {
    scenarios,
    previewNotice: "C2e 开发预览 · 模拟数据",
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
    if (!isScenario(scenario)) return;
    c2eMemberRemovalStore.reset(scenario);
    wx.navigateTo({ url: "/dev/pages/c2e-member-removal/index" });
  },

  onHeaderBack() { returnFromLauncher(); },
});
