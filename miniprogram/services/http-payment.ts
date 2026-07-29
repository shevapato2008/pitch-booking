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
import type { StatusTransport, TransportError, WeChatIdentityCapability } from "../runtime/interfaces";
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
  readonly transport: PaymentTransport;
  readonly identity: WeChatIdentityCapability;
  readonly sessionStore: SessionStore;
}

export type PaymentTransport = StatusTransport;

interface HttpFailure {
  readonly statusCode: number;
  readonly decoded?: ReturnType<typeof decodeApiError>;
}

const CREATE_CONFLICT_CODES = new Set<ApiErrorCode>([
  "ORDER_EXPIRED",
  "PAYMENT_EXCEPTION",
  "IDEMPOTENCY_KEY_REUSED",
]);

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
        const response = await transport.requestWithStatus<unknown>(
          "POST",
          "/api/v1/auth/wechat/session",
          { code },
        );
        if (response.statusCode !== 200) throw new ApiResponseError("$.status");
        const session = decodeWeChatSession(response.data);
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

  const throwFinal = (
    caught: unknown,
    failure: HttpFailure | null,
    operation: "create" | "reconcile" | "get",
  ): never => {
    if (failure?.statusCode === 404) throw new PaymentApiError("ORDER_NOT_FOUND");
    if (failure?.statusCode === 401) {
      throw new PaymentApiError("AUTH_REQUIRED");
    }
    if (failure?.statusCode === 503 && operation === "create"
      && failure.decoded?.code === "PAYMENT_CREATE_FAILED") {
      throw new PaymentApiError("PAYMENT_CREATE_FAILED");
    }
    if (failure?.statusCode === 409 && operation === "create" && failure.decoded
      && CREATE_CONFLICT_CODES.has(failure.decoded.code)) {
      throw new PaymentApiError(failure.decoded.code);
    }
    if (failure && failure.statusCode < 500) throw new ApiResponseError("$.status");
    if (caught instanceof ApiResponseError || caught instanceof PaymentApiError) throw caught;
    throw new PaymentApiError("PAYMENT_RESULT_UNKNOWN");
  };

  const authorized = async <T>(
    operation: "create" | "reconcile" | "get",
    perform: () => Promise<T>,
  ): Promise<T> => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await perform();
      } catch (caught) {
        const failure = inspectHttpFailure(caught);
        const authRejected = failure?.statusCode === 401;
        if (authRejected && attempt === 0) {
          await exchangeSession();
          continue;
        }
        return throwFinal(caught, failure, operation);
      }
    }
    throw new Error("UNREACHABLE_AUTH_RETRY");
  };

  return {
    createPayment(orderId, idempotencyKey) {
      return authorized("create", async () => {
        const response = await transport.requestWithStatus<unknown>(
          "POST",
          `/api/v1/orders/${orderId}/pay`,
          undefined,
          { ...bearer(), "Idempotency-Key": idempotencyKey },
        );
        const decoded = decodePaymentLaunch(response.data);
        const valid = (response.statusCode === 200
            && (decoded.outcome === "PREPAY_CREATED" || decoded.outcome === "ALREADY_CONFIRMED"))
          || (response.statusCode === 201 && decoded.outcome === "PREPAY_CREATED")
          || (response.statusCode === 202 && decoded.outcome === "PAYMENT_CONFIRMING");
        if (!valid) throw new ApiResponseError("$.status");
        return decoded;
      });
    },
    reconcilePayment(orderId, paymentId) {
      return authorized("reconcile", async () => {
        const response = await transport.requestWithStatus<unknown>(
          "POST",
          `/api/v1/orders/${orderId}/payments/${paymentId}/reconcile`,
          undefined,
          bearer(),
        );
        const decoded = decodePaymentReconciliation(response.data);
        if ((response.statusCode === 200) !== (decoded.outcome === "TERMINAL")) {
          throw new ApiResponseError("$.status");
        }
        if (response.statusCode !== 200 && response.statusCode !== 202) {
          throw new ApiResponseError("$.status");
        }
        return decoded as Awaited<ReturnType<PaymentDataSource["reconcilePayment"]>>;
      });
    },
    getOrder(orderId) {
      return authorized("get", async () => {
        const response = await transport.requestWithStatus<unknown>(
          "GET",
          `/api/v1/orders/${orderId}`,
          undefined,
          bearer(),
        );
        if (response.statusCode !== 200) throw new ApiResponseError("$.status");
        return decodeOrder(response.data);
      });
    },
  };
}
