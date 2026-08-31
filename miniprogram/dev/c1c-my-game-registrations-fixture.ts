export type C1cEffectiveStatus = "APPLIED" | "JOINED" | "REJECTED" | "CANCELLED";
export type C1cGameVisibility = "PUBLIC" | "LINK_ONLY";
export type C1cScenario = "READY" | "EMPTY" | "LOAD_ERROR";
export type C1cLoadStatus = "READY" | "LOAD_ERROR";
export type C1cReadOutcome = "SUCCESS" | "ERROR";

export interface C1cRegistration {
  readonly registrationId: string;
  readonly effectiveStatus: C1cEffectiveStatus;
  readonly statusLabel: string;
  readonly visibility: C1cGameVisibility;
  readonly appliedAt: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly timeZone: "Asia/Shanghai";
  readonly gameName: string;
  readonly dateLabel: string;
  readonly timeLabel: string;
  readonly venue: string;
  readonly pitch: string;
  readonly formatLabel: string;
  readonly detailPath: string;
}

export interface C1cPage {
  readonly items: readonly C1cRegistration[];
  readonly nextCursor: string | null;
}

export interface C1cMyGameRegistrationsSnapshot extends C1cPage {
  readonly status: C1cLoadStatus;
  readonly sourceEmpty: boolean;
  readonly refreshError: boolean;
  readonly loadMoreError: boolean;
  readonly selectedRegistrationId: string | null;
  readonly entryScrollTop: number;
  readonly listScrollTop: number;
}

export interface C1cMyGameRegistrationsStore {
  current(): C1cMyGameRegistrationsSnapshot;
  reset(scenario?: C1cScenario): C1cMyGameRegistrationsSnapshot;
  retry(): C1cMyGameRegistrationsSnapshot;
  refresh(outcome?: C1cReadOutcome): C1cMyGameRegistrationsSnapshot;
  loadMore(outcome?: C1cReadOutcome): C1cMyGameRegistrationsSnapshot;
  selectRegistration(registrationId: unknown): boolean;
  detail(registrationId: unknown): C1cRegistration | null;
  setEntryScrollTop(value: unknown): C1cMyGameRegistrationsSnapshot;
  setListScrollTop(value: unknown): C1cMyGameRegistrationsSnapshot;
}

const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value as Record<string, unknown>).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};

const AUTHORITATIVE_NOW = "2026-08-29T12:00:00+08:00";
const SECOND_PAGE_CURSOR = "c1c-page-2";
const PAGE_SIZE = 2;

const sourceCatalog: readonly C1cRegistration[] = [
  {
    registrationId: "reg-joined",
    effectiveStatus: "JOINED",
    statusLabel: "已加入",
    visibility: "LINK_ONLY",
    appliedAt: "2026-08-28T18:10:00+08:00",
    startsAt: "2026-09-06T18:00:00+08:00",
    endsAt: "2026-09-06T20:00:00+08:00",
    timeZone: "Asia/Shanghai",
    gameName: "奥体周日傍晚局",
    dateLabel: "9月6日 周日",
    timeLabel: "18:00–20:00",
    venue: "天津奥体足球场",
    pitch: "七人制 A 场",
    formatLabel: "七人制",
    detailPath: "/dev/pages/c1c-registration-detail/index?registrationId=reg-joined",
  },
  {
    registrationId: "reg-cancelled",
    effectiveStatus: "CANCELLED",
    statusLabel: "球局已取消",
    visibility: "LINK_ONLY",
    appliedAt: "2026-08-10T08:20:00+08:00",
    startsAt: "2026-08-16T15:00:00+08:00",
    endsAt: "2026-08-16T17:00:00+08:00",
    timeZone: "Asia/Shanghai",
    gameName: "津南周末友谊局",
    dateLabel: "8月16日 周日",
    timeLabel: "15:00–17:00",
    venue: "天津津南体育公园",
    pitch: "七人制 B 场",
    formatLabel: "七人制",
    detailPath: "/dev/pages/c1c-registration-detail/index?registrationId=reg-cancelled",
  },
  {
    registrationId: "reg-applied",
    effectiveStatus: "APPLIED",
    statusLabel: "待队长审核",
    visibility: "PUBLIC",
    appliedAt: "2026-08-29T09:30:00+08:00",
    startsAt: "2026-09-05T09:00:00+08:00",
    endsAt: "2026-09-05T10:30:00+08:00",
    timeZone: "Asia/Shanghai",
    gameName: "海河周六轻松局",
    dateLabel: "9月5日 周六",
    timeLabel: "09:00–10:30",
    venue: "天津河东体育中心",
    pitch: "笼式五人制 2 号场",
    formatLabel: "五人制",
    detailPath: "/dev/pages/c1c-registration-detail/index?registrationId=reg-applied",
  },
  {
    registrationId: "reg-rejected",
    effectiveStatus: "REJECTED",
    statusLabel: "未通过",
    visibility: "PUBLIC",
    appliedAt: "2026-08-10T08:20:00+08:00",
    startsAt: "2026-08-23T20:00:00+08:00",
    endsAt: "2026-08-23T21:30:00+08:00",
    timeZone: "Asia/Shanghai",
    gameName: "水西公园夜场局",
    dateLabel: "8月23日 周日",
    timeLabel: "20:00–21:30",
    venue: "水西公园足球场",
    pitch: "五人制 1 号场",
    formatLabel: "五人制",
    detailPath: "/dev/pages/c1c-registration-detail/index?registrationId=reg-rejected",
  },
];

const compareRegistrations = (left: C1cRegistration, right: C1cRegistration): number => {
  const appliedDifference = Date.parse(right.appliedAt) - Date.parse(left.appliedAt);
  if (appliedDifference !== 0) return appliedDifference;
  if (left.registrationId < right.registrationId) return 1;
  if (left.registrationId > right.registrationId) return -1;
  return 0;
};

const catalog = deepFreeze(sourceCatalog.map((item) => ({ ...item })).sort(compareRegistrations));
const firstPage = deepFreeze<C1cPage>({
  items: catalog.slice(0, PAGE_SIZE),
  nextCursor: SECOND_PAGE_CURSOR,
});
const secondPage = deepFreeze<C1cPage>({
  items: catalog.slice(PAGE_SIZE),
  nextCursor: null,
});

export const C1C_MY_GAME_REGISTRATIONS_FIXTURE = deepFreeze({
  token: "C1C_MY_GAME_REGISTRATIONS_FIXTURE",
  notice: "C1c 开发预览 · 模拟数据",
  authoritativeNow: AUTHORITATIVE_NOW,
  pageSize: PAGE_SIZE,
  catalog,
  firstPage,
  secondPage,
  deletionCondition: "remove C1C_MY_GAME_REGISTRATIONS_FIXTURE before production integration",
});

const normalizeScrollTop = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
};

export function createC1cMyGameRegistrationsStore(
  initialScenario: C1cScenario = "READY",
): C1cMyGameRegistrationsStore {
  let status: C1cLoadStatus;
  let sourceEmpty: boolean;
  let items: readonly C1cRegistration[];
  let nextCursor: string | null;
  let refreshError: boolean;
  let loadMoreError: boolean;
  let selectedRegistrationId: string | null;
  let entryScrollTop: number;
  let listScrollTop: number;

  const applyScenario = (scenario: C1cScenario) => {
    status = scenario === "LOAD_ERROR" ? "LOAD_ERROR" : "READY";
    sourceEmpty = scenario === "EMPTY";
    items = scenario === "READY" ? firstPage.items : deepFreeze<C1cRegistration[]>([]);
    nextCursor = scenario === "READY" ? firstPage.nextCursor : null;
    refreshError = false;
    loadMoreError = false;
    selectedRegistrationId = null;
    entryScrollTop = 0;
    listScrollTop = 0;
  };

  applyScenario(initialScenario);

  const current = (): C1cMyGameRegistrationsSnapshot => deepFreeze({
    status,
    sourceEmpty,
    items: [...items],
    nextCursor,
    refreshError,
    loadMoreError,
    selectedRegistrationId,
    entryScrollTop,
    listScrollTop,
  });

  const findRegistration = (registrationId: unknown): C1cRegistration | null => {
    if (typeof registrationId !== "string") return null;
    return catalog.find((item) => item.registrationId === registrationId) ?? null;
  };

  const readFirstPage = () => {
    status = "READY";
    items = sourceEmpty ? deepFreeze<C1cRegistration[]>([]) : firstPage.items;
    nextCursor = sourceEmpty ? null : firstPage.nextCursor;
    refreshError = false;
    loadMoreError = false;
  };

  return {
    current,
    reset(scenario = "READY") {
      applyScenario(scenario);
      return current();
    },
    retry() {
      if (status === "LOAD_ERROR") readFirstPage();
      return current();
    },
    refresh(outcome = "SUCCESS") {
      if (outcome === "ERROR" && status === "READY") {
        refreshError = true;
        return current();
      }
      if (outcome === "SUCCESS") readFirstPage();
      return current();
    },
    loadMore(outcome = "SUCCESS") {
      if (status !== "READY" || nextCursor !== SECOND_PAGE_CURSOR) return current();
      if (outcome === "ERROR") {
        loadMoreError = true;
        return current();
      }

      const uniqueById = new Map(items.map((item) => [item.registrationId, item]));
      secondPage.items.forEach((item) => uniqueById.set(item.registrationId, item));
      items = deepFreeze([...uniqueById.values()]);
      nextCursor = secondPage.nextCursor;
      loadMoreError = false;
      return current();
    },
    selectRegistration(registrationId) {
      const registration = findRegistration(registrationId);
      if (!registration) return false;
      selectedRegistrationId = registration.registrationId;
      return true;
    },
    detail(registrationId) {
      return findRegistration(registrationId);
    },
    setEntryScrollTop(value) {
      entryScrollTop = normalizeScrollTop(value);
      return current();
    },
    setListScrollTop(value) {
      listScrollTop = normalizeScrollTop(value);
      return current();
    },
  };
}

export const c1cMyGameRegistrationsStore = createC1cMyGameRegistrationsStore();
