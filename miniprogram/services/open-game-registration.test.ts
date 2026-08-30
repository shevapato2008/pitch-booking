/// <reference types="node" />
import { describe, expect, jest, test } from "@jest/globals";
import { readFileSync } from "node:fs";

import {
  decodeOpenGameApplicationDecisionResult,
  decodeOpenGameApplicationQueue,
  decodeMyOpenGameApplications,
  decodeOpenGameRegistrationContext,
} from "../domain/open-game-registration-decoder";
import type {
  OpenGameApplicationDecisionResult,
  OpenGameApplicationQueue,
  OpenGameApplicationPage,
  OpenGameRegistrationContext,
} from "../domain/open-game-registration";
import {
  classifyOpenGameRegistrationMutationResult,
  classifyOpenGameRegistrationPendingAttempt,
  classifyOpenGameRegistrationUnknownResult,
  getOpenGameRegistrationAttemptStore,
  getOpenGameRegistrationSource,
  registerOpenGameRegistrationAttemptStore,
  registerOpenGameRegistrationSource,
  resetOpenGameRegistrationAttemptStoreForTesting,
  resetOpenGameRegistrationSourceForTesting,
  type OpenGameRegistrationApplyAttempt,
  type OpenGameRegistrationAttempt,
  type OpenGameRegistrationAttemptStore,
  type OpenGameRegistrationDecisionAttempt,
  type OpenGameRegistrationSource,
  type OpenGameRegistrationWithdrawAttempt,
} from "./open-game-registration";

const USER_ID = "11111111-2222-4333-8444-555555555555";
const OTHER_USER_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const GAME_ID = "22222222-3333-4444-8555-666666666666";
const SHARE_TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz_12345";

const fixture = (name: string): Record<string, unknown> => JSON.parse(
  readFileSync(`contracts/examples/${name}.json`, "utf8"),
) as Record<string, unknown>;

const contextReady = decodeOpenGameRegistrationContext(
  fixture("open-game-registration-context-apply-ready"),
);
const contextApplied = decodeOpenGameRegistrationContext(
  fixture("open-game-registration-context-applied"),
);
const contextWaitlisted = decodeOpenGameRegistrationContext(
  fixture("open-game-registration-context-waitlisted"),
);
const contextWithdrawnWaitlist = decodeOpenGameRegistrationContext(
  fixture("open-game-registration-context-withdrawn-waitlist"),
);
const queue = decodeOpenGameApplicationQueue(fixture("open-game-applications-pending"));
const decisionResult = decodeOpenGameApplicationDecisionResult(
  fixture("open-game-application-decision-joined"),
);
const mine = decodeMyOpenGameApplications(fixture("my-open-game-applications-ready"));

const applyAttempt: OpenGameRegistrationApplyAttempt = {
  kind: "apply",
  originatingUserId: USER_ID,
  shareToken: SHARE_TOKEN,
  body: {
    displayName: "周末小翼",
    position: "FORWARD",
    note: "可以补边路，按时到场。",
    adultConfirmed: true,
    riskConfirmed: true,
  },
  idempotencyKey: "application-key-00000000000001",
};
const decisionAttempt: OpenGameRegistrationDecisionAttempt = {
  kind: "decision",
  originatingUserId: USER_ID,
  gameId: GAME_ID,
  applicationId: "77777777-8888-4999-8aaa-bbbbbbbbbbbb",
  decision: "ACCEPT",
  expectedVersion: 1,
  idempotencyKey: "decision-key-0000000000000001",
};
const withdrawAttempt: OpenGameRegistrationWithdrawAttempt = {
  kind: "withdraw",
  originatingUserId: USER_ID,
  shareToken: SHARE_TOKEN,
  applicationId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  action: "WITHDRAW_APPLICATION",
  expectedVersion: 1,
  idempotencyKey: "withdraw-key-0000000000000001",
};
const waitlistDecisionAttempt = {
  ...decisionAttempt,
  decision: "WAITLIST" as const,
};
const waitlistWithdrawAttempt = {
  ...withdrawAttempt,
  applicationId: contextWaitlisted.viewerRegistration!.id,
  action: "WITHDRAW_WAITLIST" as const,
  expectedVersion: 2,
};

const appliedWithWithdrawal = {
  ...contextApplied,
  viewerRegistration: {
    ...contextApplied.viewerRegistration!,
    id: withdrawAttempt.applicationId,
    version: 1,
    withdrawnAt: null,
    withdrawalKind: null,
    lateExitRecorded: false,
    availableWithdrawalAction: "WITHDRAW_APPLICATION" as const,
    lateExitWillBeRecorded: false,
  },
};
const withdrawnAuthority = {
  ...appliedWithWithdrawal,
  viewerRegistration: {
    ...appliedWithWithdrawal.viewerRegistration,
    version: 2,
    persistedStatus: "WITHDRAWN" as const,
    effectiveStatus: "WITHDRAWN" as const,
    withdrawnAt: "2026-08-24T00:30:00+08:00",
    withdrawalKind: "APPLICATION_WITHDRAWAL" as const,
    availableWithdrawalAction: null,
  },
};

function fakeSource(): OpenGameRegistrationSource {
  return {
    login: async (): Promise<string> => USER_ID,
    currentUserId: (): string | null => USER_ID,
    listMine: async (cursor?: string, limit?: number): Promise<OpenGameApplicationPage> => {
      expect(cursor).toBe("opaque-cursor");
      expect(limit).toBe(20);
      return mine;
    },
    getContext: async (shareToken: string): Promise<OpenGameRegistrationContext> => {
      expect(shareToken).toBe(SHARE_TOKEN);
      return contextReady;
    },
    apply: async (attempt: OpenGameRegistrationApplyAttempt): Promise<OpenGameRegistrationContext> => {
      expect(attempt).toBe(applyAttempt);
      return contextApplied;
    },
    getPending: async (gameId: string): Promise<OpenGameApplicationQueue> => {
      expect(gameId).toBe(GAME_ID);
      return queue;
    },
    decide: async (attempt: OpenGameRegistrationDecisionAttempt): Promise<OpenGameApplicationDecisionResult> => {
      expect(attempt).toBe(decisionAttempt);
      return decisionResult;
    },
    withdraw: async (attempt: OpenGameRegistrationWithdrawAttempt): Promise<OpenGameRegistrationContext> => {
      expect(attempt).toBe(withdrawAttempt);
      return withdrawnAuthority;
    },
  } satisfies OpenGameRegistrationSource;
}

function fakeStore(): OpenGameRegistrationAttemptStore {
  return {
    load: (): OpenGameRegistrationAttempt | null => null,
    begin: (attempt: OpenGameRegistrationAttempt) => ({ kind: "READY", attempt }),
    resolveForUser: (userId: string) => {
      expect(typeof userId).toBe("string");
      return null;
    },
    clear: (): void => undefined,
  } satisfies OpenGameRegistrationAttemptStore;
}

describe("open-game registration bindings", () => {
  test("exports the exact source shape and six registry functions", async () => {
    resetOpenGameRegistrationSourceForTesting();
    resetOpenGameRegistrationAttemptStoreForTesting();
    expect(() => getOpenGameRegistrationSource())
      .toThrow("OPEN_GAME_REGISTRATION_SOURCE_NOT_CONFIGURED");
    expect(() => getOpenGameRegistrationAttemptStore())
      .toThrow("OPEN_GAME_REGISTRATION_ATTEMPT_STORE_NOT_CONFIGURED");

    const source = fakeSource();
    const store = fakeStore();
    registerOpenGameRegistrationSource(source);
    registerOpenGameRegistrationAttemptStore(store);
    expect(getOpenGameRegistrationSource()).toBe(source);
    expect(getOpenGameRegistrationAttemptStore()).toBe(store);
    await expect(source.login()).resolves.toBe(USER_ID);
    expect(source.currentUserId()).toBe(USER_ID);
    await expect(source.listMine("opaque-cursor", 20)).resolves.toBe(mine);
    await expect(source.getContext(SHARE_TOKEN)).resolves.toBe(contextReady);
    await expect(source.apply(applyAttempt)).resolves.toBe(contextApplied);
    await expect(source.getPending(GAME_ID)).resolves.toBe(queue);
    await expect(source.decide(decisionAttempt)).resolves.toBe(decisionResult);
    await expect(source.withdraw(withdrawAttempt)).resolves.toBe(withdrawnAuthority);

    resetOpenGameRegistrationSourceForTesting();
    resetOpenGameRegistrationAttemptStoreForTesting();
  });
});

describe("open-game registration recovery", () => {
  test.each([
    ["SUCCESS", "ACCEPT_AUTHORITY_AND_CLEAR", true],
    ["AUTH_REQUIRED", "PRESERVE_LOGIN_COMPARE_ACCOUNT", false],
    ["LOGIN_FAILED", "PRESERVE_LOGIN_COMPARE_ACCOUNT", false],
    ["APPLICATION_RESULT_UNKNOWN", "PRESERVE_APPLICATION_RESULT_UNKNOWN", false],
    ["APPLICATION_ALREADY_EXISTS", "PRESERVE_READ_CONTEXT_THEN_CLEAR", false],
    ["APPLICATION_NOT_ALLOWED", "CLEAR_AND_REFRESH_CONTEXT", true],
    ["APPLICATION_STATE_CHANGED", "CLEAR_AND_REFRESH_QUEUE", true],
    ["APPLICATION_CAPACITY_CHANGED", "CLEAR_AND_REFRESH_QUEUE", true],
    ["IDEMPOTENCY_KEY_REUSED", "CLEAR_AND_SHOW_CONFLICT", true],
    ["INVALID_ARGUMENT", "CLEAR_AND_CORRECT_OR_REFRESH", true],
    ["OPEN_GAME_NOT_FOUND", "CLEAR_AND_RETURN", true],
    ["APPLICATION_NOT_FOUND", "CLEAR_AND_RETURN", true],
    ["SERVICE_UNAVAILABLE", "RETRY_READ", false],
  ] as const)("classifies %s as %s without inventing authority", (result, kind, clearAttempt) => {
    expect(classifyOpenGameRegistrationMutationResult(result)).toEqual({ kind, clearAttempt });
  });

  test("accepts authoritative apply context only when it contains the viewer registration", () => {
    expect(classifyOpenGameRegistrationUnknownResult(applyAttempt, contextApplied)).toEqual({
      kind: "ACCEPT_AUTHORITY_AND_CLEAR",
      authority: contextApplied,
      clearAttempt: true,
    });
    expect(classifyOpenGameRegistrationUnknownResult(applyAttempt, contextReady)).toEqual({
      kind: "REPLAY_SAME_ATTEMPT",
      attempt: applyAttempt,
      clearAttempt: false,
    });
  });

  test("replays an unknown decision with the exact stored attempt", () => {
    expect(classifyOpenGameRegistrationUnknownResult(decisionAttempt)).toEqual({
      kind: "REPLAY_SAME_ATTEMPT",
      attempt: decisionAttempt,
      clearAttempt: false,
    });
  });

  test("withdraw recovery accepts exact terminal authority, replays only unchanged authority, and clears changed authority", () => {
    expect(classifyOpenGameRegistrationUnknownResult(withdrawAttempt, withdrawnAuthority)).toEqual({
      kind: "ACCEPT_AUTHORITY_AND_CLEAR",
      authority: withdrawnAuthority,
      clearAttempt: true,
    });
    expect(classifyOpenGameRegistrationUnknownResult(withdrawAttempt, appliedWithWithdrawal)).toEqual({
      kind: "REPLAY_SAME_ATTEMPT",
      attempt: withdrawAttempt,
      clearAttempt: false,
    });
    const acceptedByCaptain = {
      ...appliedWithWithdrawal,
      viewerRegistration: {
        ...appliedWithWithdrawal.viewerRegistration,
        version: 2,
        persistedStatus: "JOINED" as const,
        effectiveStatus: "JOINED" as const,
        decidedAt: "2026-08-24T00:25:00+08:00",
        availableWithdrawalAction: "LEAVE_GAME" as const,
      },
    };
    expect(classifyOpenGameRegistrationUnknownResult(withdrawAttempt, acceptedByCaptain)).toEqual({
      kind: "ACCEPT_AUTHORITY_AND_CLEAR",
      authority: acceptedByCaptain,
      clearAttempt: true,
    });
  });

  test("reuses exact waitlist attempts and resolves only exact waitlist withdrawal authority", () => {
    expect(classifyOpenGameRegistrationUnknownResult(waitlistDecisionAttempt)).toEqual({
      kind: "REPLAY_SAME_ATTEMPT",
      attempt: waitlistDecisionAttempt,
      clearAttempt: false,
    });
    expect(classifyOpenGameRegistrationUnknownResult(
      waitlistWithdrawAttempt,
      contextWaitlisted,
    )).toEqual({
      kind: "REPLAY_SAME_ATTEMPT",
      attempt: waitlistWithdrawAttempt,
      clearAttempt: false,
    });
    expect(classifyOpenGameRegistrationUnknownResult(
      waitlistWithdrawAttempt,
      contextWithdrawnWaitlist,
    )).toEqual({
      kind: "ACCEPT_AUTHORITY_AND_CLEAR",
      authority: contextWithdrawnWaitlist,
      clearAttempt: true,
    });
  });

  test.each([
    [applyAttempt, { kind: "apply", shareToken: SHARE_TOKEN }],
    [decisionAttempt, { kind: "decision", gameId: GAME_ID }],
    [withdrawAttempt, { kind: "withdraw", shareToken: SHARE_TOKEN }],
  ] as const)("allows only a same-account pending attempt for the same resource", (attempt, target) => {
    expect(classifyOpenGameRegistrationPendingAttempt(attempt, USER_ID, target)).toEqual({
      kind: "READY",
      attempt,
      clearAttempt: false,
    });
  });

  test.each([
    [
      applyAttempt,
      { kind: "apply", shareToken: "1234567890_abcdefghijklmnopqrstu" },
      `/pages/captain-game-public/index?token=${SHARE_TOKEN}`,
    ],
    [
      decisionAttempt,
      { kind: "decision", gameId: "33333333-4444-4555-8666-777777777777" },
      `/pages/captain-game-applications/index?game_id=${GAME_ID}`,
    ],
    [
      withdrawAttempt,
      { kind: "withdraw", shareToken: "1234567890_abcdefghijklmnopqrstu" },
      `/pages/captain-game-public/index?token=${SHARE_TOKEN}`,
    ],
    [
      decisionAttempt,
      { kind: "apply", shareToken: SHARE_TOKEN },
      `/pages/captain-game-applications/index?game_id=${GAME_ID}`,
    ],
  ] as const)("preserves a same-account attempt for another resource and exposes its deterministic route", (
    attempt,
    target,
    route,
  ) => {
    expect(classifyOpenGameRegistrationPendingAttempt(attempt, USER_ID, target)).toEqual({
      kind: "PRESERVE_AND_NAVIGATE",
      route,
      clearAttempt: false,
    });
  });

  test("preserves an anonymous attempt for login and hides a foreign attempt from send paths", () => {
    expect(classifyOpenGameRegistrationPendingAttempt(applyAttempt, null, {
      kind: "apply",
      shareToken: SHARE_TOKEN,
    })).toEqual({ kind: "PRESERVE_LOGIN_COMPARE_ACCOUNT", clearAttempt: false });

    const foreign = classifyOpenGameRegistrationPendingAttempt(applyAttempt, OTHER_USER_ID, {
      kind: "apply",
      shareToken: SHARE_TOKEN,
    });
    const send = jest.fn((attemptToSend: OpenGameRegistrationAttempt) => attemptToSend.kind);
    if (foreign.kind === "READY") send(foreign.attempt);

    expect(foreign).toEqual({ kind: "FOREIGN_ACCOUNT_PENDING", clearAttempt: false });
    expect(foreign).not.toHaveProperty("attempt");
    expect(send).not.toHaveBeenCalled();
  });
});
