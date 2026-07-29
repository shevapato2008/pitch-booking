import type { ApiErrorCode } from "../domain/contracts";
import { ApiResponseError } from "../domain/contracts";
import {
  decodeApiError,
  decodeOrder,
  decodePaymentLaunch,
  decodePaymentReconciliation,
  decodeWeChatSession,
} from "../domain/decoders";
import type { PaymentDataSource } from "../domain/payment";
import type { Transport, TransportError, WeChatIdentityCapability } from "../runtime/interfaces";
import type { SessionStore } from "./session-store";

export type PaymentApiErrorCode =
  | ApiErrorCode
  | "LOGIN_FAILED"
  | "PAYMENT_RESULT_UNKNOWN";

export class PaymentApiError extends Error {
  constructor(readonly code: PaymentApiErrorCode) {
    super(code);
    this.name = "PaymentApiError";
  }
}

export interface HttpPaymentDataSourceOptions {
  readonly transport: Transport;
  readonly identity: WeChatIdentityCapability;
  readonly sessionStore: SessionStore;
}

interface HttpFailure {
  readonly statusCode: number;
  readonly decoded?: ReturnType<typeof decodeApiError>;
}

export function createHttpPaymentDataSource({
  transport,
  identity,
  sessionStore,
}: HttpPaymentDataSourceOptions): PaymentDataSource {
  let loginInFlight: Promise<void> | undefined;

  const bearer = (): Readonly<Record<string, string>> => {
    const stored = sessionStore.load();
    if (!stored) throw new PaymentApiError("AUTH_REQUIRED");
    return { Authorization: `Bearer ${stored.token}` };
  };

  const inspectHttpFailure = (caught: unknown): HttpFailure | null => {
    const transportError = caught as Partial<TransportError>;
    if (transportError.code !== "HTTP_ERROR" || typeof transportError.statusCode !== "number") return null;
    if (transportError.statusCode === 401) sessionStore.clear();
    try {
      const decoded = decodeApiError(transportError.data);
      if (decoded.code === "AUTH_REQUIRED") sessionStore.clear();
      return { statusCode: transportError.statusCode, decoded };
    } catch {
      return { statusCode: transportError.statusCode };
    }
  };

  const exchangeSession = (): Promise<void> => {
    if (loginInFlight) return loginInFlight;
    const exchange = (async () => {
      try {
        const { code } = await identity.login();
        if (!code) throw new PaymentApiError("LOGIN_FAILED");
        const session = decodeWeChatSession(await transport.post(
          "/api/v1/auth/wechat/session",
          { code },
        ));
        sessionStore.save({ token: session.token, expiresAt: session.expiresAt });
      } catch (caught) {
        if (caught instanceof ApiResponseError || caught instanceof PaymentApiError) throw caught;
        throw new PaymentApiError("LOGIN_FAILED");
      }
    })();
    loginInFlight = exchange;
    void exchange.then(
      () => { if (loginInFlight === exchange) loginInFlight = undefined; },
      () => { if (loginInFlight === exchange) loginInFlight = undefined; },
    );
    return exchange;
  };

  const throwFinal = (caught: unknown, failure: HttpFailure | null): never => {
    if (failure?.statusCode === 404) throw new PaymentApiError("ORDER_NOT_FOUND");
    if (failure?.statusCode === 401 || failure?.decoded?.code === "AUTH_REQUIRED") {
      throw new PaymentApiError("AUTH_REQUIRED");
    }
    if (failure?.decoded
      && (failure.statusCode < 500 || failure.decoded.code === "PAYMENT_CREATE_FAILED")) {
      throw new PaymentApiError(failure.decoded.code);
    }
    if (caught instanceof ApiResponseError || caught instanceof PaymentApiError) throw caught;
    throw new PaymentApiError("PAYMENT_RESULT_UNKNOWN");
  };

  const authorized = async <T>(perform: () => Promise<T>): Promise<T> => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await perform();
      } catch (caught) {
        const failure = inspectHttpFailure(caught);
        const authRejected = failure?.statusCode === 401
          || failure?.decoded?.code === "AUTH_REQUIRED"
          || (caught instanceof PaymentApiError && caught.code === "AUTH_REQUIRED");
        if (authRejected && attempt === 0) {
          await exchangeSession();
          continue;
        }
        return throwFinal(caught, failure);
      }
    }
    throw new Error("UNREACHABLE_AUTH_RETRY");
  };

  return {
    createPayment(orderId, idempotencyKey) {
      return authorized(async () => decodePaymentLaunch(await transport.post(
        `/api/v1/orders/${orderId}/pay`,
        undefined,
        { ...bearer(), "Idempotency-Key": idempotencyKey },
      )));
    },
    reconcilePayment(orderId, paymentId) {
      return authorized(async () => decodePaymentReconciliation(await transport.post(
        `/api/v1/orders/${orderId}/payments/${paymentId}/reconcile`,
        undefined,
        bearer(),
      )));
    },
    getOrder(orderId) {
      return authorized(async () => decodeOrder(await transport.get(
        `/api/v1/orders/${orderId}`,
        bearer(),
      )));
    },
  };
}
