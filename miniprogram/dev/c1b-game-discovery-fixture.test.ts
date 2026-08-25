import { expect, test } from "@jest/globals";

import {
  C1B_GAME_DISCOVERY_FIXTURE,
  c1bGameDiscoveryStore,
  createC1bGameDiscoveryStore,
  projectC1bDirectory,
  type C1bPublicGame,
} from "./c1b-game-discovery-fixture";

const allFilters = { date: "ALL" as const, format: "ALL" as const, availableOnly: false };

test("declares one fixed-clock development catalog with the three Artifact games", () => {
  expect(C1B_GAME_DISCOVERY_FIXTURE).toMatchObject({
    token: "C1B_GAME_DISCOVERY_FIXTURE",
    authoritativeNow: "2026-08-26T12:00:00+08:00",
    deletionCondition: expect.stringMatching(/production/i),
  });
  expect(C1B_GAME_DISCOVERY_FIXTURE.catalog.map(({ id, startsAt, registrationDeadline, currentPlayers, totalPlayers, remainingSpots, aa }) => ({
    id, startsAt, registrationDeadline, currentPlayers, totalPlayers, remainingSpots, aa,
  }))).toEqual([
    {
      id: "harbor-five", startsAt: "2026-08-29T07:30:00+08:00", registrationDeadline: "2026-08-28T20:00:00+08:00",
      currentPlayers: 6, totalPlayers: 10, remainingSpots: 4, aa: "¥36",
    },
    {
      id: "olympic-seven", startsAt: "2026-08-30T18:00:00+08:00", registrationDeadline: "2026-08-30T12:00:00+08:00",
      currentPlayers: 11, totalPlayers: 14, remainingSpots: 3, aa: "¥52",
    },
    {
      id: "riverside-five", startsAt: "2026-08-31T20:00:00+08:00", registrationDeadline: "2026-08-31T16:00:00+08:00",
      currentPlayers: 10, totalPlayers: 10, remainingSpots: 0, aa: "¥42",
    },
  ]);
  expect(c1bGameDiscoveryStore.current().now).toBe(C1B_GAME_DISCOVERY_FIXTURE.authoritativeNow);
});

test("projects only PUBLIC PUBLISHED games whose start and deadline are strictly future", () => {
  const eligible = C1B_GAME_DISCOVERY_FIXTURE.catalog[0];
  const variants: C1bPublicGame[] = [
    eligible,
    { ...eligible, id: "link-only", visibility: "LINK_ONLY" },
    { ...eligible, id: "draft", effectiveState: "DRAFT" },
    { ...eligible, id: "suspended", effectiveState: "SUSPENDED" },
    { ...eligible, id: "cancelled", effectiveState: "CANCELLED" },
    { ...eligible, id: "completed", effectiveState: "COMPLETED" },
    { ...eligible, id: "started", startsAt: C1B_GAME_DISCOVERY_FIXTURE.authoritativeNow },
    { ...eligible, id: "deadline-closed", registrationDeadline: C1B_GAME_DISCOVERY_FIXTURE.authoritativeNow },
  ];

  expect(projectC1bDirectory(variants, allFilters, C1B_GAME_DISCOVERY_FIXTURE.authoritativeNow).map(({ id }) => id)).toEqual(["harbor-five"]);
  expect(projectC1bDirectory(C1B_GAME_DISCOVERY_FIXTURE.catalog, allFilters, C1B_GAME_DISCOVERY_FIXTURE.authoritativeNow).map(({ id }) => id))
    .toEqual(["harbor-five", "olympic-seven", "riverside-five"]);
});

test("sorts stably by startsAt then id", () => {
  const base = C1B_GAME_DISCOVERY_FIXTURE.catalog[0];
  const later = { ...base, id: "later", startsAt: "2026-08-29T01:00:00+00:00" };
  const sameB = { ...base, id: "same-b" };
  const sameA = { ...base, id: "same-a" };

  expect(projectC1bDirectory([later, sameB, sameA], allFilters, C1B_GAME_DISCOVERY_FIXTURE.authoritativeNow).map(({ id }) => id))
    .toEqual(["same-a", "same-b", "later"]);
  expect(Object.isFrozen(later)).toBe(false);
});

test("combines date, format and availability with AND and clear restores defaults", () => {
  const store = createC1bGameDiscoveryStore();
  store.setDateFilter("2026-08-29");
  store.setFormatFilter("FIVE");
  store.toggleAvailableOnly();
  expect(store.current()).toMatchObject({
    filters: { date: "2026-08-29", format: "FIVE", availableOnly: true },
    games: [{ id: "harbor-five" }],
    sourceEmpty: false,
    filterNoMatch: false,
  });

  store.setDateFilter("2026-08-31");
  expect(store.current()).toMatchObject({ games: [], sourceEmpty: false, filterNoMatch: true });
  store.clearFilters();
  expect(store.current().filters).toEqual(allFilters);
  expect(store.current().games.map(({ id }) => id)).toEqual(["harbor-five", "olympic-seven", "riverside-five"]);
});

test("distinguishes a genuinely empty eligible source from filters with no match", () => {
  const empty = createC1bGameDiscoveryStore("SOURCE_EMPTY").current();
  expect(empty).toMatchObject({ status: "READY", games: [], sourceEmpty: true, filterNoMatch: false });
  expect(empty.dateOptions).toEqual([{ value: "ALL", label: "全部日期" }]);

  const noMatch = createC1bGameDiscoveryStore("FILTER_NO_MATCH").current();
  expect(noMatch).toMatchObject({
    status: "READY", games: [], sourceEmpty: false, filterNoMatch: true,
    filters: { date: "2026-08-31", format: "FIVE", availableOnly: true },
  });
});

test("retry only recovers loading state and does not create or modify catalog entries", () => {
  const store = createC1bGameDiscoveryStore("LOAD_ERROR");
  const before = C1B_GAME_DISCOVERY_FIXTURE.catalog;
  expect(store.current()).toMatchObject({ status: "LOAD_ERROR", games: [] });
  expect(store.retry()).toMatchObject({ status: "READY" });
  expect(store.current().games.map(({ id }) => id)).toEqual(["harbor-five", "olympic-seven", "riverside-five"]);
  expect(C1B_GAME_DISCOVERY_FIXTURE.catalog).toBe(before);
  expect(C1B_GAME_DISCOVERY_FIXTURE.catalog).toHaveLength(3);
});

test("selects and reads only the exact eligible game without unknown-id fallback", () => {
  const store = createC1bGameDiscoveryStore();
  expect(store.selectGame("olympic-seven")).toBe(true);
  expect(store.current().selectedGameId).toBe("olympic-seven");
  expect(store.detail("olympic-seven")).toMatchObject({ id: "olympic-seven", name: "奥体周日傍晚局" });
  expect(store.detail("harbor-five")).toMatchObject({ id: "harbor-five", name: "海河周六晨练局" });
  expect(store.detail("unknown")).toBeNull();
  expect(store.selectGame("unknown")).toBe(false);
  expect(store.current().selectedGameId).toBe("olympic-seven");

  const hidden = { ...C1B_GAME_DISCOVERY_FIXTURE.catalog[0], id: "hidden", visibility: "LINK_ONLY" as const };
  const custom = createC1bGameDiscoveryStore("READY", [...C1B_GAME_DISCOVERY_FIXTURE.catalog, hidden]);
  expect(custom.selectGame("hidden")).toBe(false);
  expect(custom.detail("hidden")).toBeNull();
});

test("selection preserves filters and every returned snapshot is deeply frozen", () => {
  const store = createC1bGameDiscoveryStore("FILTERED_NONEMPTY");
  const selected = store.selectGame("harbor-five");
  const snapshot = store.current();

  expect(selected).toBe(true);
  expect(snapshot.filters).toEqual({ date: "2026-08-29", format: "FIVE", availableOnly: true });
  expect(snapshot.selectedGameId).toBe("harbor-five");
  expect(Object.isFrozen(snapshot)).toBe(true);
  expect(Object.isFrozen(snapshot.filters)).toBe(true);
  expect(Object.isFrozen(snapshot.dateOptions)).toBe(true);
  expect(Object.isFrozen(snapshot.dateOptions[0])).toBe(true);
  expect(Object.isFrozen(snapshot.formatOptions)).toBe(true);
  expect(Object.isFrozen(snapshot.games)).toBe(true);
  expect(Object.isFrozen(snapshot.games[0])).toBe(true);

  const afterReset = store.reset("SELECTED_DETAIL");
  expect(afterReset.selectedGameId).toBe("harbor-five");
  expect(Object.isFrozen(afterReset)).toBe(true);
  expect(Object.isFrozen(store.detail("harbor-five"))).toBe(true);
});
