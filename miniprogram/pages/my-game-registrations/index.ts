import type {
  OpenGameApplicationPage,
  OpenGameAttendanceStatus,
  OpenGameRegistrationEffectiveStatus,
} from "../../domain/open-game-registration";
import {
  patchMyGameRegistrationStatus,
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
type FirstPageRead = "INITIAL" | "REFRESH" | "RESUME";

interface RegistrationEvent {
  readonly currentTarget?: { readonly dataset?: { readonly registrationId?: unknown } };
}

interface ScrollEvent {
  readonly detail?: { readonly scrollTop?: unknown };
}

interface RegistrationAuthorityPatch {
  readonly originatingUserId: string;
  readonly registrationId: string;
  readonly effectiveStatus: OpenGameRegistrationEffectiveStatus;
  readonly waitlistPosition: number | null;
  readonly waitlistedAt: string | null;
  readonly promotedAt: string | null;
  readonly attendanceStatus: OpenGameAttendanceStatus | null;
  readonly attendanceRecordedAt: string | null;
  readonly attendanceCorrectedAt: string | null;
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
  loadedBeyondFirstPage: false,

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

  resynchronizeVisibleAccount(userId: string, generation: number): Promise<void> | null {
    if (!this.activeGeneration(userId, generation)) return null;
    const currentUserId = this.currentUserId();
    if (currentUserId === userId) return null;
    if (currentUserId === null) {
      this.enterAuthentication();
      return Promise.resolve();
    }
    this.clearAuthority("LOADING", currentUserId);
    return this.loadFirstPage("INITIAL");
  },

  clearAuthority(status: RegistrationListStatus, userId: string | null) {
    this.generation += 1;
    this.readBusy = false;
    this.initialized = true;
    this.boundUserId = userId;
    this.loadedBeyondFirstPage = false;
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
    return this.loadFirstPage(this.data.status === "READY" ? "RESUME" : "INITIAL");
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
      const resynchronization = this.resynchronizeVisibleAccount(userId, generation);
      if (resynchronization !== null) {
        await resynchronization;
        return;
      }
      if (!this.currentRequest(userId, generation)) return;
      const freshItems = cardsFrom(response);
      const preserveLoadedTail = kind === "RESUME" && this.loadedBeyondFirstPage;
      const freshIds = new Set(freshItems.map(({ registrationId }) => registrationId));
      const preservedTail = preserveLoadedTail
        ? this.data.items.filter(({ registrationId }) => (
          !freshIds.has(registrationId)
        ))
        : [];
      const items = [...freshItems, ...preservedTail];
      const nextCursor = preserveLoadedTail ? this.data.nextCursor : response.nextCursor;
      if (!preserveLoadedTail) this.loadedBeyondFirstPage = false;
      this.setData({
        status: "READY",
        items,
        nextCursor,
        sourceEmpty: items.length === 0,
        resultCount: items.length,
        refreshError: false,
        loadMoreError: false,
        refreshing: false,
        loadingMore: false,
        loginBusy: false,
      });
    } catch (caught) {
      const resynchronization = this.resynchronizeVisibleAccount(userId, generation);
      if (resynchronization !== null) {
        await resynchronization;
        return;
      }
      if (!this.activeGeneration(userId, generation)) return;
      if (caught instanceof OpenGameRegistrationApiError && caught.code === "AUTH_REQUIRED") {
        this.enterAuthentication();
        return;
      }
      if (!this.currentRequest(userId, generation)) return;
      if (kind !== "INITIAL") {
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
    if (this.currentUserId() !== this.boundUserId) return this.synchronizeAccount();
    return this.loadFirstPage("INITIAL");
  },

  onRefresh() {
    if (this.data.status !== "READY") return;
    if (this.currentUserId() !== this.boundUserId) return this.synchronizeAccount();
    return this.loadFirstPage("REFRESH");
  },

  async onLoadMore() {
    if (this.data.status !== "READY" || this.readBusy || this.data.nextCursor === null) return;
    const userId = this.boundUserId;
    if (userId === null) {
      this.enterAuthentication();
      return;
    }
    if (this.currentUserId() !== userId) return this.synchronizeAccount();
    const cursor = this.data.nextCursor;
    const generation = ++this.generation;
    this.readBusy = true;
    this.setData({ loadingMore: true, loadMoreError: false, refreshError: false });
    try {
      const response = await getOpenGameRegistrationSource().listMine(cursor, PAGE_LIMIT);
      const resynchronization = this.resynchronizeVisibleAccount(userId, generation);
      if (resynchronization !== null) {
        await resynchronization;
        return;
      }
      if (!this.currentRequest(userId, generation)) return;
      const seen = new Set(this.data.items.map(({ registrationId }) => registrationId));
      const appended = cardsFrom(response).filter(({ registrationId }) => {
        if (seen.has(registrationId)) return false;
        seen.add(registrationId);
        return true;
      });
      const items = [...this.data.items, ...appended];
      this.loadedBeyondFirstPage = true;
      this.setData({
        items,
        nextCursor: response.nextCursor,
        sourceEmpty: items.length === 0,
        resultCount: items.length,
        loadMoreError: false,
        loadingMore: false,
      });
    } catch (caught) {
      const resynchronization = this.resynchronizeVisibleAccount(userId, generation);
      if (resynchronization !== null) {
        await resynchronization;
        return;
      }
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
      const currentUserId = this.currentUserId();
      if (currentUserId !== userId) {
        if (currentUserId === null) throw new OpenGameRegistrationApiError("LOGIN_FAILED");
        await this.synchronizeAccount();
        return;
      }
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
    if (this.currentUserId() !== this.boundUserId) return this.synchronizeAccount();
    const registrationId = event.currentTarget?.dataset?.registrationId;
    if (typeof registrationId !== "string") return;
    const registration = this.data.items.find((item) => item.registrationId === registrationId);
    if (registration) wx.navigateTo({ url: registration.detailPath });
  },

  applyRegistrationAuthority(patch: RegistrationAuthorityPatch): boolean {
    if (this.data.status !== "READY"
      || this.boundUserId === null
      || patch.originatingUserId !== this.boundUserId
      || this.currentUserId() !== this.boundUserId) return false;
    const index = this.data.items.findIndex(
      ({ registrationId }) => registrationId === patch.registrationId,
    );
    if (index < 0) return false;
    const items = [...this.data.items];
    const attendanceStatus = patch.attendanceStatus === undefined
      ? items[index].attendanceStatus
      : patch.attendanceStatus;
    const attendanceRecordedAt = patch.attendanceRecordedAt === undefined
      ? items[index].attendanceRecordedAt
      : patch.attendanceRecordedAt;
    const attendanceCorrectedAt = patch.attendanceCorrectedAt === undefined
      ? items[index].attendanceCorrectedAt
      : patch.attendanceCorrectedAt;
    items[index] = patchMyGameRegistrationStatus(items[index], {
      effectiveStatus: patch.effectiveStatus,
      waitlistPosition: patch.waitlistPosition,
      waitlistedAt: patch.waitlistedAt,
      promotedAt: patch.promotedAt,
      attendanceStatus,
      attendanceRecordedAt,
      attendanceCorrectedAt,
    });
    this.setData({ items });
    return true;
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
