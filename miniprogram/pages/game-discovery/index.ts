import type { PublicGameFormat } from "../../domain/public-game-directory";
import {
  presentPublicGameDirectoryItem,
  type PublicGameDirectoryCard,
} from "../../presentation/public-game-directory";
import { readIntentHeaderLayout } from "../../presentation/intent-header-layout";
import { getPublicGameDirectorySource } from "../../services/public-game-directory";

type DirectoryStatus = "LOADING" | "READY" | "LOAD_ERROR";
type FormatFilter = "ALL" | PublicGameFormat;

interface DirectoryFilters {
  readonly date: "ALL" | string;
  readonly format: FormatFilter;
  readonly availableOnly: boolean;
}

interface DirectoryOption<T extends string = string> {
  readonly value: T;
  readonly label: string;
}

interface DateEvent {
  readonly currentTarget?: { readonly dataset?: { readonly value?: unknown } };
}

interface FormatEvent {
  readonly detail?: { readonly value?: unknown };
}

interface GameEvent {
  readonly currentTarget?: { readonly dataset?: { readonly detailPath?: unknown } };
}

interface ScrollEvent {
  readonly detail?: { readonly scrollTop?: unknown };
}

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"] as const;
const FORMAT_OPTIONS: readonly DirectoryOption<FormatFilter>[] = [
  { value: "ALL", label: "全部人制" },
  { value: "FIVE", label: "五人制" },
  { value: "SEVEN", label: "七人制" },
];

function defaultFilters(): DirectoryFilters {
  return { date: "ALL", format: "ALL", availableOnly: false };
}

function dateOption(localDate: string): DirectoryOption {
  const [year, month, day] = localDate.split("-").map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return { value: localDate, label: `${month}/${day} ${weekday}` };
}

function dateOptions(availableDates: readonly string[]): readonly DirectoryOption[] {
  return [
    { value: "ALL", label: "全部日期" },
    ...availableDates.map(dateOption),
  ];
}

function sourceFilters(filters: DirectoryFilters) {
  return {
    ...(filters.date === "ALL" ? {} : { localDate: filters.date }),
    ...(filters.format === "ALL" ? {} : { format: filters.format }),
    ...(filters.availableOnly ? { availableOnly: true } : {}),
  };
}

function selectedFormat(filters: DirectoryFilters) {
  const index = Math.max(0, FORMAT_OPTIONS.findIndex(({ value }) => value === filters.format));
  return {
    selectedFormatIndex: index,
    selectedFormatLabel: FORMAT_OPTIONS[index]?.label ?? "全部人制",
  };
}

function headerData() {
  try {
    const header = readIntentHeaderLayout();
    return { headerTopPx: header.topPx, headerRowHeightPx: header.rowHeightPx };
  } catch {
    return { headerTopPx: 0, headerRowHeightPx: 44 };
  }
}

Page({
  data: {
    status: "LOADING" as DirectoryStatus,
    filters: defaultFilters(),
    dateOptions: dateOptions([]),
    formatOptions: FORMAT_OPTIONS,
    ...selectedFormat(defaultFilters()),
    games: [] as readonly PublicGameDirectoryCard[],
    resultCount: 0,
    sourceEmpty: false,
    filterNoMatch: false,
    headerTopPx: 0,
    headerRowHeightPx: 44,
    entryScrollTop: 0,
  },
  requestRevision: 0,
  active: true,
  preserveNextShow: false,

  onLoad() {
    this.active = true;
    this.setData(headerData());
  },

  onShow() {
    this.active = true;
    if (this.preserveNextShow && this.data.status !== "LOADING") {
      this.preserveNextShow = false;
      return;
    }
    this.preserveNextShow = false;
    return this.loadDirectory();
  },

  onHide() {
    this.active = false;
    this.requestRevision += 1;
  },

  onUnload() {
    this.active = false;
    this.requestRevision += 1;
  },

  async loadDirectory() {
    const revision = ++this.requestRevision;
    const filters = { ...this.data.filters };
    this.setData({
      status: "LOADING",
      games: [],
      resultCount: 0,
      sourceEmpty: false,
      filterNoMatch: false,
    });
    try {
      const response = await getPublicGameDirectorySource().getDirectory(sourceFilters(filters));
      if (!this.active || revision !== this.requestRevision) return;
      const games = response.items.map(presentPublicGameDirectoryItem);
      this.setData({
        status: "READY",
        dateOptions: dateOptions(response.availableDates),
        games,
        resultCount: games.length,
        sourceEmpty: response.availableDates.length === 0,
        filterNoMatch: response.availableDates.length > 0 && games.length === 0,
      });
    } catch {
      if (!this.active || revision !== this.requestRevision) return;
      this.setData({
        status: "LOAD_ERROR",
        games: [],
        resultCount: 0,
        sourceEmpty: false,
        filterNoMatch: false,
      });
    }
  },

  onSelectDate(event: DateEvent) {
    if (this.data.status === "LOADING") return;
    const date = event.currentTarget?.dataset?.value;
    if (typeof date !== "string" || !this.data.dateOptions.some(({ value }) => value === date)) return;
    const filters = { ...this.data.filters, date } as DirectoryFilters;
    this.setData({ filters });
    return this.loadDirectory();
  },

  onFormatChange(event: FormatEvent) {
    if (this.data.status === "LOADING") return;
    const index = Number(event.detail?.value);
    const option = Number.isInteger(index) ? FORMAT_OPTIONS[index] : undefined;
    if (!option) return;
    const filters = { ...this.data.filters, format: option.value } as DirectoryFilters;
    this.setData({ filters, ...selectedFormat(filters) });
    return this.loadDirectory();
  },

  onToggleAvailable() {
    if (this.data.status === "LOADING") return;
    const filters = {
      ...this.data.filters,
      availableOnly: !this.data.filters.availableOnly,
    } as DirectoryFilters;
    this.setData({ filters });
    return this.loadDirectory();
  },

  onClearFilters() {
    if (this.data.status !== "READY") return;
    const filters = defaultFilters();
    this.setData({ filters, ...selectedFormat(filters) });
    return this.loadDirectory();
  },

  onRetry() {
    if (this.data.status !== "LOAD_ERROR") return;
    return this.loadDirectory();
  },

  onOpenGame(event: GameEvent) {
    if (this.data.status !== "READY") return;
    const detailPath = event.currentTarget?.dataset?.detailPath;
    if (typeof detailPath !== "string") return;
    const game = this.data.games.find((candidate) => candidate.detailPath === detailPath);
    if (game) wx.navigateTo({ url: game.detailPath });
  },

  onOpenMyRegistrations() {
    this.preserveNextShow = true;
    wx.navigateTo({
      url: "/pages/my-game-registrations/index",
      fail: () => { this.preserveNextShow = false; },
    });
  },

  onScroll(event: ScrollEvent) {
    const scrollTop = Number(event.detail?.scrollTop);
    if (!Number.isFinite(scrollTop)) return;
    this.setData({ entryScrollTop: Math.max(0, scrollTop) });
  },

  onReturnIntent() {
    wx.reLaunch({ url: "/pages/intent-entry/index" });
  },

  onHeaderBack() {
    try {
      if (getCurrentPages().length > 1) {
        wx.navigateBack({ delta: 1 });
        return;
      }
    } catch {
      // A deep link without a readable history uses the same safe destination.
    }
    wx.reLaunch({ url: "/pages/intent-entry/index" });
  },
});
