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
  if (snapshot.registrationStatus !== "NONE") return "REFRESH";
  if (snapshot.game.remainingSpots <= 0) return null;
  return snapshot.authenticated ? "APPLY" : "LOGIN";
}

function resolveStatus(snapshot: C1aPlayerApplicationSnapshot) {
  if (snapshot.operationState === "SUBMIT_UNKNOWN") return {
    heading: "申请结果暂时未知",
    description: "请使用原提交记录继续确认，不会生成第二次申请。",
    tone: "pending",
  };
  if (snapshot.registrationStatus === "APPLIED") return {
    heading: "等待队长审核",
    description: "申请已记录。可留在同一详情刷新结果。",
    tone: "pending",
  };
  if (snapshot.registrationStatus === "JOINED") return {
    heading: "已加入本场球局",
    description: "队长已接受申请；AA 到场线下结算。",
    tone: "joined",
  };
  if (snapshot.registrationStatus === "REJECTED") return {
    heading: "本次申请未被接受",
    description: "这是本场决定，不影响之后参加其他球局。",
    tone: "rejected",
  };
  if (snapshot.game.remainingSpots <= 0) return {
    heading: "名额已满",
    description: "当前没有可申请名额，本预览不提供候补。",
    tone: "rejected",
  };
  return snapshot.authenticated ? {
    heading: "可以申请加入",
    description: "填写本场信息后提交，队长审核结果回到本页查看。",
    tone: "available",
  } : {
    heading: "登录后可提交申请",
    description: "提交后由队长审核，结果回到本页查看。",
    tone: "anonymous",
  };
}

const patch = () => {
  const snapshot = c1aPlayerApplicationStore.current();
  const status = resolveStatus(snapshot);
  return {
    ...snapshot,
    game: snapshot.game,
    remainingSpots: snapshot.game.remainingSpots,
    fixtureNotice: C1A_PLAYER_APPLICATION_FIXTURE.notice,
    dateLabel: "2026年8月30日 周日",
    timeLabel: "19:00–21:00",
    deadlineLabel: "8月30日 17:00",
    aaLabel: `预计 ¥${(snapshot.game.aaCents / 100).toFixed(0)} / 人`,
    capacityLabel: `计划 ${snapshot.game.totalPlayers} 人`,
    positionLabel: "门将、后卫、前锋",
    intensityLabel: "休闲对抗",
    statusHeading: status.heading,
    statusDescription: status.description,
    statusTone: status.tone,
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
