import type {
  ConfirmedOrderView,
  OrderView,
  PaymentExceptionOrderView,
  PendingOrderView,
} from "./booking";

export type { ConfirmedOrderView, PaymentExceptionOrderView } from "./booking";

export interface PaymentLaunchParams {
  readonly timeStamp: string;
  readonly nonceStr: string;
  readonly package: string;
  readonly signType: "RSA";
  readonly paySign: string;
}

export type PaymentPendingOrderView = PendingOrderView;

export type PaymentOrderView = PaymentPendingOrderView | PaymentExceptionOrderView | ConfirmedOrderView;

export type PaymentLaunchResult =
  | {
      readonly outcome: "PREPAY_CREATED";
      readonly paymentId: string;
      readonly launchParams: PaymentLaunchParams;
    }
  | {
      readonly outcome: "PAYMENT_CONFIRMING";
      readonly paymentId: string;
      readonly order?: PaymentPendingOrderView | PaymentExceptionOrderView;
    }
  | { readonly outcome: "ALREADY_CONFIRMED"; readonly order: ConfirmedOrderView };

export type PaymentCapabilityResult =
  | { readonly outcome: "cashier_success" }
  | { readonly outcome: "user_cancelled" }
  | { readonly outcome: "launch_failed"; readonly message: string };

export interface PaymentDataSource {
  createPayment(orderId: string, idempotencyKey: string): Promise<PaymentLaunchResult>;
  reconcilePayment(orderId: string, paymentId: string): Promise<
    | {
        readonly outcome: "PAYMENT_CONFIRMING";
        readonly order: PaymentPendingOrderView | PaymentExceptionOrderView;
      }
    | { readonly outcome: "TERMINAL"; readonly order: OrderView }
  >;
  getOrder(orderId: string): Promise<OrderView>;
}

export interface PaymentCapability {
  readonly cashierNotice?: string;
  requestPayment(params: PaymentLaunchParams): Promise<PaymentCapabilityResult>;
}
