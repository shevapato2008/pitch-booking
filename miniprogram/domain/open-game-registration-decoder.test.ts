/// <reference types="node" />
import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";

import { ApiResponseError } from "./contracts";
import { decodeOpenGamePublic } from "./open-game-decoder";
import {
  decodeOpenGameApplicationDecisionResult,
  decodeOpenGameApplicationQueue,
  decodeMyOpenGameApplications,
  decodeOpenGameRegistrationContext,
  validateOpenGameApplicationDraft,
} from "./open-game-registration-decoder";
import type { OpenGameApplicationDraft } from "./open-game-registration";

const fixture = (name: string): Record<string, unknown> => JSON.parse(
  readFileSync(`contracts/examples/${name}.json`, "utf8"),
) as Record<string, unknown>;

const clone = <T>(value: T): T => structuredClone(value);
const rejected = (decode: () => unknown): void => {
  expect(decode).toThrow(ApiResponseError);
};

const contextReady = fixture("open-game-registration-context-apply-ready");
const contextApplied = fixture("open-game-registration-context-applied");
const queuePending = fixture("open-game-applications-pending");
const decisionJoined = fixture("open-game-application-decision-joined");
const myApplicationsReady = fixture("my-open-game-applications-ready");
const APPLICATION_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function withdrawalContext(
  base: Record<string, unknown>,
  viewerPatch: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...base,
    viewer_registration: {
      ...(base.viewer_registration as Record<string, unknown>),
      id: APPLICATION_ID,
      version: 1,
      withdrawn_at: null,
      withdrawal_kind: null,
      late_exit_recorded: false,
      available_withdrawal_action: null,
      late_exit_will_be_recorded: false,
      ...viewerPatch,
    },
  };
}

describe("open-game registration response decoders", () => {
  test("decodes withdrawal authority and enforces action, late, terminal, and cancellation invariants", () => {
    const applied = withdrawalContext(contextApplied, {
      available_withdrawal_action: "WITHDRAW_APPLICATION",
    });
    expect(decodeOpenGameRegistrationContext(applied).viewerRegistration).toMatchObject({
      id: APPLICATION_ID,
      version: 1,
      persistedStatus: "APPLIED",
      effectiveStatus: "APPLIED",
      withdrawnAt: null,
      withdrawalKind: null,
      lateExitRecorded: false,
      availableWithdrawalAction: "WITHDRAW_APPLICATION",
      lateExitWillBeRecorded: false,
    });

    const joined = withdrawalContext(fixture("open-game-registration-context-joined"), {
      version: 2,
      available_withdrawal_action: "LEAVE_GAME",
      late_exit_will_be_recorded: true,
    });
    expect(decodeOpenGameRegistrationContext(joined).viewerRegistration).toMatchObject({
      version: 2,
      persistedStatus: "JOINED",
      effectiveStatus: "JOINED",
      availableWithdrawalAction: "LEAVE_GAME",
      lateExitWillBeRecorded: true,
    });

    const withdrawn = withdrawalContext(contextApplied, {
      version: 2,
      persisted_status: "WITHDRAWN",
      effective_status: "WITHDRAWN",
      withdrawn_at: "2026-08-24T00:30:00+08:00",
      withdrawal_kind: "APPLICATION_WITHDRAWAL",
    });
    expect(decodeOpenGameRegistrationContext(withdrawn).viewerRegistration).toMatchObject({
      persistedStatus: "WITHDRAWN",
      effectiveStatus: "WITHDRAWN",
      withdrawnAt: "2026-08-24T00:30:00+08:00",
      withdrawalKind: "APPLICATION_WITHDRAWAL",
    });

    const withdrawnThenCancelled = withdrawalContext(contextApplied, {
      version: 2,
      persisted_status: "WITHDRAWN",
      effective_status: "CANCELLED",
      withdrawn_at: "2026-08-24T00:30:00+08:00",
      withdrawal_kind: "APPLICATION_WITHDRAWAL",
    });
    expect(decodeOpenGameRegistrationContext(withdrawnThenCancelled).viewerRegistration)
      .toMatchObject({ persistedStatus: "WITHDRAWN", effectiveStatus: "CANCELLED" });

    for (const invalidViewerPatch of [
      { persisted_status: "APPLIED", available_withdrawal_action: "LEAVE_GAME" },
      { persisted_status: "JOINED", effective_status: "JOINED", decided_at: "2026-08-24T00:25:00+08:00", available_withdrawal_action: "WITHDRAW_APPLICATION" },
      { late_exit_will_be_recorded: true, available_withdrawal_action: "WITHDRAW_APPLICATION" },
      { persisted_status: "WITHDRAWN", effective_status: "WITHDRAWN", version: 2, withdrawn_at: null, withdrawal_kind: "GAME_EXIT", decided_at: "2026-08-24T00:25:00+08:00" },
      { persisted_status: "WITHDRAWN", effective_status: "WITHDRAWN", version: 2, withdrawn_at: "2026-08-24T00:30:00+08:00", withdrawal_kind: "APPLICATION_WITHDRAWAL", late_exit_recorded: true },
      { persisted_status: "JOINED", effective_status: "WITHDRAWN", decided_at: "2026-08-24T00:25:00+08:00" },
    ]) rejected(() => decodeOpenGameRegistrationContext(
      withdrawalContext(contextApplied, invalidViewerPatch),
    ));
  });

  test.each([
    ["anonymous", false, null, false, "AUTH_REQUIRED"],
    ["apply-ready", true, null, true, null],
    ["applied", true, ["APPLIED", "APPLIED", null], false, "ALREADY_APPLIED"],
    ["joined", true, ["JOINED", "JOINED", "2026-08-24T00:25:00+08:00"], false, "ALREADY_APPLIED"],
    ["rejected", true, ["REJECTED", "REJECTED", "2026-08-24T00:25:00+08:00"], false, "ALREADY_APPLIED"],
    ["cancelled", true, ["JOINED", "CANCELLED", "2026-08-24T00:25:00+08:00"], false, "GAME_CANCELLED"],
  ] as const)("decodes the exact %s context example to its closed camel-case shape", (
    name,
    viewerAuthenticated,
    status,
    canApply,
    applyBlockedReason,
  ) => {
    const value = fixture(`open-game-registration-context-${name}`);
    const wireRegistration = value.viewer_registration as Record<string, unknown> | null;
    const viewerRegistration = status === null ? null : {
      id: wireRegistration?.id,
      version: wireRegistration?.version,
      displayName: "周末小翼",
      position: "FORWARD",
      note: "可以补边路，按时到场。",
      persistedStatus: status[0],
      effectiveStatus: status[1],
      appliedAt: "2026-08-24T00:18:00+08:00",
      decidedAt: status[2],
      withdrawnAt: wireRegistration?.withdrawn_at,
      withdrawalKind: wireRegistration?.withdrawal_kind,
      lateExitRecorded: wireRegistration?.late_exit_recorded,
      availableWithdrawalAction: wireRegistration?.available_withdrawal_action,
      lateExitWillBeRecorded: wireRegistration?.late_exit_will_be_recorded,
    };

    expect(decodeOpenGameRegistrationContext(value)).toEqual({
      game: decodeOpenGamePublic(value.game, "$.game"),
      remainingSpots: value.remaining_spots,
      viewerAuthenticated,
      viewerRegistration,
      allowedActions: { canApply, applyBlockedReason },
    });
  });

  test("decodes the exact pending and empty queue examples defensively", () => {
    const input = clone(queuePending);
    const decoded = decodeOpenGameApplicationQueue(input);
    expect(decoded).toEqual({
      remainingSpots: 4,
      pendingCount: 2,
      applications: [
        {
          id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          displayName: "周末小翼",
          position: "FORWARD",
          note: "可以补边路，按时到场。",
          appliedAt: "2026-08-24T00:18:00+08:00",
          version: 1,
          allowedActions: {
            canAccept: true,
            acceptBlockedReason: null,
            canReject: true,
            rejectBlockedReason: null,
          },
        },
        {
          id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          displayName: "门前老陈",
          position: "GOALKEEPER",
          note: null,
          appliedAt: "2026-08-24T00:20:00+08:00",
          version: 1,
          allowedActions: {
            canAccept: true,
            acceptBlockedReason: null,
            canReject: true,
            rejectBlockedReason: null,
          },
        },
      ],
    });
    expect(decodeOpenGameApplicationQueue(fixture("open-game-applications-empty"))).toEqual({
      remainingSpots: 3,
      pendingCount: 0,
      applications: [],
    });
    expect(Object.isFrozen(decoded.applications)).toBe(true);
    (input.applications as Array<Record<string, unknown>>)[0].display_name = "被修改";
    expect(decoded.applications[0].displayName).toBe("周末小翼");
  });

  test.each([
    ["joined", "JOINED", 3],
    ["rejected", "REJECTED", 4],
  ] as const)("decodes the exact %s decision example", (name, status, remainingSpots) => {
    expect(decodeOpenGameApplicationDecisionResult(
      fixture(`open-game-application-decision-${name}`),
    )).toEqual({
      applicationId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      status,
      version: 2,
      decidedAt: "2026-08-24T00:25:00+08:00",
      remainingSpots,
      allowedActions: {
        canAccept: false,
        acceptBlockedReason: "APPLICATION_NOT_PENDING",
        canReject: false,
        rejectBlockedReason: "APPLICATION_NOT_PENDING",
      },
    });
  });

  test("rejects extra or missing fields at every registration nesting boundary", () => {
    rejected(() => decodeOpenGameRegistrationContext({ ...contextReady, private: true }));

    const nestedGame = clone(contextReady);
    (nestedGame.game as Record<string, unknown>).private = true;
    rejected(() => decodeOpenGameRegistrationContext(nestedGame));

    const contextActions = clone(contextReady);
    (contextActions.allowed_actions as Record<string, unknown>).private = true;
    rejected(() => decodeOpenGameRegistrationContext(contextActions));

    const viewer = clone(contextApplied);
    (viewer.viewer_registration as Record<string, unknown>).private = true;
    rejected(() => decodeOpenGameRegistrationContext(viewer));

    const queueApplication = clone(queuePending);
    (queueApplication.applications as Array<Record<string, unknown>>)[0].private = true;
    rejected(() => decodeOpenGameApplicationQueue(queueApplication));

    const reviewActions = clone(queuePending);
    const first = (reviewActions.applications as Array<Record<string, unknown>>)[0];
    (first.allowed_actions as Record<string, unknown>).private = true;
    rejected(() => decodeOpenGameApplicationQueue(reviewActions));

    const missing = clone(decisionJoined);
    Reflect.deleteProperty(missing, "version");
    rejected(() => decodeOpenGameApplicationDecisionResult(missing));
  });

  test("rejects wrong nullability, bounds, enum, UUID and RFC3339 values", () => {
    for (const [base, patch] of [
      [contextReady, { remaining_spots: -1 }],
      [contextReady, { viewer_authenticated: null }],
      [contextApplied, { viewer_authenticated: false }],
      [contextApplied, { viewer_registration: {
        ...(contextApplied.viewer_registration as Record<string, unknown>),
        persisted_status: "CANCELLED",
      } }],
      [contextApplied, { viewer_registration: {
        ...(contextApplied.viewer_registration as Record<string, unknown>),
        position: "SWEEPER",
      } }],
      [contextApplied, { viewer_registration: {
        ...(contextApplied.viewer_registration as Record<string, unknown>),
        applied_at: "2026-08-24 00:18:00",
      } }],
    ] as const) rejected(() => decodeOpenGameRegistrationContext({ ...base, ...patch }));

    for (const mutate of [
      (value: Record<string, unknown>) => { value.pending_count = -1; },
      (value: Record<string, unknown>) => {
        (value.applications as Array<Record<string, unknown>>)[0].id = "not-a-uuid";
      },
      (value: Record<string, unknown>) => {
        (value.applications as Array<Record<string, unknown>>)[0].applied_at = "yesterday";
      },
      (value: Record<string, unknown>) => {
        (value.applications as Array<Record<string, unknown>>)[0].version = 0;
      },
    ]) {
      const value = clone(queuePending);
      mutate(value);
      rejected(() => decodeOpenGameApplicationQueue(value));
    }

    for (const patch of [
      { application_id: "not-a-uuid" },
      { status: "APPLIED" },
      { decided_at: "not-a-time" },
      { remaining_spots: -1 },
    ]) rejected(() => decodeOpenGameApplicationDecisionResult({ ...decisionJoined, ...patch }));

    expect(decodeOpenGameApplicationDecisionResult({ ...decisionJoined, decided_at: null }).decidedAt)
      .toBeNull();
  });

  test.each([
    ["context remaining_spots", () => decodeOpenGameRegistrationContext({
      ...contextReady,
      remaining_spots: Number.MAX_SAFE_INTEGER + 1,
    })],
    ["queue remaining_spots", () => decodeOpenGameApplicationQueue({
      ...queuePending,
      remaining_spots: Number.MAX_SAFE_INTEGER + 1,
    })],
    ["queue pending_count", () => decodeOpenGameApplicationQueue({
      ...queuePending,
      pending_count: Number.MAX_SAFE_INTEGER + 1,
    })],
    ["application version", () => {
      const value = clone(queuePending);
      (value.applications as Array<Record<string, unknown>>)[0].version = Number.MAX_SAFE_INTEGER + 1;
      return decodeOpenGameApplicationQueue(value);
    }],
    ["decision version", () => decodeOpenGameApplicationDecisionResult({
      ...decisionJoined,
      version: Number.MAX_SAFE_INTEGER + 1,
    })],
    ["decision remaining_spots", () => decodeOpenGameApplicationDecisionResult({
      ...decisionJoined,
      remaining_spots: Number.MAX_SAFE_INTEGER + 1,
    })],
  ] as const)("rejects an unsafe integer at %s", (_field, decode) => {
    rejected(decode);
  });

  test("enforces apply and review boolean-to-blocker pairs", () => {
    for (const allowedActions of [
      { can_apply: true, apply_blocked_reason: "GAME_FULL" },
      { can_apply: false, apply_blocked_reason: null },
      { can_apply: false, apply_blocked_reason: "UNKNOWN" },
    ]) rejected(() => decodeOpenGameRegistrationContext({
      ...contextReady,
      allowed_actions: allowedActions,
    }));

    for (const allowedActions of [
      { can_accept: true, accept_blocked_reason: "GAME_FULL", can_reject: true, reject_blocked_reason: null },
      { can_accept: false, accept_blocked_reason: null, can_reject: true, reject_blocked_reason: null },
      { can_accept: true, accept_blocked_reason: null, can_reject: true, reject_blocked_reason: "GAME_STARTED" },
      { can_accept: true, accept_blocked_reason: null, can_reject: false, reject_blocked_reason: null },
      { can_accept: true, accept_blocked_reason: null, can_reject: false, reject_blocked_reason: "GAME_FULL" },
      { can_accept: false, accept_blocked_reason: "UNKNOWN", can_reject: true, reject_blocked_reason: null },
    ]) {
      const value = clone(queuePending);
      (value.applications as Array<Record<string, unknown>>)[0].allowed_actions = allowedActions;
      rejected(() => decodeOpenGameApplicationQueue(value));
    }
  });

  test("requires both terminal decision blockers to be APPLICATION_NOT_PENDING", () => {
    for (const allowedActions of [
      { can_accept: false, accept_blocked_reason: "GAME_CANCELLED", can_reject: false, reject_blocked_reason: "GAME_CANCELLED" },
      { can_accept: false, accept_blocked_reason: "APPLICATION_NOT_PENDING", can_reject: false, reject_blocked_reason: "GAME_STARTED" },
      { can_accept: true, accept_blocked_reason: null, can_reject: true, reject_blocked_reason: null },
    ]) rejected(() => decodeOpenGameApplicationDecisionResult({
      ...decisionJoined,
      allowed_actions: allowedActions,
    }));
  });
});

describe("my open-game applications response decoder", () => {
  test("decodes the exact ready and empty payloads to frozen camel-case pages", () => {
    const input = clone(myApplicationsReady);
    const decoded = decodeMyOpenGameApplications(input);

    expect(decoded).toEqual({
      items: [
        {
          id: "40000000-0000-4000-8000-000000000004",
          effectiveStatus: "CANCELLED",
          appliedAt: "2026-08-29T12:00:00+08:00",
          detailPath: "/pages/captain-game-public/index?token=AbCdEfGhIjKlMnOpQrStUvWxYz012345",
          gameName: "周日八人制友谊赛",
          startsAt: "2026-09-06T18:00:00+08:00",
          endsAt: "2026-09-06T20:00:00+08:00",
          timeZone: "Asia/Shanghai",
          venueName: "逐光足球公园",
          pitchName: "1号场",
          pitchSpecification: "8人制",
        },
        {
          id: "40000000-0000-4000-8000-000000000003",
          effectiveStatus: "REJECTED",
          appliedAt: "2026-08-28T12:00:00+08:00",
          detailPath: "/pages/captain-game-public/index?token=0123456789abcdefghijklmnopqrstuv",
          gameName: "周六七人制训练赛",
          startsAt: "2026-09-05T19:00:00+08:00",
          endsAt: "2026-09-05T21:00:00+08:00",
          timeZone: "Asia/Shanghai",
          venueName: "逐光足球公园",
          pitchName: "2号场",
          pitchSpecification: "7人制",
        },
        {
          id: "40000000-0000-4000-8000-000000000002",
          effectiveStatus: "JOINED",
          appliedAt: "2026-08-27T12:00:00+08:00",
          detailPath: "/pages/captain-game-public/index?token=zyxwvutsrqponmlkjihgfedcba543210",
          gameName: "周三五人制夜场",
          startsAt: "2026-09-02T20:00:00+08:00",
          endsAt: "2026-09-02T22:00:00+08:00",
          timeZone: "Asia/Shanghai",
          venueName: "逐光足球公园",
          pitchName: "3号场",
          pitchSpecification: "5人制",
        },
        {
          id: "40000000-0000-4000-8000-000000000001",
          effectiveStatus: "APPLIED",
          appliedAt: "2026-08-26T12:00:00+08:00",
          detailPath: "/pages/captain-game-public/index?token=A1_b2-C3_d4-E5_f6-G7_h8-I9_j0-KL",
          gameName: "周二六人制约球",
          startsAt: "2026-09-01T19:00:00+08:00",
          endsAt: "2026-09-01T21:00:00+08:00",
          timeZone: "Asia/Shanghai",
          venueName: "逐光足球公园",
          pitchName: "4号场",
          pitchSpecification: "6人制",
        },
      ],
      nextCursor: myApplicationsReady.next_cursor,
    });
    expect(decodeMyOpenGameApplications(fixture("my-open-game-applications-empty"))).toEqual({
      items: [],
      nextCursor: null,
    });
    expect(Object.isFrozen(decoded)).toBe(true);
    expect(Object.isFrozen(decoded.items)).toBe(true);
    expect(decoded.items.every(Object.isFrozen)).toBe(true);
    (input.items as Array<Record<string, unknown>>)[0].game_name = "被修改";
    expect(decoded.items[0].gameName).toBe("周日八人制友谊赛");
  });

  test.each(["APPLIED", "JOINED", "REJECTED", "WITHDRAWN", "CANCELLED"] as const)(
    "accepts the shared %s effective status",
    (effectiveStatus) => {
      const value = clone(myApplicationsReady);
      (value.items as Array<Record<string, unknown>>)[0].effective_status = effectiveStatus;
      expect(decodeMyOpenGameApplications(value).items[0].effectiveStatus).toBe(effectiveStatus);
    },
  );

  test("rejects extra, private, and missing fields at both closed boundaries", () => {
    rejected(() => decodeMyOpenGameApplications({ ...myApplicationsReady, private: true }));
    const privateItem = clone(myApplicationsReady);
    (privateItem.items as Array<Record<string, unknown>>)[0].applicant_user_id = "private";
    rejected(() => decodeMyOpenGameApplications(privateItem));
    const missingItem = clone(myApplicationsReady);
    Reflect.deleteProperty((missingItem.items as Array<Record<string, unknown>>)[0], "venue_name");
    rejected(() => decodeMyOpenGameApplications(missingItem));
  });

  test.each([
    ["UUID", "id", "not-a-uuid"],
    ["canonical lowercase UUID", "id", "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA"],
    ["status", "effective_status", "WAITLISTED"],
    ["RFC3339 applied time", "applied_at", "2026-08-29 12:00:00"],
    ["shared detail path", "detail_path", "/pages/captain-game-public/index?token=too-short"],
    ["IANA time zone", "time_zone", "Shanghai"],
    ["RFC3339 start", "starts_at", "tomorrow"],
    ["RFC3339 end", "ends_at", "later"],
  ] as const)("rejects an invalid %s", (_label, field, invalidValue) => {
    const value = clone(myApplicationsReady);
    (value.items as Array<Record<string, unknown>>)[0][field] = invalidValue;
    rejected(() => decodeMyOpenGameApplications(value));
  });

  test("requires starts_at to be strictly before ends_at", () => {
    for (const endsAt of ["2026-09-06T18:00:00+08:00", "2026-09-06T17:59:59+08:00"]) {
      const value = clone(myApplicationsReady);
      (value.items as Array<Record<string, unknown>>)[0].ends_at = endsAt;
      rejected(() => decodeMyOpenGameApplications(value));
    }
  });

  test("accepts only a strict applied_at DESC, lowercase id DESC page without duplicate ids", () => {
    const sortedTie = clone(myApplicationsReady);
    const items = sortedTie.items as Array<Record<string, unknown>>;
    items[1].applied_at = items[0].applied_at;
    expect(() => decodeMyOpenGameApplications(sortedTie)).not.toThrow();

    const ascendingTime = clone(myApplicationsReady);
    (ascendingTime.items as Array<Record<string, unknown>>).reverse();
    rejected(() => decodeMyOpenGameApplications(ascendingTime));

    const ascendingTie = clone(sortedTie);
    (ascendingTie.items as Array<Record<string, unknown>>).splice(
      0,
      2,
      ...(ascendingTie.items as Array<Record<string, unknown>>).slice(0, 2).reverse(),
    );
    rejected(() => decodeMyOpenGameApplications(ascendingTie));

    const duplicate = clone(myApplicationsReady);
    (duplicate.items as Array<Record<string, unknown>>)[3].id =
      (duplicate.items as Array<Record<string, unknown>>)[0].id;
    rejected(() => decodeMyOpenGameApplications(duplicate));
  });

  test("treats next_cursor as opaque but rejects missing, empty, or non-string cursors", () => {
    expect(decodeMyOpenGameApplications({
      ...myApplicationsReady,
      next_cursor: " opaque value the client must not decode ",
    }).nextCursor).toBe(" opaque value the client must not decode ");
    for (const nextCursor of ["", 0, false, {}]) {
      rejected(() => decodeMyOpenGameApplications({
        ...myApplicationsReady,
        next_cursor: nextCursor,
      }));
    }
    const missing = clone(myApplicationsReady);
    Reflect.deleteProperty(missing, "next_cursor");
    rejected(() => decodeMyOpenGameApplications(missing));
  });
});

const validDraft: OpenGameApplicationDraft = {
  displayName: "小范",
  position: "MIDFIELDER",
  note: "周末常踢七人制，会提前到场热身",
  adultConfirmed: true,
  riskConfirmed: true,
};

describe("open-game application draft validation", () => {
  test("trims and freezes the normalized submission while preserving safe original Unicode", () => {
    const validation = validateOpenGameApplicationDraft({
      ...validDraft,
      displayName: "  ＦＣ小范  ",
      note: "  主要踢后腰，左脚，会提前到场热身  ",
    });

    expect(validation).toEqual({
      valid: true,
      errors: {
        displayName: null,
        position: null,
        note: null,
        adultConfirmed: null,
        riskConfirmed: null,
      },
      submission: {
        displayName: "ＦＣ小范",
        position: "MIDFIELDER",
        note: "主要踢后腰，左脚，会提前到场热身",
        adultConfirmed: true,
        riskConfirmed: true,
      },
    });
    expect(validation.valid && Object.isFrozen(validation.submission)).toBe(true);
  });

  test("maps a trimmed empty note to null and counts Unicode code points", () => {
    const validation = validateOpenGameApplicationDraft({
      ...validDraft,
      displayName: ` ${"⚽".repeat(24)} `,
      note: "   ",
    });
    expect(validation.valid).toBe(true);
    if (!validation.valid) throw new Error("expected a valid draft");
    expect(validation.submission.note).toBeNull();
    expect(validation.submission.displayName).toBe("⚽".repeat(24));

    const noteAtLimit = validateOpenGameApplicationDraft({
      ...validDraft,
      note: ` ${"球".repeat(120)} `,
    });
    expect(noteAtLimit.valid).toBe(true);
  });

  test.each([
    [{ displayName: "范" }, "displayName"],
    [{ displayName: "范".repeat(25) }, "displayName"],
    [{ position: null }, "position"],
    [{ position: "SWEEPER" }, "position"],
    [{ note: "到".repeat(121) }, "note"],
    [{ adultConfirmed: false }, "adultConfirmed"],
    [{ adultConfirmed: 1 }, "adultConfirmed"],
    [{ riskConfirmed: false }, "riskConfirmed"],
  ] as const)("rejects invalid application field %# without a submission", (patch, field) => {
    const validation = validateOpenGameApplicationDraft({
      ...validDraft,
      ...patch,
    } as OpenGameApplicationDraft);
    expect(validation.valid).toBe(false);
    expect(validation.errors[field]).toBeTruthy();
    expect(validation).not.toHaveProperty("submission");
  });

  test.each(["GOALKEEPER", "DEFENDER", "MIDFIELDER", "FORWARD", "ANY"] as const)(
    "accepts the closed %s position",
    (position) => {
      expect(validateOpenGameApplicationDraft({ ...validDraft, position }).valid).toBe(true);
    },
  );

  test.each([
    ["displayName", "13800138000"],
    ["displayName", "微信 pitch_friend"],
    ["displayName", "ｖｘ： pitch_friend"],
    ["displayName", "www.example.cn"],
    ["displayName", "120101199001011234"],
    ["note", "电话 １３８００１３８０００"],
    ["note", "微信号 pitch_friend"],
    ["note", "详情 ｈｔｔｐｓ：／／example.com/team"],
    ["note", "证件 120101900101123"],
  ] as const)("rejects NFKC-detected private text in %s: %s", (field, value) => {
    const validation = validateOpenGameApplicationDraft({ ...validDraft, [field]: value });
    expect(validation.valid).toBe(false);
    expect(validation.errors[field]).toBeTruthy();
    expect(validation).not.toHaveProperty("submission");
  });

  test("allows ordinary football text without making permission or capacity decisions", () => {
    const validation = validateOpenGameApplicationDraft({
      ...validDraft,
      displayName: "中场老范",
      note: "主要踢后腰，左脚，周五 7 点会提前到场热身",
    });
    expect(validation.valid).toBe(true);
    expect(validation.errors).toEqual({
      displayName: null,
      position: null,
      note: null,
      adultConfirmed: null,
      riskConfirmed: null,
    });
    expect(validation).not.toHaveProperty("canApply");
    expect(validation).not.toHaveProperty("remainingSpots");
  });
});
