import type { VenueFulfillmentOrder, VenueFulfillmentPage, VenueRefundAccepted } from "../domain/venue-fulfillment";

export interface CheckInAttempt {
  readonly kind: "checkIn";
  readonly venueId: string;
  readonly orderId: string;
  readonly idempotencyKey: string;
}
export interface CompleteAttempt {
  readonly kind: "complete";
  readonly venueId: string;
  readonly orderId: string;
  readonly idempotencyKey: string;
}
export interface RefundAttempt {
  readonly kind: "refund";
  readonly venueId: string;
  readonly orderId: string;
  readonly reason: string;
  readonly idempotencyKey: string;
}
export type VenueFulfillmentMutationAttempt = CheckInAttempt | CompleteAttempt | RefundAttempt;

export interface VenueFulfillmentDataSource {
  login(): Promise<void>;
  listOrders(venueId: string, serviceDate?: string, cursor?: string, limit?: number): Promise<VenueFulfillmentPage>;
  checkIn(attempt: CheckInAttempt): Promise<VenueFulfillmentOrder>;
  complete(attempt: CompleteAttempt): Promise<VenueFulfillmentOrder>;
  refund(attempt: RefundAttempt): Promise<VenueRefundAccepted>;
}

let configured: VenueFulfillmentDataSource | undefined;
export function registerVenueFulfillmentDataSource(source: VenueFulfillmentDataSource): void { configured = source; }
export function getVenueFulfillmentDataSource(): VenueFulfillmentDataSource {
  if (!configured) throw new Error("VENUE_FULFILLMENT_DATA_SOURCE_NOT_CONFIGURED");
  return configured;
}
export function resetVenueFulfillmentBindingsForTesting(): void { configured = undefined; }
