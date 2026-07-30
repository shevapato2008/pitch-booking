import { productionClock, productionSessionStorage } from "../runtime/production";
import { registerBookingDataSource, registerCreateOrderAttemptStore, registerNeutralPhoneTapCode } from "../services/booking";
import { createCreateOrderAttemptStore } from "../services/create-order-attempt-store";
import { registerPageDataSource } from "../services/page-data";
import { registerLocationCapability } from "../services/location";
import { registerVenueDirectoryDataSource } from "../services/venue-directory";
import {
  registerPaymentCapability,
  registerPaymentClock,
  registerPaymentDataSource,
} from "../services/payment";
import { createDevelopmentBookingDataSource } from "./booking-source";
import { createDevelopmentHttpSources } from "./http-booking-source";
import { developmentPageDataSource } from "./page-data";
import { createDevelopmentPaymentCapability, showDevelopmentCashier } from "./payment-capability";
import { PAYMENT_PREVIEW_NOW } from "./payment-scenarios";
import { createDevelopmentPaymentDataSource } from "./payment-source";
import { createDevelopmentVenueDirectoryDataSource } from "./venue-directory-source";
import { createSimulatedLocationCapability } from "./venue-directory-scenarios";

export type DevelopmentBootstrapOptions =
  | { readonly source: "fixture" }
  | { readonly source: "http"; readonly apiBaseUrl: string };

export function bootstrapDevelopment(options: DevelopmentBootstrapOptions = { source: "fixture" }): void {
  registerCreateOrderAttemptStore(createCreateOrderAttemptStore(productionSessionStorage));
  registerPaymentCapability(createDevelopmentPaymentCapability("success", showDevelopmentCashier));
  if (options.source === "http") {
    const sources = createDevelopmentHttpSources(options.apiBaseUrl);
    registerPageDataSource(sources.pages);
    registerBookingDataSource(sources.booking);
    registerPaymentDataSource(sources.payment);
    registerVenueDirectoryDataSource(sources.venues);
    registerPaymentClock(productionClock);
    registerNeutralPhoneTapCode(sources.neutralPhoneTapDetail);
    return;
  }
  registerPaymentDataSource(createDevelopmentPaymentDataSource({
    initial: "pending",
    reconciliation: "confirmed",
    confirmingReadsBeforeTerminal: 3,
  }));
  registerPaymentClock({ now: () => new Date(PAYMENT_PREVIEW_NOW) });
  registerPageDataSource(developmentPageDataSource);
  registerBookingDataSource(createDevelopmentBookingDataSource());
  registerNeutralPhoneTapCode(() => "dev-phone-code");
  registerVenueDirectoryDataSource(createDevelopmentVenueDirectoryDataSource("ready"));
  registerLocationCapability(createSimulatedLocationCapability("location-success"));
}
