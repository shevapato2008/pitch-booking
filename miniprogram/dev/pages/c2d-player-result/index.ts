import {
  C2D_ATTENDANCE_CORRECTION_FIXTURE,
  C2D_PLAYER_READBACK,
  copyC2dRegistrationId,
} from "../../c2d-attendance-correction-fixture";
import { readIntentHeaderLayout } from "../../intent-header-layout";

const scenarioRoute = "/dev/pages/c2d-attendance-correction-scenario/index";

function returnToScenario(): void {
  if (getCurrentPages().length > 1) wx.navigateBack({ delta: 1 });
  else wx.redirectTo({ url: scenarioRoute });
}

Page({
  data: {
    fixtureNotice: C2D_ATTENDANCE_CORRECTION_FIXTURE.notice,
    registration: C2D_PLAYER_READBACK,
    copyFeedbackKind: "idle",
    copyFeedback: "",
    headerTopPx: 0,
    headerRowHeightPx: 44,
  },

  onLoad() {
    const header = readIntentHeaderLayout();
    wx.hideShareMenu();
    this.setData({
      headerTopPx: header.topPx,
      headerRowHeightPx: header.rowHeightPx,
    });
  },

  onCopyRegistrationId() {
    copyC2dRegistrationId(C2D_PLAYER_READBACK.registrationId, (feedback) => {
      this.setData({
        copyFeedbackKind: feedback.kind,
        copyFeedback: feedback.message,
      });
    });
  },

  onHeaderBack() { returnToScenario(); },
});
