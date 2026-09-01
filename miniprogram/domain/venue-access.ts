import { arrayAt, enumAt, exactObject, invalid, stringAt, uuidAt } from "./decoder-primitives";
import {
  VENUE_STAFF_PERMISSIONS,
  type VenueStaffPermission,
  type VenueStaffRole,
} from "./venue-staff";

const VENUE_STAFF_ROLES = ["OWNER", "STAFF"] as const;

export interface ManagedVenue {
  readonly id: string;
  readonly name: string;
  readonly districtName: string;
  readonly address: string;
  readonly role: VenueStaffRole;
  readonly permissions: readonly VenueStaffPermission[];
}

function permissionsAt(value: unknown, path: string): readonly VenueStaffPermission[] {
  const values = arrayAt(value, path, 1);
  if (values.length > VENUE_STAFF_PERMISSIONS.length) invalid(path);
  const decoded = values.map((item, index) =>
    enumAt(item, VENUE_STAFF_PERMISSIONS, `${path}[${index}]`),
  );
  if (new Set(decoded).size !== decoded.length) invalid(path);
  return decoded;
}

export function decodeManagedVenuesResponse(value: unknown): readonly ManagedVenue[] {
  const response = exactObject(value, ["venues"], "$");
  return arrayAt(response.venues, "$.venues").map((item, index) => {
    const path = `$.venues[${index}]`;
    const venue = exactObject(
      item,
      ["id", "name", "district_name", "address", "role", "permissions"],
      path,
    );
    return {
      id: uuidAt(venue.id, `${path}.id`),
      name: stringAt(venue.name, `${path}.name`),
      districtName: stringAt(venue.district_name, `${path}.district_name`),
      address: stringAt(venue.address, `${path}.address`),
      role: enumAt(venue.role, VENUE_STAFF_ROLES, `${path}.role`),
      permissions: permissionsAt(venue.permissions, `${path}.permissions`),
    };
  });
}
