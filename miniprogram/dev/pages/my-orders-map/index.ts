import { MY_ORDERS_MAP_FIXTURE } from "../../my-orders-fixture";

interface FilterTapEvent {
  readonly currentTarget?: { readonly dataset?: { readonly filterId?: unknown } };
}

interface VenueTapEvent {
  readonly currentTarget?: { readonly dataset?: { readonly venueId?: unknown } };
}

Page({
  data: {
    searchCenterName: MY_ORDERS_MAP_FIXTURE.searchCenterName,
    filters: MY_ORDERS_MAP_FIXTURE.filters,
    venues: MY_ORDERS_MAP_FIXTURE.venues,
    selectedFilterId: "distance",
    locationActive: false,
    sheetExpanded: false,
  },

  onLoad() {
    this.setData({
      searchCenterName: MY_ORDERS_MAP_FIXTURE.searchCenterName,
      filters: MY_ORDERS_MAP_FIXTURE.filters.map((filter) => ({ ...filter })),
      venues: MY_ORDERS_MAP_FIXTURE.venues.map((venue) => ({ ...venue })),
    });
  },

  onSearch() {
    const next = this.data.searchCenterName === MY_ORDERS_MAP_FIXTURE.searchCenterName
      ? MY_ORDERS_MAP_FIXTURE.alternateSearchCenterName
      : MY_ORDERS_MAP_FIXTURE.searchCenterName;
    this.setData({ searchCenterName: next, locationActive: false });
  },

  onLocate() {
    this.setData({ searchCenterName: "当前位置附近", locationActive: true });
  },

  onOpenOrders() {
    wx.navigateTo({ url: "/dev/pages/my-orders/index?state=ready" });
  },

  onToggleSheet() {
    this.setData({ sheetExpanded: !this.data.sheetExpanded });
  },

  onSelectFilter(event: FilterTapEvent) {
    const filterId = event.currentTarget?.dataset?.filterId;
    if (typeof filterId !== "string" || !MY_ORDERS_MAP_FIXTURE.filters.some(({ id }) => id === filterId)) return;
    this.setData({ selectedFilterId: filterId });
  },

  onOpenVenue(event: VenueTapEvent) {
    const venueId = event.currentTarget?.dataset?.venueId;
    if (typeof venueId !== "string") return;
    const venue = MY_ORDERS_MAP_FIXTURE.venues.find(({ id }) => id === venueId);
    if (venue) wx.navigateTo({ url: venue.route });
  },
});
