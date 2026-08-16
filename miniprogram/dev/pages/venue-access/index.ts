import {
  VENUE_ACCESS_VISUAL_FIXTURES,
  type VenueAccessPreviewCase,
} from "../../venue-access-fixture";
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
    ...VENUE_ACCESS_VISUAL_FIXTURES.empty,
    headerTopPx: 0,
    headerRowHeightPx: 44,
    headerRightInsetPx: 0,
  },

  onLoad(options: VenueAccessOptions = {}) {
    const previewCase: VenueAccessPreviewCase = options.case === "multiple" ? "multiple" : "empty";
    const headerLayout = readIntentHeaderLayout();
    this.setData({
      previewCase,
      ...VENUE_ACCESS_VISUAL_FIXTURES[previewCase],
      headerTopPx: headerLayout.topPx,
      headerRowHeightPx: headerLayout.rowHeightPx,
      headerRightInsetPx: headerLayout.rightInsetPx,
    });
  },

  onChooseVenue(event: VenueChooseEvent) {
    const venueId = event.currentTarget?.dataset?.venueId;
    const isFixtureVenue = VENUE_ACCESS_VISUAL_FIXTURES.multiple.venues.some(({ id }) => id === venueId);
    if (!isFixtureVenue) return;
    wx.navigateTo({ url: "/dev/pages/venue-profile/index?state=ready" });
  },

  onBackToEntry() {
    wx.reLaunch({ url: "/dev/pages/intent-entry/index" });
  },
});
