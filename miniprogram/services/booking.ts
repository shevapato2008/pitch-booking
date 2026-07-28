import type { CheckoutView, CreateOrderInput, OrderView, PendingOrderView, UserSessionView } from "../domain/booking";

export interface BookingDataSource {
  login(): Promise<UserSessionView>;
  getCheckout(slotId: string): Promise<CheckoutView>;
  authorizePhone(rawDetail: unknown): Promise<{ maskedPhone: string }>;
  createOrder(attempt: CreateOrderAttempt): Promise<PendingOrderView>;
  getOrder(orderId: string): Promise<OrderView>;
}

export interface CreateOrderAttempt {
  readonly request: CreateOrderInput;
  readonly idempotencyKey: string;
}

let configuredSource: BookingDataSource | undefined;
let neutralPhoneTapDetail: (() => unknown) | undefined;
export function registerBookingDataSource(source: BookingDataSource): void { configuredSource = source; }
export function registerNeutralPhoneTapCode(provider: () => unknown): void { neutralPhoneTapDetail = provider; }
export function getNeutralPhoneTapCode(): unknown { return neutralPhoneTapDetail?.(); }
export function resetBookingDataSourceForTesting(): void {
  configuredSource = undefined;
  neutralPhoneTapDetail = undefined;
}
export function getBookingDataSource(): BookingDataSource {
  if (!configuredSource) throw new Error("BOOKING_DATA_SOURCE_NOT_CONFIGURED");
  return configuredSource;
}
