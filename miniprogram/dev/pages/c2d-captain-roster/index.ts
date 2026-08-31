import {
  C2D_ATTENDANCE_CORRECTION_FIXTURE,
  C2D_CAPTAIN_READBACK,
  copyC2dRegistrationId,
} from "../../c2d-attendance-correction-fixture";
import { readIntentHeaderLayout } from "../../intent-header-layout";

interface CopyEvent {
  currentTarget?: { dataset?: { registrationId?: unknown } };
}

const scenarioRoute = "/dev/pages/c2d-attendance-correction-scenario/index";

function returnToScenario(): void {
  if (getCurrentPages().length > 1) wx.navigateBack({ delta: 1 });
  else wx.redirectTo({ url: scenarioRoute });
}

Page({
  data: {
    fixtureNotice: C2D_ATTENDANCE_CORRECTION_FIXTURE.notice,
    game: C2D_CAPTAIN_READBACK.game,
    roster: C2D_CAPTAIN_READBACK.roster,
    copyFeedbackRegistrationId: "",
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

  onCopyRegistrationId(event: CopyEvent) {
    const requestedId = event.currentTarget?.dataset?.registrationId;
    const row = C2D_CAPTAIN_READBACK.roster.find((item) => item.registrationId === requestedId);
    if (!row) return;
    const registrationId = row.registrationId;
    copyC2dRegistrationId(registrationId, (feedback) => {
      this.setData({
        copyFeedbackRegistrationId: registrationId,
        copyFeedbackKind: feedback.kind,
        copyFeedback: feedback.message,
      });
    });
  },

  onHeaderBack() { returnToScenario(); },
});
