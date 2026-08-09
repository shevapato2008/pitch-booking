import { describe, expect, jest, test } from "@jest/globals";

jest.mock("../dev/fixture-data", () => ({
  FIXTURE_DATA: {
    "booking-checkout-ready": jest.requireActual("../../contracts/examples/checkout-ready.json"),
    "order-pending": jest.requireActual("../../contracts/examples/order-pending.json"),
    "order-expired": jest.requireActual("../../contracts/examples/order-expired.json"),
    "venue-map": jest.requireActual("../../contracts/examples/venue-map.json"),
    "venue-ready": jest.requireActual("../../contracts/examples/venue-primary.json"),
    "venue-online-detail": jest.requireActual("../../contracts/examples/venue-online-detail.json"),
    "venue-directory-detail": jest.requireActual("../../contracts/examples/venue-directory-detail.json"),
  },
}));

import type { BookingDataSource, CreateOrderAttempt } from "./booking";
import { getBookingDataSource, registerBookingDataSource, resetBookingDataSourceForTesting } from "./booking";
import { createDevelopmentBookingDataSource } from "../dev/booking-source";
import { bootstrapDevelopment } from "../dev/bootstrap";
import { getVenueDirectoryDataSource } from "./venue-directory";

describe("booking data source registry", () => {
  test("fails closed before registration", () => {
    resetBookingDataSourceForTesting();
    expect(() => getBookingDataSource()).toThrow("BOOKING_DATA_SOURCE_NOT_CONFIGURED");
  });

  test("returns the registered narrow source", async () => {
    const source: BookingDataSource = createDevelopmentBookingDataSource();
    registerBookingDataSource(source);
    await expect(getBookingDataSource().getCheckout("slot-1")).resolves.toMatchObject({ slotId: "slot-1" });
  });

  test("each development bootstrap registers fresh provider state", async () => {
    bootstrapDevelopment();
    await getBookingDataSource().authorizePhone("dev-phone-code");
    expect((await getBookingDataSource().login()).maskedPhone).toBe("138****5678");
    bootstrapDevelopment();
    expect((await getBookingDataSource().login()).maskedPhone).toBeNull();
  });

  test("fixture development bootstrap registers the venue directory", async () => {
    bootstrapDevelopment();
    const source = getVenueDirectoryDataSource();
    const previewDirectory = await source.getVenueDirectory();
    expect(previewDirectory).toHaveLength(100);
    await expect(source.getVenueDetail("7e68d7d8-4b7e-4f04-a5c5-3fe263e69c6f")).resolves.toMatchObject({
      bookingMode: "ONLINE",
      coverImage: null,
      availabilityWindow: { startDate: "2026-07-22", endDate: "2026-08-04" },
    });
    await expect(source.getVenueDetail("e03d801d-1254-5c62-9a16-9a8800280162")).resolves.toMatchObject({
      bookingMode: "DIRECTORY_ONLY",
    });
    await expect(source.getVenueDetail("c0372328-6fa4-585a-b951-3324925763d6")).resolves.toMatchObject({
      id: "c0372328-6fa4-585a-b951-3324925763d6",
      name: "东丽体育中心足球场",
      bookingMode: "DIRECTORY_ONLY",
    });

    const previewOnline = previewDirectory.find(({ bookingMode }) => bookingMode === "ONLINE");
    const previewInformationOnly = previewDirectory.find(({ bookingMode }) => bookingMode === "DIRECTORY_ONLY");
    expect(previewOnline).toBeDefined();
    expect(previewInformationOnly).toBeDefined();
    await expect(source.getVenueDetail(previewOnline!.id)).resolves.toMatchObject({
      id: previewOnline!.id,
      name: previewOnline!.name,
      bookingMode: "ONLINE",
      pitchTypes: ["FIVE_A_SIDE", "SEVEN_A_SIDE"],
      availabilityWindow: { startDate: "2026-07-22", endDate: "2026-08-04" },
    });
    const directoryDetail = await source.getVenueDetail(previewInformationOnly!.id);
    expect(directoryDetail).toMatchObject({
      id: previewInformationOnly!.id,
      name: previewInformationOnly!.name,
      bookingMode: "DIRECTORY_ONLY",
    });
    expect(directoryDetail).not.toHaveProperty("availabilityWindow");
    expect(directoryDetail).not.toHaveProperty("districtCode");
    expect(directoryDetail).not.toHaveProperty("districtName");
  });
});

const asAttempt = (request: CreateOrderAttempt["request"], idempotencyKey = "attempt-1"): CreateOrderAttempt => ({ request, idempotencyKey });

describe("development booking source scenarios", () => {
  test("returns independent checkout and order clones", async () => {
    const source = createDevelopmentBookingDataSource();
    const first = await source.getCheckout("00000000-0000-4000-8000-000000000030");
    expect(first).toMatchObject({
      venueName: "浦东星跃足球公园",
      pitchName: "五人制 A 场",
      startsAt: "2026-07-28T19:00:00+08:00",
      endsAt: "2026-07-28T21:00:00+08:00",
      priceCents: 32000,
    });
    (first as { venueName: string }).venueName = "mutated";
    expect((await source.getCheckout(first.slotId)).venueName).toBe("浦东星跃足球公园");
    await source.authorizePhone("dev-phone-code");
    const input = { slotId: first.slotId, checkoutVersion: first.version, contactName: "张三" };
    const order = await source.createOrder(asAttempt(input));
    expect(order.contact.maskedPhone).toBe("138****5678");
    (order.contact as { name: string }).name = "mutated-contact";
    (order.venue as { name: string }).name = "mutated-venue";
    const replay = await source.createOrder(asAttempt(input));
    expect(replay).toMatchObject({
      contact: { name: "张三" },
      venue: { name: "浦东星跃足球公园" },
    });
    (replay.contact as { name: string }).name = "mutated-replay-contact";
    (replay.venue as { name: string }).name = "mutated-replay-venue";
    await expect(source.createOrder(asAttempt(input))).resolves.toMatchObject({
      contact: { name: "张三" },
      venue: { name: "浦东星跃足球公园" },
    });
    await expect(source.getOrder(order.orderId)).resolves.toMatchObject({
      contact: { name: "张三" },
      venue: { name: "浦东星跃足球公园" },
    });
  });

  test.each(["login-failure", "checkout-failure"] as const)("%s fails once and then retries", async (scenario) => {
    const source = createDevelopmentBookingDataSource({ [scenario === "login-failure" ? "login" : "checkout"]: scenario });
    const operation = scenario === "login-failure" ? () => source.login() : () => source.getCheckout("00000000-0000-4000-8000-000000000030");
    await expect(operation()).rejects.toThrow();
    await expect(operation()).resolves.toBeDefined();
  });

  test("unknown create response replays the same request to success", async () => {
    const source = createDevelopmentBookingDataSource({ create: "unknown-response" });
    const input = { slotId: "00000000-0000-4000-8000-000000000030", checkoutVersion: 12, contactName: "张三" };
    await expect(source.createOrder(asAttempt(input, "same-key"))).rejects.toMatchObject({ code: "SUBMISSION_RESULT_UNKNOWN" });
    await expect(source.createOrder(asAttempt(input, "same-key"))).resolves.toMatchObject({ contact: { name: "张三" }, priceCents: 32000 });
  });

  test("price and availability scenarios expose stable business codes", async () => {
    const input = { slotId: "00000000-0000-4000-8000-000000000030", checkoutVersion: 12, contactName: "张三" };
    const changed = createDevelopmentBookingDataSource({ create: "price-changed" });
    await expect(changed.createOrder(asAttempt(input, "old-key"))).rejects.toMatchObject({ code: "PRICE_CHANGED" });
    await expect(changed.createOrder(asAttempt({ ...input, checkoutVersion: 13 }, "new-key"))).resolves.toMatchObject({ priceCents: 38000 });
    await expect(createDevelopmentBookingDataSource({ create: "slot-unavailable" }).createOrder(asAttempt(input))).rejects.toMatchObject({ code: "SLOT_NOT_AVAILABLE" });
  });

  test("phone and contact scenarios remain explicit", async () => {
    await expect(createDevelopmentBookingDataSource({ phone: "phone-rejected" }).authorizePhone("dev-phone-code")).rejects.toMatchObject({ code: "PHONE_REJECTED" });
    await expect(createDevelopmentBookingDataSource({ phone: "phone-unavailable" }).authorizePhone("dev-phone-code")).rejects.toMatchObject({ code: "PHONE_CAPABILITY_UNAVAILABLE" });
    await expect(createDevelopmentBookingDataSource().authorizePhone("real-or-wrong-code")).rejects.toMatchObject({ code: "PHONE_REJECTED" });
    await expect(createDevelopmentBookingDataSource({ create: "invalid-contact" }).createOrder(asAttempt({ slotId: "00000000-0000-4000-8000-000000000030", checkoutVersion: 12, contactName: "张三" }))).rejects.toMatchObject({ code: "INVALID_CONTACT" });
  });

  test("closing stays pending first and expires only on a later server response", async () => {
    const source = createDevelopmentBookingDataSource({ order: "closing" });
    const first = await source.getOrder("00000000-0000-4000-8000-000000000040");
    expect(first.status).toBe("PENDING_PAYMENT");
    const second = await source.getOrder("00000000-0000-4000-8000-000000000040");
    expect(second.status).toBe("EXPIRED");
  });

  test("closing failure can retry to a server-confirmed expiry", async () => {
    const source = createDevelopmentBookingDataSource({ order: "closing-failure" });
    await expect(source.getOrder("00000000-0000-4000-8000-000000000040")).rejects.toMatchObject({ code: "ORDER_REFRESH_FAILED" });
    await expect(source.getOrder("00000000-0000-4000-8000-000000000040")).resolves.toHaveProperty("expiredAt");
  });

  test("creates a fresh ten-minute stable lock and replays by idempotency key", async () => {
    let now = Date.parse("2026-07-27T10:00:00.000Z");
    const source = createDevelopmentBookingDataSource({}, () => now);
    await source.authorizePhone("dev-phone-code");
    const request = { slotId: "00000000-0000-4000-8000-000000000030", checkoutVersion: 12, contactName: "张三" };
    const created = await source.createOrder(asAttempt(request, "stable-key"));
    expect(created.expiresAt).toBe("2026-07-27T10:10:00.000Z");
    now += 30_000;
    await expect(source.createOrder(asAttempt(request, "stable-key"))).resolves.toEqual(created);
    await expect(source.getOrder(created.orderId)).resolves.toEqual(created);
  });

  test("expired scenario never reports a future expiredAt", async () => {
    const now = Date.parse("2026-07-27T10:00:00.000Z");
    const source = createDevelopmentBookingDataSource({ order: "expired" }, () => now);
    const expired = await source.getOrder("00000000-0000-4000-8000-000000000040");
    expect(expired.status === "EXPIRED" && Date.parse(expired.expiredAt) <= now).toBe(true);
  });
});
