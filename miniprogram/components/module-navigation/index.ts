import { readIntentHeaderLayout } from "../../presentation/intent-header-layout";

const FALLBACK_LAYOUT = { topPx: 0, rowHeightPx: 44, titleInsetPx: 96 };

Component({
  properties: {
    title: { type: String, value: "" },
    subtitle: { type: String, value: "" },
    action: { type: String, value: "home" },
    disabled: { type: Boolean, value: false },
  },
  data: { ...FALLBACK_LAYOUT },
  lifetimes: {
    attached() { this.updateLayout(); },
  },
  pageLifetimes: {
    show() { this.updateLayout(); },
    resize() { this.updateLayout(); },
  },
  methods: {
    updateLayout() {
      try {
        const layout = readIntentHeaderLayout();
        this.setData({
          topPx: layout.topPx,
          rowHeightPx: layout.rowHeightPx,
          titleInsetPx: Math.max(52, layout.rightInsetPx),
        });
      } catch {
        this.setData({ ...FALLBACK_LAYOUT });
      }
    },
    onNavigate() {
      if (!this.data.disabled) this.triggerEvent("navigate");
    },
  },
});
