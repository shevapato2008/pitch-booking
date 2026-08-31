import {
  C2C_ATTENDANCE_SCENARIOS,
  type C2cAttendanceScenario,
  c2cAttendanceStore,
} from "../../c2c-attendance-fixture";
import { readIntentHeaderLayout } from "../../intent-header-layout";

interface ScenarioEvent {
  currentTarget?: { dataset?: { scenario?: unknown } };
}

const scenarios: ReadonlyArray<{
  scenario: C2cAttendanceScenario;
  title: string;
  detail: string;
}> = [
  { scenario: "MIXED", title: "混合名单", detail: "待记录、已到场与未到场同时展示" },
  { scenario: "COMPLETE", title: "全部完成", detail: "检查全部散客已完成记录的状态" },
  { scenario: "EMPTY", title: "空名单", detail: "本场没有需要记录的散客" },
  { scenario: "LOAD_ERROR", title: "加载失败", detail: "检查重新加载名单的恢复入口" },
  { scenario: "CONFLICT", title: "状态冲突", detail: "确认最新权威名单后继续记录" },
  { scenario: "UNKNOWN_RESULT", title: "未知结果", detail: "读取权威结果，不重复声称成功" },
];

function isScenario(value: unknown): value is C2cAttendanceScenario {
  return typeof value === "string"
    && (C2C_ATTENDANCE_SCENARIOS as readonly string[]).includes(value);
}

function returnFromLauncher(): void {
  if (getCurrentPages().length > 1) wx.navigateBack({ delta: 1 });
  else wx.reLaunch({ url: "/pages/intent-entry/index" });
}

Page({
  data: {
    scenarios,
    previewNotice: "C2c 开发预览 · 模拟数据",
    headerTopPx: 0,
    headerRowHeightPx: 44,
  },

  onLoad() {
    const header = readIntentHeaderLayout();
    this.setData({
      headerTopPx: header.topPx,
      headerRowHeightPx: header.rowHeightPx,
    });
  },

  onOpenScenario(event: ScenarioEvent) {
    const scenario = event.currentTarget?.dataset?.scenario;
    if (!isScenario(scenario)) return;
    c2cAttendanceStore.reset(scenario);
    wx.navigateTo({ url: "/dev/pages/c2c-attendance/index" });
  },

  onHeaderBack() { returnFromLauncher(); },
});
