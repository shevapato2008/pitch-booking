import type {
  CaptainOpenGameWaitlistApplication,
  OpenGameApplicationItem,
  OpenGameApplicationPage,
  OpenGamePublicProfile,
  OpenGamePublicRosterMember,
  OpenGameRegistrationContext,
  OpenGameViewerRegistration,
} from "../domain/open-game-registration";
import type { OpenGamePublic } from "../domain/open-game";
import type {
  OpenGameRegistrationDecisionAttempt,
  OpenGameRegistrationSource,
  OpenGameRegistrationWithdrawAttempt,
} from "../services/open-game-registration";
import {
  type C2bWaitlistRegistration,
  type C2bWaitlistScenario,
  type C2bWaitlistSnapshot,
  type C2bWaitlistStore,
  createC2bWaitlistStore,
} from "./c2b-waitlist-fixture";

export const C2B_PRODUCTION_PREVIEW_GAME_ID = "c2b00000-0000-4000-8000-000000000001";
export const C2B_PRODUCTION_PREVIEW_APPLICATION_ID = "c2b00000-0000-4000-8000-000000000002";
export const C2B_PRODUCTION_PREVIEW_USER_ID = "c2b00000-0000-4000-8000-000000000003";
export const C2B_PRODUCTION_PREVIEW_SHARE_TOKEN = "abcdefghijklmnopqrstuvwxyzABCDEF";
export type C2bProductionPreviewScenario = C2bWaitlistScenario | "SIGNUP_FULL";

const OTHER_WAITLIST_ID = "c2b00000-0000-4000-8000-000000000004";
const SECONDARY_REGISTRATION_ID = "c2b00000-0000-4000-8000-000000000005";
const SECONDARY_SHARE_TOKEN = "1234567890_abcdefghijklmnopqrstu";
const WAITLISTED_AT = "2026-08-30T19:30:00+08:00";
const SECONDARY_DECIDED_AT = "2026-08-29T19:30:00+08:00";
const WITHDRAWN_AT = "2026-08-30T20:10:00+08:00";

function publicGame(snapshot: C2bWaitlistSnapshot): OpenGamePublic {
  return {
    name: snapshot.game.gameName,
    teamName: "开发预览 · 模拟数据",
    state: snapshot.game.state,
    stateReason: snapshot.game.state === "SUSPENDED" ? "BOOKING_UNAVAILABLE" : null,
    venueName: snapshot.game.venue,
    pitchName: snapshot.game.pitch,
    pitchSpecification: "7人制",
    startsAt: "2026-09-06T18:00:00+08:00",
    endsAt: "2026-09-06T20:00:00+08:00",
    timeZone: "Asia/Shanghai",
    totalPlayers: snapshot.game.plannedPlayers,
    fixedPlayers: snapshot.game.plannedPlayers - 4,
    openSpots: 4,
    intensity: "CASUAL",
    minimumExperience: null,
    positions: ["ANY"],
    aaCents: 2572,
    registrationDeadline: "2026-09-06T16:00:00+08:00",
    equipmentAndArrivalNotes: "隔离预览，日期与成员均为模拟数据，不代表当前真实球局。",
    visibility: "PUBLIC",
  };
}
function secondaryGame(): OpenGamePublic {
  return {
    name: "海河周六轻松局",
    teamName: "开发预览 · 模拟数据",
    state: "PUBLISHED",
    stateReason: null,
    venueName: "天津河东体育中心",
    pitchName: "笼式五人制 2 号场",
    pitchSpecification: "5人制",
    startsAt: "2026-09-05T09:00:00+08:00",
    endsAt: "2026-09-05T10:30:00+08:00",
    timeZone: "Asia/Shanghai",
    totalPlayers: 10,
    fixedPlayers: 6,
    openSpots: 4,
    intensity: "CASUAL",
    minimumExperience: "会传接球即可",
    positions: ["ANY"],
    aaCents: 3000,
    registrationDeadline: "2026-09-05T07:00:00+08:00",
    equipmentAndArrivalNotes: "提前 15 分钟到场",
    visibility: "PUBLIC",
  };
}

function registrationVersion(
  registration: C2bWaitlistRegistration,
  primaryTerminal: "APPLICATION_WITHDRAWAL" | "GAME_EXIT" | null,
): number {
  if (primaryTerminal === "APPLICATION_WITHDRAWAL") return 2;
  if (primaryTerminal === "GAME_EXIT") return 4;
  if (registration.persistedStatus === "APPLIED") return 1;
  if (registration.persistedStatus === "WAITLISTED" || registration.persistedStatus === "REJECTED") {
    return 2;
  }
  if (registration.persistedStatus === "JOINED") return registration.promotedAt === null ? 2 : 3;
  return registration.withdrawalKind === "WAITLIST_WITHDRAWAL" ? 3 : 2;
}

function viewerRegistration(
  snapshot: C2bWaitlistSnapshot,
  primaryTerminal: "APPLICATION_WITHDRAWAL" | "GAME_EXIT" | null,
): OpenGameViewerRegistration {
  const registration = snapshot.applicant;
  if (primaryTerminal !== null) {
    return {
      id: C2B_PRODUCTION_PREVIEW_APPLICATION_ID,
      version: registrationVersion(registration, primaryTerminal),
      displayName: registration.applicantName,
      position: "ANY",
      note: null,
      persistedStatus: "WITHDRAWN",
      effectiveStatus: "WITHDRAWN",
      appliedAt: registration.appliedAt,
      decidedAt: primaryTerminal === "GAME_EXIT" ? WAITLISTED_AT : null,
      withdrawnAt: WITHDRAWN_AT,
      withdrawalKind: primaryTerminal,
      lateExitRecorded: false,
      availableWithdrawalAction: null,
      lateExitWillBeRecorded: false,
      waitlistPosition: null,
      waitlistedAt: primaryTerminal === "GAME_EXIT" ? WAITLISTED_AT : null,
      promotedAt: primaryTerminal === "GAME_EXIT" ? registration.promotedAt : null,
      attendanceStatus: null,
      attendanceRecordedAt: null,
      attendanceCorrectedAt: null,
      removedAt: null,
    };
  }
  const persisted = registration.persistedStatus;
  return {
    id: C2B_PRODUCTION_PREVIEW_APPLICATION_ID,
    version: registrationVersion(registration, null),
    displayName: registration.applicantName,
    position: "ANY",
    note: null,
    persistedStatus: persisted,
    effectiveStatus: registration.effectiveStatus,
    appliedAt: registration.appliedAt,
    decidedAt: persisted === "APPLIED" ? null : WAITLISTED_AT,
    withdrawnAt: registration.withdrawnAt,
    withdrawalKind: registration.withdrawalKind,
    lateExitRecorded: false,
    availableWithdrawalAction: persisted === "APPLIED"
      ? "WITHDRAW_APPLICATION"
      : persisted === "WAITLISTED"
        ? "WITHDRAW_WAITLIST"
        : persisted === "JOINED"
          ? "LEAVE_GAME"
          : null,
    lateExitWillBeRecorded: false,
    waitlistPosition: registration.waitlistPosition,
    waitlistedAt: registration.waitlistSeq === null ? null : WAITLISTED_AT,
    promotedAt: registration.promotedAt,
    attendanceStatus: null,
    attendanceRecordedAt: null,
    attendanceCorrectedAt: null,
    removedAt: null,
  };
}

function primaryContext(
  store: C2bWaitlistStore,
  primaryTerminal: "APPLICATION_WITHDRAWAL" | "GAME_EXIT" | null,
  profile: OpenGamePublicProfile,
): OpenGameRegistrationContext {
  const snapshot = store.current();
  const registration = { ...viewerRegistration(snapshot, primaryTerminal), displayName: profile.nickname };
  const joinedMembers = ["周岚", "许卓", "何雨"].map((name) => rosterMember(name));
  if (snapshot.exitingMember.persistedStatus === "JOINED") {
    joinedMembers.push(rosterMember(snapshot.exitingMember.applicantName));
  }
  if (registration.persistedStatus === "JOINED") {
    joinedMembers.push(rosterMember(profile.nickname, profile.avatarUrl));
  }
  const waitlistedMembers = snapshot.activeWaitlist.map((member) => ({
    ...rosterMember(
      member.registrationId === snapshot.applicant.registrationId ? profile.nickname : member.applicantName,
      member.registrationId === snapshot.applicant.registrationId ? profile.avatarUrl : null,
    ),
    waitlistPosition: member.waitlistPosition!,
  }));
  return {
    game: publicGame(snapshot),
    remainingSpots: 4 - joinedMembers.length,
    joinedCount: joinedMembers.length,
    waitlistCount: waitlistedMembers.length,
    joinedMembers,
    waitlistedMembers,
    blockedMembers: [],
    managementGameId: null,
    viewerAuthenticated: true,
    viewerRegistration: registration,
    allowedActions: { canApply: false, applyBlockedReason: "ALREADY_APPLIED" },
  };
}

function rosterMember(nickname: string, avatarUrl: string | null = null): OpenGamePublicRosterMember {
  return { nickname, avatarUrl, management: null };
}

function secondaryContext(secondaryExited: boolean, profile: OpenGamePublicProfile): OpenGameRegistrationContext {
  const joinedMembers = ["周岚", "许卓", "何雨"].map((name) => rosterMember(name));
  if (!secondaryExited) joinedMembers.push(rosterMember(profile.nickname, profile.avatarUrl));
  return {
    game: secondaryGame(),
    remainingSpots: 4 - joinedMembers.length,
    joinedCount: joinedMembers.length,
    waitlistCount: 0,
    joinedMembers,
    waitlistedMembers: [],
    blockedMembers: [],
    managementGameId: null,
    viewerAuthenticated: true,
    viewerRegistration: {
      id: SECONDARY_REGISTRATION_ID,
      version: secondaryExited ? 3 : 2,
      displayName: profile.nickname,
      position: "ANY",
      note: null,
      persistedStatus: secondaryExited ? "WITHDRAWN" : "JOINED",
      effectiveStatus: secondaryExited ? "WITHDRAWN" : "JOINED",
      appliedAt: "2026-08-29T19:10:00+08:00",
      decidedAt: SECONDARY_DECIDED_AT,
      withdrawnAt: secondaryExited ? WITHDRAWN_AT : null,
      withdrawalKind: secondaryExited ? "GAME_EXIT" : null,
      lateExitRecorded: false,
      availableWithdrawalAction: secondaryExited ? null : "LEAVE_GAME",
      lateExitWillBeRecorded: false,
      waitlistPosition: null,
      waitlistedAt: null,
      promotedAt: null,
      attendanceStatus: null,
      attendanceRecordedAt: null,
      attendanceCorrectedAt: null,
      removedAt: null,
    },
    allowedActions: { canApply: false, applyBlockedReason: "ALREADY_APPLIED" },
  };
}

function applicationItem(
  context: OpenGameRegistrationContext,
  detailPath: string,
): OpenGameApplicationItem {
  const registration = context.viewerRegistration;
  if (registration === null) throw new Error("C2B_PRODUCTION_PREVIEW_REGISTRATION_REQUIRED");
  return {
    id: registration.id,
    effectiveStatus: registration.effectiveStatus,
    appliedAt: registration.appliedAt,
    waitlistPosition: registration.waitlistPosition,
    waitlistedAt: registration.waitlistedAt,
    promotedAt: registration.promotedAt,
    attendanceStatus: registration.attendanceStatus,
    attendanceRecordedAt: registration.attendanceRecordedAt,
    attendanceCorrectedAt: registration.attendanceCorrectedAt,
    detailPath,
    gameName: context.game.name,
    startsAt: context.game.startsAt,
    endsAt: context.game.endsAt,
    timeZone: context.game.timeZone,
    venueName: context.game.venueName,
    pitchName: context.game.pitchName,
    pitchSpecification: context.game.pitchSpecification,
  };
}

function waitlistItem(
  snapshot: C2bWaitlistSnapshot,
  registration: C2bWaitlistRegistration,
): CaptainOpenGameWaitlistApplication {
  return {
    id: registration.registrationId === snapshot.applicant.registrationId
      ? C2B_PRODUCTION_PREVIEW_APPLICATION_ID
      : OTHER_WAITLIST_ID,
    displayName: registration.applicantName,
    position: "ANY",
    note: null,
    appliedAt: registration.appliedAt,
    waitlistedAt: WAITLISTED_AT,
    waitlistPosition: registration.waitlistPosition ?? 1,
  };
}

function sameDecisionTarget(attempt: OpenGameRegistrationDecisionAttempt): boolean {
  return attempt.originatingUserId === C2B_PRODUCTION_PREVIEW_USER_ID
    && attempt.gameId === C2B_PRODUCTION_PREVIEW_GAME_ID
    && attempt.applicationId === C2B_PRODUCTION_PREVIEW_APPLICATION_ID
    && attempt.expectedVersion === 1;
}

export interface C2bProductionPreviewSource {
  readonly source: OpenGameRegistrationSource;
  reset(scenario: C2bProductionPreviewScenario): void;
}

export function createC2bProductionPreviewSource(
  store: C2bWaitlistStore = createC2bWaitlistStore(),
): C2bProductionPreviewSource {
  let primaryTerminal: "APPLICATION_WITHDRAWAL" | "GAME_EXIT" | null = null;
  let secondaryExited = false;
  let signupOpen = false;
  const initialProfile: OpenGamePublicProfile = {
    nickname: "林晓雨", avatarUrl: null, profileVersion: 1, confirmedAt: WAITLISTED_AT,
  };
  let profile = { ...initialProfile };
  // Development-only: local temporary paths are never uploaded or persisted.
  const avatars = new Map<string, string>();
  const readPrimary = (): OpenGameRegistrationContext => {
    const context = primaryContext(store, primaryTerminal, profile);
    return signupOpen ? {
      ...context,
      viewerRegistration: null,
      allowedActions: { canApply: true, applyBlockedReason: null },
    } : context;
  };

  const source: OpenGameRegistrationSource = {
    async login() { return C2B_PRODUCTION_PREVIEW_USER_ID; },
    currentUserId() { return C2B_PRODUCTION_PREVIEW_USER_ID; },
    async listMine(cursor?: string): Promise<OpenGameApplicationPage> {
      if (cursor !== undefined) return { items: [], nextCursor: null };
      return {
        items: [
          ...(!signupOpen ? [applicationItem(
            readPrimary(),
            `/pages/captain-game-public/index?token=${C2B_PRODUCTION_PREVIEW_SHARE_TOKEN}`,
          )] : []),
          applicationItem(
            secondaryContext(secondaryExited, profile),
            `/pages/captain-game-public/index?token=${SECONDARY_SHARE_TOKEN}`,
          ),
        ],
        nextCursor: null,
      };
    },
    async getContext(shareToken) {
      if (shareToken === C2B_PRODUCTION_PREVIEW_SHARE_TOKEN) {
        return readPrimary();
      }
      if (shareToken === SECONDARY_SHARE_TOKEN) return secondaryContext(secondaryExited, profile);
      throw new Error("C2B_PRODUCTION_PREVIEW_NOT_FOUND");
    },
    async apply() { throw new Error("C2B_PRODUCTION_PREVIEW_APPLY_NOT_AVAILABLE"); },
    async getSignupContext(shareToken) { return source.getContext(shareToken); },
    async getPublicProfile() { return { ...profile }; },
    async uploadPublicProfileAvatar(tempFilePath) {
      if (!tempFilePath) throw new Error("C2B_PRODUCTION_PREVIEW_AVATAR_REQUIRED");
      const objectKey = `c2b-preview-avatar-${avatars.size + 1}`;
      avatars.set(objectKey, tempFilePath);
      return { objectKey };
    },
    async savePublicProfile(input) {
      const nickname = input.nickname.trim();
      if (!nickname || Array.from(nickname).length > 24
        || (input.avatarObjectKey !== null && !avatars.has(input.avatarObjectKey))) {
        throw new Error("C2B_PRODUCTION_PREVIEW_PROFILE_INVALID");
      }
      profile = {
        nickname,
        avatarUrl: input.avatarObjectKey === null ? profile.avatarUrl : avatars.get(input.avatarObjectKey)!,
        profileVersion: profile.profileVersion + 1,
        confirmedAt: WAITLISTED_AT,
      };
      return { ...profile };
    },
    async createRegistration(attempt) {
      if (!signupOpen || attempt.originatingUserId !== C2B_PRODUCTION_PREVIEW_USER_ID
        || attempt.shareToken !== C2B_PRODUCTION_PREVIEW_SHARE_TOKEN
        || attempt.submissionMode !== "DIRECT_REGISTRATION"
        || !attempt.body.adultConfirmed || !attempt.body.riskConfirmed
        || attempt.body.displayName !== profile.nickname) {
        throw new Error("C2B_PRODUCTION_PREVIEW_SIGNUP_NOT_AVAILABLE");
      }
      store.openCaptainDecision("WAITLIST");
      store.confirmCaptainDecision();
      signupOpen = false;
      return readPrimary();
    },
    async getPending(gameId) {
      if (gameId !== C2B_PRODUCTION_PREVIEW_GAME_ID) {
        throw new Error("C2B_PRODUCTION_PREVIEW_NOT_FOUND");
      }
      const snapshot = store.current();
      const pending = !signupOpen && snapshot.applicant.persistedStatus === "APPLIED";
      return {
        remainingSpots: snapshot.game.remainingSpots,
        pendingCount: pending ? 1 : 0,
        applications: pending ? [{
          id: C2B_PRODUCTION_PREVIEW_APPLICATION_ID,
          displayName: profile.nickname,
          position: "ANY",
          note: null,
          appliedAt: snapshot.applicant.appliedAt,
          version: 1,
          allowedActions: {
            canAccept: false,
            acceptBlockedReason: "GAME_FULL",
            canWaitlist: snapshot.canWaitlist,
            waitlistBlockedReason: snapshot.canWaitlist ? null : "APPLICATION_NOT_PENDING",
            canReject: snapshot.canReject,
            rejectBlockedReason: snapshot.canReject ? null : "APPLICATION_NOT_PENDING",
          },
        }] : [],
        waitlistCount: snapshot.activeWaitlist.length,
        waitlist: snapshot.activeWaitlist.map((registration) => ({
          ...waitlistItem(snapshot, registration),
          displayName: registration.registrationId === snapshot.applicant.registrationId
            ? profile.nickname : registration.applicantName,
        })),
      };
    },
    async decide(attempt) {
      if (!sameDecisionTarget(attempt) || (attempt.decision !== "WAITLIST" && attempt.decision !== "REJECT")) {
        throw new Error("C2B_PRODUCTION_PREVIEW_DECISION_NOT_AVAILABLE");
      }
      store.openCaptainDecision(attempt.decision);
      const snapshot = store.confirmCaptainDecision();
      return {
        applicationId: C2B_PRODUCTION_PREVIEW_APPLICATION_ID,
        status: snapshot.applicant.persistedStatus === "WAITLISTED" ? "WAITLISTED" : "REJECTED",
        version: 2,
        decidedAt: WAITLISTED_AT,
        remainingSpots: snapshot.game.remainingSpots,
        allowedActions: {
          canAccept: false,
          acceptBlockedReason: "APPLICATION_NOT_PENDING",
          canWaitlist: false,
          waitlistBlockedReason: "APPLICATION_NOT_PENDING",
          canReject: false,
          rejectBlockedReason: "APPLICATION_NOT_PENDING",
        },
      };
    },
    async withdraw(attempt: OpenGameRegistrationWithdrawAttempt) {
      if (attempt.originatingUserId !== C2B_PRODUCTION_PREVIEW_USER_ID) {
        throw new Error("C2B_PRODUCTION_PREVIEW_WITHDRAW_NOT_AVAILABLE");
      }
      if (attempt.shareToken === SECONDARY_SHARE_TOKEN
        && attempt.applicationId === SECONDARY_REGISTRATION_ID
        && attempt.action === "LEAVE_GAME"
        && attempt.expectedVersion === 2) {
        secondaryExited = true;
        return secondaryContext(true, profile);
      }
      if (attempt.shareToken !== C2B_PRODUCTION_PREVIEW_SHARE_TOKEN
        || attempt.applicationId !== C2B_PRODUCTION_PREVIEW_APPLICATION_ID) {
        throw new Error("C2B_PRODUCTION_PREVIEW_WITHDRAW_NOT_AVAILABLE");
      }
      const current = readPrimary().viewerRegistration;
      if (current === null || current.version !== attempt.expectedVersion
        || current.availableWithdrawalAction !== attempt.action) {
        throw new Error("C2B_PRODUCTION_PREVIEW_WITHDRAW_NOT_AVAILABLE");
      }
      if (attempt.action === "WITHDRAW_WAITLIST") {
        store.openWaitlistWithdrawal(store.current().applicant.registrationId);
        store.confirmWaitlistWithdrawal();
      } else if (attempt.action === "WITHDRAW_APPLICATION") {
        primaryTerminal = "APPLICATION_WITHDRAWAL";
      } else {
        primaryTerminal = "GAME_EXIT";
      }
      return readPrimary();
    },
    async getAttendanceRoster() {
      throw new Error("C2B_PRODUCTION_PREVIEW_ATTENDANCE_NOT_AVAILABLE");
    },
    async markAttendance() {
      throw new Error("C2B_PRODUCTION_PREVIEW_ATTENDANCE_NOT_AVAILABLE");
    },
    async getMembers() {
      throw new Error("C2B_PRODUCTION_PREVIEW_MEMBERS_NOT_AVAILABLE");
    },
    async removeMember() {
      throw new Error("C2B_PRODUCTION_PREVIEW_MEMBER_REMOVAL_NOT_AVAILABLE");
    },
  };

  return {
    source,
    reset(scenario) {
      store.reset(scenario === "SIGNUP_FULL" ? "FULL_REVIEW" : scenario);
      primaryTerminal = null;
      secondaryExited = false;
      signupOpen = scenario === "SIGNUP_FULL";
      profile = { ...initialProfile };
      avatars.clear();
    },
  };
}
