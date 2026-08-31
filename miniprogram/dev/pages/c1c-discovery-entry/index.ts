import { c1bGameDiscoveryStore } from "../../c1b-game-discovery-fixture";
import { c1cMyGameRegistrationsStore } from "../../c1c-my-game-registrations-fixture";
import { readIntentHeaderLayout } from "../../intent-header-layout";

interface DateEvent { currentTarget?: { dataset?: { value?: unknown } }; }
interface FormatEvent { detail?: { value?: unknown }; }
interface GameEvent { currentTarget?: { dataset?: { gameId?: unknown } }; }
interface ScrollEvent { detail?: { scrollTop?: unknown }; }
interface DetailQuery { gameId?: unknown; }

const decodeGameId = (value: unknown): string => {
  if (typeof value !== "string") return "";
  try { return decodeURIComponent(value); } catch { return ""; }
};

const projectPage = () => {
  const directory = c1bGameDiscoveryStore.current();
  const registrations = c1cMyGameRegistrationsStore.current();
  const selectedFormatIndex = Math.max(0, directory.formatOptions.findIndex(({ value }) => value === directory.filters.format));
  return {
    status: directory.status,
    filters: directory.filters,
    dateOptions: directory.dateOptions,
    formatOptions: directory.formatOptions,
    selectedFormatIndex,
    selectedFormatLabel: directory.formatOptions[selectedFormatIndex]?.label ?? "全部人制",
    games: directory.games,
    resultCount: directory.games.length,
    sourceEmpty: directory.sourceEmpty,
    filterNoMatch: directory.filterNoMatch,
    entryScrollTop: registrations.entryScrollTop,
  };
};

const returnFromEntry = () => {
  if (getCurrentPages().length > 1) wx.navigateBack({ delta: 1 });
  else wx.redirectTo({ url: "/dev/pages/c1c-scenario/index" });
};

const returnFromDetail = () => {
  const pages = getCurrentPages() as unknown as readonly { route?: string }[];
  const previous = pages[pages.length - 2];
  if (previous?.route === "dev/pages/c1c-discovery-entry/index") wx.navigateBack({ delta: 1 });
  else wx.redirectTo({ url: "/dev/pages/c1c-discovery-entry/index" });
};

Page({
  data: {
    ...projectPage(),
    previewNotice: "C1c 开发预览 · 模拟数据",
    detailMode: false,
    detailGameId: "",
    detailGame: null as ReturnType<typeof c1bGameDiscoveryStore.detail>,
    detailNotFound: false,
    headerTopPx: 0,
    headerRowHeightPx: 44,
  },

  onLoad(query: DetailQuery = {}) {
    const header = readIntentHeaderLayout();
    const detailMode = query.gameId !== undefined;
    if (detailMode) {
      const detailGameId = decodeGameId(query.gameId);
      const detailGame = c1bGameDiscoveryStore.detail(detailGameId);
      this.setData({
        detailMode,
        detailGameId,
        detailGame,
        detailNotFound: detailGame === null,
        headerTopPx: header.topPx,
        headerRowHeightPx: header.rowHeightPx,
      });
      return;
    }
    this.setData({
      detailMode: false,
      detailGameId: "",
      detailGame: null,
      detailNotFound: false,
      headerTopPx: header.topPx,
      headerRowHeightPx: header.rowHeightPx,
      ...projectPage(),
    });
  },

  onShow() {
    if (this.data.detailMode) {
      const detailGame = c1bGameDiscoveryStore.detail(this.data.detailGameId);
      this.setData({ detailGame, detailNotFound: detailGame === null });
      return;
    }
    this.setData(projectPage());
  },

  onSelectDate(event: DateEvent) {
    c1bGameDiscoveryStore.setDateFilter(event.currentTarget?.dataset?.value);
    this.setData(projectPage());
  },

  onFormatChange(event: FormatEvent) {
    const index = Number(event.detail?.value);
    const option = Number.isInteger(index) ? c1bGameDiscoveryStore.current().formatOptions[index] : undefined;
    if (option) c1bGameDiscoveryStore.setFormatFilter(option.value);
    this.setData(projectPage());
  },

  onToggleAvailable() {
    c1bGameDiscoveryStore.toggleAvailableOnly();
    this.setData(projectPage());
  },

  onClearFilters() {
    c1bGameDiscoveryStore.clearFilters();
    this.setData(projectPage());
  },

  onRetry() {
    c1bGameDiscoveryStore.retry();
    this.setData(projectPage());
  },

  onOpenGame(event: GameEvent) {
    const gameId = event.currentTarget?.dataset?.gameId;
    if (!c1bGameDiscoveryStore.selectGame(gameId) || typeof gameId !== "string") return;
    wx.navigateTo({ url: `/dev/pages/c1c-discovery-entry/index?gameId=${encodeURIComponent(gameId)}` });
  },

  onOpenMyRegistrations() {
    wx.navigateTo({ url: "/dev/pages/c1c-my-registrations/index" });
  },

  onScroll(event: ScrollEvent) {
    const snapshot = c1cMyGameRegistrationsStore.setEntryScrollTop(event.detail?.scrollTop);
    this.setData({ entryScrollTop: snapshot.entryScrollTop });
  },

  onReturnEntry() { returnFromDetail(); },
  onReturnIntent() { wx.reLaunch({ url: "/pages/intent-entry/index" }); },
  onHeaderBack() {
    if (this.data.detailMode) returnFromDetail();
    else returnFromEntry();
  },
});
