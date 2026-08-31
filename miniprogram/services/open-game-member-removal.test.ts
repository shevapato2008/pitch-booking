/// <reference types="node" />
import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";

import { decodeOpenGameMemberRoster } from "../domain/open-game-registration-decoder";
import {
  classifyOpenGameMemberRemovalUnknownResult,
  classifyOpenGameRegistrationPendingAttempt,
  type OpenGameMemberRemoveAttempt,
} from "./open-game-registration";

const fixture = (name: string): Record<string, unknown> => JSON.parse(
  readFileSync(`contracts/examples/${name}.json`, "utf8"),
) as Record<string, unknown>;
const USER_ID = "11111111-2222-4333-8444-555555555555";
const OTHER_GAME_ID = "22222222-3333-4444-8555-666666666666";
const roster = decodeOpenGameMemberRoster(fixture("open-game-member-roster-ready"));
const attempt: OpenGameMemberRemoveAttempt = {
  kind: "remove-member",
  originatingUserId: USER_ID,
  gameId: roster.game.id,
  registrationId: roster.members[0].registrationId,
  expectedVersion: roster.members[0].version,
  reason: "临时有事，双方已沟通",
  idempotencyKey: "remove-member-key-000000000001",
};

describe("open-game member removal recovery", () => {
  test("replays only an exact unchanged member and accepts absence or changed authority", () => {
    expect(classifyOpenGameMemberRemovalUnknownResult(attempt, roster)).toEqual({
      kind: "REPLAY_SAME_ATTEMPT",
      attempt,
      clearAttempt: false,
    });
    const absent = { ...roster, joinedCount: 1, remainingSpots: 1, members: roster.members.slice(1) };
    expect(classifyOpenGameMemberRemovalUnknownResult(attempt, absent)).toEqual({
      kind: "ACCEPT_AUTHORITY_AND_CLEAR",
      authority: absent,
      clearAttempt: true,
    });
    const changed = {
      ...roster,
      members: roster.members.map((member) => member.registrationId === attempt.registrationId
        ? { ...member, version: member.version + 1 }
        : member),
    };
    expect(classifyOpenGameMemberRemovalUnknownResult(attempt, changed)).toEqual({
      kind: "ACCEPT_AUTHORITY_AND_CLEAR",
      authority: changed,
      clearAttempt: true,
    });
  });

  test("keeps removal attempts on their owner roster route", () => {
    expect(classifyOpenGameRegistrationPendingAttempt(
      attempt,
      USER_ID,
      { kind: "remove-member", gameId: roster.game.id },
    )).toEqual({ kind: "READY", attempt, clearAttempt: false });
    expect(classifyOpenGameRegistrationPendingAttempt(
      attempt,
      USER_ID,
      { kind: "remove-member", gameId: OTHER_GAME_ID },
    )).toEqual({
      kind: "PRESERVE_AND_NAVIGATE",
      route: `/pages/captain-game-members/index?game_id=${roster.game.id}`,
      clearAttempt: false,
    });
  });
});
