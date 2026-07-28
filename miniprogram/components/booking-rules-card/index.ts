Component({
  properties: {
    lockRule: {
      type: String,
      value: "",
    },
    cancellationRule: {
      type: String,
      value: "",
    },
    priceRule: {
      type: String,
      value: "",
    },
  },
});

export type BookingRulesCardProperties = {
  lockRule: string;
  cancellationRule: string;
  priceRule: string;
};
