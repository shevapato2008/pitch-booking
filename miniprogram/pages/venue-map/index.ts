import type { Gcj02Coordinate, VenueMapEntry } from "../../domain/venue-directory";
import {
  calculateMapViewport,
  createRequestGenerationGuard,
  findNearestVenueId,
  toVenueMapPresentation,
  type VenueMapCardViewModel,
  type VenueMapMarkerViewModel,
  type VenueMapViewport,
} from "../../presentation/venue-map";
import { getLocationCapability } from "../../services/location";
import { getVenueDirectoryDataSource } from "../../services/venue-directory";

type RuntimeMapMarker = VenueMapMarkerViewModel & { readonly id: number; readonly width: number; readonly height: number };

Page({
  data: {
    loading: true, errorText: "",
    locating: false, showLocation: false, locationErrorText: "", locationPermissionDenied: false,
    searchQuery: "", searchEmpty: false,
    userLocation: null as Gcj02Coordinate | null,
    venues: [] as VenueMapEntry[], visibleVenues: [] as VenueMapEntry[], markers: [] as RuntimeMapMarker[], cards: [] as VenueMapCardViewModel[], selectedVenueId: null as string | null,
    viewport: null as VenueMapViewport | null, sheetSnap: "default" as "collapsed" | "default" | "expanded",
  },
  requestGuard: createRequestGenerationGuard(),
  locationGuard: createRequestGenerationGuard(),

  async onLoad(query: Record<string, string | undefined>) {
    const token = this.requestGuard.begin();
    try {
      const venues = await getVenueDirectoryDataSource().getVenueDirectory();
      if (!this.requestGuard.isCurrent(token)) return;
      this.setData({ venues });
      const ordinaryEntry = query.venueId === undefined;
      const initialVenueId = ordinaryEntry ? venues[0]?.id ?? null : query.venueId ?? null;
      this.applyPresentation(venues, initialVenueId, null, !ordinaryEntry);
      this.setData({ loading: false, errorText: "" });
    } catch {
      if (this.requestGuard.isCurrent(token)) this.setData({ loading: false, errorText: "场馆目录暂时无法加载，请重试。" });
    }
  },
  onUnload() {
    this.requestGuard.invalidate();
    this.locationGuard.invalidate();
    this.data.userLocation = null;
    this.data.showLocation = false;
  },
  applyPresentation(venues: VenueMapEntry[], selectedVenueId: string | null, userLocation: Gcj02Coordinate | null, focusSelection = true) {
    const view = toVenueMapPresentation(venues, selectedVenueId, userLocation);
    this.setData({
      visibleVenues: venues,
      ...view,
      viewport: focusSelection ? view.viewport : calculateMapViewport(venues, null),
      markers: view.markers.map((marker, index) => ({ ...marker, id: index + 1, width: marker.selected ? 36 : 32, height: marker.selected ? 44 : 40 })),
    });
  },
  selectVenue(venueId: string) {
    const venues = this.data.searchQuery.trim() === "" ? this.data.venues : this.data.visibleVenues;
    this.applyPresentation(venues, venueId, this.data.userLocation);
  },
  onMarkerTap(event: { markerId: number }) { const venue = this.data.visibleVenues[event.markerId - 1]; if (venue) this.selectVenue(venue.id); },
  onCardSelect(event: { detail?: { venueId?: string }; currentTarget?: { dataset: { venueId?: string } } }) { const id = event.detail?.venueId ?? event.currentTarget?.dataset.venueId; if (id) this.selectVenue(id); },
  onSheetSnap(event: { detail: { snap: "collapsed" | "default" | "expanded" } }) { this.setData({ sheetSnap: event.detail.snap }); },
  async onVenueAction(event?: { detail?: { venueId?: string }; currentTarget?: { dataset?: { venueId?: string } } }) {
    const venueId = event?.detail?.venueId ?? event?.currentTarget?.dataset?.venueId ?? this.data.selectedVenueId;
    if (!venueId) return;
    await wx.navigateTo({ url: `/pages/venue/index?venueId=${encodeURIComponent(venueId)}` });
  },
  async onLocateTap() {
    if (this.data.locating) return;
    const token = this.locationGuard.begin();
    this.setData({ locating: true, locationErrorText: "", locationPermissionDenied: false });
    try {
      const location = await getLocationCapability().getLocation();
      if (!this.locationGuard.isCurrent(token)) return;
      const nearestVenueId = findNearestVenueId(this.data.venues, location);
      this.setData({ searchQuery: "", searchEmpty: false });
      this.applyPresentation(this.data.venues, nearestVenueId, location);
      this.setData({ locating: false, showLocation: true, userLocation: location, locationErrorText: "" });
      if (nearestVenueId) wx.showToast({ title: "已找到离你最近的球场", icon: "none" });
    } catch (error) {
      if (!this.locationGuard.isCurrent(token)) return;
      const code = (error as { code?: string }).code;
      const permissionDenied = code === "permission-denied" || code === "LOCATION_PERMISSION_DENIED";
      const message = code === "LOCATION_PRIVACY_DENIED"
        ? "请先同意位置隐私授权后重试。"
        : code === "LOCATION_SERVICES_DISABLED"
          ? "系统定位服务未开启，请开启后重试。"
          : code === "LOCATION_TIMEOUT"
            ? "定位超时，请重试。"
            : "暂时无法获取位置，请重试。";
      this.setData({
        locating: false,
        showLocation: false,
        userLocation: null,
        locationPermissionDenied: permissionDenied,
        locationErrorText: permissionDenied ? "" : message,
      });
    }
  },
  async onOpenLocationSetting() { await getLocationCapability().openSetting(); },
  onDismissLocationDenied() { this.setData({ locationPermissionDenied: false }); },
  onSearchInput(event: { detail: { value: string } }) {
    const searchQuery = event.detail.value;
    const normalized = searchQuery.trim().toLocaleLowerCase("zh-CN");
    const visibleVenues = normalized === "" ? this.data.venues : this.data.venues.filter((venue) => (
      venue.name.toLocaleLowerCase("zh-CN").includes(normalized)
      || venue.address.toLocaleLowerCase("zh-CN").includes(normalized)
    ));
    if (visibleVenues.length === 0) {
      this.setData({ searchQuery, searchEmpty: true, visibleVenues: [], cards: [], markers: [], selectedVenueId: null });
      return;
    }
    this.setData({ searchQuery, searchEmpty: false });
    this.applyPresentation(visibleVenues, visibleVenues[0].id, this.data.userLocation);
  },
  onSearchClear() {
    this.setData({ searchQuery: "", searchEmpty: false });
    this.applyPresentation(this.data.venues, this.data.venues[0]?.id ?? null, this.data.userLocation, false);
  },
});
