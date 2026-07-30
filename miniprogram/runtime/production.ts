import type {
  Clock,
  LocationCapability,
  MediaSourceResolver,
  NativeCapabilities,
  StatusTransport,
  WeChatIdentityCapability,
  WeChatPhoneCapability,
} from "./interfaces";
import type { SessionStorage } from "../services/session-store";
import type { PaymentCapability } from "../domain/payment";

export const productionClock: Clock = {
  now: () => new Date(),
};

export const productionSessionStorage: SessionStorage = {
  get: (key) => wx.getStorageSync(key) as unknown,
  set: (key, value) => wx.setStorageSync(key, value),
  remove: (key) => wx.removeStorageSync(key),
};

export interface ProductionIdentityOptions {
  readonly timeoutMs?: number;
}

function loginFailed(): Error & { code: "LOGIN_FAILED" } {
  return Object.assign(new Error("LOGIN_FAILED"), { code: "LOGIN_FAILED" as const });
}

export function createProductionIdentity({ timeoutMs = 8000 }: ProductionIdentityOptions = {}): WeChatIdentityCapability {
  return {
    login() {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (action: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        action();
      };
      const timer = setTimeout(() => finish(() => reject(loginFailed())), timeoutMs);
      wx.login({
        success: ({ code }) => code
          ? finish(() => resolve({ code }))
          : finish(() => reject(loginFailed())),
        fail: () => finish(() => reject(loginFailed())),
      });
    });
    },
  };
}

export const productionIdentity = createProductionIdentity();

export const productionPhone: WeChatPhoneCapability = {
  normalizeEvent(event) {
    const value = typeof event === "object" && event !== null
      ? event as { code?: unknown; errMsg?: unknown }
      : {};
    if (typeof value.code !== "string" || value.code.length === 0 || value.code.length > 256
      || value.errMsg !== "getPhoneNumber:ok") {
      throw Object.assign(new Error("PHONE_REJECTED"), { code: "PHONE_REJECTED" });
    }
    return { code: value.code };
  },
};

export const productionPayment: PaymentCapability = {
  requestPayment(params) {
    return new Promise((resolve) => {
      wx.requestPayment({
        ...params,
        success: () => resolve({ outcome: "cashier_success" }),
        fail: (error) => {
          if (error.errMsg === "requestPayment:fail cancel") {
            resolve({ outcome: "user_cancelled" });
            return;
          }
          resolve({ outcome: "launch_failed", message: "支付调起失败，请重试。" });
        },
      });
    });
  },
};

export function productionTransport(baseUrl: string): StatusTransport {
  const requestWithStatus = <T>(
    method: "GET" | "POST",
    path: string,
    body: unknown,
    headers?: Readonly<Record<string, string>>,
  ): Promise<{ readonly statusCode: number; readonly data: T }> => {
    return new Promise((resolve, reject) => {
      let settled = false;
      const resolveOnce = (value: { readonly statusCode: number; readonly data: T }) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      const rejectOnce = (reason: unknown) => {
        if (settled) return;
        settled = true;
        reject(reason);
      };
      wx.request({
        url: `${baseUrl}${path}`,
        method,
        ...(body === undefined ? {} : { data: body as string | WechatMiniprogram.IAnyObject | ArrayBuffer }),
        ...(headers === undefined ? {} : { header: headers }),
        timeout: 8000,
        success: (response) => {
          if (response.statusCode >= 200 && response.statusCode < 300) {
            resolveOnce({ statusCode: response.statusCode, data: response.data as T });
          } else {
            rejectOnce({ code: "HTTP_ERROR", statusCode: response.statusCode, data: response.data });
          }
        },
        fail: (error) => {
          const errMsg = typeof error.errMsg === "string" ? error.errMsg : "";
          rejectOnce({
            code: /timeout/i.test(errMsg) ? "REQUEST_TIMEOUT" : "NETWORK_ERROR",
            errMsg,
          });
        },
      });
    });
  };
  return {
    get: async <T>(path: string, headers?: Readonly<Record<string, string>>) =>
      (await requestWithStatus<T>("GET", path, undefined, headers)).data,
    post: async <T>(path: string, body: unknown, headers?: Readonly<Record<string, string>>) =>
      (await requestWithStatus<T>("POST", path, body, headers)).data,
    requestWithStatus,
  };
}

export const productionNative: NativeCapabilities = {
  openLocation(input) {
    return new Promise((resolve, reject) => {
      wx.openLocation({ ...input, success: () => resolve(), fail: reject });
    });
  },
  makePhoneCall(phoneNumber) {
    return new Promise((resolve, reject) => {
      wx.makePhoneCall({ phoneNumber, success: () => resolve(), fail: reject });
    });
  },
};

const locationFailure = (errMsg: string): Error & { code: string } => {
  const normalized = errMsg.toLowerCase();
  const code = normalized.includes("privacy")
    ? "LOCATION_PRIVACY_DENIED"
    : /auth deny|authorize.*deny|permission denied/.test(normalized)
      ? "LOCATION_PERMISSION_DENIED"
      : /service.*disabled|system location|location switch/.test(normalized)
        ? "LOCATION_SERVICES_DISABLED"
        : normalized.includes("timeout") ? "LOCATION_TIMEOUT" : "LOCATION_FAILED";
  return Object.assign(new Error(code), { code });
};

export const productionLocation: LocationCapability = {
  getLocation() {
    return new Promise((resolve, reject) => {
      wx.getLocation({
        type: "gcj02",
        success: ({ latitude, longitude }) => {
          if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
            || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
            reject(locationFailure("invalid coordinate"));
            return;
          }
          resolve({ coordinateSystem: "GCJ02", latitude, longitude });
        },
        fail: ({ errMsg }) => reject(locationFailure(errMsg)),
      });
    });
  },
  openSetting() {
    return new Promise((resolve, reject) => {
      wx.openSetting({ success: () => resolve(), fail: reject });
    });
  },
};

export const productionMedia: MediaSourceResolver = {
  resolve: (_role, source) => source,
};

export function productionRuntime(baseUrl: string) {
  return {
    clock: productionClock,
    transport: productionTransport(baseUrl),
    native: productionNative,
    media: productionMedia,
    identity: productionIdentity,
    phone: productionPhone,
  };
}
