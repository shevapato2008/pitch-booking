import { MINIPROGRAM_TENCENT_MAP_KEY } from "../config/runtime";
import {
  productionClock,
  productionLocation,
  productionPhone,
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
import { createHttpVenueOnboardingDataSource } from "../services/http-venue-onboarding";
import { createHttpVenueFulfillmentDataSource } from "../services/http-venue-fulfillment";
import { createHttpOpenGameSource } from "../services/http-open-game";
import { createHttpOpenGameRegistrationSource } from "../services/http-open-game-registration";
import { createHttpOpenGameReportSource } from "../services/http-open-game-report";
import { createHttpPublicGameDirectorySource } from "../services/http-public-game-directory";
import { createSessionStore } from "../services/session-store";
import { registerVenueAccessDataSource } from "../services/venue-access";
import { createVenueFulfillmentAttemptStore, registerVenueFulfillmentAttemptStore } from "../services/venue-fulfillment-attempt-store";
import { registerVenueFulfillmentDataSource } from "../services/venue-fulfillment";
import { createWeChatVenueOnboardingEvidenceCapability, registerVenueOnboardingDataSource, registerVenueOnboardingEvidenceCapability } from "../services/venue-onboarding";
import { createPitchConfigurationAttemptStore, registerPitchConfigurationAttemptStore } from "../services/pitch-configuration-attempt-store";
import { createOpenGameMutationAttemptStore } from "../services/open-game-attempt-store";
import { registerOpenGameMutationAttemptStore, registerOpenGameSource } from "../services/open-game";
import { createOpenGameRegistrationAttemptStore } from "../services/open-game-registration-attempt-store";
import { createOpenGameReportAttemptStore } from "../services/open-game-report-attempt-store";
import {
  registerOpenGameRegistrationAttemptStore,
  registerOpenGameRegistrationSource,
} from "../services/open-game-registration";
import {
  registerOpenGameReportAttemptStore,
  registerOpenGameReportSource,
} from "../services/open-game-report";
import { registerPageDataSource } from "../services/page-data";
import { registerLocationCapability } from "../services/location";
import { registerPoiSearchCapability } from "../services/poi-search";
import { registerPublicGameDirectorySource } from "../services/public-game-directory";
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
import { createDevelopmentOpenGameSource } from "./open-game-source";
import { createDevelopmentPublicGameDirectorySource } from "./public-game-directory-source";

export type DevelopmentBootstrapOptions =
  | { readonly source: "fixture" }
  | { readonly source: "http"; readonly apiBaseUrl: string };

export function bootstrapDevelopment(options: DevelopmentBootstrapOptions = { source: "fixture" }): void {
  registerCreateOrderAttemptStore(createCreateOrderAttemptStore(productionSessionStorage));
  registerInventoryMutationAttemptStore(createInventoryMutationAttemptStore(productionSessionStorage));
  registerPitchConfigurationAttemptStore(createPitchConfigurationAttemptStore(productionSessionStorage));
  registerOpenGameMutationAttemptStore(createOpenGameMutationAttemptStore(productionSessionStorage));
  const venueProfileAttemptStore = createVenueProfileAttemptStore(productionSessionStorage);
  const venueFulfillmentAttemptStore = createVenueFulfillmentAttemptStore(productionSessionStorage);
  registerVenueProfileAttemptStore(venueProfileAttemptStore);
  registerVenueFulfillmentAttemptStore(venueFulfillmentAttemptStore);
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
    registerPublicGameDirectorySource(createHttpPublicGameDirectorySource(transport));
    const sessionStore = createSessionStore(productionSessionStorage);
    const openGameRegistrationAttemptStore = createOpenGameRegistrationAttemptStore(
      productionSessionStorage,
    );
    const openGameReportAttemptStore = createOpenGameReportAttemptStore(productionSessionStorage);
    registerOpenGameRegistrationAttemptStore(openGameRegistrationAttemptStore);
    registerOpenGameReportAttemptStore(openGameReportAttemptStore);
    registerOpenGameRegistrationSource(createHttpOpenGameRegistrationSource({
      transport,
      identity: developmentIdentity,
      sessionStore,
    }));
    registerOpenGameReportSource(createHttpOpenGameReportSource({
      transport,
      identity: developmentIdentity,
      sessionStore,
    }));
    registerOpenGameSource(createHttpOpenGameSource({ transport, identity: developmentIdentity, sessionStore }));
    registerVenueAccessDataSource(createHttpVenueAccessDataSource({ transport, identity: developmentIdentity, sessionStore }));
    registerVenueOnboardingDataSource(createHttpVenueOnboardingDataSource({ transport, identity: developmentIdentity, phone: productionPhone, sessionStore }));
    registerVenueOnboardingEvidenceCapability(createWeChatVenueOnboardingEvidenceCapability());
    registerVenueProfileDataSource(createHttpVenueProfileDataSource({ transport, identity: developmentIdentity, sessionStore, attemptStore: venueProfileAttemptStore }));
    registerVenueFulfillmentDataSource(createHttpVenueFulfillmentDataSource({
      transport,
      identity: developmentIdentity,
      sessionStore,
      attemptStore: venueFulfillmentAttemptStore,
    }));
    registerPaymentClock(productionClock);
    registerNeutralPhoneTapCode(sources.neutralPhoneTapDetail);
    registerLocationCapability(productionLocation);
    registerPoiSearchCapability(new TencentPoiSearchCapability(
      productionTencentPoiRequest,
      MINIPROGRAM_TENCENT_MAP_KEY,
    ));
    return;
  }
  registerPublicGameDirectorySource(createDevelopmentPublicGameDirectorySource());
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
  registerOpenGameSource(createDevelopmentOpenGameSource());
  registerLocationCapability(productionLocation);
  registerNeutralPhoneTapCode(() => "dev-phone-code");
}
