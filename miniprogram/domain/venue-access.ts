import { arrayAt, exactObject, stringAt, uuidAt } from "./decoder-primitives";

export interface ManagedVenue {
  readonly id: string;
  readonly name: string;
  readonly districtName: string;
  readonly address: string;
}

export function decodeManagedVenuesResponse(value: unknown): readonly ManagedVenue[] {
  const response = exactObject(value, ["venues"], "$");
  return arrayAt(response.venues, "$.venues").map((item, index) => {
    const path = `$.venues[${index}]`;
    const venue = exactObject(item, ["id", "name", "district_name", "address"], path);
    return {
      id: uuidAt(venue.id, `${path}.id`),
      name: stringAt(venue.name, `${path}.name`),
      districtName: stringAt(venue.district_name, `${path}.district_name`),
      address: stringAt(venue.address, `${path}.address`),
    };
  });
}
