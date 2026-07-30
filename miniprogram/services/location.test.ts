import { expect, test } from "@jest/globals";

import { getLocationCapability, registerLocationCapability } from "./location";

test("registers the narrow location capability without caching coordinates", async () => {
  let calls = 0;
  registerLocationCapability({
    async getLocation() { calls += 1; return { coordinateSystem: "GCJ02", latitude: 39, longitude: 117 }; },
    async openSetting() {},
  });
  await expect(getLocationCapability().getLocation()).resolves.toMatchObject({ latitude: 39 });
  await expect(getLocationCapability().getLocation()).resolves.toMatchObject({ longitude: 117 });
  expect(calls).toBe(2);
});
