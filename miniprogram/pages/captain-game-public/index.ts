import type { OpenGamePublic } from "../../domain/open-game";
import {
  formatCents,
  formatOpenGameDateTime,
  formatOpenGameRange,
  openGameIntensityLabel,
  openGamePositionLabel,
  openGameStateLabel,
  openGameStateReasonLabel,
  presentOpenGamePublic,
} from "../../presentation/open-game";
import { OpenGameApiError } from "../../services/http-open-game";
import { getOpenGameSource } from "../../services/open-game";

interface PageOptions { token?: unknown; game_id?: unknown; preview?: unknown; }
type PublicStatus = "LOADING" | "READY" | "LOAD_ERROR" | "AUTH_LOSS" | "NOT_FOUND";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32}$/;

function currentPages(): readonly { route?: string }[] { return getCurrentPages() as unknown as readonly { route?: string }[]; }
function hideShare(): void { try { void wx.hideShareMenu(); } catch { /* platform unavailable during teardown */ } }
function navigation(method: "redirectTo" | "reLaunch", url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = () => { if (!settled) { settled = true; resolve(); } };
    const fail = (error: unknown) => { if (!settled) { settled = true; reject(error); } };
    const options = { url, success: done, fail };
    const returned = method === "redirectTo" ? wx.redirectTo(options) : wx.reLaunch(options);
    const thenable = returned as unknown as { then?: (yes: () => void, no: (error: unknown) => void) => void };
    if (typeof thenable?.then === "function") thenable.then(done, fail);
  });
}

function blankData() {
  return {
    status: "LOADING" as PublicStatus,
    mode: "shared" as "shared" | "owner",
    state: "",
    stateLabel: "",
    stateReasonText: "",
    showReturnManage: false,
    showLogin: false,
    errorMessage: "",
    navigationError: "",
    publicGame: null as OpenGamePublic | null,
    name: "",
    teamName: "",
    venueName: "",
    pitchSummary: "",
    orderRange: "",
    peopleSummary: "",
    intensityLabel: "",
    experienceLabel: "",
    positionsLabel: "",
    aaLabel: "",
    deadlineLabel: "",
    notes: "",
    visibilityLabel: "",
  };
}

Page({
  data: blankData(),
  loadGeneration: 0,
  visible: true,
  routeToken: "",
  routeGameId: "",
  skipNextShow: false,

  onLoad(options: PageOptions = {}) {
    this.visible = true;
    this.skipNextShow = true;
    hideShare();
    const shared = typeof options.token === "string" && TOKEN_PATTERN.test(options.token)
      && options.game_id === undefined && options.preview === undefined;
    const owner = typeof options.game_id === "string" && UUID_PATTERN.test(options.game_id)
      && options.preview === "1" && options.token === undefined;
    if (shared === owner) {
      this.setData({ ...blankData(), status: "NOT_FOUND", showLogin: false, showReturnManage: false, errorMessage: "链接不存在或已失效。" });
      return;
    }
    if (shared) {
      this.routeToken = options.token as string; this.routeGameId = "";
      this.setData({ ...blankData(), mode: "shared", showReturnManage: false, showLogin: false });
    } else {
      this.routeGameId = options.game_id as string; this.routeToken = "";
      this.setData({ ...blankData(), mode: "owner", showReturnManage: true, showLogin: false });
    }
    void this.loadPublic();
  },
  onShow() {
    if (this.skipNextShow) { this.skipNextShow = false; return; }
    this.visible = true;
    if (this.routeToken || this.routeGameId) void this.loadPublic();
  },
  onHide() { this.visible = false; this.loadGeneration += 1; },
  onUnload() { this.visible = false; this.loadGeneration += 1; },

  async loadPublic() {
    const generation = ++this.loadGeneration;
    this.setData({ status: "LOADING", errorMessage: "", navigationError: "", showLogin: false });
    try {
      const source = getOpenGameSource();
      const game = this.data.mode === "shared"
        ? await source.getSharedGame(this.routeToken)
        : (await source.getOwnedGame(this.routeGameId)).publicView;
      if (!this.visible || generation !== this.loadGeneration) return;
      this.applyPublic(game);
    } catch (caught) {
      if (!this.visible || generation !== this.loadGeneration) return;
      if (caught instanceof OpenGameApiError && caught.code === "OPEN_GAME_NOT_FOUND") {
        this.setData({ status: "NOT_FOUND", showLogin: false, errorMessage: "链接不存在或已失效。" });
      } else if (this.data.mode === "owner" && caught instanceof OpenGameApiError && caught.code === "AUTH_REQUIRED") {
        this.setData({ status: "AUTH_LOSS", showLogin: true, errorMessage: "登录状态已失效，请重新登录。" });
      } else {
        this.setData({ status: "LOAD_ERROR", showLogin: false, errorMessage: "暂时无法加载球局，请稍后重试。" });
      }
    }
  },

  applyPublic(game: OpenGamePublic) {
    const publicGame = presentOpenGamePublic(game);
    this.setData({
      status: "READY", state: publicGame.state, stateLabel: openGameStateLabel(publicGame.state),
      stateReasonText: openGameStateReasonLabel(publicGame.stateReason), publicGame,
      showLogin: false, showReturnManage: this.data.mode === "owner", errorMessage: "",
      name: publicGame.name, teamName: publicGame.teamName, venueName: publicGame.venueName,
      pitchSummary: `${publicGame.pitchName} · ${publicGame.pitchSpecification}`,
      orderRange: formatOpenGameRange(publicGame.startsAt, publicGame.endsAt, publicGame.timeZone),
      peopleSummary: `计划 ${publicGame.totalPlayers} 人 · 固定 ${publicGame.fixedPlayers} 人 · 开放 ${publicGame.openSpots} 人`,
      intensityLabel: openGameIntensityLabel(publicGame.intensity),
      experienceLabel: publicGame.minimumExperience || "无最低经验要求",
      positionsLabel: publicGame.positions.map(openGamePositionLabel).join("、"),
      aaLabel: formatCents(publicGame.aaCents),
      deadlineLabel: formatOpenGameDateTime(publicGame.registrationDeadline, publicGame.timeZone),
      notes: publicGame.equipmentAndArrivalNotes || "无额外说明",
      visibilityLabel: publicGame.visibility === "PUBLIC" ? "公开可见" : "仅链接可见",
    });
  },

  onRetry() { this.visible = true; void this.loadPublic(); },
  async onLogin() {
    if (this.data.mode !== "owner") return;
    try { await getOpenGameSource().login(); this.onRetry(); }
    catch { this.setData({ status: "AUTH_LOSS", showLogin: true, errorMessage: "登录失败，请重试。" }); }
  },

  onHeaderBack() {
    if (this.data.mode === "owner") { void this.returnManage(); return; }
    if (currentPages().length > 1) wx.navigateBack({ delta: 1 });
    else wx.reLaunch({ url: "/pages/intent-entry/index" });
  },
  onReturnManage() { if (this.data.mode === "owner") return this.returnManage(); return Promise.resolve(); },
  async returnManage() {
    const previous = currentPages()[currentPages().length - 2];
    if (previous?.route === "pages/captain-game-manage/index") { wx.navigateBack({ delta: 1 }); return; }
    const url = `/pages/captain-game-manage/index?game_id=${this.routeGameId}`;
    try { await navigation("redirectTo", url); }
    catch {
      try { await navigation("reLaunch", url); }
      catch { this.setData({ navigationError: "暂时无法返回管理页，请重试。" }); }
    }
  },
});
