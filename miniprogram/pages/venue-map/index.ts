import type { Gcj02Coordinate, VenueMapEntry } from "../../domain/venue-directory";
import {
  createRequestGenerationGuard,
  toVenueMapPresentation,
  type VenueMapCardViewModel,
  type VenueMapMarkerViewModel,
  type VenueMapViewport,
} from "../../presentation/venue-map";
import { getLocationCapability } from "../../services/location";
import { getVenueDirectoryDataSource } from "../../services/venue-directory";

const MAP_WATCHDOG_MS = 10_000;
type RuntimeMapMarker = VenueMapMarkerViewModel & { readonly id: number; readonly width: number; readonly height: number };

Page({
  data: {
    loading: true, errorText: "", mapFailed: false, mapKey: 0, mapUpdated: false,
    locating: false, showLocation: false, locationErrorText: "", locationPermissionDenied: false,
    userLocation: null as Gcj02Coordinate | null,
    venues: [] as VenueMapEntry[], markers: [] as RuntimeMapMarker[], cards: [] as VenueMapCardViewModel[], selectedVenueId: null as string | null,
    viewport: null as VenueMapViewport | null, sheetSnap: "default" as "collapsed" | "default" | "expanded", scenario: "ready",
  },
  requestGuard: createRequestGenerationGuard(),
  watchdog: undefined as ReturnType<typeof setTimeout> | undefined,

  async onLoad(query: Record<string, string | undefined>) {
    const token = this.requestGuard.begin();
    this.data.scenario = query.scenario ?? "ready";
    this.startWatchdog();
    try {
      const venues = await getVenueDirectoryDataSource().getVenueDirectory();
      if (!this.requestGuard.isCurrent(token)) return;
      const initialVenueId = query.venueId === undefined ? venues[0]?.id ?? null : query.venueId;
      this.applyPresentation(venues, initialVenueId, null);
      this.setData({ loading: false, errorText: "" });
    } catch {
      if (this.requestGuard.isCurrent(token)) this.setData({ loading: false, errorText: "场馆目录暂时无法加载，请重试。" });
    }
  },
  onUnload() { this.requestGuard.invalidate(); this.clearWatchdog(); },
  applyPresentation(venues: VenueMapEntry[], selectedVenueId: string | null, userLocation: Gcj02Coordinate | null) {
    const view = toVenueMapPresentation(venues, selectedVenueId, userLocation);
    this.setData({ venues, ...view, markers: view.markers.map((marker, index) => ({ ...marker, id: index + 1, width: marker.selected ? 36 : 32, height: marker.selected ? 44 : 40 })) });
  },
  selectVenue(venueId: string) { this.applyPresentation(this.data.venues, venueId, this.data.userLocation); },
  onMarkerTap(event: { markerId: number }) { const venue = this.data.venues[event.markerId - 1]; if (venue) this.selectVenue(venue.id); },
  onCardSelect(event: { detail?: { venueId?: string }; currentTarget?: { dataset: { venueId?: string } } }) { const id = event.detail?.venueId ?? event.currentTarget?.dataset.venueId; if (id) this.selectVenue(id); },
  onSheetSnap(event: { detail: { snap: "collapsed" | "default" | "expanded" } }) { this.setData({ sheetSnap: event.detail.snap }); },
  async onVenueAction(event?: { detail?: { venueId?: string }; currentTarget?: { dataset?: { venueId?: string } } }) {
    const venueId = event?.detail?.venueId ?? event?.currentTarget?.dataset?.venueId ?? this.data.selectedVenueId;
    if (!venueId) return;
    await wx.navigateTo({ url: `/pages/venue/index?venueId=${encodeURIComponent(venueId)}` });
  },
  async onLocateTap() {
    if (this.data.locating) return;
    this.setData({ locating: true, locationErrorText: "", locationPermissionDenied: false });
    try {
      if (this.data.scenario !== "ready" && this.data.scenario !== "location-success") {
        throw Object.assign(new Error(this.data.scenario), { code: this.data.scenario });
      }
      const location = await getLocationCapability().getLocation();
      this.applyPresentation(this.data.venues, this.data.selectedVenueId, location);
      this.setData({ locating: false, showLocation: true, userLocation: location, locationErrorText: "" });
    } catch (error) {
      const code = (error as { code?: string }).code;
      const permissionDenied = code === "permission-denied" || code === "LOCATION_PERMISSION_DENIED";
      this.setData({
        locating: false,
        showLocation: false,
        userLocation: null,
        locationPermissionDenied: permissionDenied,
        locationErrorText: permissionDenied ? "" : "暂时无法获取位置，请重试。",
      });
    }
  },
  async onOpenLocationSetting() { await getLocationCapability().openSetting(); },
  onDismissLocationDenied() { this.setData({ locationPermissionDenied: false }); },
  onMapUpdated() { if (this.data.scenario === "map-render-failure") return; this.clearWatchdog(); this.setData({ mapUpdated: true }); },
  onRetryMap() { this.clearWatchdog(); this.setData({ mapFailed: false, mapUpdated: false, mapKey: this.data.mapKey + 1 }); this.startWatchdog(); },
  startWatchdog() { this.clearWatchdog(); this.watchdog = setTimeout(() => this.setData({ mapFailed: true }), MAP_WATCHDOG_MS); },
  clearWatchdog() { if (this.watchdog !== undefined) clearTimeout(this.watchdog); this.watchdog = undefined; },
});
