import {
  CAPTAIN_OPEN_GAME_FIXTURE,
  applyCaptainGameStepper,
  buildCaptainOpenGameView,
  captainOpenGameStore,
  resolveCaptainOpenGameState,
  type CaptainGameForm,
  type CaptainOpenGameState,
} from "../../captain-open-game-fixture";
import { readIntentHeaderLayout } from "../../intent-header-layout";

interface Options { state?: unknown; }
interface StepperEvent { currentTarget?: { dataset?: { action?: unknown } }; }

const patch = (state: CaptainOpenGameState, form: CaptainGameForm = captainOpenGameStore.current().snapshot) => {
  const view = buildCaptainOpenGameView(state);
  const mode = state === "DRAFT" || state === "PUBLISHED" ? "edit" : "create";
  return { ...view, form, mode, pageTitle: mode === "edit" ? "编辑球局" : "创建球局", saveLabel: mode === "edit" ? "保存修改" : "保存草稿", stepperError: "", fixtureNotice: CAPTAIN_OPEN_GAME_FIXTURE.notice };
};

const returnToOrder = () => {
  if (getCurrentPages().length > 1) wx.navigateBack({ delta: 1 });
  else wx.reLaunch({ url: "/pages/my-orders/index" });
};
const returnToManager = (state: CaptainOpenGameState) => {
  const pages = getCurrentPages() as unknown as readonly { route?: string }[];
  if (pages[pages.length - 2]?.route === "dev/pages/captain-game-manage/index") wx.navigateBack({ delta: 1 });
  else wx.redirectTo({ url: `/dev/pages/captain-game-manage/index?state=${state}` });
};

Page({
  data: { ...patch("ELIGIBLE"), headerTopPx: 0, headerRowHeightPx: 44, headerRightInsetPx: 0, headerLeftInsetPx: 0 },
  onLoad(options: Options = {}) {
    const state = resolveCaptainOpenGameState(options.state);
    const header = readIntentHeaderLayout();
    if (captainOpenGameStore.current().state !== state) captainOpenGameStore.reset(state);
    this.setData({ ...patch(state, captainOpenGameStore.current().snapshot), headerTopPx: header.topPx, headerRowHeightPx: header.rowHeightPx, headerRightInsetPx: header.rightInsetPx, headerLeftInsetPx: header.rightInsetPx });
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
    returnToManager(result.state);
  },
  onReturnOrder() { returnToOrder(); },
  onHeaderBack() { returnToOrder(); },
});
