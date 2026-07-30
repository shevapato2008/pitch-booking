import type { LocationCapability } from "../runtime/interfaces";

let configuredLocationCapability: LocationCapability | undefined;

export function registerLocationCapability(capability: LocationCapability): void {
  configuredLocationCapability = capability;
}

export function getLocationCapability(): LocationCapability {
  if (!configuredLocationCapability) throw new Error("LOCATION_CAPABILITY_NOT_CONFIGURED");
  return configuredLocationCapability;
}
