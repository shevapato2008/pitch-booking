import type { CheckoutView } from "../../domain/booking";

Component({
  properties: {
    checkout: {
      type: Object,
      value: null,
    },
    dateLabel: {
      type: String,
      value: "",
    },
    timeLabel: {
      type: String,
      value: "",
    },
    durationLabel: {
      type: String,
      value: "",
    },
    priceText: {
      type: String,
      value: "",
    },
  },
});

export type SlotSummaryCardProperties = {
  checkout: CheckoutView | null;
  dateLabel: string;
  timeLabel: string;
  durationLabel: string;
  priceText: string;
};
