import {
  CAPTAIN_OPEN_GAME_FIXTURE,
  buildCaptainOpenGameView,
  captainOpenGameStore,
  resolveCaptainOpenGameState,
  type CaptainOpenGameState,
} from "../../captain-open-game-fixture";
import { readIntentHeaderLayout } from "../../intent-header-layout";

interface Options { state?: unknown; }
const returnToOrder = () => {
  if (getCurrentPages().length > 1) wx.navigateBack({ delta: 1 });
  else wx.reLaunch({ url: "/pages/my-orders/index" });
};

const patch = (state: CaptainOpenGameState) => {
  const current = captainOpenGameStore.current();
  const view = buildCaptainOpenGameView(state);
  return { ...view, ...current, fixtureNotice: CAPTAIN_OPEN_GAME_FIXTURE.notice, shareError: "" };
};

Page({
  data: { ...patch("DRAFT"), headerTopPx: 0, headerRowHeightPx: 44, headerRightInsetPx: 0, headerLeftInsetPx: 0 },
  onLoad(options: Options = {}) {
    const requested = resolveCaptainOpenGameState(options.state);
    const requestedSeed = requested === "ELIGIBLE" ? "DRAFT" : requested;
    const state = captainOpenGameStore.current().state === "ELIGIBLE" ? requestedSeed : captainOpenGameStore.current().state;
    const header = readIntentHeaderLayout();
    if (captainOpenGameStore.current().state === "ELIGIBLE") captainOpenGameStore.reset(state);
    this.setData({ ...patch(state), headerTopPx: header.topPx, headerRowHeightPx: header.rowHeightPx, headerRightInsetPx: header.rightInsetPx, headerLeftInsetPx: header.rightInsetPx });
  },
  onShow() {
    const current = captainOpenGameStore.current();
    this.setData(patch(current.state));
  },
  sync() { this.setData(patch(captainOpenGameStore.current().state)); },
  onPublish() { captainOpenGameStore.beginPublish(); this.sync(); },
  onConfirmPublish() { captainOpenGameStore.confirmPublish(); this.sync(); },
  onPreview() { wx.navigateTo({ url: `/dev/pages/captain-game-public/index?from=${this.data.visualState}` }); },
  onEdit() { wx.navigateTo({ url: `/dev/pages/captain-game-form/index?state=${this.data.visualState}` }); },
  onShare() { this.setData({ shareError: "暂时无法分享" }); },
  onClosePanel() { captainOpenGameStore.closePanel(); this.sync(); },
  onCancel() { captainOpenGameStore.beginCancel(); this.sync(); },
  onConfirmCancel() { captainOpenGameStore.confirmCancel(); this.sync(); wx.reLaunch({ url: "/dev/pages/captain-game-manage/index?state=CANCELLED" }); },
  onAbandon() { captainOpenGameStore.beginAbandon(); this.sync(); },
  onConfirmAbandon() { captainOpenGameStore.confirmAbandon(); this.sync(); wx.redirectTo({ url: "/dev/pages/captain-game-form/index?state=ELIGIBLE" }); },
  onReload() { captainOpenGameStore.recoverLoad(); this.sync(); },
  onReturnOrder() { returnToOrder(); },
  onHeaderBack() { returnToOrder(); },
});
