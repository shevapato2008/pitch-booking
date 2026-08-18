import { describe, expect, test } from "@jest/globals";

import type {
  CheckoutView,
  CreateOrderInput,
  ExpiredOrderView,
  PendingOrderView,
  UserSessionView,
} from "../domain/booking";
import {
  canPollClosingOrder,
  canSubmit,
  reduceBooking,
  validateContactName,
  type BookingPageState,
} from "./booking";

describe("closing order polling boundary", () => {
  test.each([
    [29_999, true],
    [30_000, false],
  ] as const)("at %dms returns %s", (elapsedMs, expected) => {
    expect(canPollClosingOrder(elapsedMs)).toBe(expected);
  });
});

test("a determined create failure returns the active attempt to editable idle", () => {
  const submitting = reduceBooking(readyState(), {
    type: "SUBMIT_STARTED",
    idempotencyKey: "key-failed",
    request: input,
  });
  expect(reduceBooking(submitting, { type: "SUBMIT_FAILED", idempotencyKey: "key-failed" }).submission).toEqual({ status: "idle" });
});

const session: UserSessionView = {
  userId: "user-1",
  maskedPhone: "138****8000",
};

const checkout: CheckoutView = {
  venueId: "venue-1",
  venueName: "滨江足球公园",
  pitchId: "pitch-1",
  pitchName: "五人制 A 场",
  slotId: "slot-1",
  startsAt: "2026-07-28T19:00:00+08:00",
  endsAt: "2026-07-28T20:30:00+08:00",
  priceCents: 36000,
  date: "2026-07-28",
  durationMinutes: 90,
  currency: "CNY",
  available: true,
  cancellationSummary: "开场前 24 小时可取消",
  lockDurationSeconds: 600,
  maskedPhone: session.maskedPhone,
  lastContactName: "张三",
  version: 12,
};

const input: CreateOrderInput = {
  slotId: checkout.slotId,
  checkoutVersion: checkout.version,
  contactName: "张三",
};

const order: PendingOrderView = {
  orderId: "order-1",
  orderNumber: "PB202607280001",
  status: "PENDING_PAYMENT",
  slotId: checkout.slotId,
  venue: { id: checkout.venueId, name: checkout.venueName, address: "地址", latitude: 31, longitude: 121 },
  pitch: { id: checkout.pitchId, name: checkout.pitchName },
  contact: { name: "张三", maskedPhone: "138****8000" },
  priceCents: checkout.priceCents,
  startsAt: checkout.startsAt,
  endsAt: checkout.endsAt,
  durationMinutes: checkout.durationMinutes,
  currency: "CNY",
  createdAt: "2026-07-28T18:00:00+08:00",
  expiresAt: "2026-07-28T18:10:00+08:00",
  expiredAt: null,
  cancellationSummary: checkout.cancellationSummary,
  closingPayment: false,
  detailPath: "/api/v1/orders/00000000-0000-4000-8000-000000000040",
};

const expiredOrder: ExpiredOrderView = {
  ...order,
  status: "EXPIRED",
  expiredAt: order.expiresAt,
};

const readyState = (
  overrides: Partial<BookingPageState> = {},
): BookingPageState => ({
  session: { status: "ready", value: session },
  checkout: { status: "ready", value: checkout },
  contactName: "张三",
  submission: { status: "idle" },
  ...overrides,
});

describe("validateContactName", () => {
  test("trims and returns the normalized valid name", () => {
    expect(validateContactName(" 张三 ")).toEqual({
      ok: true,
      normalized: "张三",
    });
  });

  test.each([
    "张三",
    "A1",
    "张三 Li",
    "阿·布",
    "Jean-Luc",
    "一".repeat(30),
  ])("accepts the allowed character set and 2–30 code-point boundary: %s", (name) => {
    expect(validateContactName(name)).toEqual({ ok: true, normalized: name });
  });

  test.each([
    ["pure whitespace", "   ", "too-short"],
    ["one character", "张", "too-short"],
    ["31 characters", "一".repeat(31), "too-long"],
    ["underscore", "张_三", "invalid-characters"],
    ["emoji", "张😀", "invalid-characters"],
    ["other punctuation", "张/三", "invalid-characters"],
  ] as const)("rejects %s with the exact reason", (_caseName, name, reason) => {
    expect(validateContactName(name)).toEqual({ ok: false, reason });
  });

  test("counts Unicode code points rather than UTF-16 code units", () => {
    const result = validateContactName(`${"张".repeat(29)}😀`);

    expect(result).toEqual({ ok: false, reason: "invalid-characters" });
  });
});

describe("canSubmit", () => {
  test("is true only when session, checkout, phone, name and idle submission are ready", () => {
    expect(canSubmit(readyState())).toBe(true);
  });

  test.each<readonly [string, BookingPageState]>([
    [
      "missing phone",
      readyState({
        session: { status: "ready", value: { ...session, maskedPhone: null } },
      }),
    ],
    ["invalid name", readyState({ contactName: "张" })],
    ["session loading", readyState({ session: { status: "loading" } })],
    [
      "session failed",
      readyState({ session: { status: "failed", message: "登录失败" } }),
    ],
    ["checkout loading", readyState({ checkout: { status: "loading" } })],
    [
      "checkout failed",
      readyState({ checkout: { status: "failed", message: "加载失败" } }),
    ],
    [
      "submitting",
      readyState({
        submission: {
          status: "submitting",
          idempotencyKey: "key-1",
          request: input,
        },
      }),
    ],
    [
      "result reconciliation",
      readyState({
        submission: {
          status: "result-reconciling",
          idempotencyKey: "key-1",
          request: input,
        },
      }),
    ],
    [
      "price change",
      readyState({
        submission: {
          status: "price-changed",
          idempotencyKey: "key-1",
          request: input,
          checkout: { ...checkout, priceCents: 38000 },
        },
      }),
    ],
    [
      "slot unavailable",
      readyState({
        submission: { status: "slot-unavailable", message: "已被预订" },
      }),
    ],
    [
      "created",
      readyState({ submission: { status: "created", order } }),
    ],
    [
      "expired",
      readyState({ submission: { status: "expired", order: expiredOrder } }),
    ],
  ])("is false for %s", (_caseName, state) => {
    expect(canSubmit(state)).toBe(false);
  });
});

describe("reduceBooking", () => {
  test("SUBMIT_RESTORED requires a session but not checkout readiness", () => {
    const checkoutLoading = readyState({ checkout: { status: "loading" } });
    const unauthenticated = readyState({
      session: { status: "loading" },
      checkout: { status: "loading" },
    });

    expect(reduceBooking(checkoutLoading, {
      type: "SUBMIT_RESTORED",
      idempotencyKey: "stored-key",
      request: input,
    }).submission).toEqual({
      status: "submitting",
      idempotencyKey: "stored-key",
      request: input,
    });
    expect(reduceBooking(unauthenticated, {
      type: "SUBMIT_RESTORED",
      idempotencyKey: "stored-key",
      request: input,
    })).toBe(unauthenticated);
  });

  test("CHECKOUT_READY backfills the last contact name only when the field is still blank", () => {
    const loading = readyState({
      checkout: { status: "loading" },
      contactName: "",
    });

    expect(
      reduceBooking(loading, { type: "CHECKOUT_READY", checkout }).contactName,
    ).toBe("张三");
    expect(
      reduceBooking(
        { ...loading, contactName: "李四" },
        { type: "CHECKOUT_READY", checkout },
      ).contactName,
    ).toBe("李四");
  });

  test("SUBMIT_STARTED stores the event-provided idempotency key and request intent", () => {
    const before = readyState();

    const after = reduceBooking(before, {
      type: "SUBMIT_STARTED",
      idempotencyKey: "key-1",
      request: input,
    });

    expect(after.submission).toEqual({
      status: "submitting",
      idempotencyKey: "key-1",
      request: input,
    });
    expect(before.submission).toEqual({ status: "idle" });
    expect(after).not.toBe(before);
  });

  test("SUBMIT_UNKNOWN reconciles the same request and SUBMIT_RETRY reuses the same key", () => {
    const submitting = reduceBooking(readyState(), {
      type: "SUBMIT_STARTED",
      idempotencyKey: "key-1",
      request: input,
    });

    const reconciling = reduceBooking(submitting, {
      type: "SUBMIT_UNKNOWN",
      idempotencyKey: "key-1",
    });
    expect(reconciling.submission).toEqual({
      status: "result-reconciling",
      idempotencyKey: "key-1",
      request: input,
    });

    const retrying = reduceBooking(reconciling, {
      type: "SUBMIT_RETRY",
      idempotencyKey: "key-1",
    });
    expect(retrying.submission).toEqual({
      status: "submitting",
      idempotencyKey: "key-1",
      request: input,
    });
  });

  test("accepting a server price change adopts checkout and clears the previous key", () => {
    const changedCheckout = { ...checkout, priceCents: 38000 };
    const submitting = reduceBooking(readyState(), {
      type: "SUBMIT_STARTED",
      idempotencyKey: "old-key",
      request: input,
    });

    const changed = reduceBooking(submitting, {
      type: "PRICE_CHANGED",
      idempotencyKey: "old-key",
      checkout: changedCheckout,
    });
    expect(changed.submission).toEqual({
      status: "price-changed",
      idempotencyKey: "old-key",
      request: input,
      checkout: changedCheckout,
    });

    const accepted = reduceBooking(changed, {
      type: "PRICE_CHANGE_ACCEPTED",
      idempotencyKey: "old-key",
    });
    expect(accepted.checkout).toEqual({ status: "ready", value: changedCheckout });
    expect(accepted.submission).toEqual({ status: "idle" });
    expect(JSON.stringify(accepted)).not.toContain("old-key");
  });

  test("represents slot unavailability and successful creation honestly", () => {
    const submitting = reduceBooking(readyState(), {
      type: "SUBMIT_STARTED",
      idempotencyKey: "key-1",
      request: input,
    });

    expect(
      reduceBooking(submitting, {
        type: "SLOT_UNAVAILABLE",
        idempotencyKey: "key-1",
        message: "该时段刚刚被预订",
      }).submission,
    ).toEqual({
      status: "slot-unavailable",
      message: "该时段刚刚被预订",
    });

    expect(
      reduceBooking(submitting, {
        type: "SUBMIT_SUCCEEDED",
        idempotencyKey: "key-1",
        order,
      }).submission,
    ).toEqual({ status: "created", order });
  });

  test("price-changed is stable when an unknown-result event arrives later", () => {
    const changedCheckout = { ...checkout, priceCents: 38000 };
    const changed = reduceBooking(
      reduceBooking(readyState(), {
        type: "SUBMIT_STARTED",
        idempotencyKey: "key-1",
        request: input,
      }),
      {
        type: "PRICE_CHANGED",
        idempotencyKey: "key-1",
        checkout: changedCheckout,
      },
    );

    expect(
      reduceBooking(changed, {
        type: "SUBMIT_UNKNOWN",
        idempotencyKey: "key-1",
      }),
    ).toBe(changed);
  });

  test("ignores stale result keys throughout an active attempt", () => {
    const submitting = reduceBooking(readyState(), {
      type: "SUBMIT_STARTED",
      idempotencyKey: "current-key",
      request: input,
    });
    const staleEvents = [
      { type: "SUBMIT_UNKNOWN", idempotencyKey: "stale-key" },
      { type: "PRICE_CHANGED", idempotencyKey: "stale-key", checkout },
      {
        type: "SLOT_UNAVAILABLE",
        idempotencyKey: "stale-key",
        message: "stale",
      },
      {
        type: "SUBMIT_SUCCEEDED",
        idempotencyKey: "stale-key",
        order,
      },
    ] as const;

    for (const event of staleEvents) {
      expect(reduceBooking(submitting, event)).toBe(submitting);
    }

    const reconciling = reduceBooking(submitting, {
      type: "SUBMIT_UNKNOWN",
      idempotencyKey: "current-key",
    });
    expect(
      reduceBooking(reconciling, {
        type: "SUBMIT_RETRY",
        idempotencyKey: "stale-key",
      }),
    ).toBe(reconciling);

    const changed = reduceBooking(submitting, {
      type: "PRICE_CHANGED",
      idempotencyKey: "current-key",
      checkout: { ...checkout, priceCents: 38000 },
    });
    expect(
      reduceBooking(changed, {
        type: "PRICE_CHANGE_ACCEPTED",
        idempotencyKey: "stale-key",
      }),
    ).toBe(changed);
  });

  test("terminal created state cannot be overwritten by late results", () => {
    const submitting = reduceBooking(readyState(), {
      type: "SUBMIT_STARTED",
      idempotencyKey: "key-1",
      request: input,
    });
    const created = reduceBooking(submitting, {
      type: "SUBMIT_SUCCEEDED",
      idempotencyKey: "key-1",
      order,
    });

    expect(
      reduceBooking(created, {
        type: "SLOT_UNAVAILABLE",
        idempotencyKey: "key-1",
        message: "late",
      }),
    ).toBe(created);
    expect(
      reduceBooking(created, {
        type: "SUBMIT_SUCCEEDED",
        idempotencyKey: "key-1",
        order: { ...order, orderId: "late-order" },
      }),
    ).toBe(created);
  });

  test("an old result cannot overwrite a newer active attempt", () => {
    const first = reduceBooking(readyState(), {
      type: "SUBMIT_STARTED",
      idempotencyKey: "old-key",
      request: input,
    });
    const changed = reduceBooking(first, {
      type: "PRICE_CHANGED",
      idempotencyKey: "old-key",
      checkout: { ...checkout, priceCents: 38000 },
    });
    const idleWithNewPrice = reduceBooking(changed, {
      type: "PRICE_CHANGE_ACCEPTED",
      idempotencyKey: "old-key",
    });
    const newer = reduceBooking(idleWithNewPrice, {
      type: "SUBMIT_STARTED",
      idempotencyKey: "new-key",
      request: { ...input, checkoutVersion: 13 },
    });

    expect(
      reduceBooking(newer, {
        type: "SUBMIT_SUCCEEDED",
        idempotencyKey: "old-key",
        order,
      }),
    ).toBe(newer);
  });

  test("expires only the matching currently-created order", () => {
    const submitting = reduceBooking(readyState(), {
      type: "SUBMIT_STARTED",
      idempotencyKey: "key-1",
      request: input,
    });
    const created = reduceBooking(submitting, {
      type: "SUBMIT_SUCCEEDED",
      idempotencyKey: "key-1",
      order,
    });

    expect(
      reduceBooking(created, {
        type: "ORDER_EXPIRED",
        orderId: "another-order",
        order: expiredOrder,
      }),
    ).toBe(created);
    expect(
      reduceBooking(created, {
        type: "ORDER_EXPIRED",
        orderId: order.orderId,
        order: expiredOrder,
      }).submission,
    ).toEqual({ status: "expired", order: expiredOrder });
  });

  test("starts only from a ready idle state", () => {
    const event = {
      type: "SUBMIT_STARTED",
      idempotencyKey: "key-1",
      request: input,
    } as const;
    const loading = readyState({ checkout: { status: "loading" } });
    expect(reduceBooking(loading, event)).toBe(loading);

    const submitting = reduceBooking(readyState(), event);
    expect(
      reduceBooking(submitting, {
        ...event,
        idempotencyKey: "replacement-key",
      }),
    ).toBe(submitting);
  });

  test("copies payload values so caller mutation cannot change stored state", () => {
    const mutableRequest = { ...input };
    const submitting = reduceBooking(readyState(), {
      type: "SUBMIT_STARTED",
      idempotencyKey: "key-1",
      request: mutableRequest,
    });
    mutableRequest.contactName = "李四";
    expect(submitting.submission).toMatchObject({ request: input });

    const mutableCheckout = { ...checkout, priceCents: 38000 };
    const changed = reduceBooking(submitting, {
      type: "PRICE_CHANGED",
      idempotencyKey: "key-1",
      checkout: mutableCheckout,
    });
    mutableCheckout.priceCents = 99999;
    expect(changed.submission).toMatchObject({ checkout: { priceCents: 38000 } });

    const mutableOrder = { ...order };
    const created = reduceBooking(submitting, {
      type: "SUBMIT_SUCCEEDED",
      idempotencyKey: "key-1",
      order: mutableOrder,
    });
    mutableOrder.orderId = "mutated-order";
    expect(created.submission).toMatchObject({ order: { orderId: "order-1" } });
  });
});
