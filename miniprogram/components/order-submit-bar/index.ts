Component({
  properties: {
    disabled: {
      type: Boolean,
      value: true,
    },
    loading: {
      type: Boolean,
      value: false,
    },
    reconciling: {
      type: Boolean,
      value: false,
    },
    price: {
      type: String,
      value: "",
    },
    cta: {
      type: String,
      value: "确认下单",
    },
    disabledReason: {
      type: String,
      value: "",
    },
  },

  methods: {
    onSubmit() {
      if (this.data.disabled || this.data.loading || this.data.reconciling) return;
      this.triggerEvent("submit", {});
    },
  },
});

export type OrderSubmitBarProperties = {
  disabled: boolean;
  loading: boolean;
  reconciling: boolean;
  price: string;
  cta: string;
  disabledReason: string;
};
