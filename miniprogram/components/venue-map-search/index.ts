interface SearchableVenue {
  readonly id: string;
  readonly name: string;
  readonly address: string;
}

Component({
  properties: {
    venues: { type: Array, value: [] },
    poiResults: { type: Array, value: [] },
    poiState: { type: String, value: "idle" },
    resetToken: {
      type: Number,
      value: 0,
      observer() { this.setData({ draftQuery: "", localMatches: [] }); },
    },
  },
  data: { draftQuery: "", localMatches: [] as readonly SearchableVenue[] },
  methods: {
    onFocus() { this.triggerEvent("editstart"); },
    onInput(event: { detail: { value: string } }) {
      const draftQuery = event.detail.value;
      const normalized = draftQuery.trim().toLocaleLowerCase("zh-CN");
      const venues = this.data.venues as readonly SearchableVenue[];
      const localMatches = normalized === "" ? [] : venues.filter((venue) => (
        venue.name.toLocaleLowerCase("zh-CN").includes(normalized)
        || venue.address.toLocaleLowerCase("zh-CN").includes(normalized)
      )).slice(0, 5);
      this.setData({ draftQuery, localMatches });
      this.triggerEvent("querychange", { query: draftQuery });
    },
    onClear() {
      this.setData({ draftQuery: "", localMatches: [] });
      this.triggerEvent("clear");
    },
    onCancel() {
      this.setData({ draftQuery: "", localMatches: [] });
      this.triggerEvent("cancel", { restorePreEdit: true });
    },
    onVenueSelect(event: WechatMiniprogram.BaseEvent) {
      const venueId = event.currentTarget.dataset.venueId as string | undefined;
      if (venueId) this.triggerEvent("selectvenue", { venueId });
    },
    onPoiSelect(event: WechatMiniprogram.BaseEvent) {
      const index = Number(event.currentTarget.dataset.index);
      const poi = this.data.poiResults[index];
      if (poi) this.triggerEvent("selectpoi", { poi });
    },
    onConfirm() {
      // A typed query is a draft. Only tapping a concrete suggestion commits intent.
    },
  },
});
