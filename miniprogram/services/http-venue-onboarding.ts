import { decodePhoneVerification } from "../domain/decoders";
import {
  decodeVenueOnboardingApplication,
  decodeVenueOnboardingApplications,
  decodeVenueOnboardingCandidates,
  decodeVenueOnboardingEvidenceClosed,
  decodeVenueOnboardingUploadIntent,
  type VenueOnboardingCandidate,
} from "../domain/venue-onboarding";
import { enumAt, exactObject, objectAt, rfc3339At, stringAt, uuidAt } from "../domain/decoder-primitives";
import type { Transport, TransportError, WeChatIdentityCapability, WeChatPhoneCapability } from "../runtime/interfaces";
import type { SessionStore } from "./session-store";
import type { VenueOnboardingDataSource, VenueOnboardingIdentity } from "./venue-onboarding";

const ONBOARDING_ERROR_CODES = [
  "INVALID_ARGUMENT", "SERVICE_UNAVAILABLE", "INTERNAL_ERROR", "AUTH_REQUIRED", "WECHAT_LOGIN_FAILED",
  "PHONE_AUTH_REQUIRED", "PHONE_AUTH_UNAVAILABLE", "PHONE_AUTH_FAILED", "IDEMPOTENCY_KEY_REUSED",
  "POSSIBLE_DUPLICATE_VENUE", "ONBOARDING_EVIDENCE_REQUIRED", "ONBOARDING_EVIDENCE_INVALID",
  "ONBOARDING_APPLICATION_EXISTS", "ONBOARDING_APPLICATION_NOT_FOUND", "ONBOARDING_APPLICATION_STATE_CHANGED",
] as const;

export type VenueOnboardingApiErrorCode = typeof ONBOARDING_ERROR_CODES[number]
  | "LOGIN_FAILED" | "PHONE_CAPABILITY_UNAVAILABLE" | "PHONE_REJECTED" | "SUBMISSION_RESULT_UNKNOWN";

export class VenueOnboardingApiError extends Error {
  constructor(
    readonly code: VenueOnboardingApiErrorCode,
    readonly duplicateCandidate?: VenueOnboardingCandidate,
  ) {
    super(code);
    this.name = "VenueOnboardingApiError";
  }
}

export function createHttpVenueOnboardingDataSource({ transport, identity, phone, sessionStore }: {
  readonly transport: Transport;
  readonly identity: WeChatIdentityCapability;
  readonly phone: WeChatPhoneCapability;
  readonly sessionStore: SessionStore;
}): VenueOnboardingDataSource {
  type Operation = "read" | "phone" | "mutation";
  let loginInFlight: Promise<VenueOnboardingIdentity> | undefined;

  const bearer = (): Readonly<Record<string, string>> => {
    const session = sessionStore.load();
    if (!session) throw new VenueOnboardingApiError("AUTH_REQUIRED");
    return { Authorization: `Bearer ${session.token}` };
  };

  const login = (): Promise<VenueOnboardingIdentity> => {
    if (loginInFlight) return loginInFlight;
    const request = (async () => {
      try {
        const result = await identity.login();
        if (!result.code) throw new VenueOnboardingApiError("LOGIN_FAILED");
        const session = decodeOnboardingSession(
          await transport.post("/api/v1/auth/wechat/session", { code: result.code }),
        );
        sessionStore.save({ token: session.token, expiresAt: session.expiresAt, userId: session.identity.userId });
        return session.identity;
      } catch (caught) {
        if (caught instanceof VenueOnboardingApiError) throw caught;
        const failure = inspectFailure(caught);
        if (failure?.error?.code === "WECHAT_LOGIN_FAILED") throw new VenueOnboardingApiError("LOGIN_FAILED");
        throw new VenueOnboardingApiError("LOGIN_FAILED");
      }
    })();
    loginInFlight = request;
    void request.then(
      () => { if (loginInFlight === request) loginInFlight = undefined; },
      () => { if (loginInFlight === request) loginInFlight = undefined; },
    );
    return request;
  };

  const authorized = async <T>(operation: Operation, perform: () => Promise<T>): Promise<T> => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await perform();
      } catch (caught) {
        const failure = inspectFailure(caught);
        const authRejected = failure?.statusCode === 401 || failure?.error?.code === "AUTH_REQUIRED"
          || (caught instanceof VenueOnboardingApiError && caught.code === "AUTH_REQUIRED");
        if (authRejected) sessionStore.clear();
        if (authRejected && attempt === 0) {
          await login();
          continue;
        }
        if (operation === "mutation") {
          if (failure?.error && failure.statusCode >= 400 && failure.statusCode < 500) {
            throw new VenueOnboardingApiError(failure.error.code, failure.error.duplicateCandidate);
          }
          if (failure?.decodeError && failure.statusCode >= 400 && failure.statusCode < 500) throw failure.decodeError;
          throw new VenueOnboardingApiError("SUBMISSION_RESULT_UNKNOWN");
        }
        if (failure?.decodeError) throw failure.decodeError;
        if (failure?.error) {
          if (operation === "phone" && failure.error.code === "PHONE_AUTH_UNAVAILABLE") {
            throw new VenueOnboardingApiError("PHONE_CAPABILITY_UNAVAILABLE");
          }
          if (operation === "phone" && failure.error.code === "PHONE_AUTH_FAILED") {
            throw new VenueOnboardingApiError("PHONE_REJECTED");
          }
          throw new VenueOnboardingApiError(failure.error.code, failure.error.duplicateCandidate);
        }
        if (caught instanceof VenueOnboardingApiError) throw caught;
        throw caught;
      }
    }
    throw new Error("UNREACHABLE_AUTH_RETRY");
  };

  return {
    login,
    authorizePhone(rawDetail) {
      return authorized("phone", async () => {
        const { code } = phone.normalizeEvent(rawDetail);
        const verified = decodePhoneVerification(
          await transport.post("/api/v1/auth/wechat/phone", { code }, bearer()),
        );
        return { maskedPhone: verified.maskedPhone };
      });
    },
    searchCandidates(query, cursor) {
      const params = `q=${encodeURIComponent(query.trim())}&limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      return authorized("read", async () => decodeVenueOnboardingCandidates(
        await transport.get(`/api/v1/venue-onboarding/candidates?${params}`, bearer()),
      ));
    },
    listApplications(cursor) {
      const params = `limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      return authorized("read", async () => decodeVenueOnboardingApplications(
        await transport.get(`/api/v1/venue-onboarding/applications?${params}`, bearer()),
      ));
    },
    createUploadIntent(kind, idempotencyKey) {
      return authorized("mutation", async () => decodeVenueOnboardingUploadIntent(
        await transport.post("/api/v1/venue-onboarding/evidence/upload-intents", { kind }, {
          ...bearer(), "Idempotency-Key": idempotencyKey,
        }),
      ));
    },
    completeEvidence(evidenceId, idempotencyKey) {
      return authorized("mutation", async () => decodeVenueOnboardingEvidenceClosed(
        await transport.post(`/api/v1/venue-onboarding/evidence/${evidenceId}/complete`, undefined, {
          ...bearer(), "Idempotency-Key": idempotencyKey,
        }),
      ));
    },
    submitClaim(input, idempotencyKey) {
      const body = { venue_id: input.venueId, contact_name: input.contactName, evidence: input.evidence };
      return authorized("mutation", async () => decodeVenueOnboardingApplication(
        await transport.post("/api/v1/venue-onboarding/claims", body, {
          ...bearer(), "Idempotency-Key": idempotencyKey,
        }),
      ));
    },
    submitCreate(input, idempotencyKey) {
      const body = {
        name: input.name,
        address: input.address,
        district_code: input.districtCode,
        district_name: input.districtName,
        latitude: input.latitude,
        longitude: input.longitude,
        contact_name: input.contactName,
        evidence: input.evidence,
      };
      return authorized("mutation", async () => decodeVenueOnboardingApplication(
        await transport.post("/api/v1/venue-onboarding/venues", body, {
          ...bearer(), "Idempotency-Key": idempotencyKey,
        }),
      ));
    },
  };
}

function decodeOnboardingSession(value: unknown): {
  readonly token: string;
  readonly expiresAt: string;
  readonly identity: VenueOnboardingIdentity;
} {
  const root = exactObject(value, ["session_token", "expires_at", "user"], "$");
  const user = exactObject(root.user, ["id", "masked_phone", "last_contact_name"], "$.user");
  const token = stringAt(root.session_token, "$.session_token");
  if (token.length < 43 || token.length > 256) throw new Error("INVALID_SESSION_TOKEN");
  const maskedPhone = user.masked_phone === null ? null : stringAt(user.masked_phone, "$.user.masked_phone");
  if (maskedPhone !== null && !/^1\d{2}\*{4}\d{4}$/.test(maskedPhone)) throw new Error("INVALID_MASKED_PHONE");
  return {
    token,
    expiresAt: rfc3339At(root.expires_at, "$.expires_at"),
    identity: {
      userId: uuidAt(user.id, "$.user.id"),
      maskedPhone,
      contactName: user.last_contact_name === null ? null : stringAt(user.last_contact_name, "$.user.last_contact_name"),
    },
  };
}

function inspectFailure(caught: unknown): {
  readonly statusCode: number;
  readonly error?: { readonly code: typeof ONBOARDING_ERROR_CODES[number]; readonly duplicateCandidate?: VenueOnboardingCandidate };
  readonly decodeError?: unknown;
} | null {
  const transportError = caught as Partial<TransportError>;
  if (transportError.code !== "HTTP_ERROR" || typeof transportError.statusCode !== "number" || !("data" in transportError)) return null;
  try {
    const root = exactObject(transportError.data, ["error"], "$");
    const error = exactObject(root.error, ["code", "message", "request_id", "details"], "$.error");
    const code = enumAt(error.code, ONBOARDING_ERROR_CODES, "$.error.code");
    stringAt(error.message, "$.error.message");
    stringAt(error.request_id, "$.error.request_id");
    const details = objectAt(error.details, "$.error.details");
    let duplicateCandidate: VenueOnboardingCandidate | undefined;
    if (code === "POSSIBLE_DUPLICATE_VENUE") {
      for (const key of Object.keys(details)) if (key !== "claim_candidate") throw new Error("INVALID_DUPLICATE_DETAILS");
      if (details.claim_candidate !== undefined) {
        duplicateCandidate = decodeVenueOnboardingCandidates({ items: [details.claim_candidate], next_cursor: null }).items[0];
      }
    }
    return { statusCode: transportError.statusCode, error: { code, duplicateCandidate } };
  } catch (decodeError) {
    return { statusCode: transportError.statusCode, decodeError };
  }
}
