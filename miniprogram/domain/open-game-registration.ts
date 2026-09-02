import type { OpenGamePosition, OpenGamePublic, OpenGameState } from "./open-game";

export const OPEN_GAME_REGISTRATION_EFFECTIVE_STATUSES = [
  "APPLIED",
  "WAITLISTED",
  "JOINED",
  "REJECTED",
  "WITHDRAWN",
  "REMOVED",
  "CANCELLED",
] as const;

export type OpenGameRegistrationEffectiveStatus =
  typeof OPEN_GAME_REGISTRATION_EFFECTIVE_STATUSES[number];

export const OPEN_GAME_ATTENDANCE_STATUSES = [
  "UNMARKED",
  "PRESENT",
  "NO_SHOW",
] as const;

export type OpenGameAttendanceStatus = typeof OPEN_GAME_ATTENDANCE_STATUSES[number];
export type OpenGameAttendanceMarkStatus = Exclude<OpenGameAttendanceStatus, "UNMARKED">;

export interface OpenGameApplicationDraft {
  readonly displayName: string;
  readonly position: OpenGamePosition | null;
  readonly note: string;
  readonly adultConfirmed: boolean;
  readonly riskConfirmed: boolean;
}

export type OpenGameApplicationDraftValidation =
  | {
    readonly valid: true;
    readonly errors: Readonly<Record<keyof OpenGameApplicationDraft, string | null>>;
    readonly submission: OpenGameApplicationSubmission;
  }
  | {
    readonly valid: false;
    readonly errors: Readonly<Record<keyof OpenGameApplicationDraft, string | null>>;
    readonly submission?: never;
  };

export interface OpenGameApplicationSubmission {
  readonly displayName: string;
  readonly position: OpenGamePosition;
  readonly note: string | null;
  readonly adultConfirmed: true;
  readonly riskConfirmed: true;
}

export type OpenGameApplyBlockedReason =
  | "AUTH_REQUIRED"
  | "OWNER_CANNOT_APPLY"
  | "ALREADY_APPLIED"
  | "REMOVED_BY_CAPTAIN"
  | "GAME_NOT_PUBLISHED"
  | "REGISTRATION_DEADLINE_PASSED"
  | "GAME_SUSPENDED"
  | "GAME_CANCELLED"
  | "GAME_COMPLETED"
  | "GAME_STARTED";

export type OpenGameReviewBlockedReason =
  | "APPLICATION_NOT_PENDING"
  | "GAME_SUSPENDED"
  | "GAME_CANCELLED"
  | "GAME_COMPLETED"
  | "GAME_STARTED"
  | "GAME_FULL";

export type OpenGameWaitlistBlockedReason =
  | "APPLICATION_NOT_PENDING"
  | "GAME_SUSPENDED"
  | "GAME_CANCELLED"
  | "GAME_COMPLETED"
  | "GAME_STARTED"
  | "GAME_NOT_FULL"
  | "WAITLIST_NOT_ENABLED";

export interface OpenGameApplyActions {
  readonly canApply: boolean;
  readonly applyBlockedReason: OpenGameApplyBlockedReason | null;
}

export interface OpenGameReviewActions {
  readonly canAccept: boolean;
  readonly acceptBlockedReason: OpenGameReviewBlockedReason | null;
  readonly canWaitlist: boolean;
  readonly waitlistBlockedReason: OpenGameWaitlistBlockedReason | null;
  readonly canReject: boolean;
  readonly rejectBlockedReason: OpenGameReviewBlockedReason | null;
}

export type OpenGameRegistrationWithdrawalAction =
  | "WITHDRAW_APPLICATION"
  | "WITHDRAW_WAITLIST"
  | "LEAVE_GAME";

export type OpenGameRegistrationAvailableWithdrawalAction =
  | "WITHDRAW_APPLICATION"
  | "WITHDRAW_WAITLIST"
  | "LEAVE_GAME";

export type OpenGameRegistrationWithdrawalKind =
  | "APPLICATION_WITHDRAWAL"
  | "WAITLIST_WITHDRAWAL"
  | "GAME_EXIT";

export interface OpenGameViewerRegistration {
  readonly id: string;
  readonly version: number;
  readonly displayName: string;
  readonly position: OpenGamePosition;
  readonly note: string | null;
  readonly persistedStatus:
    | "APPLIED"
    | "WAITLISTED"
    | "JOINED"
    | "REJECTED"
    | "WITHDRAWN"
    | "REMOVED";
  readonly effectiveStatus: OpenGameRegistrationEffectiveStatus;
  readonly appliedAt: string;
  readonly decidedAt: string | null;
  readonly withdrawnAt: string | null;
  readonly withdrawalKind: OpenGameRegistrationWithdrawalKind | null;
  readonly lateExitRecorded: boolean;
  readonly availableWithdrawalAction: OpenGameRegistrationAvailableWithdrawalAction | null;
  readonly lateExitWillBeRecorded: boolean;
  readonly waitlistPosition: number | null;
  readonly waitlistedAt: string | null;
  readonly promotedAt: string | null;
  readonly attendanceStatus: OpenGameAttendanceStatus | null;
  readonly attendanceRecordedAt: string | null;
  readonly attendanceCorrectedAt: string | null;
  readonly removedAt: string | null;
}

export interface OpenGameApplicationItem {
  readonly id: string;
  readonly effectiveStatus: OpenGameRegistrationEffectiveStatus;
  readonly appliedAt: string;
  readonly waitlistPosition: number | null;
  readonly waitlistedAt: string | null;
  readonly promotedAt: string | null;
  readonly attendanceStatus: OpenGameAttendanceStatus | null;
  readonly attendanceRecordedAt: string | null;
  readonly attendanceCorrectedAt: string | null;
  readonly detailPath: string;
  readonly gameName: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly timeZone: string;
  readonly venueName: string;
  readonly pitchName: string;
  readonly pitchSpecification: string;
}

export interface OpenGameApplicationPage {
  readonly items: readonly OpenGameApplicationItem[];
  readonly nextCursor: string | null;
}

export interface OpenGameAttendanceGameSummary {
  readonly id: string;
  readonly name: string;
  readonly venueName: string;
  readonly pitchName: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly timeZone: string;
  readonly state: "COMPLETED";
}

export interface OpenGameAttendanceRosterItem {
  readonly registrationId: string;
  readonly displayName: string;
  readonly position: OpenGamePosition;
  readonly attendanceStatus: OpenGameAttendanceStatus;
  readonly attendanceRecordedAt: string | null;
  readonly attendanceCorrectedAt: string | null;
  readonly version: number;
}

export interface OpenGameAttendanceRoster {
  readonly game: OpenGameAttendanceGameSummary;
  readonly recordedCount: number;
  readonly totalCount: number;
  readonly attendanceComplete: boolean;
  readonly registrations: readonly OpenGameAttendanceRosterItem[];
}

export interface OpenGameAttendanceMarkResult {
  readonly registrationId: string;
  readonly attendanceStatus: OpenGameAttendanceMarkStatus;
  readonly attendanceRecordedAt: string;
  readonly version: number;
  readonly recordedCount: number;
  readonly totalCount: number;
  readonly attendanceComplete: boolean;
}

export type OpenGameMemberRemovalBlockedReason =
  | "GAME_NOT_PUBLISHED"
  | "GAME_SUSPENDED"
  | "GAME_CANCELLED"
  | "GAME_COMPLETED"
  | "GAME_STARTED"
  | "ORDER_AUTHORITY_UNHEALTHY"
  | "ATTENDANCE_RECORDED";

export interface OpenGameMemberRemovalActions {
  readonly canRemove: boolean;
  readonly removeBlockedReason: OpenGameMemberRemovalBlockedReason | null;
}

export interface OpenGameMemberGameSummary {
  readonly id: string;
  readonly name: string;
  readonly venueName: string;
  readonly pitchName: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly timeZone: string;
  readonly state: OpenGameState;
}

export interface OpenGameMemberRosterItem {
  readonly registrationId: string;
  readonly displayName: string;
  readonly position: OpenGamePosition;
  readonly joinedAt: string;
  readonly promotedFromWaitlist: boolean;
  readonly version: number;
  readonly allowedActions: OpenGameMemberRemovalActions;
}

export interface OpenGameMemberRoster {
  readonly game: OpenGameMemberGameSummary;
  readonly joinedCount: number;
  readonly remainingSpots: number;
  readonly waitlistCount: number;
  readonly members: readonly OpenGameMemberRosterItem[];
}

export interface OpenGamePromotedMember {
  readonly registrationId: string;
  readonly displayName: string;
  readonly position: OpenGamePosition;
  readonly version: number;
}

export interface OpenGameMemberRemovalResult {
  readonly removedRegistrationId: string;
  readonly removedDisplayName: string;
  readonly status: "REMOVED";
  readonly version: number;
  readonly removedAt: string;
  readonly joinedCount: number;
  readonly remainingSpots: number;
  readonly waitlistCount: number;
  readonly promotedMember: OpenGamePromotedMember | null;
}

export interface OpenGamePublicRosterManagement {
  readonly registrationId: string;
  readonly version: number;
  readonly canRemove: boolean;
  readonly canAllowReapply: boolean;
}

export interface OpenGamePublicRosterMember {
  readonly nickname: string;
  readonly avatarUrl: string | null;
  readonly management: OpenGamePublicRosterManagement | null;
}

export interface OpenGamePublicWaitlistedMember extends OpenGamePublicRosterMember {
  readonly waitlistPosition: number;
}

export interface OpenGameBlockedRosterMember extends OpenGamePublicRosterMember {
  readonly management: OpenGamePublicRosterManagement;
}

export interface OpenGamePublicProfile {
  readonly nickname: string;
  readonly avatarUrl: string | null;
  readonly profileVersion: number;
  readonly confirmedAt: string;
}

export interface OpenGameMemberReapplyResult {
  readonly registrationId: string;
  readonly status: "REMOVED";
  readonly version: number;
  readonly reapplyBlocked: false;
}

export type OpenGameMemberRemovalReasonValidation =
  | { readonly valid: true; readonly reason: string; readonly error: null }
  | { readonly valid: false; readonly reason: null; readonly error: string };

export interface OpenGameRegistrationContext {
  readonly game: OpenGamePublic;
  readonly remainingSpots: number;
  readonly joinedCount?: number;
  readonly waitlistCount?: number;
  readonly joinedMembers?: readonly OpenGamePublicRosterMember[] | null;
  readonly waitlistedMembers?: readonly OpenGamePublicWaitlistedMember[] | null;
  readonly blockedMembers?: readonly OpenGameBlockedRosterMember[] | null;
  readonly managementGameId?: string | null;
  readonly viewerAuthenticated: boolean;
  readonly viewerRegistration: OpenGameViewerRegistration | null;
  readonly allowedActions: OpenGameApplyActions;
}

export interface CaptainOpenGameApplication {
  readonly id: string;
  readonly displayName: string;
  readonly position: OpenGamePosition;
  readonly note: string | null;
  readonly appliedAt: string;
  readonly version: number;
  readonly allowedActions: OpenGameReviewActions;
}

export interface OpenGameApplicationQueue {
  readonly remainingSpots: number;
  readonly pendingCount: number;
  readonly applications: readonly CaptainOpenGameApplication[];
  readonly waitlistCount: number;
  readonly waitlist: readonly CaptainOpenGameWaitlistApplication[];
}

export interface CaptainOpenGameWaitlistApplication {
  readonly id: string;
  readonly displayName: string;
  readonly position: OpenGamePosition;
  readonly note: string | null;
  readonly appliedAt: string;
  readonly waitlistedAt: string;
  readonly waitlistPosition: number;
}

export interface OpenGameApplicationDecisionResult {
  readonly applicationId: string;
  readonly status: "WAITLISTED" | "JOINED" | "REJECTED";
  readonly version: number;
  readonly decidedAt: string | null;
  readonly remainingSpots: number;
  readonly allowedActions: OpenGameReviewActions;
}
