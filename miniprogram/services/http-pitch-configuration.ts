import { ApiResponseError } from "../domain/contracts";
import { decodePitchConfiguration, decodePitchConfigurationError, type PitchConfigurationErrorCode } from "../domain/pitch-configuration";
import { decodeWeChatSession } from "../domain/decoders";
import type { Transport, TransportError, WeChatIdentityCapability } from "../runtime/interfaces";
import type { PitchConfigurationChange, PitchConfigurationDataSource, SavePitchConfigurationAttempt } from "./pitch-configuration";
import type { SessionStore } from "./session-store";

export class PitchConfigurationApiError extends Error { constructor(readonly code: PitchConfigurationErrorCode | "LOGIN_FAILED" | "PITCH_CONFIGURATION_RESULT_UNKNOWN", readonly details?: Record<string, unknown>) { super(code); this.name = "PitchConfigurationApiError"; } }
const encodeChange = (change: PitchConfigurationChange) => change.operation === "CREATE"
  ? { operation: change.operation, client_ref: change.clientRef, custom_name: change.customName, players_per_side: change.playersPerSide }
  : change.operation === "UPDATE" ? { operation: change.operation, pitch_id: change.pitchId, custom_name: change.customName, players_per_side: change.playersPerSide, status: change.status }
    : { operation: change.operation, pitch_id: change.pitchId };
export function createHttpPitchConfigurationDataSource({ transport, identity, sessionStore }: { readonly transport: Transport; readonly identity: WeChatIdentityCapability; readonly sessionStore: SessionStore }): PitchConfigurationDataSource {
  let loginInFlight: Promise<void> | undefined;
  const bearer = () => { const session = sessionStore.load(); if (!session) throw new PitchConfigurationApiError("AUTH_REQUIRED"); return { Authorization: `Bearer ${session.token}` }; };
  const login = () => {
    if (loginInFlight) return loginInFlight;
    const request = (async () => { try { const { code } = await identity.login(); const session = decodeWeChatSession(await transport.post("/api/v1/auth/wechat/session", { code })); sessionStore.save({ token: session.token, expiresAt: session.expiresAt }); } catch (caught) { if (caught instanceof ApiResponseError || caught instanceof PitchConfigurationApiError) throw caught; throw new PitchConfigurationApiError("LOGIN_FAILED"); } })();
    loginInFlight = request; void request.then(() => { if (loginInFlight === request) loginInFlight = undefined; }, () => { if (loginInFlight === request) loginInFlight = undefined; }); return request;
  };
  const inspect = (caught: unknown) => { const error = caught as Partial<TransportError>; if (error.code !== "HTTP_ERROR" || typeof error.statusCode !== "number" || !("data" in error)) return null; if (error.statusCode === 401) sessionStore.clear(); const decoded = decodePitchConfigurationError(error.data); if (decoded.code === "AUTH_REQUIRED") sessionStore.clear(); return { statusCode: error.statusCode, ...decoded }; };
  const authorized = async <T>(write: boolean, perform: () => Promise<T>): Promise<T> => {
    for (let attempt = 0; attempt < 2; attempt += 1) try { return await perform(); } catch (caught) {
      let inspected: ReturnType<typeof inspect>; try { inspected = inspect(caught); } catch (decodeError) { if (write) throw new PitchConfigurationApiError("PITCH_CONFIGURATION_RESULT_UNKNOWN"); throw decodeError; }
      if ((inspected?.code === "AUTH_REQUIRED" || (caught instanceof PitchConfigurationApiError && caught.code === "AUTH_REQUIRED")) && attempt === 0) { await login(); continue; }
      if (inspected) { if (write && inspected.statusCode >= 500) throw new PitchConfigurationApiError("PITCH_CONFIGURATION_RESULT_UNKNOWN"); throw new PitchConfigurationApiError(inspected.code, inspected.details); }
      if (write && (caught as Partial<TransportError>).code && !(caught instanceof ApiResponseError)) throw new PitchConfigurationApiError("PITCH_CONFIGURATION_RESULT_UNKNOWN");
      throw caught;
    }
    throw new Error("UNREACHABLE_AUTH_RETRY");
  };
  return { login, get: (venueId) => authorized(false, async () => decodePitchConfiguration(await transport.get(`/api/v1/admin/venues/${encodeURIComponent(venueId)}/pitch-configuration`, bearer()))), save: (attempt: SavePitchConfigurationAttempt) => authorized(true, async () => decodePitchConfiguration(await transport.put(`/api/v1/admin/venues/${encodeURIComponent(attempt.venueId)}/pitch-configuration`, { expected_version: attempt.expectedVersion, changes: attempt.changes.map(encodeChange) }, { ...bearer(), "Idempotency-Key": attempt.idempotencyKey }))) };
}
