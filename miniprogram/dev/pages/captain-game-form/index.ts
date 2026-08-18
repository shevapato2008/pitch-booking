import {
  CAPTAIN_OPEN_GAME_FIXTURE,
  applyCaptainGameStepper,
  buildCaptainOpenGameView,
  captainOpenGameStore,
  resolveCaptainOpenGameState,
  type CaptainGameForm,
  type CaptainOpenGameState,
} from "../../captain-open-game-fixture";

interface Options { state?: unknown; }
interface StepperEvent { currentTarget?: { dataset?: { action?: unknown } }; }

const patch = (state: CaptainOpenGameState, form: CaptainGameForm = CAPTAIN_OPEN_GAME_FIXTURE.form) => {
  const view = buildCaptainOpenGameView(state);
  return { ...view, form, stepperError: "", fixtureNotice: CAPTAIN_OPEN_GAME_FIXTURE.notice };
};

Page({
  data: patch("ELIGIBLE"),
  onLoad(options: Options = {}) {
    const state = resolveCaptainOpenGameState(options.state);
    captainOpenGameStore.reset(state);
    this.setData(patch(state));
  },
  onStepper(event: StepperEvent) {
    if (!this.data.canEdit) return;
    const changed = applyCaptainGameStepper(this.data.form, event.currentTarget?.dataset?.action);
    this.setData({ form: changed.form, stepperError: changed.error });
  },
  onSave() {
    if (!this.data.canEdit) return;
    const result = captainOpenGameStore.saveDraft(this.data.form);
    this.setData({ visualState: result.state, private: result.private, published: result.published, snapshot: result.snapshot });
    wx.redirectTo({ url: "/dev/pages/captain-game-manage/index?state=DRAFT" });
  },
  onReturnOrder() { wx.navigateBack({ delta: 1 }); },
});
