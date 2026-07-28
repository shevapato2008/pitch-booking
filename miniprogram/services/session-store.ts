import { ApiResponseError } from "../domain/contracts";
import { rfc3339At } from "../domain/decoder-primitives";

const SESSION_KEY = "modelstella.pitch-booking.session.v1";

export interface StoredSession {
  readonly token: string;
  readonly expiresAt: string;
}

export interface SessionStore {
  load(): StoredSession | null;
  save(session: StoredSession): void;
  clear(): void;
}

export interface SessionStorage {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  remove(key: string): void;
}

export function createSessionStore(
  storage: SessionStorage,
  now: () => number = () => Date.now(),
): SessionStore {
  const clear = () => storage.remove(SESSION_KEY);
  return {
    load() {
      const value = storage.get(SESSION_KEY);
      if (value === undefined || value === null) return null;
      try {
        if (typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_SESSION");
        const object = value as Record<string, unknown>;
        if (Object.keys(object).length !== 2 || !("token" in object) || !("expiresAt" in object)
          || typeof object.token !== "string" || object.token.length === 0) {
          throw new Error("INVALID_SESSION");
        }
        const expiresAt = rfc3339At(object.expiresAt, "$.expiresAt");
        const expiry = Date.parse(expiresAt);
        if (!Number.isFinite(expiry) || expiry <= now()) throw new Error("EXPIRED_SESSION");
        return { token: object.token, expiresAt };
      } catch (error) {
        if (!(error instanceof ApiResponseError) && !(error instanceof Error)) throw error;
        clear();
        return null;
      }
    },
    save(session) { storage.set(SESSION_KEY, { token: session.token, expiresAt: session.expiresAt }); },
    clear,
  };
}
