/// <reference types="node" />

import { beforeEach, expect, test } from "@jest/globals";

import type { OpenGameRegistrationDecisionAttempt } from "../services/open-game-registration";
import {
  C2B_PRODUCTION_PREVIEW_APPLICATION_ID,
  C2B_PRODUCTION_PREVIEW_GAME_ID,
  C2B_PRODUCTION_PREVIEW_SHARE_TOKEN,
  C2B_PRODUCTION_PREVIEW_USER_ID,
  createC2bProductionPreviewSource,
} from "./c2b-production-registration-source";

let preview: ReturnType<typeof createC2bProductionPreviewSource>;

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
});
