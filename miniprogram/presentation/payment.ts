import type {
  PaymentLaunchParams,
  PaymentOrderView,
} from "../domain/payment";

export type PaymentPageStatus =
  | "loading"
  | "load-error"
  | "ready"
  | "payment-pending"
  | "creating-prepay"
  | "cashier-open"
  | "payment-confirming"
  | "booking-confirmed";

export interface PaymentPageState {
  readonly status: PaymentPageStatus;
  readonly order: PaymentOrderView | null;
  readonly idempotencyKey: string | null;
  readonly paymentId: string | null;
  readonly launchParams: PaymentLaunchParams | null;
  readonly errorMessage: string | null;
}

export type PaymentPageEvent =
  | { readonly type: "ORDER_LOADING" }
  | { readonly type: "ORDER_RECEIVED"; readonly order: PaymentOrderView }
  | { readonly type: "ORDER_FAILED"; readonly message: string }
  | { readonly type: "PAY_STARTED"; readonly idempotencyKey: string }
  | {
      readonly type: "PREPAY_CREATED";
      readonly idempotencyKey: string;
      readonly paymentId: string;
      readonly launchParams: PaymentLaunchParams;
    }
  | { readonly type: "PAYMENT_CONFIRMING"; readonly idempotencyKey: string; readonly paymentId: string }
  | { readonly type: "PAY_CREATE_UNKNOWN"; readonly idempotencyKey: string }
  | { readonly type: "PAY_CREATE_RETRY"; readonly idempotencyKey: string }
  | { readonly type: "PAY_CREATE_FAILED"; readonly idempotencyKey: string; readonly message: string }
  | { readonly type: "CASHIER_CANCELLED" }
  | { readonly type: "CASHIER_SUCCEEDED" }
  | { readonly type: "CASHIER_FAILED"; readonly message: string };

export function initialPaymentPageState(order: PaymentOrderView | null = null): PaymentPageState {
  return {
    status: order === null ? "loading" : order.status === "CONFIRMED" ? "booking-confirmed" : "ready",
    order,
    idempotencyKey: null,
    paymentId: null,
    launchParams: null,
    errorMessage: null,
  };
}

function isCurrentCreate(state: PaymentPageState, idempotencyKey: string): boolean {
  return state.status === "creating-prepay" && state.idempotencyKey === idempotencyKey;
}

export function reducePayment(state: PaymentPageState, event: PaymentPageEvent): PaymentPageState {
  switch (event.type) {
    case "ORDER_LOADING":
      return { ...state, status: "loading", errorMessage: null };
    case "ORDER_FAILED":
      return { ...state, status: "load-error", errorMessage: event.message };
    case "ORDER_RECEIVED":
      if (event.order.status === "CONFIRMED") {
        return {
          ...state,
          status: "booking-confirmed",
          order: event.order,
          idempotencyKey: null,
          launchParams: null,
          errorMessage: null,
        };
      }
      return {
        ...state,
        status: event.order.paymentConfirming ? "payment-confirming" : "payment-pending",
        order: event.order,
        errorMessage: null,
      };
    case "PAY_STARTED":
      if (state.status !== "ready" && state.status !== "payment-pending") return state;
      return {
        ...state,
        status: "creating-prepay",
        idempotencyKey: event.idempotencyKey,
        launchParams: null,
        errorMessage: null,
      };
    case "PREPAY_CREATED":
      if (!isCurrentCreate(state, event.idempotencyKey)) return state;
      return {
        ...state,
        status: "cashier-open",
        paymentId: event.paymentId,
        launchParams: event.launchParams,
        errorMessage: null,
      };
    case "PAYMENT_CONFIRMING":
      if (!isCurrentCreate(state, event.idempotencyKey)) return state;
      return {
        ...state,
        status: "payment-confirming",
        paymentId: event.paymentId,
        launchParams: null,
        errorMessage: null,
      };
    case "PAY_CREATE_UNKNOWN":
    case "PAY_CREATE_RETRY":
      if (!isCurrentCreate(state, event.idempotencyKey)) return state;
      return state;
    case "PAY_CREATE_FAILED":
      if (!isCurrentCreate(state, event.idempotencyKey)) return state;
      return {
        ...state,
        status: "payment-pending",
        idempotencyKey: null,
        launchParams: null,
        errorMessage: event.message,
      };
    case "CASHIER_CANCELLED":
      if (state.status !== "cashier-open") return state;
      return {
        ...state,
        status: "payment-pending",
        idempotencyKey: null,
        launchParams: null,
        errorMessage: null,
      };
    case "CASHIER_FAILED":
      if (state.status !== "cashier-open") return state;
      return {
        ...state,
        status: "payment-pending",
        idempotencyKey: null,
        launchParams: null,
        errorMessage: event.message,
      };
    case "CASHIER_SUCCEEDED":
      if (state.status !== "cashier-open") return state;
      return {
        ...state,
        status: "payment-confirming",
        idempotencyKey: null,
        launchParams: null,
        errorMessage: null,
      };
  }
}
