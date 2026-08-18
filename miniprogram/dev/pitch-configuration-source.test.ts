import { expect, test } from "@jest/globals";
import { createDevelopmentPitchConfigurationDataSource } from "./pitch-configuration-source";

test("keeps mutable pitch configuration Fixture isolated in development", async () => {
  const source = createDevelopmentPitchConfigurationDataSource(); await source.login();
  const before = await source.get("00000000-0000-4000-8000-000000000010");
  const saved = await source.save({ venueId: before.venue.id, expectedVersion: before.configurationVersion, changes: [{ operation: "CREATE", clientRef: "draft-one", customName: "六人场", playersPerSide: 6 }], idempotencyKey: "development-fixture-key" });
  expect(saved.configurationVersion).toBe(before.configurationVersion + 1);
  expect(saved.createdPitchMappings).toEqual([expect.objectContaining({ clientRef: "draft-one" })]);
  expect(saved.pitches).toEqual(expect.arrayContaining([expect.objectContaining({ displayName: "六人场", playersPerSide: 6 })]));
});
