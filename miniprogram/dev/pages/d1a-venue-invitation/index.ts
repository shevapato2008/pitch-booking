import { readIntentHeaderLayout } from "../../intent-header-layout";
import {
  D1A_INVITATION_FIXTURE,
  readD1aInvitationView,
  type D1aInvitationState,
} from "../../d1a-venue-invitation-fixture";

interface InvitationOptions { state?: string }

function goBack(): void {
  if (getCurrentPages().length > 1) wx.navigateBack({ delta: 1 });
  else wx.reLaunch({ url: "/pages/intent-entry/index" });
}

Page({
  data: {
    fixture: D1A_INVITATION_FIXTURE,
    view: readD1aInvitationView("ready"),
    busy: false,
    headerTopPx: 0,
    headerRowHeightPx: 44,
  },

  onLoad(options: InvitationOptions = {}) {
    const header = readIntentHeaderLayout();
    wx.hideShareMenu();
    this.setData({
      view: readD1aInvitationView(options.state),
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
      this.setData({ view: readD1aInvitationView("claimed"), busy: false });
    }, 260);
  },

  onContinueClaim() {
    if (this.data.busy || this.data.view.actionKind !== "claim") return;
    wx.navigateTo({ url: "/dev/pages/venue-claim/index?invitation=d1a-preview&venueId=10000000-0000-4000-8000-000000000001" });
  },

  onOpenApplications() {
    if (this.data.view.actionKind !== "applications") return;
    wx.navigateTo({ url: "/dev/pages/venue-access/index?case=pending" });
  },

  onRetry() {
    if (this.data.view.actionKind !== "retry") return;
    this.setData({ view: readD1aInvitationView("ready") });
  },

  onPrimaryAction() {
    const action = this.data.view.actionKind;
    if (action === "accept") this.onAcceptInvitation();
    else if (action === "claim") this.onContinueClaim();
    else if (action === "applications") this.onOpenApplications();
    else this.onRetry();
  },

  onHeaderBack() { goBack(); },

  setPreviewState(state: D1aInvitationState) {
    this.setData({ view: readD1aInvitationView(state), busy: false });
  },
});
