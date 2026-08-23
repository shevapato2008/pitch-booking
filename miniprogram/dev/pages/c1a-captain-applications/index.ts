import {
  C1A_PLAYER_APPLICATION_FIXTURE,
  c1aPlayerApplicationStore,
  type C1aDecisionOutcome,
  type C1aPosition,
} from "../../c1a-player-application-fixture";
import { readIntentHeaderLayout } from "../../intent-header-layout";

interface Options { outcome?: unknown; }

const scenarioRoute = "/dev/pages/c1a-scenario/index";
const publicRoute = "/dev/pages/c1a-game-public/index";
const positionLabels: Record<C1aPosition, string> = {
  GOALKEEPER: "门将",
  DEFENDER: "后卫",
  MIDFIELDER: "中场",
  FORWARD: "前锋",
  ANY: "位置不限",
};

function resolveOutcome(value: unknown): C1aDecisionOutcome {
  if (value === "UNKNOWN" || value === "CAPACITY_CHANGED") return value;
  return "CONFIRMED";
}

const patch = () => {
  const snapshot = c1aPlayerApplicationStore.current();
  return {
    ...snapshot,
    fixtureNotice: C1A_PLAYER_APPLICATION_FIXTURE.notice,
    remainingSpots: snapshot.game.remainingSpots,
    hasPending: snapshot.registrationStatus === "APPLIED" && snapshot.application !== null,
    empty: snapshot.registrationStatus !== "APPLIED" && snapshot.operationState === "READY",
    roleReady: snapshot.viewerRole === "CAPTAIN" && snapshot.authenticated,
    positionLabel: snapshot.application ? positionLabels[snapshot.application.position] : "",
    appliedAtLabel: snapshot.application ? "8月24日 02:00" : "",
    decisionTitle: snapshot.panel === "ACCEPT" ? "确认接受申请" : "确认婉拒申请",
    decisionCopy: snapshot.panel === "ACCEPT"
      ? "接受后，申请人会在同一球局详情看到已加入结果。"
      : "婉拒仅代表本场决定，申请人会在同一详情看到结果。",
    decisionButton: snapshot.panel === "ACCEPT" ? "确认接受" : "确认婉拒",
  };
};

function returnToScenario(): void {
  if (getCurrentPages().length > 1) wx.navigateBack({ delta: 1 });
  else wx.reLaunch({ url: scenarioRoute });
}

Page({
  data: {
    ...patch(),
    decisionOutcome: "CONFIRMED" as C1aDecisionOutcome,
    headerTopPx: 0,
    headerRowHeightPx: 44,
    headerRightInsetPx: 0,
    headerLeftInsetPx: 0,
  },
  sync(extra: Record<string, unknown> = {}) { this.setData({ ...patch(), ...extra }); },
  onLoad(options: Options = {}) {
    const header = readIntentHeaderLayout();
    this.setData({
      ...patch(),
      decisionOutcome: resolveOutcome(options.outcome),
      headerTopPx: header.topPx,
      headerRowHeightPx: header.rowHeightPx,
      headerRightInsetPx: header.rightInsetPx,
      headerLeftInsetPx: header.rightInsetPx,
    });
  },
  onShow() { this.sync(); },
  onHeaderBack() { returnToScenario(); },
  onAccept() {
    c1aPlayerApplicationStore.openDecision("ACCEPT");
    this.sync();
  },
  onReject() {
    c1aPlayerApplicationStore.openDecision("REJECT");
    this.sync();
  },
  onClosePanel() {
    c1aPlayerApplicationStore.closePanel();
    this.sync();
  },
  onConfirmDecision() {
    const injectedOutcome = resolveOutcome(this.data.decisionOutcome);
    const outcome = injectedOutcome === "CAPACITY_CHANGED"
      && c1aPlayerApplicationStore.current().panel === "REJECT"
      ? "CONFIRMED"
      : injectedOutcome;
    c1aPlayerApplicationStore.confirmDecision(outcome);
    this.sync(outcome === injectedOutcome ? {} : { decisionOutcome: "CONFIRMED" });
  },
  onConfirmDecisionResult() {
    c1aPlayerApplicationStore.confirmDecisionResult();
    this.sync({ decisionOutcome: "CONFIRMED" });
  },
  onRefreshApplications() {
    c1aPlayerApplicationStore.refreshApplications();
    this.sync({ decisionOutcome: "CONFIRMED" });
  },
  onReload() {
    c1aPlayerApplicationStore.recoverLoad();
    this.sync();
  },
  onRecoverAuthentication() {
    c1aPlayerApplicationStore.recoverAuthentication();
    this.sync();
  },
  onReturnPreview() {
    c1aPlayerApplicationStore.returnToPreview();
    this.sync();
    wx.reLaunch({ url: scenarioRoute });
  },
  onSwitchApplicant() {
    c1aPlayerApplicationStore.setViewerRole("APPLICANT");
    this.sync();
    wx.redirectTo({ url: publicRoute });
  },
});
