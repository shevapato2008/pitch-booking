import { describe, expect, test } from "@jest/globals";

import { decodeVenueRecruitmentInvitation } from "./venue-recruitment-invitation";

const venue = {
  venue_id: "20000000-0000-4000-8000-000000000002",
  name: "天津海河东体育中心足球场",
  district_name: "河东区",
  address: "天津市河东区津塘路156号院内东侧",
};

describe("venue recruitment invitation decoder", () => {
  test.each([
    ["AVAILABLE", null],
    ["CLAIMED_BY_VIEWER", null],
    ["SUBMITTED_BY_VIEWER", "30000000-0000-4000-8000-000000000003"],
  ] as const)("accepts the closed %s projection", (viewerState, applicationId) => {
    expect(decodeVenueRecruitmentInvitation({
      viewer_state: viewerState,
      venue,
      expires_at: "2026-09-08T13:18:00Z",
      application_id: applicationId,
      version: 2,
    })).toMatchObject({
      viewerState,
      applicationId,
      venue: { venueId: venue.venue_id, districtName: "河东区" },
    });
  });

  test("rejects unknown fields and invalid state/application combinations", () => {
    expect(() => decodeVenueRecruitmentInvitation({
      viewer_state: "AVAILABLE",
      venue,
      expires_at: "2026-09-08T13:18:00Z",
      application_id: null,
      version: 1,
      token: "secret",
    })).toThrow();
    expect(() => decodeVenueRecruitmentInvitation({
      viewer_state: "SUBMITTED_BY_VIEWER",
      venue,
      expires_at: "2026-09-08T13:18:00Z",
      application_id: null,
      version: 1,
    })).toThrow();
  });
});
