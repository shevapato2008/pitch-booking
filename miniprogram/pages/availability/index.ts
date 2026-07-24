import type { Availability, PitchType, SlotStatus } from "../../domain/contracts";
import {
  toAvailabilityViewModel,
  toggleSelectedSlot,
  type AvailabilityViewModel,
} from "../../presentation/availability";
import { getPageDataSource } from "../../services/page-data";
import type { PitchFilterOption } from "../../components/pitch-filter/index";

interface SelectionEvent<T> {
  detail: T;
}

Page({
  data: {
    venueId: "",
    pitchOptions: [] as PitchFilterOption[],
    selectedDate: "",
    selectedPitchType: "" as PitchType | "",
    selectedSlotId: null as string | null,
    availability: null as Availability | null,
    viewModel: null as AvailabilityViewModel | null,
    loading: true,
    errorText: "",
  },

  async onLoad(query: Record<string, string | undefined>) {
    try {
      const venue = await getPageDataSource().getVenue();
      const pitchOptions = venue.pitchTypes.map(({ code, name }) => ({ code, label: name }));
      const queryPitchType = pitchOptions.find(({ code }) => code === query.pitchType)?.code;
      const selectedPitchType = queryPitchType ?? pitchOptions[0]?.code;
      const selectedDate = query.date || venue.availabilityWindow.startDate;
      const venueId = query.venueId || venue.id;

      if (!selectedPitchType) throw new Error("VENUE_HAS_NO_PITCH_TYPES");

      this.setData({ venueId, pitchOptions, selectedDate, selectedPitchType });
      await this.loadAvailability(venueId, selectedPitchType, selectedDate);
    } catch {
      this.setData({
        loading: false,
        errorText: "可订时段暂时无法加载，请稍后再试。",
      });
    }
  },

  async loadAvailability(venueId: string, pitchType: PitchType, date: string) {
    this.setData({ loading: true, errorText: "" });
    try {
      const availability = await getPageDataSource().getAvailability(venueId, pitchType, date);
      const viewModel = toAvailabilityViewModel(availability, this.data.selectedSlotId);
      this.setData({ availability, viewModel, loading: false, errorText: "" });
    } catch {
      this.setData({
        availability: null,
        viewModel: null,
        loading: false,
        errorText: "可订时段暂时无法加载，请稍后再试。",
      });
    }
  },

  async onDateSelect(event: SelectionEvent<{ date: string }>) {
    const date = event.detail.date;
    if (!date || date === this.data.selectedDate || !this.data.selectedPitchType) return;
    this.setData({ selectedDate: date, selectedSlotId: null });
    await this.loadAvailability(this.data.venueId, this.data.selectedPitchType, date);
  },

  async onPitchTypeSelect(event: SelectionEvent<{ pitchType: PitchType }>) {
    const pitchType = event.detail.pitchType;
    if (!pitchType || pitchType === this.data.selectedPitchType) return;
    this.setData({ selectedPitchType: pitchType, selectedSlotId: null });
    await this.loadAvailability(this.data.venueId, pitchType, this.data.selectedDate);
  },

  onSlotSelect(event: SelectionEvent<{ slotId: string }>) {
    const availability = this.data.availability;
    if (!availability) return;

    const tappedSlot = availability.pitchGroups
      .flatMap((pitchGroup) => pitchGroup.slots)
      .find((slot) => slot.id === event.detail.slotId);
    if (!tappedSlot) return;

    const selectedSlotId = toggleSelectedSlot(
      this.data.selectedSlotId,
      tappedSlot.id,
      tappedSlot.status as SlotStatus,
    );
    this.setData({
      selectedSlotId,
      viewModel: toAvailabilityViewModel(availability, selectedSlotId),
    });
  },
});
