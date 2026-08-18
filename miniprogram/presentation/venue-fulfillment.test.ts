/// <reference types="node" />
import { expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";

import { decodeVenueFulfillmentPage } from "../domain/venue-fulfillment";
import { presentVenueFulfillmentOrder, presentVenueServiceDates, shiftServiceDate } from "./venue-fulfillment";

const decoded = decodeVenueFulfillmentPage(JSON.parse(readFileSync("contracts/examples/venue-fulfillment-orders.json", "utf8")));

test("presents dates from the server service date without local eligibility", () => {
  expect(shiftServiceDate("2026-03-01", -1)).toBe("2026-02-28");
  expect(shiftServiceDate("2024-03-01", -1)).toBe("2024-02-29");
  expect(presentVenueServiceDates(decoded.serviceDate)).toEqual([
    expect.objectContaining({ serviceDate: "2026-07-27", selected: false }),
    expect.objectContaining({ serviceDate: "2026-07-28", selected: true, weekday: "今天" }),
    expect.objectContaining({ serviceDate: "2026-07-29", selected: false }),
  ]);
});

test("maps only server statuses, actions, and blocked reasons to Chinese copy", () => {
  const view = presentVenueFulfillmentOrder(decoded.orders[0]);
  expect(view).toMatchObject({
    orderId: decoded.orders[0].orderId,
    number: "PB202607270001",
    pitch: "五人制 A 场",
    phone: "138****5678",
    statusLabel: "待履约",
    blockedReason: "距离签到时间尚早",
    canCheckIn: false,
    canComplete: false,
    canRefund: true,
  });
});

test("server allowed_actions can render more than one real action", () => {
  const order = { ...decoded.orders[0], allowedActions: { ...decoded.orders[0].allowedActions, canCheckIn: true, canRefund: true, blockedReason: null } };
  expect(presentVenueFulfillmentOrder(order)).toMatchObject({ canCheckIn: true, canRefund: true, blockedReason: "" });
});

test("unknown presentation values are not guessed", () => {
  expect(() => presentVenueFulfillmentOrder({ ...decoded.orders[0], status: "FUTURE" as never })).toThrow();
});
