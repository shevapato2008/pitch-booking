import type {
  FacilityCode,
  ImageRole,
  PitchType,
  Venue,
} from "../domain/contracts";
import type { DirectoryVenueDetail, OnlineVenueDetail } from "../domain/venue-directory";

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
  refundPolicySummary: string;
  cover: VenueCoverViewModel;
  images: VenueImageViewModel[];
  facilities: Array<VenueLabelViewModel<FacilityCode>>;
  pitchTypes: Array<VenueLabelViewModel<PitchType | "ELEVEN_A_SIDE">>;
  availabilityWindow: { startDate: string; endDate: string };
  livePriceText: string;
  availabilityLabel: string;
  availabilityEnabled: boolean;
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
  facilities: Array<VenueLabelViewModel<FacilityCode>>;
  images: VenueImageViewModel[];
  livePriceText: string;
  availabilityLabel: string;
  availabilityEnabled: boolean;
  cover: VenueCoverViewModel;
}

export type AnyVenueViewModel = VenueViewModel | DirectoryVenueViewModel;

function formatLivePrice(livePrice: Venue["profile"]["livePrice"]): string {
  if (!livePrice.available || livePrice.fromPriceCents === null) return "暂无可订时段";
  const yuan = livePrice.fromPriceCents / 100;
  return `¥${yuan.toFixed(Number.isInteger(yuan) ? 0 : 2)} 起/小时`;
}

export function toVenueViewModel(venue: Venue, coverSource: string): VenueViewModel {
  const sortedImages = [...venue.profile.images].sort((left, right) => left.sortOrder - right.sortOrder);
  const cover = sortedImages.find((image) => image.role === "COVER");
  const hasCoverImage = coverSource.length > 0;

  return {
    bookingMode: "ONLINE",
    id: venue.id,
    name: venue.name,
    description: venue.profile.description,
    priceAdvantageText: venue.priceAdvantageText,
    businessHoursText: venue.businessHoursText,
    address: venue.address,
    parkingText: venue.parkingText,
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
    facilities: [...venue.profile.facilities]
      .sort((left, right) => left.sortOrder - right.sortOrder)
      .map((facility) => ({ code: facility.code, label: facility.name })),
    pitchTypes: venue.profile.pitchSizes.map((code) => ({
      code,
      label: code === "FIVE_A_SIDE" ? "五人制" : code === "SEVEN_A_SIDE" ? "七人制" : "十一人制",
    })),
    availabilityWindow: {
      startDate: venue.availabilityWindow.startDate,
      endDate: venue.availabilityWindow.endDate,
    },
    livePriceText: formatLivePrice(venue.profile.livePrice),
    availabilityLabel: venue.profile.availabilityTarget.label,
    availabilityEnabled: venue.profile.availabilityTarget.enabled,
  };
}

export function toOnlineDirectoryVenueViewModel(venue: OnlineVenueDetail): VenueViewModel {
  const coverSource = venue.profile.coverImage ?? "";
  return {
    bookingMode: "ONLINE",
    id: venue.id,
    name: venue.name,
    description: venue.profile.description,
    priceAdvantageText: venue.priceAdvantageText,
    businessHoursText: venue.businessHoursText,
    address: venue.address,
    parkingText: venue.parkingText,
    refundPolicySummary: venue.refundPolicySummary,
    cover: {
      alt: venue.name,
      source: coverSource,
      state: coverSource ? "image" : "fallback",
      className: coverSource ? "venue-cover--image" : "venue-cover--fallback",
      fallbackText: coverSource ? "" : "场馆图片待配置",
    },
    images: venue.profile.images.map((image) => ({ source: image.url, alt: image.alt, role: image.role })),
    facilities: venue.profile.facilities.map((facility) => ({ code: facility.code, label: facility.name })),
    pitchTypes: venue.profile.pitchSizes.map((code) => ({
      code,
      label: code === "FIVE_A_SIDE" ? "五人制" : code === "SEVEN_A_SIDE" ? "七人制" : "十一人制",
    })),
    availabilityWindow: venue.availabilityWindow,
    livePriceText: formatLivePrice(venue.profile.livePrice),
    availabilityLabel: venue.profile.availabilityTarget.label,
    availabilityEnabled: venue.profile.availabilityTarget.enabled,
  };
}

export function toDirectoryVenueViewModel(venue: DirectoryVenueDetail): DirectoryVenueViewModel {
  const stop = venue.nearestTransit[0];
  const transitText = stop
    ? `${stop.kind === "SUBWAY" ? "地铁" : "公交"} ${stop.lines.join("/")} · ${stop.name} · 约 ${stop.distanceMeters} 米`
    : "交通信息待核验";
  return {
    id: venue.id,
    bookingMode: "DIRECTORY_ONLY",
    bookingStatusText: "暂未接入在线预订",
    name: venue.name,
    description: venue.profile.description || "这里仅展示已核验的场馆与位置资料。",
    address: venue.address,
    businessHoursText: venue.businessHoursText ?? "营业时间待核验",
    parkingText: venue.parkingText ?? "停车信息待核验",
    transitText,
    pitchTypes: venue.profile.pitchSizes.map((code) => ({ code, label: code === "FIVE_A_SIDE" ? "五人制" : code === "SEVEN_A_SIDE" ? "七人制" : "十一人制" })),
    facilities: venue.profile.facilities.map((facility) => ({ code: facility.code, label: facility.name })),
    images: venue.profile.images.map((image) => ({ source: image.url, alt: image.alt, role: image.role })),
    livePriceText: "暂无在线价格",
    availabilityLabel: venue.profile.availabilityTarget.label,
    availabilityEnabled: false,
    cover: venue.profile.coverImage
      ? { alt: venue.name, source: venue.profile.coverImage, state: "image", className: "venue-cover--image", fallbackText: "" }
      : { alt: venue.name, source: "", state: "fallback", className: "venue-cover--fallback", fallbackText: "场馆图片待配置" },
  };
}
