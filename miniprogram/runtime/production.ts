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
        wx.request({
          url: `${baseUrl}${path}`,
          method: "GET",
          timeout: 8000,
          success: (response) => resolve(response.data as T),
          fail: reject,
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
