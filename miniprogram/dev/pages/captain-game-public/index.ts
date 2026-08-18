import { CAPTAIN_OPEN_GAME_FIXTURE, buildCaptainOpenGameView, resolveCaptainOpenGameState } from "../../captain-open-game-fixture";

interface Options { from?: unknown; state?: unknown; }
const managerState = (value: unknown) => value === "DRAFT" ? "DRAFT" : "PUBLISHED";

Page({
  data: { ...buildCaptainOpenGameView("PUBLISHED"), ...buildCaptainOpenGameView("PUBLISHED").public, fixtureNotice: CAPTAIN_OPEN_GAME_FIXTURE.notice, sourceState: "PUBLISHED" },
  onLoad(options: Options = {}) {
    const sourceState = managerState(options.from);
    const visualState = resolveCaptainOpenGameState(options.state ?? sourceState);
    const view = buildCaptainOpenGameView(visualState);
    this.setData({ ...view, ...view.public, fixtureNotice: CAPTAIN_OPEN_GAME_FIXTURE.notice, sourceState });
  },
  onReturnManage() { wx.redirectTo({ url: `/dev/pages/captain-game-manage/index?state=${this.data.sourceState}` }); },
});
