import type { PaymentCapability, PaymentDataSource } from "../domain/payment";
import type { Clock } from "../runtime/interfaces";

export type { PaymentCapability, PaymentDataSource } from "../domain/payment";

export interface PaymentBindings {
  readonly source: PaymentDataSource;
  readonly capability: PaymentCapability;
  readonly clock?: Clock;
}

let configuredSource: PaymentDataSource | undefined;
let configuredCapability: PaymentCapability | undefined;
let configuredClock: Clock | undefined;

export function registerPaymentDataSource(source: PaymentDataSource): void {
  configuredSource = source;
}

export function registerPaymentCapability(capability: PaymentCapability): void {
  configuredCapability = capability;
}

export function registerPaymentClock(clock: Clock): void {
  configuredClock = clock;
}

export function getPaymentBindings(): PaymentBindings | undefined {
  if (!configuredSource || !configuredCapability) return undefined;
  const bindings: PaymentBindings = { source: configuredSource, capability: configuredCapability };
  return configuredClock ? { ...bindings, clock: configuredClock } : bindings;
}

export function resetPaymentBindingsForTesting(): void {
  configuredSource = undefined;
  configuredCapability = undefined;
  configuredClock = undefined;
}
