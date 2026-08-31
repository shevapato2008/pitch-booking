import { c1bGameDiscoveryStore } from "../../c1b-game-discovery-fixture";
import { readIntentHeaderLayout } from "../../intent-header-layout";

interface DateEvent { currentTarget?: { dataset?: { value?: unknown } }; }
interface FormatEvent { detail?: { value?: unknown }; }
interface GameEvent { currentTarget?: { dataset?: { gameId?: unknown } }; }

const projectPage = () => {
  const snapshot = c1bGameDiscoveryStore.current();
  const selectedFormatIndex = Math.max(0, snapshot.formatOptions.findIndex(({ value }) => value === snapshot.filters.format));
  return {
    status: snapshot.status,
    filters: snapshot.filters,
    dateOptions: snapshot.dateOptions,
    formatOptions: snapshot.formatOptions,
    selectedFormatIndex,
    selectedFormatLabel: snapshot.formatOptions[selectedFormatIndex]?.label ?? "全部人制",
    games: snapshot.games,
    resultCount: snapshot.games.length,
    sourceEmpty: snapshot.sourceEmpty,
    filterNoMatch: snapshot.filterNoMatch,
  };
};

const returnFromDirectory = () => {
  if (getCurrentPages().length > 1) wx.navigateBack({ delta: 1 });
  else wx.redirectTo({ url: "/dev/pages/c1b-scenario/index" });
};

Page({
  data: {
    ...projectPage(),
    previewNotice: "C1b 开发预览 · 模拟数据",
    headerTopPx: 0,
    headerRowHeightPx: 44,
  },

  onLoad() {
    const header = readIntentHeaderLayout();
    this.setData({ headerTopPx: header.topPx, headerRowHeightPx: header.rowHeightPx, ...projectPage() });
  },

  onShow() { this.setData(projectPage()); },

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
    wx.navigateTo({ url: `/dev/pages/c1b-game-detail/index?gameId=${encodeURIComponent(gameId)}` });
  },

  onReturnIntent() { wx.reLaunch({ url: "/pages/intent-entry/index" }); },
  onHeaderBack() { returnFromDirectory(); },
});
