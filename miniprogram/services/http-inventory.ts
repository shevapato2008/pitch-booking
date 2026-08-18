import { ApiResponseError } from "../domain/contracts";
import { decodeInventoryError, decodeInventorySlot, decodeVenueInventory, type InventoryErrorCode } from "../domain/inventory";
import { decodeWeChatSession } from "../domain/decoders";
import type { Transport, TransportError, WeChatIdentityCapability } from "../runtime/interfaces";
import type { CreateInventorySlotAttempt, InventoryDataSource, UpdateInventorySlotAttempt } from "./inventory";
import type { SessionStore } from "./session-store";

export class InventoryApiError extends Error {
  constructor(readonly code: InventoryErrorCode | "LOGIN_FAILED" | "INVENTORY_RESULT_UNKNOWN", readonly details?: Record<string, unknown>) {
    super(code);
    this.name = "InventoryApiError";
  }
}

export function createHttpInventoryDataSource({ transport, identity, sessionStore }: {
  readonly transport: Transport;
  readonly identity: WeChatIdentityCapability; readonly sessionStore: SessionStore;
}): InventoryDataSource {
  let loginInFlight: Promise<void> | undefined;
  const bearer = () => {
    const session = sessionStore.load();
    if (!session) throw new InventoryApiError("AUTH_REQUIRED");
    return { Authorization: `Bearer ${session.token}` };
  };
  const failure = (caught: unknown) => {
    const error = caught as Partial<TransportError>;
    if (error.code !== "HTTP_ERROR" || typeof error.statusCode !== "number" || !("data" in error)) return null;
    if (error.statusCode === 401) sessionStore.clear();
    const decoded = decodeInventoryError(error.data);
    if (decoded.code === "AUTH_REQUIRED") sessionStore.clear();
    return { statusCode: error.statusCode, ...decoded };
  };
  const login = (): Promise<void> => {
    if (loginInFlight) return loginInFlight;
    const request = (async () => {
      try {
        const { code } = await identity.login();
        if (!code) throw new InventoryApiError("LOGIN_FAILED");
        const session = decodeWeChatSession(await transport.post("/api/v1/auth/wechat/session", { code }));
        sessionStore.save({ token: session.token, expiresAt: session.expiresAt });
      } catch (caught) {
        if (caught instanceof ApiResponseError || caught instanceof InventoryApiError) throw caught;
        throw new InventoryApiError("LOGIN_FAILED");
      }
    })();
    loginInFlight = request;
    void request.then(() => { if (loginInFlight === request) loginInFlight = undefined; }, () => { if (loginInFlight === request) loginInFlight = undefined; });
    return request;
  };
  const authorized = async <T>(write: boolean, perform: () => Promise<T>): Promise<T> => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try { return await perform(); }
      catch (caught) {
        let inspected: ReturnType<typeof failure>;
        try { inspected = failure(caught); } catch (decodeError) { if (write) throw new InventoryApiError("INVENTORY_RESULT_UNKNOWN"); throw decodeError; }
        if ((inspected?.code === "AUTH_REQUIRED" || (caught instanceof InventoryApiError && caught.code === "AUTH_REQUIRED")) && attempt === 0) {
          await login(); continue;
        }
        if (inspected) {
          if (write && inspected.statusCode >= 500) throw new InventoryApiError("INVENTORY_RESULT_UNKNOWN");
          throw new InventoryApiError(inspected.code, inspected.details);
        }
        if (write && (caught as Partial<TransportError>).code && !(caught instanceof ApiResponseError)) {
          throw new InventoryApiError("INVENTORY_RESULT_UNKNOWN");
        }
        throw caught;
      }
    }
    throw new Error("UNREACHABLE_AUTH_RETRY");
  };
  const headers = (key: string) => ({ ...bearer(), "Idempotency-Key": key });
  return {
    login,
    getDay: (venueId, pitchId, localDate) => authorized(false, async () => {
      const query = `${pitchId ? `pitch_id=${encodeURIComponent(pitchId)}&` : ""}local_date=${encodeURIComponent(localDate)}`;
      return decodeVenueInventory(await transport.get(`/api/v1/admin/venues/${encodeURIComponent(venueId)}/inventory?${query}`, bearer()));
    }),
    createSlot: (attempt: CreateInventorySlotAttempt) => authorized(true, async () => decodeInventorySlot(await transport.post(
      `/api/v1/admin/venues/${encodeURIComponent(attempt.venueId)}/inventory/slots`,
      { pitch_id: attempt.body.pitchId, local_date: attempt.body.localDate, start_time: attempt.body.startTime, end_time: attempt.body.endTime, price_cents: attempt.body.priceCents },
      headers(attempt.idempotencyKey),
    ))),
    updateSlot: (attempt: UpdateInventorySlotAttempt) => authorized(true, async () => decodeInventorySlot(await transport.put(
      `/api/v1/admin/venues/${encodeURIComponent(attempt.venueId)}/inventory/slots/${encodeURIComponent(attempt.slotId)}`,
      { expected_checkout_version: attempt.body.expectedCheckoutVersion, price_cents: attempt.body.priceCents, status: attempt.body.status },
      headers(attempt.idempotencyKey),
    ))),
  };
}
