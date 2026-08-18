import type { PitchGroupViewModel } from "../../presentation/availability";

Component({
  properties: {
    pitchGroups: {
      type: Array,
      value: [],
    },
    disabled: {
      type: Boolean,
      value: false,
    },
  },

  methods: {
    onSelect(event: WechatMiniprogram.TouchEvent) {
      const slotId = event.currentTarget.dataset.slotId as string | undefined;
      const selectable = event.currentTarget.dataset.selectable as boolean | undefined;
      if (this.data.disabled || !slotId || !selectable) return;
      this.triggerEvent("select", { slotId });
    },
  },
});

export type SlotGridProperties = {
  pitchGroups: PitchGroupViewModel[];
  disabled: boolean;
};
