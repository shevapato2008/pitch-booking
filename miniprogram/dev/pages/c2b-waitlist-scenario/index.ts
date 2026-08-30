import {
  C2B_WAITLIST_SCENARIOS,
  c2bWaitlistStore,
} from "../../c2b-waitlist-fixture";
import { readIntentHeaderLayout } from "../../intent-header-layout";

type C2bWaitlistScenario = (typeof C2B_WAITLIST_SCENARIOS)[number];

interface ScenarioEvent {
  currentTarget?: { dataset?: { scenario?: unknown } };
}

const scenarioCards: ReadonlyArray<{
  scenario: C2bWaitlistScenario;
  title: string;
  detail: string;
  tone: "review" | "waitlisted" | "joined" | "withdraw" | "blocked";
}> = [
  {
    scenario: "FULL_REVIEW",
    title: "满员申请待审核",
    detail: "队长可加入候补或婉拒，不显示虚假的接受动作",
    tone: "review",
  },
  {
    scenario: "WAITLISTED_FIRST",
    title: "候补第 1 位",
    detail: "本人查看当前顺位，并可退出候补",
    tone: "waitlisted",
  },
  {
    scenario: "PROMOTED",
    title: "首位候补已转正",
    detail: "已加入状态来自权威回读，不声称通知送达",
    tone: "joined",
  },
  {
    scenario: "WAITLIST_WITHDRAW_CONFIRM",
    title: "退出候补确认",
    detail: "确认层明确说明本场不可再次申请",
    tone: "withdraw",
  },
  {
    scenario: "BLOCKED_SUSPENDED",
    title: "球局暂停",
    detail: "自动递补冻结，候补本人仍可退出",
    tone: "blocked",
  },
];

function isScenario(value: unknown): value is C2bWaitlistScenario {
  return typeof value === "string"
    && (C2B_WAITLIST_SCENARIOS as readonly string[]).includes(value);
}

function returnFromLauncher(): void {
  if (getCurrentPages().length > 1) wx.navigateBack({ delta: 1 });
  else wx.reLaunch({ url: "/pages/intent-entry/index" });
}

Page({
  data: {
    scenarios: scenarioCards,
    previewNotice: "C2b 开发预览 · 模拟数据",
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
    c2bWaitlistStore.reset(scenario);
    wx.navigateTo({
      url: scenario === "FULL_REVIEW"
        ? "/dev/pages/c2b-captain-applications/index"
        : "/dev/pages/c2b-my-registrations/index",
    });
  },

  onHeaderBack() { returnFromLauncher(); },
});
