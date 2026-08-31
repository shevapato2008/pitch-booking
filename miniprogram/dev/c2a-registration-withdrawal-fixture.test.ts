import { expect, test } from "@jest/globals";

import {
  C2A_REGISTRATION_WITHDRAWAL_FIXTURE,
  c2aRegistrationWithdrawalStore,
  createC2aRegistrationWithdrawalStore,
  isLateWithdrawal,
  type C2aRegistrationWithdrawalScenario,
} from "./c2a-registration-withdrawal-fixture";

const scenarios: readonly C2aRegistrationWithdrawalScenario[] = [
  "APPLIED",
  "JOINED_EARLY",
  "JOINED_LATE",
  "WITHDRAWN",
  "RESULT_UNKNOWN",
];

test("declares one isolated five-scenario development fixture", () => {
  expect(C2A_REGISTRATION_WITHDRAWAL_FIXTURE).toMatchObject({
    marker: "C2A_REGISTRATION_WITHDRAWAL_FIXTURE",
    notice: expect.stringMatching(/C2a.*模拟数据/),
    authoritativeNow: "2026-09-06T13:00:00+08:00",
    deletionCondition: expect.stringMatching(/production/i),
  });
  expect(scenarios).toEqual([
    "APPLIED",
    "JOINED_EARLY",
    "JOINED_LATE",
    "WITHDRAWN",
    "RESULT_UNKNOWN",
  ]);
  expect(c2aRegistrationWithdrawalStore.current().scenario).toBe("APPLIED");
  expect(Object.isFrozen(C2A_REGISTRATION_WITHDRAWAL_FIXTURE)).toBe(true);
  expect(Object.isFrozen(C2A_REGISTRATION_WITHDRAWAL_FIXTURE.game)).toBe(true);
});

test.each([
  ["APPLIED", "APPLIED", "WITHDRAW_APPLICATION", false, "IDLE"],
  ["JOINED_EARLY", "JOINED", "LEAVE_GAME", false, "IDLE"],
  ["JOINED_LATE", "JOINED", "LEAVE_GAME", true, "IDLE"],
  ["WITHDRAWN", "WITHDRAWN", null, false, "IDLE"],
  ["RESULT_UNKNOWN", "JOINED", null, true, "RESULT_UNKNOWN"],
] as const)(
  "%s projects its authoritative status, action, timing, and operation",
  (scenario, effectiveStatus, availableAction, isLateExit, operationState) => {
    const snapshot = createC2aRegistrationWithdrawalStore(scenario).current();

    expect(snapshot).toMatchObject({
      marker: "C2A_REGISTRATION_WITHDRAWAL_FIXTURE",
      scenario,
      operationState,
      selectedRegistrationId: null,
      listScrollTop: 0,
      availableAction,
      isLateExit,
      registration: { effectiveStatus },
    });
    expect(snapshot.game).toMatchObject({
      currentPlayers: scenario === "WITHDRAWN" ? 9 : 10,
      remainingSpots: scenario === "WITHDRAWN" ? 5 : 4,
    });
  },
);

test("uses a strict six-hour boundary and never classifies an already-started game as late", () => {
  const startsAt = "2026-08-30T18:00:00+08:00";

  expect(isLateWithdrawal(startsAt, "2026-08-30T12:00:00+08:00")).toBe(false);
  expect(isLateWithdrawal(startsAt, "2026-08-30T12:00:00.001+08:00")).toBe(true);
  expect(isLateWithdrawal(startsAt, "2026-08-30T17:59:59.999+08:00")).toBe(true);
  expect(isLateWithdrawal(startsAt, startsAt)).toBe(false);
  expect(isLateWithdrawal(startsAt, "2026-08-30T18:00:00.001+08:00")).toBe(false);
  expect(isLateWithdrawal("not-a-date", "2026-08-30T12:00:00+08:00")).toBe(false);
});

test("a custom exact boundary remains an early joined withdrawal", () => {
  const store = createC2aRegistrationWithdrawalStore("JOINED_LATE", {
    authoritativeNow: "2026-09-06T12:00:00+08:00",
    startsAt: "2026-09-06T18:00:00+08:00",
  });

  expect(store.current()).toMatchObject({ isLateExit: false, availableAction: "LEAVE_GAME" });
});

test("cancel closes confirmation without writing registration or capacity", () => {
  const store = createC2aRegistrationWithdrawalStore("JOINED_LATE");
  const before = store.current();

  expect(store.openConfirmation(before.registration.registrationId)).toMatchObject({
    operationState: "CONFIRMING",
    availableAction: "LEAVE_GAME",
    registration: { effectiveStatus: "JOINED" },
    game: { currentPlayers: 10, remainingSpots: 4 },
  });
  const cancelled = store.cancelConfirmation();

  expect(cancelled).toMatchObject({
    operationState: "IDLE",
    registration: { effectiveStatus: "JOINED", lateExitRecorded: false },
    game: { remainingSpots: 4 },
    withdrawalAttempt: null,
  });
});

test("APPLIED withdrawal keeps capacity unchanged and is idempotent", () => {
  const store = createC2aRegistrationWithdrawalStore("APPLIED");
  const id = store.current().registration.registrationId;

  store.openConfirmation(id);
  expect(store.beginWithdrawal()).toMatchObject({
    operationState: "SUBMITTING",
    withdrawalAttempt: { key: "c2a-applied-withdraw-0001", kind: "WITHDRAW_APPLICATION" },
  });
  const withdrawn = store.resolveWithdrawal();

  expect(withdrawn).toMatchObject({
    operationState: "IDLE",
    availableAction: null,
    registration: {
      effectiveStatus: "WITHDRAWN",
      statusLabel: "已退出",
      withdrawalKind: "APPLICATION_WITHDRAWAL",
      lateExitRecorded: false,
    },
    game: { remainingSpots: 4 },
  });
  expect(store.resolveWithdrawal()).toEqual(withdrawn);
  expect(store.confirmWithdrawalResult()).toEqual(withdrawn);
});

test.each([
  ["JOINED_EARLY", false],
  ["JOINED_LATE", true],
] as const)("%s releases exactly one spot and records only a truly late exit", (scenario, lateExitRecorded) => {
  const store = createC2aRegistrationWithdrawalStore(scenario);
  const id = store.current().registration.registrationId;

  store.openConfirmation(id);
  store.beginWithdrawal();
  const withdrawn = store.resolveWithdrawal();

  expect(withdrawn).toMatchObject({
    registration: {
      effectiveStatus: "WITHDRAWN",
      withdrawalKind: "GAME_EXIT",
      lateExitRecorded,
    },
    game: { currentPlayers: 9, remainingSpots: 5 },
  });
  expect(store.resolveWithdrawal().game.remainingSpots).toBe(5);
  expect(store.confirmWithdrawalResult().game.remainingSpots).toBe(5);
});

test("an error preserves authority and can be dismissed before a fresh attempt", () => {
  const store = createC2aRegistrationWithdrawalStore("JOINED_EARLY");
  const id = store.current().registration.registrationId;
  store.openConfirmation(id);
  store.beginWithdrawal();

  const failed = store.resolveWithdrawal("ERROR");
  expect(failed).toMatchObject({
    operationState: "ERROR",
    errorMessage: expect.any(String),
    registration: { effectiveStatus: "JOINED" },
    game: { currentPlayers: 10, remainingSpots: 4 },
  });
  expect(store.beginWithdrawal()).toEqual(failed);
  expect(store.dismissError()).toMatchObject({ operationState: "IDLE", errorMessage: null });

  store.openConfirmation(id);
  const retrying = store.beginWithdrawal();
  expect(retrying.withdrawalAttempt?.key).toBe("c2a-joined-early-withdraw-0002");
});

test("RESULT_UNKNOWN preserves old authority, blocks resubmit, and only result confirmation converges", () => {
  const store = createC2aRegistrationWithdrawalStore("JOINED_LATE");
  const id = store.current().registration.registrationId;
  store.openConfirmation(id);
  store.beginWithdrawal();

  const unknown = store.resolveWithdrawal("UNKNOWN");
  expect(unknown).toMatchObject({
    operationState: "RESULT_UNKNOWN",
    registration: { effectiveStatus: "JOINED", lateExitRecorded: false },
    game: { remainingSpots: 4 },
    withdrawalAttempt: { key: "c2a-joined-late-withdraw-0001", kind: "LEAVE_GAME" },
  });
  expect(store.openConfirmation(id)).toEqual(unknown);
  expect(store.beginWithdrawal()).toEqual(unknown);
  expect(store.resolveWithdrawal()).toEqual(unknown);
  expect(store.cancelConfirmation()).toEqual(unknown);

  const confirmed = store.confirmWithdrawalResult();
  expect(confirmed).toMatchObject({
    operationState: "IDLE",
    registration: { effectiveStatus: "WITHDRAWN", lateExitRecorded: true },
    game: { currentPlayers: 9, remainingSpots: 5 },
  });
  expect(store.confirmWithdrawalResult()).toEqual(confirmed);
});

test("the RESULT_UNKNOWN scenario starts with one stable pending attempt and has no withdrawal CTA", () => {
  const store = createC2aRegistrationWithdrawalStore("RESULT_UNKNOWN");
  const initial = store.current();

  expect(initial).toMatchObject({
    operationState: "RESULT_UNKNOWN",
    availableAction: null,
    registration: { effectiveStatus: "JOINED" },
    withdrawalAttempt: { key: "c2a-result-unknown-withdraw-0001", kind: "LEAVE_GAME" },
    game: { remainingSpots: 4 },
  });
  expect(store.openConfirmation(initial.registration.registrationId)).toEqual(initial);
  expect(store.beginWithdrawal()).toEqual(initial);
  expect(store.resolveWithdrawal()).toEqual(initial);
  expect(store.confirmWithdrawalResult()).toMatchObject({
    operationState: "IDLE",
    registration: { effectiveStatus: "WITHDRAWN", lateExitRecorded: true },
    game: { remainingSpots: 5 },
  });
});

test("returns deeply frozen snapshots and preserves normalized list scroll", () => {
  const store = createC2aRegistrationWithdrawalStore("APPLIED");
  const id = store.current().registration.registrationId;
  const snapshot = store.setListScrollTop(612.25);

  expect(snapshot.listScrollTop).toBe(612.25);
  expect(store.setListScrollTop(-5).listScrollTop).toBe(0);
  expect(store.setListScrollTop("bad").listScrollTop).toBe(0);
  expect(Object.isFrozen(snapshot)).toBe(true);
  expect(Object.isFrozen(snapshot.registration)).toBe(true);
  expect(Object.isFrozen(snapshot.game)).toBe(true);
  expect(Object.isFrozen(store.detail(id))).toBe(true);
});

test("unknown ids never select, open, or fall back to the only registration", () => {
  const store = createC2aRegistrationWithdrawalStore("APPLIED");
  const before = store.current();

  expect(store.detail("unknown")).toBeNull();
  expect(store.detail(null)).toBeNull();
  expect(store.selectRegistration("unknown")).toBe(false);
  expect(store.current().selectedRegistrationId).toBeNull();
  expect(store.openConfirmation("unknown")).toEqual(before);
  expect(store.current()).toEqual(before);

  expect(store.selectRegistration(before.registration.registrationId)).toBe(true);
  expect(store.current().selectedRegistrationId).toBe(before.registration.registrationId);
  expect(store.detail(before.registration.registrationId)).toMatchObject({
    registration: { registrationId: before.registration.registrationId },
  });
});
