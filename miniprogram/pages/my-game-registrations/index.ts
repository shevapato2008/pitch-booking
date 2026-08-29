import type { OpenGameApplicationPage } from "../../domain/open-game-registration";
import {
  presentMyGameRegistration,
  type MyGameRegistrationCard,
} from "../../presentation/my-game-registrations";
import { readIntentHeaderLayout } from "../../presentation/intent-header-layout";
import { OpenGameRegistrationApiError } from "../../services/http-open-game-registration";
import { getOpenGameRegistrationSource } from "../../services/open-game-registration";

type RegistrationListStatus =
  | "LOADING"
  | "READY"
  | "AUTH_REQUIRED"
  | "LOGIN_FAILED"
  | "LOAD_ERROR";
type FirstPageRead = "INITIAL" | "REFRESH";

interface RegistrationEvent {
  readonly currentTarget?: { readonly dataset?: { readonly registrationId?: unknown } };
}

interface ScrollEvent {
  readonly detail?: { readonly scrollTop?: unknown };
}

const PAGE_LIMIT = 20;

function headerData() {
  try {
    const header = readIntentHeaderLayout();
    return { headerTopPx: header.topPx, headerRowHeightPx: header.rowHeightPx };
  } catch {
    return { headerTopPx: 0, headerRowHeightPx: 44 };
  }
}

function cardsFrom(response: OpenGameApplicationPage): readonly MyGameRegistrationCard[] {
  return response.items.map(presentMyGameRegistration);
}

function returnToDiscovery() {
  try {
    if (getCurrentPages().length > 1) {
      wx.navigateBack({ delta: 1 });
      return;
    }
  } catch {
    // A deep link without readable history uses the safe discovery route.
  }
  wx.reLaunch({ url: "/pages/game-discovery/index" });
}

Page({
  data: {
    status: "LOADING" as RegistrationListStatus,
    items: [] as readonly MyGameRegistrationCard[],
    nextCursor: null as string | null,
    sourceEmpty: false,
    resultCount: 0,
    refreshError: false,
    loadMoreError: false,
    refreshing: false,
    loadingMore: false,
    loginBusy: false,
    listScrollTop: 0,
    headerTopPx: 0,
    headerRowHeightPx: 44,
  },
  visible: true,
  generation: 0,
  initialized: false,
  boundUserId: null as string | null,
  readBusy: false,

  onLoad() {
    this.visible = true;
    this.setData(headerData());
  },

  onShow() {
    this.visible = true;
    return this.synchronizeAccount();
  },

  onHide() {
    this.visible = false;
    this.generation += 1;
    this.readBusy = false;
    this.setData({ refreshing: false, loadingMore: false, loginBusy: false });
    if (this.data.status === "LOADING") this.initialized = false;
  },

  onUnload() {
    this.visible = false;
    this.generation += 1;
    this.readBusy = false;
  },

  currentUserId(): string | null {
    try {
      return getOpenGameRegistrationSource().currentUserId();
    } catch {
      return null;
    }
  },

  activeGeneration(userId: string, generation: number): boolean {
    return this.visible
      && generation === this.generation
      && this.boundUserId === userId;
  },

  currentRequest(userId: string, generation: number): boolean {
    return this.activeGeneration(userId, generation)
      && this.currentUserId() === userId;
  },

  clearAuthority(status: RegistrationListStatus, userId: string | null) {
    this.generation += 1;
    this.readBusy = false;
    this.initialized = true;
    this.boundUserId = userId;
    this.setData({
      status,
      items: [],
      nextCursor: null,
      sourceEmpty: false,
      resultCount: 0,
      refreshError: false,
      loadMoreError: false,
      refreshing: false,
      loadingMore: false,
      loginBusy: false,
      listScrollTop: 0,
    });
  },

  enterAuthentication() {
    this.clearAuthority("AUTH_REQUIRED", null);
  },

  synchronizeAccount() {
    const userId = this.currentUserId();
    if (userId === null) {
      if (!this.initialized || this.boundUserId !== null) this.enterAuthentication();
      return;
    }
    if (!this.initialized || userId !== this.boundUserId) {
      this.clearAuthority("LOADING", userId);
      return this.loadFirstPage("INITIAL");
    }
    return;
  },

  async loadFirstPage(kind: FirstPageRead) {
    if (this.readBusy) return;
    const userId = this.boundUserId;
    if (userId === null || this.currentUserId() !== userId) {
      this.enterAuthentication();
      return;
    }
    const generation = ++this.generation;
    this.readBusy = true;
    if (kind === "INITIAL") {
      this.setData({
        status: "LOADING",
        items: [],
        nextCursor: null,
        sourceEmpty: false,
        resultCount: 0,
        refreshError: false,
        loadMoreError: false,
        refreshing: false,
        loadingMore: false,
      });
    } else {
      this.setData({ refreshing: true, refreshError: false, loadMoreError: false });
    }
    try {
      const response = await getOpenGameRegistrationSource().listMine(undefined, PAGE_LIMIT);
      if (!this.currentRequest(userId, generation)) return;
      const items = cardsFrom(response);
      this.setData({
        status: "READY",
        items,
        nextCursor: response.nextCursor,
        sourceEmpty: items.length === 0,
        resultCount: items.length,
        refreshError: false,
        loadMoreError: false,
        refreshing: false,
        loadingMore: false,
        loginBusy: false,
      });
    } catch (caught) {
      if (!this.activeGeneration(userId, generation)) return;
      if (caught instanceof OpenGameRegistrationApiError && caught.code === "AUTH_REQUIRED") {
        this.enterAuthentication();
        return;
      }
      if (!this.currentRequest(userId, generation)) return;
      if (kind === "REFRESH") {
        this.setData({ status: "READY", refreshing: false, refreshError: true });
      } else {
        this.setData({
          status: "LOAD_ERROR",
          items: [],
          nextCursor: null,
          sourceEmpty: false,
          resultCount: 0,
          refreshing: false,
          loadingMore: false,
        });
      }
    } finally {
      if (this.activeGeneration(userId, generation)) this.readBusy = false;
    }
  },

  onRetry() {
    if (this.data.status !== "LOAD_ERROR") return;
    return this.loadFirstPage("INITIAL");
  },

  onRefresh() {
    if (this.data.status !== "READY") return;
    return this.loadFirstPage("REFRESH");
  },

  async onLoadMore() {
    if (this.data.status !== "READY" || this.readBusy || this.data.nextCursor === null) return;
    const userId = this.boundUserId;
    if (userId === null || this.currentUserId() !== userId) {
      this.enterAuthentication();
      return;
    }
    const cursor = this.data.nextCursor;
    const generation = ++this.generation;
    this.readBusy = true;
    this.setData({ loadingMore: true, loadMoreError: false, refreshError: false });
    try {
      const response = await getOpenGameRegistrationSource().listMine(cursor, PAGE_LIMIT);
      if (!this.currentRequest(userId, generation)) return;
      const seen = new Set(this.data.items.map(({ registrationId }) => registrationId));
      const appended = cardsFrom(response).filter(({ registrationId }) => {
        if (seen.has(registrationId)) return false;
        seen.add(registrationId);
        return true;
      });
      const items = [...this.data.items, ...appended];
      this.setData({
        items,
        nextCursor: response.nextCursor,
        sourceEmpty: items.length === 0,
        resultCount: items.length,
        loadMoreError: false,
        loadingMore: false,
      });
    } catch (caught) {
      if (!this.activeGeneration(userId, generation)) return;
      if (caught instanceof OpenGameRegistrationApiError && caught.code === "AUTH_REQUIRED") {
        this.enterAuthentication();
        return;
      }
      if (!this.currentRequest(userId, generation)) return;
      this.setData({ loadMoreError: true, loadingMore: false });
    } finally {
      if (this.activeGeneration(userId, generation)) this.readBusy = false;
    }
  },

  async onLogin() {
    if ((this.data.status !== "AUTH_REQUIRED" && this.data.status !== "LOGIN_FAILED")
      || this.data.loginBusy) return;
    const generation = ++this.generation;
    this.setData({ loginBusy: true });
    try {
      const userId = await getOpenGameRegistrationSource().login();
      if (!this.visible || generation !== this.generation) return;
      if (this.currentUserId() !== userId) throw new OpenGameRegistrationApiError("LOGIN_FAILED");
      this.clearAuthority("LOADING", userId);
      await this.loadFirstPage("INITIAL");
    } catch {
      if (!this.visible || generation !== this.generation) return;
      this.boundUserId = null;
      this.initialized = true;
      this.setData({ status: "LOGIN_FAILED", loginBusy: false });
    }
  },

  onOpenRegistration(event: RegistrationEvent) {
    if (this.data.status !== "READY") return;
    const registrationId = event.currentTarget?.dataset?.registrationId;
    if (typeof registrationId !== "string") return;
    const registration = this.data.items.find((item) => item.registrationId === registrationId);
    if (registration) wx.navigateTo({ url: registration.detailPath });
  },

  onScroll(event: ScrollEvent) {
    const scrollTop = Number(event.detail?.scrollTop);
    if (!Number.isFinite(scrollTop)) return;
    this.setData({ listScrollTop: Math.max(0, scrollTop) });
  },

  onOpenDiscovery() {
    returnToDiscovery();
  },

  onHeaderBack() {
    returnToDiscovery();
  },
});
