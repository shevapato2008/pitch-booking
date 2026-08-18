import { expect, test } from "@jest/globals";

import { decodePitchConfiguration } from "./pitch-configuration";

export const configurationResponse = {
  venue: { id: "00000000-0000-4000-8000-000000000010", name: "渤海元丰足球场", timezone: "Asia/Shanghai" },
  configuration_version: 3,
  pitches: [{
    id: "00000000-0000-4000-8000-000000000020", custom_name: "A场", system_name: "7人场 · 1号场",
    display_name: "A场", players_per_side: 7, sequence: 1, status: "ACTIVE",
    capabilities: {
      edit_format: { allowed: false, reason: "PITCH_FORMAT_IMMUTABLE" },
      delete: { allowed: false, reason: "PITCH_HAS_BUSINESS_HISTORY" },
      deactivate: { allowed: true, reason: null }, reactivate: { allowed: false, reason: "PITCH_ALREADY_ACTIVE" },
      future_blockers: { AVAILABLE: 0, LOCKED: 0, BOOKED: 0 },
    },
  }],
  created_pitch_mappings: [],
};

test("strictly decodes the authoritative pitch configuration", () => {
  expect(decodePitchConfiguration(configurationResponse)).toMatchObject({
    venue: { id: configurationResponse.venue.id, name: "渤海元丰足球场" }, configurationVersion: 3,
    pitches: [{ id: configurationResponse.pitches[0].id, customName: "A场", playersPerSide: 7, status: "ACTIVE" }],
  });
});

test("rejects unknown fields and invalid player counts", () => {
  expect(() => decodePitchConfiguration({ ...configurationResponse, preview: true })).toThrow();
  expect(() => decodePitchConfiguration({ ...configurationResponse, pitches: [{ ...configurationResponse.pitches[0], players_per_side: 0 }] })).toThrow();
});
