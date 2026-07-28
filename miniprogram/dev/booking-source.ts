import type { ExpiredOrderView, PendingOrderView } from "../domain/booking";
import type { BookingDataSource, CreateOrderAttempt } from "../services/booking";
import { packagedFixtureLoader } from "./fixture-transport";

interface CheckoutFixture {
  slot_id: string;
  venue: { id: string; name: string };
  pitch: { id: string; name: string };
  starts_at: string;
  ends_at: string;
  price_cents: number;
  date: string;
  duration_minutes: number;
  currency: "CNY";
  available: true;
  cancellation_summary: string;
  lock_duration_seconds: number;
  contact: { masked_phone: string | null; last_contact_name: string | null };
  checkout_version: number;
}

interface OrderFixture {
  id: string;
  order_number: string;
  status: "PENDING_PAYMENT" | "EXPIRED";
  slot_id: string;
  venue: { id: string; name: string; address: string; latitude: number; longitude: number; customer_service_phone: string };
  pitch: { id: string; name: string };
  contact: { name: string; masked_phone: string };
  starts_at: string;
  ends_at: string;
  duration_minutes: number;
  price_cents: number;
  currency: "CNY";
  created_at: string;
  expires_at: string;
  expired_at: string | null;
  cancellation_summary: string;
  closing_payment: boolean;
  detail_path: string;
}

const bookingSession = { userId: "00000000-0000-4000-8000-000000000001", maskedPhone: null };

function checkoutFixture() {
  const fixture = packagedFixtureLoader.load("booking-checkout-ready") as CheckoutFixture;
  return {
    venueId: fixture.venue.id,
    venueName: fixture.venue.name,
    pitchId: fixture.pitch.id,
    pitchName: fixture.pitch.name,
    slotId: fixture.slot_id,
    startsAt: fixture.starts_at,
    endsAt: fixture.ends_at,
    priceCents: fixture.price_cents,
    date: fixture.date,
    durationMinutes: fixture.duration_minutes,
    currency: fixture.currency,
    available: fixture.available,
    cancellationSummary: fixture.cancellation_summary,
    lockDurationSeconds: fixture.lock_duration_seconds,
    maskedPhone: fixture.contact.masked_phone,
    lastContactName: fixture.contact.last_contact_name,
    version: fixture.checkout_version,
  };
}

function authorizedMaskedPhone(): string {
  const fixture = packagedFixtureLoader.load("booking-checkout-ready") as CheckoutFixture;
  if (fixture.contact.masked_phone === null) throw new Error("DEVELOPMENT_CHECKOUT_FIXTURE_INVALID");
  return fixture.contact.masked_phone;
}

function orderFixture(name: "order-pending" | "order-expired"): PendingOrderView | ExpiredOrderView {
  const fixture = packagedFixtureLoader.load(name) as OrderFixture;
  const base = {
    orderId: fixture.id,
    orderNumber: fixture.order_number,
    slotId: fixture.slot_id,
    venue: { id: fixture.venue.id, name: fixture.venue.name, address: fixture.venue.address, latitude: fixture.venue.latitude, longitude: fixture.venue.longitude, customerServicePhone: fixture.venue.customer_service_phone },
    pitch: { ...fixture.pitch },
    contact: { name: fixture.contact.name, maskedPhone: fixture.contact.masked_phone },
    priceCents: fixture.price_cents,
    startsAt: fixture.starts_at,
    endsAt: fixture.ends_at,
    durationMinutes: fixture.duration_minutes,
    currency: fixture.currency,
    createdAt: fixture.created_at,
    expiresAt: fixture.expires_at,
    cancellationSummary: fixture.cancellation_summary,
    closingPayment: fixture.closing_payment,
    detailPath: fixture.detail_path,
  };
  if (fixture.status === "PENDING_PAYMENT" && fixture.expired_at === null) {
    return { ...base, status: fixture.status, expiredAt: fixture.expired_at };
  }
  if (fixture.status === "EXPIRED" && typeof fixture.expired_at === "string") {
    return { ...base, status: fixture.status, expiredAt: fixture.expired_at };
  }
  throw new Error("DEVELOPMENT_ORDER_FIXTURE_INVALID");
}

function pendingFixture(): PendingOrderView {
  const fixture = orderFixture("order-pending");
  if (fixture.status !== "PENDING_PAYMENT") throw new Error("DEVELOPMENT_ORDER_FIXTURE_INVALID");
  return fixture;
}

function expiredFixture(): ExpiredOrderView {
  const fixture = orderFixture("order-expired");
  if (fixture.status !== "EXPIRED") throw new Error("DEVELOPMENT_ORDER_FIXTURE_INVALID");
  return fixture;
}

export type DevelopmentBookingScenario = "ready" | "login-failure" | "checkout-failure" | "phone-rejected" | "phone-unavailable" | "invalid-contact" | "price-changed" | "slot-unavailable" | "unknown-response" | "closing" | "closing-failure" | "expired";
export interface DevelopmentBookingScenarioFlags { login?: DevelopmentBookingScenario; checkout?: DevelopmentBookingScenario; phone?: DevelopmentBookingScenario; create?: DevelopmentBookingScenario; order?: DevelopmentBookingScenario; }
function businessError(code: string, details?: unknown): Error & { code: string; details?: unknown } { return Object.assign(new Error(code), { code, details }); }
function cloneOrder<T extends PendingOrderView | ExpiredOrderView>(order: T): T {
  return { ...order, venue: { ...order.venue }, pitch: { ...order.pitch }, contact: { ...order.contact } };
}

export function createDevelopmentBookingDataSource(flags: DevelopmentBookingScenarioFlags = {}, now: () => number = Date.now): BookingDataSource {
  let loginCalls = 0; let checkoutCalls = 0; let createCalls = 0; let orderCalls = 0; let authorizedPhone: string | null = null;
  const ordersByKey = new Map<string, PendingOrderView>();
  const ordersById = new Map<string, PendingOrderView>();
  const unknownKeys = new Set<string>();
  let previewOrder: PendingOrderView | undefined;
  const pendingPreview = (orderId = pendingFixture().orderId): PendingOrderView => {
    previewOrder ??= cloneOrder({ ...pendingFixture(), orderId, expiresAt: new Date(now() + 10 * 60_000).toISOString() });
    return cloneOrder(previewOrder);
  };
  const expired = (pending: PendingOrderView, expiredAt = now()): ExpiredOrderView => cloneOrder({
    ...expiredFixture(), orderId: pending.orderId, slotId: pending.slotId,
    venue: { ...pending.venue }, pitch: { ...pending.pitch }, contact: { ...pending.contact },
    priceCents: pending.priceCents, startsAt: pending.startsAt,
    endsAt: pending.endsAt, expiredAt: new Date(Math.min(expiredAt, now())).toISOString(),
  });
  return {
    async login() { loginCalls += 1; if (flags.login === "login-failure" && loginCalls === 1) throw businessError("LOGIN_FAILED"); return { ...bookingSession, maskedPhone: authorizedPhone }; },
    async getCheckout(slotId) { checkoutCalls += 1; if (flags.checkout === "checkout-failure" && checkoutCalls === 1) throw businessError("CHECKOUT_FAILED"); return { ...checkoutFixture(), slotId }; },
    async authorizePhone(rawDetail) { if (flags.phone === "phone-unavailable") throw businessError("PHONE_CAPABILITY_UNAVAILABLE"); if (flags.phone === "phone-rejected" || rawDetail !== "dev-phone-code") throw businessError("PHONE_REJECTED"); authorizedPhone = authorizedMaskedPhone(); return { maskedPhone: authorizedPhone }; },
    async createOrder(attempt: CreateOrderAttempt) {
      const { request: input, idempotencyKey } = attempt;
      const replay = ordersByKey.get(idempotencyKey);
      if (replay) return cloneOrder(replay);
      createCalls += 1;
      if (flags.create === "invalid-contact") throw businessError("INVALID_CONTACT");
      if (flags.create === "slot-unavailable") throw businessError("SLOT_NOT_AVAILABLE");
      if (flags.create === "price-changed" && createCalls === 1) throw businessError("PRICE_CHANGED", { checkout: { ...checkoutFixture(), slotId: input.slotId, priceCents: 38000, version: input.checkoutVersion + 1 } });
      const pending = pendingFixture();
      const priceCents = input.checkoutVersion > checkoutFixture().version ? 38000 : checkoutFixture().priceCents;
      const maskedPhone = authorizedPhone ?? pending.contact.maskedPhone;
      const order: PendingOrderView = { ...pending, slotId: input.slotId, contact: { name: input.contactName, maskedPhone }, priceCents, expiresAt: new Date(now() + 10 * 60_000).toISOString() };
      ordersByKey.set(idempotencyKey, cloneOrder(order));
      ordersById.set(order.orderId, cloneOrder(order));
      if (flags.create === "unknown-response" && !unknownKeys.has(idempotencyKey)) { unknownKeys.add(idempotencyKey); throw businessError("SUBMISSION_RESULT_UNKNOWN"); }
      return cloneOrder(order);
    },
    async getOrder(orderId): Promise<PendingOrderView | ExpiredOrderView> {
      orderCalls += 1;
      if (flags.order === "closing-failure" && orderCalls === 1) throw businessError("ORDER_REFRESH_FAILED");
      const stored = ordersById.get(orderId);
      const pending = cloneOrder(stored ?? { ...pendingPreview(orderId), orderId });
      if (flags.order === "expired") return expired(pending, now() - 1000);
      if ((flags.order === "closing" || flags.order === "closing-failure") && orderCalls > 1) return expired(pending);
      const closing = flags.order === "closing" || flags.order === "closing-failure";
      return cloneOrder({ ...pending, expiresAt: closing ? new Date(now() - 1000).toISOString() : pending.expiresAt });
    },
  };
}
