export type C1bGameVisibility = "PUBLIC" | "LINK_ONLY";
export type C1bGameEffectiveState = "DRAFT" | "PUBLISHED" | "SUSPENDED" | "CANCELLED" | "COMPLETED";
export type C1bGameFormat = "FIVE" | "SEVEN";
export type C1bGameFormatFilter = "ALL" | C1bGameFormat;
export type C1bGameDiscoveryLoadStatus = "LOADING" | "READY" | "LOAD_ERROR";
export type C1bGameDiscoveryScenario =
  | "READY"
  | "FILTERED_NONEMPTY"
  | "FILTER_NO_MATCH"
  | "LOAD_ERROR"
  | "LOADING"
  | "SOURCE_EMPTY"
  | "SELECTED_DETAIL";

export interface C1bPublicGame {
  readonly id: string;
  readonly visibility: C1bGameVisibility;
  readonly effectiveState: C1bGameEffectiveState;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly registrationDeadline: string;
  readonly date: string;
  readonly dateLabel: string;
  readonly dateChipLabel: string;
  readonly timeLabel: string;
  readonly format: C1bGameFormat;
  readonly formatLabel: string;
  readonly name: string;
  readonly venue: string;
  readonly pitch: string;
  readonly intensity: string;
  readonly positions: string;
  readonly currentPlayers: number;
  readonly totalPlayers: number;
  readonly remainingSpots: number;
  readonly aa: string;
  readonly deadline: string;
  readonly team: string;
  readonly arrival: string;
}

export interface C1bGameDiscoveryFilters {
  readonly date: "ALL" | string;
  readonly format: C1bGameFormatFilter;
  readonly availableOnly: boolean;
}

export interface C1bGameDiscoveryOption<T extends string = string> {
  readonly value: T;
  readonly label: string;
}

const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value as Record<string, unknown>).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};

const AUTHORITATIVE_NOW = "2026-08-26T12:00:00+08:00";

const catalog = deepFreeze<C1bPublicGame[]>([
  {
    id: "harbor-five",
    visibility: "PUBLIC",
    effectiveState: "PUBLISHED",
    startsAt: "2026-08-29T07:30:00+08:00",
    endsAt: "2026-08-29T09:00:00+08:00",
    registrationDeadline: "2026-08-28T20:00:00+08:00",
    date: "2026-08-29",
    dateLabel: "8月29日 周六",
    dateChipLabel: "8/29 周六",
    timeLabel: "07:30–09:00",
    format: "FIVE",
    formatLabel: "五人制",
    name: "海河周六晨练局",
    venue: "天津河东体育中心",
    pitch: "笼式五人制 2 号场",
    intensity: "轻松交流",
    positions: "中场 / 前锋",
    currentPlayers: 6,
    totalPlayers: 10,
    remainingSpots: 4,
    aa: "¥36",
    deadline: "8月28日 20:00",
    team: "海河晨光队",
    arrival: "深浅两套球衣，提前 15 分钟到场",
  },
  {
    id: "olympic-seven",
    visibility: "PUBLIC",
    effectiveState: "PUBLISHED",
    startsAt: "2026-08-30T18:00:00+08:00",
    endsAt: "2026-08-30T20:00:00+08:00",
    registrationDeadline: "2026-08-30T12:00:00+08:00",
    date: "2026-08-30",
    dateLabel: "8月30日 周日",
    dateChipLabel: "8/30 周日",
    timeLabel: "18:00–20:00",
    format: "SEVEN",
    formatLabel: "七人制",
    name: "奥体周日傍晚局",
    venue: "天津奥体足球场",
    pitch: "七人制 A 场",
    intensity: "认真对抗",
    positions: "后卫 / 门将",
    currentPlayers: 11,
    totalPlayers: 14,
    remainingSpots: 3,
    aa: "¥52",
    deadline: "8月30日 12:00",
    team: "津门周末足球队",
    arrival: "提前 20 分钟热身，备好护腿板",
  },
  {
    id: "riverside-five",
    visibility: "PUBLIC",
    effectiveState: "PUBLISHED",
    startsAt: "2026-08-31T20:00:00+08:00",
    endsAt: "2026-08-31T21:30:00+08:00",
    registrationDeadline: "2026-08-31T16:00:00+08:00",
    date: "2026-08-31",
    dateLabel: "8月31日 周一",
    dateChipLabel: "8/31 周一",
    timeLabel: "20:00–21:30",
    format: "FIVE",
    formatLabel: "五人制",
    name: "水西公园夜场局",
    venue: "水西公园足球场",
    pitch: "五人制 1 号场",
    intensity: "新手友好",
    positions: "任意位置",
    currentPlayers: 10,
    totalPlayers: 10,
    remainingSpots: 0,
    aa: "¥42",
    deadline: "8月31日 16:00",
    team: "西青快乐足球",
    arrival: "穿碎钉球鞋，开场前 10 分钟集合",
  },
]);

export const C1B_GAME_DISCOVERY_FIXTURE = deepFreeze({
  token: "C1B_GAME_DISCOVERY_FIXTURE",
  notice: "C1b 开发预览 · 模拟数据",
  authoritativeNow: AUTHORITATIVE_NOW,
  catalog,
  deletionCondition: "remove C1B_GAME_DISCOVERY_FIXTURE before production integration",
});

const defaultFilters = (): C1bGameDiscoveryFilters => ({ date: "ALL", format: "ALL", availableOnly: false });

const isStrictlyAfter = (candidate: string, boundary: string): boolean => {
  const candidateMs = Date.parse(candidate);
  const boundaryMs = Date.parse(boundary);
  return Number.isFinite(candidateMs) && Number.isFinite(boundaryMs) && candidateMs > boundaryMs;
};

const isEligible = (game: C1bPublicGame, now: string): boolean => game.visibility === "PUBLIC"
  && game.effectiveState === "PUBLISHED"
  && isStrictlyAfter(game.startsAt, now)
  && isStrictlyAfter(game.registrationDeadline, now);

const compareGames = (left: C1bPublicGame, right: C1bPublicGame): number => {
  const timeDifference = Date.parse(left.startsAt) - Date.parse(right.startsAt);
  if (timeDifference !== 0) return timeDifference;
  if (left.id < right.id) return -1;
  if (left.id > right.id) return 1;
  return 0;
};

export const projectC1bDirectory = (
  source: readonly C1bPublicGame[],
  filters: C1bGameDiscoveryFilters,
  now: string,
): readonly C1bPublicGame[] => deepFreeze(source
  .filter((game) => isEligible(game, now))
  .filter((game) => filters.date === "ALL" || game.date === filters.date)
  .filter((game) => filters.format === "ALL" || game.format === filters.format)
  .filter((game) => !filters.availableOnly || game.remainingSpots > 0)
  .map((game) => ({ ...game }))
  .sort(compareGames));

export interface C1bGameDiscoverySnapshot {
  readonly status: C1bGameDiscoveryLoadStatus;
  readonly now: string;
  readonly filters: C1bGameDiscoveryFilters;
  readonly dateOptions: readonly C1bGameDiscoveryOption[];
  readonly formatOptions: readonly C1bGameDiscoveryOption<C1bGameFormatFilter>[];
  readonly games: readonly C1bPublicGame[];
  readonly sourceEmpty: boolean;
  readonly filterNoMatch: boolean;
  readonly selectedGameId: string | null;
}

export interface C1bGameDiscoveryStore {
  current(): C1bGameDiscoverySnapshot;
  reset(scenario?: C1bGameDiscoveryScenario): C1bGameDiscoverySnapshot;
  setDateFilter(value: unknown): C1bGameDiscoverySnapshot;
  setFormatFilter(value: unknown): C1bGameDiscoverySnapshot;
  toggleAvailableOnly(): C1bGameDiscoverySnapshot;
  clearFilters(): C1bGameDiscoverySnapshot;
  retry(): C1bGameDiscoverySnapshot;
  selectGame(id: unknown): boolean;
  detail(id: unknown): C1bPublicGame | null;
}

const formatOptions = deepFreeze<C1bGameDiscoveryOption<C1bGameFormatFilter>[]>([
  { value: "ALL", label: "全部人制" },
  { value: "FIVE", label: "五人制" },
  { value: "SEVEN", label: "七人制" },
]);

const scenarioState = (scenario: C1bGameDiscoveryScenario) => {
  if (scenario === "FILTERED_NONEMPTY") {
    return { status: "READY" as const, filters: { date: "2026-08-29", format: "FIVE" as const, availableOnly: true }, sourceSuppressed: false, selectedGameId: null };
  }
  if (scenario === "FILTER_NO_MATCH") {
    return { status: "READY" as const, filters: { date: "2026-08-31", format: "FIVE" as const, availableOnly: true }, sourceSuppressed: false, selectedGameId: null };
  }
  if (scenario === "LOAD_ERROR") {
    return { status: "LOAD_ERROR" as const, filters: defaultFilters(), sourceSuppressed: false, selectedGameId: null };
  }
  if (scenario === "LOADING") {
    return { status: "LOADING" as const, filters: defaultFilters(), sourceSuppressed: false, selectedGameId: null };
  }
  if (scenario === "SOURCE_EMPTY") {
    return { status: "READY" as const, filters: defaultFilters(), sourceSuppressed: true, selectedGameId: null };
  }
  if (scenario === "SELECTED_DETAIL") {
    return { status: "READY" as const, filters: defaultFilters(), sourceSuppressed: false, selectedGameId: "harbor-five" };
  }
  return { status: "READY" as const, filters: defaultFilters(), sourceSuppressed: false, selectedGameId: null };
};

export const createC1bGameDiscoveryStore = (
  initialScenario: C1bGameDiscoveryScenario = "READY",
  initialCatalog: readonly C1bPublicGame[] = C1B_GAME_DISCOVERY_FIXTURE.catalog,
): C1bGameDiscoveryStore => {
  const source = deepFreeze(initialCatalog.map((game) => ({ ...game })));
  let { status, filters, sourceSuppressed, selectedGameId } = scenarioState(initialScenario);

  const eligibleSource = (): readonly C1bPublicGame[] => sourceSuppressed
    ? deepFreeze<C1bPublicGame[]>([])
    : projectC1bDirectory(source, defaultFilters(), AUTHORITATIVE_NOW);

  const buildDateOptions = (eligible: readonly C1bPublicGame[]): readonly C1bGameDiscoveryOption[] => {
    const byDate = new Map<string, string>();
    eligible.forEach((game) => {
      if (!byDate.has(game.date)) byDate.set(game.date, game.dateChipLabel);
    });
    return deepFreeze([
      { value: "ALL", label: "全部日期" },
      ...Array.from(byDate, ([value, label]) => ({ value, label })),
    ]);
  };

  const current = (): C1bGameDiscoverySnapshot => {
    const eligible = eligibleSource();
    const projected = status === "READY"
      ? projectC1bDirectory(eligible, filters, AUTHORITATIVE_NOW)
      : deepFreeze<C1bPublicGame[]>([]);
    return deepFreeze({
      status,
      now: AUTHORITATIVE_NOW,
      filters: { ...filters },
      dateOptions: buildDateOptions(eligible),
      formatOptions,
      games: projected,
      sourceEmpty: eligible.length === 0,
      filterNoMatch: eligible.length > 0 && status === "READY" && projected.length === 0,
      selectedGameId,
    });
  };

  const findEligible = (id: unknown): C1bPublicGame | null => {
    if (typeof id !== "string") return null;
    return eligibleSource().find((game) => game.id === id) ?? null;
  };

  return {
    current,
    reset(scenario = "READY") {
      ({ status, filters, sourceSuppressed, selectedGameId } = scenarioState(scenario));
      if (selectedGameId !== null && !findEligible(selectedGameId)) selectedGameId = null;
      return current();
    },
    setDateFilter(value) {
      const valid = current().dateOptions.some((option) => option.value === value);
      if (valid) filters = { ...filters, date: value as string };
      return current();
    },
    setFormatFilter(value) {
      const valid = formatOptions.some((option) => option.value === value);
      if (valid) filters = { ...filters, format: value as C1bGameFormatFilter };
      return current();
    },
    toggleAvailableOnly() {
      filters = { ...filters, availableOnly: !filters.availableOnly };
      return current();
    },
    clearFilters() {
      filters = defaultFilters();
      return current();
    },
    retry() {
      if (status === "LOAD_ERROR") status = "READY";
      return current();
    },
    selectGame(id) {
      const game = findEligible(id);
      if (!game) return false;
      selectedGameId = game.id;
      return true;
    },
    detail(id) {
      return findEligible(id);
    },
  };
};

export const c1bGameDiscoveryStore = createC1bGameDiscoveryStore();
