import {
  VENUE_ACCESS_ONBOARDING_FIXTURES,
  type VenueAccessPreviewCase,
} from "../../venue-onboarding-fixture";
import { readIntentHeaderLayout } from "../../../presentation/intent-header-layout";

interface VenueAccessOptions {
  case?: unknown;
}

interface VenueChooseEvent {
  currentTarget?: {
    dataset?: {
      venueId?: unknown;
    };
  };
}

Page({
  data: {
    previewCase: "empty" as VenueAccessPreviewCase,
    ...VENUE_ACCESS_ONBOARDING_FIXTURES.empty,
    headerTopPx: 0,
    headerRowHeightPx: 44,
    headerRightInsetPx: 0,
  },

  onLoad(options: VenueAccessOptions = {}) {
    const previewCase: VenueAccessPreviewCase = options.case === "one"
      ? "one"
      : options.case === "multiple" ? "multiple" : "empty";
    const headerLayout = readIntentHeaderLayout();
    this.setData({
      previewCase,
      ...VENUE_ACCESS_ONBOARDING_FIXTURES[previewCase],
      headerTopPx: headerLayout.topPx,
      headerRowHeightPx: headerLayout.rowHeightPx,
      headerRightInsetPx: headerLayout.rightInsetPx,
    });
  },

  onChooseVenue(event: VenueChooseEvent) {
    const venueId = event.currentTarget?.dataset?.venueId;
    if (typeof venueId !== "string") return;
    const isFixtureVenue = Object.values(VENUE_ACCESS_ONBOARDING_FIXTURES)
      .some(({ venues }) => venues.some(({ id }) => id === venueId));
    if (!isFixtureVenue) return;
    wx.navigateTo({ url: `/dev/pages/venue-profile/index?state=ready&venue_id=${encodeURIComponent(venueId)}` });
  },

  onOpenClaim() {
    wx.navigateTo({ url: "/dev/pages/venue-claim/index?case=selected" });
  },

  onOpenCreate() {
    wx.navigateTo({ url: "/dev/pages/venue-create/index?case=ready" });
  },

  onBackToEntry() {
    wx.reLaunch({ url: "/dev/pages/intent-entry/index" });
  },
});
