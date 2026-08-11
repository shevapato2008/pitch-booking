import { describe, expect, test } from "@jest/globals";

import { decodeInventorySlot, decodeVenueInventory } from "./inventory";

const slot = {
  id: "00000000-0000-4000-8000-000000000030",
  pitch_id: "00000000-0000-4000-8000-000000000020",
  starts_at: "2026-08-11T14:00:00+08:00",
  ends_at: "2026-08-11T16:00:00+08:00",
  start_time: "14:00",
  end_time: "16:00",
  price_cents: 26000,
  status: "AVAILABLE",
  checkout_version: 12,
  editable: true,
  read_only_reason: null,
};

const inventory = {
  venue: { id: "00000000-0000-4000-8000-000000000010", name: "渤海元丰足球场", timezone: "Asia/Shanghai" },
  local_date: "2026-08-11",
  availability_window: { start_date: "2026-08-10", end_date: "2026-08-23" },
  pitches: [{
    id: "00000000-0000-4000-8000-000000000020",
    name: "七人制 A 场",
    display_name: "A场",
    pitch_type: "SEVEN_A_SIDE",
    players_per_side: 7,
  }],
  selected_pitch_id: "00000000-0000-4000-8000-000000000020",
  slots: [slot],
  generated_at: "2026-08-11T06:00:00Z",
};

describe("admin inventory decoders", () => {
  test("strictly decodes the authoritative day and slot", () => {
    expect(decodeVenueInventory(inventory)).toMatchObject({
      venue: { name: "渤海元丰足球场", timezone: "Asia/Shanghai" },
      localDate: "2026-08-11",
      selectedPitchId: inventory.selected_pitch_id,
      pitches: [{ displayName: "A场", playersPerSide: 7 }],
      slots: [{ startTime: "14:00", endTime: "16:00", priceCents: 26000, checkoutVersion: 12 }],
    });
    expect(decodeInventorySlot(slot).editable).toBe(true);
  });

  test.each([
    { ...inventory, unexpected: true },
    { ...inventory, venue: { ...inventory.venue, timezone: "UTC" } },
    { ...inventory, selected_pitch_id: "00000000-0000-4000-8000-000000000099" },
    { ...inventory, slots: [{ ...slot, start_time: "14:15" }] },
    { ...inventory, slots: [{ ...slot, editable: true, status: "BOOKED" }] },
  ])("rejects malformed or contradictory inventory %#", (value) => {
    expect(() => decodeVenueInventory(value)).toThrow(expect.objectContaining({ code: "INVALID_API_RESPONSE" }));
  });
});
