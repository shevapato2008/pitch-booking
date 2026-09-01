/// <reference types="node" />

import { expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";

import {
  decodeOpenGameSignupContext as decodeOpenGameRegistrationContext,
} from "./open-game-registration-decoder";

const fixture = (name: string): Record<string, unknown> => JSON.parse(
  readFileSync(`contracts/examples/${name}.json`, "utf8"),
) as Record<string, unknown>;

const registrationId = "40000000-0000-4000-8000-000000000102";
const waitlistedId = "40000000-0000-4000-8000-000000000103";
const blockedId = "40000000-0000-4000-8000-000000000104";
const gameId = "30000000-0000-4000-8000-000000000201";

function baseContext(viewerAuthenticated: boolean): Record<string, unknown> {
  const base = fixture(viewerAuthenticated
    ? "open-game-registration-context-apply-ready"
    : "open-game-registration-context-anonymous");
  return {
    ...base,
    remaining_spots: 2,
    joined_count: 2,
    waitlist_count: 2,
  };
}

test("anonymous signup context exposes roster counts but keeps every roster projection null", () => {
  const decoded = decodeOpenGameRegistrationContext({
    ...baseContext(false),
    joined_members: null,
    waitlisted_members: null,
    blocked_members: null,
  }) as unknown as Record<string, unknown>;

  expect(decoded).toMatchObject({
    viewerAuthenticated: false,
    joinedCount: 2,
    waitlistCount: 2,
    joinedMembers: null,
    waitlistedMembers: null,
    blockedMembers: null,
    managementGameId: null,
  });
});

test("logged-in signup context decodes only public nickname/avatar and FIFO waitlist order", () => {
  const decoded = decodeOpenGameRegistrationContext({
    ...baseContext(true),
    joined_members: [
      { nickname: "翼", avatar_url: "https://cdn.example.com/avatars/a.png" },
      { nickname: "阿蓝", avatar_url: null },
    ],
    waitlisted_members: [
      { nickname: "小满", avatar_url: "https://cdn.example.com/avatars/b.png", waitlist_position: 1 },
      { nickname: "小跑", avatar_url: null, waitlist_position: 2 },
    ],
    blocked_members: null,
  }) as unknown as {
    joinedMembers: Array<Record<string, unknown>>;
    waitlistedMembers: Array<Record<string, unknown>>;
  };

  expect(decoded.joinedMembers).toEqual([
    { nickname: "翼", avatarUrl: "https://cdn.example.com/avatars/a.png", management: null },
    { nickname: "阿蓝", avatarUrl: null, management: null },
  ]);
  expect(decoded.waitlistedMembers).toEqual([
    { nickname: "小满", avatarUrl: "https://cdn.example.com/avatars/b.png", waitlistPosition: 1, management: null },
    { nickname: "小跑", avatarUrl: null, waitlistPosition: 2, management: null },
  ]);
  expect(JSON.stringify({
    joinedMembers: decoded.joinedMembers,
    waitlistedMembers: decoded.waitlistedMembers,
  })).not.toMatch(/"position"|note|user_id|openid|phone/i);
});

test("captain signup context carries owner-only management authority for joined, waitlisted and blocked rows", () => {
  const remove = (registration_id: string, version: number) => ({
    registration_id,
    version,
    can_remove: true,
    can_allow_reapply: false,
  });
  const allow = {
    registration_id: blockedId,
    version: 4,
    can_remove: false,
    can_allow_reapply: true,
  };
  const decoded = decodeOpenGameRegistrationContext({
    ...baseContext(true),
    management_game_id: gameId,
    joined_members: [{
      nickname: "小翼",
      avatar_url: "https://cdn.example.com/avatars/a.png",
      management: remove(registrationId, 2),
    }, {
      nickname: "阿蓝",
      avatar_url: null,
      management: remove("40000000-0000-4000-8000-000000000105", 3),
    }],
    waitlisted_members: [{
      nickname: "小满",
      avatar_url: null,
      waitlist_position: 1,
      management: remove(waitlistedId, 2),
    }, {
      nickname: "小跑",
      avatar_url: null,
      waitlist_position: 2,
      management: remove("40000000-0000-4000-8000-000000000106", 1),
    }],
    blocked_members: [{ nickname: "旧队员", avatar_url: null, management: allow }],
  }) as unknown as {
    managementGameId: string | null;
    joinedMembers: Array<{ management: unknown }>;
    waitlistedMembers: Array<Record<string, unknown>>;
    blockedMembers: Array<Record<string, unknown>>;
  };

  expect(decoded.managementGameId).toBe(gameId);
  expect(decoded.joinedMembers?.[0].management).toEqual({
    registrationId,
    version: 2,
    canRemove: true,
    canAllowReapply: false,
  });
  expect(decoded.waitlistedMembers?.[0]).toMatchObject({ waitlistPosition: 1 });
  expect(decoded.blockedMembers).toEqual([{
    nickname: "旧队员",
    avatarUrl: null,
    management: {
      registrationId: blockedId,
      version: 4,
      canRemove: false,
      canAllowReapply: true,
    },
  }]);
});

test("captain signup context preserves disabled owner actions without granting either capability", () => {
  const decoded = decodeOpenGameRegistrationContext({
    ...baseContext(true),
    remaining_spots: 3,
    joined_count: 1,
    waitlist_count: 0,
    management_game_id: gameId,
    joined_members: [{
      nickname: "小翼",
      avatar_url: null,
      management: {
        registration_id: registrationId,
        version: 2,
        can_remove: false,
        can_allow_reapply: false,
      },
    }],
    waitlisted_members: [],
    blocked_members: [],
  });

  expect(decoded.joinedMembers?.[0].management).toMatchObject({
    canRemove: false,
    canAllowReapply: false,
  });
});

test("signup context still rejects management capabilities for an ordinary logged-in viewer", () => {
  expect(() => decodeOpenGameRegistrationContext({
    ...baseContext(true),
    remaining_spots: 3,
    joined_count: 1,
    waitlist_count: 0,
    joined_members: [{
      nickname: "小翼",
      avatar_url: null,
      management: {
        registration_id: registrationId,
        version: 2,
        can_remove: false,
        can_allow_reapply: false,
      },
    }],
    waitlisted_members: [],
    blocked_members: null,
  })).toThrow("$.joined_members");
});

test("signup context rejects a non-FIFO waitlist projection", () => {
  expect(() => decodeOpenGameRegistrationContext({
    ...baseContext(true),
    joined_members: [
      { nickname: "小翼", avatar_url: null },
      { nickname: "阿蓝", avatar_url: null },
    ],
    waitlisted_members: [
      { nickname: "小满", avatar_url: null, waitlist_position: 2 },
      { nickname: "小跑", avatar_url: null, waitlist_position: 1 },
    ],
    blocked_members: null,
  })).toThrow("$.waitlisted_members[0].waitlist_position");
});

test("signup context rejects owner management authority for an anonymous viewer", () => {
  expect(() => decodeOpenGameRegistrationContext({
    ...baseContext(false),
    management_game_id: gameId,
    joined_members: null,
    waitlisted_members: null,
    blocked_members: null,
  })).toThrow("$.management_game_id");
});

test("signup context rejects unblock authority on an active roster member", () => {
  expect(() => decodeOpenGameRegistrationContext({
    ...baseContext(true),
    remaining_spots: 3,
    joined_count: 1,
    waitlist_count: 0,
    management_game_id: gameId,
    joined_members: [{
      nickname: "小翼",
      avatar_url: null,
      management: {
        registration_id: registrationId,
        version: 2,
        can_remove: false,
        can_allow_reapply: true,
      },
    }],
    waitlisted_members: [],
    blocked_members: [],
  })).toThrow("$.joined_members");
});

test("signup context decodes the captain-removal reapply blocker", () => {
  const decoded = decodeOpenGameRegistrationContext({
    ...baseContext(true),
    joined_members: [
      { nickname: "小翼", avatar_url: null },
      { nickname: "阿蓝", avatar_url: null },
    ],
    waitlisted_members: [
      { nickname: "小满", avatar_url: null, waitlist_position: 1 },
      { nickname: "小跑", avatar_url: null, waitlist_position: 2 },
    ],
    blocked_members: null,
    allowed_actions: {
      can_apply: false,
      apply_blocked_reason: "REMOVED_BY_CAPTAIN",
    },
  });

  expect(decoded.allowedActions).toEqual({
    canApply: false,
    applyBlockedReason: "REMOVED_BY_CAPTAIN",
  });
});
