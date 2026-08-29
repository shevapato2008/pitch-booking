import { c2aRegistrationWithdrawalStore } from "../../c2a-registration-withdrawal-fixture";
import { readIntentHeaderLayout } from "../../intent-header-layout";

interface RegistrationEvent { currentTarget?: { dataset?: { registrationId?: unknown } }; }
interface ScrollEvent { detail?: { scrollTop?: unknown }; }

const projectPage = () => {
  const snapshot = c2aRegistrationWithdrawalStore.current();
  return {
    items: [{ ...snapshot.registration, ...snapshot.game }],
    resultCount: 1,
    listScrollTop: snapshot.listScrollTop,
  };
};

const returnToLauncher = () => {
  if (getCurrentPages().length > 1) wx.navigateBack({ delta: 1 });
  else wx.redirectTo({ url: "/dev/pages/c2a-withdrawal-scenario/index" });
};

Page({
  data: {
    ...projectPage(),
    previewNotice: "C2a 开发预览 · 模拟数据",
    headerTopPx: 0,
    headerRowHeightPx: 44,
  },

  onLoad() {
    const header = readIntentHeaderLayout();
    this.setData({ headerTopPx: header.topPx, headerRowHeightPx: header.rowHeightPx, ...projectPage() });
  },

  onShow() { this.setData(projectPage()); },

  onOpenRegistration(event: RegistrationEvent) {
    const registrationId = event.currentTarget?.dataset?.registrationId;
    if (!c2aRegistrationWithdrawalStore.selectRegistration(registrationId)) return;
    const snapshot = c2aRegistrationWithdrawalStore.detail(registrationId);
    if (!snapshot) return;
    wx.navigateTo({
      url: `/dev/pages/c2a-registration-detail/index?registrationId=${encodeURIComponent(snapshot.registration.registrationId)}`,
    });
  },

  onScroll(event: ScrollEvent) {
    const snapshot = c2aRegistrationWithdrawalStore.setListScrollTop(event.detail?.scrollTop);
    this.setData({ listScrollTop: snapshot.listScrollTop });
  },

  onHeaderBack() { returnToLauncher(); },
});
