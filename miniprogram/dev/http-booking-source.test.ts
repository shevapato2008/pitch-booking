import { afterEach, expect, jest, test } from "@jest/globals";

import { getBookingDataSource, getNeutralPhoneTapCode, resetBookingDataSourceForTesting } from "../services/booking";
import { getPageDataSource } from "../services/page-data";
import { bootstrapDevelopment } from "./bootstrap";
import { createDevelopmentHttpSources } from "./http-booking-source";

interface CheckoutExample { readonly slot_id: string }
interface PhoneExample { readonly masked_phone: string }
interface SessionExample {
  readonly session_token: string;
  readonly user: { readonly id: string };
}
interface VenueExample { readonly id: string }
const checkout = jest.requireActual<CheckoutExample>("../../contracts/examples/checkout-ready.json");
const phone = jest.requireActual<PhoneExample>("../../contracts/examples/phone-verified.json");
const session = jest.requireActual<SessionExample>("../../contracts/examples/wechat-session.json");
const venue = jest.requireActual<VenueExample>("../../contracts/examples/venue-primary.json");

interface RequestOptions {
  readonly url: string;
  readonly method: "GET" | "POST";
  readonly data?: unknown;
  readonly header?: Readonly<Record<string, string>>;
  readonly success: (response: { statusCode: number; data: unknown }) => void;
}

const requests: RequestOptions[] = [];

function installRequestRuntime(): void {
  Object.defineProperty(globalThis, "wx", {
    configurable: true,
    value: {
      request(options: RequestOptions) {
        requests.push(options);
        const path = new URL(options.url).pathname;
        const response = path === "/api/v1/auth/wechat/session" ? session
          : path === "/api/v1/auth/wechat/phone" ? phone
            : path.endsWith("/checkout") ? checkout
              : path === "/api/v1/venues/primary" ? venue
                : undefined;
        options.success({ statusCode: response === undefined ? 404 : 200, data: response });
      },
    },
  });
}

afterEach(() => {
  requests.length = 0;
  resetBookingDataSourceForTesting();
  Reflect.deleteProperty(globalThis, "wx");
});

test("development HTTP sources use the base URL, deterministic capabilities, and isolated memory sessions", async () => {
  installRequestRuntime();
  const first = createDevelopmentHttpSources("http://127.0.0.1:8000");

  await expect(first.pages.getVenue()).resolves.toMatchObject({ id: venue.id });
  await expect(first.booking.login()).resolves.toMatchObject({ userId: session.user.id });
  await expect(first.booking.getCheckout(checkout.slot_id)).resolves.toMatchObject({ slotId: checkout.slot_id });
  await expect(first.booking.authorizePhone("dev-phone-code")).resolves.toEqual({ maskedPhone: phone.masked_phone });
  await expect(first.booking.authorizePhone("not-the-dev-code")).rejects.toMatchObject({ code: "PHONE_REJECTED" });

  expect(requests.every(({ url }) => url.startsWith("http://127.0.0.1:8000/api/v1/"))).toBe(true);
  expect(requests.filter(({ url }) => url.endsWith("/auth/wechat/session"))).toHaveLength(1);
  expect(requests.find(({ url }) => url.endsWith("/auth/wechat/session"))?.data).toEqual({ code: "dev-login-code" });
  expect(requests.find(({ url }) => url.endsWith("/auth/wechat/phone"))?.data).toEqual({ code: "dev-phone-code" });
  expect(requests.find(({ url }) => url.endsWith("/checkout"))?.header).toEqual({ Authorization: `Bearer ${session.session_token}` });

  const second = createDevelopmentHttpSources("http://127.0.0.1:8000");
  await second.booking.getCheckout(checkout.slot_id);
  expect(requests.filter(({ url }) => url.endsWith("/auth/wechat/session"))).toHaveLength(2);
});

test("HTTP bootstrap registers both sources and the neutral development phone detail", async () => {
  installRequestRuntime();
  bootstrapDevelopment({ source: "http", apiBaseUrl: "http://localhost:8000" });

  expect(getNeutralPhoneTapCode()).toBe("dev-phone-code");
  await expect(getPageDataSource().getVenue()).resolves.toMatchObject({ id: venue.id });
  await expect(getBookingDataSource().login()).resolves.toMatchObject({ userId: session.user.id });
  expect(requests.every(({ url }) => url.startsWith("http://localhost:8000/api/v1/"))).toBe(true);
});
