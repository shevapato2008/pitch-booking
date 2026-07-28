import { productionSessionStorage } from "../runtime/production";
import { registerBookingDataSource, registerCreateOrderAttemptStore, registerNeutralPhoneTapCode } from "../services/booking";
import { createCreateOrderAttemptStore } from "../services/create-order-attempt-store";
import { registerPageDataSource } from "../services/page-data";
import { createDevelopmentBookingDataSource } from "./booking-source";
import { createDevelopmentHttpSources } from "./http-booking-source";
import { developmentPageDataSource } from "./page-data";

export type DevelopmentBootstrapOptions =
  | { readonly source: "fixture" }
  | { readonly source: "http"; readonly apiBaseUrl: string };

export function bootstrapDevelopment(options: DevelopmentBootstrapOptions = { source: "fixture" }): void {
  registerCreateOrderAttemptStore(createCreateOrderAttemptStore(productionSessionStorage));
  if (options.source === "http") {
    const sources = createDevelopmentHttpSources(options.apiBaseUrl);
    registerPageDataSource(sources.pages);
    registerBookingDataSource(sources.booking);
    registerNeutralPhoneTapCode(sources.neutralPhoneTapDetail);
    return;
  }
  registerPageDataSource(developmentPageDataSource);
  registerBookingDataSource(createDevelopmentBookingDataSource());
  registerNeutralPhoneTapCode(() => "dev-phone-code");
}
