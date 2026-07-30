import type { LocationCapability, LocationFailureCode } from "../runtime/interfaces";

export const DEVELOPMENT_VENUE_DIRECTORY_SCENARIOS = [
  "ready",
  "load-error",
  "map-render-failure",
  "location-success",
  "privacy-denied",
  "permission-denied",
  "services-disabled",
  "timeout",
] as const;

export type DevelopmentVenueDirectoryScenario = typeof DEVELOPMENT_VENUE_DIRECTORY_SCENARIOS[number];

const failureCodes: Partial<Record<DevelopmentVenueDirectoryScenario, LocationFailureCode>> = {
  "privacy-denied": "LOCATION_PRIVACY_DENIED",
  "permission-denied": "LOCATION_PERMISSION_DENIED",
  "services-disabled": "LOCATION_SERVICES_DISABLED",
  timeout: "LOCATION_TIMEOUT",
};

export function createSimulatedLocationCapability(
  scenario: DevelopmentVenueDirectoryScenario,
): LocationCapability {
  return {
    async getLocation() {
      if (scenario === "location-success") {
        return { coordinateSystem: "GCJ02", latitude: 39.0842, longitude: 117.2009 };
      }
      const code = failureCodes[scenario] ?? "LOCATION_FAILED";
      throw Object.assign(new Error(code), { code });
    },
    async openSetting() {},
  };
}
