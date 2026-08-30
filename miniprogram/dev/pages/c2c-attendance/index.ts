import {
  c2cAttendanceStore,
  type C2cAttendancePlayer,
  type C2cAttendanceResult,
} from "../../c2c-attendance-fixture";
import { readIntentHeaderLayout } from "../../intent-header-layout";

interface AttendanceEvent {
  currentTarget?: { dataset?: { registrationId?: unknown } };
}

const scenarioRoute = "/dev/pages/c2c-attendance-scenario/index";

function formatRecordedAt(value: string | null): string {
  if (!value) return "";
  const match = /^\d{4}-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!match) return value;
  return `${Number(match[1])}月${Number(match[2])}日 ${match[3]}:${match[4]} 记录`;
}

function resultLabel(result: C2cAttendanceResult): string {
  if (result === "PRESENT") return "已到场";
  if (result === "NO_SHOW") return "未到场";
  return "待记录";
}

function projectPlayer(player: C2cAttendancePlayer) {
  return {
    ...player,
    isUnmarked: player.attendanceResult === "UNMARKED",
    resultLabel: resultLabel(player.attendanceResult),
    recordedTimeLabel: formatRecordedAt(player.recordedAt),
  };
}

function project() {
  const current = c2cAttendanceStore.current();
  const decision = current.decisionPanel;
  const decisionPlayer = decision
    ? current.roster.find((player) => player.registrationId === decision.registrationId)
    : undefined;
  return {
    fixtureNotice: current.notice,
    scenario: current.scenario,
    previewState: current.previewState,
    previewMessage: current.previewMessage,
    game: current.game,
    roster: current.roster.map(projectPlayer),
    progressLabel: `已记录 ${current.recorded} / ${current.total}`,
    isEmpty: current.previewState === "READY" && current.total === 0,
    isComplete: current.previewState === "READY"
      && current.total > 0
      && current.attendanceComplete,
    completionMessage: "本场散客到场记录已完成",
    emptyMessage: "本场没有需要记录的散客",
    decisionPanel: decision,
    decisionTitle: decision?.attendanceResult === "PRESENT"
      ? "确认已到场？"
      : decision?.attendanceResult === "NO_SHOW"
        ? "确认未到场？"
        : "",
    decisionPlayerName: decisionPlayer?.perGameName ?? "",
    decisionWarning: "确认后本页不能自行修改。",
    confirmButtonLabel: decision?.attendanceResult === "PRESENT" ? "确认到场" : "确认未到场",
  };
}

function returnToScenario(): void {
  if (getCurrentPages().length > 1) wx.navigateBack({ delta: 1 });
  else wx.redirectTo({ url: scenarioRoute });
}

function hideShare(): void {
  try { void wx.hideShareMenu(); } catch { /* platform unavailable during teardown */ }
}

Page({
  data: {
    ...project(),
    headerTopPx: 0,
    headerRowHeightPx: 44,
  },

  sync() { this.setData(project()); },

  onLoad() {
    const header = readIntentHeaderLayout();
    hideShare();
    this.setData({
      ...project(),
      headerTopPx: header.topPx,
      headerRowHeightPx: header.rowHeightPx,
    });
  },

  onShow() { this.sync(); },

  onMarkPresent(event: AttendanceEvent) {
    c2cAttendanceStore.openDecision(event.currentTarget?.dataset?.registrationId, "PRESENT");
    this.sync();
  },

  onMarkNoShow(event: AttendanceEvent) {
    c2cAttendanceStore.openDecision(event.currentTarget?.dataset?.registrationId, "NO_SHOW");
    this.sync();
  },

  onCloseDecision() {
    c2cAttendanceStore.closeDecision();
    this.sync();
  },

  onConfirmDecision() {
    if (!c2cAttendanceStore.current().decisionPanel) return;
    c2cAttendanceStore.confirmDecision();
    this.sync();
  },

  onRetryLoad() {
    c2cAttendanceStore.retryLoad();
    this.sync();
  },

  onResolveConflict() {
    c2cAttendanceStore.resolveConflict();
    this.sync();
  },

  onConfirmUnknownResult() {
    c2cAttendanceStore.confirmUnknownResult();
    this.sync();
  },

  onHeaderBack() { returnToScenario(); },
  onReturnScenario() { returnToScenario(); },
  onBlockTouchMove() {},
});
