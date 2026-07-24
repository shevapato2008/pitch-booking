import { expect, test } from "@jest/globals";

import type { Availability, PitchGroup, Slot, SlotStatus } from "../domain/contracts";
import {
  buildAvailabilityDates,
  formatPriceCents,
  formatTimeRange,
  toAvailabilityViewModel,
  toggleSelectedSlot,
} from "./availability";

const baseSlot: Slot = {
  id: "slot-a",
  startsAt: "2026-07-22T09:00:00+08:00",
  endsAt: "2026-07-22T10:30:00+08:00",
  priceCents: 36000,
  status: "AVAILABLE",
  unavailableReason: null,
};

const statuses: Array<[SlotStatus, string, string]> = [
  ["EXPIRED", "已结束", "slot--expired"],
  ["AVAILABLE", "可订", "slot--available"],
  ["TEMPORARILY_LOCKED", "暂时锁定", "slot--temporarily-locked"],
  ["BOOKED", "已预订", "slot--booked"],
  ["CLOSED", "未开放", "slot--closed"],
];

const makePitchGroup = (overrides: Partial<PitchGroup> = {}): PitchGroup => ({
  id: "pitch-five",
  name: "五人制 A 场",
  pitchType: "FIVE_A_SIDE",
  sortOrder: 0,
  slots: statuses.map(([status], index) => ({
    ...baseSlot,
    id: `slot-${index}`,
    status,
    unavailableReason: status === "AVAILABLE" ? null : "TIME_PASSED",
  })),
  ...overrides,
});

const availability: Availability = {
  venueId: "venue-1",
  timezone: "Asia/Shanghai",
  date: "2026-07-22",
  pitchType: "FIVE_A_SIDE",
  availabilityWindow: { startDate: "2026-07-22", endDate: "2026-07-24" },
  pitchGroups: [
    makePitchGroup({ id: "pitch-later", name: "五人制 B 场", sortOrder: 2 }),
    makePitchGroup({
      id: "pitch-seven",
      name: "七人制 A 场",
      pitchType: "SEVEN_A_SIDE",
      sortOrder: 0,
    }),
    makePitchGroup({ id: "pitch-first", sortOrder: 1 }),
  ],
  generatedAt: "2026-07-22T08:00:00+08:00",
};

test("maps all Fixture statuses to Chinese labels and semantic classes", () => {
  const slots = toAvailabilityViewModel(availability, null).pitchGroups[0].slots;

  expect(slots.map(({ status, statusLabel, className }) => ({ status, statusLabel, className })))
    .toEqual(statuses.map(([status, statusLabel, className]) => ({ status, statusLabel, className })));
  expect(slots.map((slot) => slot.isSelectable)).toEqual([false, true, false, false, false]);
});

test("formats integer cents as yuan and ISO times as a compact range", () => {
  expect(formatPriceCents(36000)).toBe("¥360");
  expect(formatPriceCents(36050)).toBe("¥360.50");
  expect(formatPriceCents(5)).toBe("¥0.05");
  expect(formatTimeRange(baseSlot.startsAt, baseSlot.endsAt)).toBe("09:00–10:30");
});

test("filters and sorts physical pitches by the selected Fixture pitch type without mutation", () => {
  const original = JSON.stringify(availability);

  const view = toAvailabilityViewModel(availability, null);

  expect(view.pitchType).toBe("FIVE_A_SIDE");
  expect(view.pitchGroups.map((pitch) => pitch.id)).toEqual(["pitch-first", "pitch-later"]);
  expect(JSON.stringify(availability)).toBe(original);
});

test("marks availability empty when every matching pitch group has no slots", () => {
  const emptyAvailability: Availability = {
    ...availability,
    pitchGroups: [makePitchGroup({ slots: [] })],
  };

  expect(toAvailabilityViewModel(emptyAvailability, null).isEmpty).toBe(true);
});

test("sorts slots by their real start time", () => {
  const slotAt = (id: string, hour: string): Slot => ({
    ...baseSlot,
    id,
    startsAt: `2026-07-22T${hour}:00:00+08:00`,
    endsAt: `2026-07-22T${hour}:30:00+08:00`,
  });
  const unsortedAvailability: Availability = {
    ...availability,
    pitchGroups: [makePitchGroup({
      slots: [slotAt("slot-noon", "12"), slotAt("slot-morning", "09"), slotAt("slot-mid", "10")],
    })],
  };

  expect(toAvailabilityViewModel(unsortedAvailability, null).pitchGroups[0].slots.map((slot) => slot.id))
    .toEqual(["slot-morning", "slot-mid", "slot-noon"]);
});

test("builds an inclusive serializable date range from the availability window", () => {
  expect(buildAvailabilityDates(availability.availabilityWindow)).toEqual([
    { date: "2026-07-22", monthDayLabel: "7月22日", weekdayLabel: "周三" },
    { date: "2026-07-23", monthDayLabel: "7月23日", weekdayLabel: "周四" },
    { date: "2026-07-24", monthDayLabel: "7月24日", weekdayLabel: "周五" },
  ]);
});

test("keeps selection single and ignores unavailable slot taps", () => {
  expect(toggleSelectedSlot(null, "slot-a", "AVAILABLE")).toBe("slot-a");
  expect(toggleSelectedSlot("slot-a", "slot-a", "AVAILABLE")).toBeNull();
  expect(toggleSelectedSlot("slot-a", "slot-b", "AVAILABLE")).toBe("slot-b");
  expect(toggleSelectedSlot("slot-a", "slot-c", "BOOKED")).toBe("slot-a");
});

test("renders local selection without replacing the AVAILABLE Fixture enum", () => {
  const view = toAvailabilityViewModel(availability, "slot-1");
  const selected = view.pitchGroups[0].slots[1];

  expect(selected).toMatchObject({
    id: "slot-1",
    status: "AVAILABLE",
    statusLabel: "已选择",
    className: "slot--selected",
    isSelected: true,
    isSelectable: true,
  });
});
