import type { OpenGameDraftInput, OpenGameEntry, OpenGameOwner, OpenGamePublic } from "../domain/open-game";

export type OpenGameMutationAttempt =
  | { readonly kind: "create"; readonly orderId: string; readonly body: OpenGameDraftInput; readonly idempotencyKey: string }
  | { readonly kind: "update"; readonly gameId: string; readonly body: OpenGameDraftInput & { readonly expectedVersion: number }; readonly idempotencyKey: string }
  | { readonly kind: "publish" | "cancel"; readonly gameId: string; readonly expectedVersion: number; readonly idempotencyKey: string };

export type OpenGameCreateAttempt = Extract<OpenGameMutationAttempt, { readonly kind: "create" }>;
export type OpenGameUpdateAttempt = Extract<OpenGameMutationAttempt, { readonly kind: "update" }>;
type OpenGameVersionAttempt = Extract<OpenGameMutationAttempt, { readonly kind: "publish" | "cancel" }>;
export type OpenGamePublishAttempt = Omit<OpenGameVersionAttempt, "kind"> & { readonly kind: "publish" };
export type OpenGameCancelAttempt = Omit<OpenGameVersionAttempt, "kind"> & { readonly kind: "cancel" };

export type OpenGameMutationAttemptResolution =
  | { readonly kind: "READY"; readonly attempt: OpenGameMutationAttempt }
  | { readonly kind: "FOREIGN_PENDING"; readonly attempt: OpenGameMutationAttempt };

export interface OpenGameMutationAttemptStore {
  load(): OpenGameMutationAttempt | null;
  begin(attempt: OpenGameMutationAttempt): OpenGameMutationAttemptResolution;
  clear(): void;
}

export interface OpenGameSource {
  login(): Promise<void>;
  getEntry(orderId: string): Promise<OpenGameEntry>;
  getOwnedGame(gameId: string): Promise<OpenGameOwner>;
  getSharedGame(shareToken: string): Promise<OpenGamePublic>;
  create(attempt: OpenGameCreateAttempt): Promise<OpenGameOwner>;
  update(attempt: OpenGameUpdateAttempt): Promise<OpenGameOwner>;
  publish(attempt: OpenGamePublishAttempt): Promise<OpenGameOwner>;
  cancel(attempt: OpenGameCancelAttempt): Promise<OpenGameOwner>;
}

export type OpenGameUnknownRecoveryDecision =
  | { readonly kind: "NAVIGATE"; readonly gameId: string; readonly clearAttempt: true }
  | { readonly kind: "ACCEPT"; readonly owner: OpenGameOwner; readonly clearAttempt: true }
  | { readonly kind: "REPLAY"; readonly attempt: OpenGameMutationAttempt; readonly clearAttempt: false }
  | { readonly kind: "CLAMP"; readonly authority: OpenGameEntry | OpenGameOwner; readonly clearAttempt: true };

export type OpenGameDefinitiveRecoveryCode =
  | "OPEN_GAME_ALREADY_EXISTS"
  | "ORDER_NOT_ELIGIBLE"
  | "OPEN_GAME_STATE_CHANGED"
  | "IDEMPOTENCY_KEY_REUSED"
  | "INVALID_ARGUMENT"
  | "ORDER_NOT_FOUND"
  | "OPEN_GAME_NOT_FOUND"
  | "AUTH_REQUIRED";

export type OpenGameDefinitiveRecoveryDecision =
  | { readonly kind: "REFRESH_ENTRY" | "REFRESH_OWNER"; readonly clearAttempt: false }
  | { readonly kind: "NAVIGATE"; readonly gameId: string; readonly clearAttempt: true }
  | { readonly kind: "CLAMP"; readonly authority: OpenGameEntry | OpenGameOwner; readonly clearAttempt: true }
  | { readonly kind: "CONFLICT" | "CORRECT" | "NOT_FOUND" | "LOGIN"; readonly clearAttempt: true };

const CANONICAL_POSITIONS = ["GOALKEEPER", "DEFENDER", "MIDFIELDER", "FORWARD"] as const;

function samePositions(requested: OpenGameDraftInput["positions"], authoritative: OpenGameOwner["positions"]): boolean {
  const canonical = requested[0] === "ANY"
    ? ["ANY"]
    : CANONICAL_POSITIONS.filter((position) => requested.includes(position));
  return canonical.length === authoritative.length
    && canonical.every((position, index) => position === authoritative[index]);
}

function ownerMatchesRequestedBody(owner: OpenGameOwner, body: OpenGameDraftInput): boolean {
  return owner.name === body.name
    && owner.team.name === body.teamName
    && owner.totalPlayers === body.totalPlayers
    && owner.fixedPlayers === body.fixedPlayers
    && owner.openSpots === body.openSpots
    && owner.intensity === body.intensity
    && owner.minimumExperience === body.minimumExperience
    && samePositions(body.positions, owner.positions)
    && owner.aaCents === body.aaCents
    && owner.registrationDeadline === body.registrationDeadline
    && owner.equipmentAndArrivalNotes === body.equipmentAndArrivalNotes
    && owner.visibility === body.visibility;
}

function isEntry(authority: OpenGameEntry | OpenGameOwner): authority is OpenGameEntry {
  return "entry" in authority;
}

export function classifyOpenGameUnknownRecovery(
  attempt: OpenGameMutationAttempt,
  authority: OpenGameEntry | OpenGameOwner,
): OpenGameUnknownRecoveryDecision {
  if (attempt.kind === "create") {
    if (isEntry(authority) && authority.entry === "MANAGE") {
      return { kind: "NAVIGATE", gameId: authority.gameId, clearAttempt: true };
    }
    if (isEntry(authority) && authority.entry === "CREATE") {
      return { kind: "REPLAY", attempt, clearAttempt: false };
    }
    return { kind: "CLAMP", authority, clearAttempt: true };
  }
  if (isEntry(authority) || authority.id !== attempt.gameId) {
    return { kind: "CLAMP", authority, clearAttempt: true };
  }
  if (attempt.kind === "update") {
    if (authority.version === attempt.body.expectedVersion + 1
      && ownerMatchesRequestedBody(authority, attempt.body)) {
      return { kind: "ACCEPT", owner: authority, clearAttempt: true };
    }
    if (authority.version === attempt.body.expectedVersion) {
      return { kind: "REPLAY", attempt, clearAttempt: false };
    }
    return { kind: "CLAMP", authority, clearAttempt: true };
  }
  if (attempt.kind === "publish") {
    if (authority.state === "PUBLISHED") return { kind: "ACCEPT", owner: authority, clearAttempt: true };
    if (authority.state === "DRAFT" && authority.version === attempt.expectedVersion) {
      return { kind: "REPLAY", attempt, clearAttempt: false };
    }
    return { kind: "CLAMP", authority, clearAttempt: true };
  }
  if (authority.state === "CANCELLED") return { kind: "ACCEPT", owner: authority, clearAttempt: true };
  if (authority.allowedActions.canCancel && authority.version === attempt.expectedVersion) {
    return { kind: "REPLAY", attempt, clearAttempt: false };
  }
  return { kind: "CLAMP", authority, clearAttempt: true };
}

export function classifyOpenGameDefinitiveRecovery(
  attempt: OpenGameMutationAttempt,
  code: OpenGameDefinitiveRecoveryCode,
  authority?: OpenGameEntry | OpenGameOwner,
): OpenGameDefinitiveRecoveryDecision {
  if (code === "OPEN_GAME_ALREADY_EXISTS") {
    if (authority === undefined) return { kind: "REFRESH_ENTRY", clearAttempt: false };
    if (isEntry(authority) && authority.entry === "MANAGE") {
      return { kind: "NAVIGATE", gameId: authority.gameId, clearAttempt: true };
    }
    return { kind: "CLAMP", authority, clearAttempt: true };
  }
  if (code === "ORDER_NOT_ELIGIBLE") {
    if (authority === undefined) {
      return { kind: attempt.kind === "create" ? "REFRESH_ENTRY" : "REFRESH_OWNER", clearAttempt: false };
    }
    return { kind: "CLAMP", authority, clearAttempt: true };
  }
  if (code === "OPEN_GAME_STATE_CHANGED") {
    if (authority === undefined) return { kind: "REFRESH_OWNER", clearAttempt: false };
    return { kind: "CLAMP", authority, clearAttempt: true };
  }
  if (code === "IDEMPOTENCY_KEY_REUSED") return { kind: "CONFLICT", clearAttempt: true };
  if (code === "INVALID_ARGUMENT") return { kind: "CORRECT", clearAttempt: true };
  if (code === "AUTH_REQUIRED") return { kind: "LOGIN", clearAttempt: true };
  return { kind: "NOT_FOUND", clearAttempt: true };
}

let configured: OpenGameSource | undefined;
export function registerOpenGameSource(source: OpenGameSource): void { configured = source; }
export function getOpenGameSource(): OpenGameSource {
  if (!configured) throw new Error("OPEN_GAME_SOURCE_NOT_CONFIGURED");
  return configured;
}
export function resetOpenGameSourceForTesting(): void { configured = undefined; }

let configuredAttemptStore: OpenGameMutationAttemptStore | undefined;
export function registerOpenGameMutationAttemptStore(store: OpenGameMutationAttemptStore): void { configuredAttemptStore = store; }
export function getOpenGameMutationAttemptStore(): OpenGameMutationAttemptStore {
  if (!configuredAttemptStore) throw new Error("OPEN_GAME_ATTEMPT_STORE_NOT_CONFIGURED");
  return configuredAttemptStore;
}
export function resetOpenGameMutationAttemptStoreForTesting(): void { configuredAttemptStore = undefined; }
