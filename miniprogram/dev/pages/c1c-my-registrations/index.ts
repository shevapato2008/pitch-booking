import {
  c1cMyGameRegistrationsStore,
  type C1cReadOutcome,
} from "../../c1c-my-game-registrations-fixture";
import { readIntentHeaderLayout } from "../../intent-header-layout";

interface OutcomeEvent { currentTarget?: { dataset?: { outcome?: unknown } }; }
interface RegistrationEvent { currentTarget?: { dataset?: { registrationId?: unknown } }; }
interface ScrollEvent { detail?: { scrollTop?: unknown }; }

const readOutcome = (event?: OutcomeEvent): C1cReadOutcome => (
  event?.currentTarget?.dataset?.outcome === "ERROR" ? "ERROR" : "SUCCESS"
);

const projectPage = () => {
  const snapshot = c1cMyGameRegistrationsStore.current();
  return {
    status: snapshot.status,
    sourceEmpty: snapshot.sourceEmpty,
    items: snapshot.items,
    nextCursor: snapshot.nextCursor,
    refreshError: snapshot.refreshError,
    loadMoreError: snapshot.loadMoreError,
    listScrollTop: snapshot.listScrollTop,
    resultCount: snapshot.items.length,
  };
};

const returnToDiscovery = () => {
  if (getCurrentPages().length > 1) wx.navigateBack({ delta: 1 });
  else wx.redirectTo({ url: "/dev/pages/c1c-discovery-entry/index" });
};

Page({
  data: {
    ...projectPage(),
    previewNotice: "C1c 开发预览 · 模拟数据",
    headerTopPx: 0,
    headerRowHeightPx: 44,
  },

  onLoad() {
    const header = readIntentHeaderLayout();
    this.setData({ headerTopPx: header.topPx, headerRowHeightPx: header.rowHeightPx, ...projectPage() });
  },

  onShow() { this.setData(projectPage()); },

  onRetry() {
    c1cMyGameRegistrationsStore.retry();
    this.setData(projectPage());
  },

  onRefresh(event?: OutcomeEvent) {
    c1cMyGameRegistrationsStore.refresh(readOutcome(event));
    this.setData(projectPage());
  },

  onLoadMore(event?: OutcomeEvent) {
    c1cMyGameRegistrationsStore.loadMore(readOutcome(event));
    this.setData(projectPage());
  },

  onOpenRegistration(event: RegistrationEvent) {
    const registrationId = event.currentTarget?.dataset?.registrationId;
    if (!c1cMyGameRegistrationsStore.selectRegistration(registrationId)) return;
    const registration = c1cMyGameRegistrationsStore.detail(registrationId);
    if (!registration) return;
    wx.navigateTo({ url: registration.detailPath });
  },

  onScroll(event: ScrollEvent) {
    const snapshot = c1cMyGameRegistrationsStore.setListScrollTop(event.detail?.scrollTop);
    this.setData({ listScrollTop: snapshot.listScrollTop });
  },

  onOpenDiscovery() { wx.redirectTo({ url: "/dev/pages/c1c-discovery-entry/index" }); },
  onHeaderBack() { returnToDiscovery(); },
});
