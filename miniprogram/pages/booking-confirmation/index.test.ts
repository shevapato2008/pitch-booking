import { beforeEach, describe, expect, jest, test } from "@jest/globals";

import type { PendingOrderView, UserSessionView } from "../../domain/booking";
import { AsyncGenerationGate } from "../../presentation/lifecycle";
import { registerBookingDataSource, registerCreateOrderAttemptStore, registerNeutralPhoneTapCode, resetBookingDataSourceForTesting, type BookingDataSource, type CreateOrderAttempt } from "../../services/booking";
import { createCreateOrderAttemptStore } from "../../services/create-order-attempt-store";

type PageDefinition = Record<string, unknown> & { data: Record<string, unknown> };
type RuntimePage = PageDefinition & { setData(patch: Record<string, unknown>): void };
const deferred = <T>() => { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
const call = (page: RuntimePage, method: string, ...args: unknown[]) => (page[method] as (...values: unknown[]) => unknown).apply(page, args);
let capturedDefinition: PageDefinition | undefined;
function loadPage(): RuntimePage {
  let definition = capturedDefinition;
  if (!definition) { (globalThis as unknown as { Page(value: PageDefinition): void }).Page = (value) => { capturedDefinition = value; }; jest.requireActual("./index"); definition = capturedDefinition; }
  if (!definition) throw new Error("PAGE_NOT_CAPTURED");
  return { ...definition, loadGate: new AsyncGenerationGate(), phoneGate: new AsyncGenerationGate(), createGate: new AsyncGenerationGate(), navigationGate: new AsyncGenerationGate(), data: { ...definition.data }, setData(patch: Record<string, unknown>) { Object.assign(this.data, patch); } } as RuntimePage;
}
const slotId = "00000000-0000-4000-8000-000000000030";
const checkout = { venueId: "venue", venueName: "星河体育中心", pitchId: "pitch", pitchName: "5号场", slotId, startsAt: "2026-07-28T19:00:00+08:00", endsAt: "2026-07-28T21:00:00+08:00", priceCents: 32000, date: "2026-07-28", durationMinutes: 120, currency: "CNY" as const, available: true as const, cancellationSummary: "开场前 24 小时可取消", lockDurationSeconds: 600, maskedPhone: "138****0000", lastContactName: "张三", version: 12 };
const pendingResult = (contactName = "张三"): PendingOrderView => ({ orderId: "00000000-0000-4000-8000-000000000040", orderNumber: "PB202607280001", status: "PENDING_PAYMENT", slotId, venue: { id: checkout.venueId, name: checkout.venueName, address: "地址", latitude: 31, longitude: 121, customerServicePhone: "021-12345678" }, pitch: { id: checkout.pitchId, name: checkout.pitchName }, contact: { name: contactName, maskedPhone: "138****0000" }, priceCents: 32000, startsAt: checkout.startsAt, endsAt: checkout.endsAt, durationMinutes: 120, currency: "CNY", createdAt: "2026-07-28T18:00:00+08:00", expiresAt: "2026-07-28T18:10:00+08:00", expiredAt: null, cancellationSummary: checkout.cancellationSummary, closingPayment: false, detailPath: "/api/v1/orders/00000000-0000-4000-8000-000000000040" });
const sourceWith = (login: BookingDataSource["login"], createOrder: BookingDataSource["createOrder"] = async () => { throw new Error("unused"); }): BookingDataSource => ({ login, async getCheckout() { return checkout; }, async authorizePhone() { return { maskedPhone: "138****0000" }; }, createOrder, async getOrder() { throw new Error("unused"); } });

beforeEach(() => { resetBookingDataSourceForTesting(); });

describe("booking confirmation lifecycle orchestration", () => {
  test("formats the frozen visual-reference checkout labels", async () => {
    registerBookingDataSource(sourceWith(async () => ({ userId: "user", maskedPhone: null })));
    const page = loadPage();

    call(page, "onLoad", { slot_id: slotId });
    await flush();

    expect(page.data.dateLabel).toBe("7月28日 周二");
    expect(page.data.timeLabel).toBe("19:00–21:00");
    expect(page.data.durationLabel).toBe("2小时");
    expect(page.data.price).toBe("¥320");
    expect((page.data.state as { contactName: string }).contactName).toBe("张三");
    call(page, "onUnload");
  });

  test("production tap waits for getPhoneNumber and passes raw detail to the data source", async () => {
    const details: unknown[] = [];
    registerBookingDataSource({
      ...sourceWith(async () => ({ userId: "user", maskedPhone: null })),
      async authorizePhone(detail) { details.push(detail); return { maskedPhone: "138****0000" }; },
    });
    const page = loadPage(); call(page, "onLoad", { slot_id: slotId }); await flush();

    await call(page, "onAuthorizePhone", { detail: { source: "tap" } });
    expect(details).toEqual([]);
    expect(page.data.phoneMessage).toBe("");
    const rawDetail = { source: "getphonenumber", code: "wx-phone-code", errMsg: "getPhoneNumber:ok" };
    await call(page, "onAuthorizePhone", { detail: rawDetail });

    expect(details).toEqual([rawDetail]);
    expect(page.data.maskedPhone).toBe("138****0000");
    call(page, "onUnload");
  });

  test("development neutral success ignores the immediately following failed getPhoneNumber event", async () => {
    const details: unknown[] = [];
    registerNeutralPhoneTapCode(() => "fixture-phone-code");
    registerBookingDataSource({
      ...sourceWith(async () => ({ userId: "user", maskedPhone: null })),
      async authorizePhone(detail) { details.push(detail); return { maskedPhone: "138****0000" }; },
    });
    const page = loadPage(); call(page, "onLoad", { slot_id: slotId }); await flush();

    await call(page, "onAuthorizePhone", { detail: { source: "tap" } });
    await call(page, "onAuthorizePhone", {
      detail: {
        source: "getphonenumber",
        code: "",
        errMsg: "getPhoneNumber:fail user deny",
      },
    });

    expect(details).toEqual(["fixture-phone-code"]);
    expect(page.data.maskedPhone).toBe("138****0000");
    expect(page.data.phoneMessage).toBe("");
    call(page, "onUnload");
  });

  test("PRICE_CHANGED reads details.current_checkout without depending on the error message", async () => {
    const changedCheckout = { ...checkout, priceCents: 38000, version: 13 };
    const storage = memoryStorage();
    registerCreateOrderAttemptStore(createCreateOrderAttemptStore(storage));
    registerBookingDataSource(sourceWith(
      async () => ({ userId: "user", maskedPhone: "138****0000" }),
      async () => {
        throw Object.assign(new Error("unrelated localized text"), {
          code: "PRICE_CHANGED",
          details: { current_checkout: changedCheckout },
        });
      },
    ));
    const page = loadPage(); call(page, "onLoad", { slot_id: slotId }); await flush();
    call(page, "onContactInput", { detail: { value: "张三" } });

    await call(page, "onSubmit");

    expect(page.data.priceChanged).toBe(true);
    expect(page.data.changedPrice).toBe("¥380");
    expect(storage.remove).toHaveBeenCalledWith("modelstella.pitch-booking.create-order-attempt.v1");
    call(page, "onUnload");
  });

  test("retry generation prevents the older login response from overwriting newer state", async () => {
    const oldLogin = deferred<UserSessionView>(); const newLogin = deferred<UserSessionView>(); let calls = 0;
    registerBookingDataSource(sourceWith(() => (++calls === 1 ? oldLogin.promise : newLogin.promise)));
    const page = loadPage();
    call(page, "onLoad", { slot_id: slotId }); call(page, "onRetryLoad");
    newLogin.resolve({ userId: "new-user", maskedPhone: "138****0000" }); await flush();
    oldLogin.resolve({ userId: "old-user", maskedPhone: null }); await flush();
    expect((page.data.state as { session: { value: UserSessionView } }).session.value.userId).toBe("new-user");
    call(page, "onUnload");
  });

  test("checkout retry reuses the successful session without logging in again", async () => {
    let loginCalls = 0;
    let checkoutCalls = 0;
    registerBookingDataSource({
      ...sourceWith(async () => { loginCalls += 1; return { userId: "user", maskedPhone: null }; }),
      async getCheckout() {
        checkoutCalls += 1;
        if (checkoutCalls === 1) throw new Error("checkout failed");
        return checkout;
      },
    });
    const page = loadPage();
    call(page, "onLoad", { slot_id: slotId }); await flush();
    expect(page.data.loadError).toBe("结算信息加载失败，请重试。");

    call(page, "onRetryLoad"); await flush();

    expect(loginCalls).toBe(1);
    expect(checkoutCalls).toBe(2);
    expect(page.data.loadError).toBe("");
    call(page, "onUnload");
  });

  test("session failure retry performs a fresh login before checkout", async () => {
    let loginCalls = 0;
    let checkoutCalls = 0;
    registerBookingDataSource({
      ...sourceWith(async () => {
        loginCalls += 1;
        if (loginCalls === 1) throw Object.assign(new Error("login failed"), { code: "LOGIN_FAILED" });
        return { userId: "user", maskedPhone: null };
      }),
      async getCheckout() { checkoutCalls += 1; return checkout; },
    });
    const page = loadPage();
    call(page, "onLoad", { slot_id: slotId }); await flush();
    expect(page.data.loadError).toBe("登录失败，请重试。");

    call(page, "onRetryLoad"); await flush();

    expect(loginCalls).toBe(2);
    expect(checkoutCalls).toBe(1);
    expect(page.data.loadError).toBe("");
    call(page, "onUnload");
  });

  test("unknown create result replays the exact request and idempotency key", async () => {
    jest.useFakeTimers();
    try {
      const attempts: CreateOrderAttempt[] = [];
      registerBookingDataSource(sourceWith(
        async () => ({ userId: "user", maskedPhone: "138****0000" }),
        async (attempt) => {
          attempts.push(attempt);
          if (attempts.length === 1) throw Object.assign(new Error("unknown"), { code: "SUBMISSION_RESULT_UNKNOWN" });
          return pendingResult(attempt.request.contactName);
        },
      ));
      (globalThis as unknown as { wx: { navigateTo(): Promise<void> } }).wx = { async navigateTo() {} };
      const page = loadPage(); call(page, "onLoad", { slot_id: slotId }); await flush();
      call(page, "onContactInput", { detail: { value: "张三" } });
      const submission = call(page, "onSubmit") as Promise<void>;
      await flush(); await jest.advanceTimersByTimeAsync(500); await submission;

      expect(attempts).toHaveLength(2);
      expect(attempts[1]).toEqual(attempts[0]);
      call(page, "onUnload");
    } finally { jest.useRealTimers(); }
  });

  test("unknown create result survives unload and resumes with the exact attempt", async () => {
    jest.useFakeTimers();
    try {
      const attempts: CreateOrderAttempt[] = [];
      const storage = memoryStorage();
      registerCreateOrderAttemptStore(createCreateOrderAttemptStore(storage));
      registerBookingDataSource(sourceWith(
        async () => ({ userId: "user", maskedPhone: "138****0000" }),
        async (attempt) => {
          attempts.push(attempt);
          if (attempts.length === 1) {
            throw Object.assign(new Error("unknown"), { code: "SUBMISSION_RESULT_UNKNOWN" });
          }
          return pendingResult(attempt.request.contactName);
        },
      ));
      (globalThis as unknown as { wx: { navigateTo(): Promise<void> } }).wx = { async navigateTo() {} };
      const firstPage = loadPage(); call(firstPage, "onLoad", { slot_id: slotId }); await flush();
      call(firstPage, "onContactInput", { detail: { value: "张三" } });
      const submission = call(firstPage, "onSubmit") as Promise<void>;
      await flush();
      expect(attempts).toHaveLength(1);

      call(firstPage, "onUnload");
      await submission;
      expect(storage.remove).not.toHaveBeenCalled();
      const secondPage = loadPage(); call(secondPage, "onLoad", { slot_id: slotId }); await flush(); await flush();

      expect(attempts).toHaveLength(2);
      expect(attempts[1]).toEqual(attempts[0]);
      expect(storage.remove).toHaveBeenCalledWith("modelstella.pitch-booking.create-order-attempt.v1");
      call(secondPage, "onUnload");
    } finally { jest.useRealTimers(); }
  });

  test("stored attempt reconciles before checkout can reject the now-locked slot", async () => {
    const storedAttempt: CreateOrderAttempt = {
      request: { slotId, checkoutVersion: 12, contactName: "张三" },
      idempotencyKey: "booking-stored-unknown",
    };
    const storage = memoryStorage();
    const store = createCreateOrderAttemptStore(storage);
    store.save(storedAttempt);
    registerCreateOrderAttemptStore(store);
    const attempts: CreateOrderAttempt[] = [];
    let checkoutCalls = 0;
    registerBookingDataSource({
      ...sourceWith(
        async () => ({ userId: "user", maskedPhone: "138****0000" }),
        async (attempt) => { attempts.push(attempt); return pendingResult(attempt.request.contactName); },
      ),
      async getCheckout() {
        checkoutCalls += 1;
        throw Object.assign(new Error("locked"), { code: "SLOT_NOT_AVAILABLE" });
      },
    });
    (globalThis as unknown as { wx: { navigateTo(): Promise<void> } }).wx = { async navigateTo() {} };
    const page = loadPage();

    call(page, "onLoad", { slot_id: slotId });
    await flush(); await flush();

    expect(attempts).toEqual([storedAttempt]);
    expect(checkoutCalls).toBe(0);
    expect((page.data.state as { submission: { status: string } }).submission.status).toBe("created");
    expect(storage.remove).toHaveBeenCalledWith("modelstella.pitch-booking.create-order-attempt.v1");
    call(page, "onUnload");
  });

  test("accepted price change submits the new version with a fresh key", async () => {
    const now = jest.spyOn(Date, "now").mockReturnValue(1000);
    const random = jest.spyOn(Math, "random").mockReturnValueOnce(0.1).mockReturnValueOnce(0.2);
    const attempts: CreateOrderAttempt[] = [];
    const changedCheckout = { ...checkout, priceCents: 38000, version: 13 };
    registerBookingDataSource(sourceWith(
      async () => ({ userId: "user", maskedPhone: "138****0000" }),
      async (attempt) => {
        attempts.push(attempt);
        if (attempts.length === 1) throw Object.assign(new Error("changed"), { code: "PRICE_CHANGED", details: { checkout: changedCheckout } });
        return pendingResult(attempt.request.contactName);
      },
    ));
    (globalThis as unknown as { wx: { navigateTo(): Promise<void> } }).wx = { async navigateTo() {} };
    try {
      const page = loadPage(); call(page, "onLoad", { slot_id: slotId }); await flush();
      call(page, "onContactInput", { detail: { value: "张三" } });
      await call(page, "onSubmit");
      call(page, "onAcceptPriceChange");
      await call(page, "onSubmit");

      expect(attempts).toHaveLength(2);
      expect(attempts[0].request.checkoutVersion).toBe(12);
      expect(attempts[1].request.checkoutVersion).toBe(13);
      expect(attempts[1].idempotencyKey).not.toBe(attempts[0].idempotencyKey);
      call(page, "onUnload");
    } finally { now.mockRestore(); random.mockRestore(); }
  });

  test("unload prevents pending login from mutating page data", async () => {
    const login = deferred<UserSessionView>(); registerBookingDataSource(sourceWith(() => login.promise));
    const page = loadPage(); let writes = 0; const original = page.setData; page.setData = function (patch) { writes += 1; original.call(this, patch); };
    call(page, "onLoad", { slot_id: slotId }); const before = writes; call(page, "onUnload");
    login.resolve({ userId: "late", maskedPhone: null }); await flush();
    expect(writes).toBe(before);
  });

  test("navigation failure remains created and offers retry without classifying create as unknown", async () => {
    let received: CreateOrderAttempt | undefined;
    registerBookingDataSource(sourceWith(async () => ({ userId: "user", maskedPhone: "138****0000" }), async (attempt) => { received = attempt; return pendingResult(attempt.request.contactName); }));
    (globalThis as unknown as { wx: { navigateTo(): Promise<void> } }).wx = { async navigateTo() { throw new Error("navigation failed"); } };
    const page = loadPage(); call(page, "onLoad", { slot_id: slotId }); await flush();
    call(page, "onContactInput", { detail: { value: "张三" } }); await call(page, "onSubmit");
    expect(received?.idempotencyKey).toMatch(/^booking-/);
    expect(received?.request).toEqual({ slotId, checkoutVersion: 12, contactName: "张三" });
    expect((page.data.state as { submission: { status: string } }).submission.status).toBe("created");
    expect(page.data.navigationError).toBe("订单已创建，但页面打开失败。");
    call(page, "onUnload");
  });

  test("phone interaction cannot cancel a pending create result", async () => {
    const create = deferred<PendingOrderView>();
    registerBookingDataSource({ ...sourceWith(async () => ({ userId: "user", maskedPhone: "138****0000" }), () => create.promise), async authorizePhone() { return { maskedPhone: "139****0000" }; } });
    let navigations = 0;
    (globalThis as unknown as { wx: { navigateTo(): Promise<void> } }).wx = { async navigateTo() { navigations += 1; } };
    const page = loadPage(); call(page, "onLoad", { slot_id: slotId }); await flush();
    call(page, "onContactInput", { detail: { value: "张三" } }); const submission = call(page, "onSubmit") as Promise<void>;
    await call(page, "onAuthorizePhone", { detail: { source: "getphonenumber", code: "phone-code" } });
    create.resolve(pendingResult());
    await submission;
    expect((page.data.state as { submission: { status: string } }).submission.status).toBe("created");
    expect(navigations).toBe(1);
    expect(page.navigationInFlight).toBe(false);
    call(page, "onUnload");
  });

  test("navigation retry is single-flight and a failure becomes retryable again", async () => {
    registerBookingDataSource(sourceWith(async () => ({ userId: "user", maskedPhone: "138****0000" }), async (attempt) => pendingResult(attempt.request.contactName)));
    let calls = 0; const retryNavigation = deferred<void>();
    (globalThis as unknown as { wx: { navigateTo(): Promise<void> } }).wx = { navigateTo() { calls += 1; return calls === 1 ? Promise.reject(new Error("first")) : retryNavigation.promise; } };
    const page = loadPage(); call(page, "onLoad", { slot_id: slotId }); await flush(); call(page, "onContactInput", { detail: { value: "张三" } }); await call(page, "onSubmit");
    call(page, "onRetryNavigation"); call(page, "onRetryNavigation");
    expect(calls).toBe(2);
    expect(page.navigationInFlight).toBe(true);
    retryNavigation.reject(new Error("retry failed")); await flush();
    expect(page.navigationInFlight).toBe(false);
    expect(page.data.navigationError).toBe("订单已创建，但页面打开失败。");
    call(page, "onRetryNavigation");
    expect(calls).toBe(3);
    call(page, "onUnload");
  });

  test("a newer phone authorization suppresses the older response", async () => {
    const oldPhone = deferred<{ maskedPhone: string }>(); const newPhone = deferred<{ maskedPhone: string }>(); let calls = 0;
    registerBookingDataSource({ ...sourceWith(async () => ({ userId: "user", maskedPhone: null })), authorizePhone() { calls += 1; return calls === 1 ? oldPhone.promise : newPhone.promise; } });
    const page = loadPage(); call(page, "onLoad", { slot_id: slotId }); await flush();
    const older = call(page, "onAuthorizePhone", { detail: { source: "getphonenumber", code: "old" } }) as Promise<void>;
    const newer = call(page, "onAuthorizePhone", { detail: { source: "getphonenumber", code: "new" } }) as Promise<void>;
    newPhone.resolve({ maskedPhone: "139****0000" }); await newer;
    oldPhone.resolve({ maskedPhone: "137****0000" }); await older;
    expect(page.data.maskedPhone).toBe("139****0000");
    call(page, "onUnload");
  });
});

function memoryStorage(initial?: unknown) {
  let value = initial;
  return {
    get: jest.fn(() => value),
    set: jest.fn((_key: string, next: unknown) => { value = next; }),
    remove: jest.fn((key: string) => { void key; value = undefined; }),
  };
}
