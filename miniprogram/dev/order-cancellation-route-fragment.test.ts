import { expect, test } from "@jest/globals";

import { ORDER_CANCELLATION_ROUTE_FRAGMENT } from "./order-cancellation-route-fragment";

test("declares only existing owner order routes and one development token", () => {
  expect(ORDER_CANCELLATION_ROUTE_FRAGMENT).toEqual({
    pages: ["pages/order-detail/index", "pages/my-orders/index"],
    developmentTokens: ["order-cancellation-fixture"],
  });
  expect(new Set(ORDER_CANCELLATION_ROUTE_FRAGMENT.pages).size).toBe(2);
  expect(ORDER_CANCELLATION_ROUTE_FRAGMENT.pages.every((path: string) => !path.startsWith("/"))).toBe(true);
});
