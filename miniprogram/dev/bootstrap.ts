import { MINIPROGRAM_TENCENT_MAP_KEY } from "../config/runtime";
import {
  productionClock,
  productionLocation,
  productionSessionStorage,
  productionTencentPoiRequest,
  productionTransport,
  productionVenueProfileMedia,
} from "../runtime/production";
import { registerBookingDataSource, registerCreateOrderAttemptStore, registerNeutralPhoneTapCode } from "../services/booking";
import { createCreateOrderAttemptStore } from "../services/create-order-attempt-store";
import { createInventoryMutationAttemptStore, registerInventoryMutationAttemptStore } from "../services/inventory-attempt-store";
import { registerInventoryDataSource } from "../services/inventory";
import { registerPitchConfigurationDataSource } from "../services/pitch-configuration";
import { createVenueProfileAttemptStore, registerVenueProfileAttemptStore } from "../services/venue-profile-attempt-store";
import { registerVenueProfileDataSource, registerVenueProfileMediaCapability } from "../services/venue-profile";
import { createHttpVenueProfileDataSource } from "../services/http-venue-profile";
import { createHttpVenueAccessDataSource } from "../services/http-venue-access";
import { createSessionStore } from "../services/session-store";
import { registerVenueAccessDataSource } from "../services/venue-access";
import { createPitchConfigurationAttemptStore, registerPitchConfigurationAttemptStore } from "../services/pitch-configuration-attempt-store";
import { registerPageDataSource } from "../services/page-data";
import { registerLocationCapability } from "../services/location";
import { registerPoiSearchCapability } from "../services/poi-search";
import { TencentPoiSearchCapability } from "../services/tencent-poi-search";
import { registerVenueDirectoryDataSource } from "../services/venue-directory";
import {
  registerPaymentCapability,
  registerPaymentClock,
  registerPaymentDataSource,
} from "../services/payment";
import { createDevelopmentBookingDataSource } from "./booking-source";
import { createDevelopmentHttpSources, developmentIdentity } from "./http-booking-source";
import { developmentPageDataSource } from "./page-data";
import { createDevelopmentPaymentCapability, showDevelopmentCashier } from "./payment-capability";
import { PAYMENT_PREVIEW_NOW } from "./payment-scenarios";
import { createDevelopmentPaymentDataSource } from "./payment-source";
import { createDevelopmentVenueDirectoryDataSource } from "./venue-directory-source";
import { createDevelopmentPitchConfigurationDataSource } from "./pitch-configuration-source";

export type DevelopmentBootstrapOptions =
  | { readonly source: "fixture" }
  | { readonly source: "http"; readonly apiBaseUrl: string };

export function bootstrapDevelopment(options: DevelopmentBootstrapOptions = { source: "fixture" }): void {
  registerCreateOrderAttemptStore(createCreateOrderAttemptStore(productionSessionStorage));
  registerInventoryMutationAttemptStore(createInventoryMutationAttemptStore(productionSessionStorage));
  registerPitchConfigurationAttemptStore(createPitchConfigurationAttemptStore(productionSessionStorage));
  const venueProfileAttemptStore = createVenueProfileAttemptStore(productionSessionStorage);
  registerVenueProfileAttemptStore(venueProfileAttemptStore);
  registerVenueProfileMediaCapability(productionVenueProfileMedia);
  registerPaymentCapability(createDevelopmentPaymentCapability("success", showDevelopmentCashier));
  if (options.source === "http") {
    const sources = createDevelopmentHttpSources(options.apiBaseUrl);
    registerPageDataSource(sources.pages);
    registerBookingDataSource(sources.booking);
    registerPaymentDataSource(sources.payment);
    registerVenueDirectoryDataSource(sources.venues);
    registerInventoryDataSource(sources.inventory);
    registerPitchConfigurationDataSource(sources.pitchConfiguration);
    const transport = productionTransport(options.apiBaseUrl);
    const sessionStore = createSessionStore(productionSessionStorage);
    registerVenueAccessDataSource(createHttpVenueAccessDataSource({ transport, identity: developmentIdentity, sessionStore }));
    registerVenueProfileDataSource(createHttpVenueProfileDataSource({ transport, identity: developmentIdentity, sessionStore, attemptStore: venueProfileAttemptStore }));
    registerPaymentClock(productionClock);
    registerNeutralPhoneTapCode(sources.neutralPhoneTapDetail);
    registerLocationCapability(productionLocation);
    registerPoiSearchCapability(new TencentPoiSearchCapability(
      productionTencentPoiRequest,
      MINIPROGRAM_TENCENT_MAP_KEY,
    ));
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
  registerVenueDirectoryDataSource(createDevelopmentVenueDirectoryDataSource());
  registerPitchConfigurationDataSource(createDevelopmentPitchConfigurationDataSource());
  registerLocationCapability(productionLocation);
  registerNeutralPhoneTapCode(() => "dev-phone-code");
}
