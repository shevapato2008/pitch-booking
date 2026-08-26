import { c1bGameDiscoveryStore } from "../../c1b-game-discovery-fixture";
import { readIntentHeaderLayout } from "../../intent-header-layout";

interface DetailQuery { gameId?: unknown; }

const decodeGameId = (value: unknown): string => {
  if (typeof value !== "string") return "";
  try { return decodeURIComponent(value); } catch { return ""; }
};

const returnToDirectory = () => {
  const pages = getCurrentPages() as unknown as readonly { route?: string }[];
  const previous = pages[pages.length - 2];
  if (previous?.route === "dev/pages/c1b-game-discovery/index") wx.navigateBack({ delta: 1 });
  else wx.redirectTo({ url: "/dev/pages/c1b-game-discovery/index" });
};

Page({
  data: {
    gameId: "",
    game: null as ReturnType<typeof c1bGameDiscoveryStore.detail>,
    notFound: true,
    headerTopPx: 0,
    headerRowHeightPx: 44,
  },

  onLoad(query: DetailQuery = {}) {
    const header = readIntentHeaderLayout();
    const gameId = decodeGameId(query.gameId);
    const game = c1bGameDiscoveryStore.detail(gameId);
    this.setData({ gameId, game, notFound: game === null, headerTopPx: header.topPx, headerRowHeightPx: header.rowHeightPx });
  },

  onShow() {
    const game = c1bGameDiscoveryStore.detail(this.data.gameId);
    this.setData({ game, notFound: game === null });
  },

  onHeaderBack() { returnToDirectory(); },
  onReturnList() { returnToDirectory(); },
});
