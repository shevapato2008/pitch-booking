import {
  arrayAt,
  dateAt,
  enumAt,
  exactObject,
  invalid,
  rfc3339At,
  rfc3339Before,
  stringAt,
  uuidAt,
} from "./decoder-primitives";

export const VENUE_FULFILLMENT_ORDER_STATUSES = [
  "PENDING_PAYMENT", "CONFIRMED", "EXPIRED", "PAYMENT_EXCEPTION", "CANCELLED",
  "REFUND_PENDING", "REFUND_FAILED", "REFUNDED", "COMPLETED",
] as const;
export type VenueFulfillmentOrderStatus = typeof VENUE_FULFILLMENT_ORDER_STATUSES[number];

export const VENUE_FULFILLMENT_BLOCKED_REASONS = [
  "PAYMENT_RESULT_PENDING", "CANCELLATION_WINDOW_CLOSED", "REFUND_IN_PROGRESS",
  "CHECK_IN_TOO_EARLY", "CHECK_IN_REQUIRED", "SESSION_NOT_ENDED", "ORDER_TERMINAL",
  "CANCELLATION_REQUIRES_SUPPORT",
] as const;
export type VenueFulfillmentBlockedReason = typeof VENUE_FULFILLMENT_BLOCKED_REASONS[number];

export interface VenueFulfillmentAllowedActions {
  readonly canPay: false;
  readonly canCancel: false;
  readonly canCheckIn: boolean;
  readonly canComplete: boolean;
  readonly canRefund: boolean;
  readonly blockedReason: VenueFulfillmentBlockedReason | null;
}

export interface VenueFulfillmentOrder {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly status: VenueFulfillmentOrderStatus;
  readonly pitch: { readonly id: string; readonly name: string };
  readonly startsAt: string;
  readonly endsAt: string;
  readonly maskedPhone: string;
  readonly checkedInAt: string | null;
  readonly allowedActions: VenueFulfillmentAllowedActions;
}

export interface VenueFulfillmentPage {
  readonly venue: { readonly id: string; readonly name: string };
  readonly serviceDate: string;
  readonly generatedAt: string;
  readonly orders: readonly VenueFulfillmentOrder[];
  readonly nextCursor: string | null;
}

export interface VenueRefundAccepted {
  readonly orderId: string;
  readonly status: "REFUND_PENDING" | "REFUNDED";
}

function booleanAt(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") invalid(path);
  return value;
}

function nullableRfc3339(value: unknown, path: string): string | null {
  return value === null ? null : rfc3339At(value, path);
}

function decodeIdentity(value: unknown, path: string): { readonly id: string; readonly name: string } {
  const object = exactObject(value, ["id", "name"], path);
  return { id: uuidAt(object.id, `${path}.id`), name: stringAt(object.name, `${path}.name`) };
}

function decodeAllowedActions(value: unknown, path: string): VenueFulfillmentAllowedActions {
  const object = exactObject(value, [
    "can_pay", "can_cancel", "can_check_in", "can_complete", "can_refund", "blocked_reason",
  ], path);
  const canPay = booleanAt(object.can_pay, `${path}.can_pay`);
  const canCancel = booleanAt(object.can_cancel, `${path}.can_cancel`);
  if (canPay) invalid(`${path}.can_pay`);
  if (canCancel) invalid(`${path}.can_cancel`);
  return {
    canPay: false,
    canCancel: false,
    canCheckIn: booleanAt(object.can_check_in, `${path}.can_check_in`),
    canComplete: booleanAt(object.can_complete, `${path}.can_complete`),
    canRefund: booleanAt(object.can_refund, `${path}.can_refund`),
    blockedReason: object.blocked_reason === null ? null : enumAt(
      object.blocked_reason, VENUE_FULFILLMENT_BLOCKED_REASONS, `${path}.blocked_reason`,
    ),
  };
}

export function decodeVenueFulfillmentOrder(value: unknown, path = "$"): VenueFulfillmentOrder {
  const object = exactObject(value, [
    "id", "order_number", "status", "pitch", "starts_at", "ends_at",
    "masked_phone", "checked_in_at", "allowed_actions",
  ], path);
  const startsAt = rfc3339At(object.starts_at, `${path}.starts_at`);
  const endsAt = rfc3339At(object.ends_at, `${path}.ends_at`);
  if (!rfc3339Before(startsAt, endsAt)) invalid(`${path}.ends_at`);
  const status = enumAt(object.status, VENUE_FULFILLMENT_ORDER_STATUSES, `${path}.status`);
  const checkedInAt = nullableRfc3339(object.checked_in_at, `${path}.checked_in_at`);
  const allowedActions = decodeAllowedActions(object.allowed_actions, `${path}.allowed_actions`);
  if (allowedActions.canCheckIn && checkedInAt !== null) invalid(`${path}.allowed_actions.can_check_in`);
  if (allowedActions.canComplete && checkedInAt === null) invalid(`${path}.allowed_actions.can_complete`);
  if (status === "COMPLETED" && checkedInAt === null) invalid(`${path}.checked_in_at`);
  const maskedPhone = stringAt(object.masked_phone, `${path}.masked_phone`);
  if (!/^1[0-9]{2}\*{4}[0-9]{4}$/.test(maskedPhone)) invalid(`${path}.masked_phone`);
  return {
    orderId: uuidAt(object.id, `${path}.id`),
    orderNumber: stringAt(object.order_number, `${path}.order_number`),
    status,
    pitch: decodeIdentity(object.pitch, `${path}.pitch`),
    startsAt,
    endsAt,
    maskedPhone,
    checkedInAt,
    allowedActions,
  };
}

export function decodeVenueFulfillmentPage(value: unknown): VenueFulfillmentPage {
  const object = exactObject(value, ["venue", "service_date", "generated_at", "orders", "next_cursor"], "$");
  return {
    venue: decodeIdentity(object.venue, "$.venue"),
    serviceDate: dateAt(object.service_date, "$.service_date"),
    generatedAt: rfc3339At(object.generated_at, "$.generated_at"),
    orders: arrayAt(object.orders, "$.orders").map((item, index) => decodeVenueFulfillmentOrder(item, `$.orders[${index}]`)),
    nextCursor: object.next_cursor === null ? null : stringAt(object.next_cursor, "$.next_cursor"),
  };
}

export function decodeVenueRefundAccepted(value: unknown): VenueRefundAccepted {
  const object = exactObject(value, ["order_id", "status"], "$");
  return {
    orderId: uuidAt(object.order_id, "$.order_id"),
    status: enumAt(object.status, ["REFUND_PENDING", "REFUNDED"] as const, "$.status"),
  };
}
