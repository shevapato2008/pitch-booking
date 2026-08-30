import type { OpenGamePosition, OpenGamePublic } from "./open-game";

export const OPEN_GAME_REGISTRATION_EFFECTIVE_STATUSES = [
  "APPLIED",
  "WAITLISTED",
  "JOINED",
  "REJECTED",
  "WITHDRAWN",
  "CANCELLED",
] as const;

export type OpenGameRegistrationEffectiveStatus =
  typeof OPEN_GAME_REGISTRATION_EFFECTIVE_STATUSES[number];

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
  readonly persistedStatus: "APPLIED" | "WAITLISTED" | "JOINED" | "REJECTED" | "WITHDRAWN";
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
}

export interface OpenGameApplicationItem {
  readonly id: string;
  readonly effectiveStatus: OpenGameRegistrationEffectiveStatus;
  readonly appliedAt: string;
  readonly waitlistPosition: number | null;
  readonly waitlistedAt: string | null;
  readonly promotedAt: string | null;
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

export interface OpenGameRegistrationContext {
  readonly game: OpenGamePublic;
  readonly remainingSpots: number;
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
