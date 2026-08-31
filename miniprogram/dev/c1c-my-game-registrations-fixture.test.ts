import { expect, test } from "@jest/globals";

import {
  C1C_MY_GAME_REGISTRATIONS_FIXTURE,
  c1cMyGameRegistrationsStore,
  createC1cMyGameRegistrationsStore,
} from "./c1c-my-game-registrations-fixture";

type C1cEffectiveStatus = "APPLIED" | "JOINED" | "REJECTED" | "CANCELLED";
type C1cScenario = "READY" | "EMPTY" | "LOAD_ERROR";

interface C1cRegistrationContract {
  readonly registrationId: string;
  readonly effectiveStatus: C1cEffectiveStatus;
}

interface C1cPage {
  readonly items: readonly C1cRegistrationContract[];
  readonly nextCursor: string | null;
}

const ids = (items: readonly C1cRegistrationContract[]) => items.map(({ registrationId }) => registrationId);

test("declares one isolated four-status catalog spanning visibility and time", () => {
  const fixture = C1C_MY_GAME_REGISTRATIONS_FIXTURE;
  const statuses: readonly C1cEffectiveStatus[] = fixture.catalog.map(({ effectiveStatus }) => effectiveStatus);
  const scenarios: readonly C1cScenario[] = ["READY", "EMPTY", "LOAD_ERROR"];

  expect(fixture).toMatchObject({
    token: "C1C_MY_GAME_REGISTRATIONS_FIXTURE",
    authoritativeNow: "2026-08-29T12:00:00+08:00",
    pageSize: 2,
    deletionCondition: expect.stringMatching(/production/i),
  });
  expect(new Set(statuses)).toEqual(new Set(["APPLIED", "JOINED", "REJECTED", "CANCELLED"]));
  expect(new Set(fixture.catalog.map(({ visibility }) => visibility))).toEqual(new Set(["PUBLIC", "LINK_ONLY"]));
  expect(fixture.catalog.some(({ startsAt }) => Date.parse(startsAt) > Date.parse(fixture.authoritativeNow))).toBe(true);
  expect(fixture.catalog.some(({ startsAt }) => Date.parse(startsAt) < Date.parse(fixture.authoritativeNow))).toBe(true);
  fixture.catalog.forEach(({ appliedAt, startsAt }) => {
    expect(Date.parse(appliedAt)).toBeLessThan(Date.parse(startsAt));
  });
  expect(scenarios).toEqual(["READY", "EMPTY", "LOAD_ERROR"]);
  expect(c1cMyGameRegistrationsStore.current().status).toBe("READY");
});

test("projects stable descending pages with one opaque cursor and no duplicate registration", () => {
  const firstPage: C1cPage = C1C_MY_GAME_REGISTRATIONS_FIXTURE.firstPage;
  const secondPage: C1cPage = C1C_MY_GAME_REGISTRATIONS_FIXTURE.secondPage;
  const combined = [...firstPage.items, ...secondPage.items];
  const expectedOrder = [...combined].sort((left, right) => {
    const appliedDifference = Date.parse(
      C1C_MY_GAME_REGISTRATIONS_FIXTURE.catalog.find(({ registrationId }) => registrationId === right.registrationId)!.appliedAt,
    ) - Date.parse(
      C1C_MY_GAME_REGISTRATIONS_FIXTURE.catalog.find(({ registrationId }) => registrationId === left.registrationId)!.appliedAt,
    );
    if (appliedDifference !== 0) return appliedDifference;
    return right.registrationId.localeCompare(left.registrationId);
  });

  expect(ids(firstPage.items)).toEqual(["reg-applied", "reg-joined"]);
  expect(firstPage.nextCursor).toBe("c1c-page-2");
  expect(ids(secondPage.items)).toEqual(["reg-rejected", "reg-cancelled"]);
  expect(secondPage.nextCursor).toBeNull();
  expect(ids(combined)).toEqual(ids(expectedOrder));
  expect(new Set(ids(combined)).size).toBe(4);

  const store = createC1cMyGameRegistrationsStore();
  expect(ids(store.current().items)).toEqual(ids(firstPage.items));
  expect(store.loadMore().nextCursor).toBeNull();
  expect(ids(store.current().items)).toEqual(ids(combined));
  expect(ids(store.loadMore().items)).toEqual(ids(combined));
});

test("recovers an initial load error without inventing registrations", () => {
  const store = createC1cMyGameRegistrationsStore("LOAD_ERROR");

  expect(store.current()).toMatchObject({ status: "LOAD_ERROR", items: [], nextCursor: null });
  expect(store.retry()).toMatchObject({
    status: "READY",
    nextCursor: "c1c-page-2",
  });
  expect(ids(store.current().items)).toEqual(["reg-applied", "reg-joined"]);

  const empty = createC1cMyGameRegistrationsStore("EMPTY");
  expect(empty.current()).toMatchObject({ status: "READY", sourceEmpty: true, items: [], nextCursor: null });
  expect(empty.retry()).toMatchObject({ status: "READY", sourceEmpty: true, items: [], nextCursor: null });
});

test("refresh errors preserve loaded cards and a successful refresh returns to page one", () => {
  const store = createC1cMyGameRegistrationsStore();
  store.loadMore();
  const loadedIds = ids(store.current().items);

  const failed = store.refresh("ERROR");
  expect(ids(failed.items)).toEqual(loadedIds);
  expect(failed).toMatchObject({ status: "READY", refreshError: true, loadMoreError: false, nextCursor: null });

  const refreshed = store.refresh();
  expect(ids(refreshed.items)).toEqual(["reg-applied", "reg-joined"]);
  expect(refreshed).toMatchObject({ refreshError: false, loadMoreError: false, nextCursor: "c1c-page-2" });
});

test("load-more errors preserve page one and retry appends page two exactly once", () => {
  const store = createC1cMyGameRegistrationsStore();
  const before = store.current();

  const failed = store.loadMore("ERROR");
  expect(ids(failed.items)).toEqual(ids(before.items));
  expect(failed).toMatchObject({ loadMoreError: true, nextCursor: "c1c-page-2" });

  const recovered = store.loadMore();
  expect(ids(recovered.items)).toEqual(["reg-applied", "reg-joined", "reg-rejected", "reg-cancelled"]);
  expect(recovered).toMatchObject({ loadMoreError: false, nextCursor: null });
  expect(ids(store.loadMore().items)).toEqual(ids(recovered.items));
});

test("selects and reads only the exact registration without unknown-id fallback", () => {
  const store = createC1cMyGameRegistrationsStore();

  expect(store.selectRegistration("reg-joined")).toBe(true);
  expect(store.current().selectedRegistrationId).toBe("reg-joined");
  expect(store.detail("reg-joined")).toMatchObject({
    registrationId: "reg-joined",
    gameName: "奥体周日傍晚局",
    detailPath: "/dev/pages/c1c-registration-detail/index?registrationId=reg-joined",
  });
  expect(store.detail("reg-applied")).toMatchObject({ registrationId: "reg-applied" });
  expect(store.detail("unknown")).toBeNull();
  expect(store.detail(null)).toBeNull();
  expect(store.selectRegistration("unknown")).toBe(false);
  expect(store.current().selectedRegistrationId).toBe("reg-joined");
});

test("returns deeply frozen snapshots and stores entry and list scroll independently", () => {
  const store = createC1cMyGameRegistrationsStore();
  store.setEntryScrollTop(248);
  const snapshot = store.setListScrollTop(612);

  expect(snapshot).toMatchObject({ entryScrollTop: 248, listScrollTop: 612 });
  expect(Object.isFrozen(snapshot)).toBe(true);
  expect(Object.isFrozen(snapshot.items)).toBe(true);
  expect(Object.isFrozen(snapshot.items[0])).toBe(true);
  expect(Object.isFrozen(C1C_MY_GAME_REGISTRATIONS_FIXTURE)).toBe(true);
  expect(Object.isFrozen(C1C_MY_GAME_REGISTRATIONS_FIXTURE.catalog)).toBe(true);
  expect(Object.isFrozen(C1C_MY_GAME_REGISTRATIONS_FIXTURE.firstPage)).toBe(true);
  expect(Object.isFrozen(store.detail("reg-applied"))).toBe(true);

  const next = store.setEntryScrollTop(-10);
  expect(next.entryScrollTop).toBe(0);
  expect(next.listScrollTop).toBe(612);
});
