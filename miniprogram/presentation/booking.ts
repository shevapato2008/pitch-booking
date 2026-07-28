import type {
  CheckoutView,
  CreateOrderInput,
  ExpiredOrderView,
  PendingOrderView,
  UserSessionView,
} from "../domain/booking";

export type LoadableView<T> =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly value: T }
  | { readonly status: "failed"; readonly message: string };

export type BookingSubmissionState =
  | { readonly status: "idle" }
  | {
      readonly status: "submitting";
      readonly idempotencyKey: string;
      readonly request: CreateOrderInput;
    }
  | {
      readonly status: "result-reconciling";
      readonly idempotencyKey: string;
      readonly request: CreateOrderInput;
    }
  | {
      readonly status: "price-changed";
      readonly idempotencyKey: string;
      readonly request: CreateOrderInput;
      readonly checkout: CheckoutView;
    }
  | { readonly status: "slot-unavailable"; readonly message: string }
  | { readonly status: "created"; readonly order: PendingOrderView }
  | { readonly status: "expired"; readonly order: ExpiredOrderView };

export interface BookingPageState {
  readonly session: LoadableView<UserSessionView>;
  readonly checkout: LoadableView<CheckoutView>;
  readonly contactName: string;
  readonly submission: BookingSubmissionState;
}

export type BookingPageEvent =
  | { readonly type: "SESSION_LOADING" }
  | { readonly type: "SESSION_READY"; readonly session: UserSessionView }
  | { readonly type: "SESSION_FAILED"; readonly message: string }
  | { readonly type: "CHECKOUT_LOADING" }
  | { readonly type: "CHECKOUT_READY"; readonly checkout: CheckoutView }
  | { readonly type: "CHECKOUT_FAILED"; readonly message: string }
  | { readonly type: "CONTACT_NAME_CHANGED"; readonly contactName: string }
  | {
      readonly type: "SUBMIT_STARTED";
      readonly idempotencyKey: string;
      readonly request: CreateOrderInput;
    }
  | {
      readonly type: "SUBMIT_RESTORED";
      readonly idempotencyKey: string;
      readonly request: CreateOrderInput;
    }
  | { readonly type: "SUBMIT_UNKNOWN"; readonly idempotencyKey: string }
  | { readonly type: "SUBMIT_RETRY"; readonly idempotencyKey: string }
  | { readonly type: "SUBMIT_FAILED"; readonly idempotencyKey: string }
  | {
      readonly type: "PRICE_CHANGED";
      readonly idempotencyKey: string;
      readonly checkout: CheckoutView;
    }
  | { readonly type: "PRICE_CHANGE_ACCEPTED"; readonly idempotencyKey: string }
  | {
      readonly type: "SLOT_UNAVAILABLE";
      readonly idempotencyKey: string;
      readonly message: string;
    }
  | {
      readonly type: "SUBMIT_SUCCEEDED";
      readonly idempotencyKey: string;
      readonly order: PendingOrderView;
    }
  | {
      readonly type: "ORDER_EXPIRED";
      readonly orderId: string;
      readonly order: ExpiredOrderView;
    };

export type ContactNameValidation =
  | { readonly ok: true; readonly normalized: string }
  | {
      readonly ok: false;
      readonly reason: "too-short" | "too-long" | "invalid-characters";
    };

export function canPollClosingOrder(elapsedMs: number): boolean {
  return elapsedMs < 30_000;
}

const CONTACT_NAME_CHARACTERS = /^[\p{Script=Han}A-Za-z0-9 ·-]+$/u;

export function validateContactName(value: string): ContactNameValidation {
  const normalized = value.trim();
  const length = [...normalized].length;

  if (length < 2) return { ok: false, reason: "too-short" };
  if (length > 30) return { ok: false, reason: "too-long" };
  if (!CONTACT_NAME_CHARACTERS.test(normalized)) {
    return { ok: false, reason: "invalid-characters" };
  }

  return { ok: true, normalized };
}

export function canSubmit(state: BookingPageState): boolean {
  return (
    state.session.status === "ready" &&
    (state.session.value.maskedPhone ?? "").trim().length > 0 &&
    state.checkout.status === "ready" &&
    validateContactName(state.contactName).ok &&
    state.submission.status === "idle"
  );
}

function isActiveAttempt(
  submission: BookingSubmissionState,
  idempotencyKey: string,
): submission is Extract<
  BookingSubmissionState,
  { status: "submitting" | "result-reconciling" }
> {
  return (
    (submission.status === "submitting" ||
      submission.status === "result-reconciling") &&
    submission.idempotencyKey === idempotencyKey
  );
}

export function reduceBooking(
  state: BookingPageState,
  event: BookingPageEvent,
): BookingPageState {
  switch (event.type) {
    case "SESSION_LOADING":
      return { ...state, session: { status: "loading" } };
    case "SESSION_READY":
      return {
        ...state,
        session: { status: "ready", value: { ...event.session } },
      };
    case "SESSION_FAILED":
      return {
        ...state,
        session: { status: "failed", message: event.message },
      };
    case "CHECKOUT_LOADING":
      return { ...state, checkout: { status: "loading" } };
    case "CHECKOUT_READY":
      return {
        ...state,
        checkout: { status: "ready", value: { ...event.checkout } },
        contactName: state.contactName || event.checkout.lastContactName || "",
      };
    case "CHECKOUT_FAILED":
      return {
        ...state,
        checkout: { status: "failed", message: event.message },
      };
    case "CONTACT_NAME_CHANGED":
      return { ...state, contactName: event.contactName };
    case "SUBMIT_STARTED":
      if (!canSubmit(state)) return state;
      return {
        ...state,
        submission: {
          status: "submitting",
          idempotencyKey: event.idempotencyKey,
          request: { ...event.request },
        },
      };
    case "SUBMIT_RESTORED":
      if (state.session.status !== "ready") return state;
      return {
        ...state,
        contactName: event.request.contactName,
        submission: {
          status: "submitting",
          idempotencyKey: event.idempotencyKey,
          request: { ...event.request },
        },
      };
    case "SUBMIT_UNKNOWN":
      if (
        state.submission.status !== "submitting" ||
        state.submission.idempotencyKey !== event.idempotencyKey
      ) {
        return state;
      }
      return {
        ...state,
        submission: {
          status: "result-reconciling",
          idempotencyKey: state.submission.idempotencyKey,
          request: state.submission.request,
        },
      };
    case "SUBMIT_RETRY":
      if (
        state.submission.status !== "result-reconciling" ||
        state.submission.idempotencyKey !== event.idempotencyKey
      ) {
        return state;
      }
      return {
        ...state,
        submission: {
          status: "submitting",
          idempotencyKey: state.submission.idempotencyKey,
          request: state.submission.request,
        },
      };
    case "SUBMIT_FAILED":
      if (!isActiveAttempt(state.submission, event.idempotencyKey)) return state;
      return { ...state, submission: { status: "idle" } };
    case "PRICE_CHANGED":
      if (!isActiveAttempt(state.submission, event.idempotencyKey)) return state;
      return {
        ...state,
        submission: {
          status: "price-changed",
          idempotencyKey: state.submission.idempotencyKey,
          request: state.submission.request,
          checkout: { ...event.checkout },
        },
      };
    case "PRICE_CHANGE_ACCEPTED":
      if (
        state.submission.status !== "price-changed" ||
        state.submission.idempotencyKey !== event.idempotencyKey
      ) {
        return state;
      }
      return {
        ...state,
        checkout: {
          status: "ready",
          value: { ...state.submission.checkout },
        },
        submission: { status: "idle" },
      };
    case "SLOT_UNAVAILABLE":
      if (!isActiveAttempt(state.submission, event.idempotencyKey)) return state;
      return {
        ...state,
        submission: {
          status: "slot-unavailable",
          message: event.message,
        },
      };
    case "SUBMIT_SUCCEEDED":
      if (!isActiveAttempt(state.submission, event.idempotencyKey)) return state;
      return {
        ...state,
        submission: { status: "created", order: { ...event.order } },
      };
    case "ORDER_EXPIRED":
      if (
        state.submission.status !== "created" ||
        state.submission.order.orderId !== event.orderId ||
        event.order.orderId !== event.orderId
      ) {
        return state;
      }
      return {
        ...state,
        submission: { status: "expired", order: { ...event.order } },
      };
    default: {
      const exhaustiveEvent: never = event;
      return exhaustiveEvent;
    }
  }
}
