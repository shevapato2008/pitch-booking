/// <reference types="node" />
import { expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";

import {
  decodeVenueFulfillmentOrder,
  decodeVenueFulfillmentPage,
  decodeVenueRefundAccepted,
} from "./venue-fulfillment";

const page = JSON.parse(readFileSync("contracts/examples/venue-fulfillment-orders.json", "utf8"));
const checkedIn = JSON.parse(readFileSync("contracts/examples/venue-order-checked-in.json", "utf8"));
const completed = JSON.parse(readFileSync("contracts/examples/venue-order-completed.json", "utf8"));

test("decodes the closed fulfillment page and every frozen action field", () => {
  expect(decodeVenueFulfillmentPage(page)).toMatchObject({
    venue: { id: page.venue.id, name: "浦东星跃足球公园" },
    serviceDate: "2026-07-28",
    orders: [{
      orderId: page.orders[0].id,
      maskedPhone: "138****5678",
      allowedActions: { canCheckIn: false, canComplete: false, canRefund: true, blockedReason: "CHECK_IN_TOO_EARLY" },
    }],
    nextCursor: null,
  });
  expect(decodeVenueFulfillmentOrder(checkedIn)).toMatchObject({ checkedInAt: checkedIn.checked_in_at });
  expect(decodeVenueFulfillmentOrder(completed)).toMatchObject({ status: "COMPLETED" });
});

test("rejects extra and private response fields at every boundary", () => {
  expect(() => decodeVenueFulfillmentPage({ ...page, private_note: "secret" })).toThrow(/private_note/);
  expect(() => decodeVenueFulfillmentPage({ ...page, venue: { ...page.venue, address: "private" } })).toThrow(/address/);
  expect(() => decodeVenueFulfillmentPage({ ...page, orders: [{ ...page.orders[0], contact_name: "secret" }] })).toThrow(/contact_name/);
  expect(() => decodeVenueFulfillmentPage({ ...page, orders: [{ ...page.orders[0], allowed_actions: { ...page.orders[0].allowed_actions, internal: true } }] })).toThrow(/internal/);
});

test("rejects unknown enum values, unmasked phones, and invalid pagination", () => {
  expect(() => decodeVenueFulfillmentPage({ ...page, orders: [{ ...page.orders[0], status: "NEW_STATUS" }] })).toThrow();
  expect(() => decodeVenueFulfillmentPage({ ...page, orders: [{ ...page.orders[0], masked_phone: "13812345678" }] })).toThrow();
  expect(() => decodeVenueFulfillmentPage({ ...page, orders: [{ ...page.orders[0], allowed_actions: { ...page.orders[0].allowed_actions, blocked_reason: "LOCAL_GUESS" } }] })).toThrow();
  expect(() => decodeVenueFulfillmentPage({ ...page, next_cursor: "" })).toThrow();
});

test("rejects venue-inapplicable owner actions and contradictory timestamps", () => {
  expect(() => decodeVenueFulfillmentOrder({ ...page.orders[0], allowed_actions: { ...page.orders[0].allowed_actions, can_pay: true } })).toThrow();
  expect(() => decodeVenueFulfillmentOrder({ ...page.orders[0], allowed_actions: { ...page.orders[0].allowed_actions, can_cancel: true } })).toThrow();
  expect(() => decodeVenueFulfillmentOrder({ ...page.orders[0], checked_in_at: checkedIn.checked_in_at, allowed_actions: { ...page.orders[0].allowed_actions, can_check_in: true } })).toThrow();
  expect(() => decodeVenueFulfillmentOrder({ ...completed, checked_in_at: null })).toThrow();
  expect(() => decodeVenueFulfillmentOrder({ ...page.orders[0], ends_at: page.orders[0].starts_at })).toThrow();
});

test("accepts simultaneous server-authoritative check-in and refund actions", () => {
  const decoded = decodeVenueFulfillmentOrder({
    ...page.orders[0],
    allowed_actions: { ...page.orders[0].allowed_actions, can_check_in: true, can_refund: true, blocked_reason: null },
  });
  expect(decoded.allowedActions).toMatchObject({ canCheckIn: true, canRefund: true });
});

test("decodes only the frozen refund acknowledgement", () => {
  const input = JSON.parse(readFileSync("contracts/examples/refund-accepted.json", "utf8"));
  expect(decodeVenueRefundAccepted(input)).toEqual({ orderId: input.order_id, status: "REFUND_PENDING" });
  expect(() => decodeVenueRefundAccepted({ ...input, provider: "wechat" })).toThrow(/provider/);
  expect(() => decodeVenueRefundAccepted({ ...input, status: "FAILED" })).toThrow();
});
