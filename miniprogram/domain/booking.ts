export interface UserSessionView {
  readonly userId: string;
  readonly maskedPhone: string | null;
}

export interface CheckoutView {
  readonly venueId: string;
  readonly venueName: string;
  readonly pitchId: string;
  readonly pitchName: string;
  readonly slotId: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly priceCents: number;
  readonly date: string;
  readonly durationMinutes: number;
  readonly currency: "CNY";
  readonly available: true;
  readonly cancellationSummary: string;
  readonly lockDurationSeconds: number;
  readonly maskedPhone: string | null;
  readonly lastContactName: string | null;
  readonly version: number;
}

export interface CreateOrderInput {
  readonly slotId: string;
  readonly checkoutVersion: number;
  readonly contactName: string;
}

export type LifecycleTerminalOrderStatus =
  | "CANCELLED"
  | "REFUND_PENDING"
  | "REFUND_FAILED"
  | "REFUNDED"
  | "COMPLETED";

export type OrderSummaryStatus =
  | "PENDING_PAYMENT"
  | "CONFIRMED"
  | "EXPIRED"
  | "PAYMENT_EXCEPTION"
  | LifecycleTerminalOrderStatus;

export type OrderActionBlockedReason =
  | "PAYMENT_RESULT_PENDING"
  | "CANCELLATION_WINDOW_CLOSED"
  | "REFUND_IN_PROGRESS"
  | "CHECK_IN_TOO_EARLY"
  | "CHECK_IN_REQUIRED"
  | "SESSION_NOT_ENDED"
  | "ORDER_TERMINAL"
  | "CANCELLATION_REQUIRES_SUPPORT";

export interface AllowedOrderActions {
  readonly canPay: boolean;
  readonly canCancel: boolean;
  readonly canCheckIn: boolean;
  readonly canComplete: boolean;
  readonly canRefund: boolean;
  readonly blockedReason: OrderActionBlockedReason | null;
}

export interface FundingAlert {
  readonly code: "DUPLICATE_CHARGE_REFUND";
  readonly status: "REFUND_PENDING" | "REFUND_FAILED" | "REFUNDED";
}

interface OwnerLifecycleProjection {
  readonly cancelRequestedAt?: string | null;
  readonly cancelledAt?: string | null;
  readonly checkedInAt?: string | null;
  readonly completedAt?: string | null;
  readonly allowedActions?: AllowedOrderActions;
  readonly fundingAlerts?: readonly FundingAlert[];
}

export interface OrderSummaryView extends OwnerLifecycleProjection {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly status: OrderSummaryStatus;
  readonly venue: { readonly id: string; readonly name: string };
  readonly pitch: { readonly id: string; readonly name: string };
  readonly startsAt: string;
  readonly endsAt: string;
  readonly priceCents: number;
  readonly currency: "CNY";
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly paymentConfirming: boolean;
  readonly closingPayment: boolean;
}

export interface OrderListView {
  readonly orders: readonly OrderSummaryView[];
  readonly nextCursor: string | null;
}

export interface OrderVenueView {
  readonly id: string;
  readonly name: string;
  readonly address: string;
  readonly latitude: number;
  readonly longitude: number;
}

export interface OrderPitchView {
  readonly id: string;
  readonly name: string;
}

export interface OrderContactView {
  readonly name: string;
  readonly maskedPhone: string;
}

interface OrderViewBase extends OwnerLifecycleProjection {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly slotId: string;
  readonly venue: OrderVenueView;
  readonly pitch: OrderPitchView;
  readonly contact: OrderContactView;
  readonly priceCents: number;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly durationMinutes: number;
  readonly currency: "CNY";
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly cancellationSummary: string;
  readonly closingPayment: boolean;
  readonly detailPath: string;
}

export type PaymentState =
  | "CREATING"
  | "PREPAY_CREATED"
  | "CONFIRMING"
  | "SUCCESS"
  | "CLOSED"
  | "UNKNOWN";

export interface PendingOrderView extends OrderViewBase {
  readonly status: "PENDING_PAYMENT";
  readonly expiredAt: null;
  readonly paymentState?: null | Exclude<PaymentState, "SUCCESS">;
  readonly paymentConfirming?: boolean;
  readonly paidAt?: null;
}

export interface ExpiredOrderView extends OrderViewBase {
  readonly status: "EXPIRED";
  readonly expiredAt: string;
  readonly paymentState?: null | Exclude<PaymentState, "SUCCESS">;
  readonly paymentConfirming?: boolean;
  readonly paidAt?: null;
}

export type ConfirmedOrderView = OrderViewBase & {
  readonly status: "CONFIRMED";
  readonly expiredAt: null;
  readonly paymentConfirming: false;
  readonly closingPayment: false;
} & (
  | { readonly paymentState: "SUCCESS"; readonly paidAt: string }
  | { readonly paymentState: null; readonly paidAt: null }
);

export type PaymentExceptionOrderView =
  | (OrderViewBase & {
      readonly status: "PAYMENT_EXCEPTION";
      readonly expiredAt: null;
      readonly paymentState: "UNKNOWN";
      readonly paymentConfirming: false;
      readonly paidAt: null;
    })
  | (OrderViewBase & {
      readonly status: "PAYMENT_EXCEPTION";
      readonly expiredAt: null;
      readonly paymentState: "SUCCESS";
      readonly paymentConfirming: false;
      readonly paidAt: string;
    })
  | (OrderViewBase & {
      readonly status: "PAYMENT_EXCEPTION";
      readonly expiredAt: null;
      readonly paymentState: null;
      readonly paymentConfirming: false;
      readonly paidAt: null;
    });

type RefundLifecycleOrderView = {
  [Status in "REFUND_PENDING" | "REFUND_FAILED" | "REFUNDED"]: OrderViewBase & {
    readonly status: Status;
    readonly expiredAt: null;
    readonly paymentState: null | "SUCCESS";
    readonly paymentConfirming: false;
    readonly paidAt: string | null;
  };
}["REFUND_PENDING" | "REFUND_FAILED" | "REFUNDED"];

export type LifecycleTerminalOrderView =
  | (OrderViewBase & {
      readonly status: "CANCELLED";
      readonly expiredAt: null;
      readonly paymentState: null | "CLOSED";
      readonly paymentConfirming: false;
      readonly paidAt: null;
    })
  | RefundLifecycleOrderView
  | (OrderViewBase & {
      readonly status: "COMPLETED";
      readonly expiredAt: null;
      readonly paymentConfirming: false;
    } & (
      | { readonly paymentState: "SUCCESS"; readonly paidAt: string }
      | { readonly paymentState: null; readonly paidAt: null }
    ));

export type OrderView =
  | PendingOrderView
  | ExpiredOrderView
  | ConfirmedOrderView
  | PaymentExceptionOrderView
  | LifecycleTerminalOrderView;
