import {
  CAPTAIN_OPEN_GAME_FIXTURE,
  buildCaptainOpenGameView,
  captainOpenGameStore,
  resolveCaptainOpenGameState,
  type CaptainOpenGameState,
} from "../../captain-open-game-fixture";

interface Options { state?: unknown; }

const patch = (state: CaptainOpenGameState) => {
  const current = captainOpenGameStore.current();
  const view = buildCaptainOpenGameView(state);
  return { ...view, ...current, fixtureNotice: CAPTAIN_OPEN_GAME_FIXTURE.notice, shareError: "" };
};

Page({
  data: patch("DRAFT"),
  onLoad(options: Options = {}) {
    const requested = resolveCaptainOpenGameState(options.state);
    const state = requested === "ELIGIBLE" ? "DRAFT" : requested;
    if (captainOpenGameStore.current().state !== state) captainOpenGameStore.reset(state);
    this.setData(patch(state));
  },
  sync() { this.setData(patch(captainOpenGameStore.current().state)); },
  onPublish() { captainOpenGameStore.beginPublish(); this.sync(); },
  onConfirmPublish() { captainOpenGameStore.confirmPublish(); this.sync(); },
  onPreview() { wx.navigateTo({ url: `/dev/pages/captain-game-public/index?from=${this.data.visualState}` }); },
  onEdit() { wx.navigateTo({ url: `/dev/pages/captain-game-form/index?state=${this.data.visualState}` }); },
  onShare() { this.setData({ shareError: "暂时无法分享" }); },
  onClosePanel() { captainOpenGameStore.closePanel(); this.sync(); },
  onCancel() { captainOpenGameStore.beginCancel(); this.sync(); },
  onConfirmCancel() { captainOpenGameStore.confirmCancel(); this.sync(); },
  onReturnOrder() { wx.navigateBack({ delta: 1 }); },
});
