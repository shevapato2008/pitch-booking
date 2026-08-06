import type { Gcj02Coordinate, VenueMapEntry } from "../../domain/venue-directory";
import {
  calculateSearchCenterViewport,
  presentVenueSearch,
  type SearchCenter,
  type SearchCenterPoi,
  type VenueMapFilters,
} from "../../presentation/venue-map-search";
import {
  createRequestGenerationGuard,
  toVenueMapPresentation,
  type VenueMapCardViewModel,
  type VenueMapMarkerViewModel,
  type VenueMapViewport,
} from "../../presentation/venue-map";
import { getLocationCapability } from "../../services/location";
import { getPoiSearchCapability, type PoiSearchResult } from "../../services/poi-search";
import { getVenueDirectoryDataSource } from "../../services/venue-directory";
import { getVenueMapPreviewMetadata } from "../../services/venue-map-preview";

type SheetSnap = "collapsed" | "half" | "expanded";
type PoiSuggestionState = "idle" | "loading" | "ready" | "empty" | "error";
type RuntimeVenueMarker = VenueMapMarkerViewModel & { readonly id: number; readonly width: number; readonly height: number };
type RuntimeCenterMarker = {
  readonly id: number;
  readonly latitude: number;
  readonly longitude: number;
  readonly iconPath: "/assets/map-search-center.png";
  readonly joinCluster: false;
  readonly width: 28;
  readonly height: 28;
};
type RuntimeMapMarker = RuntimeVenueMarker | RuntimeCenterMarker;

const SEARCH_CENTER_MARKER_ID = 2_147_483_647;
const EMPTY_FILTERS: VenueMapFilters = Object.freeze({ onlineOnly: false, districtCode: null });

interface PresentationSnapshot {
  readonly searchCenter: SearchCenter;
  readonly filters: VenueMapFilters;
  readonly selectedVenueId: string | null;
  readonly viewport: VenueMapViewport | null;
  readonly committedQuery: string;
}

function centerNoteFor(center: SearchCenter): string {
  if (center.kind === "CITY") return "全城范围 · 未使用你的位置";
  if (center.kind === "USER_LOCATION") return "当前位置附近 · 距离用于排序";
  return `${center.poi.name}附近 · 可更换搜索中心`;
}

Page({
  data: {
    loading: true,
    errorText: "",
    locating: false,
    showLocation: false,
    locationActive: false,
    locationErrorText: "",
    locationPermissionDenied: false,
    userLocation: null as Gcj02Coordinate | null,
    searchCenter: { kind: "CITY" } as SearchCenter,
    filters: EMPTY_FILTERS as VenueMapFilters,
    draftQuery: "",
    committedQuery: "",
    searchResetToken: 0,
    poiState: "idle" as PoiSuggestionState,
    poiResults: [] as readonly PoiSearchResult[],
    venues: [] as VenueMapEntry[],
    visibleVenues: [] as readonly VenueMapEntry[],
    markers: [] as readonly RuntimeMapMarker[],
    cards: [] as readonly VenueMapCardViewModel[],
    selectedVenueId: null as string | null,
    viewport: null as VenueMapViewport | null,
    title: "全部球场",
    subtitle: "",
    sortLabel: "综合排序",
    centerNote: "全城范围 · 未使用你的位置",
    sheetSnap: "half" as SheetSnap,
  },
  requestGuard: createRequestGenerationGuard(),
  locationGuard: createRequestGenerationGuard(),
  poiGuard: createRequestGenerationGuard(),
  markerVenueIdByRuntimeId: {} as Record<number, string>,
  preEditSnapshot: null as PresentationSnapshot | null,

  async onLoad(query: Record<string, string | undefined>) {
    const token = this.requestGuard.begin();
    try {
      const venues = await getVenueDirectoryDataSource().getVenueDirectory();
      if (!this.requestGuard.isCurrent(token)) return;
      this.setData({ venues });
      const requestedVenueId = query.venueId && venues.some(({ id }) => id === query.venueId)
        ? query.venueId
        : null;
      this.applySearchPresentation({ kind: "CITY" }, EMPTY_FILTERS, requestedVenueId);
      this.setData({ loading: false, errorText: "" });
    } catch {
      if (this.requestGuard.isCurrent(token)) {
        this.setData({ loading: false, errorText: "场馆目录暂时无法加载，请重试。" });
      }
    }
  },

  onUnload() {
    this.requestGuard.invalidate();
    this.locationGuard.invalidate();
    this.poiGuard.invalidate();
    this.data.userLocation = null;
    this.data.showLocation = false;
    this.data.locationActive = false;
  },

  applySearchPresentation(center: SearchCenter, filters: VenueMapFilters, selectedVenueId: string | null) {
    const search = presentVenueSearch({
      venues: this.data.venues,
      center,
      filters,
      selectedVenueId,
      districtByVenueId: getVenueMapPreviewMetadata().districtByVenueId,
    });
    const map = toVenueMapPresentation(
      search.visibleVenues,
      search.selectedVenueId,
      search.distanceMetersByVenueId,
      search.distanceLabelBasis,
    );
    const markerVenueIdByRuntimeId: Record<number, string> = {};
    const venueMarkers = map.markers.map((marker, index): RuntimeVenueMarker => {
      const id = index + 1;
      markerVenueIdByRuntimeId[id] = marker.venueId;
      return { ...marker, id, width: 32, height: 40 };
    });
    const centerMarker: RuntimeCenterMarker[] = center.kind === "POI" && search.searchCenterMarker
      ? [{ ...search.searchCenterMarker, id: SEARCH_CENTER_MARKER_ID, width: 28, height: 28 }]
      : [];
    this.markerVenueIdByRuntimeId = markerVenueIdByRuntimeId;
    this.setData({
      searchCenter: center,
      filters,
      visibleVenues: search.visibleVenues,
      selectedVenueId: map.selectedVenueId,
      cards: map.cards,
      markers: [...venueMarkers, ...centerMarker],
      viewport: calculateSearchCenterViewport(center, this.data.sheetSnap) ?? map.viewport,
      title: search.title,
      subtitle: search.subtitle,
      sortLabel: search.sortLabel,
      centerNote: centerNoteFor(center),
    });
  },

  selectVenue(venueId: string) {
    this.applySearchPresentation(this.data.searchCenter, this.data.filters, venueId);
  },

  onMarkerTap(event: { markerId: number }) {
    const venueId = this.markerVenueIdByRuntimeId[event.markerId];
    if (venueId) this.selectVenue(venueId);
  },

  onCardSelect(event: { detail: { venueId?: string } }) {
    if (event.detail.venueId) this.selectVenue(event.detail.venueId);
  },

  onSheetSnap(event: { detail: { snap: SheetSnap } }) {
    const sheetSnap = event.detail.snap;
    this.setData({ sheetSnap });
    this.applySearchPresentation(this.data.searchCenter, this.data.filters, this.data.selectedVenueId);
  },

  async onVenueAction(event?: { detail?: { venueId?: string } }) {
    const venueId = event?.detail?.venueId ?? this.data.selectedVenueId;
    if (!venueId) return;
    await wx.navigateTo({ url: `/pages/venue/index?venueId=${encodeURIComponent(venueId)}` });
  },

  async onLocateTap() {
    if (this.data.locating) return;
    const token = this.locationGuard.begin();
    const snapshot: PresentationSnapshot = {
      searchCenter: this.data.searchCenter,
      filters: this.data.filters,
      selectedVenueId: this.data.selectedVenueId,
      viewport: this.data.viewport,
      committedQuery: this.data.committedQuery,
    };
    this.setData({ locating: true, locationErrorText: "", locationPermissionDenied: false });
    try {
      const location = await getLocationCapability().getLocation();
      if (!this.locationGuard.isCurrent(token)) return;
      const center: SearchCenter = { kind: "USER_LOCATION", coordinate: location };
      this.setData({
        locating: false,
        showLocation: true,
        locationActive: true,
        userLocation: location,
        draftQuery: "",
        committedQuery: "",
        searchResetToken: this.data.searchResetToken + 1,
        poiState: "idle",
        poiResults: [],
        locationErrorText: "",
      });
      this.applySearchPresentation(center, this.data.filters, this.data.selectedVenueId);
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
        locationPermissionDenied: permissionDenied,
        locationErrorText: permissionDenied ? "" : message,
      });
      this.applySearchPresentation(snapshot.searchCenter, snapshot.filters, snapshot.selectedVenueId);
      this.setData({ viewport: snapshot.viewport });
    }
  },

  async onOpenLocationSetting() { await getLocationCapability().openSetting(); },
  onDismissLocationDenied() { this.setData({ locationPermissionDenied: false }); },

  onSearchEditStart() {
    this.preEditSnapshot = {
      searchCenter: this.data.searchCenter,
      filters: this.data.filters,
      selectedVenueId: this.data.selectedVenueId,
      viewport: this.data.viewport,
      committedQuery: this.data.committedQuery,
    };
  },

  async onSearchQueryChange(event: { detail: { query: string } }) {
    const draftQuery = event.detail.query;
    this.setData({ draftQuery });
    const normalized = draftQuery.trim();
    if (normalized === "") {
      this.poiGuard.invalidate();
      this.setData({ poiState: "idle", poiResults: [] });
      return;
    }
    const token = this.poiGuard.begin();
    this.setData({ poiState: "loading", poiResults: [] });
    try {
      const poiResults = await getPoiSearchCapability().suggest(normalized);
      if (!this.poiGuard.isCurrent(token)) return;
      this.setData({ poiResults, poiState: poiResults.length > 0 ? "ready" : "empty" });
    } catch {
      if (this.poiGuard.isCurrent(token)) this.setData({ poiResults: [], poiState: "error" });
    }
  },

  onSearchVenueSelect(event: { detail: { venueId: string } }) {
    this.setData({ draftQuery: "", searchResetToken: this.data.searchResetToken + 1, poiState: "idle", poiResults: [] });
    this.selectVenue(event.detail.venueId);
  },

  onSearchPoiSelect(event: { detail: { poi: SearchCenterPoi } }) {
    const center: SearchCenter = { kind: "POI", poi: event.detail.poi };
    this.setData({
      draftQuery: "",
      committedQuery: event.detail.poi.name,
      searchResetToken: this.data.searchResetToken + 1,
      poiState: "idle",
      poiResults: [],
      locationActive: false,
    });
    this.applySearchPresentation(center, this.data.filters, this.data.selectedVenueId);
  },

  onSearchClear() {
    this.poiGuard.invalidate();
    this.setData({ draftQuery: "", committedQuery: "", poiState: "idle", poiResults: [], locationActive: false });
    this.applySearchPresentation({ kind: "CITY" }, this.data.filters, this.data.selectedVenueId);
  },

  onSearchCancel() {
    this.poiGuard.invalidate();
    this.setData({ draftQuery: "", poiState: "idle", poiResults: [], searchResetToken: this.data.searchResetToken + 1 });
    if (this.preEditSnapshot) {
      const snapshot = this.preEditSnapshot;
      this.setData({ committedQuery: snapshot.committedQuery });
      this.applySearchPresentation(snapshot.searchCenter, snapshot.filters, snapshot.selectedVenueId);
      this.setData({ viewport: snapshot.viewport });
      this.preEditSnapshot = null;
    }
  },

  onOnlineOnlyChange(event: { detail: { value: boolean } }) {
    const filters = { ...this.data.filters, onlineOnly: event.detail.value };
    this.applySearchPresentation(this.data.searchCenter, filters, this.data.selectedVenueId);
  },

  onDistrictFilter(event: { detail: { code: string | null } }) {
    const filters = { ...this.data.filters, districtCode: event.detail.code };
    this.applySearchPresentation(this.data.searchCenter, filters, this.data.selectedVenueId);
  },
});
