import type { WeChatIdentityCapability, WeChatPhoneCapability } from "../runtime/interfaces";
import { productionMedia, productionTransport } from "../runtime/production";
import type { OrderListBookingDataSource } from "../services/booking";
import { createHttpBookingDataSource } from "../services/http-booking";
import { createHttpPaymentDataSource } from "../services/http-payment";
import { createHttpPageDataSource } from "../services/http-page-data";
import { createHttpVenueDirectoryDataSource } from "../services/http-venue-directory";
import { createHttpInventoryDataSource } from "../services/http-inventory";
import { createHttpPitchConfigurationDataSource } from "../services/http-pitch-configuration";
import type { InventoryDataSource } from "../services/inventory";
import type { PitchConfigurationDataSource } from "../services/pitch-configuration";
import type { PageDataSource } from "../services/page-data";
import type { PaymentDataSource } from "../services/payment";
import type { VenueDirectoryDataSource } from "../services/venue-directory";
import { createSessionStore, type SessionStorage } from "../services/session-store";

const DEVELOPMENT_LOGIN_CODE = "dev-login-code";
const DEVELOPMENT_PHONE_CODE = "dev-phone-code";

export interface DevelopmentHttpSources {
  readonly booking: OrderListBookingDataSource;
  readonly payment: PaymentDataSource;
  readonly pages: PageDataSource;
  readonly venues: VenueDirectoryDataSource;
  readonly neutralPhoneTapDetail: () => unknown;
  readonly inventory: InventoryDataSource;
  readonly pitchConfiguration: PitchConfigurationDataSource;
}

function createMemorySessionStorage(): SessionStorage {
  const values = new Map<string, unknown>();
  return {
    get: (key) => values.get(key),
    set: (key, value) => { values.set(key, value); },
    remove: (key) => { values.delete(key); },
  };
}

export const developmentIdentity: WeChatIdentityCapability = {
  async login() {
    return { code: DEVELOPMENT_LOGIN_CODE };
  },
};

const developmentPhone: WeChatPhoneCapability = {
  normalizeEvent(event) {
    if (event !== DEVELOPMENT_PHONE_CODE) {
      throw Object.assign(new Error("PHONE_REJECTED"), { code: "PHONE_REJECTED" as const });
    }
    return { code: DEVELOPMENT_PHONE_CODE };
  },
};

export function createDevelopmentHttpSources(apiBaseUrl: string): DevelopmentHttpSources {
  const transport = productionTransport(apiBaseUrl);
  const sessionStore = createSessionStore(createMemorySessionStorage());
  return {
    booking: createHttpBookingDataSource({
      transport,
      identity: developmentIdentity,
      phone: developmentPhone,
      sessionStore,
    }),
    payment: createHttpPaymentDataSource({
      transport,
      identity: developmentIdentity,
      sessionStore,
    }),
    pages: createHttpPageDataSource(transport, productionMedia),
    venues: createHttpVenueDirectoryDataSource(transport),
    inventory: createHttpInventoryDataSource({ transport, identity: developmentIdentity, sessionStore }),
    pitchConfiguration: createHttpPitchConfigurationDataSource({ transport, identity: developmentIdentity, sessionStore }),
    neutralPhoneTapDetail: () => DEVELOPMENT_PHONE_CODE,
  };
}
