export interface Clock {
  now(): Date;
}

export interface Transport {
  get<T>(path: string): Promise<T>;
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
