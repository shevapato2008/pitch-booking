import {
  C1A_PLAYER_APPLICATION_FIXTURE,
  c1aPlayerApplicationStore,
  type C1aPlayerApplicationSnapshot,
} from "../../c1a-player-application-fixture";
import { readIntentHeaderLayout } from "../../intent-header-layout";

type PrimaryAction = "LOGIN" | "APPLY" | "REFRESH" | "CONFIRM_SUBMIT" | null;

const scenarioRoute = "/dev/pages/c1a-scenario/index";
const applicationRoute = "/dev/pages/c1a-game-application/index";

function resolvePrimaryAction(snapshot: C1aPlayerApplicationSnapshot): PrimaryAction {
  if (snapshot.operationState === "SUBMIT_UNKNOWN") return "CONFIRM_SUBMIT";
  if (snapshot.operationState !== "READY") return null;
  if (snapshot.registrationStatus === "APPLIED") return "REFRESH";
  if (snapshot.registrationStatus !== "NONE" || snapshot.game.remainingSpots <= 0) return null;
  return snapshot.authenticated ? "APPLY" : "LOGIN";
}

function resolveStatusCopy(snapshot: C1aPlayerApplicationSnapshot): string {
  if (snapshot.operationState === "SUBMIT_UNKNOWN") return "申请结果仍在确认，请用原提交记录继续查询";
  if (snapshot.registrationStatus === "APPLIED") return "申请已提交，等待队长审核";
  if (snapshot.registrationStatus === "JOINED") return "已加入本场球局";
  if (snapshot.registrationStatus === "REJECTED") return "队长本次未能接受申请";
  if (snapshot.game.remainingSpots <= 0) return "名额已满";
  return snapshot.authenticated ? "可以填写申请" : "登录后可提交申请";
}

const patch = () => {
  const snapshot = c1aPlayerApplicationStore.current();
  return {
    ...snapshot,
    game: snapshot.game,
    remainingSpots: snapshot.game.remainingSpots,
    fixtureNotice: C1A_PLAYER_APPLICATION_FIXTURE.notice,
    dateLabel: "8月30日 周日",
    timeLabel: "14:00–16:00",
    deadlineLabel: "当天 11:00 截止",
    aaLabel: `约 ¥${(snapshot.game.aaCents / 100).toFixed(0)} / 人`,
    positionLabel: "门将 / 后卫 / 中场 / 前锋",
    intensityLabel: "轻松友好",
    statusCopy: resolveStatusCopy(snapshot),
    statusTone: snapshot.registrationStatus === "JOINED" ? "success" : "neutral",
    primaryAction: resolvePrimaryAction(snapshot),
  };
};

function returnToScenario(): void {
  const pages = getCurrentPages();
  if (pages.length > 1) wx.navigateBack({ delta: 1 });
  else wx.reLaunch({ url: scenarioRoute });
}

Page({
  data: {
    ...patch(),
    headerTopPx: 0,
    headerRowHeightPx: 44,
    headerRightInsetPx: 0,
    headerLeftInsetPx: 0,
  },
  sync() { this.setData(patch()); },
  onLoad() {
    c1aPlayerApplicationStore.setViewerRole("APPLICANT");
    const header = readIntentHeaderLayout();
    this.setData({
      ...patch(),
      headerTopPx: header.topPx,
      headerRowHeightPx: header.rowHeightPx,
      headerRightInsetPx: header.rightInsetPx,
      headerLeftInsetPx: header.rightInsetPx,
    });
  },
  onShow() {
    c1aPlayerApplicationStore.setViewerRole("APPLICANT");
    this.sync();
  },
  onHeaderBack() { returnToScenario(); },
  onLogin() {
    c1aPlayerApplicationStore.login();
    this.sync();
  },
  onApply() {
    const snapshot = c1aPlayerApplicationStore.openApplication();
    this.sync();
    if (snapshot.formOpen) wx.navigateTo({ url: applicationRoute });
  },
  onRefresh() {
    c1aPlayerApplicationStore.refreshResult();
    this.sync();
  },
  onConfirmSubmitResult() {
    c1aPlayerApplicationStore.confirmSubmitResult();
    this.sync();
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
});
