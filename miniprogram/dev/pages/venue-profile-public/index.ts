import { buildPublishedVenueProfile, facilityLabels, type VenueProfileImage } from "../../fixtures/venue-profile";
import { readIntentHeaderLayout } from "../../intent-header-layout";

const profile = buildPublishedVenueProfile();
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

  onLoad() {
    const layout = readIntentHeaderLayout();
    const published = buildPublishedVenueProfile();
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
    wx.navigateTo({ url: "/pages/availability/index?venue_id=venue-bohai-yuanfeng" });
  },

  onBack() { wx.navigateBack(); },
});
