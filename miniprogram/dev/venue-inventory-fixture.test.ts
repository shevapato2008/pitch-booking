import { expect, test } from "@jest/globals";

import {
  INVENTORY_STATE_IDS,
  VENUE_INVENTORY_VISUAL_FIXTURE,
  buildVenueInventoryView,
  resolveVenueInventoryVisualState,
} from "./venue-inventory-fixture";

const states = [
  "initial-loading", "load-error", "day-empty", "day-ready", "pitch-picker-open",
  "pitch-refreshing", "pitch-load-error", "calendar-open", "date-refreshing",
  "date-load-error", "cross-week-ready", "long-list-end", "create-slot-open",
  "edit-slot-open", "save-in-progress", "save-result-unknown", "create-slot-overlap",
  "concurrent-change", "permission-expired",
] as const;

test("accepts all approved inventory v2 states", () => {
  expect(INVENTORY_STATE_IDS).toEqual(states);
  for (const state of states) expect(resolveVenueInventoryVisualState(state)).toBe(state);
  expect(resolveVenueInventoryVisualState("legacy-state")).toBe("day-ready");
});

test("freezes physical-pitch identity, selection, date window, and canonical slots", () => {
  const fixture = VENUE_INVENTORY_VISUAL_FIXTURE;
  expect(fixture.venue).toEqual({ id: "venue-bohai-yuanfeng", name: "渤海元丰足球场" });
  expect(fixture.defaultSelection).toEqual({ pitchId: "pitch-7-001", localDate: "2026-08-11", requestSequence: 1 });
  expect(fixture.dateWindow).toEqual({ start: "2026-08-10", end: "2026-08-23" });
  expect(fixture.pitchGroups.flatMap(({ pitches }) => pitches).map(({ id }) => id)).toEqual([
    "pitch-5-001", "pitch-5-002", "pitch-7-001", "pitch-7-002", "pitch-7-003",
  ]);
  expect(fixture.slots.map(({ status }) => status)).toEqual(["AVAILABLE", "AVAILABLE", "LOCKED", "CLOSED", "BOOKED"]);
  expect(Object.isFrozen(fixture)).toBe(true);
  expect(Object.isFrozen(fixture.pitchGroups)).toBe(true);
  expect(Object.isFrozen(fixture.slots)).toBe(true);
});

test("derives truthful loading, empty, picker, and cross-week views", () => {
  expect(buildVenueInventoryView("initial-loading").mode).toBe("initial-loading");
  expect(buildVenueInventoryView("load-error").recoveryNextState).toBe("day-ready");
  expect(buildVenueInventoryView("day-empty").slotCount).toBe(0);
  expect(buildVenueInventoryView("pitch-picker-open").sheet?.kind).toBe("pitch-picker");
  expect(buildVenueInventoryView("calendar-open").sheet?.kind).toBe("calendar");
  const crossWeek = buildVenueInventoryView("cross-week-ready");
  expect(crossWeek.selectedDate).toBe("2026-08-23");
  expect(crossWeek.week.map(({ day }) => day)).toEqual([17, 18, 19, 20, 21, 22, 23]);
});

test("preserves complementary selection while pitch or date refreshes", () => {
  const pitch = buildVenueInventoryView("pitch-refreshing");
  expect(pitch.selectedPitch?.id).toBe("pitch-5-001");
  expect(pitch.selectedDate).toBe("2026-08-11");
  expect(pitch.requestSequence).toBe(2);
  const date = buildVenueInventoryView("date-refreshing");
  expect(date.selectedPitch?.id).toBe("pitch-7-001");
  expect(date.selectedDate).toBe("2026-08-23");
  expect(date.requestSequence).toBe(2);
});

test("keeps editor drafts visible across save and authority errors", () => {
  for (const state of ["create-slot-open", "save-in-progress", "save-result-unknown", "create-slot-overlap", "concurrent-change"] as const) {
    expect(buildVenueInventoryView(state).editor?.draft).toEqual({ start: "09:30", end: "11:00", price: "260" });
  }
  expect(buildVenueInventoryView("save-in-progress").duplicateSaveDisabled).toBe(true);
  expect(buildVenueInventoryView("permission-expired").pageAction.disabled).toBe(true);
});
