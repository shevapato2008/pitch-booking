import { FIXTURE_DATA } from "./fixture-data";

const ALLOWED_FIXTURES = [
  "venue-ready",
  "slots-ready",
  "slots-empty",
  "booking-checkout-ready",
  "order-pending",
  "order-expired",
  "order-confirmed",
  "order-payment-confirming",
  "order-payment-exception",
  "venue-map",
  "venue-online-detail",
  "venue-directory-detail",
] as const;
export type FixtureName = typeof ALLOWED_FIXTURES[number];

export function isFixtureName(value: unknown): value is FixtureName {
  return typeof value === "string" && (ALLOWED_FIXTURES as readonly string[]).includes(value);
}

export interface FixtureLoader {
  load(name: FixtureName): unknown;
}

export const packagedFixtureLoader: FixtureLoader = {
  load(name) {
    if (!Object.prototype.hasOwnProperty.call(FIXTURE_DATA, name)) {
      throw new Error("FIXTURE_DATA_MISSING");
    }
    return JSON.parse(JSON.stringify(FIXTURE_DATA[name])) as unknown;
  },
};
