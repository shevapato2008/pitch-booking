import {
  buildPublishedVenueProfile,
  facilityLabels,
  type VenueProfile,
  type VenueProfileImage,
} from "../../fixtures/venue-profile";
import { readIntentHeaderLayout } from "../../intent-header-layout";
import {
  VENUE_ACCESS_ONBOARDING_FIXTURES,
  type VenuePortfolioPreviewVenue,
} from "../../venue-onboarding-fixture";

interface SetupOptions { venue_id?: unknown }

const portfolioVenues = VENUE_ACCESS_ONBOARDING_FIXTURES.multiple.venues;
const defaultPortfolioVenue = portfolioVenues[0];

function resolvePortfolioVenue(value: unknown): VenuePortfolioPreviewVenue {
  return typeof value === "string" ? portfolioVenues.find(({ id }) => id === value) ?? defaultPortfolioVenue : defaultPortfolioVenue;
}

function publishedProfileForVenue(venue: VenuePortfolioPreviewVenue): VenueProfile {
  const profile = buildPublishedVenueProfile();
  if (profile.venueId === venue.id) return profile;
  return {
    ...profile,
    venueId: venue.id,
    name: venue.name,
    description: `${venue.location}的场馆公开资料 Fixture。公开资料仅展示已通过整版审核的内容。`,
    images: profile.images.map((image, index) => ({
      ...image,
      alt: index === 0 ? `${venue.name}主场全景` : `${venue.name}场馆照片`,
    })),
  };
}

const profile = publishedProfileForVenue(defaultPortfolioVenue);
const initialImage = profile.images.find(({ cover }) => cover) ?? profile.images[0];

Page({
  data: {
    profile,
    facilityLabels: facilityLabels(profile.facilities),
    selectedImageId: initialImage.id,
    selectedImage: initialImage,
    headerTopPx: 0,
    headerRowHeightPx: 44,
    headerRightInsetPx: 0,
  },

  onLoad(options: SetupOptions = {}) {
    const layout = readIntentHeaderLayout();
    const published = publishedProfileForVenue(resolvePortfolioVenue(options.venue_id));
    const selectedImage = published.images.find(({ cover }) => cover) ?? published.images[0];
    this.setData({
      profile: published,
      facilityLabels: facilityLabels(published.facilities),
      selectedImageId: selectedImage.id,
      selectedImage,
      headerTopPx: layout.topPx,
      headerRowHeightPx: layout.rowHeightPx,
      headerRightInsetPx: layout.rightInsetPx,
    });
  },

  onSelectGallery(event: { currentTarget?: { dataset?: { imageId?: unknown } } }) {
    const imageId = event.currentTarget?.dataset?.imageId;
    const selectedImage = this.data.profile.images.find(({ id }: VenueProfileImage) => id === imageId);
    if (selectedImage) this.setData({ selectedImageId: selectedImage.id, selectedImage });
  },

  onViewAvailability() {
    wx.navigateTo({ url: `/pages/availability/index?venueId=${encodeURIComponent(this.data.profile.venueId)}` });
  },

  onBack() { wx.navigateBack(); },
});
