import type {
  FacilityCode,
  ImageRole,
  PitchType,
  Venue,
} from "../domain/contracts";

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

export function toVenueViewModel(venue: Venue, coverSource: string): VenueViewModel {
  const sortedImages = [...venue.images].sort((left, right) => left.sortOrder - right.sortOrder);
  const cover = sortedImages.find((image) => image.role === "COVER");
  const hasCoverImage = coverSource.length > 0;

  return {
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
