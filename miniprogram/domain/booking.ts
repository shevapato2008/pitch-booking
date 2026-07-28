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

export interface OrderVenueView {
  readonly id: string;
  readonly name: string;
  readonly address: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly customerServicePhone: string;
}

export interface OrderPitchView {
  readonly id: string;
  readonly name: string;
}

export interface OrderContactView {
  readonly name: string;
  readonly maskedPhone: string;
}

interface OrderViewBase {
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

export interface PendingOrderView extends OrderViewBase {
  readonly status: "PENDING_PAYMENT";
  readonly expiredAt: null;
}

export interface ExpiredOrderView extends OrderViewBase {
  readonly status: "EXPIRED";
  readonly expiredAt: string;
}

export type OrderView = PendingOrderView | ExpiredOrderView;
