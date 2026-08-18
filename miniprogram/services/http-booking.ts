import { ApiResponseError, type ApiErrorCode } from "../domain/contracts";
import {
  decodeApiError,
  decodeCheckout,
  decodeOrder,
  decodeOrderList,
  decodePhoneVerification,
  decodeWeChatSession,
} from "../domain/decoders";
import type { Transport, TransportError, WeChatIdentityCapability, WeChatPhoneCapability } from "../runtime/interfaces";
import type { CreateOrderAttempt, OrderListBookingDataSource } from "./booking";
import type { SessionStore } from "./session-store";

export class BookingApiError extends Error {
  constructor(
    readonly code: ApiErrorCode | "LOGIN_FAILED" | "PHONE_CAPABILITY_UNAVAILABLE" | "PHONE_REJECTED" | "SUBMISSION_RESULT_UNKNOWN",
    readonly details?: ReturnType<typeof decodeApiError>["details"],
  ) {
    super(code);
    this.name = "BookingApiError";
  }
}

export interface HttpBookingDataSourceOptions {
  readonly transport: Transport;
  readonly identity: WeChatIdentityCapability;
  readonly phone: WeChatPhoneCapability;
  readonly sessionStore: SessionStore;
}

export function createHttpBookingDataSource({
  transport,
  identity,
  phone,
  sessionStore,
}: HttpBookingDataSourceOptions): OrderListBookingDataSource {
  type Operation = "login" | "phone" | "read" | "create";
  interface HttpFailure {
    readonly statusCode: number;
    readonly decoded?: ReturnType<typeof decodeApiError>;
    readonly decodeError?: unknown;
  }

  let loginInFlight: Promise<ReturnType<typeof decodeWeChatSession>["user"]> | undefined;

  const bearer = (): Readonly<Record<string, string>> => {
    const session = sessionStore.load();
    if (!session) throw new BookingApiError("AUTH_REQUIRED");
    return { Authorization: `Bearer ${session.token}` };
  };

  const inspectHttpFailure = (caught: unknown): HttpFailure | null => {
    const transportError = caught as Partial<TransportError>;
    if (transportError.code !== "HTTP_ERROR" || !("data" in transportError)
      || typeof transportError.statusCode !== "number") return null;
    if (transportError.statusCode === 401) sessionStore.clear();
    try {
      const decoded = decodeApiError(transportError.data);
      if (decoded.code === "AUTH_REQUIRED") sessionStore.clear();
      return { statusCode: transportError.statusCode, decoded };
    } catch (decodeError) {
      return { statusCode: transportError.statusCode, decodeError };
    }
  };

  const throwFinal = (caught: unknown, operation: Operation, failure?: HttpFailure | null): never => {
    if (operation === "create") {
      if (failure?.decoded && failure.statusCode >= 400 && failure.statusCode < 500) {
        throw new BookingApiError(failure.decoded.code, failure.decoded.details);
      }
      throw new BookingApiError("SUBMISSION_RESULT_UNKNOWN");
    }
    if (failure?.decodeError) throw failure.decodeError;
    if (failure?.decoded) {
      const decoded = failure.decoded;
      if (operation === "login" && decoded.code === "WECHAT_LOGIN_FAILED") throw new BookingApiError("LOGIN_FAILED");
      if (operation === "phone" && decoded.code === "PHONE_AUTH_UNAVAILABLE") throw new BookingApiError("PHONE_CAPABILITY_UNAVAILABLE");
      if (operation === "phone" && decoded.code === "PHONE_AUTH_FAILED") throw new BookingApiError("PHONE_REJECTED");
      throw new BookingApiError(decoded.code, decoded.details);
    }
    if (caught instanceof ApiResponseError || caught instanceof BookingApiError) throw caught;
    throw caught;
  };

  const exchangeSession = (): Promise<ReturnType<typeof decodeWeChatSession>["user"]> => {
    if (loginInFlight) return loginInFlight;
    const exchange = (async () => {
      try {
        const result = await identity.login();
        if (!result.code) throw new BookingApiError("LOGIN_FAILED");
        const session = decodeWeChatSession(await transport.post("/api/v1/auth/wechat/session", { code: result.code }));
        sessionStore.save({ token: session.token, expiresAt: session.expiresAt });
        return session.user;
      } catch (caught) {
        const failure = inspectHttpFailure(caught);
        return throwFinal(caught, "login", failure);
      }
    })();
    loginInFlight = exchange;
    void exchange.then(
      () => { if (loginInFlight === exchange) loginInFlight = undefined; },
      () => { if (loginInFlight === exchange) loginInFlight = undefined; },
    );
    return exchange;
  };

  const authorized = async <T>(operation: Exclude<Operation, "login">, perform: () => Promise<T>): Promise<T> => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await perform();
      } catch (caught) {
        const failure = inspectHttpFailure(caught);
        const authRejected = (failure?.decoded !== undefined
          && (failure.statusCode === 401 || failure.decoded.code === "AUTH_REQUIRED"))
          || (caught instanceof BookingApiError && caught.code === "AUTH_REQUIRED");
        if (authRejected && attempt === 0) {
          await exchangeSession();
          continue;
        }
        return throwFinal(caught, operation, failure);
      }
    }
    throw new Error("UNREACHABLE_AUTH_RETRY");
  };

  return {
    async login() {
      return exchangeSession();
    },
    async getCheckout(slotId) {
      return authorized("read", async () => {
        return decodeCheckout(await transport.get(`/api/v1/slots/${slotId}/checkout`, bearer()));
      });
    },
    async authorizePhone(rawDetail) {
      return authorized("phone", async () => {
        const { code } = phone.normalizeEvent(rawDetail);
        const verifiedPhone = decodePhoneVerification(await transport.post("/api/v1/auth/wechat/phone", { code }, bearer()));
        return { maskedPhone: verifiedPhone.maskedPhone };
      });
    },
    async createOrder({ request, idempotencyKey }: CreateOrderAttempt) {
      const body = {
        slot_id: request.slotId,
        checkout_version: request.checkoutVersion,
        contact_name: request.contactName,
      };
      return authorized("create", async () => {
        const order = decodeOrder(await transport.post("/api/v1/orders", body, {
          ...bearer(),
          "Idempotency-Key": idempotencyKey,
        }));
        if (order.status !== "PENDING_PAYMENT") throw new ApiResponseError("$.status");
        return order;
      });
    },
    async getOrder(orderId) {
      return authorized("read", async () => {
        return decodeOrder(await transport.get(`/api/v1/orders/${orderId}`, bearer()));
      });
    },
    async listOrders(cursor, limit = 20) {
      const cursorQuery = cursor === undefined ? "" : `&cursor=${encodeURIComponent(cursor)}`;
      return authorized("read", async () => decodeOrderList(
        await transport.get(`/api/v1/orders?limit=${limit}${cursorQuery}`, bearer()),
      ));
    },
  };
}
