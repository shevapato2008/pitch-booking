import { expect, test } from "@jest/globals";

import {
  VENUE_INVENTORY_VISUAL_FIXTURE,
  resolveVenueInventoryVisualState,
} from "./venue-inventory-fixture";

test.each([
  "day-ready",
  "create-slot-open",
  "edit-slot-open",
  "save-result-unknown",
  "create-slot-overlap",
] as const)("accepts the approved visual state %s", (state) => {
  expect(resolveVenueInventoryVisualState(state)).toBe(state);
});

test.each([undefined, null, "", "saving", 11, {}, []])(
  "falls back to day-ready for invalid visual query %#",
  (state) => {
    expect(resolveVenueInventoryVisualState(state)).toBe("day-ready");
  },
);

test("freezes the approved venue, week, pitch, and slot presentation", () => {
  const fixture = VENUE_INVENTORY_VISUAL_FIXTURE;

  expect(fixture.venueName).toBe("渤海元丰足球场");
  expect(fixture.venueNote).toBe("库存工作台 · 仅授权工作人员");
  expect(fixture.monthLabel).toBe("2026年8月");
  expect(fixture.days.map(({ weekday, day, selected }) => ({ weekday, day, selected }))).toEqual([
    { weekday: "一", day: "10", selected: false },
    { weekday: "二", day: "11", selected: true },
    { weekday: "三", day: "12", selected: false },
    { weekday: "四", day: "13", selected: false },
    { weekday: "五", day: "14", selected: false },
    { weekday: "六", day: "15", selected: false },
    { weekday: "日", day: "16", selected: false },
  ]);
  expect(fixture.pitches.map(({ id, label, selected }) => ({ id, label, selected }))).toEqual([
    { id: "pitch-7", label: "7人场", selected: true },
    { id: "pitch-5", label: "5人场", selected: false },
  ]);
  expect(fixture.slots.map(({ id, time, priceYuan, status, statusLabel, editable }) => ({
    id, time, priceYuan, status, statusLabel, editable,
  }))).toEqual([
    { id: "slot-1400", time: "14:00–16:00", priceYuan: 260, status: "AVAILABLE", statusLabel: "开放", editable: true },
    { id: "slot-1600", time: "16:00–18:00", priceYuan: 280, status: "AVAILABLE", statusLabel: "开放", editable: true },
    { id: "slot-1800", time: "18:00–20:00", priceYuan: 320, status: "LOCKED", statusLabel: "锁定", editable: false },
    { id: "slot-2000", time: "20:00–22:00", priceYuan: 360, status: "CLOSED", statusLabel: "已关闭", editable: true },
    { id: "slot-2200", time: "22:00–23:00", priceYuan: 220, status: "BOOKED", statusLabel: "已售出", editable: false },
  ]);
  expect(fixture.createDraft).toEqual({ start: "09:30", end: "11:00", priceYuan: 200 });
  expect(fixture.deletionCondition).toBe("delete after real inventory backend integration");
  expect(Object.isFrozen(fixture)).toBe(true);
  expect(Object.isFrozen(fixture.days)).toBe(true);
  expect(Object.isFrozen(fixture.slots)).toBe(true);
  expect(fixture.days.every(Object.isFrozen)).toBe(true);
  expect(fixture.slots.every(Object.isFrozen)).toBe(true);
});
