import { decodeWeChatSession } from "../domain/decoders";
import { arrayAt, exactObject, stringAt } from "../domain/decoder-primitives";
import { decodeOpenGameEntry, decodeOpenGameOwner, decodeOpenGamePublic } from "../domain/open-game-decoder";
import type { OpenGameDraftInput, OpenGameOwner } from "../domain/open-game";
import type { StatusTransport, TransportError, WeChatIdentityCapability } from "../runtime/interfaces";
import type { SessionStore } from "./session-store";
import type {
  OpenGameCancelAttempt,
  OpenGameCreateAttempt,
  OpenGamePublishAttempt,
  OpenGameSource,
  OpenGameUpdateAttempt,
} from "./open-game";

export type OpenGameApiErrorCode =
  | "AUTH_REQUIRED"
  | "ORDER_NOT_FOUND"
  | "OPEN_GAME_NOT_FOUND"
  | "ORDER_NOT_ELIGIBLE"
  | "OPEN_GAME_ALREADY_EXISTS"
  | "OPEN_GAME_STATE_CHANGED"
  | "IDEMPOTENCY_KEY_REUSED"
  | "INVALID_ARGUMENT"
  | "SERVICE_UNAVAILABLE"
  | "LOGIN_FAILED"
  | "OPEN_GAME_RESULT_UNKNOWN";

export interface OpenGameFieldError {
  readonly field: string;
  readonly message: string;
}

export class OpenGameApiError extends Error {
  constructor(
    readonly code: OpenGameApiErrorCode,
    readonly fields: readonly OpenGameFieldError[] = [],
  ) {
    super(code);
    this.name = "OpenGameApiError";
  }
}

type Operation = "entry" | "owner" | "shared" | "create" | "update" | "publish" | "cancel";

const DRAFT_FIELDS = [
  "name", "team_name", "total_players", "fixed_players", "open_spots", "intensity",
  "minimum_experience", "positions", "aa_cents", "registration_deadline",
  "equipment_and_arrival_notes", "visibility",
] as const;
const VERSION_FIELDS = ["expected_version"] as const;

const DEFINITIVE_CODES: Readonly<Record<Operation, Readonly<Record<number, readonly OpenGameApiErrorCode[]>>>> = {
  entry: { 404: ["ORDER_NOT_FOUND"], 422: ["INVALID_ARGUMENT"] },
  owner: { 404: ["OPEN_GAME_NOT_FOUND"], 422: ["INVALID_ARGUMENT"] },
  shared: { 404: ["OPEN_GAME_NOT_FOUND"] },
  create: {
    404: ["ORDER_NOT_FOUND"],
    409: ["ORDER_NOT_ELIGIBLE", "OPEN_GAME_ALREADY_EXISTS", "IDEMPOTENCY_KEY_REUSED"],
    422: ["INVALID_ARGUMENT"],
  },
  update: {
    404: ["OPEN_GAME_NOT_FOUND"],
    409: ["ORDER_NOT_ELIGIBLE", "OPEN_GAME_STATE_CHANGED", "IDEMPOTENCY_KEY_REUSED"],
    422: ["INVALID_ARGUMENT"],
  },
  publish: {
    404: ["OPEN_GAME_NOT_FOUND"],
    409: ["ORDER_NOT_ELIGIBLE", "OPEN_GAME_STATE_CHANGED", "IDEMPOTENCY_KEY_REUSED"],
    422: ["INVALID_ARGUMENT"],
  },
  cancel: {
    404: ["OPEN_GAME_NOT_FOUND"],
    409: ["OPEN_GAME_STATE_CHANGED", "IDEMPOTENCY_KEY_REUSED"],
    422: ["INVALID_ARGUMENT"],
  },
};

function allowedFields(operation: Operation): readonly string[] {
  if (operation === "create") return DRAFT_FIELDS;
  if (operation === "update") return [...DRAFT_FIELDS, ...VERSION_FIELDS];
  if (operation === "publish" || operation === "cancel") return VERSION_FIELDS;
  return [];
}

function decodeErrorEnvelope(
  value: unknown,
  statusCode: number,
  operation: Operation,
): { readonly code: string; readonly fields: readonly OpenGameFieldError[] } {
  const envelope = exactObject(value, ["error"], "$.errorEnvelope");
  const error = exactObject(envelope.error, ["code", "message", "request_id", "details"], "$.error");
  const code = stringAt(error.code, "$.error.code");
  stringAt(error.message, "$.error.message");
  stringAt(error.request_id, "$.error.request_id");
  if (statusCode !== 422) {
    exactObject(error.details, [], "$.error.details");
    return { code, fields: [] };
  }
  const details = error.details;
  if (typeof details !== "object" || details === null || Array.isArray(details)) {
    exactObject(details, [], "$.error.details");
  }
  const keys = Object.keys(details as Record<string, unknown>);
  if (keys.length === 0) return { code, fields: [] };
  const withFields = exactObject(details, ["fields"], "$.error.details");
  const fields = arrayAt(withFields.fields, "$.error.details.fields", 1).map((value, index) => {
    const field = exactObject(value, ["field", "message"], `$.error.details.fields[${index}]`);
    const fieldName = stringAt(field.field, `$.error.details.fields[${index}].field`);
    if (!allowedFields(operation).includes(fieldName)) {
      exactObject({ invalid: true }, [], `$.error.details.fields[${index}].field`);
    }
    return {
      field: fieldName,
      message: stringAt(field.message, `$.error.details.fields[${index}].message`),
    };
  });
  return { code, fields };
}

function transportStatus(caught: unknown): number | undefined {
  const candidate = caught as Partial<TransportError>;
  return candidate.code === "HTTP_ERROR" ? candidate.statusCode : undefined;
}

function transportData(caught: unknown): unknown {
  return (caught as { readonly data?: unknown }).data;
}

function classifyFailure(caught: unknown, operation: Operation, write: boolean): OpenGameApiError {
  if (caught instanceof OpenGameApiError) return caught;
  const statusCode = transportStatus(caught);
  if (statusCode === undefined || statusCode >= 500) {
    return new OpenGameApiError(write ? "OPEN_GAME_RESULT_UNKNOWN" : "SERVICE_UNAVAILABLE");
  }
  const allowed = DEFINITIVE_CODES[operation][statusCode];
  if (allowed) {
    try {
      const decoded = decodeErrorEnvelope(transportData(caught), statusCode, operation);
      if (allowed.includes(decoded.code as OpenGameApiErrorCode)) {
        return new OpenGameApiError(decoded.code as OpenGameApiErrorCode, decoded.fields);
      }
    } catch {
      // A malformed or out-of-matrix response cannot be treated as definitive.
    }
  }
  return new OpenGameApiError(write ? "OPEN_GAME_RESULT_UNKNOWN" : "SERVICE_UNAVAILABLE");
}

function draftRequest(body: OpenGameDraftInput): Record<string, unknown> {
  return {
    name: body.name,
    team_name: body.teamName,
    total_players: body.totalPlayers,
    fixed_players: body.fixedPlayers,
    open_spots: body.openSpots,
    intensity: body.intensity,
    minimum_experience: body.minimumExperience,
    positions: [...body.positions],
    aa_cents: body.aaCents,
    registration_deadline: body.registrationDeadline,
    equipment_and_arrival_notes: body.equipmentAndArrivalNotes,
    visibility: body.visibility,
  };
}

export function createHttpOpenGameSource({ transport, identity, sessionStore }: {
  readonly transport: StatusTransport;
  readonly identity: WeChatIdentityCapability;
  readonly sessionStore: SessionStore;
}): OpenGameSource {
  let loginInFlight: Promise<void> | undefined;
  const login = (): Promise<void> => {
    if (loginInFlight) return loginInFlight;
    const request = (async () => {
      try {
        const identityResult = await identity.login();
        if (!identityResult.code) throw new Error("EMPTY_LOGIN_CODE");
        const response = await transport.requestWithStatus<unknown>(
          "POST", "/api/v1/auth/wechat/session", { code: identityResult.code },
        );
        if (response.statusCode !== 200) throw new Error("LOGIN_STATUS");
        const session = decodeWeChatSession(response.data);
        sessionStore.save({ token: session.token, expiresAt: session.expiresAt, userId: session.user.userId });
      } catch {
        throw new OpenGameApiError("LOGIN_FAILED");
      }
    })();
    loginInFlight = request;
    void request.then(
      () => { if (loginInFlight === request) loginInFlight = undefined; },
      () => { if (loginInFlight === request) loginInFlight = undefined; },
    );
    return request;
  };

  const bearer = (): Readonly<Record<string, string>> => {
    const session = sessionStore.load();
    if (!session) throw new OpenGameApiError("AUTH_REQUIRED");
    return { Authorization: `Bearer ${session.token}` };
  };

  const authorized = async <T>(
    operation: Operation,
    write: boolean,
    perform: () => Promise<T>,
  ): Promise<T> => {
    if (!sessionStore.load()) await login();
    let relogged = false;
    while (true) {
      try {
        return await perform();
      } catch (caught) {
        if (transportStatus(caught) === 401) {
          sessionStore.clear();
          if (!relogged) {
            relogged = true;
            await login();
            continue;
          }
          throw new OpenGameApiError("AUTH_REQUIRED");
        }
        throw classifyFailure(caught, operation, write);
      }
    }
  };

  const ownerSuccess = async (
    operation: "create" | "update" | "publish" | "cancel",
    expectedStatus: 200 | 201,
    method: "POST" | "PUT",
    path: string,
    body: Readonly<Record<string, unknown>>,
    idempotencyKey: string,
    matchesAuthority: (owner: OpenGameOwner) => boolean,
  ) => authorized(operation, true, async () => {
    const response = await transport.requestWithStatus<unknown>(
      method,
      path,
      body,
      { ...bearer(), "Idempotency-Key": idempotencyKey },
    );
    if (response.statusCode !== expectedStatus) throw new OpenGameApiError("OPEN_GAME_RESULT_UNKNOWN");
    try {
      const owner = decodeOpenGameOwner(response.data);
      if (!matchesAuthority(owner)) throw new Error("OPEN_GAME_AUTHORITY_MISMATCH");
      return owner;
    } catch {
      throw new OpenGameApiError("OPEN_GAME_RESULT_UNKNOWN");
    }
  });

  return {
    login,
    getEntry: (orderId) => authorized("entry", false, async () => {
      const response = await transport.requestWithStatus<unknown>(
        "GET", `/api/v1/orders/${encodeURIComponent(orderId)}/game`, undefined, bearer(),
      );
      if (response.statusCode !== 200) throw new OpenGameApiError("SERVICE_UNAVAILABLE");
      try {
        return decodeOpenGameEntry(response.data);
      } catch {
        throw new OpenGameApiError("SERVICE_UNAVAILABLE");
      }
    }),
    getOwnedGame: (gameId) => authorized("owner", false, async () => {
      const response = await transport.requestWithStatus<unknown>(
        "GET", `/api/v1/games/${encodeURIComponent(gameId)}`, undefined, bearer(),
      );
      if (response.statusCode !== 200) throw new OpenGameApiError("SERVICE_UNAVAILABLE");
      try {
        const owner = decodeOpenGameOwner(response.data);
        if (owner.id !== gameId) throw new Error("OPEN_GAME_AUTHORITY_MISMATCH");
        return owner;
      } catch {
        throw new OpenGameApiError("SERVICE_UNAVAILABLE");
      }
    }),
    getSharedGame: async (shareToken) => {
      try {
        const response = await transport.requestWithStatus<unknown>(
          "GET", `/api/v1/shared-games/${encodeURIComponent(shareToken)}`, undefined,
        );
        if (response.statusCode !== 200) throw new OpenGameApiError("SERVICE_UNAVAILABLE");
        const publicGame = decodeOpenGamePublic(response.data);
        if (publicGame.state === "DRAFT") throw new OpenGameApiError("SERVICE_UNAVAILABLE");
        return publicGame;
      } catch (caught) {
        throw classifyFailure(caught, "shared", false);
      }
    },
    create: (attempt: OpenGameCreateAttempt) => ownerSuccess(
      "create",
      201,
      "POST",
      `/api/v1/orders/${encodeURIComponent(attempt.orderId)}/game`,
      draftRequest(attempt.body),
      attempt.idempotencyKey,
      (owner) => owner.orderId === attempt.orderId && owner.state === "DRAFT" && owner.version === 1,
    ),
    update: (attempt: OpenGameUpdateAttempt) => ownerSuccess(
      "update",
      200,
      "PUT",
      `/api/v1/games/${encodeURIComponent(attempt.gameId)}`,
      { ...draftRequest(attempt.body), expected_version: attempt.body.expectedVersion },
      attempt.idempotencyKey,
      (owner) => owner.id === attempt.gameId && owner.version === attempt.body.expectedVersion + 1,
    ),
    publish: (attempt: OpenGamePublishAttempt) => ownerSuccess(
      "publish",
      200,
      "POST",
      `/api/v1/games/${encodeURIComponent(attempt.gameId)}/publish`,
      { expected_version: attempt.expectedVersion },
      attempt.idempotencyKey,
      (owner) => owner.id === attempt.gameId
        && owner.version === attempt.expectedVersion + 1
        && owner.state === "PUBLISHED",
    ),
    cancel: (attempt: OpenGameCancelAttempt) => ownerSuccess(
      "cancel",
      200,
      "POST",
      `/api/v1/games/${encodeURIComponent(attempt.gameId)}/cancel`,
      { expected_version: attempt.expectedVersion },
      attempt.idempotencyKey,
      (owner) => owner.id === attempt.gameId
        && owner.version === attempt.expectedVersion + 1
        && owner.persistedStatus === "CANCELLED"
        && owner.state === "CANCELLED",
    ),
  };
}
