type SheetSnap = "collapsed" | "half" | "expanded";

Component({
  properties: {
    cards: { type: Array, value: [] },
    selectedVenueId: { type: String, value: "" },
    snap: { type: String, value: "half" },
    title: { type: String, value: "全部球场" },
    subtitle: { type: String, value: "" },
    sortLabel: { type: String, value: "综合排序" },
  },
  data: { listScrollTop: 0 },
  methods: {
    onSelect(event: WechatMiniprogram.CustomEvent<{ venueId: string }>) { this.triggerEvent("select", event.detail); },
    onAction(event: WechatMiniprogram.CustomEvent<{ venueId: string }>) { this.triggerEvent("action", event.detail); },
    onToggle() {
      const snap = this.data.snap as SheetSnap;
      const next: SheetSnap = snap === "collapsed" ? "half" : snap === "half" ? "expanded" : "collapsed";
      this.triggerEvent("snap", { snap: next });
    },
    onListScroll(event: WechatMiniprogram.CustomEvent<{ scrollTop: number }>) {
      this.setData({ listScrollTop: event.detail.scrollTop });
    },
  },
});
