import { c2bWaitlistStore } from "../../c2b-waitlist-fixture";
import { readIntentHeaderLayout } from "../../intent-header-layout";

interface RegistrationEvent { currentTarget?: { dataset?: { registrationId?: unknown } }; }
interface ScrollEvent { detail?: { scrollTop?: unknown }; }

const projectPage = () => {
  const snapshot = c2bWaitlistStore.current();
  return {
    items: [{ ...snapshot.applicant, ...snapshot.game }],
    resultCount: 1,
    listScrollTop: snapshot.listScrollTop,
  };
};

const returnToScenario = () => {
  if (getCurrentPages().length > 1) wx.navigateBack({ delta: 1 });
  else wx.redirectTo({ url: "/dev/pages/c2b-waitlist-scenario/index" });
};

Page({
  data: {
    ...projectPage(),
    previewNotice: "C2b 开发预览 · 模拟数据",
    headerTopPx: 0,
    headerRowHeightPx: 44,
  },

  onLoad() {
    const header = readIntentHeaderLayout();
    this.setData({
      headerTopPx: header.topPx,
      headerRowHeightPx: header.rowHeightPx,
      ...projectPage(),
    });
  },

  onShow() { this.setData(projectPage()); },

  onOpenRegistration(event: RegistrationEvent) {
    const registrationId = event.currentTarget?.dataset?.registrationId;
    if (!c2bWaitlistStore.selectRegistration(registrationId)) return;
    const detail = c2bWaitlistStore.detail(registrationId);
    if (!detail) return;
    wx.navigateTo({ url: detail.applicant.detailPath });
  },

  onScroll(event: ScrollEvent) {
    const snapshot = c2bWaitlistStore.setListScrollTop(event.detail?.scrollTop);
    this.setData({ listScrollTop: snapshot.listScrollTop });
  },

  onHeaderBack() { returnToScenario(); },
});
