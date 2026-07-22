import { ApiResponseError } from "./contracts";
import { decodeAvailability, decodeVenue } from "./decoders";

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

test("accepts RFC3339's case-insensitive t and z grammar", () => {
  const decoded = decodeAvailability({
    ...ready,
    generated_at: "2026-07-22t01:30:00z",
  });

  expect(decoded.generatedAt).toBe("2026-07-22t01:30:00z");
});

test("rejects a raw image URL containing backslashes", () => {
  const backslashUrl = String.raw`https:\\example.com\a.jpg`;
  expect(backslashUrl).toContain("\\");

  expect(() => decodeVenue({
    ...venue,
    images: [{ ...venue.images[0], url: backslashUrl }],
  })).toThrow("INVALID_API_RESPONSE");
});
