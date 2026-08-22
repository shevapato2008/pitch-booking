export const OPEN_GAME_PERSISTED_STATUSES = ["DRAFT", "PUBLISHED", "CANCELLED"] as const;
export type OpenGamePersistedStatus = typeof OPEN_GAME_PERSISTED_STATUSES[number];

export const OPEN_GAME_STATES = ["DRAFT", "PUBLISHED", "SUSPENDED", "CANCELLED", "COMPLETED"] as const;
export type OpenGameState = typeof OPEN_GAME_STATES[number];

export const OPEN_GAME_STATE_REASONS = [
  "REGISTRATION_WINDOW_CLOSED",
  "REGISTRATION_DEADLINE_PASSED",
  "CAPTAIN_CANCELLED",
  "ORDER_CANCELLATION_PENDING",
  "ORDER_PAYMENT_EXCEPTION",
  "ORDER_REFUND_PENDING",
  "ORDER_REFUND_FAILED",
  "ORDER_CANCELLED",
  "ORDER_REFUNDED",
  "ORDER_COMPLETED",
] as const;
export type OpenGameStateReason = typeof OPEN_GAME_STATE_REASONS[number];

export const OPEN_GAME_PUBLIC_STATE_REASONS = [
  "REGISTRATION_WINDOW_CLOSED",
  "REGISTRATION_DEADLINE_PASSED",
  "CAPTAIN_CANCELLED",
  "BOOKING_UNAVAILABLE",
  "BOOKING_COMPLETED",
] as const;
export type OpenGamePublicStateReason = typeof OPEN_GAME_PUBLIC_STATE_REASONS[number];

export const OPEN_GAME_INTENSITIES = ["BEGINNER_FRIENDLY", "CASUAL", "COMPETITIVE"] as const;
export type OpenGameIntensity = typeof OPEN_GAME_INTENSITIES[number];

export const OPEN_GAME_VISIBILITIES = ["PUBLIC", "LINK_ONLY"] as const;
export type OpenGameVisibility = typeof OPEN_GAME_VISIBILITIES[number];

export const OPEN_GAME_POSITIONS = ["GOALKEEPER", "DEFENDER", "MIDFIELDER", "FORWARD", "ANY"] as const;
export type OpenGamePosition = typeof OPEN_GAME_POSITIONS[number];

export interface OpenGameDraftInput {
  readonly name: string;
  readonly teamName: string;
  readonly totalPlayers: number;
  readonly fixedPlayers: number;
  readonly openSpots: number;
  readonly intensity: OpenGameIntensity;
  readonly minimumExperience: string | null;
  readonly positions: readonly OpenGamePosition[];
  readonly aaCents: number;
  readonly registrationDeadline: string;
  readonly equipmentAndArrivalNotes: string | null;
  readonly visibility: OpenGameVisibility;
}

export interface OpenGameOrderSummary {
  readonly venueName: string;
  readonly pitchName: string;
  readonly pitchSpecification: string;
  readonly playersPerSide: number;
  readonly bookingPriceCents: number;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly timeZone: string;
}

export type OpenGameEntry =
  | { readonly entry: "CREATE"; readonly order: OpenGameOrderSummary; readonly gameId: null; readonly blockedReason: null }
  | { readonly entry: "MANAGE"; readonly order: null; readonly gameId: string; readonly blockedReason: null }
  | { readonly entry: "NONE"; readonly order: null; readonly gameId: null; readonly blockedReason: "ORDER_NOT_ELIGIBLE" };

export interface OpenGameTeam {
  readonly id: string;
  readonly name: string;
}

export interface OpenGameAllowedActions {
  readonly canEdit: boolean;
  readonly canPublish: boolean;
  readonly canShare: boolean;
  readonly canCancel: boolean;
  readonly canPreview: boolean;
}

export interface OpenGameShare {
  readonly title: string;
  readonly path: string;
  readonly imageUrl: string | null;
}

export interface OpenGamePublic {
  readonly name: string;
  readonly teamName: string;
  readonly state: OpenGameState;
  readonly stateReason: OpenGamePublicStateReason | null;
  readonly venueName: string;
  readonly pitchName: string;
  readonly pitchSpecification: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly timeZone: string;
  readonly totalPlayers: number;
  readonly fixedPlayers: number;
  readonly openSpots: number;
  readonly intensity: OpenGameIntensity;
  readonly minimumExperience: string | null;
  readonly positions: readonly OpenGamePosition[];
  readonly aaCents: number;
  readonly registrationDeadline: string;
  readonly equipmentAndArrivalNotes: string | null;
  readonly visibility: OpenGameVisibility;
}

export interface OpenGameOwner {
  readonly id: string;
  readonly orderId: string;
  readonly order: OpenGameOrderSummary;
  readonly name: string;
  readonly team: OpenGameTeam;
  readonly totalPlayers: number;
  readonly fixedPlayers: number;
  readonly openSpots: number;
  readonly intensity: OpenGameIntensity;
  readonly minimumExperience: string | null;
  readonly positions: readonly OpenGamePosition[];
  readonly aaCents: number;
  readonly registrationDeadline: string;
  readonly equipmentAndArrivalNotes: string | null;
  readonly visibility: OpenGameVisibility;
  readonly persistedStatus: OpenGamePersistedStatus;
  readonly state: OpenGameState;
  readonly stateReason: OpenGameStateReason | null;
  readonly version: number;
  readonly allowedActions: OpenGameAllowedActions;
  readonly share: OpenGameShare | null;
  readonly publicView: OpenGamePublic;
}
