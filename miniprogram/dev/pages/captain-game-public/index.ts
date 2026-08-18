import { CAPTAIN_OPEN_GAME_FIXTURE, buildCaptainOpenGameView, resolveCaptainOpenGameState } from "../../captain-open-game-fixture";
import { captainOpenGameStore } from "../../captain-open-game-fixture";
import { readIntentHeaderLayout } from "../../intent-header-layout";

interface Options { from?: unknown; state?: unknown; }
const managerState = (value: unknown) => value === "DRAFT" ? "DRAFT" : "PUBLISHED";
const patch = (state: ReturnType<typeof resolveCaptainOpenGameState>, sourceState: "DRAFT" | "PUBLISHED") => {
  const view = buildCaptainOpenGameView(state);
  return { ...view, ...view.public, form: captainOpenGameStore.current().snapshot, fixtureNotice: CAPTAIN_OPEN_GAME_FIXTURE.notice, sourceState };
};

Page({
  data: { ...patch("PUBLISHED", "PUBLISHED"), headerTopPx: 0, headerRowHeightPx: 44, headerRightInsetPx: 0, headerLeftInsetPx: 0 },
  onLoad(options: Options = {}) {
    const sourceState = managerState(options.from);
    const header = readIntentHeaderLayout();
    const current = captainOpenGameStore.current();
    if (!["DRAFT", "PUBLISHED", "CANCELLED"].includes(current.state)) captainOpenGameStore.reset(resolveCaptainOpenGameState(options.state ?? sourceState));
    const currentState = captainOpenGameStore.current().state;
    this.setData({ ...patch(currentState === "CANCELLED" ? sourceState : currentState, sourceState), headerTopPx: header.topPx, headerRowHeightPx: header.rowHeightPx, headerRightInsetPx: header.rightInsetPx, headerLeftInsetPx: header.rightInsetPx });
  },
  onShow() {
    if (captainOpenGameStore.current().state === "CANCELLED" && this.data.visualState !== "CANCELLED") wx.reLaunch({ url: "/dev/pages/captain-game-manage/index?state=CANCELLED" });
  },
  onReturnManage() {
    const state = captainOpenGameStore.current().state === "CANCELLED" ? "CANCELLED" : this.data.sourceState;
    wx.redirectTo({ url: `/dev/pages/captain-game-manage/index?state=${state}` });
  },
  onHeaderBack() { this.onReturnManage(); },
});
