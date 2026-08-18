import { expect, jest, test } from "@jest/globals";

jest.mock("../dev/fixture-data", () => ({
  FIXTURE_DATA: {
    "booking-checkout-ready": jest.requireActual("../../contracts/examples/checkout-ready.json"),
    "order-pending": jest.requireActual("../../contracts/examples/order-pending.json"),
    "order-expired": jest.requireActual("../../contracts/examples/order-expired.json"),
  },
}));

import { createDevelopmentBookingDataSource } from "../dev/booking-source";
import { FIXTURE_DATA } from "../dev/fixture-data";
import type { CheckoutView, CreateOrderInput, UserSessionView } from "./booking";

test("nullable contact fields remain required in session and checkout views", () => {
  const session: UserSessionView = { userId: "user-1", maskedPhone: null };
  const checkout = {
    maskedPhone: null,
    lastContactName: null,
  } as Pick<CheckoutView, "maskedPhone" | "lastContactName">;
  expect(session).toHaveProperty("maskedPhone", null);
  expect(checkout).toEqual({ maskedPhone: null, lastContactName: null });
});

test("checkout and order views preserve the frozen contract fields", async () => {
  const source = createDevelopmentBookingDataSource();
  const checkout = await source.getCheckout("00000000-0000-4000-8000-000000000030");

  expect(checkout).toMatchObject({
    date: "2026-07-28",
    durationMinutes: 120,
    currency: "CNY",
    available: true,
    cancellationSummary: expect.any(String),
    lockDurationSeconds: 600,
    maskedPhone: "138****5678",
    lastContactName: "张三",
    version: 12,
  });

  const request = {
    slotId: checkout.slotId,
    checkoutVersion: checkout.version,
    contactName: "张三",
  } as CreateOrderInput;
  const order = await source.createOrder({ request, idempotencyKey: "foundation-key" });

  expect(Object.keys(request).sort()).toEqual(["checkoutVersion", "contactName", "slotId"]);
  expect(order).toMatchObject({
    orderNumber: "PB202607270001",
    status: "PENDING_PAYMENT",
    venue: { name: "浦东星跃足球公园" },
    pitch: { name: "五人制 A 场" },
    contact: { name: "张三", maskedPhone: "138****5678" },
    priceCents: 32000,
    createdAt: "2026-07-27T12:00:00+08:00",
    expiredAt: null,
    closingPayment: false,
    detailPath: "/api/v1/orders/00000000-0000-4000-8000-000000000040",
  });
  expect(order).not.toHaveProperty("contactName");
  expect(order).not.toHaveProperty("maskedPhone");
  expect(order).not.toHaveProperty("amountCents");
});

test("development checkout preserves canonical nullable contact values", async () => {
  const fixture = FIXTURE_DATA["booking-checkout-ready"] as { contact: { masked_phone: string | null; last_contact_name: string | null } };
  const previous = { ...fixture.contact };
  fixture.contact.masked_phone = null;
  fixture.contact.last_contact_name = null;
  try {
    await expect(createDevelopmentBookingDataSource().getCheckout("00000000-0000-4000-8000-000000000030"))
      .resolves.toMatchObject({ maskedPhone: null, lastContactName: null });
  } finally {
    fixture.contact = previous;
  }
});

test.each([
  ["pending status with expired timestamp", "order-pending", "PENDING_PAYMENT", "2026-07-27T12:10:01+08:00", "create"],
  ["expired status without expired timestamp", "order-expired", "EXPIRED", null, "detail"],
  ["pending fixture carrying expired status", "order-pending", "EXPIRED", null, "create"],
  ["expired fixture carrying pending status", "order-expired", "PENDING_PAYMENT", "2026-07-27T12:10:01+08:00", "detail"],
] as const)("rejects %s", async (_label, fixtureName, status, expiredAt, operation) => {
  const fixture = FIXTURE_DATA[fixtureName] as { status: string; expired_at: string | null };
  const previous = { status: fixture.status, expiredAt: fixture.expired_at };
  fixture.status = status;
  fixture.expired_at = expiredAt;
  try {
    const source = createDevelopmentBookingDataSource({ order: "expired" });
    const request = { slotId: "00000000-0000-4000-8000-000000000030", checkoutVersion: 12, contactName: "张三" };
    const action = operation === "create"
      ? source.createOrder({ request, idempotencyKey: `invalid-${fixtureName}` })
      : source.getOrder("00000000-0000-4000-8000-000000000041");
    await expect(action).rejects.toThrow("DEVELOPMENT_ORDER_FIXTURE_INVALID");
  } finally {
    fixture.status = previous.status;
    fixture.expired_at = previous.expiredAt;
  }
});
