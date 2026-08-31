import { ApiResponseError } from "../domain/contracts";
import { exactObject, rfc3339At, stringAt, uuidAt } from "../domain/decoder-primitives";

const V1_SESSION_KEY = "modelstella.pitch-booking.session.v1";
const V2_SESSION_KEY = "modelstella.pitch-booking.session.v2";

export interface StoredSession {
  readonly token: string;
  readonly expiresAt: string;
  readonly userId: string;
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
  const clear = () => {
    storage.remove(V1_SESSION_KEY);
    storage.remove(V2_SESSION_KEY);
  };
  return {
    load() {
      storage.remove(V1_SESSION_KEY);
      const value = storage.get(V2_SESSION_KEY);
      if (value === undefined || value === null) return null;
      try {
        const object = exactObject(value, ["token", "expiresAt", "userId"], "$");
        const token = stringAt(object.token, "$.token");
        if (token.length === 0) throw new Error("INVALID_SESSION");
        const expiresAt = rfc3339At(object.expiresAt, "$.expiresAt");
        const userId = uuidAt(object.userId, "$.userId");
        const expiry = Date.parse(expiresAt);
        if (!Number.isFinite(expiry) || expiry <= now()) throw new Error("EXPIRED_SESSION");
        return { token, expiresAt, userId };
      } catch (error) {
        if (!(error instanceof ApiResponseError) && !(error instanceof Error)) throw error;
        storage.remove(V2_SESSION_KEY);
        return null;
      }
    },
    save(session) {
      storage.remove(V1_SESSION_KEY);
      storage.set(V2_SESSION_KEY, {
        token: session.token,
        expiresAt: session.expiresAt,
        userId: session.userId,
      });
    },
    clear,
  };
}
