import { expect, jest, test } from "@jest/globals";

import { ApiResponseError } from "./contracts";
import {
  decodeApiError,
  decodeAvailability,
  decodeCheckout,
  decodeOrder,
  decodePhoneVerification,
  decodeWeChatSession,
  decodeVenue,
} from "./decoders";

interface SlotExample {
  id: string;
  starts_at: string;
  ends_at: string;
  price_cents: number;
  status: string;
  unavailable_reason: string | null;
}

interface ReadyExample {
  venue_id: string;
  timezone: string;
  date: string;
  pitch_type: string;
  availability_window: { start_date: string; end_date: string };
  pitches: Array<{
    id: string;
    name: string;
    pitch_type: string;
    sort_order: number;
    slots: SlotExample[];
  }>;
  generated_at: string;
}

interface VenueExample {
  id: string;
  name: string;
  description: string;
  price_advantage_text: string;
  timezone: string;
  business_hours_text: string;
  address: string;
  latitude: number;
  longitude: number;
  parking_text: string;
  phone: string;
  refund_policy_summary: string;
  images: Array<{ url: string; alt: string; role: string; sort_order: number }>;
  facilities: Array<{ code: string; name: string; sort_order: number }>;
  pitch_types: Array<{ code: string; name: string; sort_order: number }>;
  availability_window: { start_date: string; end_date: string };
  generated_at: string;
}

const venue = jest.requireActual<VenueExample>("../../contracts/examples/venue-primary.json");
const ready = jest.requireActual<ReadyExample>("../../contracts/examples/availability-ready.json");
const session = jest.requireActual<Record<string, unknown>>("../../contracts/examples/wechat-session.json");
const phone = jest.requireActual<Record<string, unknown>>("../../contracts/examples/phone-verified.json");
const checkout = jest.requireActual<Record<string, unknown>>("../../contracts/examples/checkout-ready.json");
const pendingOrder = jest.requireActual<Record<string, unknown>>("../../contracts/examples/order-pending.json");
const expiredOrder = jest.requireActual<Record<string, unknown>>("../../contracts/examples/order-expired.json");
const priceChanged = jest.requireActual<Record<string, unknown>>("../../contracts/examples/error-price-changed.json");

const firstSlot = ready.pitches[0].slots[0];
const withSlot = (slot: object) => ({
  ...ready,
  pitches: [{ ...ready.pitches[0], slots: [slot] }],
});
const withoutKey = <T extends object>(value: T, key: keyof T): object => {
  const copy = { ...value };
  Reflect.deleteProperty(copy, key);
  return copy;
};

test("decodes canonical responses to camel-case view DTOs", () => {
  const decodedVenue = decodeVenue(venue);
  const decodedAvailability = decodeAvailability(ready);

  expect(decodedVenue).toMatchObject({
    id: venue.id,
    priceAdvantageText: venue.price_advantage_text,
    businessHoursText: venue.business_hours_text,
    availabilityWindow: { startDate: "2026-07-22", endDate: "2026-08-04" },
    generatedAt: venue.generated_at,
  });
  expect(decodedVenue.pitchTypes[0]).toMatchObject({ code: "FIVE_A_SIDE", sortOrder: 0 });
  expect(decodedAvailability).toMatchObject({
    venueId: ready.venue_id,
    pitchType: "FIVE_A_SIDE",
    pitchGroups: [{ id: ready.pitches[0].id, sortOrder: 0 }],
    generatedAt: ready.generated_at,
  });
  expect(decodedAvailability.pitchGroups[0].slots[0]).toMatchObject({
    startsAt: firstSlot.starts_at,
    endsAt: firstSlot.ends_at,
    priceCents: firstSlot.price_cents,
    unavailableReason: firstSlot.unavailable_reason,
  });
});

test.each([
  ["unknown key", { ...ready, unexpected: true }],
  ["missing field", withoutKey(ready, "generated_at")],
  ["bad UUID", { ...ready, venue_id: "not-a-uuid" }],
  ["unknown status", withSlot({ ...firstSlot, status: "UNKNOWN" })],
  ["fractional price", withSlot({ ...firstSlot, price_cents: 1.5 })],
  ["negative price", withSlot({ ...firstSlot, price_cents: -1 })],
  ["bad timestamp", withSlot({ ...firstSlot, starts_at: "2026-07-22 09:00" })],
  ["reversed time", withSlot({ ...firstSlot, starts_at: firstSlot.ends_at, ends_at: firstSlot.starts_at })],
  ["wrong reason", withSlot({ ...firstSlot, status: "BOOKED", unavailable_reason: null })],
  ["unexpected nested key", withSlot({ ...firstSlot, debug: true })],
  ["missing nested field", withSlot(withoutKey(firstSlot, "id"))],
  ["bad pitch type", { ...ready, pitch_type: "ELEVEN_A_SIDE" }],
  ["bad date", { ...ready, date: "2026-7-22" }],
  ["timestamp without zone", { ...ready, generated_at: "2026-07-22T09:30:00" }],
  ["timestamp with invalid offset", { ...ready, generated_at: "2026-07-22T09:30:00+24:00" }],
])("rejects corrupt availability: %s", (_name, value) => {
  expect(() => decodeAvailability(value)).toThrow("INVALID_API_RESPONSE");
});

test.each([
  ["unknown venue key", { ...venue, unexpected: true }],
  ["missing cover", { ...venue, images: venue.images.filter((image) => image.role !== "COVER") }],
  ["duplicate cover", { ...venue, images: [...venue.images, venue.images[0]] }],
  ["non-HTTPS image", { ...venue, images: [{ ...venue.images[0], url: "http://unsafe.test/a.jpg" }] }],
  ["uppercase HTTPS scheme", { ...venue, images: [{ ...venue.images[0], url: "HTTPS://example.test/a.jpg" }] }],
  ["relative image", { ...venue, images: [{ ...venue.images[0], url: "/cover.jpg" }] }],
  ["image credentials", { ...venue, images: [{ ...venue.images[0], url: "https://user:pass@example.test/a.jpg" }] }],
  ["malformed image host", { ...venue, images: [{ ...venue.images[0], url: "https://[bad]/a.jpg" }] }],
  ["whitespace in image URL", { ...venue, images: [{ ...venue.images[0], url: "https://example.test/a b.jpg" }] }],
  ["bare percent in image URL", { ...venue, images: [{ ...venue.images[0], url: "https://example.test/%.jpg" }] }],
  ["invalid percent escape", { ...venue, images: [{ ...venue.images[0], url: "https://example.test/%2G.jpg" }] }],
  ["raw Unicode host", { ...venue, images: [{ ...venue.images[0], url: "https://例子.test/a.jpg" }] }],
  ["raw Unicode path", { ...venue, images: [{ ...venue.images[0], url: "https://example.test/主图.jpg" }] }],
  ["unsupported port", { ...venue, images: [{ ...venue.images[0], url: "https://example.test:443/a.jpg" }] }],
  ["single-label host", { ...venue, images: [{ ...venue.images[0], url: "https://localhost/a.jpg" }] }],
  ["bad image role", { ...venue, images: [{ ...venue.images[0], role: "THUMBNAIL" }] }],
  ["fractional sort order", { ...venue, facilities: [{ ...venue.facilities[0], sort_order: 0.5 }] }],
  ["empty required text", { ...venue, name: "" }],
  ["bad latitude", { ...venue, latitude: 91 }],
  ["bad generated timestamp", { ...venue, generated_at: "22 July" }],
  ["missing nested field", { ...venue, images: [withoutKey(venue.images[0], "alt")] }],
])("rejects corrupt venue: %s", (_name, value) => {
  expect(() => decodeVenue(value)).toThrow("INVALID_API_RESPONSE");
});

test.each([
  ["AVAILABLE", null],
  ["TEMPORARILY_LOCKED", "HELD_FOR_PAYMENT"],
  ["BOOKED", "ALREADY_BOOKED"],
  ["CLOSED", "VENUE_CLOSED"],
  ["EXPIRED", "TIME_PASSED"],
])("accepts the exact %s unavailable-reason correlation", (status, unavailableReason) => {
  expect(() => decodeAvailability(withSlot({
    ...firstSlot,
    status,
    unavailable_reason: unavailableReason,
  }))).not.toThrow();
});

test("reports the precise corrupt response path and stable code", () => {
  try {
    decodeAvailability(withSlot({ ...firstSlot, price_cents: 1.5 }));
    throw new Error("decoder unexpectedly accepted corrupt data");
  } catch (error) {
    expect(error).toBeInstanceOf(ApiResponseError);
    expect(error).toMatchObject({
      code: "INVALID_API_RESPONSE",
      path: "$.pitches[0].slots[0].price_cents",
    });
  }
});

test("strictly decodes session, phone, checkout and both order states", () => {
  expect(decodeWeChatSession(session)).toMatchObject({
    token: session.session_token,
    expiresAt: session.expires_at,
    user: { userId: "00000000-0000-4000-8000-000000000001", maskedPhone: null },
  });
  expect(decodePhoneVerification(phone)).toEqual({
    maskedPhone: "138****5678",
    verifiedAt: "2026-07-27T12:00:00+08:00",
  });
  expect(decodeCheckout(checkout)).toMatchObject({
    venueName: "浦东星跃足球公园",
    pitchName: "五人制 A 场",
    priceCents: 32000,
    version: 12,
  });
  expect(decodeOrder(pendingOrder)).toMatchObject({ status: "PENDING_PAYMENT", expiredAt: null });
  expect(decodeOrder(expiredOrder)).toMatchObject({ status: "EXPIRED", expiredAt: expect.any(String) });
});

test("accepts a 40-code-unit order contact name and rejects 41", () => {
  const forty = "张".repeat(40);
  expect(decodeOrder({
    ...pendingOrder,
    contact: { ...(pendingOrder.contact as object), name: forty },
  }).contact.name).toBe(forty);
  expect(() => decodeOrder({
    ...pendingOrder,
    contact: { ...(pendingOrder.contact as object), name: `${forty}张` },
  })).toThrow("INVALID_API_RESPONSE");
});

test("counts astral Han characters as single code points for contact maxLength", () => {
  const forty = "𠀀".repeat(40);
  expect(decodeOrder({
    ...pendingOrder,
    contact: { ...(pendingOrder.contact as object), name: forty },
  }).contact.name).toBe(forty);
});

test.each([
  ["session extra key", decodeWeChatSession, { ...session, debug: true }],
  ["session short token", decodeWeChatSession, { ...session, session_token: "short" }],
  ["phone malformed mask", decodePhoneVerification, { ...phone, masked_phone: "13800005678" }],
  ["checkout extra nested key", decodeCheckout, { ...checkout, contact: { ...(checkout.contact as object), raw_phone: "secret" } }],
  ["checkout reversed time", decodeCheckout, { ...checkout, ends_at: checkout.starts_at }],
  ["pending with expired_at", decodeOrder, { ...pendingOrder, expired_at: expiredOrder.expired_at }],
  ["expired without expired_at", decodeOrder, { ...expiredOrder, expired_at: null }],
  ["order wrong detail path", decodeOrder, { ...pendingOrder, detail_path: "/api/v1/orders/not-it" }],
] as const)("rejects corrupt wire DTO: %s", (_label, decode, value) => {
  expect(() => decode(value)).toThrow("INVALID_API_RESPONSE");
});

test("decodes PRICE_CHANGED using current_checkout and never trusts message text", () => {
  const decoded = decodeApiError(priceChanged);
  expect(decoded).toMatchObject({
    code: "PRICE_CHANGED",
    details: { checkout: { priceCents: 36000, version: 13 } },
  });
  expect(decoded).not.toHaveProperty("message");
});

test.each([
  { unexpected: true },
  { error: { code: "UNKNOWN", message: "x", request_id: "r", details: {} } },
  { error: { code: "PRICE_CHANGED", message: "x", request_id: "r", details: {} } },
  { error: { code: "AUTH_REQUIRED", message: "x", request_id: "r", details: { current_checkout: checkout } } },
])("rejects malformed error envelopes", (value) => {
  expect(() => decodeApiError(value)).toThrow("INVALID_API_RESPONSE");
});

test("accepts RFC3339's case-insensitive t and z grammar", () => {
  const decoded = decodeAvailability({
    ...ready,
    generated_at: "2026-07-22t01:30:00z",
  });

  expect(decoded.generatedAt).toBe("2026-07-22t01:30:00z");
});

test.each([
  "0000-02-29T23:59:60Z",
  "0099-03-01T00:00:00Z",
  "2000-02-29T00:00:00+08:00",
])("accepts RFC3339 calendar edge %s", (generatedAt) => {
  expect(decodeAvailability({ ...ready, generated_at: generatedAt }).generatedAt)
    .toBe(generatedAt);
});

test.each([
  "0099-02-29T00:00:00Z",
  "1900-02-29T00:00:00Z",
  "2026-04-31T00:00:00Z",
  "2026-01-01T22:59:60Z",
  "2026-01-01T23:58:60Z",
  "2026-01-01T00:00:61Z",
])("rejects invalid RFC3339 calendar/time %s", (generatedAt) => {
  expect(() => decodeAvailability({ ...ready, generated_at: generatedAt }))
    .toThrow("INVALID_API_RESPONSE");
});

test("orders a valid 23:59 leap second before the following instant", () => {
  expect(() => decodeAvailability(withSlot({
    ...firstSlot,
    starts_at: "2026-07-22T23:59:60+08:00",
    ends_at: "2026-07-22T16:00:00Z",
  }))).not.toThrow();
});

test("orders slot instants across mixed offsets", () => {
  expect(() => decodeAvailability(withSlot({
    ...firstSlot,
    starts_at: "2026-07-22T09:00:00+08:00",
    ends_at: "2026-07-22T02:00:00Z",
  }))).not.toThrow();
  expect(() => decodeAvailability(withSlot({
    ...firstSlot,
    starts_at: "2026-07-22T10:00:00+08:00",
    ends_at: "2026-07-22T03:00:00+02:00",
  }))).toThrow("INVALID_API_RESPONSE");
});

test("accepts chronologically ordered mixed-offset slot collections", () => {
  const slots = [
    {
      ...ready.pitches[0].slots[0],
      starts_at: "2026-07-22T10:00:00+08:00",
      ends_at: "2026-07-22T10:30:00+08:00",
    },
    {
      ...ready.pitches[0].slots[1],
      starts_at: "2026-07-22T03:00:00Z",
      ends_at: "2026-07-22T03:30:00Z",
    },
  ];

  expect(() => decodeAvailability({
    ...ready,
    pitches: [{ ...ready.pitches[0], slots }],
  })).not.toThrow();
});

test("rejects reverse chronological mixed-offset slots at the later item path", () => {
  const slots = [
    {
      ...ready.pitches[0].slots[0],
      starts_at: "2026-07-22T03:00:00Z",
      ends_at: "2026-07-22T03:30:00Z",
    },
    {
      ...ready.pitches[0].slots[1],
      starts_at: "2026-07-22T10:00:00+08:00",
      ends_at: "2026-07-22T10:30:00+08:00",
    },
  ];

  expectApiPath(
    () => decodeAvailability({ ...ready, pitches: [{ ...ready.pitches[0], slots }] }),
    "$.pitches[0].slots[1].starts_at",
  );
});

test("rejects a raw image URL containing backslashes", () => {
  const backslashUrl = String.raw`https:\\example.com\a.jpg`;
  expect(backslashUrl).toContain("\\");

  expect(() => decodeVenue({
    ...venue,
    images: [{ ...venue.images[0], url: backslashUrl }],
  })).toThrow("INVALID_API_RESPONSE");
});

test("validates media URLs without a global URL implementation", () => {
  const originalUrl = globalThis.URL;
  Object.defineProperty(globalThis, "URL", { configurable: true, value: undefined });
  try {
    expect(decodeVenue(venue).images[0].url).toBe(venue.images[0].url);
  } finally {
    Object.defineProperty(globalThis, "URL", { configurable: true, value: originalUrl });
  }
});

test("accepts the documented ASCII media URL grammar", () => {
  const url = "https://cdn.example.com/a%20b.jpg?size=large#cover";
  const decoded = decodeVenue({
    ...venue,
    images: [{ ...venue.images[0], url }],
  });

  expect(decoded.images[0].url).toBe(url);
});

test("canonical venue DTO is exactly camelCase and view-safe", () => {
  expect(decodeVenue(venue)).toStrictEqual({
    id: venue.id,
    name: venue.name,
    description: venue.description,
    priceAdvantageText: venue.price_advantage_text,
    timezone: venue.timezone,
    businessHoursText: venue.business_hours_text,
    address: venue.address,
    latitude: venue.latitude,
    longitude: venue.longitude,
    parkingText: venue.parking_text,
    phone: venue.phone,
    refundPolicySummary: venue.refund_policy_summary,
    images: venue.images.map((image) => ({
      url: image.url, alt: image.alt, role: image.role, sortOrder: image.sort_order,
    })),
    facilities: venue.facilities.map((facility) => ({
      code: facility.code, name: facility.name, sortOrder: facility.sort_order,
    })),
    pitchTypes: venue.pitch_types.map((pitchType) => ({
      code: pitchType.code, name: pitchType.name, sortOrder: pitchType.sort_order,
    })),
    availabilityWindow: {
      startDate: venue.availability_window.start_date,
      endDate: venue.availability_window.end_date,
    },
    generatedAt: venue.generated_at,
  });
});

test("canonical availability DTO is exactly camelCase and view-safe", () => {
  expect(decodeAvailability(ready)).toStrictEqual({
    venueId: ready.venue_id,
    timezone: ready.timezone,
    date: ready.date,
    pitchType: ready.pitch_type,
    availabilityWindow: {
      startDate: ready.availability_window.start_date,
      endDate: ready.availability_window.end_date,
    },
    pitchGroups: ready.pitches.map((pitch) => ({
      id: pitch.id,
      name: pitch.name,
      pitchType: pitch.pitch_type,
      sortOrder: pitch.sort_order,
      slots: pitch.slots.map((slot) => ({
        id: slot.id,
        startsAt: slot.starts_at,
        endsAt: slot.ends_at,
        priceCents: slot.price_cents,
        status: slot.status,
        unavailableReason: slot.unavailable_reason,
      })),
    })),
    generatedAt: ready.generated_at,
  });
});

const expectApiPath = (decode: () => unknown, path: string) => {
  try {
    decode();
    throw new Error("decoder unexpectedly accepted corrupt data");
  } catch (error) {
    expect(error).toBeInstanceOf(ApiResponseError);
    expect(error).toMatchObject({ code: "INVALID_API_RESPONSE", path });
  }
};

test.each([
  ["images", { ...venue, images: [venue.images[1], venue.images[0], venue.images[2]] }, "$.images[1].sort_order"],
  ["facilities", { ...venue, facilities: [venue.facilities[1], venue.facilities[0], ...venue.facilities.slice(2)] }, "$.facilities[1].sort_order"],
  ["pitch types", { ...venue, pitch_types: [venue.pitch_types[1], venue.pitch_types[0]] }, "$.pitch_types[1].sort_order"],
])("rejects unsorted venue %s at its exact path", (_name, value, path) => {
  expectApiPath(() => decodeVenue(value), path);
});

test("rejects an availability date outside its window", () => {
  expectApiPath(() => decodeAvailability({ ...ready, date: "2026-08-05" }), "$.date");
});

test("rejects a child pitch type that differs from the filter", () => {
  const value = { ...ready, pitches: [{ ...ready.pitches[0], pitch_type: "SEVEN_A_SIDE" }] };
  expectApiPath(() => decodeAvailability(value), "$.pitches[0].pitch_type");
});

test("rejects unsorted pitch groups", () => {
  const later = { ...ready.pitches[0], sort_order: 1 };
  const value = { ...ready, pitches: [later, ready.pitches[0]] };
  expectApiPath(() => decodeAvailability(value), "$.pitches[1].sort_order");
});

test("rejects unsorted slots", () => {
  const slots = [ready.pitches[0].slots[1], ready.pitches[0].slots[0], ...ready.pitches[0].slots.slice(2)];
  const value = { ...ready, pitches: [{ ...ready.pitches[0], slots }] };
  expectApiPath(() => decodeAvailability(value), "$.pitches[0].slots[1].starts_at");
});

test("rejects a slot outside the requested local date", () => {
  const slot = { ...firstSlot, ends_at: "2026-07-23T00:30:00+08:00" };
  expectApiPath(() => decodeAvailability(withSlot(slot)), "$.pitches[0].slots[0].ends_at");
});

test("rejects overlapping slots", () => {
  const slots = ready.pitches[0].slots.map((slot, index) => index === 1
    ? { ...slot, starts_at: "2026-07-22T09:30:00+08:00" }
    : slot);
  const value = { ...ready, pitches: [{ ...ready.pitches[0], slots }] };
  expectApiPath(() => decodeAvailability(value), "$.pitches[0].slots[1].starts_at");
});

test.each([
  ["top-level", () => decodeAvailability({ ...ready, venue_id: "bad" }), "$.venue_id"],
  ["nested", () => decodeAvailability(withSlot({ ...firstSlot, price_cents: 1.5 })), "$.pitches[0].slots[0].price_cents"],
  ["cross-field", () => decodeAvailability({
    ...ready,
    pitches: [{ ...ready.pitches[0], pitch_type: "SEVEN_A_SIDE" }],
  }), "$.pitches[0].pitch_type"],
])("reports exact ApiResponseError path for %s failures", (_name, decode, path) => {
  expectApiPath(decode, path);
});

test.each([
  ["unknown top-level field", () => decodeVenue({ ...venue, unexpected: true }), "$.unexpected"],
  ["missing top-level field", () => decodeVenue(withoutKey(venue, "generated_at")), "$.generated_at"],
  ["invalid cover count", () => decodeVenue({
    ...venue,
    images: venue.images.filter((image) => image.role !== "COVER"),
  }), "$.images"],
])("reports exact path for %s", (_name, decode, path) => {
  expectApiPath(decode, path);
});
