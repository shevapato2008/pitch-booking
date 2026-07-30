import type {
  FacilityCode,
  ImageRole,
  PitchType,
  Venue,
} from "../domain/contracts";
import type { DirectoryVenueMapEntry } from "../domain/venue-directory";

export interface VenueImageViewModel {
  source: string;
  alt: string;
  role: ImageRole;
}

export interface VenueLabelViewModel<TCode extends string> {
  code: TCode;
  label: string;
}

export interface VenueCoverViewModel {
  alt: string;
  source: string;
  state: "image" | "fallback";
  className: "venue-cover--image" | "venue-cover--fallback";
  fallbackText: "" | "场馆图片待配置";
}

export interface VenueViewModel {
  bookingMode: "ONLINE";
  id: string;
  name: string;
  description: string;
  priceAdvantageText: string;
  businessHoursText: string;
  address: string;
  parkingText: string;
  phone: string;
  refundPolicySummary: string;
  cover: VenueCoverViewModel;
  images: VenueImageViewModel[];
  facilities: Array<VenueLabelViewModel<FacilityCode>>;
  pitchTypes: Array<VenueLabelViewModel<PitchType>>;
  availabilityWindow: { startDate: string; endDate: string };
}

export interface DirectoryVenueViewModel {
  id: string;
  bookingMode: "DIRECTORY_ONLY";
  bookingStatusText: "暂未接入在线预订";
  name: string;
  description: string;
  address: string;
  businessHoursText: string;
  parkingText: string;
  transitText: string;
  pitchTypes: Array<VenueLabelViewModel<string>>;
  cover: VenueCoverViewModel;
}

export type AnyVenueViewModel = VenueViewModel | DirectoryVenueViewModel;

export function toVenueViewModel(venue: Venue, coverSource: string): VenueViewModel {
  const sortedImages = [...venue.images].sort((left, right) => left.sortOrder - right.sortOrder);
  const cover = sortedImages.find((image) => image.role === "COVER");
  const hasCoverImage = coverSource.length > 0;

  return {
    bookingMode: "ONLINE",
    id: venue.id,
    name: venue.name,
    description: venue.description,
    priceAdvantageText: venue.priceAdvantageText,
    businessHoursText: venue.businessHoursText,
    address: venue.address,
    parkingText: venue.parkingText,
    phone: venue.phone,
    refundPolicySummary: venue.refundPolicySummary,
    cover: {
      alt: cover?.alt ?? venue.name,
      source: coverSource,
      state: hasCoverImage ? "image" : "fallback",
      className: hasCoverImage ? "venue-cover--image" : "venue-cover--fallback",
      fallbackText: hasCoverImage ? "" : "场馆图片待配置",
    },
    images: sortedImages.map((image) => ({
      source: image.url,
      alt: image.alt,
      role: image.role,
    })),
    facilities: [...venue.facilities]
      .sort((left, right) => left.sortOrder - right.sortOrder)
      .map((facility) => ({ code: facility.code, label: facility.name })),
    pitchTypes: [...venue.pitchTypes]
      .sort((left, right) => left.sortOrder - right.sortOrder)
      .map((pitchType) => ({ code: pitchType.code, label: pitchType.name })),
    availabilityWindow: {
      startDate: venue.availabilityWindow.startDate,
      endDate: venue.availabilityWindow.endDate,
    },
  };
}

export function toDirectoryVenueViewModel(venue: DirectoryVenueMapEntry): DirectoryVenueViewModel {
  const stop = venue.nearestTransit[0];
  const transitText = stop
    ? `${stop.kind === "SUBWAY" ? "地铁" : "公交"} ${stop.lines.join("/")} · ${stop.name} · 约 ${stop.distanceMeters} 米`
    : "交通信息待核验";
  return {
    id: venue.id,
    bookingMode: "DIRECTORY_ONLY",
    bookingStatusText: "暂未接入在线预订",
    name: venue.name,
    description: "这里仅展示已核验的场馆与位置资料。",
    address: venue.address,
    businessHoursText: "营业时间待核验",
    parkingText: "停车信息待核验",
    transitText,
    pitchTypes: venue.pitchTypes.map((code) => ({ code, label: code === "FIVE_A_SIDE" ? "五人制" : code === "SEVEN_A_SIDE" ? "七人制" : "十一人制" })),
    cover: { alt: venue.name, source: "", state: "fallback", className: "venue-cover--fallback", fallbackText: "场馆图片待配置" },
  };
}
