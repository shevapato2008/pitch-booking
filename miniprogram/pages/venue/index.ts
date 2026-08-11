import type { PitchType } from "../../domain/contracts";
import { toDirectoryVenueViewModel, toOnlineDirectoryVenueViewModel, toVenueViewModel, type AnyVenueViewModel } from "../../presentation/venue";
import { getPageDataSource } from "../../services/page-data";
import { getVenueDirectoryDataSource } from "../../services/venue-directory";

const bookablePitchType = (codes: readonly { code: string }[]): PitchType | null => {
  const selected = codes.find(({ code }) => code === "FIVE_A_SIDE" || code === "SEVEN_A_SIDE");
  return selected ? selected.code as PitchType : null;
};

Page({
  data: {
    venue: null as AnyVenueViewModel | null,
    canBook: false,
    initialPitchType: null as PitchType | null,
    initialDate: "",
    loading: true,
    errorText: "",
  },

  async onLoad(query: Record<string, string | undefined>) {
    try {
      const directoryVenue = query.venueId
        ? await getVenueDirectoryDataSource().getVenueDetail(query.venueId)
        : null;
      if (directoryVenue?.bookingMode === "DIRECTORY_ONLY") {
        this.setData({ venue: toDirectoryVenueViewModel(directoryVenue), canBook: false, loading: false, errorText: "" });
        return;
      }
      if (directoryVenue?.bookingMode === "ONLINE") {
        const viewModel = toOnlineDirectoryVenueViewModel(directoryVenue);
        this.setData({
          venue: viewModel,
          canBook: viewModel.availabilityEnabled,
          initialPitchType: bookablePitchType(viewModel.pitchTypes),
          initialDate: viewModel.availabilityWindow.startDate,
          loading: false,
          errorText: "",
        });
        return;
      }
      const source = getPageDataSource();
      const venue = await source.getVenue();
      const coverSource = query.scenario === "image-fallback" ? "" : source.coverSource(venue);
      const viewModel = toVenueViewModel(venue, coverSource);

      this.setData({
        venue: viewModel,
        canBook: viewModel.availabilityEnabled,
        initialPitchType: bookablePitchType(viewModel.pitchTypes),
        initialDate: viewModel.availabilityWindow.startDate,
        loading: false,
        errorText: "",
      });
    } catch {
      this.setData({
        loading: false,
        errorText: "场馆信息暂时无法加载，请稍后再试。",
      });
    }
  },

  onViewAvailability() {
    const { venue, initialPitchType, initialDate } = this.data;
    if (!venue || !initialPitchType || !initialDate) return;

    wx.navigateTo({
      url: `/pages/availability/index?venueId=${encodeURIComponent(venue.id)}&pitchType=${initialPitchType}&date=${initialDate}`,
    });
  },

  onViewOnMap() {
    const { venue } = this.data;
    if (!venue) return;
    wx.navigateTo({ url: `/pages/venue-map/index?venueId=${encodeURIComponent(venue.id)}` });
  },
});
