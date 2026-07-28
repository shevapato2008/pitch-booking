import type { PendingOrderView } from "./booking";

export interface PaymentLaunchParams {
  readonly timeStamp: string;
  readonly nonceStr: string;
  readonly package: string;
  readonly signType: "RSA";
  readonly paySign: string;
}

export interface PaymentPendingOrderView extends PendingOrderView {
  readonly paymentState: null | "CREATING" | "PREPAY_CREATED" | "CONFIRMING" | "UNKNOWN" | "CLOSED";
  readonly paymentConfirming: boolean;
  readonly paidAt: null;
}

export interface ConfirmedOrderView extends Omit<PendingOrderView, "status"> {
  readonly status: "CONFIRMED";
  readonly paymentState: "SUCCESS";
  readonly paymentConfirming: false;
  readonly paidAt: string;
}

export type PaymentOrderView = PaymentPendingOrderView | ConfirmedOrderView;

export type PaymentLaunchResult =
  | {
      readonly outcome: "PREPAY_CREATED";
      readonly paymentId: string;
      readonly launchParams: PaymentLaunchParams;
    }
  | { readonly outcome: "PAYMENT_CONFIRMING"; readonly paymentId: string }
  | { readonly outcome: "ALREADY_CONFIRMED"; readonly order: ConfirmedOrderView };

export type PaymentCapabilityResult =
  | { readonly outcome: "cashier_success" }
  | { readonly outcome: "user_cancelled" }
  | { readonly outcome: "launch_failed"; readonly message: string };

export interface PaymentDataSource {
  createPayment(orderId: string, idempotencyKey: string): Promise<PaymentLaunchResult>;
  reconcilePayment(orderId: string, paymentId: string): Promise<
    | { readonly outcome: "PAYMENT_CONFIRMING"; readonly order: PaymentPendingOrderView }
    | { readonly outcome: "TERMINAL"; readonly order: PaymentOrderView }
  >;
  getOrder(orderId: string): Promise<PaymentOrderView>;
}

export interface PaymentCapability {
  requestPayment(params: PaymentLaunchParams): Promise<PaymentCapabilityResult>;
}
