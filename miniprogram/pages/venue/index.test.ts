/* eslint-disable @typescript-eslint/no-explicit-any -- dynamic Mini Program Page harness */
import { beforeEach, expect, jest, test } from "@jest/globals";

import { createDevelopmentVenueDirectoryDataSource, VENUE_DIRECTORY_VISUAL_FIXTURE } from "../../dev/venue-directory-source";
import { registerVenueDirectoryDataSource } from "../../services/venue-directory";

let definition: Record<string, any> | undefined;
function page() {
  if (!definition) {
    (globalThis as any).Page = (value: Record<string, any>) => { definition = value; };
    jest.requireActual("./index");
  }
  return { ...definition, data: { ...definition!.data }, setData(patch: Record<string, unknown>) { Object.assign(this.data, patch); } } as any;
}

beforeEach(() => {
  registerVenueDirectoryDataSource(createDevelopmentVenueDirectoryDataSource("ready"));
  (globalThis as any).wx = { navigateTo: jest.fn() };
});

test("renders a known directory detail without an availability action", async () => {
  const target = page();
  await target.onLoad({ venueId: VENUE_DIRECTORY_VISUAL_FIXTURE[1].id });

  expect(target.data.venue).toMatchObject({ bookingMode: "DIRECTORY_ONLY", bookingStatusText: "暂未接入在线预订" });
  expect(target.data.canBook).toBe(false);
});

test("opens the map focused on the current venue", async () => {
  const target = page();
  target.data.venue = { id: VENUE_DIRECTORY_VISUAL_FIXTURE[4].id };
  target.onViewOnMap();

  expect((globalThis as any).wx.navigateTo).toHaveBeenCalledWith({
    url: `/pages/venue-map/index?venueId=${VENUE_DIRECTORY_VISUAL_FIXTURE[4].id}`,
  });
});
