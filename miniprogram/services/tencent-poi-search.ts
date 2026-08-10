import type { PoiSearchCapability, PoiSearchResult } from "./poi-search";

export interface TencentPoiRequestInput {
  readonly url: "https://apis.map.qq.com/ws/place/v1/suggestion";
  readonly data: {
    readonly keyword: string;
    readonly key: string;
    readonly region: "天津市";
    readonly output: "json";
  };
}

export type TencentPoiRequest = (input: TencentPoiRequestInput) => Promise<unknown>;

export class TencentPoiSearchCapability implements PoiSearchCapability {
  constructor(
    private readonly request: TencentPoiRequest,
    private readonly key: string,
  ) {}

  async suggest(query: string): Promise<readonly PoiSearchResult[]> {
    const keyword = query.trim();
    if ([...keyword.replace(/\s/g, "")].length < 2) return [];

    try {
      const response = await this.request({
        url: "https://apis.map.qq.com/ws/place/v1/suggestion",
        data: { keyword, key: this.key, region: "天津市", output: "json" },
      });
      if (!isRecord(response) || response.status !== 0 || !Array.isArray(response.data)) {
        throw unavailable();
      }
      return response.data.flatMap((item) => {
        const decoded = decodeItem(item);
        return decoded === undefined ? [] : [decoded];
      });
    } catch {
      throw unavailable();
    }
  }
}

function decodeItem(value: unknown): PoiSearchResult | undefined {
  if (!isRecord(value) || !isRecord(value.location)
    || !isNonEmptyString(value.id) || !isNonEmptyString(value.title)
    || !isNonEmptyString(value.address) || !isNonEmptyString(value.city)
    || !isNonEmptyString(value.district) || !isAdcode(value.adcode)
    || !isCoordinate(value.location.lat, -90, 90)
    || !isCoordinate(value.location.lng, -180, 180)) {
    return undefined;
  }
  return {
    id: value.id,
    name: value.title,
    address: value.address,
    city: value.city,
    district: value.district,
    adcode: String(value.adcode),
    latitude: value.location.lat,
    longitude: value.location.lng,
    coordinateSystem: "GCJ02",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isCoordinate(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function isAdcode(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
    && Number.isInteger(value) && value >= 100_000 && value <= 999_999;
}

function unavailable(): Error & { readonly code: "POI_SEARCH_UNAVAILABLE" } {
  return Object.assign(new Error("POI_SEARCH_UNAVAILABLE"), { code: "POI_SEARCH_UNAVAILABLE" as const });
}
