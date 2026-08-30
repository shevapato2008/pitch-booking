import {
  c2bWaitlistStore,
  type C2bWaitlistSnapshot,
} from "../../c2b-waitlist-fixture";
import { readIntentHeaderLayout } from "../../intent-header-layout";

const scenarioRoute = "/dev/pages/c2b-waitlist-scenario/index";

function snapshot(): C2bWaitlistSnapshot {
  return c2bWaitlistStore.current();
}

function formatAppliedAt(value: string): string {
  const match = /^\d{4}-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!match) return value;
  return `${Number(match[1])}月${Number(match[2])}日 ${match[3]}:${match[4]}`;
}

function project() {
  const current = snapshot();
  const decision = current.captainPanel;
  return {
    applicant: current.applicant,
    game: current.game,
    canWaitlist: current.canWaitlist,
    canReject: current.canReject,
    remainingSpots: current.game.remainingSpots,
    hasPending: current.applicant.persistedStatus === "APPLIED",
    panel: decision,
    applicantName: current.applicant.applicantName,
    applicantNote: "未填写本场备注",
    applicantAppliedAtLabel: formatAppliedAt(current.applicant.appliedAt),
    capacityLabel: `${current.game.currentPlayers} / ${current.game.plannedPlayers} 人`,
    decisionTitle: decision === "WAITLIST" ? "确认加入候补？" : "确认婉拒申请？",
    decisionCopy: decision === "WAITLIST"
      ? "确认后将按本场不可复用的先后顺序排入候补，当前不会增加已加入人数。"
      : "婉拒是本场终态；申请人将从同一报名详情读取结果。",
    decisionButton: decision === "WAITLIST" ? "确认加入候补" : "确认婉拒",
  };
}

function returnToScenario(): void {
  if (getCurrentPages().length > 1) wx.navigateBack({ delta: 1 });
  else wx.redirectTo({ url: scenarioRoute });
}

Page({
  data: {
    ...project(),
    fixtureNotice: "C2b 开发预览 · 模拟数据",
    noticeMessage: "",
    headerTopPx: 0,
    headerRowHeightPx: 44,
  },

  sync(extra: Record<string, unknown> = {}) {
    this.setData({ ...project(), ...extra });
  },

  onLoad() {
    const header = readIntentHeaderLayout();
    this.setData({
      ...project(),
      headerTopPx: header.topPx,
      headerRowHeightPx: header.rowHeightPx,
    });
  },

  onShow() { this.sync({ noticeMessage: this.data.noticeMessage || "" }); },

  onWaitlist() {
    c2bWaitlistStore.openCaptainDecision("WAITLIST");
    this.sync();
  },

  onReject() {
    c2bWaitlistStore.openCaptainDecision("REJECT");
    this.sync();
  },

  onClosePanel() {
    c2bWaitlistStore.closeCaptainDecision();
    this.sync();
  },

  onConfirmDecision() {
    const decision = snapshot().captainPanel;
    c2bWaitlistStore.confirmCaptainDecision();
    const current = snapshot();
    const noticeMessage = decision === "WAITLIST" && current.applicant.waitlistPosition !== null
      ? `已加入候补，当前第 ${current.applicant.waitlistPosition} 位。`
      : decision === "REJECT"
        ? "已婉拒这份申请。"
        : "";
    this.sync({ noticeMessage });
  },

  onReturnScenario() { returnToScenario(); },
  onHeaderBack() { returnToScenario(); },
});
