import { c1aPlayerApplicationStore, type C1aBranch } from "../../c1a-player-application-fixture";
import { readIntentHeaderLayout } from "../../intent-header-layout";

const applicantRoute = "/dev/pages/c1a-game-public/index";
const captainRoute = "/dev/pages/c1a-captain-applications/index";

const patch = () => {
  const snapshot = c1aPlayerApplicationStore.current();
  return {
    ...snapshot,
    roleLabel: snapshot.viewerRole === "CAPTAIN" ? "队长视角" : "申请人视角",
    loginLabel: snapshot.authenticated ? "已进入隔离登录态" : "未登录申请人",
    branchLabel: snapshot.branch === "ACCEPT" ? "接受分支" : "婉拒分支",
  };
};

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
    const header = readIntentHeaderLayout();
    this.setData({
      ...patch(),
      headerTopPx: header.topPx,
      headerRowHeightPx: header.rowHeightPx,
      headerRightInsetPx: header.rightInsetPx,
      headerLeftInsetPx: header.rightInsetPx,
    });
  },
  onShow() { this.sync(); },
  resetAndOpen(branch: C1aBranch) {
    c1aPlayerApplicationStore.reset(branch);
    this.sync();
    wx.navigateTo({ url: applicantRoute });
  },
  onResetAccept() { this.resetAndOpen("ACCEPT"); },
  onResetReject() { this.resetAndOpen("REJECT"); },
  onOpenApplicant() {
    c1aPlayerApplicationStore.setViewerRole("APPLICANT");
    this.sync();
    wx.navigateTo({ url: applicantRoute });
  },
  onOpenCaptain() {
    c1aPlayerApplicationStore.setViewerRole("CAPTAIN");
    c1aPlayerApplicationStore.login();
    this.sync();
    wx.navigateTo({ url: captainRoute });
  },
});
