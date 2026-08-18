import { afterEach, expect, jest, test } from "@jest/globals";

jest.mock("./fixture-data", () => ({
  FIXTURE_DATA: {
    "order-pending": jest.requireActual("../../contracts/examples/order-pending.json"),
  },
}));

import { getBookingDataSource, getNeutralPhoneTapCode, resetBookingDataSourceForTesting } from "../services/booking";
import { getPageDataSource } from "../services/page-data";
import { getPaymentBindings, resetPaymentBindingsForTesting } from "../services/payment";
import { getVenueDirectoryDataSource } from "../services/venue-directory";
import { getVenueProfileDataSource, resetVenueProfileBindingsForTesting } from "../services/venue-profile";
import { getVenueAccessDataSource, resetVenueAccessBindingsForTesting } from "../services/venue-access";
import { getVenueFulfillmentAttemptStore, resetVenueFulfillmentAttemptStoreForTesting } from "../services/venue-fulfillment-attempt-store";
import { getVenueFulfillmentDataSource, resetVenueFulfillmentBindingsForTesting } from "../services/venue-fulfillment";
import { bootstrapDevelopment } from "./bootstrap";
import { createDevelopmentHttpSources } from "./http-booking-source";

interface CheckoutExample { readonly slot_id: string }
interface PhoneExample { readonly masked_phone: string }
interface SessionExample {
  readonly session_token: string;
  readonly user: { readonly id: string };
}
interface VenueExample { readonly id: string }
interface PaymentExample { readonly payment_id: string }
interface OrderExample { readonly id: string }
const checkout = jest.requireActual<CheckoutExample>("../../contracts/examples/checkout-ready.json");
const phone = jest.requireActual<PhoneExample>("../../contracts/examples/phone-verified.json");
const session = jest.requireActual<SessionExample>("../../contracts/examples/wechat-session.json");
const venue = jest.requireActual<VenueExample>("../../contracts/examples/venue-primary.json");
const payment = jest.requireActual<PaymentExample>("../../contracts/examples/payment-prepay-created.json");
const confirming = jest.requireActual<PaymentExample>("../../contracts/examples/payment-confirming.json");
const confirmed = jest.requireActual<OrderExample>("../../contracts/examples/order-confirmed.json");
const venueMap = jest.requireActual<Record<string, unknown>>("../../contracts/examples/venue-map.json");
const venueDetail = jest.requireActual<Record<string, unknown>>("../../contracts/examples/venue-directory-detail.json");
const venueFulfillment = jest.requireActual<Record<string, unknown>>("../../contracts/examples/venue-fulfillment-orders.json");
const managedVenues = {
  venues: [{
    id: venue.id,
    name: "渤海元丰足球场",
    district_name: "西青区",
    address: "天津市西青区利达路",
  }],
};

interface RequestOptions {
  readonly url: string;
  readonly method: "GET" | "POST" | "PUT";
  readonly data?: unknown;
  readonly header?: Readonly<Record<string, string>>;
  readonly success: (response: { statusCode: number; data: unknown }) => void;
}

const requests: RequestOptions[] = [];

function installRequestRuntime(): void {
  const storage = new Map<string, unknown>();
  Object.defineProperty(globalThis, "wx", {
    configurable: true,
    value: {
      login(options: { readonly success: (result: { readonly code: string }) => void }) {
        options.success({ code: "real-wx-code" });
      },
      getStorageSync(key: string) { return storage.get(key); },
      setStorageSync(key: string, value: unknown) { storage.set(key, value); },
      removeStorageSync(key: string) { storage.delete(key); },
      request(options: RequestOptions) {
        requests.push(options);
        const path = new URL(options.url).pathname;
        const response = path === "/api/v1/auth/wechat/session" ? { statusCode: 200, data: session }
          : path === "/api/v1/auth/wechat/phone" ? phone
            : path.endsWith("/checkout") ? { statusCode: 200, data: checkout }
              : path.endsWith("/pay") ? { statusCode: 201, data: payment }
                : path.endsWith(`/payments/${payment.payment_id}/reconcile`) ? { statusCode: 202, data: confirming }
                  : path === `/api/v1/orders/${confirmed.id}` ? { statusCode: 200, data: confirmed }
                    : path === "/api/v1/venues/primary" ? { statusCode: 200, data: venue }
                      : path === "/api/v1/venues/map" ? { statusCode: 200, data: venueMap }
                        : path === `/api/v1/venues/${venueDetail.id}` ? { statusCode: 200, data: venueDetail }
                        : path === "/api/v1/admin/venues" ? { statusCode: 200, data: managedVenues }
                          : path.includes("/fulfillment/orders") ? { statusCode: 200, data: venueFulfillment }
                      : undefined;
        const normalized = "statusCode" in (response ?? {})
          ? response as { statusCode: number; data: unknown }
          : { statusCode: 200, data: response };
        options.success(response === undefined ? { statusCode: 404, data: undefined } : normalized);
      },
    },
  });
}

afterEach(() => {
  requests.length = 0;
  resetBookingDataSourceForTesting();
  resetPaymentBindingsForTesting();
  resetVenueProfileBindingsForTesting();
  resetVenueAccessBindingsForTesting();
  resetVenueFulfillmentBindingsForTesting();
  resetVenueFulfillmentAttemptStoreForTesting();
  Reflect.deleteProperty(globalThis, "wx");
});

test("development HTTP sources use the base URL, deterministic capabilities, and isolated memory sessions", async () => {
  installRequestRuntime();
  const first = createDevelopmentHttpSources("http://127.0.0.1:8000");

  await expect(first.pages.getVenue()).resolves.toMatchObject({ id: venue.id });
  await expect(first.venues.getVenueDirectory()).resolves.toHaveLength(5);
  await expect(first.booking.login()).resolves.toMatchObject({ userId: session.user.id });
  await expect(first.booking.getCheckout(checkout.slot_id)).resolves.toMatchObject({ slotId: checkout.slot_id });
  await expect(first.booking.authorizePhone("dev-phone-code")).resolves.toEqual({ maskedPhone: phone.masked_phone });
  await expect(first.booking.authorizePhone("not-the-dev-code")).rejects.toMatchObject({ code: "PHONE_REJECTED" });
  await expect(first.payment.createPayment(confirmed.id, "payment-attempt-1")).resolves.toMatchObject({
    outcome: "PREPAY_CREATED",
    paymentId: payment.payment_id,
  });
  await expect(first.payment.reconcilePayment(confirmed.id, payment.payment_id)).resolves.toMatchObject({
    outcome: "PAYMENT_CONFIRMING",
  });

  expect(requests.every(({ url }) => url.startsWith("http://127.0.0.1:8000/api/v1/"))).toBe(true);
  expect(requests.filter(({ url }) => url.endsWith("/auth/wechat/session"))).toHaveLength(1);
  expect(requests.find(({ url }) => url.endsWith("/auth/wechat/session"))?.data).toEqual({ code: "dev-login-code" });
  expect(requests.find(({ url }) => url.endsWith("/auth/wechat/phone"))?.data).toEqual({ code: "dev-phone-code" });
  expect(requests.find(({ url }) => url.endsWith("/checkout"))?.header).toEqual({ Authorization: `Bearer ${session.session_token}` });
  expect(requests.find(({ url }) => url.endsWith("/pay"))?.header).toEqual({
    Authorization: `Bearer ${session.session_token}`,
    "Idempotency-Key": "payment-attempt-1",
  });

  const second = createDevelopmentHttpSources("http://127.0.0.1:8000");
  await second.booking.getCheckout(checkout.slot_id);
  expect(requests.filter(({ url }) => url.endsWith("/auth/wechat/session"))).toHaveLength(2);
});

test("HTTP bootstrap registers both sources and the neutral development phone detail", async () => {
  installRequestRuntime();
  bootstrapDevelopment({ source: "http", apiBaseUrl: "http://localhost:8000" });

  expect(getNeutralPhoneTapCode()).toBe("dev-phone-code");
  await expect(getVenueProfileDataSource().get(String(venue.id))).rejects.toBeDefined();
  const sessions = requests.filter(({ url }) => url.endsWith("/auth/wechat/session"));
  expect(sessions[sessions.length - 1]?.data).toEqual({ code: "dev-login-code" });
  await expect(getVenueAccessDataSource().listManagedVenues()).resolves.toEqual([expect.objectContaining({
    id: venue.id,
    districtName: "西青区",
  })]);
  expect(getVenueFulfillmentAttemptStore()).toBeDefined();
  await expect(getVenueFulfillmentDataSource().listOrders(String(venue.id), "2026-07-28"))
    .resolves.toMatchObject({ venue: { id: venue.id }, orders: [expect.objectContaining({ maskedPhone: "138****5678" })] });
  await expect(getPageDataSource().getVenue()).resolves.toMatchObject({ id: venue.id });
  await expect(getVenueDirectoryDataSource().getVenueDetail(String(venueDetail.id)))
    .resolves.toMatchObject({ id: venueDetail.id });
  await expect(getBookingDataSource().login()).resolves.toMatchObject({ userId: session.user.id });
  await expect(getPaymentBindings()?.source.createPayment(confirmed.id, "bootstrap-attempt")).resolves.toMatchObject({
    outcome: "PREPAY_CREATED",
  });
  expect(getPaymentBindings()?.clock?.now().toISOString()).not.toBe("2026-07-27T04:00:00.000Z");
  expect(requests.every(({ url }) => url.startsWith("http://localhost:8000/api/v1/"))).toBe(true);
});

test("default fixture bootstrap registers a local order list that reopens its order detail", async () => {
  bootstrapDevelopment();
  const source = getBookingDataSource();

  expect(source.listOrders).toBeDefined();
  const result = await source.listOrders!();
  expect(result.orders).toHaveLength(1);
  await expect(source.getOrder(result.orders[0].orderId)).resolves.toMatchObject({
    orderId: result.orders[0].orderId,
    status: result.orders[0].status,
  });
});
