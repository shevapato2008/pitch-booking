import { ApiResponseError } from "../domain/contracts";
import { decodeWeChatSession } from "../domain/decoders";
import {
  decodeCurrentVenueStaffInvitation,
  decodeVenueStaffInvitation,
  decodeVenueStaffInvitationCreated,
  decodeVenueStaffMembershipAccepted,
  decodeVenueStaffMember,
  decodeVenueStaffOverview,
} from "../domain/venue-staff";
import type { StatusTransport, TransportError, WeChatIdentityCapability } from "../runtime/interfaces";
import type { SessionStore } from "./session-store";
import type {
  AcceptVenueStaffInvitationAttempt,
  CreateVenueStaffInvitationAttempt,
  RemoveVenueStaffMemberAttempt,
  RevokeVenueStaffInvitationAttempt,
  UpdateVenueStaffPermissionsAttempt,
  VenueStaffAttemptStore,
  VenueStaffDataSource,
  VenueStaffMutationAttempt,
} from "./venue-staff";

export type VenueStaffApiErrorCode =
  | "AUTH_REQUIRED"
  | "LOGIN_FAILED"
  | "VENUE_STAFF_NOT_FOUND"
  | "VENUE_STAFF_STATE_CHANGED"
  | "VENUE_STAFF_INVITATION_UNAVAILABLE"
  | "VENUE_STAFF_AUTHORIZATION_DISABLED"
  | "OWNER_TRANSFER_REQUIRED"
  | "IDEMPOTENCY_KEY_REUSED"
  | "REQUEST_IN_PROGRESS"
  | "INVALID_ARGUMENT"
  | "SERVICE_UNAVAILABLE"
  | "VENUE_STAFF_RESULT_UNKNOWN"
  | "VENUE_STAFF_PENDING_ATTEMPT"
  | "VENUE_STAFF_ACCOUNT_CHANGED";

export class VenueStaffApiError extends Error {
  constructor(readonly code: VenueStaffApiErrorCode) {
    super(code);
    this.name = "VenueStaffApiError";
  }
}

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const BUSINESS_CODES = [
  "AUTH_REQUIRED", "VENUE_STAFF_NOT_FOUND", "VENUE_STAFF_STATE_CHANGED",
  "VENUE_STAFF_INVITATION_UNAVAILABLE", "VENUE_STAFF_AUTHORIZATION_DISABLED",
  "OWNER_TRANSFER_REQUIRED", "IDEMPOTENCY_KEY_REUSED", "REQUEST_IN_PROGRESS",
  "INVALID_ARGUMENT", "SERVICE_UNAVAILABLE",
] as const;

function errorCode(value: unknown): typeof BUSINESS_CODES[number] | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const error = (value as Record<string, unknown>).error;
  if (typeof error !== "object" || error === null || Array.isArray(error)) return null;
  const code = (error as Record<string, unknown>).code;
  return typeof code === "string" && BUSINESS_CODES.includes(code as typeof BUSINESS_CODES[number])
    ? code as typeof BUSINESS_CODES[number]
    : null;
}

function transportFailure(caught: unknown): { statusCode: number; data: unknown } | null {
  if (typeof caught !== "object" || caught === null) return null;
  const failure = caught as Partial<TransportError> & { data?: unknown };
  return failure.code === "HTTP_ERROR" && typeof failure.statusCode === "number"
    ? { statusCode: failure.statusCode, data: failure.data }
    : null;
}

function shouldPreserveAttempt(caught: unknown): boolean {
  return caught instanceof VenueStaffApiError && [
    "VENUE_STAFF_RESULT_UNKNOWN", "REQUEST_IN_PROGRESS", "AUTH_REQUIRED",
    "LOGIN_FAILED", "VENUE_STAFF_ACCOUNT_CHANGED", "VENUE_STAFF_PENDING_ATTEMPT",
  ].includes(caught.code);
}

function samePermissions(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return left.length === right.length && left.every((permission) => right.includes(permission));
}

function unknownResult(): never {
  throw new VenueStaffApiError("VENUE_STAFF_RESULT_UNKNOWN");
}

export function createHttpVenueStaffDataSource({ transport, identity, sessionStore, attemptStore }: {
  readonly transport: StatusTransport;
  readonly identity: WeChatIdentityCapability;
  readonly sessionStore: SessionStore;
  readonly attemptStore: VenueStaffAttemptStore;
}): VenueStaffDataSource {
  let loginInFlight: Promise<string> | undefined;

  const login = (): Promise<string> => {
    const current = sessionStore.load();
    if (current) return Promise.resolve(current.userId);
    if (loginInFlight) return loginInFlight;
    const request = (async () => {
      try {
        const { code } = await identity.login();
        if (!code) throw new Error("EMPTY_LOGIN_CODE");
        const response = await transport.requestWithStatus<unknown>("POST", "/api/v1/auth/wechat/session", { code });
        if (response.statusCode !== 200) throw new Error("LOGIN_STATUS");
        const session = decodeWeChatSession(response.data);
        sessionStore.save({ token: session.token, expiresAt: session.expiresAt, userId: session.user.userId });
        return session.user.userId;
      } catch (caught) {
        if (caught instanceof VenueStaffApiError) throw caught;
        throw new VenueStaffApiError("LOGIN_FAILED");
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
    if (!session) throw new VenueStaffApiError("AUTH_REQUIRED");
    return { Authorization: `Bearer ${session.token}` };
  };
  const mutationHeaders = (attempt: VenueStaffMutationAttempt, invitationToken?: string): Readonly<Record<string, string>> => {
    const session = sessionStore.load();
    if (!session) throw new VenueStaffApiError("AUTH_REQUIRED");
    if (session.userId !== attempt.originatingUserId) throw new VenueStaffApiError("VENUE_STAFF_ACCOUNT_CHANGED");
    return {
      Authorization: `Bearer ${session.token}`,
      "Idempotency-Key": attempt.idempotencyKey,
      ...(invitationToken ? { "X-Venue-Staff-Invitation-Token": invitationToken } : {}),
    };
  };
  const invitationHeaders = (invitationToken: string): Readonly<Record<string, string>> => ({
    ...bearer(),
    "X-Venue-Staff-Invitation-Token": invitationToken,
  });

  const authorized = async <T>(write: boolean, perform: () => Promise<T>): Promise<T> => {
    let recovered = false;
    if (!sessionStore.load()) { await login(); recovered = true; }
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try { return await perform(); } catch (caught) {
        if (caught instanceof VenueStaffApiError
          && (caught.code === "VENUE_STAFF_ACCOUNT_CHANGED" || caught.code === "VENUE_STAFF_PENDING_ATTEMPT")) throw caught;
        const failure = transportFailure(caught);
        const code = failure ? errorCode(failure.data) : null;
        if (failure?.statusCode === 401 || code === "AUTH_REQUIRED") {
          sessionStore.clear();
          if (!recovered && attempt === 0) { await login(); recovered = true; continue; }
          throw new VenueStaffApiError("AUTH_REQUIRED");
        }
        if (write && (failure === null || failure.statusCode >= 500) && code !== "VENUE_STAFF_AUTHORIZATION_DISABLED") {
          throw new VenueStaffApiError("VENUE_STAFF_RESULT_UNKNOWN");
        }
        if (code) throw new VenueStaffApiError(code);
        if (write) throw new VenueStaffApiError("VENUE_STAFF_RESULT_UNKNOWN");
        if (caught instanceof ApiResponseError) throw caught;
        throw new VenueStaffApiError("SERVICE_UNAVAILABLE");
      }
    }
    throw new Error("UNREACHABLE_AUTH_RETRY");
  };

  const begin = (attempt: VenueStaffMutationAttempt): VenueStaffMutationAttempt => {
    const availability = attemptStore.begin(attempt);
    if (availability.kind !== "READY") throw new VenueStaffApiError("VENUE_STAFF_PENDING_ATTEMPT");
    return availability.attempt;
  };
  const write = async <T>(attempt: VenueStaffMutationAttempt, perform: (stable: VenueStaffMutationAttempt) => Promise<T>): Promise<T> => {
    const stable = begin(attempt);
    try {
      const result = await authorized(true, () => perform(stable));
      attemptStore.clear();
      return result;
    } catch (caught) {
      if (!shouldPreserveAttempt(caught)) attemptStore.clear();
      throw caught;
    }
  };
  const expectStatus = (statusCode: number, expected: number): void => {
    if (statusCode !== expected) throw new VenueStaffApiError("VENUE_STAFF_RESULT_UNKNOWN");
  };
  const base = (venueId: string) => `/api/v1/admin/venues/${encodeURIComponent(venueId)}`;

  return {
    login,
    currentUserId: () => sessionStore.load()?.userId ?? null,
    getOverview: (venueId) => authorized(false, async () => {
      const response = await transport.requestWithStatus<unknown>("GET", `${base(venueId)}/staff`, undefined, bearer());
      if (response.statusCode !== 200) throw new VenueStaffApiError("SERVICE_UNAVAILABLE");
      const overview = decodeVenueStaffOverview(response.data);
      if (overview.venueId !== venueId) throw new VenueStaffApiError("SERVICE_UNAVAILABLE");
      return overview;
    }),
    createInvitation: (attempt: CreateVenueStaffInvitationAttempt) => write(attempt, async (stable) => {
      const request = stable as CreateVenueStaffInvitationAttempt;
      const response = await transport.requestWithStatus<unknown>(
        "POST", `${base(request.venueId)}/staff-invitations`,
        { contact_label: request.contactLabel, permissions: request.permissions }, mutationHeaders(request),
      );
      try {
        if (response.statusCode === 201) {
          const invitation = decodeVenueStaffInvitationCreated(response.data);
          if (invitation.contactLabel !== request.contactLabel
            || !samePermissions(invitation.permissions, request.permissions)) unknownResult();
          return { kind: "CREATED" as const, invitation };
        }
        if (response.statusCode === 200) {
          const invitation = decodeVenueStaffInvitation(response.data);
          if (invitation.status !== "ACTIVE"
            || invitation.contactLabel !== request.contactLabel
            || !samePermissions(invitation.permissions, request.permissions)) unknownResult();
          return { kind: "REPLAYED" as const, invitation };
        }
      } catch { throw new VenueStaffApiError("VENUE_STAFF_RESULT_UNKNOWN"); }
      throw new VenueStaffApiError("VENUE_STAFF_RESULT_UNKNOWN");
    }),
    updatePermissions: (attempt: UpdateVenueStaffPermissionsAttempt) => write(attempt, async (stable) => {
      const request = stable as UpdateVenueStaffPermissionsAttempt;
      const response = await transport.requestWithStatus<unknown>(
        "PUT", `${base(request.venueId)}/staff/${encodeURIComponent(request.membershipId)}`,
        { expected_version: request.expectedVersion, permissions: request.permissions }, mutationHeaders(request),
      );
      expectStatus(response.statusCode, 200);
      try {
        const member = decodeVenueStaffMember(response.data);
        if (member.id !== request.membershipId || member.role !== "STAFF" || !member.isActive
          || member.version !== request.expectedVersion + 1
          || !samePermissions(member.permissions, request.permissions)) unknownResult();
        return member;
      } catch { throw new VenueStaffApiError("VENUE_STAFF_RESULT_UNKNOWN"); }
    }),
    removeMember: (attempt: RemoveVenueStaffMemberAttempt) => write(attempt, async (stable) => {
      const request = stable as RemoveVenueStaffMemberAttempt;
      const response = await transport.requestWithStatus<unknown>(
        "POST", `${base(request.venueId)}/staff/${encodeURIComponent(request.membershipId)}/remove`,
        { expected_version: request.expectedVersion, reason: request.reason }, mutationHeaders(request),
      );
      expectStatus(response.statusCode, 200);
      try {
        const member = decodeVenueStaffMember(response.data);
        if (member.id !== request.membershipId || member.role !== "STAFF" || member.isActive
          || member.version !== request.expectedVersion + 1) unknownResult();
        return member;
      } catch { throw new VenueStaffApiError("VENUE_STAFF_RESULT_UNKNOWN"); }
    }),
    revokeInvitation: (attempt: RevokeVenueStaffInvitationAttempt) => write(attempt, async (stable) => {
      const request = stable as RevokeVenueStaffInvitationAttempt;
      const response = await transport.requestWithStatus<unknown>(
        "POST", `${base(request.venueId)}/staff-invitations/${encodeURIComponent(request.invitationId)}/revoke`, {}, mutationHeaders(request),
      );
      expectStatus(response.statusCode, 200);
      try {
        const invitation = decodeVenueStaffInvitation(response.data);
        if (invitation.id !== request.invitationId || invitation.status !== "REVOKED") unknownResult();
        return invitation;
      } catch { throw new VenueStaffApiError("VENUE_STAFF_RESULT_UNKNOWN"); }
    }),
    getCurrentInvitation: (invitationToken) => {
      if (!TOKEN.test(invitationToken)) return Promise.reject(new VenueStaffApiError("VENUE_STAFF_INVITATION_UNAVAILABLE"));
      return authorized(false, async () => {
        const response = await transport.requestWithStatus<unknown>(
          "GET", "/api/v1/venue-staff-invitations/current", undefined, invitationHeaders(invitationToken),
        );
        if (response.statusCode !== 200) throw new VenueStaffApiError("SERVICE_UNAVAILABLE");
        return decodeCurrentVenueStaffInvitation(response.data);
      });
    },
    acceptInvitation: (invitationToken: string, attempt: AcceptVenueStaffInvitationAttempt) => {
      if (!TOKEN.test(invitationToken)) return Promise.reject(new VenueStaffApiError("VENUE_STAFF_INVITATION_UNAVAILABLE"));
      return write(attempt, async (stable) => {
        const request = stable as AcceptVenueStaffInvitationAttempt;
        const response = await transport.requestWithStatus<unknown>(
          "POST", "/api/v1/venue-staff-invitations/current/accept", {}, mutationHeaders(request, invitationToken),
        );
        expectStatus(response.statusCode, 200);
        try {
          const accepted = decodeVenueStaffMembershipAccepted(response.data);
          if (accepted.venueId !== request.venueId
            || !samePermissions(accepted.membership.permissions, request.permissions)) unknownResult();
          return accepted;
        } catch { throw new VenueStaffApiError("VENUE_STAFF_RESULT_UNKNOWN"); }
      });
    },
  };
}
