import type { PoiSearchCapability, PoiSearchResult } from "../services/poi-search";

export const DEV_ONLY_POI_SEARCH_PREVIEW = "DEV_ONLY_POI_SEARCH_PREVIEW";

const TIANJIN_STATION: PoiSearchResult = Object.freeze({
  id: "preview-tianjin-station",
  name: "天津站",
  address: "天津市河北区新纬路1号",
  city: "天津市",
  district: "河北区",
  adcode: "120105",
  latitude: 39.1365,
  longitude: 117.2109,
  coordinateSystem: "GCJ02",
});

export const previewPoiSearchCapability: PoiSearchCapability = {
  async suggest(query) {
    const normalized = query.trim().toLocaleLowerCase("zh-CN");
    return normalized.includes("天津站") ? [TIANJIN_STATION] : [];
  },
};
