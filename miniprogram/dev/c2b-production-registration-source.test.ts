/// <reference types="node" />

import { beforeEach, expect, test } from "@jest/globals";

import type {
  OpenGameAttendanceMarkAttempt,
  OpenGameRegistrationDecisionAttempt,
} from "../services/open-game-registration";
import {
  C2B_PRODUCTION_PREVIEW_APPLICATION_ID,
  C2B_PRODUCTION_PREVIEW_GAME_ID,
  C2B_PRODUCTION_PREVIEW_SHARE_TOKEN,
  C2B_PRODUCTION_PREVIEW_USER_ID,
  createC2bProductionPreviewSource,
} from "./c2b-production-registration-source";

let preview: ReturnType<typeof createC2bProductionPreviewSource>;

const ATTENDANCE_GAME_ID = "30000000-0000-4000-8000-000000000201";
const ATTENDANCE_REGISTRATION_ID = "40000000-0000-4000-8000-000000000201";
const attendanceAttempt: OpenGameAttendanceMarkAttempt = {
  kind: "attendance",
  originatingUserId: C2B_PRODUCTION_PREVIEW_USER_ID,
  gameId: ATTENDANCE_GAME_ID,
  registrationId: ATTENDANCE_REGISTRATION_ID,
  attendanceStatus: "PRESENT",
  expectedVersion: 2,
  idempotencyKey: "c2b-attendance-unavailable-0001",
};

beforeEach(() => {
  preview = createC2bProductionPreviewSource();
});
function waitlistAttempt(): OpenGameRegistrationDecisionAttempt {
  return {
    kind: "decision",
    originatingUserId: C2B_PRODUCTION_PREVIEW_USER_ID,
    gameId: C2B_PRODUCTION_PREVIEW_GAME_ID,
    applicationId: C2B_PRODUCTION_PREVIEW_APPLICATION_ID,
    decision: "WAITLIST",
    expectedVersion: 1,
    idempotencyKey: "c2b-production-preview-waitlist-0001",
  };
}

test("attendance is explicitly unavailable inside the isolated C2b preview", async () => {
  await expect(preview.source.getAttendanceRoster(ATTENDANCE_GAME_ID))
    .rejects.toEqual(new Error("C2B_PRODUCTION_PREVIEW_ATTENDANCE_NOT_AVAILABLE"));
  await expect(preview.source.markAttendance(attendanceAttempt))
    .rejects.toEqual(new Error("C2B_PRODUCTION_PREVIEW_ATTENDANCE_NOT_AVAILABLE"));
});

test("full review projects a real full queue with WAITLIST and REJECT only", async () => {
  preview.reset("FULL_REVIEW");

  const queue = await preview.source.getPending(C2B_PRODUCTION_PREVIEW_GAME_ID);

  expect(queue).toMatchObject({ remainingSpots: 0, pendingCount: 1, waitlistCount: 1 });
  expect(queue.applications).toHaveLength(1);
  expect(queue.applications[0]).toMatchObject({
    id: C2B_PRODUCTION_PREVIEW_APPLICATION_ID,
    version: 1,
    allowedActions: {
      canAccept: false,
      acceptBlockedReason: "GAME_FULL",
      canWaitlist: true,
      waitlistBlockedReason: null,
      canReject: true,
      rejectBlockedReason: null,
    },
  });
});

test("WAITLIST mutation changes fixture authority and never invents a local position", async () => {
  preview.reset("FULL_REVIEW");

  const result = await preview.source.decide(waitlistAttempt());
  const queue = await preview.source.getPending(C2B_PRODUCTION_PREVIEW_GAME_ID);
  const context = await preview.source.getContext(C2B_PRODUCTION_PREVIEW_SHARE_TOKEN);

  expect(result).toMatchObject({
    applicationId: C2B_PRODUCTION_PREVIEW_APPLICATION_ID,
    status: "WAITLISTED",
    version: 2,
    remainingSpots: 0,
  });
  expect(queue).toMatchObject({ pendingCount: 0, waitlistCount: 2 });
  expect(context.viewerRegistration).toMatchObject({
    persistedStatus: "WAITLISTED",
    effectiveStatus: "WAITLISTED",
    waitlistPosition: 2,
    availableWithdrawalAction: "WITHDRAW_WAITLIST",
  });
});

test.each([
  ["WAITLISTED_FIRST", "PUBLISHED", "WAITLISTED", 1, null, "WITHDRAW_WAITLIST"],
  ["BLOCKED_SUSPENDED", "SUSPENDED", "WAITLISTED", 1, null, "WITHDRAW_WAITLIST"],
  ["PROMOTED", "PUBLISHED", "JOINED", null, "2026-08-30T20:05:00+08:00", "LEAVE_GAME"],
] as const)(
  "%s maps to production detail authority without importing fixture data into the page",
  async (scenario, gameState, effectiveStatus, waitlistPosition, promotedAt, action) => {
    preview.reset(scenario);
    const context = await preview.source.getContext(C2B_PRODUCTION_PREVIEW_SHARE_TOKEN);
    expect(context.game.state).toBe(gameState);
    expect(context.viewerRegistration).toMatchObject({
      effectiveStatus,
      waitlistPosition,
      promotedAt,
      availableWithdrawalAction: action,
    });
  },
);

test("WITHDRAW_WAITLIST returns terminal authority and listMine exposes a mixed production list", async () => {
  preview.reset("WAITLISTED_FIRST");
  const before = await preview.source.getContext(C2B_PRODUCTION_PREVIEW_SHARE_TOKEN);
  const registration = before.viewerRegistration!;

  const terminal = await preview.source.withdraw({
    kind: "withdraw",
    originatingUserId: C2B_PRODUCTION_PREVIEW_USER_ID,
    shareToken: C2B_PRODUCTION_PREVIEW_SHARE_TOKEN,
    applicationId: registration.id,
    action: "WITHDRAW_WAITLIST",
    expectedVersion: registration.version,
    idempotencyKey: "c2b-production-preview-withdraw-0001",
  });
  const page = await preview.source.listMine();

  expect(terminal.viewerRegistration).toMatchObject({
    persistedStatus: "WITHDRAWN",
    effectiveStatus: "WITHDRAWN",
    withdrawalKind: "WAITLIST_WITHDRAWAL",
    availableWithdrawalAction: null,
  });
  expect(page.items.map(({ effectiveStatus }) => effectiveStatus)).toEqual([
    "WITHDRAWN",
    "JOINED",
  ]);
  expect(page.items[0]?.detailPath).toBe(
    `/pages/captain-game-public/index?token=${C2B_PRODUCTION_PREVIEW_SHARE_TOKEN}`,
  );
  expect(terminal.waitlistCount).toBe(1);
  expect(terminal.waitlistedMembers?.map((member) => member.nickname)).toEqual(["赵一凡"]);
});

test.each(["WAITLISTED_FIRST", "PROMOTED", "FULL_REVIEW"] as const)(
  "%s supplies consistent public capacity, rosters and viewer position",
  async (scenario) => {
    preview.reset(scenario);
    const context = await preview.source.getContext(C2B_PRODUCTION_PREVIEW_SHARE_TOKEN);
    expect(context.joinedMembers).toHaveLength(4);
    expect(context.joinedCount).toBe(context.joinedMembers?.length);
    expect(context.waitlistCount).toBe(context.waitlistedMembers?.length);
    expect(context.remainingSpots).toBe(context.game.openSpots - context.joinedCount!);
    expect(context.game.fixedPlayers + context.game.openSpots).toBe(context.game.totalPlayers);
    if (scenario === "WAITLISTED_FIRST") {
      expect(context.waitlistedMembers?.[0]).toMatchObject({
        nickname: context.viewerRegistration?.displayName, waitlistPosition: 1,
      });
      expect(context.waitlistCount).toBe(2);
    }
    if (scenario === "PROMOTED") {
      expect(context.joinedMembers?.some((member) => member.nickname === "林晓雨")).toBe(true);
      expect(context.joinedMembers?.some((member) => member.nickname === "陈浩")).toBe(false);
    }
  },
);

test("profile edits stay in the preview session and appear on both game rosters", async () => {
  preview.reset("WAITLISTED_FIRST");
  expect(await preview.source.getPublicProfile?.()).toMatchObject({ nickname: "林晓雨" });
  const uploaded = await preview.source.uploadPublicProfileAvatar?.("wxfile://preview-avatar.png");
  expect(uploaded?.objectKey).toBeTruthy();
  const saved = await preview.source.savePublicProfile?.({
    nickname: "夜场小林", avatarObjectKey: uploaded!.objectKey,
  });
  expect(saved).toMatchObject({ nickname: "夜场小林", avatarUrl: "wxfile://preview-avatar.png", profileVersion: 2 });
  const primary = await preview.source.getContext(C2B_PRODUCTION_PREVIEW_SHARE_TOKEN);
  expect(primary.waitlistedMembers?.[0]).toMatchObject({ nickname: "夜场小林", avatarUrl: saved?.avatarUrl });
  const secondaryToken = (await preview.source.listMine()).items[1]!.detailPath.split("token=")[1]!;
  const secondary = await preview.source.getContext(secondaryToken);
  expect(secondary.joinedCount).toBe(secondary.joinedMembers?.length);
  expect(secondary.joinedMembers?.some((member) => member.nickname === "夜场小林")).toBe(true);
  preview.reset("WAITLISTED_FIRST");
  expect(await preview.source.getPublicProfile?.()).toMatchObject({ nickname: "林晓雨", avatarUrl: null, profileVersion: 1 });
});

test("new signup preview joins the actual fixture waitlist and can withdraw again", async () => {
  preview.reset("SIGNUP_FULL");
  const before = await preview.source.getSignupContext?.(C2B_PRODUCTION_PREVIEW_SHARE_TOKEN);
  expect(before).toMatchObject({ viewerRegistration: null, remainingSpots: 0, waitlistCount: 1, allowedActions: { canApply: true } });
  expect((await preview.source.listMine()).items).toHaveLength(1);
  const result = await preview.source.createRegistration?.({
    kind: "apply", originatingUserId: C2B_PRODUCTION_PREVIEW_USER_ID,
    shareToken: C2B_PRODUCTION_PREVIEW_SHARE_TOKEN, submissionMode: "DIRECT_REGISTRATION",
    idempotencyKey: "night-glow-signup-preview-0001",
    body: { displayName: "林晓雨", position: "ANY", note: null, adultConfirmed: true, riskConfirmed: true },
  });
  expect(result).toMatchObject({ waitlistCount: 2, viewerRegistration: { effectiveStatus: "WAITLISTED", waitlistPosition: 2 } });
  expect(result?.waitlistedMembers?.[1]?.nickname).toBe("林晓雨");
  const terminal = await preview.source.withdraw({
    kind: "withdraw", originatingUserId: C2B_PRODUCTION_PREVIEW_USER_ID,
    shareToken: C2B_PRODUCTION_PREVIEW_SHARE_TOKEN,
    applicationId: result!.viewerRegistration!.id, expectedVersion: result!.viewerRegistration!.version,
    action: "WITHDRAW_WAITLIST", idempotencyKey: "night-glow-signup-exit-0001",
  });
  expect(terminal.waitlistCount).toBe(1);
});
