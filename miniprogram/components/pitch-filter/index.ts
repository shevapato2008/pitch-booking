import type { PitchType } from "../../domain/contracts";

export interface PitchFilterOption {
  code: PitchType;
  label: string;
}

Component({
  properties: {
    options: {
      type: Array,
      value: [],
    },
    selectedPitchType: {
      type: String,
      value: "",
    },
  },

  methods: {
    onSelect(event: WechatMiniprogram.TouchEvent) {
      const pitchType = event.currentTarget.dataset.pitchType as PitchType | undefined;
      if (!pitchType) return;
      this.triggerEvent("select", { pitchType });
    },
  },
});

export type PitchFilterProperties = {
  options: PitchFilterOption[];
  selectedPitchType: PitchType;
};
