import { readIntentHeaderLayout } from "../../intent-header-layout";
import { D1B_PERMISSIONS, D1B_VENUE_STAFF_FIXTURE, readD1bInvitationView } from "../../d1b-venue-staff-fixture";

interface Options { state?: string }

function goBack(): void {
  if (getCurrentPages().length > 1) wx.navigateBack({ delta: 1 });
  else wx.reLaunch({ url: "/pages/intent-entry/index" });
}

const invitationPermissions = D1B_PERMISSIONS.filter((permission) => D1B_VENUE_STAFF_FIXTURE.invitations[0].permissions.includes(permission.code));

Page({
  data: {
    fixture: D1B_VENUE_STAFF_FIXTURE,
    permissionViews: invitationPermissions,
    view: readD1bInvitationView("invitation"),
    busy: false,
    headerTopPx: 0,
    headerRowHeightPx: 44,
  },

  onLoad(options: Options = {}) {
    const header = readIntentHeaderLayout();
    wx.hideShareMenu();
    this.setData({
      view: readD1bInvitationView(options.state),
      busy: false,
      headerTopPx: header.topPx,
      headerRowHeightPx: header.rowHeightPx,
    });
  },

  onAcceptInvitation() {
    if (this.data.busy || this.data.view.actionKind !== "accept") return;
    this.setData({ busy: true });
    wx.showLoading({ title: "正在接受", mask: true });
    setTimeout(() => {
      wx.hideLoading();
      this.setData({ view: readD1bInvitationView("accepted"), busy: false });
    }, 260);
  },

  onOpenPortfolio() {
    if (this.data.view.actionKind !== "portfolio") return;
    wx.reLaunch({ url: "/pages/venue-access/index" });
  },

  onRetry() {
    if (this.data.view.actionKind !== "retry") return;
    this.setData({ view: readD1bInvitationView("invitation"), busy: false });
  },

  onPrimaryAction() {
    if (this.data.view.actionKind === "accept") this.onAcceptInvitation();
    else if (this.data.view.actionKind === "portfolio") this.onOpenPortfolio();
    else this.onRetry();
  },

  onHeaderBack() { goBack(); },
});
