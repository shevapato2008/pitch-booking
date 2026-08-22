/// <reference types="node" />
import { expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";

import { decodeVenueFulfillmentPage } from "../domain/venue-fulfillment";
import { presentVenueFulfillmentOrder, presentVenueServiceDates, shiftServiceDate } from "./venue-fulfillment";

const decoded = decodeVenueFulfillmentPage(JSON.parse(readFileSync("contracts/examples/venue-fulfillment-orders.json", "utf8")));

test("presents a fifteen-day date-strip window centered on the server service date", () => {
  expect(shiftServiceDate("2026-03-01", -1)).toBe("2026-02-28");
  expect(shiftServiceDate("2024-03-01", -1)).toBe("2024-02-29");
  const dates = presentVenueServiceDates("2026-08-31");

  expect(dates).toHaveLength(15);
  expect(dates[0]).toEqual({ date: "2026-08-24", weekdayLabel: "周一", monthDayLabel: "8月24日" });
  expect(dates[7]).toEqual({ date: "2026-08-31", weekdayLabel: "周一", monthDayLabel: "8月31日" });
  expect(dates[8]).toEqual({ date: "2026-09-01", weekdayLabel: "周二", monthDayLabel: "9月1日" });
  expect(dates[14]).toEqual({ date: "2026-09-07", weekdayLabel: "周一", monthDayLabel: "9月7日" });
  expect(dates.every((date) => Object.keys(date).sort().join(",") === "date,monthDayLabel,weekdayLabel")).toBe(true);
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
