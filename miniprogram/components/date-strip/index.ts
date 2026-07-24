import type { AvailabilityDateViewModel } from "../../presentation/availability";

Component({
  properties: {
    dates: {
      type: Array,
      value: [],
    },
    selectedDate: {
      type: String,
      value: "",
    },
  },

  methods: {
    onSelect(event: WechatMiniprogram.TouchEvent) {
      const date = event.currentTarget.dataset.date as string | undefined;
      if (!date) return;
      this.triggerEvent("select", { date });
    },
  },
});

export type DateStripProperties = {
  dates: AvailabilityDateViewModel[];
  selectedDate: string;
};
