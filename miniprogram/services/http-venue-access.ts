import { decodeWeChatSession } from "../domain/decoders";
import { decodeManagedVenuesResponse } from "../domain/venue-access";
import type { Transport, TransportError, WeChatIdentityCapability } from "../runtime/interfaces";
import type { SessionStore } from "./session-store";
import type { VenueAccessDataSource } from "./venue-access";

export type VenueAccessApiErrorCode = "LOGIN_FAILED" | "VENUE_ACCESS_UNAVAILABLE";

export class VenueAccessApiError extends Error {
  constructor(readonly code: VenueAccessApiErrorCode) {
    super(code);
    this.name = "VenueAccessApiError";
  }
}

export function createHttpVenueAccessDataSource({ transport, identity, sessionStore }: {
  readonly transport: Transport;
  readonly identity: WeChatIdentityCapability;
  readonly sessionStore: SessionStore;
}): VenueAccessDataSource {
  let loginInFlight: Promise<void> | undefined;

  const login = (): Promise<void> => {
    if (loginInFlight) return loginInFlight;
    const request = (async () => {
      try {
        const { code } = await identity.login();
        if (!code) throw new Error("EMPTY_LOGIN_CODE");
        const session = decodeWeChatSession(
          await transport.post("/api/v1/auth/wechat/session", { code }),
        );
        sessionStore.save({ token: session.token, expiresAt: session.expiresAt, userId: session.user.userId });
      } catch {
        throw new VenueAccessApiError("LOGIN_FAILED");
      }
    })();
    loginInFlight = request;
    void request.then(
      () => { if (loginInFlight === request) loginInFlight = undefined; },
      () => { if (loginInFlight === request) loginInFlight = undefined; },
    );
    return request;
  };

  const isUnauthorized = (caught: unknown): boolean => {
    if (typeof caught !== "object" || caught === null) return false;
    const error = caught as Partial<TransportError>;
    return error.code === "HTTP_ERROR" && error.statusCode === 401;
  };

  const bearer = (): Readonly<Record<string, string>> => {
    const session = sessionStore.load();
    if (!session) throw new VenueAccessApiError("LOGIN_FAILED");
    return { Authorization: `Bearer ${session.token}` };
  };

  return {
    login,
    async listManagedVenues() {
      let authenticationRecovered = false;
      if (!sessionStore.load()) {
        await login();
        authenticationRecovered = true;
      }
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          return decodeManagedVenuesResponse(
            await transport.get("/api/v1/admin/venues", bearer()),
          );
        } catch (caught) {
          if (isUnauthorized(caught)) {
            sessionStore.clear();
            if (!authenticationRecovered && attempt === 0) {
              await login();
              authenticationRecovered = true;
              continue;
            }
            throw new VenueAccessApiError("LOGIN_FAILED");
          }
          if (caught instanceof VenueAccessApiError && caught.code === "LOGIN_FAILED") throw caught;
          throw new VenueAccessApiError("VENUE_ACCESS_UNAVAILABLE");
        }
      }
      throw new Error("UNREACHABLE_AUTH_RETRY");
    },
  };
}
