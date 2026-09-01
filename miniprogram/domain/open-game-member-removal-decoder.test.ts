/// <reference types="node" />
import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";

import { ApiResponseError } from "./contracts";
import {
  decodeOpenGameMemberRemovalResult,
  decodeOpenGameMemberRoster,
  decodeOpenGameRegistrationContext,
  validateOpenGameMemberRemovalReason,
} from "./open-game-registration-decoder";

const fixture = (name: string): Record<string, unknown> => JSON.parse(
  readFileSync(`contracts/examples/${name}.json`, "utf8"),
) as Record<string, unknown>;
const clone = <T>(value: T): T => structuredClone(value);

describe("open-game member removal response decoders", () => {
  test("decodes ready and blocked owner rosters as closed camel-case authority", () => {
    const ready = decodeOpenGameMemberRoster(fixture("open-game-member-roster-ready"));
    expect(ready).toMatchObject({
      game: { id: "51000000-0000-4000-8000-000000000001", state: "PUBLISHED" },
      joinedCount: 2,
      remainingSpots: 0,
      waitlistCount: 1,
      members: [
        {
          registrationId: "52000000-0000-4000-8000-000000000001",
          displayName: "小陈",
          promotedFromWaitlist: false,
          version: 2,
          allowedActions: { canRemove: true, removeBlockedReason: null },
        },
        {
          registrationId: "52000000-0000-4000-8000-000000000002",
          promotedFromWaitlist: true,
          version: 3,
        },
      ],
    });
    expect(decodeOpenGameMemberRoster(fixture("open-game-member-roster-blocked")))
      .toMatchObject({
        game: { state: "SUSPENDED" },
        members: [{
          allowedActions: { canRemove: false, removeBlockedReason: "GAME_SUSPENDED" },
        }],
      });
    expect(Object.isFrozen(ready)).toBe(true);
    expect(Object.isFrozen(ready.members)).toBe(true);
    expect(ready.members.every(Object.isFrozen)).toBe(true);
  });

  test("decodes promotion and open-spot removal results without exposing the reason", () => {
    expect(decodeOpenGameMemberRemovalResult(
      fixture("open-game-member-removal-promoted"),
    )).toEqual({
      removedRegistrationId: "52000000-0000-4000-8000-000000000001",
      removedDisplayName: "小陈",
      status: "REMOVED",
      version: 3,
      removedAt: "2026-09-01T11:00:00+08:00",
      joinedCount: 2,
      remainingSpots: 0,
      waitlistCount: 0,
      promotedMember: {
        registrationId: "52000000-0000-4000-8000-000000000004",
        displayName: "小林",
        position: "GOALKEEPER",
        version: 3,
      },
    });
    expect(decodeOpenGameMemberRemovalResult(
      fixture("open-game-member-removal-open-spot"),
    )).toMatchObject({
      status: "REMOVED",
      remainingSpots: 4,
      promotedMember: null,
    });
  });

  test("accepts single-character direct-signup names in owner and removal projections", () => {
    const roster = clone(fixture("open-game-member-roster-ready"));
    (roster.members as Array<Record<string, unknown>>)[0].display_name = "甲";
    expect(decodeOpenGameMemberRoster(roster).members[0].displayName).toBe("甲");

    const removal = clone(fixture("open-game-member-removal-promoted"));
    removal.removed_display_name = "乙";
    (removal.promoted_member as Record<string, unknown>).display_name = "丙";
    expect(decodeOpenGameMemberRemovalResult(removal)).toMatchObject({
      removedDisplayName: "乙",
      promotedMember: { displayName: "丙" },
    });
  });

  test("rejects roster count, duplicate identity, action, and result pairing drift", () => {
    const count = clone(fixture("open-game-member-roster-ready"));
    count.joined_count = 3;
    expect(() => decodeOpenGameMemberRoster(count)).toThrow(ApiResponseError);

    const duplicate = clone(fixture("open-game-member-roster-ready"));
    const duplicateMembers = duplicate.members as Array<Record<string, unknown>>;
    duplicateMembers[1].registration_id = duplicateMembers[0].registration_id;
    expect(() => decodeOpenGameMemberRoster(duplicate)).toThrow(ApiResponseError);

    const actions = clone(fixture("open-game-member-roster-ready"));
    ((actions.members as Array<Record<string, unknown>>)[0].allowed_actions as
      Record<string, unknown>).can_remove = false;
    expect(() => decodeOpenGameMemberRoster(actions)).toThrow(ApiResponseError);

    const result = clone(fixture("open-game-member-removal-promoted"));
    result.remaining_spots = 1;
    expect(() => decodeOpenGameMemberRemovalResult(result)).toThrow(ApiResponseError);
  });

  test("accepts the real REMOVED viewer terminal with nullable private-free readback", () => {
    const context = fixture("open-game-registration-context-joined");
    Object.assign(context.viewer_registration as Record<string, unknown>, {
      version: 3,
      persisted_status: "REMOVED",
      effective_status: "REMOVED",
      removed_at: "2026-09-01T11:00:00+08:00",
      available_withdrawal_action: null,
      late_exit_will_be_recorded: false,
      attendance_status: null,
      attendance_recorded_at: null,
      attendance_corrected_at: null,
    });
    expect(decodeOpenGameRegistrationContext(context).viewerRegistration).toMatchObject({
      persistedStatus: "REMOVED",
      effectiveStatus: "REMOVED",
      removedAt: "2026-09-01T11:00:00+08:00",
    });
  });

  test("normalizes a 1–120 character reason and rejects empty, long, and private text", () => {
    expect(validateOpenGameMemberRemovalReason("  临时有事，双方已沟通  ")).toEqual({
      valid: true,
      reason: "临时有事，双方已沟通",
      error: null,
    });
    for (const reason of ["   ", "球".repeat(121), "微信 wx_friend", "13800138000"]) {
      expect(validateOpenGameMemberRemovalReason(reason)).toMatchObject({ valid: false });
    }
  });
});
