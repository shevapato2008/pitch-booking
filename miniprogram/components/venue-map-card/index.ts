interface VenueMapCardProperty {
  readonly venueId?: string;
}

Component({
  properties: {
    card: { type: Object, value: null },
  },
  methods: {
    onSelect() {
      const card = this.data.card as VenueMapCardProperty | null;
      this.triggerEvent("select", { venueId: card?.venueId });
    },
    onAction() {
      const card = this.data.card as VenueMapCardProperty | null;
      this.triggerEvent("action", { venueId: card?.venueId });
    },
  },
});
