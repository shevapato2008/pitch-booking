/// <reference types="node" />
/* eslint-disable @typescript-eslint/no-explicit-any */

import { existsSync } from "node:fs";
import { expect, jest, test } from "@jest/globals";

const sourcePath = "miniprogram/dev/c2b-waitlist-fixture.ts";

function loadFixture(): any {
  expect(existsSync(sourcePath)).toBe(true);
  if (!existsSync(sourcePath)) throw new Error("C2b waitlist fixture is missing");
  return jest.requireActual("./c2b-waitlist-fixture");
}

test("declares one isolated five-scenario C2b fixture", () => {
  const fixture = loadFixture();
  expect(fixture.C2B_WAITLIST_FIXTURE).toMatchObject({
    marker: "C2B_WAITLIST_FIXTURE",
    notice: expect.stringMatching(/C2b.*模拟数据/),
    deletionCondition: expect.stringMatching(/production/i),
  });
  expect(fixture.C2B_WAITLIST_SCENARIOS).toEqual([
    "FULL_REVIEW",
    "WAITLISTED_FIRST",
    "PROMOTED",
    "WAITLIST_WITHDRAW_CONFIRM",
    "BLOCKED_SUSPENDED",
  ]);
  expect(Object.isFrozen(fixture.C2B_WAITLIST_FIXTURE)).toBe(true);
});

test("captain cancellation preserves APPLIED while a confirmed waitlist decision appends FIFO", () => {
  const { createC2bWaitlistStore } = loadFixture();
  const store = createC2bWaitlistStore("FULL_REVIEW");
  const before = store.current();

  expect(before).toMatchObject({
    scenario: "FULL_REVIEW",
    applicant: { persistedStatus: "APPLIED", waitlistSeq: null, waitlistPosition: null },
    game: { currentPlayers: 14, plannedPlayers: 14, remainingSpots: 0 },
    canWaitlist: true,
    canReject: true,
  });
  store.openCaptainDecision("WAITLIST");
  expect(store.current().captainPanel).toBe("WAITLIST");
  store.closeCaptainDecision();
  expect(store.current().applicant.persistedStatus).toBe("APPLIED");

  store.openCaptainDecision("WAITLIST");
  const waitlisted = store.confirmCaptainDecision();
  expect(waitlisted).toMatchObject({
    captainPanel: null,
    canWaitlist: false,
    applicant: { persistedStatus: "WAITLISTED", waitlistSeq: 42, waitlistPosition: 2 },
    game: { currentPlayers: 14, remainingSpots: 0 },
  });
});

test("captain rejection is a real terminal transition", () => {
  const { createC2bWaitlistStore } = loadFixture();
  const store = createC2bWaitlistStore("FULL_REVIEW");
  store.openCaptainDecision("REJECT");
  expect(store.confirmCaptainDecision()).toMatchObject({
    applicant: { persistedStatus: "REJECTED", effectiveStatus: "REJECTED" },
    canReject: false,
    canWaitlist: false,
  });
});

test("withdrawing from waitlist preserves capacity and reprojects positions without rewriting sequence", () => {
  const { createC2bWaitlistStore } = loadFixture();
  const store = createC2bWaitlistStore("WAITLISTED_FIRST");
  const id = store.current().applicant.registrationId;
  const before = store.current();
  expect(before.activeWaitlist.map((item: any) => [item.waitlistSeq, item.waitlistPosition])).toEqual([
    [41, 1],
    [42, 2],
  ]);

  store.openWaitlistWithdrawal(id);
  expect(store.current().operationState).toBe("WITHDRAW_CONFIRMING");
  store.cancelWaitlistWithdrawal();
  expect(store.current().applicant.persistedStatus).toBe("WAITLISTED");

  store.openWaitlistWithdrawal(id);
  const withdrawn = store.confirmWaitlistWithdrawal();
  expect(withdrawn).toMatchObject({
    applicant: {
      persistedStatus: "WITHDRAWN",
      withdrawalKind: "WAITLIST_WITHDRAWAL",
      waitlistSeq: 41,
      waitlistPosition: null,
    },
    game: { currentPlayers: 14, remainingSpots: 0 },
  });
  expect(withdrawn.activeWaitlist.map((item: any) => [item.waitlistSeq, item.waitlistPosition])).toEqual([[42, 1]]);
  expect(store.confirmWaitlistWithdrawal()).toEqual(withdrawn);
});

test("a joined exit promotes exactly the FIFO head and never exposes a transient empty spot", () => {
  const { createC2bWaitlistStore } = loadFixture();
  const store = createC2bWaitlistStore("WAITLISTED_FIRST");
  const promoted = store.promoteAfterJoinedExit();

  expect(promoted).toMatchObject({
    applicant: {
      persistedStatus: "JOINED",
      effectiveStatus: "JOINED",
      waitlistSeq: 41,
      waitlistPosition: null,
      promotedAt: expect.any(String),
    },
    exitingMember: { persistedStatus: "WITHDRAWN" },
    game: { currentPlayers: 14, plannedPlayers: 14, remainingSpots: 0 },
    promotionEventRecorded: true,
  });
  expect(promoted.activeWaitlist.map((item: any) => [item.waitlistSeq, item.waitlistPosition])).toEqual([[42, 1]]);
  expect(store.promoteAfterJoinedExit()).toEqual(promoted);
});

test("suspended games keep waitlist exit available while automatic promotion stays frozen", () => {
  const { createC2bWaitlistStore } = loadFixture();
  const store = createC2bWaitlistStore("BLOCKED_SUSPENDED");
  const before = store.current();
  expect(before).toMatchObject({
    game: { state: "SUSPENDED" },
    applicant: { effectiveStatus: "WAITLISTED" },
    availableWithdrawalAction: "WITHDRAW_WAITLIST",
  });
  store.openWaitlistWithdrawal(before.applicant.registrationId);
  expect(store.current().operationState).toBe("WITHDRAW_CONFIRMING");
  store.cancelWaitlistWithdrawal();
  expect(store.promoteAfterJoinedExit()).toEqual(store.current());
  store.openWaitlistWithdrawal(before.applicant.registrationId);
  expect(store.confirmWaitlistWithdrawal().applicant.persistedStatus).toBe("WITHDRAWN");
});

test("unknown ids are inert, scroll is normalized, and snapshots are deeply frozen", () => {
  const { createC2bWaitlistStore } = loadFixture();
  const store = createC2bWaitlistStore("WAITLISTED_FIRST");
  const before = store.current();
  expect(store.selectRegistration("unknown")).toBe(false);
  expect(store.detail("unknown")).toBeNull();
  expect(store.openWaitlistWithdrawal("unknown")).toEqual(before);
  expect(store.setListScrollTop(318.5).listScrollTop).toBe(318.5);
  expect(store.setListScrollTop(-1).listScrollTop).toBe(0);
  const snapshot = store.current();
  expect(Object.isFrozen(snapshot)).toBe(true);
  expect(Object.isFrozen(snapshot.applicant)).toBe(true);
  expect(Object.isFrozen(snapshot.activeWaitlist)).toBe(true);
});
