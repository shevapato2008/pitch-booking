import type {
  CheckoutView,
  CreateOrderInput,
  OrderListView,
  OrderView,
  PendingOrderView,
  UserSessionView,
} from "../domain/booking";
import type { CreateOrderAttemptStore } from "./create-order-attempt-store";

export interface BookingDataSource {
  login(): Promise<UserSessionView>;
  getCheckout(slotId: string): Promise<CheckoutView>;
  authorizePhone(rawDetail: unknown): Promise<{ maskedPhone: string }>;
  createOrder(attempt: CreateOrderAttempt): Promise<PendingOrderView>;
  getOrder(orderId: string): Promise<OrderView>;
  listOrders?(cursor?: string, limit?: number): Promise<OrderListView>;
}

export interface OrderListBookingDataSource extends BookingDataSource {
  listOrders(cursor?: string, limit?: number): Promise<OrderListView>;
}

export interface CreateOrderAttempt {
  readonly request: CreateOrderInput;
  readonly idempotencyKey: string;
}

let configuredSource: BookingDataSource | undefined;
let configuredCreateOrderAttemptStore: CreateOrderAttemptStore | undefined;
let neutralPhoneTapDetail: (() => unknown) | undefined;
export function registerBookingDataSource(source: BookingDataSource): void { configuredSource = source; }
export function registerCreateOrderAttemptStore(store: CreateOrderAttemptStore): void { configuredCreateOrderAttemptStore = store; }
export function getCreateOrderAttemptStore(): CreateOrderAttemptStore | undefined { return configuredCreateOrderAttemptStore; }
export function registerNeutralPhoneTapCode(provider: () => unknown): void { neutralPhoneTapDetail = provider; }
export function getNeutralPhoneTapCode(): unknown { return neutralPhoneTapDetail?.(); }
export function resetBookingDataSourceForTesting(): void {
  configuredSource = undefined;
  configuredCreateOrderAttemptStore = undefined;
  neutralPhoneTapDetail = undefined;
}
export function getBookingDataSource(): BookingDataSource {
  if (!configuredSource) throw new Error("BOOKING_DATA_SOURCE_NOT_CONFIGURED");
  return configuredSource;
}
