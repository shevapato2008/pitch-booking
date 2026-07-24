import type { PitchGroupViewModel } from "../../presentation/availability";

Component({
  properties: {
    pitchGroups: {
      type: Array,
      value: [],
    },
  },

  methods: {
    onSelect(event: WechatMiniprogram.TouchEvent) {
      const slotId = event.currentTarget.dataset.slotId as string | undefined;
      const selectable = event.currentTarget.dataset.selectable as boolean | undefined;
      if (!slotId || !selectable) return;
      this.triggerEvent("select", { slotId });
    },
  },
});

export type SlotGridProperties = {
  pitchGroups: PitchGroupViewModel[];
};
