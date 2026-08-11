import { ApiResponseError } from "../domain/contracts";
import { decodeWeChatSession } from "../domain/decoders";
import { decodeAdminVenueProfile, decodeVenueProfileUploadIntent } from "../domain/venue-profile";
import type { DeletingTransport, TransportError, WeChatIdentityCapability } from "../runtime/interfaces";
import type { SessionStore } from "./session-store";
import type { VenueProfileAttemptStore } from "./venue-profile-attempt-store";
import type { VenueProfileDataSource, VenueProfileMutationAttempt } from "./venue-profile";

export type VenueProfileApiErrorCode = "AUTH_REQUIRED" | "VENUE_PROFILE_FORBIDDEN" | "VENUE_PROFILE_NOT_FOUND" | "VENUE_PROFILE_VERSION_CONFLICT" | "VENUE_PROFILE_VALIDATION_FAILED" | "LOGIN_FAILED" | "VENUE_PROFILE_RESULT_UNKNOWN";
export class VenueProfileApiError extends Error {
  constructor(readonly code: VenueProfileApiErrorCode, readonly details?: Record<string, unknown>) { super(code); this.name = "VenueProfileApiError"; }
}

function decodeError(value: unknown): { code: VenueProfileApiErrorCode; details?: Record<string, unknown> } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new ApiResponseError("$.error");
  const envelope = value as Record<string, unknown>; const error = envelope.error;
  if (typeof error !== "object" || error === null || Array.isArray(error)) throw new ApiResponseError("$.error");
  const o = error as Record<string, unknown>;
  const allowed = ["AUTH_REQUIRED", "VENUE_PROFILE_FORBIDDEN", "VENUE_PROFILE_NOT_FOUND", "VENUE_PROFILE_VERSION_CONFLICT", "VENUE_PROFILE_VALIDATION_FAILED"] as const;
  if (typeof o.code !== "string" || !allowed.includes(o.code as typeof allowed[number])) throw new ApiResponseError("$.error.code");
  return { code: o.code as typeof allowed[number], ...(typeof o.details === "object" && o.details !== null && !Array.isArray(o.details) ? { details: o.details as Record<string, unknown> } : {}) };
}

export function createHttpVenueProfileDataSource({ transport, identity, sessionStore, attemptStore }: {
  readonly transport: DeletingTransport; readonly identity: WeChatIdentityCapability; readonly sessionStore: SessionStore; readonly attemptStore: VenueProfileAttemptStore;
}): VenueProfileDataSource {
  let loginInFlight: Promise<void> | undefined;
  const login = (): Promise<void> => {
    if (loginInFlight) return loginInFlight;
    const request = (async () => { try { const { code } = await identity.login(); const session = decodeWeChatSession(await transport.post("/api/v1/auth/wechat/session", { code })); sessionStore.save({ token: session.token, expiresAt: session.expiresAt }); } catch (caught) { if (caught instanceof ApiResponseError || caught instanceof VenueProfileApiError) throw caught; throw new VenueProfileApiError("LOGIN_FAILED"); } })();
    loginInFlight = request; void request.finally(() => { if (loginInFlight === request) loginInFlight = undefined; }).catch(() => undefined); return request;
  };
  const bearer = () => { const session = sessionStore.load(); if (!session) throw new VenueProfileApiError("AUTH_REQUIRED"); return { Authorization: `Bearer ${session.token}` }; };
  const inspect = (caught: unknown) => {
    const error = caught as Partial<TransportError>;
    if (error.code !== "HTTP_ERROR" || typeof error.statusCode !== "number" || !("data" in error)) return null;
    const decoded = decodeError(error.data); if (error.statusCode === 401 || decoded.code === "AUTH_REQUIRED") sessionStore.clear();
    return { statusCode: error.statusCode, ...decoded };
  };
  const authorized = async <T>(write: boolean, perform: () => Promise<T>): Promise<T> => {
    for (let count = 0; count < 2; count += 1) {
      try { return await perform(); } catch (caught) {
        if (caught instanceof VenueProfileApiError && caught.code === "AUTH_REQUIRED" && count === 0) { await login(); continue; }
        let result: ReturnType<typeof inspect>;
        try { result = inspect(caught); } catch (decodeFailure) { if (write) throw new VenueProfileApiError("VENUE_PROFILE_RESULT_UNKNOWN"); throw decodeFailure; }
        if (result?.code === "AUTH_REQUIRED" && count === 0) { await login(); continue; }
        if (result) {
          if (write && result.statusCode >= 500) throw new VenueProfileApiError("VENUE_PROFILE_RESULT_UNKNOWN");
          throw new VenueProfileApiError(result.code, result.details);
        }
        if (write) {
          if (caught instanceof VenueProfileApiError) throw caught;
          throw new VenueProfileApiError("VENUE_PROFILE_RESULT_UNKNOWN");
        }
        throw caught;
      }
    }
    throw new Error("UNREACHABLE_AUTH_RETRY");
  };
  const read = (venueId: string) => authorized(false, () => transport.get(`/api/v1/admin/venues/${encodeURIComponent(venueId)}/profile`, bearer()).then(decodeAdminVenueProfile));
  const write = async <T>(attempt: VenueProfileMutationAttempt, perform: (stable: VenueProfileMutationAttempt, headers: Readonly<Record<string, string>>) => Promise<unknown>, decode: (value: unknown) => T): Promise<T> => {
    const stable = attemptStore.begin(attempt);
    try {
      const response = await authorized(true, () => perform(stable, { ...bearer(), "Idempotency-Key": stable.idempotencyKey }));
      let decoded: T;
      try { decoded = decode(response); } catch (caught) {
        if (caught instanceof VenueProfileApiError) throw caught;
        throw new VenueProfileApiError("VENUE_PROFILE_RESULT_UNKNOWN");
      }
      attemptStore.clear(); return decoded;
    } catch (caught) {
      if (!(caught instanceof VenueProfileApiError) || caught.code !== "VENUE_PROFILE_RESULT_UNKNOWN") attemptStore.clear();
      throw caught;
    }
  };
  const base = (venueId: string) => `/api/v1/admin/venues/${encodeURIComponent(venueId)}/profile`;
  return {
    login, get: read,
    save: (a) => write(a, (s, h) => { const x = s as typeof a; return transport.put(base(x.venueId), { expected_facility_version: x.body.expectedFacilityVersion, expected_revision_version: x.body.expectedRevisionVersion, description: x.body.description, facilities: x.body.facilities }, h); }, decodeAdminVenueProfile),
    createUploadIntent: (a) => write(a, (s, h) => { const x = s as typeof a; return transport.post(`${base(x.venueId)}/images/upload-intents`, { expected_revision_version: x.body.expectedRevisionVersion, filename: x.body.filename, mime_type: x.body.mimeType, byte_size: x.body.byteSize }, h); }, decodeVenueProfileUploadIntent),
    completeUpload: (a) => write(a, (s, h) => { const x = s as typeof a; return transport.post(`${base(x.venueId)}/images/${encodeURIComponent(x.imageId)}/complete`, { expected_revision_version: x.expectedRevisionVersion }, h); }, decodeAdminVenueProfile),
    deleteImage: (a) => write(a, (s, h) => { const x = s as typeof a; return transport.delete(`${base(x.venueId)}/images/${encodeURIComponent(x.imageId)}`, { expected_revision_version: x.expectedRevisionVersion }, h); }, decodeAdminVenueProfile),
    reorderImages: (a) => write(a, (s, h) => { const x = s as typeof a; return transport.put(`${base(x.venueId)}/images/order`, { expected_revision_version: x.expectedRevisionVersion, image_ids: x.imageIds }, h); }, decodeAdminVenueProfile),
    setCover: (a) => write(a, (s, h) => { const x = s as typeof a; return transport.put(`${base(x.venueId)}/images/${encodeURIComponent(x.imageId)}/cover`, { expected_revision_version: x.expectedRevisionVersion }, h); }, decodeAdminVenueProfile),
    retryModeration: (a) => write(a, (s, h) => { const x = s as typeof a; return transport.post(`${base(x.venueId)}/moderation/${encodeURIComponent(x.itemId)}/retry`, { expected_revision_version: x.expectedRevisionVersion }, h); }, decodeAdminVenueProfile),
  };
}
