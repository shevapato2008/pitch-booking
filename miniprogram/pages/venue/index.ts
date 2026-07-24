import type { PitchType } from "../../domain/contracts";
import { toVenueViewModel, type VenueViewModel } from "../../presentation/venue";
import { getPageDataSource } from "../../services/page-data";

Page({
  data: {
    venue: null as VenueViewModel | null,
    initialPitchType: null as PitchType | null,
    initialDate: "",
    loading: true,
    errorText: "",
  },

  async onLoad(query: Record<string, string | undefined>) {
    try {
      const source = getPageDataSource();
      const venue = await source.getVenue();
      const coverSource = query.scenario === "image-fallback" ? "" : source.coverSource(venue);
      const viewModel = toVenueViewModel(venue, coverSource);

      this.setData({
        venue: viewModel,
        initialPitchType: viewModel.pitchTypes[0]?.code ?? null,
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
});
