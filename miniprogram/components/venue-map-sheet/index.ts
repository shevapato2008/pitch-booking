type SheetSnap = "collapsed" | "half" | "expanded";

Component({
  properties: {
    cards: { type: Array, value: [] },
    selectedVenueId: { type: String, value: "" },
    snap: { type: String, value: "half" },
    title: { type: String, value: "全部球场" },
    subtitle: { type: String, value: "" },
    sortLabel: { type: String, value: "综合排序" },
    onlineOnly: { type: Boolean, value: false },
    districtCode: { type: String, value: "" },
    districtLabel: { type: String, value: "行政区" },
    districtOptions: { type: Array, value: [] },
  },
  methods: {
    onSelect(event: WechatMiniprogram.CustomEvent<{ venueId: string }>) { this.triggerEvent("select", event.detail); },
    onAction(event: WechatMiniprogram.CustomEvent<{ venueId: string }>) { this.triggerEvent("action", event.detail); },
    onToggle() {
      const snap = this.data.snap as SheetSnap;
      const next: SheetSnap = snap === "collapsed" ? "half" : snap === "half" ? "expanded" : "collapsed";
      this.triggerEvent("snap", { snap: next });
    },
    onResetFilters() { this.triggerEvent("resetfilters"); },
    onOnlineTap() { this.triggerEvent("onlinechange", { value: !this.data.onlineOnly }); },
    onDistrictChange(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
      const option = (this.data.districtOptions as Array<{ code: string }>)[Number(event.detail.value)];
      this.triggerEvent("districtchange", { code: option?.code ?? "" });
    },
  },
});
