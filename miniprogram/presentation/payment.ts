import type {
  ConfirmedOrderView,
  PaymentLaunchParams,
  PaymentOrderView,
  PaymentPendingOrderView,
} from "../domain/payment";

export type PaymentPageStatus =
  | "loading"
  | "load-error"
  | "ready"
  | "payment-pending"
  | "creating-prepay"
  | "cashier-open"
  | "payment-confirming"
  | "payment-exception"
  | "booking-confirmed";

interface LastOrderState {
  readonly order: PaymentOrderView | null;
}

interface PendingActionState {
  readonly order: PaymentPendingOrderView;
  readonly paymentId: string | null;
}

export type PaymentPageState =
  | ({ readonly status: "loading" } & LastOrderState)
  | ({ readonly status: "load-error"; readonly errorMessage: string } & LastOrderState)
  | ({ readonly status: "ready" } & PendingActionState & {
      readonly errorMessage: null;
    })
  | ({ readonly status: "payment-pending" } & PendingActionState & {
      readonly errorMessage: string | null;
    })
  | ({ readonly status: "creating-prepay"; readonly idempotencyKey: string } & PendingActionState)
  | ({
      readonly status: "cashier-open";
      readonly idempotencyKey: string;
      readonly paymentId: string;
      readonly launchParams: PaymentLaunchParams;
      readonly order: PaymentPendingOrderView;
    })
  | ({ readonly status: "payment-confirming" } & PendingActionState)
  | {
      readonly status: "payment-exception";
      readonly order: Extract<PaymentOrderView, { status: "PAYMENT_EXCEPTION" }>;
      readonly paymentId: string | null;
    }
  | {
      readonly status: "booking-confirmed";
      readonly order: ConfirmedOrderView;
      readonly paymentId: string | null;
    };

export type PaymentPageEvent =
  | { readonly type: "ORDER_LOADING" }
  | { readonly type: "ORDER_RECEIVED"; readonly order: PaymentOrderView }
  | { readonly type: "ORDER_FAILED"; readonly message: string }
  | { readonly type: "ORDER_LOAD_FAILED"; readonly message: string }
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
  if (order === null) return { status: "loading", order: null };
  if (order.status === "CONFIRMED") {
    return { status: "booking-confirmed", order, paymentId: null };
  }
  if (order.status === "PAYMENT_EXCEPTION") {
    return { status: "payment-exception", order, paymentId: null };
  }
  if (order.paymentConfirming) {
    return { status: "payment-confirming", order, paymentId: null };
  }
  return { status: "ready", order, paymentId: null, errorMessage: null };
}

function isCurrentCreate(
  state: PaymentPageState,
  idempotencyKey: string,
): state is Extract<PaymentPageState, { status: "creating-prepay" }> {
  return state.status === "creating-prepay" && state.idempotencyKey === idempotencyKey;
}

function isActivePaymentAction(
  state: PaymentPageState,
): state is Extract<PaymentPageState, { status: "creating-prepay" | "cashier-open" }> {
  return state.status === "creating-prepay" || state.status === "cashier-open";
}

export function reducePayment(state: PaymentPageState, event: PaymentPageEvent): PaymentPageState {
  switch (event.type) {
    case "ORDER_LOADING":
      if (isActivePaymentAction(state)) return state;
      return { status: "loading", order: state.order };
    case "ORDER_FAILED":
    case "ORDER_LOAD_FAILED":
      if (isActivePaymentAction(state)) return state;
      return { status: "load-error", order: state.order, errorMessage: event.message };
    case "ORDER_RECEIVED":
      if (event.order.status === "CONFIRMED") {
        return {
          status: "booking-confirmed",
          order: event.order,
          paymentId: "paymentId" in state ? state.paymentId : null,
        };
      }
      if (event.order.status === "PAYMENT_EXCEPTION") {
        return {
          status: "payment-exception",
          order: event.order,
          paymentId: "paymentId" in state ? state.paymentId : null,
        };
      }
      if (event.order.paymentConfirming) {
        return {
          status: "payment-confirming",
          order: event.order,
          paymentId: "paymentId" in state ? state.paymentId : null,
        };
      }
      if (isActivePaymentAction(state)) {
        return { ...state, order: event.order };
      }
      return {
        status: "payment-pending",
        order: event.order,
        paymentId: "paymentId" in state ? state.paymentId : null,
        errorMessage: state.status === "payment-pending" ? state.errorMessage : null,
      };
    case "PAY_STARTED":
      if (state.status !== "ready" && state.status !== "payment-pending") return state;
      return {
        status: "creating-prepay",
        order: state.order,
        idempotencyKey: event.idempotencyKey,
        paymentId: state.paymentId,
      };
    case "PREPAY_CREATED":
      if (!isCurrentCreate(state, event.idempotencyKey)) return state;
      return {
        status: "cashier-open",
        order: state.order,
        idempotencyKey: state.idempotencyKey,
        paymentId: event.paymentId,
        launchParams: event.launchParams,
      };
    case "PAYMENT_CONFIRMING":
      if (!isCurrentCreate(state, event.idempotencyKey)) return state;
      return {
        status: "payment-confirming",
        order: state.order,
        paymentId: event.paymentId,
      };
    case "PAY_CREATE_UNKNOWN":
    case "PAY_CREATE_RETRY":
      if (!isCurrentCreate(state, event.idempotencyKey)) return state;
      return state;
    case "PAY_CREATE_FAILED":
      if (!isCurrentCreate(state, event.idempotencyKey)) return state;
      return {
        status: "payment-pending",
        order: state.order,
        paymentId: state.paymentId,
        errorMessage: event.message,
      };
    case "CASHIER_CANCELLED":
      if (state.status !== "cashier-open") return state;
      return {
        status: "payment-pending",
        order: state.order,
        paymentId: state.paymentId,
        errorMessage: null,
      };
    case "CASHIER_FAILED":
      if (state.status !== "cashier-open") return state;
      return {
        status: "payment-pending",
        order: state.order,
        paymentId: state.paymentId,
        errorMessage: event.message,
      };
    case "CASHIER_SUCCEEDED":
      if (state.status !== "cashier-open") return state;
      return {
        status: "payment-confirming",
        order: state.order,
        paymentId: state.paymentId,
      };
  }
}
