import { describe, expect, test } from "@jest/globals";

import { decodeManagedVenuesResponse } from "./venue-access";

const venue = {
  id: "00000000-0000-4000-8000-000000000010",
  name: "渤海元丰足球场",
  district_name: "西青区",
  address: "天津市西青区利达路",
};

describe("managed venue response decoder", () => {
  test("decodes the closed response into camel-case managed venues", () => {
    expect(decodeManagedVenuesResponse({ venues: [venue] })).toEqual([{
      id: venue.id,
      name: venue.name,
      districtName: venue.district_name,
      address: venue.address,
    }]);
    expect(decodeManagedVenuesResponse({ venues: [] })).toEqual([]);
  });

  test.each([
    ["an extra response field", { venues: [], extra: true }],
    ["an extra venue field", { venues: [{ ...venue, extra: true }] }],
    ["an invalid UUID", { venues: [{ ...venue, id: "venue-1" }] }],
    ["an empty name", { venues: [{ ...venue, name: "" }] }],
    ["an empty district", { venues: [{ ...venue, district_name: "" }] }],
    ["an empty address", { venues: [{ ...venue, address: "" }] }],
  ])("rejects %s", (_label, value) => {
    expect(() => decodeManagedVenuesResponse(value)).toThrow(expect.objectContaining({
      code: "INVALID_API_RESPONSE",
    }));
  });
});
