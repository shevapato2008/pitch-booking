/// <reference types="node" />

import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

import type { VenueMapEntry } from "../domain/venue-directory";
import {
  calculateMapViewport,
  createRequestGenerationGuard,
  formatDistanceFromUser,
  toVenueMapPresentation,
} from "./venue-map";

function decodeRgbaPng(asset: Buffer): { width: number; height: number; pixels: Buffer } {
  const width = asset.readUInt32BE(16);
  const height = asset.readUInt32BE(20);
  expect(asset[24]).toBe(8);
  expect(asset[25]).toBe(6);
  expect(asset[28]).toBe(0);
  const idat: Buffer[] = [];
  for (let offset = 8; offset < asset.length;) {
    const length = asset.readUInt32BE(offset);
    const type = asset.subarray(offset + 4, offset + 8).toString("ascii");
    if (type === "IDAT") idat.push(asset.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const source = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const pixels = Buffer.alloc(stride * height);
  const paeth = (left: number, above: number, upperLeft: number) => {
    const estimate = left + above - upperLeft;
    const leftDistance = Math.abs(estimate - left);
    const aboveDistance = Math.abs(estimate - above);
    const upperLeftDistance = Math.abs(estimate - upperLeft);
    if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left;
    return aboveDistance <= upperLeftDistance ? above : upperLeft;
  };
  for (let y = 0; y < height; y += 1) {
    const sourceRow = y * (stride + 1);
    const targetRow = y * stride;
    const filter = source[sourceRow];
    for (let x = 0; x < stride; x += 1) {
      const raw = source[sourceRow + x + 1];
      const left = x >= 4 ? pixels[targetRow + x - 4] : 0;
      const above = y > 0 ? pixels[targetRow + x - stride] : 0;
      const upperLeft = y > 0 && x >= 4 ? pixels[targetRow + x - stride - 4] : 0;
      const predictor = filter === 0 ? 0
        : filter === 1 ? left
          : filter === 2 ? above
            : filter === 3 ? Math.floor((left + above) / 2)
              : paeth(left, above, upperLeft);
      pixels[targetRow + x] = (raw + predictor) & 0xff;
    }
  }
  return { width, height, pixels };
}

function pinShapePath(source: string): string {
  const tag = source.match(/<path\b[^>]*\bid="pin-shape"[^>]*>/)?.[0];
  expect(tag).toBeDefined();
  const path = tag?.match(/\bd="([^"]+)"/)?.[1];
  expect(path).toBeDefined();
  return path!;
}

const online: VenueMapEntry = {
  id: "online",
  slug: "online-pitch",
  sortOrder: 0,
  name: "渤海元丰足球场",
  address: "天津市西青区利达路",
  bookingMode: "ONLINE",
  marker: { coordinateSystem: "GCJ02", latitude: 39.000867, longitude: 117.212396 },
  navigation: {
    poiName: "天津市渤海元丰科技有限公司-南门",
    coordinate: { coordinateSystem: "GCJ02", latitude: 39.000157, longitude: 117.212208 },
  },
  pitchTypes: [],
  coverImage: null,
  nearestTransit: [],
  contentVerifiedAt: "2026-07-30T18:15:00+08:00",
};

const directory: VenueMapEntry = {
  id: "directory",
  slug: "directory-pitch",
  sortOrder: 1,
  name: "天津奥林匹克中心五人制足球场",
  address: "天津市南开区宾水西道1号",
  bookingMode: "DIRECTORY_ONLY",
  marker: { coordinateSystem: "GCJ02", latitude: 39.074524, longitude: 117.176641 },
  navigation: {
    poiName: "天津奥林匹克中心体育馆",
    coordinate: { coordinateSystem: "GCJ02", latitude: 39.077539, longitude: 117.178054 },
  },
  pitchTypes: ["FIVE_A_SIDE"],
  coverImage: null,
  nearestTransit: [{
    id: "subway-tiyuzhongxin-line-5",
    kind: "SUBWAY",
    name: "体育中心站",
    coordinate: { coordinateSystem: "GCJ02", latitude: 39.073861, longitude: 117.172379 },
    lines: ["5号线"],
    distanceMeters: 420,
    distanceBasis: "MAP_VERIFIED",
  }],
  contentVerifiedAt: "2026-07-30T18:15:00+08:00",
};

describe("venue map presentation", () => {
  test("preserves supplied order across cards, markers, and all-venue viewport points", () => {
    const source = [{ ...directory, id: "zulu", name: "乙球场", sortOrder: undefined }, { ...online, id: "alpha", name: "甲球场", sortOrder: undefined }];
    const original = JSON.stringify(source);

    const view = toVenueMapPresentation(source, null, {}, null);

    expect(view.markers.map(({ venueId }) => venueId)).toEqual(["zulu", "alpha"]);
    expect(view.cards.map(({ venueId }) => venueId)).toEqual(["zulu", "alpha"]);
    expect(view.viewport).toEqual({ mode: "ALL", includePoints: [source[0].marker, source[1].marker] });
    expect(JSON.stringify(source)).toBe(original);
  });

  test("maps booking modes to distinct marker assets, labels, and actions", () => {
    const view = toVenueMapPresentation([online, directory], null, {}, null);

    expect(view.markers).toEqual(expect.arrayContaining([
      expect.objectContaining({ venueId: "online", label: "可订", iconPath: "/assets/map-marker-online.png" }),
      expect.objectContaining({ venueId: "directory", label: "场馆", iconPath: "/assets/map-marker-directory.png" }),
    ]));
    expect(view.cards).toEqual(expect.arrayContaining([
      expect.objectContaining({ venueId: "online", statusText: "可在线预订", action: "VIEW_AVAILABILITY" }),
      expect.objectContaining({ venueId: "directory", statusText: "仅提供场馆信息", action: "VIEW_DETAIL" }),
    ]));
  });

  test("keeps the selected marker and card synchronized", () => {
    const view = toVenueMapPresentation([online, directory], directory.id, {}, null);

    expect(view.selectedVenueId).toBe(directory.id);
    expect(view.markers.find(({ selected }) => selected)?.venueId).toBe(directory.id);
    expect(view.markers.find(({ venueId }) => venueId === directory.id)?.iconPath)
      .toBe("/assets/map-marker-directory-selected.png");
    expect(view.cards.find(({ selected }) => selected)?.venueId).toBe(directory.id);
  });

  test("falls back from an invalid selection and exposes all-venue viewport points", () => {
    const view = toVenueMapPresentation([online, directory], "missing", {}, null);

    expect(view.selectedVenueId).toBeNull();
    expect(view.viewport).toEqual(calculateMapViewport([online, directory], null));
    expect(view.viewport).toMatchObject({ mode: "ALL", includePoints: [online.marker, directory.marker] });
  });

  test("focuses a valid deep link at a deterministic map scale", () => {
    expect(calculateMapViewport([online, directory], directory.id)).toEqual({
      mode: "FOCUSED",
      latitude: directory.marker.latitude,
      longitude: directory.marker.longitude,
      scale: 16,
    });
  });

  test("formats local straight-line distance and keeps no-location state empty", () => {
    expect(formatDistanceFromUser(null, directory.marker)).toBeNull();
    expect(formatDistanceFromUser(directory.marker, directory.marker)).toBe("距你不到 50 米");
    expect(formatDistanceFromUser(
      { coordinateSystem: "GCJ02", latitude: 39.074524, longitude: 117.170641 },
      directory.marker,
    )).toMatch(/^距你 \d{3} 米$/);
    expect(formatDistanceFromUser(online.marker, directory.marker)).toMatch(/^距你 \d+\.\d 公里$/);
  });

  test("uses an honest fallback when transit data is empty", () => {
    const view = toVenueMapPresentation([online, directory], null, {}, null);

    expect(view.cards.find(({ venueId }) => venueId === online.id)?.transitText).toBe("交通信息待核验");
    expect(view.cards.find(({ venueId }) => venueId === directory.id)?.transitText)
      .toBe("地铁 5号线 · 体育中心站 · 约 420 米");
  });

  test("formats explicit user and POI distance bases and omits distance without a basis", () => {
    expect(toVenueMapPresentation([online], null, { online: 1_250 }, { kind: "USER" }).cards[0].distanceText)
      .toBe("距你 1.3 公里");
    expect(toVenueMapPresentation([online], null, { online: 420 }, { kind: "POI", label: "天津站" }).cards[0].distanceText)
      .toBe("距天津站 420 米");
    expect(toVenueMapPresentation([online], null, { online: 420 }, null).cards[0].distanceText)
      .toBeNull();
  });
});

test("request generation guard rejects late responses and invalidates on unload", () => {
  const guard = createRequestGenerationGuard();
  const first = guard.begin();
  const second = guard.begin();

  expect(guard.isCurrent(first)).toBe(false);
  expect(guard.isCurrent(second)).toBe(true);
  guard.invalidate();
  expect(guard.isCurrent(second)).toBe(false);
});

test("packages four visually distinct local PNG marker states", () => {
  const variants = [
    { name: "map-marker-online", variant: "online-filled", selected: false, width: 64, height: 80 },
    { name: "map-marker-online-selected", variant: "online-filled", selected: true, width: 72, height: 88 },
    { name: "map-marker-directory", variant: "directory-outline", selected: false, width: 64, height: 80 },
    { name: "map-marker-directory-selected", variant: "directory-outline", selected: true, width: 72, height: 88 },
  ];
  const assets = variants.map(({ name }) => readFileSync(`miniprogram/assets/${name}.png`));

  variants.forEach(({ name, variant, selected, width, height }, index) => {
    const source = readFileSync(`artifacts/ui/sources/map-markers/${name}.svg`, "utf8");
    expect(source).toContain(`data-variant="${variant}"`);
    expect(source).toContain(`data-selected="${selected}"`);
    expect(assets[index].readUInt32BE(16)).toBe(width);
    expect(assets[index].readUInt32BE(20)).toBe(height);
    const decoded = decodeRgbaPng(assets[index]);
    const alphaAt = (x: number, y: number) => decoded.pixels[(y * width + x) * 4 + 3];
    expect(decoded.pixels.some((channel, channelIndex) => channelIndex % 4 === 3 && channel === 0)).toBe(true);
    expect([
      alphaAt(0, 0), alphaAt(width - 1, 0),
      alphaAt(0, height - 1), alphaAt(width - 1, height - 1),
    ]).toEqual([0, 0, 0, 0]);
  });

  expect(assets.map((asset) => asset.subarray(1, 4).toString("ascii")))
    .toEqual(["PNG", "PNG", "PNG", "PNG"]);
  expect(new Set(assets.map((asset) => asset.toString("base64"))).size).toBe(4);
});

test("shares one pin silhouette between booking variants in each marker state", () => {
  const source = (name: string) => readFileSync(`artifacts/ui/sources/map-markers/${name}.svg`, "utf8");

  expect(pinShapePath(source("map-marker-online")))
    .toBe(pinShapePath(source("map-marker-directory")));
  expect(pinShapePath(source("map-marker-online-selected")))
    .toBe(pinShapePath(source("map-marker-directory-selected")));
});
