import { c1cMyGameRegistrationsStore } from "../../c1c-my-game-registrations-fixture";
import { readIntentHeaderLayout } from "../../intent-header-layout";

interface DetailQuery { registrationId?: unknown; }

const decodeRegistrationId = (value: unknown): string => {
  if (typeof value !== "string") return "";
  try { return decodeURIComponent(value); } catch { return ""; }
};

const returnFromDetail = () => {
  const pages = getCurrentPages() as unknown as readonly { route?: string }[];
  const previous = pages[pages.length - 2];
  if (previous?.route === "dev/pages/c1c-my-registrations/index") wx.navigateBack({ delta: 1 });
  else wx.redirectTo({ url: "/dev/pages/c1c-discovery-entry/index" });
};

Page({
  data: {
    registrationId: "",
    registration: null as ReturnType<typeof c1cMyGameRegistrationsStore.detail>,
    notFound: true,
    previewNotice: "C1c 开发预览 · 模拟数据",
    headerTopPx: 0,
    headerRowHeightPx: 44,
  },

  onLoad(query: DetailQuery = {}) {
    const header = readIntentHeaderLayout();
    const registrationId = decodeRegistrationId(query.registrationId);
    const registration = c1cMyGameRegistrationsStore.detail(registrationId);
    this.setData({
      registrationId,
      registration,
      notFound: registration === null,
      headerTopPx: header.topPx,
      headerRowHeightPx: header.rowHeightPx,
    });
  },

  onShow() {
    const registration = c1cMyGameRegistrationsStore.detail(this.data.registrationId);
    this.setData({ registration, notFound: registration === null });
  },

  onHeaderBack() { returnFromDetail(); },
  onReturnList() { returnFromDetail(); },
});
