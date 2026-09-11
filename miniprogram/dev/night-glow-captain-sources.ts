import type {
  OpenGameAttendanceMarkResult,
  OpenGameAttendanceRoster,
  OpenGameAttendanceRosterItem,
  OpenGameMemberRemovalResult,
  OpenGameMemberRoster,
  OpenGameMemberRosterItem,
} from "../domain/open-game-registration";
import type { OpenGameReportForReporter } from "../domain/open-game-report";
import { OpenGameRegistrationApiError } from "../services/http-open-game-registration";
import { OpenGameReportApiError } from "../services/http-open-game-report";
import type { OpenGameRegistrationSource } from "../services/open-game-registration";
import type { OpenGameReportSource } from "../services/open-game-report";
import {
  C2B_PRODUCTION_PREVIEW_USER_ID,
  createC2bProductionPreviewSource,
} from "./c2b-production-registration-source";

export const NIGHT_GLOW_CAPTAIN_PREVIEW_IDS = {
  membersGameId: "00000000-0000-4000-8000-000000000501",
  attendanceGameId: "00000000-0000-4000-8000-000000000401",
  reportGameId: "51000000-0000-4000-8000-000000000001",
  userId: C2B_PRODUCTION_PREVIEW_USER_ID,
} as const;

const REMOVED_AT = "2026-09-01T11:00:00+08:00";
const ATTENDANCE_RECORDED_AT = "2026-08-30T20:36:00+08:00";

// Development preview only. Each factory owns its state; nothing is sent or persisted.
export function createNightGlowCaptainRegistrationSource(): OpenGameRegistrationSource {
  const source = createC2bProductionPreviewSource().source;
  let members: OpenGameMemberRosterItem[] = [
    {
      registrationId: "00000000-0000-4000-8000-000000000511",
      displayName: "左边锋小王",
      position: "FORWARD",
      joinedAt: "2026-09-01T10:00:00+08:00",
      promotedFromWaitlist: false,
      version: 4,
      allowedActions: { canRemove: true, removeBlockedReason: null },
    },
    {
      registrationId: "00000000-0000-4000-8000-000000000512",
      displayName: "中场阿杰",
      position: "MIDFIELDER",
      joinedAt: "2026-09-01T10:30:00+08:00",
      promotedFromWaitlist: true,
      version: 3,
      allowedActions: { canRemove: false, removeBlockedReason: "ATTENDANCE_RECORDED" },
    },
  ];
  const waitingMembers: OpenGameMemberRosterItem[] = [{
    registrationId: "00000000-0000-4000-8000-000000000513",
    displayName: "候补小林",
    position: "DEFENDER",
    joinedAt: REMOVED_AT,
    promotedFromWaitlist: true,
    version: 3,
    allowedActions: { canRemove: true, removeBlockedReason: null },
  }];
  let registrations: OpenGameAttendanceRosterItem[] = [
    {
      registrationId: "00000000-0000-4000-8000-000000000411",
      displayName: "天津周末左边锋小王",
      position: "FORWARD",
      attendanceStatus: "UNMARKED",
      attendanceRecordedAt: null,
      attendanceCorrectedAt: null,
      version: 2,
    },
    {
      registrationId: "00000000-0000-4000-8000-000000000412",
      displayName: "海河路中场阿杰",
      position: "MIDFIELDER",
      attendanceStatus: "PRESENT",
      attendanceRecordedAt: "2026-08-30T20:32:00+08:00",
      attendanceCorrectedAt: "2026-08-31T14:18:00+08:00",
      version: 3,
    },
    {
      registrationId: "00000000-0000-4000-8000-000000000413",
      displayName: "奥体后卫小林",
      position: "DEFENDER",
      attendanceStatus: "NO_SHOW",
      attendanceRecordedAt: "2026-08-30T20:34:00+08:00",
      attendanceCorrectedAt: null,
      version: 4,
    },
  ];
  const removals = new Map<string, OpenGameMemberRemovalResult>();
  const attendanceMarks = new Map<string, OpenGameAttendanceMarkResult>();

  const readMembers = (): OpenGameMemberRoster => ({
    game: {
      id: NIGHT_GLOW_CAPTAIN_PREVIEW_IDS.membersGameId,
      name: "开发预览 · 海河周六轻松局",
      venueName: "天津河东体育中心",
      pitchName: "笼式五人制 2 号场",
      startsAt: "2026-09-05T09:00:00+08:00",
      endsAt: "2026-09-05T10:30:00+08:00",
      timeZone: "Asia/Shanghai",
      state: "PUBLISHED",
    },
    joinedCount: members.length,
    remainingSpots: 2 - members.length,
    waitlistCount: waitingMembers.length,
    members: members.map((member) => ({
      ...member, allowedActions: { ...member.allowedActions },
    })),
  });

  const readAttendance = (): OpenGameAttendanceRoster => ({
    game: {
      id: NIGHT_GLOW_CAPTAIN_PREVIEW_IDS.attendanceGameId,
      name: "开发预览 · 奥体周日傍晚局",
      venueName: "天津奥体足球场",
      pitchName: "七人制 A 场",
      startsAt: "2026-08-30T18:30:00+08:00",
      endsAt: "2026-08-30T20:30:00+08:00",
      timeZone: "Asia/Shanghai",
      state: "COMPLETED",
    },
    recordedCount: registrations.filter((item) => item.attendanceStatus !== "UNMARKED").length,
    totalCount: registrations.length,
    attendanceComplete: registrations.every((item) => item.attendanceStatus !== "UNMARKED"),
    registrations: registrations.map((item) => ({ ...item })),
  });

  return {
    ...source,
    async getMembers(gameId) {
      if (gameId !== NIGHT_GLOW_CAPTAIN_PREVIEW_IDS.membersGameId) {
        throw new OpenGameRegistrationApiError("OPEN_GAME_NOT_FOUND");
      }
      return readMembers();
    },
    async removeMember(attempt) {
      if (attempt.gameId !== NIGHT_GLOW_CAPTAIN_PREVIEW_IDS.membersGameId) {
        throw new OpenGameRegistrationApiError("OPEN_GAME_NOT_FOUND");
      }
      const previous = removals.get(attempt.idempotencyKey);
      if (previous) return previous;
      const member = members.find((item) => item.registrationId === attempt.registrationId);
      if (!member?.allowedActions.canRemove || member.version !== attempt.expectedVersion) {
        throw new OpenGameRegistrationApiError("APPLICATION_STATE_CHANGED");
      }
      members = members.filter((item) => item.registrationId !== attempt.registrationId);
      const promoted = waitingMembers.shift();
      if (promoted) members.push(promoted);
      const roster = readMembers();
      const result: OpenGameMemberRemovalResult = {
        removedRegistrationId: member.registrationId,
        removedDisplayName: member.displayName,
        status: "REMOVED",
        version: member.version + 1,
        removedAt: REMOVED_AT,
        joinedCount: roster.joinedCount,
        remainingSpots: roster.remainingSpots,
        waitlistCount: roster.waitlistCount,
        promotedMember: promoted ? {
          registrationId: promoted.registrationId,
          displayName: promoted.displayName,
          position: promoted.position,
          version: promoted.version,
        } : null,
      };
      removals.set(attempt.idempotencyKey, result);
      return result;
    },
    async getAttendanceRoster(gameId) {
      if (gameId !== NIGHT_GLOW_CAPTAIN_PREVIEW_IDS.attendanceGameId) {
        throw new OpenGameRegistrationApiError("OPEN_GAME_NOT_FOUND");
      }
      return readAttendance();
    },
    async markAttendance(attempt) {
      if (attempt.gameId !== NIGHT_GLOW_CAPTAIN_PREVIEW_IDS.attendanceGameId) {
        throw new OpenGameRegistrationApiError("OPEN_GAME_NOT_FOUND");
      }
      const previous = attendanceMarks.get(attempt.idempotencyKey);
      if (previous) return previous;
      const member = registrations.find((item) => item.registrationId === attempt.registrationId);
      if (member?.attendanceStatus !== "UNMARKED" || member.version !== attempt.expectedVersion) {
        throw new OpenGameRegistrationApiError("ATTENDANCE_STATE_CHANGED");
      }
      registrations = registrations.map((item) => item.registrationId === member.registrationId ? {
        ...item,
        attendanceStatus: attempt.attendanceStatus,
        attendanceRecordedAt: ATTENDANCE_RECORDED_AT,
        version: item.version + 1,
      } : item);
      const roster = readAttendance();
      const result: OpenGameAttendanceMarkResult = {
        registrationId: member.registrationId,
        attendanceStatus: attempt.attendanceStatus,
        attendanceRecordedAt: ATTENDANCE_RECORDED_AT,
        version: member.version + 1,
        recordedCount: roster.recordedCount,
        totalCount: roster.totalCount,
        attendanceComplete: roster.attendanceComplete,
      };
      attendanceMarks.set(attempt.idempotencyKey, result);
      return result;
    },
  };
}

export function createNightGlowReportSource(): OpenGameReportSource {
  let report: OpenGameReportForReporter | null = null;
  let submittedKey: string | null = null;
  return {
    async login() { return NIGHT_GLOW_CAPTAIN_PREVIEW_IDS.userId; },
    currentUserId() { return NIGHT_GLOW_CAPTAIN_PREVIEW_IDS.userId; },
    async getMyReport(gameId) {
      if (gameId !== NIGHT_GLOW_CAPTAIN_PREVIEW_IDS.reportGameId) {
        throw new OpenGameReportApiError("REPORT_CONTEXT_NOT_FOUND");
      }
      return {
        target: {
          gameId,
          gameName: "开发预览 · 海河周日轻松局",
          organizerTeamName: "开发预览 · 津门晨风队",
          venueName: "天津河东体育中心",
          pitchName: "七人制 A 场",
          startsAt: "2026-08-30T18:30:00+08:00",
          endsAt: "2026-08-30T20:30:00+08:00",
          timeZone: "Asia/Shanghai",
        },
        reportDeadline: "2026-09-06T20:30:00+08:00",
        submissionAllowed: report === null,
        submissionBlocker: report === null ? null : "REPORT_ALREADY_EXISTS",
        report: report === null ? null : { ...report },
      };
    },
    async submit(attempt) {
      if (attempt.gameId !== NIGHT_GLOW_CAPTAIN_PREVIEW_IDS.reportGameId) {
        throw new OpenGameReportApiError("REPORT_CONTEXT_NOT_FOUND");
      }
      if (report !== null) {
        if (submittedKey === attempt.idempotencyKey) return { ...report };
        throw new OpenGameReportApiError("REPORT_ALREADY_EXISTS");
      }
      report = {
        reportId: "51000000-0000-4000-8000-000000000011",
        ...attempt.body,
        submittedAt: "2026-08-31T09:00:00+08:00",
        status: "PENDING",
        outcome: null,
        resolvedAt: null,
        resultTitle: null,
        resultMessage: null,
      };
      submittedKey = attempt.idempotencyKey;
      return { ...report };
    },
  };
}
