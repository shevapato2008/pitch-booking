/// <reference types="node" />
import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";

import { ApiResponseError } from "./contracts";
import { decodeOpenGamePublic } from "./open-game-decoder";
import {
  decodeOpenGameAttendanceMarkResult as decodeAttendanceMarkResult,
  decodeOpenGameAttendanceRoster as decodeAttendanceRoster,
  decodeOpenGameApplicationDecisionResult,
  decodeOpenGameApplicationQueue,
  decodeMyOpenGameApplications,
  decodeOpenGameRegistrationContext,
  decodeOpenGameSignupContext,
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
const attendanceRosterReady = fixture("open-game-attendance-roster-ready");
const attendanceRosterEmpty = fixture("open-game-attendance-roster-empty");
const attendanceMarkPresent = fixture("open-game-attendance-mark-present");
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
  test("keeps the legacy viewer display name at two or more code points", () => {
    const joined = clone(fixture("open-game-registration-context-joined"));
    (joined.viewer_registration as Record<string, unknown>).display_name = "范";
    const signupJoined = clone(fixture("open-game-signup-context-joined"));
    (signupJoined.viewer_registration as Record<string, unknown>).display_name = "范";

    rejected(() => decodeOpenGameRegistrationContext(joined));
    expect(decodeOpenGameSignupContext(signupJoined).viewerRegistration?.displayName).toBe("范");
  });

  test("requires the roster projection on the isolated signup context only", () => {
    expect(() => decodeOpenGameRegistrationContext(contextReady)).not.toThrow();
    rejected(() => decodeOpenGameSignupContext(contextReady));
    const signupReady = fixture("open-game-signup-context-apply-ready");
    expect(() => decodeOpenGameSignupContext(signupReady)).not.toThrow();
    rejected(() => decodeOpenGameRegistrationContext(signupReady));
  });

  test("accepts a captain-removed viewer with preserved waitlist history and no live position", () => {
    const removed = clone(fixture("open-game-registration-context-waitlisted"));
    Object.assign(removed.viewer_registration as Record<string, unknown>, {
      version: 3,
      persisted_status: "REMOVED",
      effective_status: "REMOVED",
      waitlist_position: null,
      removed_at: "2026-08-24T00:30:00+08:00",
      available_withdrawal_action: null,
    });

    expect(decodeOpenGameRegistrationContext(removed).viewerRegistration).toMatchObject({
      persistedStatus: "REMOVED",
      effectiveStatus: "REMOVED",
      waitlistPosition: null,
      waitlistedAt: "2026-08-24T00:25:00+08:00",
      promotedAt: null,
      removedAt: "2026-08-24T00:30:00+08:00",
    });
  });

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

  test("decodes the waitlist lifecycle matrix and rejects inverted or incomplete history", () => {
    const waitlisted = withdrawalContext(contextApplied, {
      version: 2,
      persisted_status: "WAITLISTED",
      effective_status: "WAITLISTED",
      decided_at: "2026-08-24T00:25:00+08:00",
      waitlist_position: 2,
      waitlisted_at: "2026-08-24T00:25:00+08:00",
      promoted_at: null,
      available_withdrawal_action: "WITHDRAW_WAITLIST",
    });
    expect(decodeOpenGameRegistrationContext(waitlisted).viewerRegistration).toMatchObject({
      persistedStatus: "WAITLISTED",
      effectiveStatus: "WAITLISTED",
      waitlistPosition: 2,
      waitlistedAt: "2026-08-24T00:25:00+08:00",
      promotedAt: null,
      availableWithdrawalAction: "WITHDRAW_WAITLIST",
    });

    const promoted = withdrawalContext(contextApplied, {
      version: 3,
      persisted_status: "JOINED",
      effective_status: "JOINED",
      decided_at: "2026-08-24T00:25:00+08:00",
      waitlist_position: null,
      waitlisted_at: "2026-08-24T00:25:00+08:00",
      promoted_at: "2026-08-24T00:30:00+08:00",
      available_withdrawal_action: "LEAVE_GAME",
    });
    expect(decodeOpenGameRegistrationContext(promoted).viewerRegistration).toMatchObject({
      persistedStatus: "JOINED",
      waitlistPosition: null,
      waitlistedAt: "2026-08-24T00:25:00+08:00",
      promotedAt: "2026-08-24T00:30:00+08:00",
    });

    const withdrawn = withdrawalContext(contextApplied, {
      version: 3,
      persisted_status: "WITHDRAWN",
      effective_status: "WITHDRAWN",
      decided_at: "2026-08-24T00:25:00+08:00",
      withdrawn_at: "2026-08-24T00:30:00+08:00",
      withdrawal_kind: "WAITLIST_WITHDRAWAL",
      waitlist_position: null,
      waitlisted_at: "2026-08-24T00:25:00+08:00",
      promoted_at: null,
    });
    expect(decodeOpenGameRegistrationContext(withdrawn).viewerRegistration).toMatchObject({
      withdrawalKind: "WAITLIST_WITHDRAWAL",
      waitlistPosition: null,
      waitlistedAt: "2026-08-24T00:25:00+08:00",
      promotedAt: null,
    });

    for (const invalidViewerPatch of [
      { persisted_status: "WAITLISTED", effective_status: "WAITLISTED", decided_at: null, waitlist_position: 1, waitlisted_at: "2026-08-24T00:25:00+08:00" },
      { persisted_status: "WAITLISTED", effective_status: "WAITLISTED", decided_at: "2026-08-24T00:25:00+08:00", waitlist_position: 0, waitlisted_at: "2026-08-24T00:25:00+08:00" },
      { persisted_status: "JOINED", effective_status: "JOINED", decided_at: "2026-08-24T00:25:00+08:00", waitlisted_at: "2026-08-24T00:25:00+08:00", promoted_at: null },
      { persisted_status: "JOINED", effective_status: "JOINED", decided_at: "2026-08-24T00:25:00+08:00", waitlisted_at: "2026-08-24T00:30:00+08:00", promoted_at: "2026-08-24T00:25:00+08:00" },
      { persisted_status: "WAITLISTED", effective_status: "WAITLISTED", decided_at: "2026-08-24T00:25:00+08:00", waitlist_position: 1, waitlisted_at: "2026-08-24T00:17:00+08:00" },
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
      waitlistPosition: wireRegistration?.waitlist_position,
      waitlistedAt: wireRegistration?.waitlisted_at,
      promotedAt: wireRegistration?.promoted_at,
      attendanceStatus: wireRegistration?.attendance_status,
      attendanceRecordedAt: wireRegistration?.attendance_recorded_at,
      attendanceCorrectedAt: wireRegistration?.attendance_corrected_at,
      removedAt: wireRegistration?.removed_at,
    };

    const decoded = decodeOpenGameRegistrationContext(value);
    expect(decoded).toMatchObject({
      game: decodeOpenGamePublic(value.game, "$.game"),
      remainingSpots: value.remaining_spots,
      viewerAuthenticated,
      viewerRegistration,
      allowedActions: { canApply, applyBlockedReason },
    });
    expect(Object.keys(decoded).sort()).toEqual([
      "allowedActions", "blockedMembers", "game", "joinedCount", "joinedMembers",
      "managementGameId", "remainingSpots", "viewerAuthenticated", "viewerRegistration",
      "waitlistCount", "waitlistedMembers",
    ].sort());
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
            canWaitlist: false,
            waitlistBlockedReason: "GAME_NOT_FULL",
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
            canWaitlist: false,
            waitlistBlockedReason: "GAME_NOT_FULL",
            canReject: true,
            rejectBlockedReason: null,
          },
        },
      ],
      waitlistCount: 0,
      waitlist: [],
    });
    expect(decodeOpenGameApplicationQueue(fixture("open-game-applications-empty"))).toEqual({
      remainingSpots: 3,
      pendingCount: 0,
      applications: [],
      waitlistCount: 0,
      waitlist: [],
    });
    expect(Object.isFrozen(decoded.applications)).toBe(true);
    (input.applications as Array<Record<string, unknown>>)[0].display_name = "被修改";
    expect(decoded.applications[0].displayName).toBe("周末小翼");
  });

  test("decodes a future non-empty waitlist in strict server position order", () => {
    const first = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      display_name: "候补一号",
      position: "DEFENDER",
      note: null,
      applied_at: "2026-08-24T00:18:00+08:00",
      waitlisted_at: "2026-08-24T00:25:00+08:00",
      waitlist_position: 1,
    };
    const value = {
      ...queuePending,
      waitlist_count: 2,
      waitlist: [
        first,
        {
          ...first,
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          display_name: "候补二号",
          waitlist_position: 2,
        },
      ],
    };
    expect(decodeOpenGameApplicationQueue(value).waitlist).toEqual([
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        displayName: "候补一号",
        position: "DEFENDER",
        note: null,
        appliedAt: "2026-08-24T00:18:00+08:00",
        waitlistedAt: "2026-08-24T00:25:00+08:00",
        waitlistPosition: 1,
      },
      {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        displayName: "候补二号",
        position: "DEFENDER",
        note: null,
        appliedAt: "2026-08-24T00:18:00+08:00",
        waitlistedAt: "2026-08-24T00:25:00+08:00",
        waitlistPosition: 2,
      },
    ]);

    for (const patch of [
      { waitlist_count: 0 },
      { waitlist: [{ ...first, waitlist_position: 2 }] },
      { waitlist: [{ ...first, allowed_actions: {} }] },
      { waitlist: [{ ...first, waitlisted_at: "2026-08-24T00:17:00+08:00" }] },
    ]) rejected(() => decodeOpenGameApplicationQueue({
      ...queuePending,
      waitlist_count: 1,
      waitlist: [first],
      ...patch,
    }));
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
        canWaitlist: false,
        waitlistBlockedReason: "APPLICATION_NOT_PENDING",
        canReject: false,
        rejectBlockedReason: "APPLICATION_NOT_PENDING",
      },
    });
  });

  test("decodes WAITLISTED as a read-only decision response status", () => {
    expect(decodeOpenGameApplicationDecisionResult({
      ...decisionJoined,
      status: "WAITLISTED",
    }).status).toBe("WAITLISTED");
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

    const viewerMissingAttendance = clone(contextApplied);
    Reflect.deleteProperty(
      viewerMissingAttendance.viewer_registration as Record<string, unknown>,
      "attendance_status",
    );
    rejected(() => decodeOpenGameRegistrationContext(viewerMissingAttendance));

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

  test("enforces post-game JOINED context for self attendance", () => {
    const completedJoined = clone(fixture("open-game-registration-context-joined"));
    Object.assign(completedJoined.game as Record<string, unknown>, {
      state: "COMPLETED",
      state_reason: "BOOKING_COMPLETED",
    });
    Object.assign(completedJoined.viewer_registration as Record<string, unknown>, {
      available_withdrawal_action: null,
      attendance_status: "PRESENT",
      attendance_recorded_at: "2026-08-30T20:32:00+08:00",
    });
    expect(decodeOpenGameRegistrationContext(completedJoined).viewerRegistration).toMatchObject({
      attendanceStatus: "PRESENT",
      attendanceRecordedAt: "2026-08-30T20:32:00+08:00",
    });

    const completedUnmarked = clone(completedJoined);
    Object.assign(completedUnmarked.viewer_registration as Record<string, unknown>, {
      attendance_status: "UNMARKED",
      attendance_recorded_at: null,
    });
    expect(decodeOpenGameRegistrationContext(completedUnmarked).viewerRegistration).toMatchObject({
      attendanceStatus: "UNMARKED",
      attendanceRecordedAt: null,
    });

    const completedMissing = clone(completedJoined);
    Object.assign(completedMissing.viewer_registration as Record<string, unknown>, {
      attendance_status: null,
      attendance_recorded_at: null,
    });
    rejected(() => decodeOpenGameRegistrationContext(completedMissing));

    const preGameJoined = clone(fixture("open-game-registration-context-joined"));
    Object.assign(preGameJoined.viewer_registration as Record<string, unknown>, {
      attendance_status: "UNMARKED",
      attendance_recorded_at: null,
    });
    rejected(() => decodeOpenGameRegistrationContext(preGameJoined));

    const completedApplied = clone(contextApplied);
    Object.assign(completedApplied.game as Record<string, unknown>, {
      state: "COMPLETED",
      state_reason: "BOOKING_COMPLETED",
    });
    Object.assign(completedApplied.viewer_registration as Record<string, unknown>, {
      available_withdrawal_action: null,
      attendance_status: "PRESENT",
      attendance_recorded_at: "2026-08-30T20:32:00+08:00",
    });
    rejected(() => decodeOpenGameRegistrationContext(completedApplied));

    for (const patch of [
      { attendance_status: null, attendance_recorded_at: "2026-08-30T20:32:00+08:00" },
      { attendance_status: "UNMARKED", attendance_recorded_at: "2026-08-30T20:32:00+08:00" },
      { attendance_status: "NO_SHOW", attendance_recorded_at: null },
      { attendance_status: "UNKNOWN", attendance_recorded_at: null },
      { attendance_status: "PRESENT", attendance_recorded_at: "2026-08-30 20:32:00" },
    ]) {
      const value = clone(completedJoined);
      Object.assign(value.viewer_registration as Record<string, unknown>, patch);
      rejected(() => decodeOpenGameRegistrationContext(value));
    }
  });

  test("decodes only the latest corrected time for the authenticated completed viewer", () => {
    const corrected = clone(fixture("open-game-registration-context-joined"));
    Object.assign(corrected.game as Record<string, unknown>, {
      state: "COMPLETED",
      state_reason: "BOOKING_COMPLETED",
    });
    Object.assign(corrected.viewer_registration as Record<string, unknown>, {
      available_withdrawal_action: null,
      attendance_status: "NO_SHOW",
      attendance_recorded_at: "2026-08-30T20:32:00+08:00",
      attendance_corrected_at: "2026-08-31T14:18:00+08:00",
    });
    expect(decodeOpenGameRegistrationContext(corrected).viewerRegistration).toMatchObject({
      attendanceStatus: "NO_SHOW",
      attendanceRecordedAt: "2026-08-30T20:32:00+08:00",
      attendanceCorrectedAt: "2026-08-31T14:18:00+08:00",
    });

    for (const patch of [
      { attendance_status: "UNMARKED", attendance_recorded_at: null,
        attendance_corrected_at: "2026-08-31T14:18:00+08:00" },
      { attendance_status: "PRESENT", attendance_recorded_at: "2026-08-30T20:32:00+08:00",
        attendance_corrected_at: "2026-08-30T19:00:00+08:00" },
      { attendance_status: "PRESENT", attendance_recorded_at: "2026-08-30T20:32:00+08:00",
        attendance_corrected_at: "not-a-time" },
    ]) {
      const invalidValue = clone(corrected);
      Object.assign(invalidValue.viewer_registration as Record<string, unknown>, patch);
      rejected(() => decodeOpenGameRegistrationContext(invalidValue));
    }
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
      { can_apply: true, apply_blocked_reason: "REGISTRATION_DEADLINE_PASSED" },
      { can_apply: false, apply_blocked_reason: null },
      { can_apply: false, apply_blocked_reason: "GAME_FULL" },
      { can_apply: false, apply_blocked_reason: "UNKNOWN" },
    ]) rejected(() => decodeOpenGameRegistrationContext({
      ...contextReady,
      allowed_actions: allowedActions,
    }));

    for (const allowedActions of [
      { can_accept: true, accept_blocked_reason: "GAME_FULL", can_waitlist: false, waitlist_blocked_reason: "GAME_NOT_FULL", can_reject: true, reject_blocked_reason: null },
      { can_accept: false, accept_blocked_reason: null, can_waitlist: false, waitlist_blocked_reason: "WAITLIST_NOT_ENABLED", can_reject: true, reject_blocked_reason: null },
      { can_accept: true, accept_blocked_reason: null, can_waitlist: true, waitlist_blocked_reason: null, can_reject: true, reject_blocked_reason: null },
      { can_accept: true, accept_blocked_reason: null, can_waitlist: false, waitlist_blocked_reason: null, can_reject: true, reject_blocked_reason: null },
      { can_accept: true, accept_blocked_reason: null, can_waitlist: false, waitlist_blocked_reason: "GAME_NOT_FULL", can_reject: true, reject_blocked_reason: "GAME_STARTED" },
      { can_accept: true, accept_blocked_reason: null, can_waitlist: false, waitlist_blocked_reason: "GAME_NOT_FULL", can_reject: false, reject_blocked_reason: null },
      { can_accept: true, accept_blocked_reason: null, can_waitlist: false, waitlist_blocked_reason: "GAME_NOT_FULL", can_reject: false, reject_blocked_reason: "GAME_FULL" },
      { can_accept: false, accept_blocked_reason: "UNKNOWN", can_waitlist: false, waitlist_blocked_reason: "WAITLIST_NOT_ENABLED", can_reject: true, reject_blocked_reason: null },
      { can_accept: false, accept_blocked_reason: "GAME_FULL", can_waitlist: false, waitlist_blocked_reason: "GAME_NOT_FULL", can_reject: true, reject_blocked_reason: null },
      { can_accept: false, accept_blocked_reason: "GAME_STARTED", can_waitlist: false, waitlist_blocked_reason: "GAME_CANCELLED", can_reject: false, reject_blocked_reason: "GAME_STARTED" },
    ]) {
      const value = clone(queuePending);
      (value.applications as Array<Record<string, unknown>>)[0].allowed_actions = allowedActions;
      rejected(() => decodeOpenGameApplicationQueue(value));
    }

    const future = clone(queuePending);
    (future.applications as Array<Record<string, unknown>>)[0].allowed_actions = {
      can_accept: false,
      accept_blocked_reason: "GAME_FULL",
      can_waitlist: true,
      waitlist_blocked_reason: null,
      can_reject: true,
      reject_blocked_reason: null,
    };
    expect(decodeOpenGameApplicationQueue(future).applications[0].allowedActions.canWaitlist)
      .toBe(true);
  });

  test("requires both terminal decision blockers to be APPLICATION_NOT_PENDING", () => {
    for (const allowedActions of [
      { can_accept: false, accept_blocked_reason: "GAME_CANCELLED", can_waitlist: false, waitlist_blocked_reason: "GAME_CANCELLED", can_reject: false, reject_blocked_reason: "GAME_CANCELLED" },
      { can_accept: false, accept_blocked_reason: "APPLICATION_NOT_PENDING", can_waitlist: false, waitlist_blocked_reason: "APPLICATION_NOT_PENDING", can_reject: false, reject_blocked_reason: "GAME_STARTED" },
      { can_accept: true, accept_blocked_reason: null, can_waitlist: false, waitlist_blocked_reason: "GAME_NOT_FULL", can_reject: true, reject_blocked_reason: null },
    ]) rejected(() => decodeOpenGameApplicationDecisionResult({
      ...decisionJoined,
      allowed_actions: allowedActions,
    }));
  });
});

describe("open-game attendance response decoders", () => {
  test("decodes the exact ready and empty roster examples into frozen camel-case DTOs", () => {
    const input = clone(attendanceRosterReady);
    const decoded = decodeAttendanceRoster(input);
    expect(decoded).toEqual({
      game: {
        id: "30000000-0000-4000-8000-000000000201",
        name: "奥体周日傍晚局",
        venueName: "天津奥体足球场",
        pitchName: "七人制 A 场",
        startsAt: "2026-08-30T18:30:00+08:00",
        endsAt: "2026-08-30T20:30:00+08:00",
        timeZone: "Asia/Shanghai",
        state: "COMPLETED",
      },
      recordedCount: 2,
      totalCount: 3,
      attendanceComplete: false,
      registrations: [
        {
          registrationId: "40000000-0000-4000-8000-000000000201",
          displayName: "天津周末左边锋小王",
          position: "FORWARD",
          attendanceStatus: "UNMARKED",
          attendanceRecordedAt: null,
          attendanceCorrectedAt: null,
          version: 2,
        },
        {
          registrationId: "40000000-0000-4000-8000-000000000202",
          displayName: "阿哲",
          position: "GOALKEEPER",
          attendanceStatus: "PRESENT",
          attendanceRecordedAt: "2026-08-30T20:32:00+08:00",
          attendanceCorrectedAt: "2026-08-31T14:18:00+08:00",
          version: 3,
        },
        {
          registrationId: "40000000-0000-4000-8000-000000000203",
          displayName: "十一",
          position: "MIDFIELDER",
          attendanceStatus: "NO_SHOW",
          attendanceRecordedAt: "2026-08-30T20:34:00+08:00",
          attendanceCorrectedAt: null,
          version: 3,
        },
      ],
    });
    expect(decodeAttendanceRoster(attendanceRosterEmpty)).toMatchObject({
      recordedCount: 0,
      totalCount: 0,
      attendanceComplete: true,
      registrations: [],
    });
    expect(Object.isFrozen(decoded)).toBe(true);
    expect(Object.isFrozen(decoded.game)).toBe(true);
    expect(Object.isFrozen(decoded.registrations)).toBe(true);
    expect(decoded.registrations.every(Object.isFrozen)).toBe(true);
    ((input.registrations as Array<Record<string, unknown>>)[0]).display_name = "被修改";
    expect(decoded.registrations[0].displayName).toBe("天津周末左边锋小王");
  });

  test("decodes a batched roster correction timestamp without private audit fields", () => {
    const corrected = clone(attendanceRosterReady);
    const rows = corrected.registrations as Array<Record<string, unknown>>;
    rows.forEach((row) => { row.attendance_corrected_at = null; });
    rows[1].attendance_corrected_at = "2026-08-31T14:18:00+08:00";
    expect(decodeAttendanceRoster(corrected).registrations[1]).toMatchObject({
      attendanceStatus: "PRESENT",
      attendanceRecordedAt: "2026-08-30T20:32:00+08:00",
      attendanceCorrectedAt: "2026-08-31T14:18:00+08:00",
    });
    for (const forbidden of ["reason", "principal", "history", "corrected_by"]) {
      const leaked = clone(corrected);
      (leaked.registrations as Array<Record<string, unknown>>)[1][forbidden] = "private";
      rejected(() => decodeAttendanceRoster(leaked));
    }
  });

  test.each([
    ["open-game-attendance-mark-present", "PRESENT", true],
    ["open-game-attendance-mark-no-show", "NO_SHOW", false],
  ] as const)("decodes the exact %s mark result", (name, attendanceStatus, complete) => {
    expect(decodeAttendanceMarkResult(fixture(name))).toEqual({
      registrationId: "40000000-0000-4000-8000-000000000201",
      attendanceStatus,
      attendanceRecordedAt: "2026-08-30T20:36:00+08:00",
      version: 3,
      recordedCount: complete ? 3 : 2,
      totalCount: 3,
      attendanceComplete: complete,
    });
  });

  test("rejects extra, missing, and private roster fields at every nesting boundary", () => {
    rejected(() => decodeAttendanceRoster({ ...attendanceRosterReady, private: true }));

    const missingRoot = clone(attendanceRosterReady);
    Reflect.deleteProperty(missingRoot, "recorded_count");
    rejected(() => decodeAttendanceRoster(missingRoot));

    const extraGame = clone(attendanceRosterReady);
    (extraGame.game as Record<string, unknown>).order_id = "private";
    rejected(() => decodeAttendanceRoster(extraGame));

    const missingGame = clone(attendanceRosterReady);
    Reflect.deleteProperty(missingGame.game as Record<string, unknown>, "state");
    rejected(() => decodeAttendanceRoster(missingGame));

    for (const field of ["note", "applicant_user_id", "attendance_recorded_by_user_id"]) {
      const privateItem = clone(attendanceRosterReady);
      (privateItem.registrations as Array<Record<string, unknown>>)[0][field] = "private";
      rejected(() => decodeAttendanceRoster(privateItem));
    }

    const missingItem = clone(attendanceRosterReady);
    Reflect.deleteProperty(
      (missingItem.registrations as Array<Record<string, unknown>>)[0],
      "version",
    );
    rejected(() => decodeAttendanceRoster(missingItem));
  });

  test("rejects extra or missing mark-result fields", () => {
    rejected(() => decodeAttendanceMarkResult({ ...attendanceMarkPresent, private: true }));
    const missing = clone(attendanceMarkPresent);
    Reflect.deleteProperty(missing, "registration_id");
    rejected(() => decodeAttendanceMarkResult(missing));
  });

  test("rejects invalid roster enums, UUIDs, RFC3339 timestamps, and IANA time zones", () => {
    const mutations: Array<(value: Record<string, unknown>) => void> = [
      (value) => { (value.game as Record<string, unknown>).id = "not-a-uuid"; },
      (value) => { (value.game as Record<string, unknown>).state = "PUBLISHED"; },
      (value) => { (value.game as Record<string, unknown>).starts_at = "2026-08-30 18:30:00"; },
      (value) => { (value.game as Record<string, unknown>).time_zone = "Shanghai"; },
      (value) => {
        (value.registrations as Array<Record<string, unknown>>)[0].registration_id = "bad";
      },
      (value) => {
        (value.registrations as Array<Record<string, unknown>>)[0].position = "SWEEPER";
      },
      (value) => {
        (value.registrations as Array<Record<string, unknown>>)[0].attendance_status = "ABSENT";
      },
      (value) => {
        const item = (value.registrations as Array<Record<string, unknown>>)[1];
        item.attendance_recorded_at = "2026-08-30T20:32:00";
      },
    ];
    for (const mutate of mutations) {
      const value = clone(attendanceRosterReady);
      mutate(value);
      rejected(() => decodeAttendanceRoster(value));
    }
  });

  test("rejects unsafe roster integers", () => {
    for (const mutate of [
      (value: Record<string, unknown>) => { value.recorded_count = Number.MAX_SAFE_INTEGER + 1; },
      (value: Record<string, unknown>) => { value.total_count = Number.MAX_SAFE_INTEGER + 1; },
      (value: Record<string, unknown>) => {
        (value.registrations as Array<Record<string, unknown>>)[0].version =
          Number.MAX_SAFE_INTEGER + 1;
      },
    ]) {
      const value = clone(attendanceRosterReady);
      mutate(value);
      rejected(() => decodeAttendanceRoster(value));
    }
  });

  test("enforces roster attendance status/time pairing", () => {
    for (const patch of [
      { attendance_status: "UNMARKED", attendance_recorded_at: "2026-08-30T20:32:00+08:00" },
      { attendance_status: "PRESENT", attendance_recorded_at: null },
      { attendance_status: "NO_SHOW", attendance_recorded_at: null },
    ]) {
      const value = clone(attendanceRosterReady);
      Object.assign((value.registrations as Array<Record<string, unknown>>)[0], patch);
      rejected(() => decodeAttendanceRoster(value));
    }
  });

  test("enforces roster length, recorded-count, and completion invariants", () => {
    for (const patch of [
      { total_count: 2 },
      { recorded_count: 1 },
      { attendance_complete: true },
    ]) rejected(() => decodeAttendanceRoster({ ...attendanceRosterReady, ...patch }));
    rejected(() => decodeAttendanceRoster({ ...attendanceRosterEmpty, attendance_complete: false }));
  });

  test("enforces attendance game and visible-text bounds", () => {
    for (const mutate of [
      (value: Record<string, unknown>) => { (value.game as Record<string, unknown>).name = "一"; },
      (value: Record<string, unknown>) => { (value.game as Record<string, unknown>).venue_name = ""; },
      (value: Record<string, unknown>) => {
        (value.registrations as Array<Record<string, unknown>>)[0].display_name = "一";
      },
      (value: Record<string, unknown>) => {
        (value.game as Record<string, unknown>).ends_at = "2026-08-30T18:30:00+08:00";
      },
    ]) {
      const value = clone(attendanceRosterReady);
      mutate(value);
      rejected(() => decodeAttendanceRoster(value));
    }
  });

  test("rejects invalid mark-result scalar authority", () => {
    for (const patch of [
      { registration_id: "not-a-uuid" },
      { attendance_status: "UNMARKED" },
      { attendance_status: "ABSENT" },
      { attendance_recorded_at: "2026-08-30T20:36:00" },
      { version: 1 },
      { recorded_count: 0 },
      { total_count: 0 },
      { version: Number.MAX_SAFE_INTEGER + 1 },
      { recorded_count: Number.MAX_SAFE_INTEGER + 1 },
      { total_count: Number.MAX_SAFE_INTEGER + 1 },
    ]) rejected(() => decodeAttendanceMarkResult({ ...attendanceMarkPresent, ...patch }));
  });

  test("enforces mark-result count and completion invariants", () => {
    for (const patch of [
      { recorded_count: 4 },
      { recorded_count: 2, attendance_complete: true },
      { recorded_count: 3, attendance_complete: false },
    ]) rejected(() => decodeAttendanceMarkResult({ ...attendanceMarkPresent, ...patch }));
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
          waitlistPosition: null,
          waitlistedAt: null,
          promotedAt: null,
          attendanceStatus: null,
          attendanceRecordedAt: null,
          attendanceCorrectedAt: null,
          detailPath: "/pages/captain-game-public/index?token=AbCdEfGhIjKlMnOpQrStUvWxYz012345&game_id=51000000-0000-4000-8000-000000000001",
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
          waitlistPosition: null,
          waitlistedAt: null,
          promotedAt: null,
          attendanceStatus: null,
          attendanceRecordedAt: null,
          attendanceCorrectedAt: null,
          detailPath: "/pages/captain-game-public/index?token=0123456789abcdefghijklmnopqrstuv&game_id=51000000-0000-4000-8000-000000000002",
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
          waitlistPosition: null,
          waitlistedAt: null,
          promotedAt: null,
          attendanceStatus: "NO_SHOW",
          attendanceRecordedAt: "2026-08-30T20:32:00+08:00",
          attendanceCorrectedAt: "2026-08-31T14:18:00+08:00",
          detailPath: "/pages/captain-game-public/index?token=zyxwvutsrqponmlkjihgfedcba543210&game_id=51000000-0000-4000-8000-000000000003",
          gameName: "周三五人制夜场",
          startsAt: "2026-08-30T18:30:00+08:00",
          endsAt: "2026-08-30T20:30:00+08:00",
          timeZone: "Asia/Shanghai",
          venueName: "逐光足球公园",
          pitchName: "3号场",
          pitchSpecification: "5人制",
        },
        {
          id: "40000000-0000-4000-8000-000000000001",
          effectiveStatus: "APPLIED",
          appliedAt: "2026-08-26T12:00:00+08:00",
          waitlistPosition: null,
          waitlistedAt: null,
          promotedAt: null,
          attendanceStatus: null,
          attendanceRecordedAt: null,
          attendanceCorrectedAt: null,
          detailPath: "/pages/captain-game-public/index?token=A1_b2-C3_d4-E5_f6-G7_h8-I9_j0-KL&game_id=51000000-0000-4000-8000-000000000004",
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

  test("decodes WAITLISTED and promoted waitlist history for my applications", () => {
    const value = clone(myApplicationsReady);
    const first = (value.items as Array<Record<string, unknown>>)[0];
    first.effective_status = "WAITLISTED";
    first.waitlist_position = 3;
    first.waitlisted_at = "2026-08-29T12:05:00+08:00";
    expect(decodeMyOpenGameApplications(value).items[0]).toMatchObject({
      effectiveStatus: "WAITLISTED",
      waitlistPosition: 3,
      waitlistedAt: "2026-08-29T12:05:00+08:00",
      promotedAt: null,
    });

    first.effective_status = "JOINED";
    first.waitlist_position = null;
    first.promoted_at = "2026-08-29T12:10:00+08:00";
    expect(decodeMyOpenGameApplications(value).items[0]).toMatchObject({
      effectiveStatus: "JOINED",
      waitlistPosition: null,
      waitlistedAt: "2026-08-29T12:05:00+08:00",
      promotedAt: "2026-08-29T12:10:00+08:00",
    });

    for (const patch of [
      { effective_status: "WAITLISTED", waitlist_position: null, waitlisted_at: "2026-08-29T12:05:00+08:00" },
      { effective_status: "WAITLISTED", waitlist_position: 1, waitlisted_at: null },
      { effective_status: "JOINED", waitlist_position: null, waitlisted_at: "2026-08-29T12:05:00+08:00", promoted_at: null },
      { effective_status: "JOINED", waitlist_position: null, waitlisted_at: "2026-08-29T12:10:00+08:00", promoted_at: "2026-08-29T12:05:00+08:00" },
      { effective_status: "CANCELLED", waitlist_position: 1, waitlisted_at: "2026-08-29T12:05:00+08:00", promoted_at: "2026-08-29T12:10:00+08:00" },
    ]) {
      const invalidValue = clone(myApplicationsReady);
      Object.assign((invalidValue.items as Array<Record<string, unknown>>)[0], patch);
      rejected(() => decodeMyOpenGameApplications(invalidValue));
    }
  });

  test("rejects extra, private, and missing fields at both closed boundaries", () => {
    rejected(() => decodeMyOpenGameApplications({ ...myApplicationsReady, private: true }));
    const privateItem = clone(myApplicationsReady);
    (privateItem.items as Array<Record<string, unknown>>)[0].applicant_user_id = "private";
    rejected(() => decodeMyOpenGameApplications(privateItem));
    const missingItem = clone(myApplicationsReady);
    Reflect.deleteProperty((missingItem.items as Array<Record<string, unknown>>)[0], "venue_name");
    rejected(() => decodeMyOpenGameApplications(missingItem));

    const missingAttendance = clone(myApplicationsReady);
    Reflect.deleteProperty(
      (missingAttendance.items as Array<Record<string, unknown>>)[0],
      "attendance_recorded_at",
    );
    rejected(() => decodeMyOpenGameApplications(missingAttendance));
  });

  test("decodes and enforces nullable attendance pairs in existing application items", () => {
    const value = clone(myApplicationsReady);
    Object.assign((value.items as Array<Record<string, unknown>>)[2], {
      attendance_status: "NO_SHOW",
      attendance_recorded_at: "2026-09-02T22:10:00+08:00",
      attendance_corrected_at: null,
    });
    expect(decodeMyOpenGameApplications(value).items[2]).toMatchObject({
      attendanceStatus: "NO_SHOW",
      attendanceRecordedAt: "2026-09-02T22:10:00+08:00",
    });

    const joinedUnmarked = clone(myApplicationsReady);
    Object.assign((joinedUnmarked.items as Array<Record<string, unknown>>)[2], {
      attendance_status: "UNMARKED",
      attendance_recorded_at: null,
      attendance_corrected_at: null,
    });
    expect(decodeMyOpenGameApplications(joinedUnmarked).items[2]).toMatchObject({
      effectiveStatus: "JOINED",
      attendanceStatus: "UNMARKED",
      attendanceRecordedAt: null,
    });

    for (const [index, patch] of [
      [1, { attendance_status: "UNMARKED", attendance_recorded_at: null }],
      [3, {
        attendance_status: "PRESENT",
        attendance_recorded_at: "2026-09-02T22:10:00+08:00",
      }],
    ] as const) {
      const nonJoined = clone(myApplicationsReady);
      Object.assign((nonJoined.items as Array<Record<string, unknown>>)[index], patch);
      rejected(() => decodeMyOpenGameApplications(nonJoined));
    }

    for (const patch of [
      { attendance_status: null, attendance_recorded_at: "2026-09-02T22:10:00+08:00" },
      { attendance_status: "UNMARKED", attendance_recorded_at: "2026-09-02T22:10:00+08:00" },
      { attendance_status: "PRESENT", attendance_recorded_at: null },
      { attendance_status: "ABSENT", attendance_recorded_at: null },
      { attendance_status: "NO_SHOW", attendance_recorded_at: "2026-09-02 22:10:00" },
    ]) {
      const invalidValue = clone(myApplicationsReady);
      Object.assign((invalidValue.items as Array<Record<string, unknown>>)[2], patch);
      rejected(() => decodeMyOpenGameApplications(invalidValue));
    }
  });

  test("decodes corrected-at on the joined self item and rejects impossible pairs", () => {
    const corrected = clone(myApplicationsReady);
    const items = corrected.items as Array<Record<string, unknown>>;
    items.forEach((item) => { item.attendance_corrected_at = null; });
    Object.assign(items[2], {
      attendance_status: "NO_SHOW",
      attendance_recorded_at: "2026-09-02T22:10:00+08:00",
      attendance_corrected_at: "2026-09-03T08:15:00+08:00",
    });
    expect(decodeMyOpenGameApplications(corrected).items[2]).toMatchObject({
      attendanceStatus: "NO_SHOW",
      attendanceRecordedAt: "2026-09-02T22:10:00+08:00",
      attendanceCorrectedAt: "2026-09-03T08:15:00+08:00",
    });

    for (const [index, patch] of [
      [0, { attendance_corrected_at: "2026-09-03T08:15:00+08:00" }],
      [2, { attendance_status: "UNMARKED", attendance_recorded_at: null,
        attendance_corrected_at: "2026-09-03T08:15:00+08:00" }],
      [2, { attendance_corrected_at: "2026-09-02T21:10:00+08:00" }],
    ] as const) {
      const invalidValue = clone(corrected);
      Object.assign((invalidValue.items as Array<Record<string, unknown>>)[index], patch);
      rejected(() => decodeMyOpenGameApplications(invalidValue));
    }
  });

  test.each([
    ["UUID", "id", "not-a-uuid"],
    ["canonical lowercase UUID", "id", "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA"],
    ["status", "effective_status", "PENDING"],
    ["RFC3339 applied time", "applied_at", "2026-08-29 12:00:00"],
    ["shared detail path", "detail_path", "/pages/captain-game-public/index?token=too-short"],
    ["shared detail game", "detail_path", "/pages/captain-game-public/index?token=AbCdEfGhIjKlMnOpQrStUvWxYz012345"],
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
