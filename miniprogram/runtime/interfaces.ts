export interface Clock {
  now(): Date;
}

export interface Transport {
  get<T>(path: string, headers?: Readonly<Record<string, string>>): Promise<T>;
  post<T>(path: string, body: unknown, headers?: Readonly<Record<string, string>>): Promise<T>;
}

export interface HttpTransportError {
  readonly code: "HTTP_ERROR";
  readonly statusCode: number;
  readonly data: unknown;
}

export interface NetworkTransportError {
  readonly code: "NETWORK_ERROR";
  readonly errMsg: string;
}

export interface TimeoutTransportError {
  readonly code: "REQUEST_TIMEOUT";
  readonly errMsg: string;
}

export type TransportError = HttpTransportError | NetworkTransportError | TimeoutTransportError;

export interface WeChatIdentityCapability {
  login(): Promise<{ readonly code: string }>;
}

export interface WeChatPhoneCapability {
  normalizeEvent(event: unknown): { readonly code: string };
}

export interface OpenLocationInput {
  latitude: number;
  longitude: number;
  name: string;
  address: string;
}

export interface NativeCapabilities {
  openLocation(input: OpenLocationInput): Promise<void>;
  makePhoneCall(phoneNumber: string): Promise<void>;
}

export interface MediaSourceResolver {
  resolve(role: "COVER" | "GALLERY", source: string): string;
}
