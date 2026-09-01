import { describe, expect, jest, test } from "@jest/globals";

import type { OpenGameApplicationSubmission } from "../domain/open-game-registration";
import { createOpenGameRegistrationAttemptStore } from "./open-game-registration-attempt-store";
import type {
  OpenGameRegistrationAttempt,
  OpenGameRegistrationAttemptStore,
} from "./open-game-registration";
import type { SessionStorage } from "./session-store";

const KEY = "modelstella.pitch-booking.open-game-registration-attempt.v1";
const USER_ID = "11111111-2222-4333-8444-555555555555";
const OTHER_USER_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const GAME_ID = "22222222-3333-4444-8555-666666666666";
const APPLICATION_ID = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
const SHARE_TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz_12345";

const body: OpenGameApplicationSubmission = {
  displayName: "周末小翼",
  position: "FORWARD",
  note: "可以补边路，按时到场。",
  adultConfirmed: true,
  riskConfirmed: true,
};

const applyAttempt = {
  kind: "apply" as const,
  originatingUserId: USER_ID,
  shareToken: SHARE_TOKEN,
  body,
  idempotencyKey: "application-key-00000000000001",
};
const directRegistrationAttempt = {
  ...applyAttempt,
  submissionMode: "DIRECT_REGISTRATION" as const,
  idempotencyKey: "direct-registration-key-000000001",
};

const decisionAttempt = {
  kind: "decision" as const,
  originatingUserId: USER_ID,
  gameId: GAME_ID,
  applicationId: APPLICATION_ID,
  decision: "ACCEPT" as const,
  expectedVersion: 1,
  idempotencyKey: "decision-key-0000000000000001",
};

const withdrawAttempt = {
  kind: "withdraw" as const,
  originatingUserId: USER_ID,
  shareToken: SHARE_TOKEN,
  applicationId: APPLICATION_ID,
  action: "WITHDRAW_APPLICATION" as const,
  expectedVersion: 1,
  idempotencyKey: "withdraw-key-0000000000000001",
};

const attendanceAttempt = {
  kind: "attendance" as const,
  originatingUserId: USER_ID,
  gameId: GAME_ID,
  registrationId: APPLICATION_ID,
  attendanceStatus: "PRESENT" as const,
  expectedVersion: 2,
  idempotencyKey: "attendance-key-00000000000001",
};

const removeMemberAttempt = {
  kind: "remove-member" as const,
  originatingUserId: USER_ID,
  gameId: GAME_ID,
  registrationId: APPLICATION_ID,
  expectedVersion: 2,
  reason: "临时有事，双方已沟通",
  idempotencyKey: "remove-member-key-000000000001",
};

const allowReapplyAttempt = {
  kind: "allow-reapply" as const,
  originatingUserId: USER_ID,
  shareToken: SHARE_TOKEN,
  gameId: GAME_ID,
  registrationId: APPLICATION_ID,
  expectedVersion: 3,
  idempotencyKey: "allow-reapply-key-000000000001",
};

function memoryStorage(initial: ReadonlyArray<readonly [string, unknown]> = []) {
  const values = new Map<string, unknown>(initial);
  return {
    values,
    get: jest.fn((key: string) => values.get(key)),
    set: jest.fn((key: string, value: unknown) => { values.set(key, value); }),
    remove: jest.fn((key: string) => { values.delete(key); }),
  };
}

describe("OpenGameRegistrationAttemptStore", () => {
  test("implements the concrete store API and persists one canonical defensive apply attempt", () => {
    const backing = memoryStorage();
    const storage: SessionStorage = backing;
    const store: OpenGameRegistrationAttemptStore = createOpenGameRegistrationAttemptStore(storage);
    const mutable = structuredClone(applyAttempt);

    const resolution = store.begin(mutable);
    (mutable as { body: { displayName: string } }).body.displayName = "已修改输入";
    (resolution.attempt as { body: { displayName: string } }).body.displayName = "已修改返回值";

    expect(backing.set).toHaveBeenCalledTimes(1);
    expect(backing.set).toHaveBeenCalledWith(KEY, applyAttempt);
    expect(store.load()).toEqual(applyAttempt);
    expect(store.load()).not.toBe(store.load());
    const restored = store.load();
    if (restored?.kind !== "apply") throw new Error("expected an apply attempt");
    expect(restored.body).not.toBe(body);
  });

  test("persists the direct-registration mode and never reuses a legacy apply key for it", () => {
    const storage = memoryStorage();
    const store = createOpenGameRegistrationAttemptStore(storage);
    expect(store.begin(directRegistrationAttempt as unknown as OpenGameRegistrationAttempt))
      .toEqual({ kind: "READY", attempt: directRegistrationAttempt });
    expect(store.load()).toEqual(directRegistrationAttempt);

    store.clear();
    store.begin(applyAttempt);
    expect(store.begin(directRegistrationAttempt as unknown as OpenGameRegistrationAttempt)).toEqual({
      kind: "SAME_ACCOUNT_PENDING",
      attempt: applyAttempt,
    });
  });

  test("accepts a one-character public nickname only for direct registration attempts", () => {
    const oneCharacter = {
      ...applyAttempt,
      body: { ...body, displayName: "翼" },
    };
    const storage = memoryStorage();
    const store = createOpenGameRegistrationAttemptStore(storage);

    expect(() => store.begin(oneCharacter)).toThrow("INVALID_OPEN_GAME_REGISTRATION_ATTEMPT");
    const direct = { ...oneCharacter, submissionMode: "DIRECT_REGISTRATION" as const };
    expect(store.begin(direct)).toEqual({ kind: "READY", attempt: direct });
    expect(createOpenGameRegistrationAttemptStore(storage).load()).toEqual(direct);
  });

  test("restores every canonical attempt through a new factory instance", () => {
    for (const attempt of [
      applyAttempt,
      decisionAttempt,
      withdrawAttempt,
      attendanceAttempt,
      removeMemberAttempt,
    ] satisfies readonly OpenGameRegistrationAttempt[]) {
      const storage = memoryStorage();
      createOpenGameRegistrationAttemptStore(storage).begin(attempt);

      expect(createOpenGameRegistrationAttemptStore(storage).load()).toEqual(attempt);
    }
  });

  test("reuses the original key for the same account and canonical mutation without rewriting", () => {
    const storage = memoryStorage();
    const store = createOpenGameRegistrationAttemptStore(storage);
    store.begin(applyAttempt);
    const reorderedBody = Object.fromEntries(Object.entries(body).reverse());
    const reorderedAttempt = {
      idempotencyKey: "replacement-key-0000000000001",
      body: reorderedBody,
      shareToken: SHARE_TOKEN,
      originatingUserId: USER_ID,
      kind: "apply" as const,
    } as OpenGameRegistrationAttempt;

    expect(store.begin(reorderedAttempt)).toEqual({ kind: "READY", attempt: applyAttempt });
    expect(storage.set).toHaveBeenCalledTimes(1);
  });

  test("reuses the exact withdrawal mutation while treating action, version, resource, and account changes as conflicts", () => {
    const storage = memoryStorage();
    const store = createOpenGameRegistrationAttemptStore(storage);
    store.begin(withdrawAttempt);

    expect(store.begin({ ...withdrawAttempt, idempotencyKey: "replacement-withdraw-key-000001" }))
      .toEqual({ kind: "READY", attempt: withdrawAttempt });
    for (const changed of [
      { ...withdrawAttempt, action: "LEAVE_GAME" as const },
      { ...withdrawAttempt, expectedVersion: 2 },
      { ...withdrawAttempt, applicationId: "88888888-8888-4888-8aaa-bbbbbbbbbbbb" },
      { ...withdrawAttempt, shareToken: "1234567890_abcdefghijklmnopqrstu" },
    ]) expect(store.begin(changed)).toEqual({ kind: "SAME_ACCOUNT_PENDING", attempt: withdrawAttempt });
    expect(store.begin({ ...withdrawAttempt, originatingUserId: OTHER_USER_ID }))
      .toEqual({ kind: "FOREIGN_ACCOUNT_PENDING", attempt: withdrawAttempt });
    expect(storage.set).toHaveBeenCalledTimes(1);
  });

  test("reuses an exact waitlist decision but never changes its key, target, version, decision, or account", () => {
    const waitlistAttempt = {
      ...decisionAttempt,
      decision: "WAITLIST" as const,
    };
    const storage = memoryStorage();
    const store = createOpenGameRegistrationAttemptStore(storage);
    store.begin(waitlistAttempt);

    expect(store.begin({
      ...waitlistAttempt,
      idempotencyKey: "replacement-waitlist-key-000001",
    })).toEqual({ kind: "READY", attempt: waitlistAttempt });
    for (const changed of [
      { ...waitlistAttempt, decision: "ACCEPT" as const },
      { ...waitlistAttempt, expectedVersion: 2 },
      { ...waitlistAttempt, applicationId: "88888888-8888-4888-8aaa-bbbbbbbbbbbb" },
      { ...waitlistAttempt, gameId: "33333333-4444-4555-8666-777777777777" },
    ]) {
      expect(store.begin(changed)).toEqual({
        kind: "SAME_ACCOUNT_PENDING",
        attempt: waitlistAttempt,
      });
    }
    expect(store.begin({ ...waitlistAttempt, originatingUserId: OTHER_USER_ID }))
      .toEqual({ kind: "FOREIGN_ACCOUNT_PENDING", attempt: waitlistAttempt });
    expect(storage.set).toHaveBeenCalledTimes(1);
  });

  test("reuses the original attendance key and never overwrites another attendance mutation", () => {
    const storage = memoryStorage();
    const store = createOpenGameRegistrationAttemptStore(storage);
    store.begin(attendanceAttempt);

    expect(store.begin({
      ...attendanceAttempt,
      idempotencyKey: "replacement-attendance-key-0001",
    })).toEqual({
      kind: "READY",
      attempt: attendanceAttempt,
    });
    for (const changed of [
      { ...attendanceAttempt, attendanceStatus: "NO_SHOW" as const },
      { ...attendanceAttempt, expectedVersion: 3 },
      { ...attendanceAttempt, registrationId: "88888888-8888-4888-8aaa-bbbbbbbbbbbb" },
      { ...attendanceAttempt, gameId: "33333333-4444-4555-8666-777777777777" },
    ]) {
      expect(store.begin(changed)).toEqual({
        kind: "SAME_ACCOUNT_PENDING",
        attempt: attendanceAttempt,
      });
    }
    expect(store.begin({
      ...attendanceAttempt,
      originatingUserId: OTHER_USER_ID,
    })).toEqual({
      kind: "FOREIGN_ACCOUNT_PENDING",
      attempt: attendanceAttempt,
    });
    expect(store.load()).toEqual(attendanceAttempt);
    expect(storage.set).toHaveBeenCalledTimes(1);
  });

  test("reuses only the exact normalized member removal mutation", () => {
    const storage = memoryStorage();
    const store = createOpenGameRegistrationAttemptStore(storage);
    store.begin(removeMemberAttempt);

    expect(store.begin({
      ...removeMemberAttempt,
      idempotencyKey: "replacement-remove-member-key-001",
    })).toEqual({ kind: "READY", attempt: removeMemberAttempt });
    for (const changed of [
      { ...removeMemberAttempt, reason: "队员临时退出" },
      { ...removeMemberAttempt, expectedVersion: 3 },
      { ...removeMemberAttempt, registrationId: "88888888-8888-4888-8aaa-bbbbbbbbbbbb" },
      { ...removeMemberAttempt, gameId: "33333333-4444-4555-8666-777777777777" },
    ]) expect(store.begin(changed)).toEqual({
      kind: "SAME_ACCOUNT_PENDING",
      attempt: removeMemberAttempt,
    });
  });

  test("persists and reuses only the exact allow-reapply mutation", () => {
    const storage = memoryStorage();
    const store = createOpenGameRegistrationAttemptStore(storage);

    expect(store.begin(allowReapplyAttempt as unknown as OpenGameRegistrationAttempt))
      .toEqual({ kind: "READY", attempt: allowReapplyAttempt });
    expect(store.begin({
      ...allowReapplyAttempt,
      idempotencyKey: "replacement-allow-reapply-key-001",
    } as unknown as OpenGameRegistrationAttempt)).toEqual({
      kind: "READY",
      attempt: allowReapplyAttempt,
    });
    for (const changed of [
      { ...allowReapplyAttempt, expectedVersion: 4 },
      { ...allowReapplyAttempt, registrationId: "88888888-8888-4888-8aaa-bbbbbbbbbbbb" },
      { ...allowReapplyAttempt, gameId: "33333333-4444-4555-8666-777777777777" },
      { ...allowReapplyAttempt, shareToken: "1234567890_abcdefghijklmnopqrstu" },
    ]) expect(store.begin(changed as unknown as OpenGameRegistrationAttempt)).toEqual({
      kind: "SAME_ACCOUNT_PENDING",
      attempt: allowReapplyAttempt,
    });
    expect(store.load()).toEqual(allowReapplyAttempt);
    expect(storage.set).toHaveBeenCalledTimes(1);
  });

  test("distinguishes same-account pending mutations from foreign-account pending attempts", () => {
    const storage = memoryStorage();
    const store = createOpenGameRegistrationAttemptStore(storage);
    store.begin(applyAttempt);

    expect(store.begin({ ...applyAttempt, shareToken: "1234567890_abcdefghijklmnopqrstu" }))
      .toEqual({ kind: "SAME_ACCOUNT_PENDING", attempt: applyAttempt });
    expect(store.begin({ ...applyAttempt, originatingUserId: OTHER_USER_ID }))
      .toEqual({ kind: "FOREIGN_ACCOUNT_PENDING", attempt: applyAttempt });
    expect(storage.set).toHaveBeenCalledTimes(1);
  });

  test("resolves only the owning account as replayable and never rebinds a foreign attempt", () => {
    const storage = memoryStorage();
    const store = createOpenGameRegistrationAttemptStore(storage);

    expect(store.resolveForUser(USER_ID)).toBeNull();
    store.begin(decisionAttempt);
    expect(store.resolveForUser(USER_ID)).toEqual({ kind: "READY", attempt: decisionAttempt });
    expect(store.resolveForUser(OTHER_USER_ID)).toEqual({
      kind: "FOREIGN_ACCOUNT_PENDING",
      attempt: decisionAttempt,
    });
    expect(store.load()).toEqual(decisionAttempt);
    expect(storage.set).toHaveBeenCalledTimes(1);

    const resolved = store.resolveForUser(USER_ID);
    if (resolved?.kind !== "READY") throw new Error("expected an owned attempt");
    (resolved.attempt as { idempotencyKey: string }).idempotencyKey = "mutated-resolution-key-000001";
    expect(store.load()).toEqual(decisionAttempt);
  });

  test.each([
    ["apply", applyAttempt],
    ["direct registration", directRegistrationAttempt],
    ["decision", decisionAttempt],
    ["withdraw application", withdrawAttempt],
    ["leave game", { ...withdrawAttempt, action: "LEAVE_GAME" }],
    ["withdraw waitlist", { ...withdrawAttempt, action: "WITHDRAW_WAITLIST" }],
    ["reject decision", { ...decisionAttempt, decision: "REJECT" }],
    ["waitlist decision", { ...decisionAttempt, decision: "WAITLIST" }],
    ["mark present attendance", attendanceAttempt],
    ["mark no-show attendance", { ...attendanceAttempt, attendanceStatus: "NO_SHOW" }],
    ["remove joined member", removeMemberAttempt],
    ["allow removed member to reapply", allowReapplyAttempt],
    ["null note", { ...applyAttempt, body: { ...body, note: null } }],
    ["goalkeeper", { ...applyAttempt, body: { ...body, position: "GOALKEEPER" } }],
    ["defender", { ...applyAttempt, body: { ...body, position: "DEFENDER" } }],
    ["midfielder", { ...applyAttempt, body: { ...body, position: "MIDFIELDER" } }],
    ["forward", { ...applyAttempt, body: { ...body, position: "FORWARD" } }],
    ["any", { ...applyAttempt, body: { ...body, position: "ANY" } }],
  ] as const)("accepts the closed canonical %s shape", (_label, attempt) => {
    const store = createOpenGameRegistrationAttemptStore(memoryStorage());
    expect(store.begin(attempt as OpenGameRegistrationAttempt)).toMatchObject({ kind: "READY" });
  });

  test.each([
    ["extra attempt property", { ...applyAttempt, extra: true }],
    ["unknown attempt kind", { ...applyAttempt, kind: "cancel" }],
    ["invalid originating user", { ...applyAttempt, originatingUserId: "not-a-uuid" }],
    ["short share token", { ...applyAttempt, shareToken: SHARE_TOKEN.slice(1) }],
    ["unsafe share token", { ...applyAttempt, shareToken: `${SHARE_TOKEN.slice(0, 31)}!` }],
    ["short key", { ...applyAttempt, idempotencyKey: "short" }],
    ["long key", { ...applyAttempt, idempotencyKey: "a".repeat(129) }],
    ["non-ASCII key", { ...applyAttempt, idempotencyKey: "报名-key-000000000000" }],
    ["extra body property", { ...applyAttempt, body: { ...body, extra: true } }],
    ["short display name", { ...applyAttempt, body: { ...body, displayName: "翼" } }],
    ["long display name", { ...applyAttempt, body: { ...body, displayName: "翼".repeat(25) } }],
    ["trimmed display name", { ...applyAttempt, body: { ...body, displayName: " 周末小翼 " } }],
    ["private display name", { ...applyAttempt, body: { ...body, displayName: "微信 pitch_friend" } }],
    ["long note", { ...applyAttempt, body: { ...body, note: "球".repeat(121) } }],
    ["unknown position", { ...applyAttempt, body: { ...body, position: "SWEEPER" } }],
    ["non-strict adult confirmation", { ...applyAttempt, body: { ...body, adultConfirmed: 1 } }],
    ["missing risk confirmation", { ...applyAttempt, body: { ...body, riskConfirmed: false } }],
    ["invalid game id", { ...decisionAttempt, gameId: "not-a-uuid" }],
    ["invalid application id", { ...decisionAttempt, applicationId: "not-a-uuid" }],
    ["unknown decision", { ...decisionAttempt, decision: "PROMOTE_FROM_WAITLIST" }],
    ["zero expected version", { ...decisionAttempt, expectedVersion: 0 }],
    ["unsafe expected version", { ...decisionAttempt, expectedVersion: Number.MAX_SAFE_INTEGER + 1 }],
    ["withdraw missing token", { ...withdrawAttempt, shareToken: undefined }],
    ["withdraw invalid application id", { ...withdrawAttempt, applicationId: "not-a-uuid" }],
    ["withdraw unknown action", { ...withdrawAttempt, action: "AUTO" }],
    ["withdraw zero expected version", { ...withdrawAttempt, expectedVersion: 0 }],
    ["attendance invalid game id", { ...attendanceAttempt, gameId: "not-a-uuid" }],
    ["attendance invalid registration id", {
      ...attendanceAttempt, registrationId: "not-a-uuid",
    }],
    ["attendance unmarked result", { ...attendanceAttempt, attendanceStatus: "UNMARKED" }],
    ["attendance unknown result", { ...attendanceAttempt, attendanceStatus: "LATE" }],
    ["attendance zero expected version", { ...attendanceAttempt, expectedVersion: 0 }],
    ["removal empty reason", { ...removeMemberAttempt, reason: "" }],
    ["removal untrimmed reason", { ...removeMemberAttempt, reason: " 原因 " }],
    ["removal private reason", { ...removeMemberAttempt, reason: "微信 wx_friend" }],
    ["removal long reason", { ...removeMemberAttempt, reason: "球".repeat(121) }],
    ["allow-reapply missing token", { ...allowReapplyAttempt, shareToken: undefined }],
    ["allow-reapply invalid registration", {
      ...allowReapplyAttempt, registrationId: "not-a-uuid",
    }],
  ])("rejects an invalid begin with zero persistence writes: %s", (_label, invalid) => {
    const storage = memoryStorage();
    const store = createOpenGameRegistrationAttemptStore(storage);

    expect(() => store.begin(invalid as OpenGameRegistrationAttempt))
      .toThrow("INVALID_OPEN_GAME_REGISTRATION_ATTEMPT");
    expect(storage.get).not.toHaveBeenCalled();
    expect(storage.set).not.toHaveBeenCalled();
    expect(storage.remove).not.toHaveBeenCalled();
  });

  test.each([
    ["extra attempt property", { ...applyAttempt, extra: true }],
    ["malformed nested body", { ...applyAttempt, body: { ...body, note: undefined } }],
    ["invalid decision", { ...decisionAttempt, decision: "PROMOTE_FROM_WAITLIST" }],
    ["invalid withdrawal", { ...withdrawAttempt, action: "AUTO" }],
    ["invalid attendance", { ...attendanceAttempt, attendanceStatus: "UNMARKED" }],
    ["invalid removal", { ...removeMemberAttempt, reason: "13800138000" }],
    ["invalid allow-reapply", { ...allowReapplyAttempt, expectedVersion: 0 }],
  ])("self-clears corrupt persisted state: %s", (_label, invalid) => {
    const storage = memoryStorage([[KEY, invalid]]);
    const store = createOpenGameRegistrationAttemptStore(storage);

    expect(store.load()).toBeNull();
    expect(storage.remove).toHaveBeenCalledWith(KEY);
  });

  test("clear removes only the registration attempt namespace", () => {
    const sessionKey = "modelstella.pitch-booking.session.v2";
    const openGameKey = "modelstella.pitch-booking.open-game-mutation-attempt.v1";
    const storage = memoryStorage([
      [KEY, applyAttempt],
      [sessionKey, { token: "session-sentinel" }],
      [openGameKey, { kind: "b2-sentinel" }],
    ]);

    createOpenGameRegistrationAttemptStore(storage).clear();

    expect(storage.values.has(KEY)).toBe(false);
    expect(storage.values.get(sessionKey)).toEqual({ token: "session-sentinel" });
    expect(storage.values.get(openGameKey)).toEqual({ kind: "b2-sentinel" });
    expect(storage.remove).toHaveBeenCalledTimes(1);
    expect(storage.remove).toHaveBeenCalledWith(KEY);
  });
});
