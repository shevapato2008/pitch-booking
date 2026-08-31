import { ApiResponseError } from "../domain/contracts";
import { decodeWeChatSession } from "../domain/decoders";
import { decodeVenueFulfillmentOrder, decodeVenueFulfillmentPage, decodeVenueRefundAccepted } from "../domain/venue-fulfillment";
import type { StatusTransport, TransportError, WeChatIdentityCapability } from "../runtime/interfaces";
import type { SessionStore } from "./session-store";
import type { VenueFulfillmentAttemptStore } from "./venue-fulfillment-attempt-store";
import type { RefundAttempt, VenueFulfillmentDataSource, VenueFulfillmentMutationAttempt } from "./venue-fulfillment";

export type VenueFulfillmentApiErrorCode = "AUTH_REQUIRED" | "ORDER_NOT_FOUND" | "ORDER_STATE_CHANGED" | "IDEMPOTENCY_KEY_REUSED" | "REFUND_IN_PROGRESS" | "INVALID_ARGUMENT" | "SERVICE_UNAVAILABLE" | "LOGIN_FAILED" | "FULFILLMENT_RESULT_UNKNOWN";
export class VenueFulfillmentApiError extends Error {
  constructor(readonly code: VenueFulfillmentApiErrorCode) { super(code); this.name = "VenueFulfillmentApiError"; }
}

const DEFINITIVE_CONFLICTS = ["ORDER_STATE_CHANGED", "IDEMPOTENCY_KEY_REUSED", "REFUND_IN_PROGRESS"] as const;

function errorCode(data: unknown): string | null {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const envelope = data as Record<string, unknown>;
  if (typeof envelope.error !== "object" || envelope.error === null || Array.isArray(envelope.error)) return null;
  const code = (envelope.error as Record<string, unknown>).code;
  return typeof code === "string" ? code : null;
}

function normalizeAttempt(attempt: VenueFulfillmentMutationAttempt): VenueFulfillmentMutationAttempt {
  if (attempt.kind !== "refund") return attempt;
  return { ...attempt, reason: attempt.reason.trim() };
}

export function createHttpVenueFulfillmentDataSource({ transport, identity, sessionStore, attemptStore }: {
  readonly transport: StatusTransport;
  readonly identity: WeChatIdentityCapability;
  readonly sessionStore: SessionStore;
  readonly attemptStore: VenueFulfillmentAttemptStore;
}): VenueFulfillmentDataSource {
  let loginInFlight: Promise<void> | undefined;
  const login = (): Promise<void> => {
    if (loginInFlight) return loginInFlight;
    const request = (async () => {
      try {
        const { code } = await identity.login();
        if (!code) throw new Error("EMPTY_LOGIN_CODE");
        const response = await transport.requestWithStatus<unknown>("POST", "/api/v1/auth/wechat/session", { code });
        if (response.statusCode !== 200) throw new Error("LOGIN_STATUS");
        const session = decodeWeChatSession(response.data);
        sessionStore.save({ token: session.token, expiresAt: session.expiresAt, userId: session.user.userId });
      } catch (caught) {
        if (caught instanceof VenueFulfillmentApiError) throw caught;
        throw new VenueFulfillmentApiError("LOGIN_FAILED");
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
    if (!session) throw new VenueFulfillmentApiError("AUTH_REQUIRED");
    return { Authorization: `Bearer ${session.token}` };
  };
  const authorized = async <T>(write: boolean, perform: () => Promise<T>): Promise<T> => {
    let recovered = false;
    if (!sessionStore.load()) { await login(); recovered = true; }
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try { return await perform(); } catch (caught) {
        const transportError = caught as Partial<TransportError>;
        const status = transportError.code === "HTTP_ERROR" ? transportError.statusCode : undefined;
        if (status === 401) {
          sessionStore.clear();
          if (!recovered && attempt === 0) { await login(); recovered = true; continue; }
          throw new VenueFulfillmentApiError("AUTH_REQUIRED");
        }
        if (status === 404) throw new VenueFulfillmentApiError("ORDER_NOT_FOUND");
        const code = status === undefined ? null : errorCode((transportError as { data?: unknown }).data);
        if (status === 409 && code && DEFINITIVE_CONFLICTS.includes(code as typeof DEFINITIVE_CONFLICTS[number])) {
          throw new VenueFulfillmentApiError(code as typeof DEFINITIVE_CONFLICTS[number]);
        }
        if (status === 422 && code === "INVALID_ARGUMENT") throw new VenueFulfillmentApiError("INVALID_ARGUMENT");
        if (!write && (status === 503 || status === undefined)) throw new VenueFulfillmentApiError("SERVICE_UNAVAILABLE");
        if (write && (status === undefined || status >= 500)) throw new VenueFulfillmentApiError("FULFILLMENT_RESULT_UNKNOWN");
        if (caught instanceof ApiResponseError || caught instanceof VenueFulfillmentApiError) throw caught;
        if (write) throw new VenueFulfillmentApiError("FULFILLMENT_RESULT_UNKNOWN");
        throw new VenueFulfillmentApiError("SERVICE_UNAVAILABLE");
      }
    }
    throw new Error("UNREACHABLE_AUTH_RETRY");
  };
  const base = (venueId: string) => `/api/v1/venues/${encodeURIComponent(venueId)}/fulfillment/orders`;
  const write = async <T>(
    attempt: VenueFulfillmentMutationAttempt,
    perform: (stable: VenueFulfillmentMutationAttempt, headers: Readonly<Record<string, string>>) => Promise<T>,
  ): Promise<T> => {
    const stable = attemptStore.begin(normalizeAttempt(attempt));
    try {
      const result = await authorized(true, () => perform(stable, { ...bearer(), "Idempotency-Key": stable.idempotencyKey }));
      attemptStore.clear();
      return result;
    } catch (caught) {
      if (!(caught instanceof VenueFulfillmentApiError) || caught.code !== "FULFILLMENT_RESULT_UNKNOWN") attemptStore.clear();
      throw caught;
    }
  };
  const postOrder = async (attempt: VenueFulfillmentMutationAttempt, suffix: "check-in" | "complete") => write(attempt, async (stable, headers) => {
    const response = await transport.requestWithStatus<unknown>("POST", `${base(stable.venueId)}/${encodeURIComponent(stable.orderId)}/${suffix}`, {}, headers);
    if (response.statusCode !== 200) throw new VenueFulfillmentApiError("FULFILLMENT_RESULT_UNKNOWN");
    try { return decodeVenueFulfillmentOrder(response.data); } catch { throw new VenueFulfillmentApiError("FULFILLMENT_RESULT_UNKNOWN"); }
  });
  return {
    login,
    listOrders: (venueId, serviceDate, cursor, limit = 20) => authorized(false, async () => {
      const query: string[] = [];
      if (serviceDate) query.push(`service_date=${encodeURIComponent(serviceDate)}`);
      query.push(`limit=${encodeURIComponent(String(limit))}`);
      if (cursor) query.push(`cursor=${encodeURIComponent(cursor)}`);
      const response = await transport.requestWithStatus<unknown>("GET", `${base(venueId)}?${query.join("&")}`, undefined, bearer());
      if (response.statusCode !== 200) throw new ApiResponseError("$.status");
      return decodeVenueFulfillmentPage(response.data);
    }),
    checkIn: (attempt) => postOrder(attempt, "check-in"),
    complete: (attempt) => postOrder(attempt, "complete"),
    refund: (attempt: RefundAttempt) => write(attempt, async (stable, headers) => {
      const refund = stable as RefundAttempt;
      const response = await transport.requestWithStatus<unknown>("POST", `${base(refund.venueId)}/${encodeURIComponent(refund.orderId)}/refund`, { reason_note: refund.reason }, headers);
      let decoded;
      try { decoded = decodeVenueRefundAccepted(response.data); } catch { throw new VenueFulfillmentApiError("FULFILLMENT_RESULT_UNKNOWN"); }
      if ((response.statusCode !== 200 && response.statusCode !== 202)
        || (response.statusCode === 200 && decoded.status !== "REFUNDED")
        || (response.statusCode === 202 && decoded.status !== "REFUND_PENDING")) {
        throw new VenueFulfillmentApiError("FULFILLMENT_RESULT_UNKNOWN");
      }
      return decoded;
    }),
  };
}
