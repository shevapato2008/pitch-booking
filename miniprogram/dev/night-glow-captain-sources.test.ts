/// <reference types="node" />

import { existsSync } from "node:fs";
import { expect, jest, test } from "@jest/globals";
import {
  classifyOpenGameAttendanceUnknownResult,
  classifyOpenGameMemberRemovalUnknownResult,
  type OpenGameAttendanceMarkAttempt,
  type OpenGameMemberRemoveAttempt,
  type OpenGameRegistrationSource,
} from "../services/open-game-registration";
import type { OpenGameReportAttempt, OpenGameReportSource } from "../services/open-game-report";
import { C2B_PRODUCTION_PREVIEW_GAME_ID, C2B_PRODUCTION_PREVIEW_USER_ID } from "./c2b-production-registration-source";

const MEMBERS_GAME_ID = "00000000-0000-4000-8000-000000000501";
const ATTENDANCE_GAME_ID = "00000000-0000-4000-8000-000000000401";
const REPORT_GAME_ID = "51000000-0000-4000-8000-000000000001";

function sources() {
  expect(existsSync("miniprogram/dev/night-glow-captain-sources.ts")).toBe(true);
  return jest.requireActual<{
    NIGHT_GLOW_CAPTAIN_PREVIEW_IDS: {
      membersGameId: string; attendanceGameId: string; reportGameId: string; userId: string;
    };
    createNightGlowCaptainRegistrationSource(): OpenGameRegistrationSource;
    createNightGlowReportSource(): OpenGameReportSource;
  }>("./night-glow-captain-sources");
}

test("exports stable routes and keeps the existing C2b registration source available", async () => {
  const module = sources();
  const source = module.createNightGlowCaptainRegistrationSource();
  expect(module.NIGHT_GLOW_CAPTAIN_PREVIEW_IDS).toEqual({
    membersGameId: MEMBERS_GAME_ID, attendanceGameId: ATTENDANCE_GAME_ID,
    reportGameId: REPORT_GAME_ID, userId: C2B_PRODUCTION_PREVIEW_USER_ID,
  });
  expect(await source.login()).toBe(source.currentUserId());
  expect(await source.getPending(C2B_PRODUCTION_PREVIEW_GAME_ID)).toMatchObject({ pendingCount: 1 });
  expect(await source.getPublicProfile!()).toMatchObject({ avatarUrl: null });
});

test("member removal changes the readback and promotes only the first waiting member", async () => {
  const source = sources().createNightGlowCaptainRegistrationSource();
  const before = await source.getMembers(MEMBERS_GAME_ID);
  expect(before.game.name).toContain("开发预览");
  expect(before).toMatchObject({ joinedCount: 2, remainingSpots: 0, waitlistCount: 1 });
  const member = before.members[0];
  const attempt: OpenGameMemberRemoveAttempt = {
    kind: "remove-member", originatingUserId: source.currentUserId()!, gameId: MEMBERS_GAME_ID,
    registrationId: member.registrationId, expectedVersion: member.version,
    reason: "队员临时无法到场", idempotencyKey: "night-glow-remove-0001",
  };
  const result = await source.removeMember(attempt);
  const after = await source.getMembers(MEMBERS_GAME_ID);
  expect(after).toMatchObject({ joinedCount: 2, remainingSpots: 0, waitlistCount: 0 });
  expect(after.members.some((item) => item.registrationId === member.registrationId)).toBe(false);
  expect(after.members.some((item) => item.registrationId === result.promotedMember?.registrationId)).toBe(true);
  expect(classifyOpenGameMemberRemovalUnknownResult(attempt, after).kind).toBe("ACCEPT_AUTHORITY_AND_CLEAR");
  expect(await source.removeMember(attempt)).toEqual(result);
  expect(await source.getMembers(MEMBERS_GAME_ID)).toEqual(after);
});

test("blocked members cannot be removed and each preview factory starts fresh", async () => {
  const module = sources();
  const source = module.createNightGlowCaptainRegistrationSource();
  const before = await source.getMembers(MEMBERS_GAME_ID);
  const blocked = before.members[1];
  await expect(source.removeMember({
    kind: "remove-member", originatingUserId: source.currentUserId()!, gameId: MEMBERS_GAME_ID,
    registrationId: blocked.registrationId, expectedVersion: blocked.version,
    reason: "队员临时无法到场", idempotencyKey: "night-glow-blocked-0001",
  })).rejects.toMatchObject({ code: "APPLICATION_STATE_CHANGED" });
  expect(await source.getMembers(MEMBERS_GAME_ID)).toEqual(before);
  expect(await module.createNightGlowCaptainRegistrationSource().getMembers(MEMBERS_GAME_ID)).toEqual(before);
  await expect(source.getMembers("unknown-game")).rejects.toMatchObject({ code: "OPEN_GAME_NOT_FOUND" });
});

test.each(["PRESENT", "NO_SHOW"] as const)("attendance %s persists into the completed mixed roster", async (attendanceStatus) => {
  const source = sources().createNightGlowCaptainRegistrationSource();
  const before = await source.getAttendanceRoster(ATTENDANCE_GAME_ID);
  expect(before.game.name).toContain("开发预览");
  expect(before).toMatchObject({ recordedCount: 2, totalCount: 3, attendanceComplete: false });
  expect(before.registrations.map((item) => item.attendanceStatus)).toEqual(["UNMARKED", "PRESENT", "NO_SHOW"]);
  const member = before.registrations[0];
  const attempt: OpenGameAttendanceMarkAttempt = {
    kind: "attendance", originatingUserId: source.currentUserId()!, gameId: ATTENDANCE_GAME_ID,
    registrationId: member.registrationId, expectedVersion: member.version,
    attendanceStatus, idempotencyKey: "night-glow-attendance-0001",
  };
  const result = await source.markAttendance(attempt);
  const after = await source.getAttendanceRoster(ATTENDANCE_GAME_ID);
  expect(result).toMatchObject({ attendanceStatus, version: member.version + 1, recordedCount: 3, attendanceComplete: true });
  expect(after).toMatchObject({ recordedCount: 3, totalCount: 3, attendanceComplete: true });
  expect(classifyOpenGameAttendanceUnknownResult(attempt, after).kind).toBe("ACCEPT_AUTHORITY_AND_CLEAR");
  expect(await source.markAttendance(attempt)).toEqual(result);
  await expect(source.markAttendance({ ...attempt, idempotencyKey: "night-glow-attendance-0002" }))
    .rejects.toMatchObject({ code: "ATTENDANCE_STATE_CHANGED" });
});

test("a report submission becomes the same reporter's pending readback without cross-instance state", async () => {
  const module = sources();
  const source = module.createNightGlowReportSource();
  const before = await source.getMyReport(REPORT_GAME_ID);
  expect(before.target.gameName).toContain("开发预览");
  expect(before).toMatchObject({ report: null, submissionAllowed: true });
  expect(await source.login()).toBe(source.currentUserId());
  const attempt: OpenGameReportAttempt = {
    originatingUserId: source.currentUserId()!, gameId: REPORT_GAME_ID,
    body: { category: "FALSE_INFORMATION", facts: "隔离开发预览：公开说明与现场情况存在差异。" },
    idempotencyKey: "night-glow-report-0001", replayed: false,
  };
  const result = await source.submit(attempt);
  expect(result).toMatchObject({ ...attempt.body, status: "PENDING", outcome: null });
  expect(await source.getMyReport(REPORT_GAME_ID)).toMatchObject({
    report: result, submissionAllowed: false, submissionBlocker: "REPORT_ALREADY_EXISTS",
  });
  expect(await source.submit({ ...attempt, replayed: true })).toEqual(result);
  await expect(source.submit({ ...attempt, idempotencyKey: "night-glow-report-0002" }))
    .rejects.toMatchObject({ code: "REPORT_ALREADY_EXISTS" });
  expect(await module.createNightGlowReportSource().getMyReport(REPORT_GAME_ID)).toEqual(before);
  await expect(source.getMyReport("unknown-game")).rejects.toMatchObject({ code: "REPORT_CONTEXT_NOT_FOUND" });
});
