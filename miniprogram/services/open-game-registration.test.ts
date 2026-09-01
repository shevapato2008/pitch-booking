/// <reference types="node" />
import { describe, expect, jest, test } from "@jest/globals";
import { readFileSync } from "node:fs";

import {
  decodeOpenGameApplicationDecisionResult,
  decodeOpenGameApplicationQueue,
  decodeOpenGameAttendanceMarkResult,
  decodeOpenGameAttendanceRoster,
  decodeOpenGameMemberRemovalResult,
  decodeOpenGameMemberRoster,
  decodeMyOpenGameApplications,
  decodeOpenGameRegistrationContext,
} from "../domain/open-game-registration-decoder";
import type {
  OpenGameApplicationDecisionResult,
  OpenGameApplicationQueue,
  OpenGameApplicationPage,
  OpenGameAttendanceMarkResult,
  OpenGameAttendanceRoster,
  OpenGameMemberRemovalResult,
  OpenGameMemberRoster,
  OpenGameRegistrationContext,
} from "../domain/open-game-registration";
import {
  classifyOpenGameAttendanceUnknownResult,
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
  type OpenGameAttendanceMarkAttempt,
  type OpenGameMemberRemoveAttempt,
  type OpenGameRegistrationDecisionAttempt,
  type OpenGameRegistrationSource,
  type OpenGameRegistrationWithdrawAttempt,
} from "./open-game-registration";

const USER_ID = "11111111-2222-4333-8444-555555555555";
const OTHER_USER_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const GAME_ID = "22222222-3333-4444-8555-666666666666";
const ATTENDANCE_GAME_ID = "30000000-0000-4000-8000-000000000201";
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
const contextJoined = decodeOpenGameRegistrationContext(
  fixture("open-game-registration-context-joined"),
);
const contextWithdrawnWaitlist = decodeOpenGameRegistrationContext(
  fixture("open-game-registration-context-withdrawn-waitlist"),
);
const queue = decodeOpenGameApplicationQueue(fixture("open-game-applications-pending"));
const decisionResult = decodeOpenGameApplicationDecisionResult(
  fixture("open-game-application-decision-joined"),
);
const mine = decodeMyOpenGameApplications(fixture("my-open-game-applications-ready"));
const decodedAttendanceRoster = decodeOpenGameAttendanceRoster(
  fixture("open-game-attendance-roster-ready"),
);
const attendanceMarkResult = decodeOpenGameAttendanceMarkResult(
  fixture("open-game-attendance-mark-present"),
);
const memberRoster = decodeOpenGameMemberRoster(fixture("open-game-member-roster-ready"));
const memberRemovalResult = decodeOpenGameMemberRemovalResult(
  fixture("open-game-member-removal-promoted"),
);

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
  submissionMode: "DIRECT_REGISTRATION",
  idempotencyKey: "application-key-00000000000001",
} as OpenGameRegistrationApplyAttempt;
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
const attendanceAttempt: OpenGameAttendanceMarkAttempt = {
  kind: "attendance",
  originatingUserId: USER_ID,
  gameId: ATTENDANCE_GAME_ID,
  registrationId: "40000000-0000-4000-8000-000000000201",
  attendanceStatus: "PRESENT",
  expectedVersion: 2,
  idempotencyKey: "attendance-key-00000000000001",
};
const removeMemberAttempt: OpenGameMemberRemoveAttempt = {
  kind: "remove-member",
  originatingUserId: USER_ID,
  gameId: memberRoster.game.id,
  registrationId: memberRoster.members[0].registrationId,
  expectedVersion: memberRoster.members[0].version,
  reason: "临时有事，双方已沟通",
  idempotencyKey: "remove-member-key-000000000001",
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
    getAttendanceRoster: async (gameId: string): Promise<OpenGameAttendanceRoster> => {
      expect(gameId).toBe(ATTENDANCE_GAME_ID);
      return decodedAttendanceRoster;
    },
    markAttendance: async (attempt: OpenGameAttendanceMarkAttempt): Promise<OpenGameAttendanceMarkResult> => {
      expect(attempt).toBe(attendanceAttempt);
      return attendanceMarkResult;
    },
    getMembers: async (gameId: string): Promise<OpenGameMemberRoster> => {
      expect(gameId).toBe(memberRoster.game.id);
      return memberRoster;
    },
    removeMember: async (
      attempt: OpenGameMemberRemoveAttempt,
    ): Promise<OpenGameMemberRemovalResult> => {
      expect(attempt).toBe(removeMemberAttempt);
      return memberRemovalResult;
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
    await expect(source.getAttendanceRoster(ATTENDANCE_GAME_ID))
      .resolves.toBe(decodedAttendanceRoster);
    await expect(source.markAttendance(attendanceAttempt)).resolves.toBe(attendanceMarkResult);
    await expect(source.getMembers(memberRoster.game.id)).resolves.toBe(memberRoster);
    await expect(source.removeMember(removeMemberAttempt)).resolves.toBe(memberRemovalResult);

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
    ["PUBLIC_PROFILE_REQUIRED", "CLEAR_AND_REOPEN_PROFILE", true],
    ["PUBLIC_PROFILE_CHANGED", "CLEAR_AND_REOPEN_PROFILE", true],
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

  test("clears an attendance attempt and refreshes roster after authoritative state change", () => {
    expect(classifyOpenGameRegistrationMutationResult("ATTENDANCE_STATE_CHANGED" as never))
      .toEqual({ kind: "CLEAR_AND_REFRESH_ROSTER", clearAttempt: true });
  });

  test("accepts apply authority only for a matching joined or waitlisted result", () => {
    for (const authority of [contextJoined, contextWaitlisted]) {
      expect(classifyOpenGameRegistrationUnknownResult(applyAttempt, authority)).toEqual({
        kind: "ACCEPT_AUTHORITY_AND_CLEAR",
        authority,
        clearAttempt: true,
      });
    }
    expect(classifyOpenGameRegistrationUnknownResult(applyAttempt, contextReady)).toEqual({
      kind: "REPLAY_SAME_ATTEMPT",
      attempt: applyAttempt,
      clearAttempt: false,
    });
  });

  test("accepts matching APPLIED authority only for a restored legacy apply attempt", () => {
    const legacyAttempt: OpenGameRegistrationApplyAttempt = {
      kind: "apply",
      originatingUserId: applyAttempt.originatingUserId,
      shareToken: applyAttempt.shareToken,
      body: applyAttempt.body,
      idempotencyKey: applyAttempt.idempotencyKey,
    };
    expect(classifyOpenGameRegistrationUnknownResult(legacyAttempt, contextApplied)).toEqual({
      kind: "ACCEPT_AUTHORITY_AND_CLEAR",
      authority: contextApplied,
      clearAttempt: true,
    });
    expect(classifyOpenGameRegistrationUnknownResult(applyAttempt, contextApplied)).toEqual({
      kind: "REPLAY_SAME_ATTEMPT",
      attempt: applyAttempt,
      clearAttempt: false,
    });
  });

  test.each([
    ["old pending application", contextApplied],
    ["withdrawn waitlist", contextWithdrawnWaitlist],
    ["captain-removed registration", {
      ...contextJoined,
      viewerRegistration: {
        ...contextJoined.viewerRegistration!,
        version: contextJoined.viewerRegistration!.version + 1,
        persistedStatus: "REMOVED" as const,
        effectiveStatus: "REMOVED" as const,
        removedAt: "2026-09-01T11:00:00+08:00",
        availableWithdrawalAction: null,
      },
    }],
    ["different active registration", {
      ...contextJoined,
      viewerRegistration: {
        ...contextJoined.viewerRegistration!,
        displayName: "另一位球员",
      },
    }],
  ] as const)("does not clear an unknown apply for %s authority", (_label, authority) => {
    expect(classifyOpenGameRegistrationUnknownResult(
      applyAttempt,
      authority as OpenGameRegistrationContext,
    )).toEqual({
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

  test("keeps an attendance attempt on its game and exposes the attendance recovery route", () => {
    expect(classifyOpenGameRegistrationPendingAttempt(
      attendanceAttempt,
      USER_ID,
      { kind: "attendance", gameId: ATTENDANCE_GAME_ID },
    )).toEqual({ kind: "READY", attempt: attendanceAttempt, clearAttempt: false });
    expect(classifyOpenGameRegistrationPendingAttempt(
      attendanceAttempt,
      USER_ID,
      {
        kind: "attendance",
        gameId: "33333333-4444-4555-8666-777777777777",
      } as never,
    )).toEqual({
      kind: "PRESERVE_AND_NAVIGATE",
      route: `/pages/captain-game-attendance/index?game_id=${ATTENDANCE_GAME_ID}`,
      clearAttempt: false,
    });
  });

  test("attendance recovery accepts the matching next version and replays only unchanged authority", () => {
    const matchingAuthority = {
      ...decodedAttendanceRoster,
      recordedCount: 3,
      attendanceComplete: true,
      registrations: decodedAttendanceRoster.registrations.map((item) => (
        item.registrationId === attendanceAttempt.registrationId
          ? {
            ...item,
            attendanceStatus: "PRESENT" as const,
            attendanceRecordedAt: "2026-08-30T20:36:00+08:00",
            version: 3,
          }
          : item
      )),
    };
    expect(classifyOpenGameAttendanceUnknownResult(attendanceAttempt, matchingAuthority)).toEqual({
      kind: "ACCEPT_AUTHORITY_AND_CLEAR",
      authority: matchingAuthority,
      clearAttempt: true,
    });
    expect(classifyOpenGameAttendanceUnknownResult(
      attendanceAttempt,
      decodedAttendanceRoster,
    )).toEqual({
      kind: "REPLAY_SAME_ATTEMPT",
      attempt: attendanceAttempt,
      clearAttempt: false,
    });
  });

  test.each([
    ["opposite result", {
      ...decodedAttendanceRoster.registrations[0],
      attendanceStatus: "NO_SHOW" as const,
      attendanceRecordedAt: "2026-08-30T20:36:00+08:00",
      version: 3,
    }],
    ["advanced unmarked version", {
      ...decodedAttendanceRoster.registrations[0],
      version: 3,
    }],
    ["same result at another version", {
      ...decodedAttendanceRoster.registrations[0],
      attendanceStatus: "PRESENT" as const,
      attendanceRecordedAt: "2026-08-30T20:36:00+08:00",
      version: 4,
    }],
  ] as const)("attendance recovery clears and displays %s authority", (_label, item) => {
    const changedAuthority = {
      ...decodedAttendanceRoster,
      recordedCount: item.attendanceStatus === "UNMARKED" ? 2 : 3,
      attendanceComplete: item.attendanceStatus !== "UNMARKED",
      registrations: decodedAttendanceRoster.registrations.map((registration) => (
        registration.registrationId === attendanceAttempt.registrationId ? item : registration
      )),
    };
    expect(classifyOpenGameAttendanceUnknownResult(
      attendanceAttempt,
      changedAuthority,
    )).toEqual({
      kind: "ACCEPT_AUTHORITY_AND_CLEAR",
      authority: changedAuthority,
      clearAttempt: true,
    });
  });

  test("attendance recovery clears when the registration is no longer authoritative roster data", () => {
    const changedAuthority = {
      ...decodedAttendanceRoster,
      totalCount: 2,
      recordedCount: 2,
      attendanceComplete: true,
      registrations: decodedAttendanceRoster.registrations.filter(
        (item) => item.registrationId !== attendanceAttempt.registrationId,
      ),
    };
    expect(classifyOpenGameAttendanceUnknownResult(
      attendanceAttempt,
      changedAuthority,
    )).toEqual({
      kind: "ACCEPT_AUTHORITY_AND_CLEAR",
      authority: changedAuthority,
      clearAttempt: true,
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
