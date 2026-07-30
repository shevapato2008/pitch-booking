export interface Clock {
  now(): Date;
}

export interface Transport {
  get<T>(path: string, headers?: Readonly<Record<string, string>>): Promise<T>;
  post<T>(path: string, body: unknown, headers?: Readonly<Record<string, string>>): Promise<T>;
}

export interface TransportResponse<T> {
  readonly statusCode: number;
  readonly data: T;
}

export interface StatusTransport extends Transport {
  requestWithStatus<T>(
    method: "GET" | "POST",
    path: string,
    body: unknown,
    headers?: Readonly<Record<string, string>>,
  ): Promise<TransportResponse<T>>;
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

export interface LocationCoordinate {
  readonly coordinateSystem: "GCJ02";
  readonly latitude: number;
  readonly longitude: number;
}

export type LocationFailureCode =
  | "LOCATION_PRIVACY_DENIED"
  | "LOCATION_PERMISSION_DENIED"
  | "LOCATION_SERVICES_DISABLED"
  | "LOCATION_TIMEOUT"
  | "LOCATION_FAILED";

export interface LocationCapability {
  getLocation(): Promise<LocationCoordinate>;
  openSetting(): Promise<void>;
}

export interface MediaSourceResolver {
  resolve(role: "COVER" | "GALLERY", source: string): string;
}
