import { expect, test } from "@jest/globals";

import type { Venue } from "../domain/contracts";
import { toVenueViewModel } from "./venue";

const venue: Venue = {
  id: "venue-1",
  name: "西青示范足球场",
  profile: {
    publicationState: "PUBLISHED", publishedVersion: 1, description: "场馆介绍",
    coverImage: "https://cdn.test/cover.jpg",
    images: [
      { url: "https://cdn.test/gallery-2.jpg", alt: "七人制场地", role: "GALLERY", sortOrder: 2 },
      { url: "https://cdn.test/cover.jpg", alt: "主场地", role: "COVER", sortOrder: 0 },
      { url: "https://cdn.test/gallery-1.jpg", alt: "五人制场地", role: "GALLERY", sortOrder: 1 },
    ],
    facilities: [
      { code: "PARKING", name: "停车场", sortOrder: 1 },
      { code: "LIGHTING", name: "专业夜场照明", sortOrder: 0 },
    ],
    pitchSizes: ["FIVE_A_SIDE", "SEVEN_A_SIDE"],
    livePrice: { available: true, fromPriceCents: 36000, currency: "CNY", unit: "HOUR" },
    availabilityTarget: { enabled: true, label: "查看可订时段", path: "/api/v1/venues/venue-1/availability" },
  },
  priceAdvantageText: "工作日白天低至 ¥360/小时",
  timezone: "Asia/Shanghai",
  businessHoursText: "09:00—23:00",
  address: "天津市西青区示范路 1 号",
  latitude: 39,
  longitude: 117,
  parkingText: "院内停车",
  refundPolicySummary: "开场前按规则退款",
  pitchTypes: [
    { code: "SEVEN_A_SIDE", name: "七人制", sortOrder: 1 },
    { code: "FIVE_A_SIDE", name: "五人制", sortOrder: 0 },
  ],
  availabilityWindow: { startDate: "2026-07-22", endDate: "2026-08-04" },
  generatedAt: "2026-07-22T10:30:00+08:00",
};

test("sorts images and display labels without mutating the decoded venue", () => {
  const original = JSON.stringify(venue);

  const view = toVenueViewModel(venue, "/dev/assets/venue-cover.png");

  expect(view.images.map((image) => image.alt)).toEqual(["主场地", "五人制场地", "七人制场地"]);
  expect(view.facilities).toEqual([
    { code: "LIGHTING", label: "专业夜场照明" },
    { code: "PARKING", label: "停车场" },
  ]);
  expect(view.pitchTypes).toEqual([
    { code: "FIVE_A_SIDE", label: "五人制" },
    { code: "SEVEN_A_SIDE", label: "七人制" },
  ]);
  expect(JSON.stringify(venue)).toBe(original);
});

test("preserves the server-authored price advantage text exactly", () => {
  expect(toVenueViewModel(venue, "/cover.png").priceAdvantageText)
    .toBe("工作日白天低至 ¥360/小时");
});

test("derives deterministic image and fallback cover states from the injected source", () => {
  expect(toVenueViewModel(venue, "/dev/assets/venue-cover.png").cover).toEqual({
    alt: "主场地",
    source: "/dev/assets/venue-cover.png",
    state: "image",
    className: "venue-cover--image",
    fallbackText: "",
  });
  expect(toVenueViewModel(venue, "").cover).toEqual({
    alt: "主场地",
    source: "",
    state: "fallback",
    className: "venue-cover--fallback",
    fallbackText: "场馆图片待配置",
  });
  expect(toVenueViewModel(venue, "").cover).toEqual(toVenueViewModel(venue, "").cover);
});
