import type {
  Clock,
  MediaSourceResolver,
  NativeCapabilities,
  Transport,
} from "./interfaces";

export const productionClock: Clock = {
  now: () => new Date(),
};

export function productionTransport(baseUrl: string): Transport {
  return {
    get<T>(path: string): Promise<T> {
      return new Promise((resolve, reject) => {
        let settled = false;
        const resolveOnce = (value: T) => {
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
          method: "GET",
          timeout: 8000,
          success: (response) => {
            if (response.statusCode >= 200 && response.statusCode < 300) {
              resolveOnce(response.data as T);
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
    },
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

export const productionMedia: MediaSourceResolver = {
  resolve: (_role, source) => source,
};

export function productionRuntime(baseUrl: string) {
  return {
    clock: productionClock,
    transport: productionTransport(baseUrl),
    native: productionNative,
    media: productionMedia,
  };
}
