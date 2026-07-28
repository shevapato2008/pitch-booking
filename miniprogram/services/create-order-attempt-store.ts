import type { CreateOrderAttempt } from "./booking";
import type { SessionStorage } from "./session-store";

const CREATE_ORDER_ATTEMPT_KEY = "modelstella.pitch-booking.create-order-attempt.v1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface CreateOrderAttemptStore {
  load(): CreateOrderAttempt | null;
  save(attempt: CreateOrderAttempt): void;
  clear(): void;
}

export function createCreateOrderAttemptStore(storage: SessionStorage): CreateOrderAttemptStore {
  const clear = () => storage.remove(CREATE_ORDER_ATTEMPT_KEY);
  return {
    load() {
      const value = storage.get(CREATE_ORDER_ATTEMPT_KEY);
      if (value === undefined || value === null) return null;
      if (!isCreateOrderAttempt(value)) {
        clear();
        return null;
      }
      return {
        request: { ...value.request },
        idempotencyKey: value.idempotencyKey,
      };
    },
    save(attempt) {
      storage.set(CREATE_ORDER_ATTEMPT_KEY, {
        request: { ...attempt.request },
        idempotencyKey: attempt.idempotencyKey,
      });
    },
    clear,
  };
}

function isCreateOrderAttempt(value: unknown): value is CreateOrderAttempt {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const object = value as Record<string, unknown>;
  if (Object.keys(object).length !== 2 || !("request" in object) || !("idempotencyKey" in object)
    || typeof object.idempotencyKey !== "string" || object.idempotencyKey.length === 0) return false;
  if (typeof object.request !== "object" || object.request === null || Array.isArray(object.request)) return false;
  const request = object.request as Record<string, unknown>;
  return Object.keys(request).length === 3
    && typeof request.slotId === "string" && UUID.test(request.slotId)
    && Number.isSafeInteger(request.checkoutVersion) && (request.checkoutVersion as number) > 0
    && typeof request.contactName === "string" && request.contactName.length > 0;
}
