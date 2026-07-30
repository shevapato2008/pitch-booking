import type { VenueMapEntry } from "../domain/venue-directory";
import type { VenueDirectoryDataSource } from "../services/venue-directory";
import type { DevelopmentVenueDirectoryScenario } from "./venue-directory-scenarios";

export const VENUE_DIRECTORY_VISUAL_FIXTURE: readonly VenueMapEntry[] = [
  {
    id: "7e68d7d8-4b7e-4f04-a5c5-3fe263e69c6f", slug: "bohai-yuanfeng-football-pitch", sortOrder: 0,
    name: "渤海元丰足球场", address: "天津市西青区利达路", bookingMode: "ONLINE",
    marker: { coordinateSystem: "GCJ02", latitude: 39.000867, longitude: 117.212396 },
    navigation: { poiName: "天津市渤海元丰科技有限公司-南门", coordinate: { coordinateSystem: "GCJ02", latitude: 39.000157, longitude: 117.212208 } },
    pitchTypes: [], coverImage: null, nearestTransit: [], contentVerifiedAt: "2026-07-30T18:15:00+08:00",
  },
  {
    id: "e03d801d-1254-5c62-9a16-9a8800280162", slug: "tianjin-olympic-center-five-a-side-football-pitch", sortOrder: 1,
    name: "天津奥林匹克中心五人制足球场", address: "天津市南开区宾水西道1号", bookingMode: "DIRECTORY_ONLY",
    marker: { coordinateSystem: "GCJ02", latitude: 39.074524, longitude: 117.176641 },
    navigation: { poiName: "天津奥林匹克中心体育馆", coordinate: { coordinateSystem: "GCJ02", latitude: 39.077539, longitude: 117.178054 } },
    pitchTypes: ["FIVE_A_SIDE"], coverImage: null,
    nearestTransit: [{ id: "subway-tiyuzhongxin-line-5", kind: "SUBWAY", name: "体育中心站", coordinate: { coordinateSystem: "GCJ02", latitude: 39.073861, longitude: 117.172379 }, lines: ["5号线"], distanceMeters: 420, distanceBasis: "MAP_VERIFIED" }],
    contentVerifiedAt: "2026-07-30T18:15:00+08:00",
  },
  {
    id: "2a9640a5-f625-5ad8-9cb9-3440acb70967", slug: "tianjin-locomotive-stadium", sortOrder: 2,
    name: "天津火车头体育场", address: "天津市河北区中山北路增1号", bookingMode: "DIRECTORY_ONLY",
    marker: { coordinateSystem: "GCJ02", latitude: 39.17033, longitude: 117.210679 },
    navigation: { poiName: "火车头体育场", coordinate: { coordinateSystem: "GCJ02", latitude: 39.17033, longitude: 117.210679 } },
    pitchTypes: ["ELEVEN_A_SIDE"], coverImage: null, nearestTransit: [], contentVerifiedAt: "2026-07-30T18:15:00+08:00",
  },
  {
    id: "80532433-8038-5ee5-9963-3e6282aa4abd", slug: "tianjin-peoples-gymnasium-football-pitch", sortOrder: 3,
    name: "天津市人民体育馆足球场", address: "天津市和平区贵州路33号", bookingMode: "DIRECTORY_ONLY",
    marker: { coordinateSystem: "GCJ02", latitude: 39.108701, longitude: 117.194873 },
    navigation: { poiName: "天津市人民体育馆", coordinate: { coordinateSystem: "GCJ02", latitude: 39.108701, longitude: 117.194873 } },
    pitchTypes: ["FIVE_A_SIDE"], coverImage: null, nearestTransit: [], contentVerifiedAt: "2026-07-30T18:15:00+08:00",
  },
  {
    id: "c0372328-6fa4-585a-b951-3324925763d6", slug: "dongli-sports-center-football-pitch", sortOrder: 4,
    name: "东丽体育中心足球场", address: "天津市东丽区先锋东路3号", bookingMode: "DIRECTORY_ONLY",
    marker: { coordinateSystem: "GCJ02", latitude: 39.083772, longitude: 117.324276 },
    navigation: { poiName: "东丽体育中心", coordinate: { coordinateSystem: "GCJ02", latitude: 39.083772, longitude: 117.324276 } },
    pitchTypes: ["ELEVEN_A_SIDE"], coverImage: null, nearestTransit: [], contentVerifiedAt: "2026-07-30T18:15:00+08:00",
  },
];

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export function createDevelopmentVenueDirectoryDataSource(
  scenario: DevelopmentVenueDirectoryScenario = "ready",
): VenueDirectoryDataSource {
  return {
    async getVenueDirectory() {
      if (scenario === "load-error") throw new Error("VENUE_DIRECTORY_LOAD_FAILED");
      return clone(VENUE_DIRECTORY_VISUAL_FIXTURE) as VenueMapEntry[];
    },
    async getVenueDetail(venueId) {
      if (scenario === "load-error") throw new Error("VENUE_DIRECTORY_LOAD_FAILED");
      const venue = VENUE_DIRECTORY_VISUAL_FIXTURE.find(({ id }) => id === venueId);
      if (!venue) throw new Error("VENUE_NOT_FOUND");
      return clone(venue);
    },
  };
}
